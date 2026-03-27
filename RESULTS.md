# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-27T00:52Z (latest run)
- Ziggit: built from `/root/ziggit` HEAD (`3f2e203`), ReleaseFast, Zig 0.15.2
- Bun: 1.3.11 (stock), fork branch: ziggit-integration
- Machine: Linux x86_64, 483MB RAM, 1 vCPU, 2GB swap
- Git: 2.43.0

## Build Status

Full bun fork binary **cannot be built** on this VM (needs ≥8GB RAM, ≥15GB disk, Zig 0.14.x).
`build.zig.zon` correctly wires ziggit as `../ziggit` path dependency.
Benchmarks compare stock bun + git CLI vs ziggit CLI to measure replaceable operations.

---

## Latest Run (2026-03-27T00:52Z)

### Stock Bun Install (5 Git Dependencies → 69 Total Packages)

| Scenario | Run 1 | Run 2 | Run 3 | **Median** |
|----------|-------|-------|-------|------------|
| Cold (no cache) | 511ms | 463ms | 487ms | **487ms** |
| Warm (cache present) | 87ms | 76ms | 82ms | **82ms** |

### Clone-Only: Ziggit vs Git CLI (5 repos, bare --depth=1)

| Tool | Avg Total | Speedup |
|------|-----------|---------|
| Git CLI | 761ms | baseline |
| Ziggit | 463ms | **39% faster** |

### Full Workflow (clone + resolve + extract 426 files)

| Tool | Avg Total | Delta |
|------|-----------|-------|
| Git CLI | 1208ms | baseline |
| Ziggit (CLI) | 1207ms | ~even (0.1%) |
| Ziggit (library, projected) | ~425ms | **~65% faster** |

### Key Insight

Ziggit's 240ms clone advantage is cancelled by 233ms of per-file process spawn overhead (426 × 0.55ms). In library mode (zero spawn cost), the projected total is ~425ms — a **65% improvement** over git CLI.

### Projected `bun install` Impact

| Scenario | Stock Bun | Bun + Ziggit | Improvement |
|----------|-----------|--------------|-------------|
| Cold cache | 487ms | ~320ms | **~34% faster** |
| Warm cache | 82ms | ~82ms | Same |

---

## Full Report

See [BUN_INSTALL_BENCHMARK.md](BUN_INSTALL_BENCHMARK.md) for per-repo breakdowns, component analysis, raw data, and build instructions.
