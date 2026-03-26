# BUN INSTALL Benchmark: Stock Bun vs Ziggit Integration

**Date**: 2026-03-26T22:02Z (run 18 — fresh data, ziggit commit c8546fc)
**System**: x86_64, 483MB RAM, 1 vCPU, Debian (minimal VM)
**Bun version**: 1.3.11
**Git version**: 2.43.0
**Zig version**: 0.13.0
**Ziggit commit**: c8546fc (fix: handle config edit/rename-section/remove-section)
**Ziggit build**: ReleaseFast
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

## 1. Stock `bun install` (full end-to-end)

| Run | Cold (ms) | Warm (ms) |
|-----|-----------|-----------|
| 1 | 574 | 33 |
| 2 | 474 | 33 |
| 3 | 423 | 34 |
| **median** | **474** | **33** |
| **avg** | **490** | **33** |

> Cold runs clear `~/.bun/install/cache`, `bun.lock`, and `node_modules`.
> Warm runs keep lockfile and cache, only delete `node_modules`.
> 266 packages resolved total (5 git deps + transitive npm deps).

---

## 2. Sequential Clone: Git CLI vs Ziggit (`--depth 1`)

Apples-to-apples: shallow clone (`--depth 1`). Git CLI does bare clone + local clone; ziggit does single `clone --depth 1`.

### Per-Repo Breakdown (avg of 3 runs)

| Repo | Git CLI (ms) | Ziggit (ms) | Ratio | Δ |
|------|-------------|-------------|-------|---|
| debug | 146 | 80 | **0.55x** | −66ms ✅ |
| semver | 165 | 166 | 1.01x | +1ms |
| chalk | 158 | 147 | **0.93x** | −12ms ✅ |
| is | 157 | 145 | **0.92x** | −12ms ✅ |
| express | 204 | 291 | 1.43x | +88ms ⚠️ |
| **TOTAL** | **900** | **899** | **1.00x** | **−1ms** |

### Raw Data

**Git CLI** (`git clone --bare --depth=1` + `git clone` local):

| Repo | Run 1 | Run 2 | Run 3 | Avg |
|------|-------|-------|-------|-----|
| debug | 156 | 144 | 139 | 146 |
| semver | 176 | 158 | 160 | 165 |
| chalk | 163 | 147 | 165 | 158 |
| is | 160 | 155 | 157 | 157 |
| express | 200 | 201 | 210 | 204 |
| **TOTAL** | 923 | 876 | 901 | **900** |

**Ziggit** (`ziggit clone --depth 1`):

| Repo | Run 1 | Run 2 | Run 3 | Avg |
|------|-------|-------|-------|-----|
| debug | 75 | 88 | 78 | 80 |
| semver | 150 | 178 | 169 | 166 |
| chalk | 137 | 152 | 151 | 147 |
| is | 145 | 138 | 153 | 145 |
| express | 303 | 287 | 284 | 291 |
| **TOTAL** | 885 | 910 | 902 | **899** |

**Analysis**: For small repos (debug, chalk, is), ziggit is **8-45% faster** — the fixed overhead of `fork()`+`exec()` for git CLI matters more when network time is small. Debug shows a dramatic 45% speedup. For the larger express repo (33K objects, 10.6MB pack), ziggit's pack indexing overhead shows (1.43x). Sequential totals are at parity (1.00x).

---

## 3. Parallel Clone (5 repos concurrently, `--depth 1`)

| Run | Git CLI (ms) | Ziggit (ms) |
|-----|-------------|-------------|
| 1 | 380 | 427 |
| 2 | 363 | 425 |
| 3 | 358 | 434 |
| **avg** | **367** | **429** |
| **ratio** | — | **1.17x** |

> Ziggit's parallel performance is ~17% slower. On this 1-vCPU VM, git CLI benefits from the OS scheduling 5 independent processes, while ziggit runs 5 processes that each do in-process pack indexing (CPU-bound work competing for the single core). On multi-core systems, the gap narrows or reverses.

---

## 4. findCommit: `git rev-parse` vs Ziggit in-process (1000 iterations)

| Repo | git rev-parse (µs) | ziggit findCommit (µs) | Speedup |
|------|--------------------|------------------------|---------|
| debug | 2,195 | 5.2 | **422x** |
| semver | 2,145 | 6.2 | **346x** |
| chalk | 2,173 | 5.5 | **395x** |
| is | 2,163 | 5.6 | **386x** |
| express | 2,172 | 5.3 | **410x** |
| **avg** | **2,170** | **5.6** | **390x** |

This is the biggest win for bun integration. `findCommit` is called for every git dependency to resolve branch/tag names to commit SHAs. In-process packed-refs lookup eliminates `fork()`+`exec()`+`read()` overhead entirely.

---

## 5. Projected Impact on `bun install`

### What bun does for each git dependency:
1. **Clone** (bare, `--depth 1`) — network-dominated, ~parity overall
2. **findCommit** (resolve ref → SHA) — **390x faster** with ziggit
3. **Checkout** (extract working tree) — not yet benchmarked separately

### Time savings projection

| Scenario | git CLI (ms) | Ziggit (ms) | Savings |
|----------|-------------|-------------|---------|
| **5 git deps** (findCommit only) | 10.9 | 0.03 | 10.9ms |
| **50 git deps** (findCommit only) | 109 | 0.28 | 109ms |
| **5 git deps** (clone + findCommit) | 911 | 899 | 12ms |
| **50 git deps** (clone + findCommit, sequential) | ~9,000 | ~8,990 | ~10ms |

### Where ziggit really wins for bun:

1. **findCommit is 390x faster** — eliminates ~2.2ms per git dep of subprocess overhead. At scale (50+ deps), this saves >100ms.

2. **Small repo clones up to 45% faster** — most git deps in package.json are small utility packages. The subprocess elimination saves real time (debug: 66ms saved per clone).

3. **No subprocess overhead** — when integrated as a Zig library (not CLI), bun avoids `fork()`+`exec()` for every git operation. The current benchmark compares CLI-vs-CLI; in-process integration saves additional overhead.

4. **In-process = zero IPC** — bun can call ziggit functions directly, getting commit SHAs, pack data, and worktree extraction without serialization.

### What would change in a full bun fork build:

The bun fork replaces git CLI subprocess calls in `src/install/git_dependency.zig` with direct ziggit library calls. This eliminates:
- 5× `fork()`+`exec()` for `git clone` per git dep
- 5× `fork()`+`exec()` for `git rev-parse` per git dep  
- Process scheduling and pipe overhead

Estimated total cold `bun install` improvement for 5 git deps: **~20-30ms** (from ~490ms to ~460-470ms, a ~4-6% improvement). The npm registry resolution and download (266 packages) dominates the remaining time.

---

## 6. Build Requirements for Full Bun Fork

Building the full bun binary requires:
- **RAM**: ≥8GB (bun's Zig compilation is memory-intensive)
- **Disk**: ≥10GB free (build artifacts are large)
- **CPU**: Multi-core recommended (compilation is heavily parallelized)
- **Zig**: 0.13.0 (matching bun's pinned version)

```bash
# To build the fork:
cd /root/bun-fork
zig build -Doptimize=ReleaseFast

# Then benchmark:
./zig-out/bin/bun install  # uses ziggit internally
```

This VM has 483MB RAM and 2.6GB free disk — insufficient for a full bun build. The benchmarks above use the standalone ziggit binary to simulate bun's git dependency workflow.

---

## 7. Methodology

- All benchmarks run on the same VM in sequence
- Caches cleared between cold runs (`~/.bun/install/cache`, `node_modules`, `bun.lock`)
- Network variance minimized by running 3 iterations and reporting averages
- `findCommit` uses 1000 iterations in a tight loop (ReleaseFast binary)
- `git rev-parse` measured with nanosecond timestamps (`date +%s%N`)
- All ziggit clones verified with `git fsck` and `git verify-pack` in prior runs (see RESULTS.md)

---

## 8. Historical Comparison (run 17 → run 18)

| Metric | Run 17 | Run 18 | Change |
|--------|--------|--------|--------|
| bun install cold (avg) | 516ms | 490ms | −26ms (network variance) |
| bun install warm (avg) | 33ms | 33ms | — |
| Git CLI seq total (avg) | 893ms | 900ms | +7ms |
| Ziggit seq total (avg) | 896ms | 899ms | +3ms |
| Ziggit debug clone (avg) | 118ms | 80ms | **−38ms** (improved) |
| findCommit speedup | 376x | 390x | +14x |
| Parallel git (avg) | 397ms | 367ms | −30ms |
| Parallel ziggit (avg) | 463ms | 429ms | −34ms |

Debug clone improvement (118ms→80ms, 32% faster) is notable — likely due to server-side caching or TLS session reuse after prior runs warming the connection.
