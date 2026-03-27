# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-27T00:19Z (fresh run)
- Ziggit: v0.2.0, built from /root/ziggit (master), ReleaseFast
- Bun: 1.3.11 (stock, af24e281), fork branch: ziggit-integration
- Machine: Linux x86_64, 483MB RAM, 1 vCPU, 2GB swap
- Git: 2.39.5, Zig: 0.15.2

## Build Status

Full bun fork binary **cannot be built** on this VM (needs ≥16GB RAM, ≥30GB disk).
`build.zig` correctly wires ziggit as `../ziggit` path dependency.
Benchmarks compare stock bun + git CLI vs ziggit CLI/library to measure replaceable operations.

## Stock Bun Install (5 Git Dependencies)

| Metric | Cold Cache | Warm Cache |
|--------|-----------|------------|
| Run 1 | 355ms | 23ms |
| Run 2 | 450ms | 22ms |
| Run 3 | 682ms | 22ms |
| **Median** | **450ms** | **22ms** |

Package: 5 git deps (`@sindresorhus/is`, `express`, `chalk`, `debug`, `semver`) → 69 total packages installed.

## Remote Clone: Git CLI vs Ziggit (depth=1)

3 runs each, median reported.

| Repo | git clone (ms) | ziggit clone (ms) | git total (ms) | ziggit total (ms) | Speedup |
|------|---------------:|------------------:|---------------:|-------------------:|--------:|
| debug | 134 | 73 | 136 | 76 | **1.78x** |
| node-semver | 135 | 84 | 137 | 86 | **1.59x** |
| chalk | 128 | 77 | 130 | 79 | **1.64x** |
| is | 127 | 90 | 129 | 93 | **1.38x** |
| express | 172 | 108 | 174 | 110 | **1.58x** |
| **Total** | **696** | **432** | **706** | **444** | **1.59x** |

**Average per repo: 141ms (git) → 89ms (ziggit), saving ~52ms per dependency.**

## Zig-Level Benchmarks (In-Process Library vs Git CLI)

Using `git_vs_ziggit` benchmark binary against `octocat/Hello-World`:

### Network Operations (5 iterations)

| Operation | ziggit (ms) | git CLI (ms) | Speedup |
|-----------|------------:|-------------:|--------:|
| clone (bare) | 61.54 | 97.86 | **1.59x** |
| fetch | 56.86 | 88.95 | **1.56x** |

### Local Operations (100 iterations)

| Operation | ziggit (ms) | git CLI (ms) | Speedup |
|-----------|------------:|-------------:|--------:|
| revParseHead | 0.056 | 0.997 | **17.78x** |
| findCommit | 0.054 | 1.157 | **21.24x** |
| describeTags | 0.052 | 1.155 | **22.36x** |

### findCommit Micro-Benchmark (1000 iterations)

- Per-call: **4.9µs** (ziggit in-process) vs ~1.16ms (git CLI) = **~237x faster**

## Summary

| Metric | Value |
|--------|-------|
| Clone speedup (network) | **1.56–1.59x** |
| Per-repo clone savings (CLI) | **~52ms avg** |
| Local operation speedup | **17.8–22.4x** |
| Raw findCommit speedup | **~237x** |
| Projected cold install savings | **~262ms (58.2% of git op time)** |
| Projected cold install time | **~188ms** (down from 450ms) |
