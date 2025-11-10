
use diesel_async::pooled_connection::bb8::{Pool, RunError};
use diesel_async::pooled_connection::AsyncDieselConnectionManager;
use diesel_async::{AsyncMysqlConnection, RunQueryDsl};
use futures::future::join_all;
use diesel::sql_query;
use std::time::Instant;
use diesel::sql_types::*;
use std::time::Duration;


#[derive(Debug, diesel::QueryableByName)]
struct UserRow {
    #[diesel(sql_type = Unsigned<BigInt>)]
    id: u64,
    #[diesel(sql_type = Varchar)]
    first_name: String,
    #[diesel(sql_type = Varchar)]
    last_name: String,
    #[diesel(sql_type = Varchar)]
    email: String,
    #[diesel(sql_type = Date)]
    dob: chrono::NaiveDate,
}
#[tokio::main(flavor = "multi_thread")]
async fn main() -> Result<(), RunError> {
    let config = AsyncDieselConnectionManager::<AsyncMysqlConnection>::new(
        "mysql://root:bun@localhost:55034/mysql",

    );
    let pool = Pool::builder().connection_timeout(Duration::from_secs(36000)).max_size(10).build(config).await?;

    let start = Instant::now();

    // for i in 0..10usize {
        let tasks: Vec<_> = (0..1_000_000usize).map(|_| {
            let pool = pool.clone();
            tokio::spawn(async move {
                let mut conn = pool.get().await.unwrap();
                let rows: Vec<UserRow> = sql_query("SELECT * FROM users_bun_bench LIMIT 100")
                    .get_results(&mut conn)
                    .await.unwrap();
                Ok::<Vec<UserRow>, diesel::result::Error>(rows)
            })
        }).collect();

        // Wait for all the concurrent tasks to finish
        // let _ = join_all(tasks).await;
        for task in tasks {
            let _ = task.await;
        }
    // }
    let duration = start.elapsed();
    println!(
        "diesel-async: {:.2?}",
        duration
    );

    Ok(())
}
