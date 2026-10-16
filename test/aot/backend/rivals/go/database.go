package main

import (
	"context"
	"encoding/json"
	"html"
	"log"
	"math/rand/v2"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type world struct {
	ID           int32 `json:"id"`
	RandomNumber int32 `json:"randomNumber"`
}

type fortune struct {
	ID      int32
	Message string
}

const (
	selectWorld    = "SELECT id, randomnumber FROM world WHERE id = $1"
	selectFortunes = "SELECT id, message FROM fortune"
	updateWorlds   = "UPDATE world SET randomnumber = changed.randomnumber FROM unnest($1::int[], $2::int[]) AS changed (id, randomnumber) WHERE world.id = changed.id"
)

var pool *pgxpool.Pool

func renderFortunes(list []fortune) string {
	var page strings.Builder
	page.WriteString("<!DOCTYPE html><html><head><title>Fortunes</title></head><body><table><tr><th>id</th><th>message</th></tr>")
	for _, row := range list {
		page.WriteString("<tr><td>")
		page.WriteString(strconv.Itoa(int(row.ID)))
		page.WriteString("</td><td>")
		page.WriteString(html.EscapeString(row.Message))
		page.WriteString("</td></tr>")
	}
	page.WriteString("</table></body></html>")
	return page.String()
}

func randomNumber() int32 {
	return rand.Int32N(10000) + 1
}

func requestedCount(r *http.Request) int {
	count, err := strconv.Atoi(r.URL.Query().Get("queries"))
	if err != nil || count < 1 {
		return 1
	}
	return min(count, 500)
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	body, err := json.Marshal(value)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Server", "Go")
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	w.Write(body)
}

// Every row is asked for by a query of its own. The queries of one request go to the server as one batch, on one connection.
func randomWorlds(ctx context.Context, count int) ([]world, error) {
	batch := &pgx.Batch{}
	for range count {
		batch.Queue(selectWorld, randomNumber())
	}
	results := pool.SendBatch(ctx, batch)
	defer results.Close()
	worlds := make([]world, count)
	for i := range worlds {
		if err := results.QueryRow().Scan(&worlds[i].ID, &worlds[i].RandomNumber); err != nil {
			return nil, err
		}
	}
	return worlds, nil
}

func db(w http.ResponseWriter, r *http.Request) {
	var row world
	if err := pool.QueryRow(r.Context(), selectWorld, randomNumber()).Scan(&row.ID, &row.RandomNumber); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, row)
}

func queries(w http.ResponseWriter, r *http.Request) {
	worlds, err := randomWorlds(r.Context(), requestedCount(r))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, worlds)
}

func updates(w http.ResponseWriter, r *http.Request) {
	worlds, err := randomWorlds(r.Context(), requestedCount(r))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	for i := range worlds {
		worlds[i].RandomNumber = randomNumber()
	}
	ordered := make([]world, len(worlds))
	copy(ordered, worlds)
	sort.Slice(ordered, func(a, b int) bool { return ordered[a].ID < ordered[b].ID })
	ids, numbers := make([]int32, len(ordered)), make([]int32, len(ordered))
	for i, row := range ordered {
		ids[i], numbers[i] = row.ID, row.RandomNumber
	}
	if _, err := pool.Exec(r.Context(), updateWorlds, ids, numbers); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, worlds)
}

func fortunes(w http.ResponseWriter, r *http.Request) {
	rows, err := pool.Query(r.Context(), selectFortunes)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	list, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (fortune, error) {
		var f fortune
		return f, row.Scan(&f.ID, &f.Message)
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	list = append(list, fortune{Message: "Additional fortune added at request time."})
	sort.Slice(list, func(a, b int) bool { return list[a].Message < list[b].Message })
	w.Header().Set("Server", "Go")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write([]byte(renderFortunes(list)))
}

func register(mux *http.ServeMux) {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		url = "postgres://benchmarkdbuser:benchmarkdbpass@127.0.0.1:5432/hello_world"
	}
	config, err := pgxpool.ParseConfig(url)
	if err != nil {
		log.Fatal(err)
	}
	if size, err := strconv.Atoi(os.Getenv("DATABASE_POOL")); err == nil {
		config.MaxConns = int32(size)
	}
	pool, err = pgxpool.NewWithConfig(context.Background(), config)
	if err != nil {
		log.Fatal(err)
	}
	mux.HandleFunc("/db", db)
	mux.HandleFunc("/queries", queries)
	mux.HandleFunc("/updates", updates)
	mux.HandleFunc("/fortunes", fortunes)
	registerShop(mux)
}
