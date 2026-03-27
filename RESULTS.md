# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-27T01:25Z (latest run)
- Ziggit: built from `/root/ziggit` HEAD (8bdce12), Zig 0.15.2
- Bun: 1.3.11 (stock), fork branch: ziggit-integration
- Machine: Linux x86_64, 483MB RAM, 1 vCPU, 2GB swap
- Git: 2.43.0

## Build Status

Full bun fork binary **cannot be built** on this VM (needs ≥8GB RAM, ≥15GB disk, Zig 0.14.x).
`build.zig.zon` correctly wires ziggit as `../ziggit` path dependency.
Benchmarks compare stock bun + git CLI vs ziggit CLI to measure replaceable operations.

---

## Latest Run (2026-03-27T01:25Z)

### Stock Bun Install (5 Git Dependencies → 266 Total Packages)

| Scenario | Run 1 | Run 2 | Run 3 | Median |
|----------|-------|-------|-------|--------|
| Cold cache | 497ms | 407ms | 617ms | **497ms** |
| Warm cache | 76ms | 79ms | 78ms | **78ms** |

### Clone: Ziggit vs Git CLI (5 repos, bare --depth=1)

| Tool | Run 1 | Run 2 | Run 3 | Median | Speedup |
|------|-------|-------|-------|--------|---------|
| Git CLI | 679ms | 630ms | 664ms | **664ms** | baseline |
| Ziggit | 423ms | 407ms | 397ms | **407ms** | **1.63× (38% faster)** |

### Full Workflow: clone + rev-parse + ls-tree + cat-file (426 files)

| Tool | Run 1 | Run 2† | Run 3 | Median | Notes |
|------|-------|--------|-------|--------|-------|
| Git CLI | 1,264ms | 2,328ms† | 1,210ms | **1,264ms** | baseline |
| Ziggit CLI | 1,208ms | 1,252ms | 1,227ms | **1,227ms** | 1.03× (spawn overhead) |
| Ziggit Library (projected) | — | — | — | **~412ms** | **~2.9× faster** |

†Run 2 git had a 1,261ms network outlier on `is` clone; median uses runs 1 & 3.

### Spawn Overhead (200 iterations)

| Metric | Value |
|--------|-------|
| git spawn | 0.93ms/call |
| ziggit spawn | 1.50ms/call |
| Delta per call | +0.57ms |
| Delta × 426 files | +243ms |

### Per-Repo Clone Breakdown (medians across 3 runs)

| Repo | Files | Git CLI | Ziggit | Speedup |
|------|-------|---------|--------|---------|
| sindresorhus/is | 15 | 133ms | 80ms | 1.66× |
| expressjs/express | 213 | 158ms | 109ms | 1.45× |
| chalk/chalk | 34 | 124ms | 72ms | 1.72× |
| debug-js/debug | 13 | 113ms | 70ms | 1.61× |
| npm/node-semver | 151 | 127ms | 81ms | 1.57× |

---

## Summary

| Metric | Value |
|--------|-------|
| Clone speedup (measured) | **1.63×** |
| Clone savings | **257ms** (664 → 407ms for 5 repos) |
| Full workflow CLI (measured) | **1.03×** (spawn overhead neutralizes clone gains) |
| Full workflow library (projected) | **~2.9× faster** (~412ms vs ~1,191ms) |
| Projected bun install cold | **~2.5× faster** (~200ms vs 497ms) |
| Projected bun install warm | **no change** (78ms, git deps cached) |
| Key bottleneck | Per-blob cat-file process spawning (426 spawns = 243ms overhead) |
| Key win | Library integration eliminates all spawn overhead |

---

## Historical Runs

| Date | Clone Speedup | Full Workflow CLI | Notes |
|------|---------------|-------------------|-------|
| 2026-03-27T01:22Z | 1.60× | parity | First run |
| 2026-03-27T01:25Z | 1.63× | 1.03× | Current run, faster network |

---

*Full details: [BUN_INSTALL_BENCHMARK.md](BUN_INSTALL_BENCHMARK.md)*
*Raw data: `benchmark/raw_results_20260327T012542Z.txt`*
*Benchmark script: `benchmark/bun_install_bench.sh`*
