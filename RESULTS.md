# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-26T22:48Z (run 33 — ziggit 95b31d8)
- Ziggit commit: 95b31d8 (perf: increase decompression buffer to 32KB for fewer iterations in idx generation)
- Bun fork branch: ziggit-integration
- Machine: Linux (root@ziggit), 483MB RAM, 1 vCPU, Debian (minimal VM)
- Build: `zig build -Doptimize=ReleaseFast`

## Clone Benchmarks (bare clone, --depth=1)

### Sequential: 5 repos, 3 runs each

| Repo | git CLI avg | ziggit avg | Ratio |
|------|------------|-----------|-------|
| debug | 138ms | 82ms | **1.67x faster** |
| semver | 170ms | 161ms | 1.05x (even) |
| chalk | 167ms | 129ms | **1.29x faster** |
| is | 167ms | 139ms | **1.20x faster** |
| express | 274ms | 292ms | 0.94x (slower) |
| **TOTAL** | **987ms** | **877ms** | **1.13x faster** |

### Parallel: 5 repos at once, 3 runs

| Tool | Run 1 | Run 2 | Run 3 | Avg | Median |
|------|-------|-------|-------|-----|--------|
| git CLI | 454ms | 812ms | 354ms | **540ms** | **454ms** |
| ziggit | 452ms | 584ms | 453ms | **496ms** | **453ms** |

**Parallel result**: Nearly tied at median (454ms vs 453ms). Git had higher variance (354–812ms outlier). Ziggit avg 8% faster.

## findCommit: In-Process (1000 iterations)

| Repo | git rev-parse | ziggit findCommit | Speedup |
|------|--------------|-------------------|---------|
| debug | 2,175µs | 5.0µs | **435x** |
| semver | 2,136µs | 6.7µs | **319x** |
| chalk | 2,204µs | 5.2µs | **424x** |
| is | 2,131µs | 5.4µs | **395x** |
| express | 2,112µs | 5.3µs | **398x** |
| **Average** | **2,152µs** | **5.5µs** | **~390x** |

## Bun Install Baseline (stock bun 1.3.11)

| Metric | Run 1 | Run 2 | Run 3 | Avg | Median |
|--------|-------|-------|-------|-----|--------|
| Cold install | 553ms | 725ms | 726ms | **668ms** | **725ms** |
| Warm install | 34ms | 33ms | 33ms | **33ms** | **33ms** |
| Total packages resolved | 266 | | | | |

## Projected Savings (5 git deps, sequential)

| Phase | git CLI | ziggit | Savings |
|-------|---------|--------|---------|
| Clone | 987ms | 877ms | 110ms (11%) |
| Ref resolve (×5) | 10.8ms | 0.028ms | 10.7ms (99.7%) |
| **Total** | **~998ms** | **~877ms** | **~121ms (12.1%)** |
