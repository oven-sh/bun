# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-27T00:15Z (fresh run)
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
| Run 1 | 488ms | 21ms |
| Run 2 | 470ms | 22ms |
| Run 3 | 390ms | 21ms |
| **Median** | **470ms** | **21ms** |

Package: 5 git deps (`@sindresorhus/is`, `express`, `chalk`, `debug`, `semver`) → 69 total packages installed.

## Remote Clone: Git CLI vs Ziggit (depth=1)

3 runs each, median reported.

| Repo | git clone (ms) | ziggit clone (ms) | git total (ms) | ziggit total (ms) | Speedup |
|------|---------------:|------------------:|---------------:|-------------------:|--------:|
| debug | 116 | 72 | 118 | 75 | **1.57x** |
| node-semver | 135 | 79 | 136 | 82 | **1.65x** |
| chalk | 127 | 85 | 129 | 87 | **1.48x** |
| is | 139 | 84 | 141 | 87 | **1.62x** |
| express | 164 | 107 | 166 | 110 | **1.50x** |
| **Total** | **681** | **427** | **690** | **441** | **1.56x** |

**Average per repo: 138ms (git) → 88ms (ziggit), saving ~50ms per dependency.**

## Zig-Level Benchmarks (In-Process Library vs Git CLI)

Using `git_vs_ziggit` benchmark binary against `octocat/Hello-World`:

### Network Operations (5 iterations)

| Operation | ziggit (ms) | git CLI (ms) | Speedup |
|-----------|------------:|-------------:|--------:|
| clone (bare) | 61.97 | 100.71 | **1.63x** |
| fetch | 58.84 | 90.16 | **1.53x** |

### Local Operations (100 iterations)

| Operation | ziggit (ms) | git CLI (ms) | Speedup |
|-----------|------------:|-------------:|--------:|
| revParseHead | 0.054 | 0.957 | **17.78x** |
| findCommit | 0.055 | 1.138 | **20.75x** |
| describeTags | 0.057 | 1.140 | **20.02x** |

### findCommit Micro-Benchmark (1000 iterations)

- Per-call: **5.2µs** (ziggit in-process) vs ~1.14ms (git CLI) = **~219x faster**

## Summary

| Metric | Value |
|--------|-------|
| Clone speedup (network) | **1.53–1.63x** |
| Per-repo clone savings (CLI) | **~50ms avg** |
| Local operation speedup | **17.8–20.8x** |
| Raw findCommit speedup | **~219x** |
| Projected cold install savings | **~249ms (52.9% of git op time)** |
| Projected cold install time | **~221ms** (down from 470ms) |
