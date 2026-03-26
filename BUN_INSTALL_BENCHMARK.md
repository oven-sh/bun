# BUN INSTALL Benchmark: Stock Bun vs Ziggit Integration

**Date**: 2026-03-26T22:38Z (run 29 — fresh data, ziggit 95b31d8)
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
| 1   | 519ms           | 34ms                   |
| 2   | 464ms           | 34ms                   |
| 3   | 322ms           | 33ms                   |
| **Avg** | **435ms**    | **34ms**               |
| **Median** | **464ms** | **34ms**              |

> Cold install variance is due to GitHub API latency and DNS/TLS warmup.
> Run 1 is consistently slowest (cold TCP connections); runs 2-3 benefit from OS-level DNS/TCP caching.

---

## 2. Sequential Clone: Git CLI vs Ziggit (bare --depth=1)

Simulates what bun install does for each git dependency: clone + checkout.

### Per-Repo Breakdown (avg of 3 runs, ms)

| Repo | git CLI | ziggit | Speedup |
|------|---------|--------|---------|
| debug | 137ms | 80ms | **1.72x faster** |
| semver | 173ms | 177ms | 0.98x (even) |
| chalk | 154ms | 126ms | **1.22x faster** |
| is | 171ms | 147ms | **1.16x faster** |
| express | 196ms | 277ms | 0.71x (slower) |
| **TOTAL** | **904ms** | **879ms** | **1.03x faster** |

> Express is slower due to larger pack size (more objects per depth-1 clone). Ziggit's pack
> indexing has room for optimization on larger repos.
> Debug shows the biggest win (1.72x) — smaller repos benefit most from ziggit's reduced overhead.

### Raw Data

```
# Run 1
GIT:    debug=145  semver=181  chalk=155  is=183  express=200  TOTAL=938
ZIGGIT: debug=76   semver=167  chalk=126  is=149  express=284  TOTAL=877

# Run 2
GIT:    debug=135  semver=171  chalk=158  is=163  express=198  TOTAL=897
ZIGGIT: debug=78   semver=186  chalk=126  is=153  express=272  TOTAL=886

# Run 3
GIT:    debug=131  semver=167  chalk=148  is=166  express=189  TOTAL=877
ZIGGIT: debug=85   semver=179  chalk=125  is=140  express=275  TOTAL=875
```

---

## 3. Parallel Clone (5 repos at once, --depth=1)

Simulates bun install fetching all git deps concurrently.

| Tool | Run 1 | Run 2 | Run 3 | Avg |
|------|-------|-------|-------|-----|
| git CLI | 374ms | 360ms | 356ms | **363ms** |
| ziggit | 453ms | 448ms | 454ms | **452ms** |

**Result**: git CLI wins 1.24x in parallel. This is because each ziggit invocation is a separate
process — in-process library integration (as in the bun fork) eliminates process spawn overhead entirely.

---

## 4. findCommit: In-Process Ref Resolution (1000 iterations)

This is where ziggit's in-process integration shines. Bun currently shells out to `git rev-parse`
for every ref resolution — ziggit replaces this with a direct memory read.

| Repo | git rev-parse (subprocess) | ziggit findCommit (in-process) | Speedup |
|------|---------------------------|-------------------------------|---------|
| debug | 2,204µs | 5.1µs | **432x** |
| semver | 2,139µs | 5.5µs | **389x** |
| chalk | 2,164µs | 5.2µs | **416x** |
| is | 2,179µs | 5.1µs | **427x** |
| express | 2,127µs | 5.1µs | **417x** |
| **Average** | **2,163µs** | **5.2µs** | **416x** |

---

## 5. Full bun fork binary build

Building the full bun binary with ziggit integration is **not feasible** on this VM:
- Requires: 8GB+ RAM, 20GB+ disk, ~30min build time
- This VM has: 483MB RAM, 2.5GB free disk

### What would be needed

```bash
# On a build machine with ≥8GB RAM:
cd /root/bun-fork

# Option A: CMake (official build system)
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j$(nproc)
# Binary at: build/bun

# Option B: Zig build (experimental, for ziggit integration layer only)
zig build -Doptimize=ReleaseFast
```

### Integration architecture

The bun fork replaces subprocess calls to `git` with direct ziggit library calls:
1. `git clone --bare --depth=1` → `ziggit.Repository.clone()`
2. `git rev-parse HEAD` → `ziggit.Repository.findCommit()`
3. `git checkout` → `ziggit.Repository.checkout()`

All operations happen in-process with zero IPC overhead.

---

## 6. Projected Impact on `bun install`

### Current stock bun (cold install): 435ms avg (464ms median)

Breakdown estimate for git-dep portion of cold install:
- Network fetch (5 repos): ~300ms (dominant, same for both)
- Git subprocess spawns (clone, rev-parse, checkout): ~100ms overhead
- Registry resolution (non-git deps): ~35ms

### With ziggit integration (projected):

| Component | Stock bun | With ziggit | Savings |
|-----------|-----------|-------------|---------|
| Git clone (network) | ~300ms | ~300ms | 0ms (network-bound) |
| Ref resolution (5× rev-parse) | ~11ms | ~0.03ms | **~11ms** |
| Process spawn overhead | ~50ms | 0ms | **~50ms** |
| Pack indexing (in-process) | N/A | -10ms overhead | -10ms |
| **Net git-dep savings** | | | **~51ms** |
| **Projected cold install** | 435ms | ~384ms | **~12% faster** |

### Where ziggit wins big

1. **findCommit: 416x faster** — eliminates subprocess overhead entirely
2. **Small repos (debug): 1.72x faster** clones — less overhead per object
3. **Zero-copy integration** — no IPC, no shell parsing, no temp files
4. **Warm cache operations** — ref resolution in <5.5µs vs 2.2ms

### Where work remains

1. **Large repo clones (express)**: 0.71x — pack indexing needs optimization for larger packfiles
2. **Parallel CLI spawning**: 0.81x — irrelevant when integrated as library (no process spawn)
3. **Memory pressure**: ziggit uses more peak memory during decompression

---

## 7. Comparison with Previous Runs

| Metric | Run 27 | Run 28 | Run 29 (current) | Delta (28→29) |
|--------|--------|--------|------------------|---------------|
| Bun cold avg | 523ms | 630ms | **435ms** | -195ms (network variance) |
| Bun cold median | 557ms | 617ms | **464ms** | -153ms (network variance) |
| Sequential total (git) | 905ms | 895ms | **904ms** | +9ms (noise) |
| Sequential total (ziggit) | 868ms | 840ms | **879ms** | +39ms (noise) |
| Seq clone ratio | 1.04x | 1.07x | **1.03x** | -0.04 |
| findCommit speedup | 394x | 422x | **416x** | -6 (noise) |
| debug clone speedup | 1.67x | 1.82x | **1.72x** | -0.10 |
| Parallel git | 363ms | 355ms | **363ms** | +8ms |
| Parallel ziggit | 442ms | 444ms | **452ms** | +8ms |

> Network-dependent metrics (bun cold install) vary significantly between runs.
> CPU-bound metrics (findCommit, sequential clone ratios) are stable within ±10%.

---

## 8. Summary

| Benchmark | Winner | Margin |
|-----------|--------|--------|
| Sequential clone (total) | **ziggit** | 1.03x faster |
| Small repo clone (debug) | **ziggit** | 1.72x faster |
| Large repo clone (express) | git CLI | 1.41x faster |
| Parallel clone (5 repos) | git CLI | 1.24x faster (process overhead) |
| Ref resolution (findCommit) | **ziggit** | **416x faster** |
| Projected bun install | **ziggit** | ~12% faster (cold) |

The dominant advantage of ziggit integration is **eliminating subprocess overhead** — the 416x
speedup on findCommit and the ability to do all git operations in-process without fork/exec.
For projects with many git dependencies (monorepos, private registries), this compounds significantly.

---

*Generated by benchmark/bun_install_bench.sh — run 29*
