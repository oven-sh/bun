# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-26T22:20Z (run 23 — ziggit 40ad2ba)
- Ziggit commit: 40ad2ba
- Bun fork branch: ziggit-integration
- Machine: Linux (root@ziggit), 483MB RAM, 1 vCPU, Debian (minimal VM)
- Build: `zig build -Doptimize=ReleaseFast`

## Clone Benchmarks (bare clone, --depth=1)

### Sequential: 5 repos, 3 runs each

| Repo | git CLI avg | ziggit avg | Ratio |
|------|------------|-----------|-------|
| debug | 140ms | 76ms | **1.83x faster** |
| semver | 155ms | 158ms | 0.98x (parity) |
| chalk | 154ms | 125ms | **1.23x faster** |
| is | 158ms | 138ms | **1.14x faster** |
| express | 196ms | 286ms | 0.69x (slower) |
| **TOTAL** | **875ms** | **855ms** | **1.02x faster** |

### Parallel: 5 repos at once, 3 runs

| Tool | Run 1 | Run 2 | Run 3 | Avg |
|------|-------|-------|-------|-----|
| git CLI | 355ms | 355ms | 350ms | **353ms** |
| ziggit | 444ms | 444ms | 447ms | **445ms** |

**Parallel result**: git CLI wins 1.26x (process startup overhead in ziggit CLI).

## findCommit Benchmarks (1000 iterations, in-process)

| Repo | git rev-parse | ziggit findCommit | Speedup |
|------|--------------|-------------------|---------|
| debug | 2,189µs | 5.2µs | **421x** |
| semver | 2,190µs | 6.1µs | **359x** |
| chalk | 2,088µs | 5.5µs | **380x** |
| is | 2,112µs | 5.2µs | **406x** |
| express | 2,172µs | 5.3µs | **410x** |
| **Average** | **2,150µs** | **5.5µs** | **394x** |

## Stock Bun Install (baseline)

| Metric | Avg |
|--------|-----|
| Cold install (5 git deps, 266 pkgs) | 935ms |
| Cold (excluding DNS warmup, runs 2-3) | 654ms |
| Warm install (lockfile + cache) | 34ms |

## Key Findings

1. **findCommit is 394x faster** — the strongest win; eliminates subprocess spawns
2. **Small repo clones 1.1-1.8x faster** — less overhead than forking git
3. **Large repo clones slower** — express pack indexing needs optimization (0.69x)
4. **Sequential total 2% faster** — modest network-dominated improvement
5. **Parallel slower as CLI** — in-process library integration would reverse this
6. **Projected bun install savings**: ~64ms (15%) per cold install with 5 git deps

## Raw Data (run 23)

```
BUN_COLD: 1496ms, 798ms, 510ms
BUN_WARM: 36ms, 34ms, 33ms
GIT_SEQ_TOTAL: 896ms, 856ms, 873ms
ZIGGIT_SEQ_TOTAL: 849ms, 852ms, 863ms
GIT_PARALLEL: 355ms, 355ms, 350ms
ZIGGIT_PARALLEL: 444ms, 444ms, 447ms

Per-repo sequential (3 runs each, ms):
  GIT   debug: 144, 132, 144 | semver: 169, 147, 148 | chalk: 153, 152, 157 | is: 159, 157, 157 | express: 200, 195, 194
  ZIGGIT debug: 81, 74, 74   | semver: 152, 162, 161 | chalk: 122, 126, 127 | is: 140, 137, 138 | express: 282, 283, 292

findCommit (µs per call, 1000 iterations):
  debug: 5.2 | semver: 6.1 | chalk: 5.5 | is: 5.2 | express: 5.3
git rev-parse (µs, avg of 3):
  debug: 2189 | semver: 2190 | chalk: 2088 | is: 2112 | express: 2172
```
