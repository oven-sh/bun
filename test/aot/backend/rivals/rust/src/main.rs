// The same routes as ../../../app/server.ts, on axum, tokio-postgres and reqwest.
mod shop;

use std::sync::Arc;

use askama::Template;
use axum::{
    extract::{Query, State},
    http::{header, StatusCode},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
    serve::ListenerExt,
    Json, Router,
};
use deadpool_postgres::{Manager, ManagerConfig, Pool, RecyclingMethod};
use futures_util::future::try_join_all;
use serde::{Deserialize, Serialize};
use tokio_postgres::NoTls;

#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

pub struct App {
    pub pool: Pool,
    pub shop: shop::Shop,
}

pub struct Failure(String);

impl<E: std::fmt::Display> From<E> for Failure {
    fn from(error: E) -> Self {
        Failure(error.to_string())
    }
}

impl IntoResponse for Failure {
    fn into_response(self) -> Response {
        (StatusCode::INTERNAL_SERVER_ERROR, self.0).into_response()
    }
}

const SERVER: [(header::HeaderName, &str); 1] = [(header::SERVER, "Axum")];
const SELECT_WORLD: &str = "SELECT id, randomnumber FROM world WHERE id = $1";
const UPDATE_WORLDS: &str = "UPDATE world SET randomnumber = changed.randomnumber FROM unnest($1::int[], $2::int[]) AS changed (id, randomnumber) WHERE world.id = changed.id";

#[derive(Serialize)]
struct Message {
    message: &'static str,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct World {
    id: i32,
    random_number: i32,
}

struct Fortune {
    id: i32,
    message: String,
}

#[derive(Template)]
#[template(path = "fortunes.html")]
struct FortunesPage {
    fortunes: Vec<Fortune>,
}

#[derive(Deserialize)]
struct Count {
    queries: Option<String>,
}

impl Count {
    fn get(&self) -> usize {
        self.queries.as_deref().and_then(|text| text.parse::<i64>().ok()).unwrap_or(1).clamp(1, 500) as usize
    }
}

fn random_number() -> i32 {
    fastrand::i32(1..=10000)
}

// Every row is asked for by a query of its own. The queries of one request are pipelined on one connection.
async fn random_worlds(app: &App, count: usize) -> Result<Vec<World>, Failure> {
    let client = app.pool.get().await?;
    let select = client.prepare_cached(SELECT_WORLD).await?;
    let rows = try_join_all((0..count).map(|_| {
        let id = random_number();
        let (client, select) = (&client, &select);
        async move { client.query_one(select, &[&id]).await }
    }))
    .await?;
    Ok(rows.iter().map(|row| World { id: row.get(0), random_number: row.get(1) }).collect())
}

async fn plaintext() -> impl IntoResponse {
    (SERVER, "Hello, World!")
}

async fn json() -> impl IntoResponse {
    (SERVER, Json(Message { message: "Hello, World!" }))
}

async fn db(State(app): State<Arc<App>>) -> Result<impl IntoResponse, Failure> {
    let mut worlds = random_worlds(&app, 1).await?;
    Ok((SERVER, Json(worlds.remove(0))))
}

async fn queries(State(app): State<Arc<App>>, Query(count): Query<Count>) -> Result<impl IntoResponse, Failure> {
    Ok((SERVER, Json(random_worlds(&app, count.get()).await?)))
}

async fn updates(State(app): State<Arc<App>>, Query(count): Query<Count>) -> Result<impl IntoResponse, Failure> {
    let mut worlds = random_worlds(&app, count.get()).await?;
    for world in &mut worlds {
        world.random_number = random_number();
    }
    let mut ordered = worlds.clone();
    ordered.sort_by_key(|world| world.id);
    let ids: Vec<i32> = ordered.iter().map(|world| world.id).collect();
    let numbers: Vec<i32> = ordered.iter().map(|world| world.random_number).collect();
    let client = app.pool.get().await?;
    let update = client.prepare_cached(UPDATE_WORLDS).await?;
    client.execute(&update, &[&ids, &numbers]).await?;
    Ok((SERVER, Json(worlds)))
}

async fn fortunes(State(app): State<Arc<App>>) -> Result<impl IntoResponse, Failure> {
    let client = app.pool.get().await?;
    let select = client.prepare_cached("SELECT id, message FROM fortune").await?;
    let mut fortunes: Vec<Fortune> = client.query(&select, &[]).await?.iter().map(|row| Fortune { id: row.get(0), message: row.get(1) }).collect();
    fortunes.push(Fortune { id: 0, message: "Additional fortune added at request time.".to_string() });
    fortunes.sort_by(|a, b| a.message.cmp(&b.message));
    Ok((SERVER, Html(FortunesPage { fortunes }.render()?)))
}

#[tokio::main]
async fn main() {
    let variable = |name: &str, otherwise: &str| std::env::var(name).unwrap_or_else(|_| otherwise.to_string());
    let config: tokio_postgres::Config = variable("DATABASE_URL", "postgres://benchmarkdbuser:benchmarkdbpass@127.0.0.1:5432/hello_world").parse().unwrap();
    let manager = Manager::from_config(config, NoTls, ManagerConfig { recycling_method: RecyclingMethod::Fast });
    let pool = Pool::builder(manager).max_size(variable("DATABASE_POOL", "8").parse().unwrap()).build().unwrap();
    let shop = shop::Shop::load(&pool, variable("CARRIER_URL", "http://127.0.0.1:3001")).await;
    let app = Router::new()
        .route("/plaintext", get(plaintext))
        .route("/json", get(json))
        .route("/db", get(db))
        .route("/queries", get(queries))
        .route("/updates", get(updates))
        .route("/fortunes", get(fortunes))
        .route("/api/shops/{shop}/products/{id}", get(shop::show_product))
        .route("/api/shops/{shop}/quotes", post(shop::quote_order))
        .with_state(Arc::new(App { pool, shop }));
    let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{}", variable("PORT", "3000"))).await.unwrap();
    println!("listening {}", listener.local_addr().unwrap().port());
    let listener = listener.tap_io(|connection| {
        let _ = connection.set_nodelay(true);
    });
    axum::serve(listener, app).await.unwrap();
}
