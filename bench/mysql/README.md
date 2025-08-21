# 🔥 MySQL Performance Battle Royale

A comprehensive benchmark comparing MySQL database performance across different runtimes and libraries. This benchmark is designed to settle the performance debate once and for all with **equivalent implementations** across all platforms.

## 🎯 The Challenge

Each runtime performs **exactly the same work**:
- **100,000 SELECT queries** with `LIMIT 100` 
- **Identical database schema** and test data
- **Same query pattern**: `SELECT * FROM users_bun_bench LIMIT 100`
- **Same batching strategy**: 100 queries per batch, await batch completion
- **Same connection configuration**: localhost MySQL, no pooling

## 🚀 Quick Start

**Run the complete benchmark suite:**
```bash
# Prerequisites: MySQL server running on localhost:3306 with 'test' database

# Install dependencies 
bun install
go mod tidy
cargo build --release --manifest-path=./rust-sqlx/Cargo.toml

# Run all benchmarks
bun run-all-benchmarks.mjs
```

This generates a comprehensive markdown report with performance comparisons and statistical analysis.

## 📋 Benchmark Implementations

### JavaScript Runtimes
- **Bun + MySQL2**: `bun ./index.mjs` - Bun runtime with mysql2 driver
- **Node.js + MySQL2**: `node ./index-mysql2.mjs` - Node.js runtime with mysql2 driver

### Native Languages  
- **Rust + SQLx**: `cargo run --release --manifest-path=./rust-sqlx/Cargo.toml` - Native Rust with SQLx async MySQL driver
- **Go + Native**: `go run main.go` - Native Go with go-sql-driver/mysql

## ⚙️ Implementation Equivalency

All benchmarks follow **identical patterns** to ensure fair comparison:

### Data Setup
```sql
CREATE TABLE users_bun_bench (
  id INT AUTO_INCREMENT PRIMARY KEY,
  first_name VARCHAR(255) NOT NULL,
  last_name VARCHAR(255) NOT NULL, 
  email VARCHAR(255) NOT NULL UNIQUE,
  dob DATE NOT NULL
);

-- Insert exactly 100 users with deterministic data
-- FirstName0-99, LastName0-99, user0-99@example.com
-- DOB: 1970-2000 range using modulo arithmetic for consistency
```

### Benchmark Loop
```
FOR batch = 0 to 1000 (100 batches total):
  CREATE 100 promises/tasks for: SELECT * FROM users_bun_bench LIMIT 100  
  AWAIT all 100 promises complete
  REPEAT
```

### Connection Configuration
- **Host**: localhost
- **Port**: 3306  
- **User**: root
- **Password**: (empty)
- **Database**: test
- **No connection pooling** (single connection per runtime)

## 📊 Individual Benchmarks

Run benchmarks individually for testing:

```bash
# JavaScript versions
bun ./index.mjs              # Bun + MySQL2
node ./index-mysql2.mjs      # Node.js + MySQL2

# Native versions  
go run main.go               # Go + go-sql-driver
cargo run --release --manifest-path=./rust-sqlx/Cargo.toml  # Rust + SQLx
```

## 🧪 Methodology

### Fair Comparison Principles
1. **Same Query**: All runtimes execute identical SQL
2. **Same Data**: Deterministic test dataset (no randomization)  
3. **Same Batching**: 100 queries per batch, synchronous batch completion
4. **Same Connection**: Single connection, no pooling, same MySQL config
5. **Same Hardware**: All tests run on the same machine
6. **Multiple Runs**: 3 iterations per benchmark for statistical validity

### Libraries Chosen
- **mysql2**: Most popular Node.js MySQL driver (2.7M+ weekly downloads)
- **SQLx**: Most popular Rust database toolkit (async, compile-time checked)
- **go-sql-driver/mysql**: Official Go MySQL driver

### Measurements
- **Precision**: High-resolution timers (`performance.now()`, `time.Now()`, `Instant::now()`)
- **Scope**: Total time for all 100,000 queries (including batching overhead)
- **Statistics**: Average, min, max, standard deviation across runs

## 🔧 Prerequisites

### Required Software
- **MySQL Server**: v5.7+ running on localhost:3306
- **Bun**: Latest version
- **Node.js**: v18+
- **Rust**: Latest stable with Cargo  
- **Go**: v1.21+

### Database Setup
```sql
-- Create test database (if not exists)
CREATE DATABASE IF NOT EXISTS test;

-- Ensure root user can connect
-- Default: mysql -u root -p (empty password)
```

The benchmark will automatically:
- Create the `users_bun_bench` table
- Populate 100 test records (if not present)
- Verify data consistency before each run

## 📈 Expected Results

Based on typical performance characteristics:

| Runtime | Expected Range | Strengths |
|---------|----------------|-----------|
| **Bun** | 🔥 Fastest | Superior JS engine, optimized I/O |
| **Rust** | ⚡ Very Fast | Zero-cost abstractions, memory efficiency |
| **Go** | 🏃 Fast | Efficient goroutines, solid stdlib |
| **Node.js** | 🐌 Baseline | V8 JIT, but slower than Bun |

*Note: Actual results depend on hardware, MySQL configuration, and network conditions.*

## 🎭 The Verdict Awaits...

Will Bun's "blazingly fast" claims hold up against native Rust? Can Go's simplicity compete with JavaScript's async prowess? 

**Run the benchmark to find out!** 🏆

---

*This benchmark is designed to be controversial, comprehensive, and conclusive. May the fastest runtime win.* 🔥