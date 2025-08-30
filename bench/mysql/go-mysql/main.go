package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"sync"
	"time"

	_ "github.com/go-sql-driver/mysql"
)

type UserRow struct {
	ID        uint64
	FirstName string
	LastName  string
	Email     string
	DOB       time.Time // MySQL DATE -> time.Time (use parseTime=true)
}

func main() {
	// Rust DSN: mysql://root:bun@localhost:55034/mysql
	// Go DSN (mysql driver): user:pass@tcp(host:port)/db?params
	dsn := "root:bun@tcp(localhost:55034)/mysql?parseTime=true&interpolateParams=true"

	db, err := sql.Open("mysql", dsn)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	// --- Pool settings (cap at 10, like Rust .max_size(10)) ---
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(10)
	db.SetConnMaxLifetime(60 * time.Minute)

	// Make sure we can connect
	if err := db.Ping(); err != nil {
		log.Fatal(err)
	}

	ctx := context.Background()

	// Prepare once (Stmt is safe for concurrent use by multiple goroutines)
	stmt, err := db.PrepareContext(ctx, "SELECT * FROM users_bun_bench LIMIT 100")
	if err != nil {
		log.Fatal(err)
	}
	defer stmt.Close()

	// Workload config
	const totalJobs = 1_000_000
	// choose a reasonable worker count; you can tweak this
	workers := 10

	start := time.Now()

	// Worker pool
	jobs := make(chan struct{}, workers)
	var wg sync.WaitGroup

	runOne := func() {
		defer wg.Done()

		for range jobs {
			// Run the query and scan rows (discarding results to avoid huge memory use)
			rows, err := stmt.QueryContext(ctx)
			if err != nil {
				// Match Rust's "unwrap()" behavior by failing loudly
				log.Fatal(err)
			}

			for rows.Next() {
				var u UserRow
				if err := rows.Scan(&u.ID, &u.FirstName, &u.LastName, &u.Email, &u.DOB); err != nil {
					log.Fatal(err)
				}
			}
			if err := rows.Err(); err != nil {
				log.Fatal(err)
			}
			rows.Close()
		}
	}

	// Start workers
	wg.Add(workers)
	for i := 0; i < workers; i++ {
		go runOne()
	}

	// Enqueue jobs
	for i := 0; i < totalJobs; i++ {
		jobs <- struct{}{}
	}
	close(jobs)

	// Wait for completion
	wg.Wait()

	dur := time.Since(start)
	fmt.Printf("go-sql: %v\n", dur)
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}