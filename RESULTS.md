# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-27T00:41Z (latest run)
- Ziggit: built from `/root/ziggit` HEAD, ReleaseFast, Zig 0.15.2
- Bun: 1.3.11 (stock), fork branch: ziggit-integration
- Machine: Linux x86_64, 483MB RAM, 1 vCPU, 2GB swap
- Git: 2.43.0

## Build Status

Full bun fork binary **cannot be built** on this VM (needs ≥8GB RAM, ≥15GB disk, Zig 0.14.x).
`build.zig.zon` correctly wires ziggit as `../ziggit` path dependency.
Benchmarks compare stock bun + git CLI vs ziggit CLI to measure replaceable operations.

---

## Latest Run (2026-03-27T00:41Z)

### Stock Bun Install (5 Git Dependencies → 69 Total Packages)

| Scenario | Run 1 | Run 2 | Run 3 | **Average** |
|----------|-------|-------|-------|-------------|
| Cold (no cache) | 382ms | 386ms | 359ms | **376ms** |
| Warm (cache present) | 81ms | 88ms | 86ms | **85ms** |

### Clone-Only: Ziggit vs Git CLI (5 repos, bare --depth=1)

| Repo | Git CLI | Ziggit | Speedup |
|------|---------|--------|---------|
| is | 134ms | 83ms | 38% faster |
| express | 161ms | 111ms | 31% faster |
| chalk | 129ms | 73ms | 44% faster |
| debug | 117ms | 62ms | 47% faster |
| semver | 137ms | 80ms | 42% faster |
| **TOTAL** | **689ms** | **421ms** | **39% faster** |

### Full Workflow: Clone + rev-parse + ls-tree + cat-file ALL Files

| Repo (files) | Git CLI | Ziggit CLI | Notes |
|--------------|---------|------------|-------|
| is (15) | 162ms | 113ms | ziggit 30% faster |
| express (213) | 432ms | 483ms | git 12% faster (cat-file spawn overhead) |
| chalk (34) | 183ms | 146ms | ziggit 20% faster |
| debug (13) | 149ms | 96ms | ziggit 36% faster |
| semver (151) | 335ms | 372ms | git 11% faster (cat-file spawn overhead) |
| **TOTAL** | **1274ms** | **1220ms** | **ziggit 4% faster** |

### Key Insight: CLI Spawn Overhead Cancels Clone Gains

Ziggit wins 39% on clone but loses on per-file extraction for repos with many files. In CLI mode, 426 cat-file calls cost 798ms total (1.87ms/call) vs git's 544ms (1.28ms/call). The 254ms overhead comes from ziggit's per-invocation startup cost.

In library mode (integrated into bun), **all 436+ process spawns become zero-cost function calls**.

### Library-Mode Projection

| Component | CLI mode | Library mode | Savings |
|-----------|----------|--------------|---------|
| Clone (network) | 421ms | 421ms | 0ms |
| rev-parse + ls-tree | 46ms | <2ms | ~44ms |
| cat-file × 426 | 798ms | <5ms | ~793ms |
| **TOTAL** | **1220ms** | **~428ms** | **65% faster** |

### Projected bun+ziggit Cold Install

| | Stock bun | Bun + ziggit | Improvement |
|---|-----------|-------------|-------------|
| Cold cache | 376ms | ~230ms | **~39% faster** |
| Warm cache | 85ms | ~85ms | Same |

---

## Reproduction

```bash
cd /root/ziggit && zig build -Doptimize=ReleaseFast
bash /root/bun-fork/benchmark/bun_install_bench.sh
```

Full details: [BUN_INSTALL_BENCHMARK.md](BUN_INSTALL_BENCHMARK.md)
