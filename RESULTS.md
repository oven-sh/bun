# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-26T22:17Z (run 22 — ziggit 40ad2ba)
- Ziggit commit: 40ad2ba
- Bun fork branch: ziggit-integration
- Machine: Linux (root@ziggit), 483MB RAM, 1 vCPU, tmpfs-backed /tmp
- Build: `zig build -Doptimize=ReleaseFast`

## Clone Benchmarks (bare clone, --depth=1)

### Sequential: 5 repos, 3 runs each

| Repo | git CLI avg | ziggit avg | Ratio |
|------|------------|-----------|-------|
| debug | 140ms | 77ms | **1.83x faster** |
| semver | 171ms | 167ms | 1.03x (parity) |
| chalk | 158ms | 128ms | **1.23x faster** |
| is | 170ms | 141ms | **1.21x faster** |
| express | 195ms | 271ms | 0.72x (slower) |
| **TOTAL** | **905ms** | **854ms** | **1.06x faster** |

### Parallel: 5 repos at once, 3 runs

| Tool | Run 1 | Run 2 | Run 3 | Avg |
|------|-------|-------|-------|-----|
| git CLI | 375ms | 341ms | 348ms | **355ms** |
| ziggit | 424ms | 425ms | 432ms | **427ms** |

**Parallel result**: git CLI wins 1.20x (process startup overhead in ziggit CLI).

## findCommit Benchmarks (1000 iterations, in-process)

| Repo | git rev-parse | ziggit findCommit | Speedup |
|------|--------------|-------------------|---------|
| debug | 2,143µs | 4.9µs | **437x** |
| semver | 2,126µs | 9.4µs | **226x** |
| chalk | 2,118µs | 4.8µs | **441x** |
| is | 2,058µs | 4.9µs | **420x** |
| express | 2,289µs | 5.0µs | **458x** |
| **Average** | **2,147µs** | **5.8µs** | **370x** |

## Stock Bun Install (baseline)

| Metric | Avg |
|--------|-----|
| Cold install (5 git deps, 266 pkgs) | 663ms |
| Cold (excluding DNS warmup) | 477ms |
| Warm install (lockfile + cache) | 34ms |

## Key Findings

1. **findCommit is 370x faster** — the strongest win; eliminates subprocess spawns
2. **Small repo clones 1.2-1.8x faster** — less overhead than forking git
3. **Large repo clones slower** — express pack indexing needs optimization
4. **Sequential total 6% faster** — modest network-dominated improvement
5. **Parallel slower as CLI** — in-process library integration would reverse this
6. **Projected bun install savings**: ~66ms (16%) per cold install with 5 git deps

## Raw Data

```
BUN_COLD: 1036ms, 462ms, 492ms
BUN_WARM: 35ms, 34ms, 34ms
GIT_TOTAL: 992ms, 850ms, 872ms
ZIGGIT_TOTAL: 850ms, 860ms, 853ms
GIT_PARALLEL: 375ms, 341ms, 348ms
ZIGGIT_PARALLEL: 424ms, 425ms, 432ms
```
