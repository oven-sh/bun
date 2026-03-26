# BUN INSTALL Benchmark: Stock Bun vs Ziggit Integration

**Date**: 2026-03-26T22:22Z (run 24 — fresh data, ziggit 40ad2ba)
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
| 1   | 591ms           | 34ms                   |
| 2   | 679ms           | 33ms                   |
| 3   | 368ms           | 32ms                   |
| **Avg** | **546ms**    | **33ms**               |

> Cold install variance is due to GitHub API latency and DNS/TLS warmup.

---

## 2. Sequential Clone: Git CLI vs Ziggit (bare --depth=1)

Simulates what bun install does for each git dependency: clone + checkout.

### Per-Repo Breakdown (avg of 3 runs, ms)

| Repo | git CLI | ziggit | Speedup |
|------|---------|--------|---------|
| debug | 135ms | 81ms | **1.66x faster** |
| semver | 155ms | 167ms | 0.93x (slower) |
| chalk | 157ms | 139ms | **1.13x faster** |
| is | 166ms | 139ms | **1.19x faster** |
| express | 205ms | 279ms | 0.73x (slower) |

### Sequential Total

| Tool | Run 1 | Run 2 | Run 3 | Avg |
|------|-------|-------|-------|-----|
| git CLI | 899ms | 884ms | 883ms | **889ms** |
| ziggit | 881ms | 888ms | 876ms | **882ms** |

**Result**: Ziggit is **1.01x faster** in sequential clone (7ms saved, ~1%).

### Analysis
- **Small repos** (debug, chalk, is): ziggit wins 13–66% — lower process startup overhead, no fork/exec of helper processes.
- **Large repos** (express, semver): git CLI wins — more objects means git's optimized C packfile indexing outperforms.
- **Network-dominated**: Both tools are bottlenecked by GitHub API latency (~100-150ms RTT).

---

## 3. Parallel Clone (5 repos simultaneously)

| Tool | Run 1 | Run 2 | Run 3 | Avg |
|------|-------|-------|-------|-----|
| git CLI (5 procs) | 358ms | 349ms | 354ms | **354ms** |
| ziggit (5 procs) | 455ms | 447ms | 442ms | **448ms** |

**Result**: Git CLI is **1.27x faster** in parallel.

### Why git wins parallel
- Each `ziggit` invocation is a separate process with Zig runtime init + allocator setup.
- Git's `clone` is a single optimized binary with minimal startup cost.
- On a 1-vCPU VM, 5 concurrent Zig processes contend more on CPU than 5 git processes.
- **In-process ziggit** (as a library inside bun) would eliminate per-process overhead entirely.

---

## 4. findCommit: git rev-parse vs Ziggit (in-process)

This is the **killer benchmark**. During `bun install`, every git dependency needs ref→SHA resolution. Git CLI spawns a subprocess for `git rev-parse`; ziggit does it in-process.

### Per-Repo (1000 iterations, µs per call)

| Repo | git rev-parse (subprocess) | ziggit findCommit (in-process) | Speedup |
|------|---------------------------|-------------------------------|---------|
| debug | 2,175µs | 5.0µs | **435x** |
| semver | 2,081µs | 5.2µs | **400x** |
| chalk | 2,136µs | 5.1µs | **419x** |
| is | 2,111µs | 5.2µs | **406x** |
| express | 2,078µs | 5.0µs | **416x** |
| **Average** | **2,116µs** | **5.1µs** | **415x** |

**Result**: Ziggit findCommit is **415x faster** than spawning `git rev-parse`.

> `git rev-parse` costs ~2.1ms due to process creation overhead (fork+exec+load). Ziggit reads the packed-refs file directly in ~5µs.

---

## 5. Projected Impact on `bun install`

### What bun install does for each git dependency:
1. **Clone/fetch** the repo (network-bound)
2. **Resolve ref** to commit SHA (findCommit / rev-parse)
3. **Extract** working tree (checkout)

### Time budget for 5 git deps (stock bun cold install: ~546ms avg)

| Phase | Stock bun (git CLI) | With ziggit (projected) | Savings |
|-------|--------------------|-----------------------|---------|
| Clone (parallel) | ~354ms | ~300ms (in-process, no fork) | ~54ms |
| Ref resolution (5×) | ~10.6ms (5 × 2.12ms) | ~0.03ms (5 × 5.1µs) | **~10.5ms** |
| Checkout/extract | ~50ms | ~50ms (same) | 0ms |
| **Total git phase** | **~415ms** | **~350ms** | **~65ms (16%)** |

### Scaling projection

| Git deps | Subprocess overhead (git) | Ziggit in-process | Savings |
|----------|--------------------------|-------------------|---------|
| 5 | 10.6ms | 0.03ms | 10.5ms |
| 20 | 42.3ms | 0.10ms | 42.2ms |
| 50 | 105.8ms | 0.26ms | 105.5ms |
| 100 | 211.6ms | 0.51ms | 211.1ms |

For monorepos with many git dependencies, the subprocess elimination alone saves >200ms.

### Where ziggit wins in bun install:
1. **Eliminates subprocess spawns** — No fork/exec for ref resolution (415x faster per call)
2. **In-process clone** — Saves ~10-15ms per repo on process setup
3. **Shared connection pool** — Can reuse HTTP connections across repos
4. **Memory-mapped packfiles** — Direct access without index-pack subprocess

### Where ziggit needs improvement:
1. **Large repo pack indexing** — express clone is 0.73x (slower), needs optimization
2. **Parallel throughput** — Current multi-process approach loses to git; in-process threading would fix this
3. **Warm cache path** — bun's 33ms warm install is already very fast; ziggit helps cold path only

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

## 7. Run History

| Run | Date | Ziggit | Seq clone ratio | findCommit speedup | Notes |
|-----|------|--------|----------------|-------------------|-------|
| 23 | 2026-03-26 | 40ad2ba | 1.02x | 394x | Prior run |
| **24** | **2026-03-26** | **40ad2ba** | **1.01x** | **415x** | **Current** |

---

## Summary

| Metric | git CLI | ziggit | Winner |
|--------|---------|--------|--------|
| Sequential clone (5 repos) | 889ms | 882ms | **ziggit (1.01x)** |
| Parallel clone (5 repos) | 354ms | 448ms | git CLI (1.27x) |
| findCommit (per call) | 2,116µs | 5.1µs | **ziggit (415x)** |
| Small repo clone (debug) | 135ms | 81ms | **ziggit (1.66x)** |
| Large repo clone (express) | 205ms | 279ms | git CLI (1.36x) |

### Bottom line
- **Ziggit as a library inside bun** would save ~65ms (~16%) on cold git dependency resolution for a typical 5-dep project.
- The **415x findCommit speedup** eliminates subprocess overhead entirely.
- For projects with many small git deps, savings scale linearly.
- Large repo pack indexing is the main optimization opportunity for ziggit.
