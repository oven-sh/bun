# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-26T22:46Z (run 32 — ziggit 95b31d8)
- Ziggit commit: 95b31d8 (perf: increase decompression buffer to 32KB for fewer iterations in idx generation)
- Bun fork branch: ziggit-integration
- Machine: Linux (root@ziggit), 483MB RAM, 1 vCPU, Debian (minimal VM)
- Build: `zig build -Doptimize=ReleaseFast`

## Clone Benchmarks (bare clone, --depth=1)

### Sequential: 5 repos, 3 runs each

| Repo | git CLI avg | ziggit avg | Ratio |
|------|------------|-----------|-------|
| debug | 135ms | 74ms | **1.83x faster** |
| semver | 172ms | 166ms | 1.04x (even) |
| chalk | 156ms | 131ms | **1.19x faster** |
| is | 166ms | 140ms | **1.19x faster** |
| express | 198ms | 275ms | 0.72x (slower) |
| **TOTAL** | **907ms** | **859ms** | **1.06x faster** |

### Parallel: 5 repos at once, 3 runs

| Tool | Run 1 | Run 2 | Run 3 | Avg | Median |
|------|-------|-------|-------|-----|--------|
| git CLI | 369ms | 353ms | 355ms | **359ms** | **355ms** |
| ziggit | 438ms | 445ms | 442ms | **442ms** | **442ms** |

**Parallel result**: Git CLI wins (355ms vs 442ms median). Per-process overhead in ziggit CLI; in-process library would eliminate ~50ms of this gap.

## findCommit: In-Process (1000 iterations)

| Repo | git rev-parse | ziggit findCommit | Speedup |
|------|--------------|-------------------|---------|
| debug | 2,323µs | 5.4µs | **430x** |
| semver | 2,220µs | 7.9µs | **281x** |
| chalk | 2,192µs | 5.2µs | **422x** |
| is | 2,172µs | 5.2µs | **418x** |
| express | 2,249µs | 5.2µs | **432x** |
| **Average** | **2,231µs** | **5.8µs** | **~386x** |

## Bun Install Baseline (stock bun 1.3.11)

| Metric | Run 1 | Run 2 | Run 3 | Avg | Median |
|--------|-------|-------|-------|-----|--------|
| Cold install | 2,073ms | 963ms | 485ms | **1,174ms** | **963ms** |
| Warm install | 35ms | 34ms | 35ms | **35ms** | **35ms** |
| Total packages resolved | 266 | | | | |

Note: Cold Run 1 includes DNS/TLS warm-up (2,073ms). Median (963ms) most representative.

## History

| Run | Date | Ziggit SHA | Seq Total (git/zig) | findCommit speedup | Notes |
|-----|------|-----------|--------------------:|-------------------:|-------|
| 28 | 2026-03-26 | 95b31d8 | 882/856ms | 422x | baseline |
| 29 | 2026-03-26 | 95b31d8 | 903/871ms | 400x | second run |
| 30 | 2026-03-26 | 95b31d8 | 903/871ms | 400x | third run |
| 31 | 2026-03-26 | 95b31d8 | 884/844ms | 415x | re-run |
| 32 | 2026-03-26 | 95b31d8 | 907/859ms | 386x | **current** — debug 1.83x |
