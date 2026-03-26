# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-26T22:38Z (run 29 — ziggit 95b31d8)
- Ziggit commit: 95b31d8 (perf: increase decompression buffer to 32KB for fewer iterations in idx generation)
- Bun fork branch: ziggit-integration
- Machine: Linux (root@ziggit), 483MB RAM, 1 vCPU, Debian (minimal VM)
- Build: `zig build -Doptimize=ReleaseFast`

## Clone Benchmarks (bare clone, --depth=1)

### Sequential: 5 repos, 3 runs each

| Repo | git CLI avg | ziggit avg | Ratio |
|------|------------|-----------|-------|
| debug | 137ms | 80ms | **1.72x faster** |
| semver | 173ms | 177ms | 0.98x (even) |
| chalk | 154ms | 126ms | **1.22x faster** |
| is | 171ms | 147ms | **1.16x faster** |
| express | 196ms | 277ms | 0.71x (slower) |
| **TOTAL** | **904ms** | **879ms** | **1.03x faster** |

### Parallel: 5 repos at once, 3 runs

| Tool | Run 1 | Run 2 | Run 3 | Avg |
|------|-------|-------|-------|-----|
| git CLI | 374ms | 360ms | 356ms | **363ms** |
| ziggit | 453ms | 448ms | 454ms | **452ms** |

**Parallel result**: git CLI wins 1.24x (per-process overhead in ziggit CLI; in-process library would eliminate this).

## findCommit: In-Process (1000 iterations)

| Repo | git rev-parse | ziggit findCommit | Speedup |
|------|--------------|-------------------|---------|
| debug | 2,204µs | 5.1µs | **432x** |
| semver | 2,139µs | 5.5µs | **389x** |
| chalk | 2,164µs | 5.2µs | **416x** |
| is | 2,179µs | 5.1µs | **427x** |
| express | 2,127µs | 5.1µs | **417x** |
| **Average** | **2,163µs** | **5.2µs** | **416x** |

## Bun Install Baseline (stock bun 1.3.11)

| Metric | Value |
|--------|-------|
| Cold install (avg, 3 runs) | 435ms |
| Cold install (median) | 464ms |
| Warm install (avg) | 34ms |
| Total packages resolved | 266 |

## Trend (last 4 runs)

| Metric | Run 26 | Run 27 | Run 28 | Run 29 |
|--------|--------|--------|--------|--------|
| Seq clone ratio | 1.01x | 1.04x | 1.07x | **1.03x** |
| findCommit speedup | 405x | 394x | 422x | **416x** |
| debug clone speedup | 1.39x | 1.67x | 1.82x | **1.72x** |
| Bun cold median | — | 557ms | 617ms | **464ms** |
