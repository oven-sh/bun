# A backend on Bun.serve and Bun.sql

`app/` is ordinary, fully typed TypeScript: no casts, nothing written for a compiler. The same source runs under `bun run`, under `bun build --compile` and under `bun build --compile --aot`.

| Route | What it does |
| --- | --- |
| `/plaintext` | `Hello, World!` |
| `/json` | `{"message":"Hello, World!"}`, made for each request |
| `/db` | one row of `world`, drawn at random |
| `/queries?queries=n` | n rows, each by a query of its own (1 to 500) |
| `/fortunes` | all rows of `fortune` and one more, sorted by message, as escaped HTML |
| `/updates?queries=n` | n rows read, each given a new random number, written back |
| `GET /api/shops/:shop/products/:id` | one product |
| `POST /api/shops/:shop/quotes` | prices an order: a session, a body validated with zod, two queries at once, and a `fetch` to another HTTP service (`app/carrier.ts`) |

The first six are the test types of the [TechEmpower Framework Benchmarks](https://github.com/TechEmpower/FrameworkBenchmarks/wiki/Project-Information-Framework-Tests-Overview), by their rules.

| Path | What it is |
| --- | --- |
| `app/` | the application |
| `schema.sql` | the tables and their rows |
| `answers.ts` | computes every right answer from the rules and from `schema.sql` alone |
| `backend.test.ts` | the test |
| `rivals/go`, `rivals/rust` | the same routes in Go (net/http, pgx) and Rust (axum, tokio-postgres) |
| `tracker/` | a second application. See [`tracker/README.md`](tracker/README.md) |

## Run

```sh
AOT_BACKEND=1 bun bd test test/aot/backend
```

The test builds `app/server.ts` with `--aot`, starts it and compares what it answers with `answers.ts`. Without `AOT_BACKEND` it is skipped.

It needs Postgres. `AOT_BACKEND_DATABASE_URL=postgres://..` names a database that `schema.sql` may fill. Without it the test uses the container that `test/js/sql` uses. `AOT_BACKEND_MODULES=<a node_modules folder>` uses packages that are already installed, so nothing is downloaded.

## Add a route

Add it to `app/`, compute its answer in `answers.ts`, and add it to both rivals so that all three still answer the same.
