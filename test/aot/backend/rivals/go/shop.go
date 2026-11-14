package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
)

type session struct {
	CustomerID int32
	ExpiresAt  time.Time
}

type customer struct {
	ID           int32
	Name         string
	Email        string
	Tier         string
	Country      string
	OrdersPlaced int32
}

type product struct {
	ID          int32  `json:"id"`
	Shop        string `json:"shop"`
	SKU         string `json:"sku"`
	Name        string `json:"name"`
	Description string `json:"description"`
	PriceCents  int32  `json:"priceCents"`
	WeightGrams int32  `json:"weightGrams"`
	Stock       int32  `json:"stock"`
}

type rate struct {
	Service string `json:"service"`
	Cents   int32  `json:"cents"`
	Days    int32  `json:"days"`
}

type address struct {
	Name       string `json:"name"`
	Street     string `json:"street"`
	City       string `json:"city"`
	PostalCode string `json:"postalCode"`
	Country    string `json:"country"`
}

type item struct {
	ProductID *int32  `json:"productId"`
	Quantity  *int32  `json:"quantity"`
	Note      *string `json:"note"`
}

type order struct {
	Items    []item          `json:"items"`
	ShipTo   *address        `json:"shipTo"`
	Coupon   json.RawMessage `json:"coupon"`
	GiftWrap *bool           `json:"giftWrap"`
	coupon   string
}

type line struct {
	ProductID   int32   `json:"productId"`
	SKU         string  `json:"sku"`
	Name        string  `json:"name"`
	Description string  `json:"description"`
	Quantity    int32   `json:"quantity"`
	UnitCents   int32   `json:"unitCents"`
	TotalCents  int32   `json:"totalCents"`
	WeightGrams int32   `json:"weightGrams"`
	InStock     bool    `json:"inStock"`
	Note        *string `json:"note"`
}

type buyer struct {
	ID        int32  `json:"id"`
	Name      string `json:"name"`
	Email     string `json:"email"`
	Tier      string `json:"tier"`
	Returning bool   `json:"returning"`
}

type shipping struct {
	Chosen      rate   `json:"chosen"`
	Options     []rate `json:"options"`
	WeightGrams int32  `json:"weightGrams"`
}

type totals struct {
	SubtotalCents   int32 `json:"subtotalCents"`
	DiscountPercent int32 `json:"discountPercent"`
	DiscountCents   int32 `json:"discountCents"`
	GiftWrapCents   int32 `json:"giftWrapCents"`
	ShippingCents   int32 `json:"shippingCents"`
	TaxPercent      int32 `json:"taxPercent"`
	TaxCents        int32 `json:"taxCents"`
	TotalCents      int32 `json:"totalCents"`
}

type quote struct {
	Shop     string   `json:"shop"`
	Customer buyer    `json:"customer"`
	ShipTo   address  `json:"shipTo"`
	Lines    []line   `json:"lines"`
	Shipping shipping `json:"shipping"`
	Totals   totals   `json:"totals"`
	Currency string   `json:"currency"`
}

type problem struct {
	Error string `json:"error"`
}

var (
	sessions     = map[string]session{}
	carrierURL   = "http://127.0.0.1:3001"
	carrier      = &http.Client{Transport: &http.Transport{MaxIdleConns: 1024, MaxIdleConnsPerHost: 1024}}
	tierDiscount = map[string]int32{"standard": 0, "silver": 5, "gold": 10}
	taxPercent   = map[string]int32{"PT": 23, "JP": 10, "US": 0, "KE": 16, "NO": 25}
)

const selectProducts = "SELECT id, shop, sku, name, description, price_cents, weight_grams, stock FROM product WHERE shop = $1 AND id = ANY($2)"

func percentOf(cents, percent int32) int32 {
	return (cents*percent + 50) / 100
}

func within(text string, longest int) bool {
	return len(text) >= 1 && len([]rune(text)) <= longest
}

func parseOrder(body []byte) *order {
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	var parsed order
	if decoder.Decode(&parsed) != nil || decoder.More() {
		return nil
	}
	if len(parsed.Items) < 1 || len(parsed.Items) > 20 || parsed.ShipTo == nil || parsed.GiftWrap == nil {
		return nil
	}
	for _, item := range parsed.Items {
		if item.ProductID == nil || *item.ProductID < 1 || item.Quantity == nil || *item.Quantity < 1 || *item.Quantity > 99 {
			return nil
		}
		if item.Note != nil && len([]rune(*item.Note)) > 200 {
			return nil
		}
	}
	to := parsed.ShipTo
	if _, served := taxPercent[to.Country]; !served || !within(to.Name, 100) || !within(to.Street, 200) || !within(to.City, 100) || !within(to.PostalCode, 16) {
		return nil
	}
	if parsed.Coupon != nil {
		if json.Unmarshal(parsed.Coupon, &parsed.coupon) != nil || bytes.Equal(parsed.Coupon, []byte("null")) || len([]rune(parsed.coupon)) > 20 {
			return nil
		}
	}
	return &parsed
}

func findProducts(ctx context.Context, shop string, ids []int32) ([]product, error) {
	rows, err := pool.Query(ctx, selectProducts, shop, ids)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (product, error) {
		var p product
		return p, row.Scan(&p.ID, &p.Shop, &p.SKU, &p.Name, &p.Description, &p.PriceCents, &p.WeightGrams, &p.Stock)
	})
}

func findCustomer(ctx context.Context, id int32) (*customer, error) {
	var c customer
	err := pool.QueryRow(ctx, "SELECT id, name, email, tier, country, orders_placed FROM customer WHERE id = $1", id).Scan(&c.ID, &c.Name, &c.Email, &c.Tier, &c.Country, &c.OrdersPlaced)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &c, err
}

func shippingRates(ctx context.Context, country string, grams int32) ([]rate, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("%s/rates?country=%s&grams=%d", carrierURL, country, grams), nil)
	if err != nil {
		return nil, err
	}
	response, err := carrier.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("the carrier answered %d", response.StatusCode)
	}
	var answer struct {
		Carrier  string `json:"carrier"`
		Currency string `json:"currency"`
		Rates    []rate `json:"rates"`
	}
	if err := json.NewDecoder(response.Body).Decode(&answer); err != nil {
		return nil, err
	}
	if answer.Currency != "EUR" {
		return nil, errors.New("the carrier answered in another currency")
	}
	return answer.Rates, nil
}

func showProduct(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || id < 1 {
		writeJSON(w, http.StatusBadRequest, problem{"invalid product id"})
		return
	}
	products, err := findProducts(r.Context(), r.PathValue("shop"), []int32{int32(id)})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if len(products) == 0 {
		writeJSON(w, http.StatusNotFound, problem{"no such product"})
		return
	}
	writeJSON(w, http.StatusOK, products[0])
}

func quoteOrder(w http.ResponseWriter, r *http.Request) {
	token, isBearer := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	signedIn, found := sessions[token]
	if !isBearer || !found || !signedIn.ExpiresAt.After(time.Now()) {
		writeJSON(w, http.StatusUnauthorized, problem{"not signed in"})
		return
	}
	body, err := io.ReadAll(r.Body)
	var placed *order
	if err == nil {
		placed = parseOrder(body)
	}
	if placed == nil {
		writeJSON(w, http.StatusBadRequest, problem{"invalid order"})
		return
	}

	shop := r.PathValue("shop")
	ids := make([]int32, len(placed.Items))
	for i, item := range placed.Items {
		ids[i] = *item.ProductID
	}
	var who *customer
	var customerErr error
	var both sync.WaitGroup
	both.Go(func() { who, customerErr = findCustomer(r.Context(), signedIn.CustomerID) })
	products, err := findProducts(r.Context(), shop, ids)
	both.Wait()
	if err = errors.Join(err, customerErr); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if who == nil {
		writeJSON(w, http.StatusUnauthorized, problem{"not signed in"})
		return
	}

	byID := make(map[int32]*product, len(products))
	for i := range products {
		byID[products[i].ID] = &products[i]
	}
	lines := make([]line, 0, len(placed.Items))
	var grams, subtotal int32
	for _, item := range placed.Items {
		bought, found := byID[*item.ProductID]
		if !found {
			writeJSON(w, http.StatusUnprocessableEntity, problem{"no such product"})
			return
		}
		quantity := *item.Quantity
		lines = append(lines, line{bought.ID, bought.SKU, bought.Name, bought.Description, quantity, bought.PriceCents, bought.PriceCents * quantity, bought.WeightGrams * quantity, bought.Stock >= quantity, item.Note})
		grams += bought.WeightGrams * quantity
		subtotal += bought.PriceCents * quantity
	}

	options, err := shippingRates(r.Context(), placed.ShipTo.Country, grams)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if len(options) == 0 {
		writeJSON(w, http.StatusBadGateway, problem{"the carrier offers no rate"})
		return
	}
	sort.SliceStable(options, func(a, b int) bool { return options[a].Cents < options[b].Cents })

	sums := totals{SubtotalCents: subtotal, DiscountPercent: tierDiscount[who.Tier], ShippingCents: options[0].Cents, TaxPercent: taxPercent[placed.ShipTo.Country]}
	if placed.coupon == "WELCOME10" {
		sums.DiscountPercent += 10
	}
	if placed.coupon == "FREESHIP" {
		sums.ShippingCents = 0
	}
	if *placed.GiftWrap {
		sums.GiftWrapCents = 250 * int32(len(lines))
	}
	sums.DiscountCents = percentOf(subtotal, sums.DiscountPercent)
	sums.TaxCents = percentOf(subtotal-sums.DiscountCents+sums.GiftWrapCents, sums.TaxPercent)
	sums.TotalCents = subtotal - sums.DiscountCents + sums.GiftWrapCents + sums.ShippingCents + sums.TaxCents
	writeJSON(w, http.StatusOK, quote{shop, buyer{who.ID, who.Name, who.Email, who.Tier, who.OrdersPlaced > 0}, *placed.ShipTo, lines, shipping{options[0], options, grams}, sums, "EUR"})
}

func registerShop(mux *http.ServeMux) {
	if url := os.Getenv("CARRIER_URL"); url != "" {
		carrierURL = url
	}
	rows, err := pool.Query(context.Background(), "SELECT token, customer_id, expires_at FROM session")
	if err != nil {
		log.Fatal(err)
	}
	var token string
	var one session
	if _, err := pgx.ForEachRow(rows, []any{&token, &one.CustomerID, &one.ExpiresAt}, func() error { sessions[token] = one; return nil }); err != nil {
		log.Fatal(err)
	}
	mux.HandleFunc("GET /api/shops/{shop}/products/{id}", showProduct)
	mux.HandleFunc("POST /api/shops/{shop}/quotes", quoteOrder)
}
