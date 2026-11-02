# A backend on Bun.serve and Bun.sql

`app/` is ordinary, fully typed TypeScript: no casts, nothing written for a compiler. The same source runs under `bun run`, under
`bun build --compile` and under `bun build --compile --aot`.

| route | what it does |
|---|---|
| `/plaintext` | `Hello, World!` |
| `/json` | `{"message":"Hello, World!"}`, made for each request |
| `/db` | one row of `world`, drawn at random |
| `/queries?queries=n` | n rows, each by a query of its own (1 to 500) |
| `/fortunes` | all rows of `fortune` and one more, sorted by message, as escaped HTML |
| `/updates?queries=n` | n rows read, each given a new random number, written back |
| `GET /api/shops/:shop/products/:id` | one product |
| `POST /api/shops/:shop/quotes` | prices an order: the session of the bearer token, the body validated with zod, the customer and the products by two queries at once, shipping rates from another HTTP service (`app/carrier.ts`) with `fetch`, and about 2 KB of JSON |

The first six are the test types of the [TechEmpower Framework Benchmarks](https://github.com/TechEmpower/FrameworkBenchmarks/wiki/Project-Information-Framework-Tests-Overview), by their rules.
`rivals/go` (net/http, pgx) and `rivals/rust` (axum, tokio-postgres, deadpool, reqwest, askama, mimalloc) answer the same routes. The JSON
is the same to the byte. In the fortunes page only the spelling of the escapes differs.

## The test

`backend.test.ts` builds `app/server.ts` with `--aot` and compares what it answers with `answers.ts`, which computes every answer
from the rules and from `schema.sql` alone. It is opt-in and needs Postgres. Its first lines say how to run it.

## The benchmark

Linux, with `perf`, a C compiler, Postgres, and Go and Rust for the rivals.

```sh
psql "$DATABASE_URL" -f schema.sql                      # fills an empty database
mkdir -p out/golden && bun answers.ts out/golden        # what is right, as files
cc -O2 -pthread -o out/load measure/load.c              # the client
(cd app && bun install)
(cd app && bun build --compile --aot --target=bun ./server.ts --outfile ../out/aot)
(cd app && bun build --compile --target=bun ./server.ts --outfile ../out/jit)
(cd app && bun build --compile --target=bun ./carrier.ts --outfile ../out/carrier)
(cd rivals/go && go build -o ../../out/go .)
(cd rivals/rust && cargo build --release && cp target/release/backend ../../out/rust)

PORT=3001 taskset -c 7 out/carrier &
SERVER_CORES=0 CLIENT_CORES=4-6 CARRIER_CORES=7 CARRIER_PIDS=$! CARRIER_URL=http://127.0.0.1:3001 \
POSTGRES_CORES=8-15 POSTMASTER_PID=$(head -1 "$PGDATA/postmaster.pid") \
DATABASE_POOL=2 GO_RUN_ENV=DATABASE_POOL=16 RUST_RUN_ENV=DATABASE_POOL=16 \
  python3 measure/measure.py out out/golden out/rows.tsv json,db,queries20,fortunes,updates20,quote aot,jit,go,rust
python3 measure/table.py out/rows.tsv
```

`measure/measure.py` starts with how it measures. In short: every column is started afresh several times, warmed until its
instructions per request stand still, and then the columns are read in turn, seconds apart, so that they see the same machine.
Every response is checked. With more than one server core, a Bun column is one process per core on one port (`reusePort`), and Go
and Rust are one process that uses all of them. Pin Postgres (`taskset -c 8-15 pg_ctl start`), the client and the carrier to cores
of their own. A row says so when one of them, and not the server, was the limit.

Bun.sql sends the queries of many requests down one connection, so a small pool serves it best (2 per process). pgx and deadpool
hold a connection for the length of a request and want about 16 per core. Requests per second, latency and CPU time are read with
the hardware counters off, and instructions and cycles in windows of their own: `measure.py` says why.

Fresh and settled are two numbers. `early_requests_a_second` is the rate over the first 10,000 requests of a new process. With
`WARM_SECONDS=90` every column is loaded for that long before it is read, so that a JIT has had the time to reach its last tier, and
`rate_curve` shows where its rate stopped rising.

A column that is stopped between its windows idles, and a JIT pays for that when it goes on. `CONTINUOUS=yes` never stops anything: a
column is a fresh process under load for `WARM_SECONDS`, and its rate is the middle of all its windows from `READ_FROM` seconds on.
With `SPARE_CORES=4,5,6,7` the columns live side by side, each on a core of its own, and are read in the same weather.
`TOGETHER=aot+released+jit/aot.2+go+rust` says who lives beside whom (`aot.2` is a copy of `aot`): compare only within a group.

`LAYERS=yes` adds where a request's cycles and instructions go: the compiled application, stubs, Bun's own JavaScript modules, Bun's
native code, the engine's C++, ICU, GC, malloc, libc and the kernel, next to the same split for Go and Rust. `table.py` prints the
layers side by side and marks the layer that holds the largest part of each gap. The executables must have their symbols.

## All of it in one command

`card.py` runs every step above, for this application (`shop`) or for `tracker/`: it builds all columns, checks the responses,
measures, profiles by layer and prints the tables. Its first lines list the steps and the environment it needs.

```sh
DATABASE_URL=postgres://.. POSTMASTER_PID=$(head -1 "$PGDATA/postmaster.pid") POSTGRES_CORES=8-15 \
SERVER_CORES=0 SPARE_CORES=0,1,2,3 CLIENT_CORES=4-6 CARRIER_CORES=7 \
  python3 card.py shop --bun <bun> --released <released bun> --out out
```
