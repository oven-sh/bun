use futures::future::join_all;
use sqlx::{mysql::MySqlPoolOptions, Row};
use std::time::Instant;

#[tokio::main(flavor = "multi_thread")]
async fn main() -> Result<(), sqlx::Error> {
    let db_url = "mysql://root:bun@localhost:55034/mysql";

    // Create a Tokio-backed SQLx pool with a hard cap of 10 connections.
    let pool = MySqlPoolOptions::new()
        .max_connections(10)
        .connect(&db_url)
        .await?;

    let start = Instant::now();

    let tasks: Vec<_> = (0..1_000_000usize).map(|_| {
        let pool = pool.clone();
        tokio::spawn(async move {
            sqlx::query("SELECT * FROM users_bun_bench LIMIT 100")
                .fetch_all(&pool).await
        })
    }).collect();

    for task in tasks {
        let _ = task.await;
    }

    let duration = start.elapsed();

    println!(
        "sqlx: {:.2?}",
        duration
    );


    Ok(())
}