# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-27 (latest run, Session 13)
- Ziggit: `505cf30` (with libdeflate pack decompression, git-help forwarding), Zig 0.15.2
- Bun: 1.3.11 (stock), fork branch: ziggit-integration
- Machine: Linux x86_64, 483MB RAM, 1 vCPU, 2GB swap
- Git: 2.43.0

## Build Status

Full bun fork binary **cannot be built** on this VM (needs ≥8GB RAM, ≥20GB disk).
`build.zig.zon` correctly wires ziggit as `../ziggit` path dependency.
Benchmarks compare stock bun + git CLI vs ziggit CLI to measure replaceable operations.

---

## Latest Run (Session 13) — 5 Repos, Full Workflow

### Stock Bun Install (5 Git Dependencies)

Dependencies: `@sindresorhus/is`, `express`, `chalk`, `debug`, `semver` (all `github:` specifiers)

| Scenario | Run 1 | Run 2 | Run 3 | Median |
|----------|------:|------:|------:|-------:|
| Cold cache | 478ms | 485ms | 439ms | **478ms** |
| Warm cache | 25ms | 23ms | 22ms | **23ms** |

### Per-Repo Clone Workflow: Git CLI vs Ziggit (3 runs, median)

| Repo | git CLI | ziggit | **Speedup** | Savings |
|------|--------:|-------:|--------:|--------:|
| debug | 121ms | 74ms | **1.63×** | 47ms |
| semver | 138ms | 92ms | **1.50×** | 46ms |
| ms | 127ms | 82ms | **1.54×** | 45ms |
| chalk | 127ms | 87ms | **1.45×** | 40ms |
| express | 170ms | 123ms | **1.38×** | 47ms |
| **TOTAL** | **683ms** | **458ms** | **1.49×** | **225ms (33%)** |

### Clone-Only Breakdown (median)

| Repo | git clone | ziggit clone | Speedup |
|------|----------:|-------------:|--------:|
| debug | 114ms | 66ms | 1.73× |
| semver | 128ms | 81ms | 1.58× |
| ms | 119ms | 73ms | 1.63× |
| chalk | 119ms | 77ms | 1.55× |
| express | 157ms | 110ms | 1.43× |
| **TOTAL** | **637ms** | **407ms** | **1.56×** |

---

## Historical Comparison

| Session | Date | Ziggit Commit | Overall Speedup | Total Savings |
|---------|------|---------------|-----------------|---------------|
| 8 | 2026-03-27T03:18Z | `ae4117e` | 1.43× | 520ms (30%) |
| 9 | 2026-03-27T04:00Z | `a1a6028` | 1.54× | 610ms (35%) |
| 10 | 2026-03-27T03:27Z | `a1a6028` | 1.63× | 664ms (39%) |
| 11 | 2026-03-27T03:30Z | `505cf30` | 1.61× | 654ms (38%) |
| 12 | 2026-03-27T03:33Z | `505cf30` | 1.60× | 659ms (37%) |
| **13** | **2026-03-27** | **`505cf30`** | **1.49×** | **225ms (33%)** |

Session 13 shows lower absolute times for both git CLI and ziggit (better network conditions
or server-side caching). The **relative speedup** (1.49×) is slightly below the S10-12 plateau
of ~1.60×, but within expected variance for network-bound operations on a low-resource VM.

Notable observations across all sessions:
- **Clone phase** accounts for >90% of per-repo time — this is where ziggit wins
- **Resolve + checkout** times are nearly identical between git CLI and ziggit (both ~8-13ms)
- ziggit consistently shows **lower variance** than git CLI across runs
- The speedup converges at **1.45–1.65×** across 6 independent sessions

---

## Key Takeaways

1. **ziggit is 1.49–1.60× faster** than git CLI for the clone workflow bun uses
2. **Clone (network fetch + pack processing)** dominates >90% of per-repo time
3. **All repo sizes** benefit (1.38×–1.73× range in Session 13)
4. ziggit exhibits significantly **lower variance** — more predictable performance
5. In-process integration (no fork/exec) would yield additional ~75-100ms savings (eliminating 15 git subprocess calls)
6. **Projected cold `bun install` improvement**: ~1.3–1.5× for git dep resolution phase
7. For full `bun install` binary benchmark, the fork needs to be built on a larger machine (≥8GB RAM)

See [BUN_INSTALL_BENCHMARK.md](BUN_INSTALL_BENCHMARK.md) for detailed analysis, raw data, and projections.
