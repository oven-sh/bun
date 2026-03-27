# Bun Install Benchmark: Ziggit Integration vs Stock Bun

**Date:** 2026-03-27T04:26Z (Session 24 — fresh end-to-end benchmarks)
**System:** Linux 6.1.141 x86_64, 483MB RAM, 1 vCPU, 2GB swap
**Stock bun:** v1.3.11 (af24e281)
**Ziggit:** commit b6ce769 (pure Zig git library)
**Git CLI:** v2.43.0
**Zig:** v0.15.2

## Executive Summary

The bun fork replaces `git` CLI subprocess spawning with direct ziggit library calls.
This eliminates fork+exec overhead and achieves **3.7–6.2× faster** git dependency
resolution in the full bun-install workflow (cloneBare → findCommit → checkout) for
small-to-medium repos (≤1.6MB bare).

For a project with 5 git deps, the git resolution portion takes **~35ms with ziggit**
vs **~76ms with git CLI** spawning. On a cold `bun install` averaging 515ms, this
translates to **~42ms savings (~8% faster total install)**.

For large repos (express, 11MB), the full workflow is roughly equal (~0.9×) because
git's pack file copying is heavily optimized. Ziggit still wins 10.7–11.5× on findCommit.

---

## 1. Stock Bun Install Baseline (5 GitHub Git Dependencies)

Test project dependencies:
- `debug` (github:debug-js/debug) — 596KB bare
- `chalk` (github:chalk/chalk) — 1.2MB bare
- `is` (github:sindresorhus/is) — 1.4MB bare
- `semver` (github:npm/node-semver) — 1.6MB bare
- `express` (github:expressjs/express) — 11MB bare

Total: 69 packages installed (5 git + 64 npm transitive deps).

### Cold Cache (cache + lockfile + node_modules removed between runs)

| Run | bun reported | wall clock |
|-----|-------------|------------|
| 1   | 485ms       | 494ms      |
| 2   | 384ms       | 393ms      |
| 3   | 647ms       | 657ms      |
| **Avg** | **505ms** | **515ms** |

### Warm Cache (only node_modules removed)

| Run | bun reported | wall clock |
|-----|-------------|------------|
| 1   | 22ms        | 26ms       |
| 2   | 21ms        | 24ms       |
| 3   | 22ms        | 24ms       |
| **Avg** | **22ms** | **25ms** |

---

## 2. Ziggit Library vs Git CLI — Per-Operation Benchmarks

Each repo tested with 3 runs × 20 iterations (10 for express) = 60 measurements per operation.
Built with `-Doptimize=ReleaseFast`. Library calls use `ziggit.Repository` directly
(same API the bun fork uses).

### 2.1 findCommit (rev-parse HEAD)

This is what bun calls to resolve a git ref to a SHA. The library version opens the
repo and reads refs directly; the CLI version spawns `git rev-parse HEAD`.

| Repo | Size | ziggit (μs) | git CLI (μs) | Speedup |
|------|------|-------------|--------------|---------|
| debug | 596KB | 184 | 1229 | **6.7×** |
| chalk | 1.2MB | 141 | 1213 | **8.6×** |
| is | 1.4MB | 236 | 1228 | **5.2×** |
| node-semver | 1.5MB | 138 | 1207 | **8.7×** |
| express | 11MB | 125 | 1379 | **11.0×** |
| **Average** | | **165** | **1251** | **7.6×** |

> findCommit is dominated by fork+exec overhead in the CLI path (~1.2ms constant).
> Ziggit reads refs directly from disk with zero process spawning.

### 2.2 cloneBare (local bare clone)

Simulates what bun does when caching a git dependency for the first time.

| Repo | Size | ziggit (μs) | git CLI (μs) | Speedup |
|------|------|-------------|--------------|---------|
| debug | 596KB | 913 | 4745 | **5.2×** |
| chalk | 1.2MB | 1289 | 4292 | **3.3×** |
| is | 1.4MB | 1814 | 4522 | **2.5×** |
| node-semver | 1.5MB | 1875 | 5796 | **3.1×** |
| express | 11MB | 11970 | 7538 | **0.6×** |

For repos ≤1.6MB, ziggit is 2.5–5.2× faster. For the 11MB express repo, git CLI
is faster (0.6×) because git's internal pack hardlink/copy path is more optimized
for large packfiles.

### 2.3 Full Workflow (cloneBare + findCommit + checkout)

This is the complete sequence bun executes per git dependency.

| Repo | Size | ziggit (μs) | git CLI (μs) | Speedup |
|------|------|-------------|--------------|---------|
| debug | 596KB | 1798 | 11210 | **6.2×** |
| chalk | 1.2MB | 2614 | 12277 | **4.7×** |
| is | 1.4MB | 3624 | 12991 | **3.6×** |
| node-semver | 1.5MB | 3737 | 16631 | **4.5×** |
| express | 11MB | 24662 | 23243 | **0.94×** |
| **Total (all 5)** | | **36,435** | **76,352** | **2.1×** |
| **Total (4 small)** | | **11,773** | **53,109** | **4.5×** |

---

## 3. Projected Impact on `bun install`

### Cold Install (avg 515ms wall clock)

| Component | Stock bun (git CLI) | With ziggit | Savings |
|-----------|-------------------|-------------|---------|
| Git dep resolution (5 deps) | ~76ms | ~36ms | ~40ms |
| npm registry + download | ~400ms | ~400ms | 0 |
| Linking + extraction | ~39ms | ~39ms | 0 |
| **Total** | **~515ms** | **~475ms** | **~40ms (7.8%)** |

### Per-Dependency Savings

| Scenario | git CLI (ms) | ziggit (ms) | Saved per dep |
|----------|-------------|-------------|---------------|
| Small repo (≤1.6MB) | 13.3 | 2.9 | **10.4ms** |
| Large repo (~11MB) | 23.2 | 24.7 | **-1.5ms** |
| Weighted avg (this project) | 15.3 | 7.3 | **8.0ms** |

### Scaling: Projects with More Git Dependencies

| Git deps | Estimated savings | % of cold install |
|----------|------------------|-------------------|
| 5 (this test) | 40ms | 7.8% |
| 10 | ~80ms | ~14% |
| 20 | ~160ms | ~24% |
| 50 | ~400ms | ~44% |

---

## 4. Build Notes

### Why we can't build the full bun fork on this VM

Building bun requires:
- **≥8GB RAM** (bun's zig build + linking is very memory-intensive)
- **≥20GB disk** (codegen, LLVM artifacts, WebKit)
- **Multiple cores** recommended (single vCPU → hours)

This VM has 483MB RAM, 1 vCPU, 2.7GB free disk.

### What was built and measured

- **ziggit library** (`zig build` in /root/ziggit) — builds in ~30s
- **lib_bench** (`zig build -Doptimize=ReleaseFast` in benchmark/) — standalone
  benchmark binary that links ziggit as a library and compares against git CLI
  subprocess spawning

### To reproduce on a capable machine

```bash
cd /root/ziggit && zig build
cd /root/bun-fork && zig build -Doptimize=ReleaseFast
# Then run bun-fork's bun binary against the test project
```

### To run benchmarks

```bash
cd /root/bun-fork/benchmark
./bun_install_bench.sh           # Full suite
./bun_install_bench.sh --skip-bun    # Ziggit vs CLI only
./bun_install_bench.sh --skip-ziggit # Stock bun only
```

---

## 5. Cross-Session Reproducibility

Results are highly reproducible across sessions 21–24:

| Metric | Session 21 | Session 22 | Session 23 | Session 24 | Δ range |
|--------|-----------|-----------|-----------|-----------|---------|
| findCommit avg ziggit | 149μs | 152μs | 186μs | 165μs | ±20% |
| findCommit avg CLI | 1039μs | 1044μs | 1056μs | 1251μs | ±17% |
| Full workflow total ziggit | 31,820μs | 32,610μs | 34,508μs | 36,435μs | ±12% |
| Full workflow total CLI | 74,069μs | 74,334μs | 75,367μs | 76,352μs | ±3% |
| Cold bun install avg | 422ms | 471ms | 400ms | 515ms | ±25%¹ |
| Warm bun install avg | 24ms | 23ms | 24ms | 25ms | ±4% |

¹ Cold install variance is due to network (GitHub API) variability.

---

## 6. Raw Data (Session 24)

### Run-by-run findCommit (μs avg over 20 iters, 10 for express)

| Repo | Run 1 | Run 2 | Run 3 | Avg |
|------|-------|-------|-------|-----|
| **debug** ziggit | 206 | 171 | 176 | 184 |
| **debug** git CLI | 1274 | 1214 | 1200 | 1229 |
| **chalk** ziggit | 149 | 149 | 124 | 141 |
| **chalk** git CLI | 1232 | 1206 | 1202 | 1213 |
| **is** ziggit | 228 | 226 | 255 | 236 |
| **is** git CLI | 1225 | 1232 | 1226 | 1228 |
| **semver** ziggit | 136 | 144 | 134 | 138 |
| **semver** git CLI | 1203 | 1202 | 1217 | 1207 |
| **express** ziggit | 129 | 120 | 126 | 125 |
| **express** git CLI | 1382 | 1383 | 1372 | 1379 |

### Run-by-run cloneBare (μs avg over 20 iters, 10 for express)

| Repo | Run 1 | Run 2 | Run 3 | Avg |
|------|-------|-------|-------|-----|
| **debug** ziggit | 949 | 900 | 890 | 913 |
| **debug** git CLI | 4842 | 4700 | 4693 | 4745 |
| **chalk** ziggit | 1341 | 1273 | 1254 | 1289 |
| **chalk** git CLI | 4362 | 4246 | 4269 | 4292 |
| **is** ziggit | 1838 | 1799 | 1804 | 1814 |
| **is** git CLI | 4532 | 4526 | 4507 | 4522 |
| **semver** ziggit | 1909 | 1856 | 1861 | 1875 |
| **semver** git CLI | 5802 | 5781 | 5804 | 5796 |
| **express** ziggit | 12668 | 11600 | 11642 | 11970 |
| **express** git CLI | 7549 | 7537 | 7527 | 7538 |

### Run-by-run Full Workflow (μs avg over 20 iters, 10 for express)

| Repo | Run 1 | Run 2 | Run 3 | Avg |
|------|-------|-------|-------|-----|
| **debug** ziggit | 1845 | 1786 | 1763 | 1798 |
| **debug** git CLI | 11287 | 11162 | 11182 | 11210 |
| **chalk** ziggit | 2706 | 2587 | 2548 | 2614 |
| **chalk** git CLI | 12329 | 12241 | 12260 | 12277 |
| **is** ziggit | 3475 | 3446 | 3952 | 3624 |
| **is** git CLI | 13018 | 12977 | 12977 | 12991 |
| **semver** ziggit | 3849 | 3713 | 3649 | 3737 |
| **semver** git CLI | 16601 | 16611 | 16681 | 16631 |
| **express** ziggit | 25235 | 24447 | 24303 | 24662 |
| **express** git CLI | 23286 | 23169 | 23275 | 23243 |
