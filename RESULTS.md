# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-27T00:35Z (latest run)
- Ziggit: built from /root/ziggit (master, commit 8e56d05), ReleaseFast, zig 0.15.2
- Bun: 1.3.11 (stock), fork branch: ziggit-integration
- Machine: Linux x86_64, 483MB RAM, 1 vCPU, 2GB swap
- Git: 2.43.0

## Build Status

Full bun fork binary **cannot be built** on this VM (needs ≥8GB RAM, ≥15GB disk, Zig 0.14.x).
`build.zig.zon` correctly wires ziggit as `../ziggit` path dependency.
Benchmarks compare stock bun + git CLI vs ziggit CLI to measure replaceable operations.

---

## Latest Run (2026-03-27T00:35Z)

### Stock Bun Install (5 Git Dependencies → 69 Total Packages)

| Scenario | Run 1 | Run 2 | Run 3 | **Avg (2-3)** |
|----------|-------|-------|-------|---------------|
| Cold (no cache) | 1472ms* | 356ms | 404ms | **380ms** |
| Warm (cache present) | 88ms | 81ms | 88ms | **86ms** |

*Run 1 includes DNS/TLS warmup.

### Clone-Only: Ziggit vs Git CLI (5 repos, bare --depth=1)

| Repo | Git CLI | Ziggit | Speedup |
|------|---------|--------|---------|
| is | 131ms | 76ms | 42% faster |
| express | 166ms | 106ms | 36% faster |
| chalk | 126ms | 82ms | 35% faster |
| debug | 115ms | 68ms | 41% faster |
| semver | 129ms | 84ms | 35% faster |
| **TOTAL** | **667ms** | **416ms** | **38% faster** |

### Full Workflow: Clone + rev-parse + ls-tree + cat-file ALL Files

| Repo (files) | Git CLI | Ziggit CLI | Notes |
|-------------|---------|------------|-------|
| is (15) | 157ms | 113ms | ziggit 28% faster |
| express (213) | 423ms | 492ms | git 14% faster (cat-file spawn overhead) |
| chalk (34) | 175ms | 152ms | ziggit 13% faster |
| debug (13) | 137ms | 99ms | ziggit 28% faster |
| semver (151) | 313ms | 360ms | git 13% faster (cat-file spawn overhead) |
| **TOTAL** | **1204ms** | **1214ms** | **~even** |

### Key Insight: CLI Spawn Overhead Cancels Clone Gains

Ziggit wins 38% on clone but loses on per-file extraction (213+151 files × 1ms extra spawn = ~364ms overhead). In library mode (integrated into bun), **all 441 process spawns become zero-cost function calls**.

### Library-Mode Projection

| Component | CLI mode | Library mode | Savings |
|-----------|----------|--------------|---------|
| Clone (network) | 416ms | 416ms | 0ms |
| rev-parse + ls-tree | 33ms | <2ms | ~31ms |
| cat-file × 426 | 764ms | <5ms | ~759ms |
| **TOTAL** | **1214ms** | **~422ms** | **65% faster** |

### Projected bun+ziggit Cold Install

| | Stock bun | Bun + ziggit | Improvement |
|---|-----------|-------------|-------------|
| Cold cache | 380ms | ~220ms | **~42% faster** |
| Warm cache | 86ms | ~86ms | Same |

---

## Reproduction

```bash
cd /root/ziggit && zig build -Doptimize=ReleaseFast
bash /root/bun-fork/benchmark/bun_install_bench.sh
```

Full details: [BUN_INSTALL_BENCHMARK.md](BUN_INSTALL_BENCHMARK.md)
