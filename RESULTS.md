# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-27 (fresh re-run)
- Ziggit: v0.2.0 built from /root/ziggit (commit 0b77ad4), ReleaseFast
- Bun: 1.3.11 (stock, af24e281), fork branch: ziggit-integration
- Machine: Linux x86_64, 483MB RAM, 1 vCPU
- Git: 2.43.0, Zig: 0.15.2
- Build: `zig build -Doptimize=ReleaseFast`

## Build Status

Full bun fork binary **cannot be built** on this VM (needs 8GB+ RAM, 20GB+ disk).
`build.zig` correctly wires ziggit as `../ziggit` path dependency.
Benchmarks compare stock bun + git CLI vs ziggit CLI/library to measure replaceable operations.

## Stock Bun Install (5 Git Dependencies)

| Metric | Cold Cache | Warm Cache |
|--------|-----------|------------|
| Run 1 | 517ms | 22ms |
| Run 2 | 610ms | 21ms |
| Run 3 | 372ms | 22ms |
| **Median** | **517ms** | **22ms** |

Package: 5 git deps (`@sindresorhus/is`, `express`, `chalk`, `debug`, `semver`) → 69 total packages installed.

## Remote Clone: Git CLI vs Ziggit (depth=1)

3 runs each, median reported.

| Repo | git clone (ms) | ziggit clone (ms) | git total (ms) | ziggit total (ms) | Speedup |
|------|---------------:|------------------:|---------------:|-------------------:|--------:|
| debug | 125 | 70 | 127 | 73 | **1.73x** |
| node-semver | 145 | 86 | 147 | 89 | **1.65x** |
| chalk | 125 | 75 | 127 | 78 | **1.62x** |
| is | 135 | 75 | 137 | 78 | **1.75x** |
| express | 156 | 107 | 158 | 110 | **1.43x** |
| **Total** | **686** | **413** | **696** | **428** | **1.62x** |

**Average per repo: 139ms (git) → 86ms (ziggit), saving ~54ms per dependency.**

## Zig-Level Benchmarks (In-Process Library vs Git CLI)

Using `git_vs_ziggit` benchmark binary against `octocat/Hello-World`:

### Network Operations (5 iterations)

| Operation | ziggit (ms) | git CLI (ms) | Speedup |
|-----------|------------:|-------------:|--------:|
| clone (bare) | 56.9 | 102.3 | **1.80x** |
| fetch | 52.3 | 87.5 | **1.67x** |

### Local Operations (100 iterations)

| Operation | ziggit (µs) | git CLI (µs) | Speedup |
|-----------|------------:|-------------:|--------:|
| revParseHead | 59 | 1,030 | **17.6x** |
| findCommit | 57 | 1,199 | **20.9x** |
| describeTags | 51 | 1,180 | **22.9x** |

## findCommit Microbenchmark (1000 iterations, debug-js/debug repo)

| Tool | Per-call | Speedup |
|------|----------|--------:|
| ziggit (in-process) | 5.4µs | — |
| git CLI (fork+exec) | 999µs | — |
| **Speedup** | | **185x** |

## Projected Impact

| Scenario | Stock Bun | With Ziggit | Improvement |
|----------|----------:|------------:|------------:|
| Cold install (5 git deps, parallel) | 517ms | ~469ms | **~9% faster** |
| Cold install (5 git deps, serial) | ~1055ms | ~787ms | **25% faster** |
| Cold install (20 git deps, serial) | ~3140ms | ~1860ms | **41% faster** |
| findCommit per dep | 999µs | 5.4µs | **185x faster** |
| clone bare (network) | 102ms | 57ms | **1.80x faster** |

See [BUN_INSTALL_BENCHMARK.md](BUN_INSTALL_BENCHMARK.md) for full analysis and methodology.
