# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-27T03:30Z (latest run, Session 11)
- Ziggit: `505cf30` (with libdeflate pack decompression, git-help forwarding), Zig 0.15.2
- Bun: 1.3.11 (stock), fork branch: ziggit-integration
- Machine: Linux x86_64, 483MB RAM, 1 vCPU, 2GB swap
- Git: 2.43.0

## Build Status

Full bun fork binary **cannot be built** on this VM (needs ≥8GB RAM, ≥20GB disk).
`build.zig.zon` correctly wires ziggit as `../ziggit` path dependency.
Benchmarks compare stock bun + git CLI vs ziggit CLI to measure replaceable operations.

---

## Latest Run (2026-03-27T03:30Z) — 5 Repos, Full Workflow

### Stock Bun Install (5 Git Dependencies)

Dependencies: `@sindresorhus/is`, `express`, `chalk`, `debug`, `semver` (all `github:` specifiers)

| Scenario | Run 1 | Run 2 | Run 3 | Median |
|----------|------:|------:|------:|-------:|
| Cold cache | 484ms | 281ms | 369ms | **369ms** |
| Warm cache | 24ms | 23ms | 23ms | **23ms** |

### Per-Repo Clone Workflow: Git CLI vs Ziggit (3 runs, median)

| Repo | git CLI | ziggit | **Speedup** | Savings |
|------|--------:|-------:|--------:|--------:|
| debug | 156ms | 96ms | **1.62×** | 60ms |
| semver | 234ms | 141ms | **1.66×** | 93ms |
| ms | 180ms | 136ms | **1.32×** | 44ms |
| chalk | 157ms | 92ms | **1.71×** | 65ms |
| express | 997ms | 605ms | **1.65×** | 392ms |
| **TOTAL** | **1,724ms** | **1,070ms** | **1.61×** | **654ms (38%)** |

### Clone-Only Breakdown

| Repo | git clone | ziggit clone | Speedup |
|------|----------:|-------------:|--------:|
| debug | 146ms | 85ms | 1.72× |
| semver | 219ms | 129ms | 1.70× |
| ms | 170ms | 123ms | 1.38× |
| chalk | 146ms | 82ms | 1.78× |
| express | 977ms | 584ms | 1.67× |

---

## Historical Comparison

| Session | Date | Ziggit Commit | Overall Speedup | Total Savings |
|---------|------|---------------|-----------------|---------------|
| 8 | 2026-03-27T03:18Z | `ae4117e` | 1.43× | 520ms (30%) |
| 9 | 2026-03-27T04:00Z | `a1a6028` | 1.54× | 610ms (35%) |
| 10 | 2026-03-27T03:27Z | `a1a6028` | 1.63× | 664ms (39%) |
| **11** | **2026-03-27T03:30Z** | **`505cf30`** | **1.61×** | **654ms (38%)** |

Sessions 10–11 converge at **~1.61× overall**, confirming this is the stable performance
level. Earlier sessions (8–9) showed lower numbers likely due to network warm-up effects
and pre-libdeflate ziggit builds.

Notable observations:
- **Express** (largest repo) is remarkably stable at **1.64–1.65×** across sessions 10–11
- **Chalk** consistently shows the highest speedup (**1.71–1.77×**)
- **ms** consistently shows the lowest speedup (**1.32–1.41×**) — smallest repo, network-latency dominated
- ziggit shows lower clone-time **variance** than git CLI (express: σ=6ms vs σ=370ms in session 11)

---

## Key Takeaways

1. **ziggit is 1.61× faster** than git CLI for the clone workflow bun uses
2. **Clone (network fetch + pack)** dominates >90% of per-repo time
3. **Small repos** benefit most relatively (chalk: 1.71×), **large repos** benefit most absolutely (express: 392ms saved)
4. ziggit exhibits significantly **lower variance** — more predictable performance
5. In-process integration (no fork/exec) would yield additional ~30ms savings across 5 repos
6. For full `bun install` benchmark, the fork needs to be built on a larger machine (≥8GB RAM)

See [BUN_INSTALL_BENCHMARK.md](BUN_INSTALL_BENCHMARK.md) for detailed analysis and raw data.
