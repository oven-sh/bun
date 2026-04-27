# h3blast

A small, very fast HTTP/3 load generator built directly on **lsquic**. It exists
to stress `Bun.serve({ h3: true })` without going through curl or a Node QUIC
shim — same lsquic, same BoringSSL, same packet path as the server side.

```
  ┃ h3blast  GET 127.0.0.1:3000
  ┃ /
  ┃ 4 threads · 8 connections · 64 streams · 10.0s

  ──────────────────────────────────────────────────
    148,402 req/s
  ──────────────────────────────────────────────────

  requests   1,484,021 in 10.00s
  transfer   ↓ 18.39 MB (1.84 MB/s)   ↑ 37.98 MB

  Latency
  ──────────────────────────────────────────────────
  min     593µs
  p50     2.65ms   ▇▇▇▇▇▇▇▇
  p99     5.33ms   ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇
  max     8.97ms   ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇
```

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
./h3blast --json -d 5 https://host/ | jq .req_per_sec
```

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
| `--json`                   | machine-readable single-line summary          |
| `--no-color`, `-q`         | disable color / live UI                       |
| `H3BLAST_DEBUG=debug`      | turn on lsquic's internal logger              |

## Against a local Bun H3 server

```sh
bun test-server.js 3443 &
./h3blast -t 2 -c 4 -m 32 -d 10 https://127.0.0.1:3443/
```
