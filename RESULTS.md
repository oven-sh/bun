# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-27 (fresh run)
- Ziggit: v0.2.0 built from /root/ziggit (commit d22bd5f), ReleaseFast
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
| Run 1 | 2815ms* | 22ms |
| Run 2 | 366ms | 21ms |
| Run 3 | 339ms | 21ms |
| **Median** | **366ms** | **21ms** |

\* Run 1 includes DNS/TLS warm-up.

Package: 5 git deps (`@sindresorhus/is`, `express`, `chalk`, `debug`, `semver`) → 69 total packages installed.

## Remote Clone: Git CLI vs Ziggit (depth=1)

3 runs each, median reported.

| Repo | git clone (ms) | ziggit clone (ms) | git total (ms) | ziggit total (ms) | Speedup |
|------|---------------:|------------------:|---------------:|-------------------:|--------:|
| debug | 118 | 73 | 120 | 76 | **1.57x** |
| node-semver | 134 | 86 | 136 | 88 | **1.54x** |
| chalk | 140 | 86 | 142 | 89 | **1.59x** |
| is | 132 | 93 | 134 | 96 | **1.39x** |
| express | 174 | 120 | 176 | 123 | **1.43x** |
| **Total** | **698** | **458** | **708** | **472** | **1.50x** |

**Average per repo: 142ms (git) → 94ms (ziggit), saving ~47ms per dependency.**

## Zig-Level Benchmarks (In-Process Library vs Git CLI)

Using `git_vs_ziggit` benchmark binary against `octocat/Hello-World`:

### Network Operations (5 iterations)

| Operation | ziggit (ms) | git CLI (ms) | Speedup |
|-----------|------------:|-------------:|--------:|
| clone (bare) | 58.20 | 100.11 | **1.72x** |
| fetch | 59.50 | 87.72 | **1.47x** |

### Local Operations (100 iterations)

| Operation | ziggit (ms) | git CLI (ms) | Speedup |
|-----------|------------:|-------------:|--------:|
| revParseHead | 0.053 | 0.952 | **17.96x** |
| findCommit | 0.053 | 1.132 | **21.37x** |
| describeTags | 0.051 | 1.126 | **21.93x** |

### findCommit Micro-Benchmark (1000 iterations)

- Per-call: **5.0µs** (ziggit in-process) vs ~1.1ms (git CLI) = **~220x faster**

## Summary

| Metric | Value |
|--------|-------|
| Clone speedup (network) | **1.50–1.72x** |
| Local operation speedup | **18–22x** |
| Raw findCommit speedup | **~220x** |
| Projected cold install savings | **~236ms (64% of git op time)** |
| Projected cold install time | **~130ms** (down from 366ms) |
