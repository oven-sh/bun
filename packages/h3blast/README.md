# h3blast

A small, very fast HTTP/3 load generator built directly on **lsquic**. It exists
to stress `Bun.serve({ h3: true })` without going through curl or a Node QUIC
shim — same lsquic, same BoringSSL, same packet path as the server side.

```
  h3blast · HTTP/3          8 threads × 8 connections × 32 streams
  ────────────────────────────────────────────────────────────────

  static                                             406,114 req/s
  GET localhost:3001/hi
  4,061,140 requests in 10.00s            66.12 B/req · p99 1.10ms


  js                                                 172,600 req/s
  GET localhost:3001/
  1,726,000 requests in 10.00s            46.06 B/req · p99 2.44ms
```

The bytes/req figure is wire bytes received (QUIC payload — headers + body +
framing). Pass `-v` for per-target request totals, body-only bytes, total
transfer, and the full latency-percentile / status-code charts.

## Design

One process, **N worker threads**. Each worker owns one non-blocking UDP
socket, one lsquic client engine, and `connections / threads` QUIC connections.
Each connection keeps `--streams` HTTP/3 request streams in flight at all
times. UDP I/O is batched with `sendmmsg`/`recvmmsg`; the lsquic timer wheel
is driven via `epoll` + `timerfd`. The main thread samples per-worker atomic
counters at ~10 Hz to render the live TUI, then aggregates per-worker
HdrHistograms for the final percentile report.

No TLS verification by default (it's a load tester).

## Build

h3blast links the **already-compiled** lsquic / BoringSSL / HdrHistogram / zlib
object files from Bun's build tree, so you need a Bun release build first:

```sh
cd ../..               # repo root
bun run build:release  # populates build/release/obj/vendor/**
cd packages/h3blast
make                   # → ./h3blast
```

`PROFILE=debug make` links against the debug objects instead.

## Usage

```sh
./h3blast -t 4 -c 8 -m 64 -d 30 https://127.0.0.1:3000/
./h3blast -X POST -H 'content-type: application/json' -b '{"a":1}' https://host/api
./h3blast --json -d 5 https://host/ | jq '.[0].req_per_sec'

# compare two servers side-by-side — each positional is [label=]url
./h3blast -c 4 -m 32 -d 10 bun=https://127.0.0.1:3443/ node=https://127.0.0.1:3444/
```

When multiple URLs are given they are benchmarked **sequentially** (same
`-t`/`-c`/`-m`/`-d` each) so they don't compete for client CPU. The live TUI
shows finished targets above the active one; the final report has one labelled
block per target with average response-body size. The full latency-percentile
and status-code charts are only printed with `-v/--verbose`; the default report
shows just `body B/req` and `p50/p99`.

| flag                       | meaning                                       |
| -------------------------- | --------------------------------------------- |
| `-t, --threads N`          | worker threads                                |
| `-c, --connections N`      | total QUIC connections (split across threads) |
| `-m, --streams N`          | concurrent request streams per connection     |
| `-d, --duration SEC`       | run length (default 10)                       |
| `-n, --requests N`         | stop after N total responses                  |
| `-X, --method M`           | HTTP method                                   |
| `-H 'k: v'`                | extra request header (repeatable)             |
| `-b STR` / `--body-file P` | request body                                  |
| `--warmup SEC`             | ignore stats from the first SEC seconds       |
| `--json`                   | machine-readable summary (array of targets)   |
| `-v, --verbose`            | full latency/status charts in final report    |
| `--no-color`, `-q`         | disable color / live UI                       |
| `H3BLAST_DEBUG=debug`      | turn on lsquic's internal logger              |

## Against a local Bun H3 server

```sh
bun test-server.js 3443 &
./h3blast -t 2 -c 4 -m 32 -d 10 https://127.0.0.1:3443/
```
