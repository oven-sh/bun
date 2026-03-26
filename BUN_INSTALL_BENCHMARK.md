# BUN INSTALL Benchmark: Stock Bun vs Ziggit Integration

**Date**: 2026-03-26T22:20Z (run 23 — fresh data, ziggit 40ad2ba)
**System**: x86_64, 483MB RAM, 1 vCPU, Debian (minimal VM)
**Bun version**: 1.3.11
**Git version**: 2.43.0
**Zig version**: 0.13.0
**Ziggit commit**: 40ad2ba (ReleaseFast build)
**Runs per test**: 3

## Test Repos (git dependencies)

| Repo | URL |
|------|-----|
| debug | github:debug-js/debug |
| node-semver | github:npm/node-semver |
| chalk | github:chalk/chalk |
| @sindresorhus/is | github:sindresorhus/is |
| express | github:expressjs/express |

---

## 1. Stock Bun Install (baseline)

Full `bun install` with 5 git dependencies (resolves 266 total packages).

| Run | Cold (no cache) | Warm (lockfile + cache) |
|-----|-----------------|------------------------|
| 1   | 1496ms          | 36ms                   |
| 2   | 798ms           | 34ms                   |
| 3   | 510ms           | 33ms                   |
| **Avg** | **935ms**    | **34ms**               |

> Note: Run 1 cold is higher due to DNS/TLS warmup. Runs 2-3 cold average: **654ms**.

---

## 2. Sequential Clone: Git CLI vs Ziggit (bare --depth=1)

Simulates what bun install does for each git dependency: clone + checkout.

### Per-Repo Breakdown (avg of 3 runs, ms)

| Repo | git CLI | ziggit | Speedup |
|------|---------|--------|---------|
| debug | 140ms | 76ms | **1.83x faster** |
| semver | 155ms | 158ms | 0.98x (parity) |
| chalk | 154ms | 125ms | **1.23x faster** |
| is | 158ms | 138ms | **1.14x faster** |
| express | 196ms | 286ms | 0.69x (slower) |

### Sequential Total

| Tool | Run 1 | Run 2 | Run 3 | Avg |
|------|-------|-------|-------|-----|
| git CLI | 896ms | 856ms | 873ms | **875ms** |
| ziggit | 849ms | 852ms | 863ms | **855ms** |

**Result**: Ziggit is **1.02x faster** in sequential clone (20ms saved, ~2%).

### Analysis
- **Small repos** (debug, chalk, is): ziggit wins by 14-83% — lower process startup overhead, no fork/exec of helper processes.
- **Large repos** (express): git CLI wins — express has 6000+ objects; git's highly optimized C packfile code is faster for large pack negotiation/indexing.
- **Network-dominated**: Both tools are bottlenecked by GitHub API latency (~100-150ms RTT).

---

## 3. Parallel Clone (5 repos simultaneously)

| Tool | Run 1 | Run 2 | Run 3 | Avg |
|------|-------|-------|-------|-----|
| git CLI (5 procs) | 355ms | 355ms | 350ms | **353ms** |
| ziggit (5 procs) | 444ms | 444ms | 447ms | **445ms** |

**Result**: Git CLI is **1.26x faster** in parallel.

### Why git wins parallel
- Each `ziggit` invocation is a separate process with its own Zig runtime init + allocator setup.
- Git's `clone` is a single well-optimized binary with minimal startup cost.
- On a 1-vCPU VM, 5 concurrent Zig processes contend more on CPU than 5 git processes.
- **In-process ziggit** (as a library inside bun) would eliminate per-process overhead entirely — this is where the real win happens.

---

## 4. findCommit: git rev-parse vs Ziggit (in-process)

This is the **killer benchmark**. During `bun install`, every git dependency needs ref→SHA resolution. Git CLI spawns a subprocess for `git rev-parse`; ziggit does it in-process.

### Per-Repo (1000 iterations, µs per call)

| Repo | git rev-parse (subprocess) | ziggit findCommit (in-process) | Speedup |
|------|---------------------------|-------------------------------|---------|
| debug | 2,189µs | 5.2µs | **421x** |
| semver | 2,190µs | 6.1µs | **359x** |
| chalk | 2,088µs | 5.5µs | **380x** |
| is | 2,112µs | 5.2µs | **406x** |
| express | 2,172µs | 5.3µs | **410x** |
| **Average** | **2,150µs** | **5.5µs** | **394x** |

**Result**: Ziggit findCommit is **394x faster** than spawning `git rev-parse`.

> This is a pure in-process win. `git rev-parse` costs ~2.1ms due to process creation overhead (fork+exec+load). Ziggit's findCommit reads the packed-refs file directly in <7µs.

---

## 5. Projected Impact on `bun install`

### What bun install does for each git dependency:
1. **Clone/fetch** the repo (network-bound)
2. **Resolve ref** to commit SHA (findCommit / rev-parse)
3. **Extract** working tree (checkout)

### Time budget for 5 git deps (stock bun cold install: ~654ms avg runs 2-3)

| Phase | Stock bun (git CLI) | With ziggit (projected) | Savings |
|-------|--------------------|-----------------------|---------|
| Clone (parallel) | ~353ms | ~300ms (in-process, no fork overhead) | ~53ms |
| Ref resolution (5x) | ~10.8ms (5 × 2.15ms) | ~0.03ms (5 × 5.5µs) | **~10.7ms** |
| Checkout/extract | ~50ms | ~50ms (same) | 0ms |
| **Total git phase** | **~414ms** | **~350ms** | **~64ms (15%)** |

### Where ziggit wins in bun install:
1. **Eliminates subprocess spawns** — No fork/exec for ref resolution (394x faster per call)
2. **In-process clone** — Saves ~10-15ms per repo on process setup
3. **Shared connection pool** — Can reuse HTTP connections across repos
4. **Memory-mapped packfiles** — Direct access without index-pack subprocess

### Where ziggit needs improvement:
1. **Large repo pack indexing** — express clone is 0.69x (slower), needs optimization
2. **Parallel throughput** — Current multi-process approach loses to git; in-process threading would fix this
3. **Warm cache path** — bun's 34ms warm install is already very fast; ziggit helps cold path only

---

## 6. Build Feasibility

### Full bun fork build
- **Not feasible on this VM** (483MB RAM, 2.6GB disk free)
- Bun requires ~8GB RAM and ~20GB disk to build from source
- Build command: `cd /root/bun-fork && zig build -Doptimize=ReleaseFast`
- Requires: Zig 0.13.0, ~30min on 8-core machine

### What was benchmarked instead
- Stock bun install (real `bun install` with git deps)
- Ziggit CLI as a drop-in replacement for git operations bun performs
- findCommit benchmark (in-process, simulates library integration)

---

## Summary

| Metric | git CLI | ziggit | Winner |
|--------|---------|--------|--------|
| Sequential clone (5 repos) | 875ms | 855ms | **ziggit (1.02x)** |
| Parallel clone (5 repos) | 353ms | 445ms | git CLI (1.26x) |
| findCommit (per call) | 2,150µs | 5.5µs | **ziggit (394x)** |
| Small repo clone (debug) | 140ms | 76ms | **ziggit (1.83x)** |
| Large repo clone (express) | 196ms | 286ms | git CLI (1.44x) |

### Bottom line
- **Ziggit as a library inside bun** would save ~64ms (~15%) on cold git dependency resolution for a typical 5-dep project.
- The **394x findCommit speedup** eliminates subprocess overhead entirely.
- For projects with many small git deps, savings scale linearly.
- Large repo pack indexing is an optimization opportunity for ziggit.
