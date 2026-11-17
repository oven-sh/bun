use std::{
    collections::HashMap,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use axum::{
    body::Bytes,
    extract::{Path, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use deadpool_postgres::Pool;
use serde::{Deserialize, Deserializer, Serialize};
use tokio_postgres::types::ToSql;

use crate::{App, Failure};

struct Session {
    customer_id: i32,
    expires_at: i64,
}

pub struct Shop {
    sessions: HashMap<String, Session>,
    carrier: reqwest::Client,
    carrier_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Product {
    id: i32,
    shop: String,
    sku: String,
    name: String,
    description: String,
    price_cents: i32,
    weight_grams: i32,
    stock: i32,
}

#[derive(Serialize, Deserialize, Clone)]
struct Rate {
    service: String,
    cents: i32,
    days: i32,
}

#[derive(Deserialize)]
struct RatesAnswer {
    currency: String,
    rates: Vec<Rate>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Address {
    name: String,
    street: String,
    city: String,
    postal_code: String,
    country: String,
}

// An optional member may be absent, but it may not be null.
fn present<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<String>, D::Error> {
    String::deserialize(deserializer).map(Some)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Item {
    product_id: i32,
    quantity: i32,
    #[serde(default, deserialize_with = "present")]
    note: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Order {
    items: Vec<Item>,
    ship_to: Address,
    #[serde(default, deserialize_with = "present")]
    coupon: Option<String>,
    gift_wrap: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Line {
    product_id: i32,
    sku: String,
    name: String,
    description: String,
    quantity: i32,
    unit_cents: i32,
    total_cents: i32,
    weight_grams: i32,
    in_stock: bool,
    note: Option<String>,
}

#[derive(Serialize)]
struct Buyer {
    id: i32,
    name: String,
    email: String,
    tier: String,
    returning: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Shipping {
    chosen: Rate,
    options: Vec<Rate>,
    weight_grams: i32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Totals {
    subtotal_cents: i32,
    discount_percent: i32,
    discount_cents: i32,
    gift_wrap_cents: i32,
    shipping_cents: i32,
    tax_percent: i32,
    tax_cents: i32,
    total_cents: i32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Quote {
    shop: String,
    customer: Buyer,
    ship_to: Address,
    lines: Vec<Line>,
    shipping: Shipping,
    totals: Totals,
    currency: &'static str,
}

#[derive(Serialize)]
struct Problem {
    error: &'static str,
}

fn problem(status: StatusCode, error: &'static str) -> Response {
    (status, Json(Problem { error })).into_response()
}

fn percent_of(cents: i32, percent: i32) -> i32 {
    (cents * percent + 50) / 100
}

fn tax_percent(country: &str) -> Option<i32> {
    match country {
        "PT" => Some(23),
        "JP" => Some(10),
        "US" => Some(0),
        "KE" => Some(16),
        "NO" => Some(25),
        _ => None,
    }
}

fn within(text: &str, longest: usize) -> bool {
    !text.is_empty() && text.chars().count() <= longest
}

fn parse_order(body: &[u8]) -> Option<Order> {
    let order: Order = serde_json::from_slice(body).ok()?;
    let to = &order.ship_to;
    let valid = (1..=20).contains(&order.items.len())
        && order.items.iter().all(|item| item.product_id >= 1 && (1..=99).contains(&item.quantity) && item.note.as_ref().is_none_or(|note| note.chars().count() <= 200))
        && within(&to.name, 100)
        && within(&to.street, 200)
        && within(&to.city, 100)
        && within(&to.postal_code, 16)
        && tax_percent(&to.country).is_some()
        && order.coupon.as_ref().is_none_or(|coupon| coupon.chars().count() <= 20);
    valid.then_some(order)
}

const SELECT_PRODUCTS: &str = "SELECT id, shop, sku, name, description, price_cents, weight_grams, stock FROM product WHERE shop = $1 AND id = ANY($2)";
const SELECT_CUSTOMER: &str = "SELECT id, name, email, tier, orders_placed FROM customer WHERE id = $1";

fn product_of(row: &tokio_postgres::Row) -> Product {
    Product { id: row.get(0), shop: row.get(1), sku: row.get(2), name: row.get(3), description: row.get(4), price_cents: row.get(5), weight_grams: row.get(6), stock: row.get(7) }
}

impl Shop {
    pub async fn load(pool: &Pool, carrier_url: String) -> Shop {
        let client = pool.get().await.unwrap();
        let rows = client.query("SELECT token, customer_id, extract(epoch FROM expires_at)::bigint FROM session", &[]).await.unwrap();
        let sessions = rows.iter().map(|row| (row.get(0), Session { customer_id: row.get(1), expires_at: row.get(2) })).collect();
        Shop { sessions, carrier: reqwest::Client::new(), carrier_url }
    }

    fn session(&self, headers: &HeaderMap) -> Option<&Session> {
        let token = headers.get(header::AUTHORIZATION)?.to_str().ok()?.strip_prefix("Bearer ")?;
        let now = SystemTime::now().duration_since(UNIX_EPOCH).ok()?.as_secs() as i64;
        self.sessions.get(token).filter(|session| session.expires_at > now)
    }

    async fn rates(&self, country: &str, grams: i32) -> Result<Vec<Rate>, Failure> {
        let response = self.carrier.get(format!("{}/rates?country={country}&grams={grams}", self.carrier_url)).send().await?.error_for_status()?;
        let answer: RatesAnswer = response.json().await?;
        if answer.currency != "EUR" {
            return Err("the carrier answered in another currency".into());
        }
        Ok(answer.rates)
    }
}

pub async fn show_product(State(app): State<Arc<App>>, Path((shop, id)): Path<(String, String)>) -> Result<Response, Failure> {
    let Some(id) = id.parse::<i32>().ok().filter(|id| *id >= 1) else {
        return Ok(problem(StatusCode::BAD_REQUEST, "invalid product id"));
    };
    let client = app.pool.get().await?;
    let select = client.prepare_cached(SELECT_PRODUCTS).await?;
    Ok(match client.query_opt(&select, &[&shop, &vec![id]]).await? {
        Some(row) => Json(product_of(&row)).into_response(),
        None => problem(StatusCode::NOT_FOUND, "no such product"),
    })
}

pub async fn quote_order(State(app): State<Arc<App>>, Path(shop): Path<String>, headers: HeaderMap, body: Bytes) -> Result<Response, Failure> {
    let Some(session) = app.shop.session(&headers) else {
        return Ok(problem(StatusCode::UNAUTHORIZED, "not signed in"));
    };
    let Some(order) = parse_order(&body) else {
        return Ok(problem(StatusCode::BAD_REQUEST, "invalid order"));
    };

    let ids: Vec<i32> = order.items.iter().map(|item| item.product_id).collect();
    let (customer, products) = {
        let client = app.pool.get().await?;
        let (select_customer, select_products) = (client.prepare_cached(SELECT_CUSTOMER).await?, client.prepare_cached(SELECT_PRODUCTS).await?);
        let of_customer: [&(dyn ToSql + Sync); 1] = [&session.customer_id];
        let of_products: [&(dyn ToSql + Sync); 2] = [&shop, &ids];
        let (customer, products) = tokio::join!(client.query_opt(&select_customer, &of_customer), client.query(&select_products, &of_products));
        (customer?, products?)
    };
    let Some(customer) = customer else {
        return Ok(problem(StatusCode::UNAUTHORIZED, "not signed in"));
    };
    let by_id: HashMap<i32, Product> = products.iter().map(|row| (row.get(0), product_of(row))).collect();

    let mut lines = Vec::with_capacity(order.items.len());
    for item in order.items {
        let Some(product) = by_id.get(&item.product_id) else {
            return Ok(problem(StatusCode::UNPROCESSABLE_ENTITY, "no such product"));
        };
        lines.push(Line {
            product_id: product.id,
            sku: product.sku.clone(),
            name: product.name.clone(),
            description: product.description.clone(),
            quantity: item.quantity,
            unit_cents: product.price_cents,
            total_cents: product.price_cents * item.quantity,
            weight_grams: product.weight_grams * item.quantity,
            in_stock: product.stock >= item.quantity,
            note: item.note,
        });
    }
    let weight_grams = lines.iter().map(|line| line.weight_grams).sum();

    let mut options = app.shop.rates(&order.ship_to.country, weight_grams).await?;
    options.sort_by_key(|rate| rate.cents);
    let Some(chosen) = options.first().cloned() else {
        return Ok(problem(StatusCode::BAD_GATEWAY, "the carrier offers no rate"));
    };

    let tier: String = customer.get(3);
    let coupon = order.coupon.as_deref();
    let subtotal_cents = lines.iter().map(|line| line.total_cents).sum();
    let discount_percent = match tier.as_str() {
        "silver" => 5,
        "gold" => 10,
        _ => 0,
    } + if coupon == Some("WELCOME10") { 10 } else { 0 };
    let discount_cents = percent_of(subtotal_cents, discount_percent);
    let gift_wrap_cents = if order.gift_wrap { 250 * lines.len() as i32 } else { 0 };
    let shipping_cents = if coupon == Some("FREESHIP") { 0 } else { chosen.cents };
    let tax_percent = tax_percent(&order.ship_to.country).unwrap_or(0);
    let tax_cents = percent_of(subtotal_cents - discount_cents + gift_wrap_cents, tax_percent);
    Ok(Json(Quote {
        shop,
        customer: Buyer { id: customer.get(0), name: customer.get(1), email: customer.get(2), tier, returning: customer.get::<_, i32>(4) > 0 },
        ship_to: order.ship_to,
        lines,
        shipping: Shipping { chosen, options, weight_grams },
        totals: Totals { subtotal_cents, discount_percent, discount_cents, gift_wrap_cents, shipping_cents, tax_percent, tax_cents, total_cents: subtotal_cents - discount_cents + gift_wrap_cents + shipping_cents + tax_cents },
        currency: "EUR",
    })
    .into_response())
}
