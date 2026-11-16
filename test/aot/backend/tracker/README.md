# An issue tracker on Bun.serve and Bun.sql, and the same in Go and in Rust

`app/` is a web application of 2,000 lines of strict TypeScript on `Bun.serve` and `Bun.sql`, with no framework and no package. It serves HTML pages and a JSON API for projects, issues, comments, search, users and sessions. `app/server.ts` lists the routes. Nothing in it is written for a compiler.

`rivals/go` (net/http, pgx) and `rivals/rust` (axum, tokio-postgres) are the same application: the same routes, the same SQL, the same bytes in every response.

## Build and compare

You need Postgres, and Go and Cargo for the rivals. `schema.sql` fills a database with 30,000 issues and 348,000 comments, 330 MB, in about a minute.

```sh
psql "$DATABASE_URL" -f schema.sql
(cd app && bun build --compile --aot --target=bun ./server.ts --outfile ../out/aot)
(cd app && bun build --compile --target=bun ./server.ts --outfile ../out/jit)
(cd rivals/go && go build -o ../../out/go .)
(cd rivals/rust && cargo build --release && cp target/release/tracker ../../out/rust)
```

A server reads `PORT`, `DATABASE_URL` and `DATABASE_POOL`. `exchanges.ts` holds about 4,000 requests to every route, with the rare cases and a sequence that writes. It sends each one to every server and prints where two responses differ. Because some requests write, give each server its own copy of the database (`CREATE DATABASE <copy> TEMPLATE <filled>`).

```sh
bun exchanges.ts compare aot=3001 go=3002 rust=3003
```

## Microbenchmarks

`pieces/` runs what one request computes in a loop, with no socket and no database. Each run prints how many bytes one round produced, which is the same in all three languages.

```sh
psql "$DATABASE_URL" -tA -f pieces/export.sql > out/issues.txt
(cd pieces && bun build --compile --aot --target=bun ./main.ts --outfile ../out/pieces-aot)
perf stat -e instructions:u,cycles:u out/pieces-aot page out/issues.txt 1000
```

`main.rs` is the `pieces` binary of `rivals/rust`. `main.go` is built with the files of `rivals/go` in place of its `main.go`. `pieces/loops/` has the inner loops of encoders and scanners, again in three languages. The top of each `main.ts` lists its modes.
