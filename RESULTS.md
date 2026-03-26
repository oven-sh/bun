# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-26 (latest benchmark run)
- Ziggit: built from /root/ziggit (commit 03fbacf), ReleaseFast
- Bun: 1.3.11 (stock), fork branch: ziggit-integration
- Machine: Linux x86_64, 483MB RAM, 1 vCPU
- Git: 2.43.0, Zig: 0.15.2
- Build: `zig build -Doptimize=ReleaseFast`

## Build Status

Full bun fork binary **cannot be built** on this VM (needs 8GB+ RAM, 20GB+ disk).
`build.zig` correctly wires ziggit as `../ziggit` path dependency.
Benchmarks compare stock bun + git CLI vs ziggit CLI to measure replaceable operations.

## Stock Bun Install (5 Git Dependencies)

| Metric | Cold Cache | Warm Cache |
|--------|-----------|------------|
| Run 1 | 1073ms | 24ms |
| Run 2 | 316ms | 22ms |
| Run 3 | 809ms | 22ms |
| **Median** | **809ms** | **22ms** |

Package: 5 git deps (`@sindresorhus/is`, `express`, `chalk`, `debug`, `semver`) → 69 total packages installed.

## Remote Clone: Git CLI vs Ziggit (depth=1)

3 runs each, median reported.

| Repo | git clone (ms) | ziggit clone (ms) | git total (ms) | ziggit total (ms) | Speedup |
|------|---------------:|------------------:|---------------:|-------------------:|--------:|
| debug | 124 | 65 | 126 | 68 | **1.85x** |
| node-semver | 134 | 84 | 136 | 87 | **1.56x** |
| chalk | 135 | 79 | 136 | 81 | **1.67x** |
| is | 135 | 77 | 137 | 79 | **1.73x** |
| express | 165 | 108 | 167 | 110 | **1.51x** |
| **Total** | **693** | **413** | **702** | **425** | **1.65x** |

**Average per repo: 140ms (git) → 85ms (ziggit), saving ~55ms per dependency.**

## findCommit: In-Process Ref Resolution (193× Speedup)

*1000 iterations per repo, ReleaseFast, bare repos with shallow clones.*

| Repo | git rev-parse (CLI) | ziggit findCommit (lib) | Speedup |
|------|--------------------:|------------------------:|--------:|
| debug | 1,020µs | 5.5µs | **185x** |
| node-semver | 1,016µs | 5.5µs | **185x** |
| chalk | 1,021µs | 5.1µs | **200x** |
| express | 1,019µs | 5.0µs | **204x** |
| **Average** | **1,019µs** | **5.3µs** | **~193x** |

## Projected Impact

| Scenario | Stock Bun | With Ziggit | Improvement |
|----------|----------:|------------:|------------:|
| Cold install (5 git deps) | 809ms | ~532ms | **34.2% faster** |
| findCommit per dep | 1,019µs | 5.3µs | **193x faster** |
| Git clone per dep | 140ms | 85ms | **1.65x faster** |

See [BUN_INSTALL_BENCHMARK.md](BUN_INSTALL_BENCHMARK.md) for full analysis.
