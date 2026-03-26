# BUN INSTALL Benchmark: Stock Bun vs Ziggit Integration

**Date**: 2026-03-26T22:17Z (run 22 — fresh data, ziggit 40ad2ba)
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
| 1   | 1036ms          | 35ms                   |
| 2   | 462ms           | 34ms                   |
| 3   | 492ms           | 34ms                   |
| **Avg** | **663ms**    | **34ms**               |

> Note: Run 1 cold is higher due to DNS/TLS warmup. Runs 2-3 cold average: **477ms**.

---

## 2. Sequential Clone: Git CLI vs Ziggit (bare --depth=1)

Simulates what bun install does for each git dependency: clone + checkout.

### Per-Repo Breakdown (avg of 3 runs, ms)

| Repo | git CLI | ziggit | Speedup |
|------|---------|--------|---------|
| debug | 140ms | 77ms | **1.83x faster** |
| semver | 171ms | 167ms | 1.03x (parity) |
| chalk | 158ms | 128ms | **1.23x faster** |
| is | 170ms | 141ms | **1.21x faster** |
| express | 195ms | 271ms | 0.72x (slower) |

### Sequential Total

| Tool | Run 1 | Run 2 | Run 3 | Avg |
|------|-------|-------|-------|-----|
| git CLI | 992ms | 850ms | 872ms | **905ms** |
| ziggit | 850ms | 860ms | 853ms | **854ms** |

**Result**: Ziggit is **1.06x faster** in sequential clone (51ms saved, ~6%).

### Analysis
- **Small repos** (debug, chalk, is): ziggit wins by 20-45% — lower process startup overhead, no fork/exec of helper processes.
- **Large repos** (express): git CLI wins — express has 6000+ objects; git's highly optimized C packfile code is faster for large pack negotiation/indexing.
- **Network-dominated**: Both tools are bottlenecked by GitHub API latency (~100-150ms RTT).

---

## 3. Parallel Clone (5 repos simultaneously)

| Tool | Run 1 | Run 2 | Run 3 | Avg |
|------|-------|-------|-------|-----|
| git CLI (5 procs) | 375ms | 341ms | 348ms | **355ms** |
| ziggit (5 procs) | 424ms | 425ms | 432ms | **427ms** |

**Result**: Git CLI is **1.20x faster** in parallel.

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
| debug | 2,143µs | 4.9µs | **437x** |
| semver | 2,126µs | 9.4µs | **226x** |
| chalk | 2,118µs | 4.8µs | **441x** |
| is | 2,058µs | 4.9µs | **420x** |
| express | 2,289µs | 5.0µs | **458x** |
| **Average** | **2,147µs** | **5.8µs** | **370x** |

**Result**: Ziggit findCommit is **370x faster** than spawning `git rev-parse`.

> This is a pure in-process win. `git rev-parse` costs ~2ms due to process creation overhead (fork+exec+load). Ziggit's findCommit reads the packed-refs file directly in <10µs.

---

## 5. Projected Impact on `bun install`

### What bun install does for each git dependency:
1. **Clone/fetch** the repo (network-bound)
2. **Resolve ref** to commit SHA (findCommit / rev-parse)
3. **Extract** working tree (checkout)

### Time budget for 5 git deps (stock bun cold install: ~477ms avg)

| Phase | Stock bun (git CLI) | With ziggit (projected) | Savings |
|-------|--------------------|-----------------------|---------|
| Clone (parallel) | ~355ms | ~300ms (in-process, no fork overhead) | ~55ms |
| Ref resolution (5x) | ~10.7ms (5 × 2.1ms) | ~0.03ms (5 × 5.8µs) | **~10.7ms** |
| Checkout/extract | ~50ms | ~50ms (same) | 0ms |
| **Total git phase** | **~416ms** | **~350ms** | **~66ms (16%)** |

### Where ziggit wins in bun install:
1. **Eliminates subprocess spawns** — No fork/exec for ref resolution (370x faster per call)
2. **In-process clone** — Saves ~10-15ms per repo on process setup
3. **Shared connection pool** — Can reuse HTTP connections across repos
4. **Memory-mapped packfiles** — Direct access without index-pack subprocess

### Where ziggit needs improvement:
1. **Large repo pack indexing** — express clone is 0.72x (slower), needs optimization
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
| Sequential clone (5 repos) | 905ms | 854ms | **ziggit (1.06x)** |
| Parallel clone (5 repos) | 355ms | 427ms | git CLI (1.20x) |
| findCommit (per call) | 2,147µs | 5.8µs | **ziggit (370x)** |
| Small repo clone (debug) | 140ms | 77ms | **ziggit (1.83x)** |
| Large repo clone (express) | 195ms | 271ms | git CLI (1.39x) |

### Bottom line
- **Ziggit as a library inside bun** would save ~66ms (~16%) on cold git dependency resolution for a typical 5-dep project.
- The **370x findCommit speedup** eliminates subprocess overhead entirely.
- For projects with many small git deps, savings scale linearly.
- Large repo pack indexing is an optimization opportunity for ziggit.
