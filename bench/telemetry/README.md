# Tracing overhead benchmarks

`spans.mjs` — span creation from JS: `Bun.otel.tracer()` vs `@opentelemetry/sdk-trace-base`
(both with no-op exporters).

```sh
bun install
bun spans.mjs
```

`run.sh <bun> [baseline-bun]` — `Bun.serve` request cost with tracing off / on / and with the
JS SDK wired by hand (`server.js`), exporting OTLP/HTTP to a local blackhole collector
(`collector.js`). The server is pinned to one core; reports req/s, latency, and server
CPU time, instructions and cycles per request (needs `oha` and `perf`).

```sh
REPS=3 DUR=10s AWAITS=2 ./run.sh ./build/release/bun /path/to/baseline/bun
```
