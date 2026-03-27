# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-27T00:44Z (latest run)
- Ziggit: built from `/root/ziggit` HEAD (`6cacbc8`), ReleaseFast, Zig 0.15.2
- Bun: 1.3.11 (stock), fork branch: ziggit-integration
- Machine: Linux x86_64, 483MB RAM, 1 vCPU, 2GB swap
- Git: 2.43.0

## Build Status

Full bun fork binary **cannot be built** on this VM (needs ≥8GB RAM, ≥15GB disk, Zig 0.14.x).
`build.zig.zon` correctly wires ziggit as `../ziggit` path dependency.
Benchmarks compare stock bun + git CLI vs ziggit CLI to measure replaceable operations.

---

## Latest Run (2026-03-27T00:44Z)

### Stock Bun Install (5 Git Dependencies → 69 Total Packages)

| Scenario | Run 1 | Run 2 | Run 3 | **Average** |
|----------|-------|-------|-------|-------------|
| Cold (no cache) | 530ms | 493ms | 491ms | **505ms** |
| Warm (cache present) | 81ms | 90ms | 83ms | **85ms** |

### Clone-Only: Ziggit vs Git CLI (5 repos, bare --depth=1)

| Repo | Git CLI | Ziggit | Speedup |
|------|---------|--------|---------|
| is | 139ms | 79ms | 43% |
| express | 181ms | 113ms | 38% |
| chalk | 130ms | 74ms | 43% |
| debug | 117ms | 62ms | 47% |
| semver | 135ms | 87ms | 36% |
| **TOTAL** | **713ms** | **423ms** | **41%** |

### Full Workflow (clone + rev-parse + ls-tree + cat-file × 426 files)

| Repo | Git CLI | Ziggit | Winner |
|------|---------|--------|--------|
| is (15 files) | 159ms | 113ms | ziggit 29% faster |
| express (213 files) | 422ms | 502ms | git 19% faster |
| chalk (34 files) | 174ms | 148ms | ziggit 15% faster |
| debug (13 files) | 145ms | 98ms | ziggit 32% faster |
| semver (151 files) | 315ms | 357ms | git 13% faster |
| **TOTAL** | **1225ms** | **1228ms** | **~even** |

### Component Breakdown

| Component | Git CLI | Ziggit CLI | Delta |
|-----------|---------|------------|-------|
| Clone (5 repos) | 669ms | 417ms | **-252ms** ✅ |
| rev-parse + ls-tree | ~35ms | ~44ms | +9ms |
| cat-file (426 calls) | 521ms | 768ms | **+247ms** ❌ |
| **Total** | **1225ms** | **1228ms** | +3ms |

### Key Insight

Ziggit's 252ms clone advantage is cancelled by 247ms of process-spawn overhead across 426 cat-file invocations (1.80ms vs 1.22ms per call). In library mode, cat-file becomes a zero-cost function call.

### Projections (Library Mode)

| Metric | Value |
|--------|-------|
| Full workflow (library) | **~424ms** (vs 1225ms git CLI = **65% faster**) |
| `bun install` cold | **~320ms** (vs 505ms stock = **37% faster**) |
| `bun install` warm | ~85ms (no change, no git ops) |

---

## Detailed benchmark: [BUN_INSTALL_BENCHMARK.md](./BUN_INSTALL_BENCHMARK.md)
## Benchmark script: [benchmark/bun_install_bench.sh](./benchmark/bun_install_bench.sh)
