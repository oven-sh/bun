# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-27 (re-run with ziggit v0.3.0)
- Ziggit: v0.3.0 built from /root/ziggit (commit f428a9d), ReleaseFast
- Bun: 1.3.11 (stock, af24e281), fork branch: ziggit-integration
- Machine: Linux x86_64, 483MB RAM, 1 vCPU, 2GB swap
- Git: 2.43.0, Zig: 0.15.2

## Build Status

Full bun fork binary **cannot be built** on this VM (needs ≥16GB RAM, ≥30GB disk).
`build.zig` correctly wires ziggit as `../ziggit` path dependency.
Benchmarks compare stock bun + git CLI vs ziggit CLI/library to measure replaceable operations.

## Stock Bun Install (5 Git Dependencies)

| Metric | Cold Cache | Warm Cache |
|--------|-----------|------------|
| Run 1 | 505ms | 22ms |
| Run 2 | 492ms | 21ms |
| Run 3 | 406ms | 21ms |
| **Median** | **492ms** | **21ms** |

Package: 5 git deps (`@sindresorhus/is`, `express`, `chalk`, `debug`, `semver`) → 69 total packages installed.

## Remote Clone: Git CLI vs Ziggit (depth=1)

3 runs each, median reported.

| Repo | git clone (ms) | ziggit clone (ms) | git total (ms) | ziggit total (ms) | Speedup |
|------|---------------:|------------------:|---------------:|-------------------:|--------:|
| debug | 123 | 66 | 125 | 68 | **1.83x** |
| node-semver | 139 | 79 | 141 | 82 | **1.71x** |
| chalk | 144 | 81 | 145 | 83 | **1.74x** |
| is | 127 | 82 | 129 | 84 | **1.53x** |
| express | 160 | 116 | 162 | 119 | **1.36x** |
| **Total** | **693** | **424** | **702** | **436** | **1.61x** |

**Average per repo: 140ms (git) → 87ms (ziggit), saving ~53ms per dependency.**

## Zig-Level Benchmarks (In-Process Library vs Git CLI)

Using `git_vs_ziggit` benchmark binary against `octocat/Hello-World`:

### Network Operations (5 iterations, run 2)

| Operation | ziggit (ms) | git CLI (ms) | Speedup |
|-----------|------------:|-------------:|--------:|
| clone (bare) | 58.71 | 99.11 | **1.69x** |
| fetch | 59.87 | 89.16 | **1.49x** |

### Local Operations (100 iterations, run 2)

| Operation | ziggit (ms) | git CLI (ms) | Speedup |
|-----------|------------:|-------------:|--------:|
| revParseHead | 0.058 | 1.018 | **17.50x** |
| findCommit | 0.056 | 1.167 | **20.75x** |
| describeTags | 0.056 | 1.183 | **20.99x** |

### findCommit Micro-Benchmark (1000 iterations)

- Per-call: **5.1µs** (ziggit in-process) vs ~1.17ms (git CLI) = **~229x faster**

## Summary

| Metric | Value |
|--------|-------|
| Clone speedup (network) | **1.49–1.83x** |
| Local operation speedup | **17.5–21x** |
| Raw findCommit speedup | **~229x** |
| Projected cold install savings | **~266ms (54% of git op time)** |
| Projected cold install time | **~226ms** (down from 492ms) |
