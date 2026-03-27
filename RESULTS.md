# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-26 (re-run with fresh measurements)
- Ziggit: v0.2.0 built from /root/ziggit (commit 1fb34b1), ReleaseFast
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
| Run 1 | 305ms | 27ms |
| Run 2 | 439ms | 29ms |
| Run 3 | 368ms | 27ms |
| **Median** | **368ms** | **27ms** |

Package: 5 git deps (`@sindresorhus/is`, `express`, `chalk`, `debug`, `semver`) → 69 total packages installed.

## Remote Clone: Git CLI vs Ziggit (depth=1)

3 runs each, median reported.

| Repo | git clone (ms) | ziggit clone (ms) | git total (ms) | ziggit total (ms) | Speedup |
|------|---------------:|------------------:|---------------:|-------------------:|--------:|
| debug | 123 | 66 | 125 | 70 | **1.78x** |
| node-semver | 142 | 85 | 145 | 88 | **1.64x** |
| chalk | 131 | 71 | 133 | 73 | **1.82x** |
| is | 134 | 80 | 136 | 83 | **1.63x** |
| express | 166 | 107 | 168 | 110 | **1.52x** |
| **Total** | **696** | **409** | **707** | **424** | **1.66x** |

**Average per repo: 141ms (git) → 85ms (ziggit), saving ~57ms per dependency.**

## Zig-Level Benchmarks (In-Process Library vs Git CLI)

Using `git_vs_ziggit` benchmark binary against `octocat/Hello-World`:

### Network Operations (5 iterations)

| Operation | ziggit (ms) | git CLI (ms) | Speedup |
|-----------|------------:|-------------:|--------:|
| clone (bare) | 57.4 | 93.0 | **1.62x** |
| fetch | 53.6 | 85.5 | **1.60x** |

### Local Operations (100 iterations)

| Operation | ziggit (µs) | git CLI (µs) | Speedup |
|-----------|------------:|-------------:|--------:|
| revParseHead | 53 | 950 | **17.9x** |
| findCommit | 53 | 1,117 | **21.1x** |
| describeTags | 53 | 1,121 | **21.2x** |

## findCommit Microbenchmark (1000 iterations, debug-js/debug repo)

| Tool | Per-call | Speedup |
|------|----------|--------:|
| ziggit (in-process) | 5.2µs | — |
| git CLI (fork+exec) | 994µs | — |
| **Speedup** | | **191x** |

## Projected Impact

| Scenario | Stock Bun | With Ziggit | Improvement |
|----------|----------:|------------:|------------:|
| Cold install (5 git deps, parallel) | 368ms | ~310ms | **~16% faster** |
| Cold install (5 git deps, serial) | ~907ms | ~624ms | **31% faster** |
| Cold install (20 git deps, serial) | ~3000ms | ~1900ms | **37% faster** |
| findCommit per dep | 994µs | 5.2µs | **191x faster** |
| clone bare (network) | 93ms | 57ms | **1.62x faster** |

See [BUN_INSTALL_BENCHMARK.md](BUN_INSTALL_BENCHMARK.md) for full analysis and methodology.
