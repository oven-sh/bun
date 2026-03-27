# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-27T01:22Z (latest run)
- Ziggit: built from `/root/ziggit` HEAD (69401f8), ReleaseFast, Zig 0.15.2
- Bun: 1.3.11 (stock), fork branch: ziggit-integration
- Machine: Linux x86_64, 483MB RAM, 1 vCPU, 2GB swap
- Git: 2.43.0

## Build Status

Full bun fork binary **cannot be built** on this VM (needs ≥8GB RAM, ≥15GB disk, Zig 0.14.x).
`build.zig.zon` correctly wires ziggit as `../ziggit` path dependency.
Benchmarks compare stock bun + git CLI vs ziggit CLI to measure replaceable operations.

---

## Latest Run (2026-03-27T01:22Z)

### Stock Bun Install (5 Git Dependencies → 266 Total Packages)

| Scenario | Run 1 | Run 2 | Run 3 | Median |
|----------|-------|-------|-------|--------|
| Cold cache | 3,073ms | 1,574ms | 918ms | **1,574ms** |
| Warm cache | 77ms | 80ms | 84ms | **80ms** |

### Clone: Ziggit vs Git CLI (5 repos, bare --depth=1)

| Tool | Run 1 | Run 2 | Run 3 | Median | Speedup |
|------|-------|-------|-------|--------|---------|
| Git CLI | 693ms | 647ms | 663ms | **663ms** | baseline |
| Ziggit | 403ms | 425ms | 415ms | **415ms** | **1.60x (37% faster)** |

### Full Workflow: clone + rev-parse + ls-tree + cat-file (426 files)

| Tool | Run 1 | Run 2 | Run 3 | Median | Notes |
|------|-------|-------|-------|--------|-------|
| Git CLI | 1,179ms | 1,190ms | 1,189ms | **1,189ms** | baseline |
| Ziggit CLI | 1,209ms | 1,221ms | 1,182ms | **1,209ms** | parity (spawn overhead) |
| Ziggit Library (projected) | — | — | — | **~520ms** | **~2.3x faster** |

### Spawn Overhead (200 iterations)

| Metric | Value |
|--------|-------|
| git spawn | 0.96ms/call |
| ziggit spawn | 1.47ms/call |
| Delta per call | +0.51ms |
| Delta × 426 files | +218ms |

### Per-Repo Clone Breakdown (medians)

| Repo | Files | Git CLI | Ziggit | Speedup |
|------|-------|---------|--------|---------|
| sindresorhus/is | 15 | 137ms | 78ms | 1.76x |
| expressjs/express | 213 | 160ms | 110ms | 1.45x |
| chalk/chalk | 34 | 121ms | 79ms | 1.53x |
| debug-js/debug | 13 | 114ms | 67ms | 1.70x |
| npm/node-semver | 151 | 131ms | 74ms | 1.77x |

---

## Summary

| Metric | Value |
|--------|-------|
| Clone speedup (measured) | **1.60x** |
| Full workflow CLI (measured) | **parity** (spawn overhead neutralizes clone gains) |
| Full workflow library (projected) | **~2.3x faster** |
| Projected bun install cold | **~1.7x faster** (~905ms vs 1,574ms) |
| Projected bun install warm | **no change** (80ms, git deps cached) |
| Key bottleneck | Per-blob cat-file process spawning (426 spawns = 218ms overhead) |
| Key win | Library integration eliminates all spawn overhead |

---

*Full details: [BUN_INSTALL_BENCHMARK.md](BUN_INSTALL_BENCHMARK.md)*
*Raw data: `benchmark/raw_results_20260327T012244Z.txt`*
*Benchmark script: `benchmark/bun_install_bench.sh`*
