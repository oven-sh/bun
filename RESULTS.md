# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-27T00:13Z (fresh run)
- Ziggit: built from /root/ziggit (master), ReleaseFast
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
| Run 1 | 960ms | 21ms |
| Run 2 | 444ms | 21ms |
| Run 3 | 478ms | 21ms |
| **Median** | **478ms** | **21ms** |

Package: 5 git deps (`@sindresorhus/is`, `express`, `chalk`, `debug`, `semver`) → 69 total packages installed.

## Remote Clone: Git CLI vs Ziggit (depth=1)

3 runs each, median reported.

| Repo | git clone (ms) | ziggit clone (ms) | git total (ms) | ziggit total (ms) | Speedup |
|------|---------------:|------------------:|---------------:|-------------------:|--------:|
| debug | 116 | 64 | 118 | 67 | **1.76x** |
| node-semver | 140 | 84 | 142 | 87 | **1.63x** |
| chalk | 126 | 75 | 128 | 78 | **1.64x** |
| is | 125 | 80 | 126 | 82 | **1.53x** |
| express | 168 | 110 | 170 | 113 | **1.50x** |
| **Total** | **675** | **413** | **684** | **427** | **1.60x** |

**Average per repo: 137ms (git) → 85ms (ziggit), saving ~51ms per dependency.**

## Zig-Level Benchmarks (In-Process Library vs Git CLI)

Using `git_vs_ziggit` benchmark binary against `octocat/Hello-World`:

### Network Operations (5 iterations)

| Operation | ziggit (ms) | git CLI (ms) | Speedup |
|-----------|------------:|-------------:|--------:|
| clone (bare) | 56.16 | 108.23 | **1.93x** |
| fetch | 55.77 | 87.84 | **1.58x** |

### Local Operations (100 iterations)

| Operation | ziggit (ms) | git CLI (ms) | Speedup |
|-----------|------------:|-------------:|--------:|
| revParseHead | 0.058 | 0.965 | **16.70x** |
| findCommit | 0.054 | 1.165 | **21.54x** |
| describeTags | 0.052 | 1.138 | **21.81x** |

### findCommit Micro-Benchmark (1000 iterations)

- Per-call: **5.4µs** (ziggit in-process) vs ~1.17ms (git CLI) = **~217x faster**

## Summary

| Metric | Value |
|--------|-------|
| Clone speedup (network) | **1.58–1.93x** |
| Per-repo clone savings (CLI) | **~51ms avg** |
| Local operation speedup | **16.7–21.8x** |
| Raw findCommit speedup | **~217x** |
| Projected cold install savings | **~257ms (53.7% of git op time)** |
| Projected cold install time | **~221ms** (down from 478ms) |
