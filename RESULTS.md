# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-27T00:38Z (latest run)
- Ziggit: v0.3.0, commit 6ba167d, ReleaseFast, Zig 0.15.2
- Bun: 1.3.11 (stock), fork branch: ziggit-integration
- Machine: Linux x86_64, 483MB RAM, 1 vCPU, 2GB swap
- Git: 2.43.0

## Build Status

Full bun fork binary **cannot be built** on this VM (needs ≥8GB RAM, ≥15GB disk, Zig 0.14.x).
`build.zig.zon` correctly wires ziggit as `../ziggit` path dependency.
Benchmarks compare stock bun + git CLI vs ziggit CLI to measure replaceable operations.

---

## Latest Run (2026-03-27T00:38Z)

### Stock Bun Install (5 Git Dependencies → 69 Total Packages)

| Scenario | Run 1 | Run 2 | Run 3 | **Avg (2-3)** |
|----------|-------|-------|-------|---------------|
| Cold (no cache) | 516ms* | 408ms | 418ms | **413ms** |
| Warm (cache present) | 142ms* | 77ms | 81ms | **79ms** |

*Run 1 includes DNS/TLS warmup.

### Clone-Only: Ziggit vs Git CLI (5 repos, bare --depth=1)

| Repo | Git CLI | Ziggit | Speedup |
|------|---------|--------|---------|
| is | 131ms | 80ms | 39% faster |
| express | 164ms | 110ms | 33% faster |
| chalk | 124ms | 77ms | 38% faster |
| debug | 116ms | 67ms | 42% faster |
| semver | 125ms | 80ms | 36% faster |
| **TOTAL** | **660ms** | **414ms** | **37% faster** |

### Full Workflow: Clone + rev-parse + ls-tree + cat-file ALL Files

| Repo (files) | Git CLI | Ziggit CLI | Notes |
|-------------|---------|------------|-------|
| is (15) | 157ms | 116ms | ziggit 26% faster |
| express (213) | 419ms | 489ms | git 14% faster (cat-file spawn overhead) |
| chalk (34) | 170ms | 156ms | ziggit 8% faster |
| debug (13) | 140ms | 102ms | ziggit 27% faster |
| semver (151) | 310ms | 353ms | git 12% faster (cat-file spawn overhead) |
| **TOTAL** | **1205ms** | **1224ms** | **~even** |

### Key Insight: CLI Spawn Overhead Cancels Clone Gains

Ziggit wins 37% on clone but loses on per-file extraction when repos have many files (213+151 = 364 files × ~0.57ms extra spawn = ~207ms overhead). In library mode (integrated into bun), **all 441 process spawns become zero-cost function calls**.

### Library-Mode Projection

| Component | CLI mode | Library mode | Savings |
|-----------|----------|--------------|---------|
| Clone (network) | 414ms | 414ms | 0ms |
| rev-parse + ls-tree | 33ms | <2ms | ~31ms |
| cat-file × 426 | 776ms | <5ms | ~771ms |
| **TOTAL** | **1224ms** | **~420ms** | **66% faster** |

### Projected bun+ziggit Cold Install

| | Stock bun | Bun + ziggit | Improvement |
|---|-----------|-------------|-------------|
| Cold cache | 413ms | ~250ms | **~40% faster** |
| Warm cache | 79ms | ~79ms | Same |

---

## Reproduction

```bash
cd /root/ziggit && zig build -Doptimize=ReleaseFast
bash /root/bun-fork/benchmark/bun_install_bench.sh
```

Full details: [BUN_INSTALL_BENCHMARK.md](BUN_INSTALL_BENCHMARK.md)
