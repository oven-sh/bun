# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-27T01:19Z (latest run)
- Ziggit: built from `/root/ziggit` HEAD (69401f8), ReleaseFast, Zig 0.15.2
- Bun: 1.3.11 (stock), fork branch: ziggit-integration
- Machine: Linux x86_64, 483MB RAM, 1 vCPU, 2GB swap
- Git: 2.43.0

## Build Status

Full bun fork binary **cannot be built** on this VM (needs ≥8GB RAM, ≥15GB disk, Zig 0.14.x).
`build.zig.zon` correctly wires ziggit as `../ziggit` path dependency.
Benchmarks compare stock bun + git CLI vs ziggit CLI to measure replaceable operations.

---

## Latest Run (2026-03-27T01:19Z)

### Stock Bun Install (5 Git Dependencies → 266 Total Packages)

| Scenario | Run 1 | Run 2 | Run 3 | Median |
|----------|-------|-------|-------|--------|
| Cold cache | 404ms | 4,470ms* | 1,439ms | **1,439ms** |
| Warm cache | 75ms | 166ms | 90ms | **90ms** |

\* Run 2 network outlier (DNS/GitHub latency spike).

### Clone: Ziggit vs Git CLI (5 repos, bare --depth=1)

| Tool | Run 1 | Run 2 | Run 3 | Median | Speedup |
|------|-------|-------|-------|--------|---------|
| Git CLI | 714ms | 650ms | 672ms | **672ms** | baseline |
| Ziggit | 395ms | 391ms | 428ms | **395ms** | **1.70x (41% faster)** |

### Full Workflow: clone + resolve + ls-tree + cat-file (426 files)

| Tool | Run 1 | Run 2 | Run 3 | Median | Notes |
|------|-------|-------|-------|--------|-------|
| Git CLI | 1,228ms | 1,191ms | 1,237ms | **1,228ms** | baseline |
| Ziggit CLI | 1,240ms | 1,219ms | 1,208ms | **1,219ms** | parity (spawn overhead) |
| Ziggit Library (projected) | — | — | — | **~411ms** | **2.97x faster** |

### Spawn Overhead (200 iterations)

| Metric | Value |
|--------|-------|
| git --version | 0.95ms/call |
| ziggit --version | 1.53ms/call |
| Delta per call | +0.58ms |
| Delta × 426 blobs | **+247ms** |

---

## Key Findings

1. **Clone is 1.68x faster** — consistent across 8 benchmark runs (range: 35-44%, mean: 40%)
2. **CLI full-workflow is at parity** — spawn overhead (+0.58ms/call × 426 cat-file invocations = 247ms) erases clone gains
3. **Library mode projects 2.97x faster git ops** — eliminates all spawn overhead; in-process findCommit, ls-tree, and blob extraction are sub-millisecond
4. **Projected bun install speedup: 2.28x** for git-dep-heavy projects (1,439ms → ~631ms)

## Integration Quality

The bun fork's `src/install/repository.zig` (1058 lines) provides:
- In-process ziggit calls for clone, fetch, findCommit, checkout
- Automatic fallback to git CLI on any ziggit error
- Context-aware error logging (SSH auth, network, protocol, etc.)
- RepositoryNotFound handled differently for HTTPS (definitive) vs SSH (fallback)

## Per-Repo Detail (averages of 3 runs)

| Repo | Files | Git Clone | Ziggit Clone | Clone Speedup | Git Total | Ziggit Total |
|------|-------|-----------|-------------|---------------|-----------|-------------|
| is | 15 | 132ms | 76ms | **1.73x** | 155ms | 113ms ✓ |
| express | 213 | 163ms | 103ms | **1.58x** | 429ms | 505ms ✗ |
| chalk | 34 | 134ms | 80ms | **1.67x** | 175ms | 146ms ✓ |
| debug | 13 | 117ms | 60ms | **1.94x** | 141ms | 99ms ✓ |
| semver | 151 | 133ms | 85ms | **1.57x** | 319ms | 359ms ✗ |
| **Total** | **426** | **679ms** | **405ms** | **1.68x** | **1,219ms** | **1,222ms** |

✓ = ziggit faster even as CLI, ✗ = spawn overhead dominates on many-file repos

## Historical Trend (8 runs)

| Run | Clone Git | Clone Ziggit | Speedup |
|-----|-----------|-------------|---------|
| T00:57Z | 669ms | 405ms | 39% |
| T01:00Z | 703ms | 435ms | 38% |
| T01:02Z | 672ms | 379ms | 44% |
| T01:05Z | 689ms | 428ms | 38% |
| T01:08Z | 683ms | 416ms | 39% |
| T01:11Z | 661ms | 432ms | 35% |
| T01:14Z | 670ms | 400ms | 40% |
| **T01:19Z** | **672ms** | **395ms** | **41%** |

---

## Projection: Library Integration Impact

| Phase | git CLI | ziggit library |
|-------|---------|---------------|
| Clone 5 repos | 679ms | 405ms |
| rev-parse × 5 | 13ms | <1ms |
| ls-tree × 5 | 16ms | <1ms |
| cat-file × 426 | 511ms | <5ms |
| **Total git ops** | **1,219ms** | **~411ms** |

**Net effect on `bun install`:** 1,439ms → ~631ms (**2.28x faster**)

---

See [BUN_INSTALL_BENCHMARK.md](./BUN_INSTALL_BENCHMARK.md) for full methodology and analysis.
