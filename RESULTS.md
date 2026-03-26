# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-26T22:43Z (run 31 — ziggit 95b31d8)
- Ziggit commit: 95b31d8 (perf: increase decompression buffer to 32KB for fewer iterations in idx generation)
- Bun fork branch: ziggit-integration
- Machine: Linux (root@ziggit), 483MB RAM, 1 vCPU, Debian (minimal VM)
- Build: `zig build -Doptimize=ReleaseFast`

## Clone Benchmarks (bare clone, --depth=1)

### Sequential: 5 repos, 3 runs each

| Repo | git CLI avg | ziggit avg | Ratio |
|------|------------|-----------|-------|
| debug | 132ms | 81ms | **1.63x faster** |
| semver | 172ms | 166ms | 1.04x (even) |
| chalk | 149ms | 121ms | **1.23x faster** |
| is | 160ms | 134ms | **1.19x faster** |
| express | 199ms | 273ms | 0.73x (slower) |
| **TOTAL** | **884ms** | **844ms** | **1.05x faster** |

### Parallel: 5 repos at once, 3 runs

| Tool | Run 1 | Run 2 | Run 3 | Avg | Median |
|------|-------|-------|-------|-----|--------|
| git CLI | 363ms | 589ms | 352ms | **435ms** | **363ms** |
| ziggit | 446ms | 453ms | 445ms | **448ms** | **446ms** |

**Parallel result**: By median, git CLI wins (363 vs 446ms). Per-process overhead in ziggit CLI; in-process library would eliminate this.

## findCommit: In-Process (1000 iterations)

| Repo | git rev-parse | ziggit findCommit | Speedup |
|------|--------------|-------------------|---------|
| debug | 2,219µs | 4.9µs | **453x** |
| semver | 2,177µs | 6.3µs | **346x** |
| chalk | 2,146µs | 4.8µs | **447x** |
| is | 2,097µs | 5.1µs | **411x** |
| express | 2,169µs | 5.2µs | **417x** |
| **Average** | **2,162µs** | **5.3µs** | **~415x** |

## Bun Install Baseline (stock bun 1.3.11)

| Metric | Run 1 | Run 2 | Run 3 | Avg | Median |
|--------|-------|-------|-------|-----|--------|
| Cold install | 562ms | 497ms | 518ms | **526ms** | **518ms** |
| Warm install | 33ms | 33ms | 33ms | **33ms** | **33ms** |
| Total packages resolved | 266 | | | | |

## History

| Run | Date | Ziggit SHA | Seq Total (git/zig) | findCommit speedup | Notes |
|-----|------|-----------|--------------------:|-------------------:|-------|
| 28 | 2026-03-26 | 95b31d8 | 882/856ms | 422x | baseline |
| 29 | 2026-03-26 | 95b31d8 | 903/871ms | 400x | second run |
| 30 | 2026-03-26 | 95b31d8 | 903/871ms | 400x | third run |
| 31 | 2026-03-26 | 95b31d8 | 884/844ms | 415x | current |
