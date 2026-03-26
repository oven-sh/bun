# BUN INSTALL Benchmark: Stock Bun vs Ziggit Integration

**Date**: 2026-03-26T22:30Z (run 26 — fresh data, ziggit 95b31d8)
**System**: x86_64, 483MB RAM, 1 vCPU, Debian (minimal VM)
**Bun version**: 1.3.11
**Git version**: 2.43.0
**Zig version**: 0.13.0
**Ziggit commit**: 95b31d8 (perf: increase decompression buffer to 32KB for fewer iterations in idx generation)
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
| 1   | 674ms           | 33ms                   |
| 2   | 474ms           | 33ms                   |
| 3   | 455ms           | 32ms                   |
| **Avg** | **534ms**    | **33ms**               |
| **Median** | **474ms** | **33ms**              |

> Cold install variance is due to GitHub API latency and DNS/TLS warmup.

---

## 2. Sequential Clone: Git CLI vs Ziggit (bare --depth=1)

Simulates what bun install does for each git dependency: clone + checkout.

### Per-Repo Breakdown (avg of 3 runs, ms)

| Repo | git CLI | ziggit | Speedup |
|------|---------|--------|---------|
| debug | 186ms | 134ms | **1.39x faster** |
| semver | 175ms | 182ms | 0.96x (parity) |
| chalk | 158ms | 134ms | **1.18x faster** |
| is | 165ms | 145ms | **1.13x faster** |
| express | 201ms | 282ms | 0.71x (slower) |

### Sequential Total

| Tool | Run 1 | Run 2 | Run 3 | Avg |
|------|-------|-------|-------|-----|
| git CLI | 977ms | 898ms | 994ms | **956ms** |
| ziggit | 922ms | 954ms | 970ms | **949ms** |

**Result**: Ziggit is **1.01x faster** in sequential clone (~parity, 7ms saved).

### Analysis (vs run 25)

- **Regression**: Sequential speedup dropped from 1.58x (0fc153f) → 1.01x (95b31d8)
- **Root cause**: git CLI times improved dramatically this run (956ms vs 1364ms in run 25), likely due to warmer network conditions / GitHub CDN caching
- **Ziggit was consistent**: 949ms vs 861ms in run 25 — the 95b31d8 decompression buffer change appears neutral for shallow clones
- **Small repos**: ziggit still wins on debug (1.39x), chalk (1.18x), is (1.13x)
- **Large repos**: express remains 0.71x (git's C pack indexing is faster)
- **Key insight**: Network conditions dominate; sequential benchmarks are noisy

---

## 3. Parallel Clone (5 repos simultaneously)

| Tool | Run 1 | Run 2 | Run 3 | Avg |
|------|-------|-------|-------|-----|
| git CLI (5 procs) | 351ms | 350ms | 343ms | **348ms** |
| ziggit (5 procs) | 428ms | 437ms | 433ms | **433ms** |

**Result**: Git CLI is **1.24x faster** in parallel.

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
| debug | 2,214µs | 5.5µs | **403x** |
| semver | 2,175µs | 5.4µs | **403x** |
| chalk | 2,140µs | 5.4µs | **396x** |
| is | 2,148µs | 5.2µs | **413x** |
| express | 2,141µs | 5.2µs | **412x** |
| **Average** | **2,164µs** | **5.3µs** | **405x** |

**Result**: Ziggit findCommit is **405x faster** than spawning `git rev-parse`.

> `git rev-parse` costs ~2.2ms due to process creation overhead (fork+exec+load). Ziggit reads the packed-refs file directly in ~5.3µs.

---

## 5. Projected Impact on `bun install`

### What bun install does for each git dependency:
1. **Clone/fetch** the repo (network-bound)
2. **Resolve ref** to commit SHA (findCommit / rev-parse)
3. **Extract** working tree (checkout)

### Time budget for 5 git deps (stock bun cold install: ~534ms avg)

| Phase | Stock bun (git CLI) | With ziggit (projected) | Savings |
|-------|--------------------|-----------------------|---------|
| Clone (parallel) | ~348ms | ~280ms (in-process, no fork) | ~68ms |
| Ref resolution (5×) | ~10.8ms (5 × 2.16ms) | ~0.03ms (5 × 5.3µs) | **~10.8ms** |
| Checkout/extract | ~50ms | ~50ms (same) | 0ms |
| **Total git phase** | **~409ms** | **~330ms** | **~79ms (19%)** |

### Scaling projection

| Git deps | Subprocess overhead (git) | Ziggit in-process | Savings |
|----------|--------------------------|-------------------|---------|
| 5 | 10.8ms | 0.03ms | 10.8ms |
| 20 | 43.3ms | 0.11ms | 43.2ms |
| 50 | 108.2ms | 0.27ms | 107.9ms |
| 100 | 216.4ms | 0.53ms | 215.9ms |

For monorepos with many git dependencies, the subprocess elimination alone saves >200ms.

### Where ziggit wins in bun install:
1. **Eliminates subprocess spawns** — No fork/exec for ref resolution (405x faster per call)
2. **Small repo clones faster** — 1.13–1.39x on debug, chalk, is
3. **Much lower variance** — ziggit clone stddev ~24ms vs git CLI ~52ms (more predictable installs)
4. **In-process clone** — Would save ~10-15ms per repo on process setup
5. **Shared connection pool** — Can reuse HTTP connections across repos (not yet benchmarked)

### Where ziggit needs improvement:
1. **Large repo pack indexing** — express clone is 0.71x (slower), needs optimization of Zig pack index writer
2. **Parallel throughput** — Current multi-process approach loses to git 1.24x; in-process threading would fix this
3. **Warm cache path** — bun's 33ms warm install is already very fast; ziggit helps cold path only

---

## 6. Build Feasibility

### Full bun fork build
- **Not feasible on this VM** (483MB RAM, 2.5GB disk free)
- Bun requires ~8GB RAM and ~20GB disk to build from source
- Build command: `cd /root/bun-fork && zig build -Doptimize=ReleaseFast`
- Requires: Zig 0.13.0, ~30min on 8-core machine

### What was benchmarked instead
- Stock bun install (real `bun install` with git deps)
- Ziggit CLI as a drop-in replacement for git operations bun performs
- findCommit benchmark (in-process via compiled Zig binary, simulates library integration)
- Benchmark harness binary built at: `/root/bun-fork/benchmark/zig-out/bin/findcommit_bench`

---

## 7. Run History

| Run | Date | Ziggit | Seq clone ratio | findCommit speedup | Notes |
|-----|------|--------|----------------|-------------------|-------|
| 23 | 2026-03-26 | 40ad2ba | 1.02x | 394x | Prior baseline |
| 24 | 2026-03-26 | 40ad2ba | 1.01x | 415x | Rerun |
| 25 | 2026-03-26 | 0fc153f | 1.58x | 394x | Perf: reduced allocs (git CLI slow that run) |
| **26** | **2026-03-26** | **95b31d8** | **1.01x** | **405x** | **Perf: 32KB decomp buffer (neutral for shallow)** |

### Run 25→26 regression analysis
Run 25 showed ziggit 1.58x faster, but this was largely because git CLI had a bad run (avg 1364ms, semver hit 998ms). Run 26 git CLI averaged 956ms (normal). Ziggit was consistent across both: 861ms → 949ms. **The true steady-state ratio is ~1.01x (parity) for sequential clone.**

---

## Summary

| Metric | git CLI | ziggit | Winner |
|--------|---------|--------|--------|
| Sequential clone (5 repos) | 956ms | 949ms | **Parity (1.01x)** |
| Parallel clone (5 repos) | 348ms | 433ms | git CLI (1.24x) |
| findCommit (per call) | 2,164µs | 5.3µs | **ziggit (405x)** |
| Small repo clone (debug) | 186ms | 134ms | **ziggit (1.39x)** |
| Large repo clone (express) | 201ms | 282ms | git CLI (1.40x) |
| Clone variance (stddev) | ~52ms | ~24ms | **ziggit (2.2x lower)** |

### Bottom line
- **Sequential clone is at parity** — network latency dominates; ziggit wins on small repos, loses on large ones.
- **The 405x findCommit speedup is the real win** — eliminates subprocess overhead entirely.
- **Variance reduction** — ziggit clone times are 2.2x more consistent than git CLI.
- **In-process integration** (as a library inside bun) would add further gains:
  - No process spawn overhead for clone (~10-15ms per repo)
  - Shared HTTP connection pool across repos
  - Zero-copy ref resolution
- For projects with many git deps (20+), subprocess elimination alone saves 40-200ms.
- **Main optimization opportunity**: Zig pack index writer for large repos (express 0.71x).
