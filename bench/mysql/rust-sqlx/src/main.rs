use sqlx::mysql::MySqlPool;
use sqlx::Row;
use std::time::Instant;

#[tokio::main]
async fn main() -> Result<(), sqlx::Error> {
    // Connect to MySQL with connection pool
    use sqlx::mysql::MySqlPoolOptions;
    let pool = MySqlPoolOptions::new()
        .max_connections(100)
        .acquire_timeout(std::time::Duration::from_secs(60))
        .connect("mysql://benchmark:@localhost:3306/test")
        .await?;
    
    // Create table if it doesn't exist
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS users_bun_bench (
            id INT AUTO_INCREMENT PRIMARY KEY,
            first_name VARCHAR(255) NOT NULL,
            last_name VARCHAR(255) NOT NULL,
            email VARCHAR(255) NOT NULL UNIQUE,
            dob DATE NOT NULL
        )
        "#,
    )
    .execute(&pool)
    .await?;

    // Check if users already exist
    let count_result = sqlx::query("SELECT COUNT(*) as count FROM users_bun_bench")
        .fetch_one(&pool)
        .await?;
    let count: i64 = count_result.get("count");

    if count < 100 {
        // Insert 100 users
        for i in 0..100 {
            let first_name = format!("FirstName{}", i);
            let last_name = format!("LastName{}", i);
            let email = format!("user{}@example.com", i);
            let year = 1970 + (i % 30);
            let month = 1 + (i % 12);
            let day = 1 + (i % 28);
            let dob = format!("{:04}-{:02}-{:02}", year, month, day);

            sqlx::query(
                "INSERT INTO users_bun_bench (first_name, last_name, email, dob) VALUES (?, ?, ?, ?)",
            )
            .bind(first_name)
            .bind(last_name)
            .bind(email)
            .bind(dob)
            .execute(&pool)
            .await?;
        }
    }

    // Benchmark: Run 100,000 SELECT queries (all concurrent)
    let start = Instant::now();
    const TOTAL_QUERIES: i32 = 100_000;
    
    let mut tasks = Vec::new();
    for _ in 0..TOTAL_QUERIES {
        let pool_clone = pool.clone();
        let task = tokio::spawn(async move {
            let _rows = sqlx::query("SELECT * FROM users_bun_bench LIMIT 100")
                .fetch_all(&pool_clone)
                .await;
        });
        tasks.push(task);
    }
    
    // Wait for all queries to complete
    for task in tasks {
        let _ = task.await;
    }

    let elapsed = start.elapsed();
    println!("Rust (SQLx): {:.2}ms", elapsed.as_secs_f64() * 1000.0);

    pool.close().await;
    Ok(())
}