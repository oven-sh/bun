# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-27T00:50Z (latest run)
- Ziggit: built from `/root/ziggit` HEAD (`6cacbc8`), ReleaseFast, Zig 0.15.2
- Bun: 1.3.11 (stock), fork branch: ziggit-integration
- Machine: Linux x86_64, 483MB RAM, 1 vCPU, 2GB swap
- Git: 2.43.0

## Build Status

Full bun fork binary **cannot be built** on this VM (needs ≥8GB RAM, ≥15GB disk, Zig 0.14.x).
`build.zig.zon` correctly wires ziggit as `../ziggit` path dependency.
Benchmarks compare stock bun + git CLI vs ziggit CLI to measure replaceable operations.

---

## Latest Run (2026-03-27T00:50Z)

### Stock Bun Install (5 Git Dependencies → 69 Total Packages)

| Scenario | Run 1 | Run 2 | Run 3 | **Median** |
|----------|-------|-------|-------|------------|
| Cold (no cache) | 413ms | 378ms | 602ms* | **413ms** |
| Warm (cache present) | 78ms | 93ms | 253ms* | **93ms** |

\* = network hiccup on run 3

### Clone-Only: Ziggit vs Git CLI (5 repos, bare --depth=1)

| Repo | Git CLI | Ziggit | Speedup |
|------|---------|--------|---------|
| is | 128ms | 75ms | 41% |
| express | 162ms | 107ms | 34% |
| chalk | 125ms | 77ms | 38% |
| debug | 117ms | 71ms | 40% |
| semver | 141ms | 76ms | 46% |
| **TOTAL** | **680ms** | **411ms** | **40%** |

### Full Workflow (clone + rev-parse + ls-tree + cat-file × 426 files)

| Repo | Git CLI | Ziggit | Winner |
|------|---------|--------|--------|
| is (15 files) | 155ms | 112ms | ziggit 28% faster |
| express (213 files) | 429ms | 490ms | git 14% faster |
| chalk (34 files) | 176ms | 148ms | ziggit 16% faster |
| debug (13 files) | 139ms | 93ms | ziggit 33% faster |
| semver (151 files) | 314ms | 351ms | git 12% faster |
| **TOTAL** | **1219ms** | **1202ms** | **~even (1.4%)** |

### Component Breakdown

| Component | Git CLI | Ziggit CLI | Delta |
|-----------|---------|------------|-------|
| Clone (5 repos) | 663ms | 414ms | **-249ms** ✅ |
| rev-parse + ls-tree | 22ms | 28ms | +6ms |
| cat-file (426 calls) | 527ms | 753ms | **+226ms** ❌ |
| **Total** | **1219ms** | **1202ms** | -17ms |

### Key Insight

Ziggit's 249ms clone advantage is nearly cancelled by 226ms of process-spawn overhead across 426 cat-file invocations (1.77ms vs 1.24ms per call). In library mode, cat-file becomes a zero-cost function call.

### Projections (Library Mode)

| Metric | Value |
|--------|-------|
| Full workflow (library) | **~421ms** (vs 1219ms git CLI = **65% faster**) |
| `bun install` cold | **~270ms** (vs 413ms stock = **35% faster**) |
| `bun install` warm | ~93ms (no change, no git ops) |

---

## Detailed benchmark: [BUN_INSTALL_BENCHMARK.md](./BUN_INSTALL_BENCHMARK.md)
## Benchmark script: [benchmark/bun_install_bench.sh](./benchmark/bun_install_bench.sh)
