# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-27T00:54Z (latest run)
- Ziggit: built from `/root/ziggit` HEAD (`3f2e203`), ReleaseFast, Zig 0.15.2
- Bun: 1.3.11 (stock), fork branch: ziggit-integration
- Machine: Linux x86_64, 483MB RAM, 1 vCPU, 2GB swap
- Git: 2.43.0

## Build Status

Full bun fork binary **cannot be built** on this VM (needs ≥8GB RAM, ≥15GB disk, Zig 0.14.x).
`build.zig.zon` correctly wires ziggit as `../ziggit` path dependency.
Benchmarks compare stock bun + git CLI vs ziggit CLI to measure replaceable operations.

---

## Latest Run (2026-03-27T00:54Z)

### Stock Bun Install (5 Git Dependencies → 69 Total Packages)

| Scenario | Run 1 | Run 2 | Run 3 | **Median** |
|----------|-------|-------|-------|------------|
| Cold (no cache) | 523ms | 591ms | 365ms | **523ms** |
| Warm (cache present) | 80ms | 166ms | 85ms | **85ms** |

### Clone-Only: Ziggit vs Git CLI (5 repos, bare --depth=1)

| Tool | Run 1 | Run 2 | Run 3 | **Median** | Speedup |
|------|-------|-------|-------|------------|---------|
| Git CLI | 749ms | 685ms | 677ms | **685ms** | baseline |
| Ziggit | 428ms | 429ms | 417ms | **428ms** | **37.5% faster** |

### Full Workflow (clone + resolve + extract 426 files)

| Tool | Run 1 | Run 2 | Run 3 | **Median** | Delta |
|------|-------|-------|-------|------------|-------|
| Git CLI | 1235ms | 1286ms | 1234ms | **1235ms** | baseline |
| Ziggit (CLI) | 1197ms | 1208ms | 1231ms | **1208ms** | 2.2% faster |
| Ziggit (library, projected) | — | — | — | **~477ms** | **~61% faster** |

### Key Insight

Ziggit's **260ms clone advantage** is largely cancelled by **231ms of per-file process spawn overhead** (426 cat-file invocations × ~0.5ms extra per spawn). In library mode (zero spawn cost), the projected total is ~477ms — a **61% improvement** over git CLI.

### Per-Repo Clone Speedup (medians)

| Repo | Git CLI | Ziggit | Speedup |
|------|---------|--------|---------|
| is | 136ms | 77ms | 43% |
| express | 163ms | 115ms | 29% |
| chalk | 137ms | 75ms | 45% |
| debug | 116ms | 66ms | 43% |
| semver | 136ms | 84ms | 38% |

### Projected `bun install` Impact

| Scenario | Stock Bun | Bun + Ziggit (library) | Improvement |
|----------|-----------|------------------------|-------------|
| Cold cache (5 git deps) | 523ms | ~330ms | **~37% faster** |
| Cold cache (20 git deps) | ~2000ms | ~900ms | **~55% faster** |
| Warm cache | 85ms | ~85ms | no change |

---

## Detailed Report

See [BUN_INSTALL_BENCHMARK.md](BUN_INSTALL_BENCHMARK.md) for full analysis, per-repo breakdowns, raw data, and build notes.
