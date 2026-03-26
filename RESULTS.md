# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-26T22:35Z (run 28 — ziggit 95b31d8)
- Ziggit commit: 95b31d8 (perf: increase decompression buffer to 32KB for fewer iterations in idx generation)
- Bun fork branch: ziggit-integration
- Machine: Linux (root@ziggit), 483MB RAM, 1 vCPU, Debian (minimal VM)
- Build: `zig build -Doptimize=ReleaseFast`

## Clone Benchmarks (bare clone, --depth=1)

### Sequential: 5 repos, 3 runs each

| Repo | git CLI avg | ziggit avg | Ratio |
|------|------------|-----------|-------|
| debug | 145ms | 80ms | **1.82x faster** |
| semver | 166ms | 155ms | **1.07x faster** |
| chalk | 153ms | 128ms | **1.20x faster** |
| is | 162ms | 137ms | **1.18x faster** |
| express | 196ms | 270ms | 0.72x (slower) |
| **TOTAL** | **895ms** | **840ms** | **1.07x faster** |

### Parallel: 5 repos at once, 3 runs

| Tool | Run 1 | Run 2 | Run 3 | Avg |
|------|-------|-------|-------|-----|
| git CLI | 362ms | 352ms | 351ms | **355ms** |
| ziggit | 443ms | 455ms | 433ms | **444ms** |

**Parallel result**: git CLI wins 1.25x (per-process overhead in ziggit CLI; in-process library would eliminate this).

## findCommit: In-Process (1000 iterations)

| Repo | git rev-parse | ziggit findCommit | Speedup |
|------|--------------|-------------------|---------|
| debug | 2,190µs | 5.1µs | **429x** |
| semver | 2,186µs | 5.3µs | **412x** |
| chalk | 2,203µs | 5.2µs | **424x** |
| is | 2,195µs | 5.1µs | **430x** |
| express | 2,168µs | 5.2µs | **417x** |
| **Average** | **2,188µs** | **5.2µs** | **422x** |

## Bun Install Baseline (stock bun 1.3.11)

| Metric | Value |
|--------|-------|
| Cold install (avg, 3 runs) | 630ms |
| Cold install (median) | 617ms |
| Warm install (avg) | 33ms |
| Total packages resolved | 266 |

## Trend (last 3 runs)

| Metric | Run 26 | Run 27 | Run 28 |
|--------|--------|--------|--------|
| Seq clone ratio | 1.01x | 1.04x | **1.07x** |
| findCommit speedup | 405x | 394x | **422x** |
| debug clone speedup | 1.39x | 1.67x | **1.82x** |
| Bun cold median | — | 557ms | 617ms |
