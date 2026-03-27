# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-27T04:00Z (latest run, Session 9)
- Ziggit: `a1a6028` (with libdeflate pack decompression), Zig 0.15.2
- Bun: 1.3.11 (stock), fork branch: ziggit-integration
- Machine: Linux x86_64, 483MB RAM, 1 vCPU, 2GB swap
- Git: 2.43.0

## Build Status

Full bun fork binary **cannot be built** on this VM (needs ≥8GB RAM, ≥20GB disk).
`build.zig.zon` correctly wires ziggit as `../ziggit` path dependency.
Benchmarks compare stock bun + git CLI vs ziggit CLI to measure replaceable operations.

---

## Latest Run (2026-03-27T04:00Z) — 5 Repos, Full Workflow

### Stock Bun Install (5 Git Dependencies)

Dependencies: `@sindresorhus/is`, `express`, `chalk`, `debug`, `semver` (all `github:` specifiers)

| Scenario | Run 1 | Run 2 | Run 3 | Median |
|----------|------:|------:|------:|-------:|
| Cold cache | 497ms | 743ms | 373ms | **497ms** |
| Warm cache | 25ms | 23ms | 23ms | **23ms** |

### Per-Repo Clone Workflow: Git CLI vs Ziggit (3 runs, median)

| Repo | git CLI | ziggit | **Speedup** | Savings |
|------|--------:|-------:|--------:|--------:|
| debug | 150ms | 91ms | **1.65×** | 59ms |
| semver | 244ms | 197ms | **1.24×** | 47ms |
| ms | 179ms | 132ms | **1.36×** | 47ms |
| chalk | 163ms | 89ms | **1.83×** | 74ms |
| express | 995ms | 612ms | **1.63×** | 383ms |
| **TOTAL** | **1,731ms** | **1,121ms** | **1.54×** | **610ms (35%)** |

### Clone-Only Breakdown

| Repo | git clone | ziggit clone | Speedup |
|------|----------:|-------------:|--------:|
| debug | 141ms | 81ms | 1.74× |
| semver | 231ms | 187ms | 1.24× |
| ms | 170ms | 124ms | 1.37× |
| chalk | 152ms | 81ms | 1.88× |
| express | 976ms | 592ms | 1.65× |

---

## Historical Comparison

| Session | Date | Ziggit Commit | Overall Speedup | Total Savings |
|---------|------|---------------|-----------------|---------------|
| 8 | 2026-03-27T03:18Z | `ae4117e` | 1.43× | 520ms (30%) |
| **9** | **2026-03-27T04:00Z** | **`a1a6028`** | **1.54×** | **610ms (35%)** |

Session 9 improvement due to ziggit's new **libdeflate** integration for 2-4× faster
pack decompression (`99026dc`), particularly benefiting larger repos (express: 1.34× → 1.63×).

---

## Key Takeaways

1. **ziggit is 1.54× faster** than git CLI for the clone workflow bun uses
2. **Clone (network fetch + pack)** dominates >90% of per-repo time
3. **Small repos** benefit most relatively (chalk: 1.83×), **large repos** benefit most absolutely (express: 383ms saved)
4. In-process integration (no fork/exec) would yield additional ~30ms savings across 5 repos
5. For full `bun install` benchmark, the fork needs to be built on a larger machine (≥8GB RAM)

See [BUN_INSTALL_BENCHMARK.md](BUN_INSTALL_BENCHMARK.md) for detailed analysis and raw data.
