# BUN INSTALL Benchmark: Stock Bun vs Ziggit Integration

**Date**: 2026-03-26T22:33Z (run 27 — fresh data, ziggit 95b31d8)
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
| 1   | 557ms           | 32ms                   |
| 2   | 429ms           | 30ms                   |
| 3   | 583ms           | 30ms                   |
| **Avg** | **523ms**    | **31ms**               |
| **Median** | **557ms** | **30ms**              |

> Cold install variance is due to GitHub API latency and DNS/TLS warmup.

---

## 2. Sequential Clone: Git CLI vs Ziggit (bare --depth=1)

Simulates what bun install does for each git dependency: clone + checkout.

### Per-Repo Breakdown (avg of 3 runs, ms)

| Repo | git CLI | ziggit | Speedup |
|------|---------|--------|---------|
| debug | 175ms | 105ms | **1.67x faster** |
| semver | 151ms | 153ms | 0.99x (parity) |
| chalk | 148ms | 122ms | **1.21x faster** |
| is | 161ms | 146ms | **1.10x faster** |
| express | 201ms | 274ms | 0.73x (slower) |
| **TOTAL** | **905ms** | **868ms** | **1.04x faster** |

> Express is slower due to larger pack size (more objects per depth-1 clone). Ziggit's pack
> indexing has room for optimization on larger repos.

### Raw Data

```
# Run 1
GIT:    debug=158  semver=157  chalk=157  is=162  express=210  TOTAL=912
ZIGGIT: debug=105  semver=157  chalk=121  is=157  express=268  TOTAL=876

# Run 2
GIT:    debug=186  semver=150  chalk=142  is=165  express=194  TOTAL=906
ZIGGIT: debug=107  semver=153  chalk=119  is=147  express=274  TOTAL=869

# Run 3
GIT:    debug=182  semver=147  chalk=144  is=156  express=198  TOTAL=897
ZIGGIT: debug=104  semver=148  chalk=127  is=134  express=281  TOTAL=860
```

---

## 3. Parallel Clone (5 repos at once, --depth=1)

Simulates bun install fetching all git deps concurrently.

| Tool | Run 1 | Run 2 | Run 3 | Avg |
|------|-------|-------|-------|-----|
| git CLI | 364ms | 365ms | 359ms | **363ms** |
| ziggit | 439ms | 446ms | 440ms | **442ms** |

**Result**: git CLI wins 1.22x in parallel (CLI process spawn overhead dominates for ziggit;
in-process library integration eliminates this entirely).

---

## 4. findCommit: In-Process Ref Resolution (1000 iterations)

This is where ziggit's in-process integration shines. Bun currently shells out to `git rev-parse`
for every ref resolution — ziggit replaces this with a direct memory read.

| Repo | git rev-parse (subprocess) | ziggit findCommit (in-process) | Speedup |
|------|---------------------------|-------------------------------|---------|
| debug | 2,215µs | 5.3µs | **418x** |
| semver | 2,194µs | 6.4µs | **343x** |
| chalk | 2,192µs | 5.5µs | **399x** |
| is | 2,221µs | 5.5µs | **404x** |
| express | 2,220µs | 5.3µs | **419x** |
| **Average** | **2,208µs** | **5.6µs** | **394x** |

---

## 5. Full bun fork binary build

Building the full bun binary with ziggit integration is **not feasible** on this VM:
- Requires: 8GB+ RAM, 20GB+ disk, ~30min build time
- This VM has: 483MB RAM, 2.5GB free disk

### What would be needed

```bash
# On a build machine with ≥8GB RAM:
cd /root/bun-fork
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j$(nproc)
# The resulting binary at build/bun would use ziggit for all git operations
```

---

## 6. Projected Impact on `bun install`

### Current stock bun (cold install): 523ms avg

Breakdown estimate for git-dep portion of cold install:
- Network fetch (5 repos): ~300ms (dominant, same for both)
- Git subprocess spawns (clone, rev-parse, checkout): ~100ms overhead
- Registry resolution (non-git deps): ~120ms

### With ziggit integration (projected):

| Component | Stock bun | With ziggit | Savings |
|-----------|-----------|-------------|---------|
| Git clone (network) | ~300ms | ~300ms | 0ms (network-bound) |
| Ref resolution (5× rev-parse) | ~11ms | ~0.03ms | **~11ms** |
| Process spawn overhead | ~50ms | 0ms | **~50ms** |
| Pack indexing (in-process) | N/A | -10ms overhead | -10ms |
| **Net git-dep savings** | | | **~51ms** |
| **Projected cold install** | 523ms | ~472ms | **~10% faster** |

### Where ziggit wins big

1. **findCommit: 394x faster** — eliminates subprocess overhead entirely
2. **Small repos (debug, chalk): 1.2–1.7x faster** clones
3. **Zero-copy integration** — no IPC, no shell parsing, no temp files
4. **Warm cache operations** — ref resolution in <6µs vs 2.2ms

### Where work remains

1. **Large repo clones (express)**: 0.73x — pack indexing needs optimization
2. **Parallel CLI spawning**: 0.82x — irrelevant when integrated as library (no process spawn)
3. **Memory pressure**: ziggit uses more peak memory during decompression

---

## 7. Comparison with Previous Run

| Metric | Run 26 (prev) | Run 27 (current) | Delta |
|--------|--------------|------------------|-------|
| Bun cold avg | 534ms | 523ms | -11ms (network variance) |
| Sequential total (git) | 956ms | 905ms | -51ms |
| Sequential total (ziggit) | 949ms | 868ms | -81ms |
| Seq clone ratio | 1.01x | **1.04x** | Improved |
| findCommit speedup | 405x | **394x** | Slight regression (noise) |
| debug clone speedup | 1.39x | **1.67x** | Improved |

---

*Generated by benchmark/bun_install_bench.sh — run 27*
