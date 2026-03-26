# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-26T22:41Z (run 30 — ziggit 95b31d8)
- Ziggit commit: 95b31d8 (perf: increase decompression buffer to 32KB for fewer iterations in idx generation)
- Bun fork branch: ziggit-integration
- Machine: Linux (root@ziggit), 483MB RAM, 1 vCPU, Debian (minimal VM)
- Build: `zig build -Doptimize=ReleaseFast`

## Clone Benchmarks (bare clone, --depth=1)

### Sequential: 5 repos, 3 runs each

| Repo | git CLI avg | ziggit avg | Ratio |
|------|------------|-----------|-------|
| debug | 143ms | 79ms | **1.81x faster** |
| semver | 175ms | 169ms | 1.04x (even) |
| chalk | 159ms | 133ms | **1.20x faster** |
| is | 157ms | 141ms | **1.12x faster** |
| express | 196ms | 278ms | 0.70x (slower) |
| **TOTAL** | **903ms** | **871ms** | **1.04x faster** |

### Parallel: 5 repos at once, 3 runs

| Tool | Run 1 | Run 2 | Run 3 | Avg |
|------|-------|-------|-------|-----|
| git CLI | 356ms | 351ms | 353ms | **353ms** |
| ziggit | 442ms | 432ms | 434ms | **436ms** |

**Parallel result**: git CLI wins 1.23x (per-process overhead in ziggit CLI; in-process library would eliminate this).

## findCommit: In-Process (1000 iterations)

| Repo | git rev-parse | ziggit findCommit | Speedup |
|------|--------------|-------------------|---------|
| debug | 2,204µs | 5.0µs | **441x** |
| semver | 2,215µs | 7.0µs | **316x** |
| chalk | 2,126µs | 4.9µs | **434x** |
| is | 2,099µs | 5.3µs | **396x** |
| express | 2,158µs | 5.2µs | **415x** |
| **Average** | **2,160µs** | **5.5µs** | **400x** |

## Bun Install Baseline (stock bun 1.3.11)

| Metric | Value |
|--------|-------|
| Cold install (avg, 3 runs) | 494ms |
| Cold install (median) | 494ms |
| Warm install (avg) | 39ms |
| Total packages resolved | 266 |

## Trend (last 5 runs)

| Metric | Run 27 | Run 28 | Run 29 | **Run 30** |
|--------|--------|--------|--------|------------|
| Seq clone ratio | 1.04x | 1.07x | 1.03x | **1.04x** |
| findCommit speedup | 394x | 422x | 416x | **400x** |
| debug clone speedup | 1.67x | 1.82x | 1.72x | **1.81x** |
| Bun cold median | 557ms | 617ms | 464ms | **494ms** |
