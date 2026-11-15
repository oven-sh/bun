// The same routes as ../../../app/server.ts, on axum and tokio-postgres.
mod assets;
mod excerpt;
mod filters;
mod format;
mod handlers;
mod markdown;
mod more_handlers;
mod passwords;
mod queries;
mod thread;
mod types;
mod validation;
mod views;
mod writes;

use std::sync::Arc;

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    serve::ListenerExt,
    Router,
};
use deadpool_postgres::{Manager, ManagerConfig, Pool, RecyclingMethod};
use tokio_postgres::NoTls;

#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

pub struct App {
    pub pool: Pool,
}

pub struct Failure(String);

impl<E: std::fmt::Display> From<E> for Failure {
    fn from(error: E) -> Self {
        Failure(error.to_string())
    }
}

impl IntoResponse for Failure {
    fn into_response(self) -> Response {
        eprintln!("{}", self.0);
        (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error").into_response()
    }
}

#[tokio::main]
async fn main() {
    let variable = |name: &str, otherwise: &str| std::env::var(name).unwrap_or_else(|_| otherwise.to_string());
    let config: tokio_postgres::Config = variable("DATABASE_URL", "postgres://tracker:tracker@127.0.0.1:5432/tracker").parse().unwrap();
    let manager = Manager::from_config(config, NoTls, ManagerConfig { recycling_method: RecyclingMethod::Fast });
    let pool = Pool::builder(manager).max_size(variable("DATABASE_POOL", "8").parse().unwrap()).build().unwrap();
    use handlers::*;
    use more_handlers::*;
    let app = Router::new()
        .route("/", get(home_page).fallback(not_found))
        .route("/assets/app.css", get(stylesheet_file).fallback(not_found))
        .route("/login", get(login_page).post(login).fallback(not_found))
        .route("/logout", post(logout).fallback(not_found))
        .route("/search", get(search_page).fallback(not_found))
        .route("/admin", get(admin_page).fallback(not_found))
        .route("/u/{login}", get(profile_page).fallback(not_found))
        .route("/p/{project}/issues", get(issue_list_page).post(create_issue).fallback(not_found))
        .route("/p/{project}/issues/new", get(new_issue_page).fallback(not_found))
        .route("/p/{project}/issues/{number}", get(issue_page).post(save_issue).fallback(not_found))
        .route("/p/{project}/issues/{number}/edit", get(edit_issue_page).fallback(not_found))
        .route("/p/{project}/issues/{number}/comments", post(create_comment).fallback(not_found))
        .route("/api/projects", get(api_projects).fallback(not_found))
        .route("/api/projects/{project}/issues", get(api_issue_list).post(api_create_issue).fallback(not_found))
        .route("/api/projects/{project}/issues/{number}", get(api_issue).patch(api_update_issue).fallback(not_found))
        .route("/api/projects/{project}/issues/{number}/comments", post(api_create_comment).fallback(not_found))
        .route("/api/search", get(api_search).fallback(not_found))
        .route("/api/users/{login}", get(api_user).fallback(not_found))
        .route("/api/admin/stats", get(api_admin_stats).fallback(not_found))
        .fallback(not_found)
        .with_state(Arc::new(App { pool }));
    let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{}", variable("PORT", "3000"))).await.unwrap();
    println!("listening {}", listener.local_addr().unwrap().port());
    let listener = listener.tap_io(|connection| {
        let _ = connection.set_nodelay(true);
    });
    axum::serve(listener, app).await.unwrap();
}
