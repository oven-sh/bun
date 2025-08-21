package main

import (
	"database/sql"
	"fmt"
	"log"
	"math/rand"
	"sync"
	"time"

	_ "github.com/go-sql-driver/mysql"
)

func main() {
	// Connect to MySQL
	db, err := sql.Open("mysql", "root:@tcp(localhost:3306)/test")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	// Test connection
	if err := db.Ping(); err != nil {
		log.Fatal(err)
	}

	// Create the table if it doesn't exist
	createTableQuery := `
		CREATE TABLE IF NOT EXISTS users_bun_bench (
			id INT AUTO_INCREMENT PRIMARY KEY,
			first_name VARCHAR(255) NOT NULL,
			last_name VARCHAR(255) NOT NULL,
			email VARCHAR(255) NOT NULL UNIQUE,
			dob DATE NOT NULL
		)`
	if _, err := db.Exec(createTableQuery); err != nil {
		log.Fatal(err)
	}

	// Check if users already exist
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM users_bun_bench").Scan(&count); err != nil {
		log.Fatal(err)
	}

	if count < 100 {
		// Generate and insert 100 users
		tx, err := db.Begin()
		if err != nil {
			log.Fatal(err)
		}

		stmt, err := tx.Prepare("INSERT INTO users_bun_bench (first_name, last_name, email, dob) VALUES (?, ?, ?, ?)")
		if err != nil {
			log.Fatal(err)
		}
		defer stmt.Close()

		for i := 0; i < 100; i++ {
			firstName := fmt.Sprintf("FirstName%d", i)
			lastName := fmt.Sprintf("LastName%d", i)
			email := fmt.Sprintf("user%d@example.com", i)
			year := 1970 + (i % 30)
			month := 1 + (i % 12)
			day := 1 + (i % 28)
			dob := fmt.Sprintf("%04d-%02d-%02d", year, month, day)

			if _, err := stmt.Exec(firstName, lastName, email, dob); err != nil {
				log.Fatal(err)
			}
		}

		if err := tx.Commit(); err != nil {
			log.Fatal(err)
		}
	}

	// Benchmark: Run 100,000 SELECT queries
	start := time.Now()
	const totalQueries = 100_000
	const batchSize = 100
	var wg sync.WaitGroup
	
	for batchStart := 0; batchStart < totalQueries; batchStart += batchSize {
		tasks := make([]func(), batchSize)
		
		for j := 0; j < batchSize; j++ {
			tasks[j] = func() {
				rows, err := db.Query("SELECT * FROM users_bun_bench LIMIT 100")
				if err != nil {
					log.Fatal(err)
				}
				rows.Close()
			}
		}
		
		// Execute batch
		for _, task := range tasks {
			wg.Add(1)
			go func(t func()) {
				defer wg.Done()
				t()
			}(task)
		}
		
		// Wait for this batch to complete
		wg.Wait()
	}

	elapsed := time.Since(start)
	fmt.Printf("Go (go-sql-driver/mysql): %.2fms\n", float64(elapsed.Nanoseconds())/1000000.0)
}