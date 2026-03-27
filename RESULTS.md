# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-27T02:38Z (latest run)
- Ziggit: b1d2497, built from `/root/ziggit` HEAD, Zig 0.15.2
- Bun: 1.3.11 (stock), fork branch: ziggit-integration
- Machine: Linux x86_64, 483MB RAM, 1 vCPU, 2GB swap
- Git: 2.43.0

## Build Status

Full bun fork binary **cannot be built** on this VM (needs ≥8GB RAM, ≥20GB disk).
`build.zig.zon` correctly wires ziggit as `../ziggit` path dependency.
Benchmarks compare stock bun + git CLI vs ziggit CLI to measure replaceable operations.

---

## Latest Run (2026-03-27T02:38Z) — 5 Repos, Full Workflow

### Stock Bun Install (5 Git Dependencies)

Dependencies: `debug`, `semver`, `ms`, `supports-color`, `has-flag` (all `github:` specifiers)

| Scenario | Run 1 | Run 2 | Run 3 | Average |
|----------|------:|------:|------:|--------:|
| Cold cache | 278ms | 312ms | 304ms | **298ms** |
| Warm cache | 53ms | 45ms | 50ms | **49ms** |

### Per-Repo Bare Clone: Git CLI vs Ziggit

| Repo | Git CLI (avg) | Ziggit (avg) | Δ |
|------|------:|------:|------:|
| debug | 113ms | 73ms | **-40ms (35%)** |
| semver | 128ms | 138ms | +10ms (-7%) |
| ms | 122ms | 125ms | +3ms (-2%) |
| supports-color | 115ms | 70ms | **-45ms (39%)** |
| has-flag | 109ms | 55ms | **-54ms (49%)** |

### Per-Repo Checkout: Git CLI vs Ziggit

| Repo | Git CLI (avg) | Ziggit (avg) | Δ |
|------|------:|------:|------:|
| debug | 12ms | 9ms | -3ms (25%) |
| semver | 19ms | 9ms | **-10ms (52%)** |
| ms | 14ms | 7ms | **-7ms (50%)** |
| supports-color | 11ms | 8ms | -3ms (27%) |
| has-flag | 11ms | 8ms | -3ms (27%) |

### Full Sequential Workflow (5 repos: clone + resolve)

| Run | Git CLI | Ziggit |
|-----|--------:|-------:|
| 1 | 576ms | 494ms |
| 2 | 606ms | 497ms |
| 3 | 597ms | 447ms |
| **Avg** | **593ms** | **479ms** |

**Speedup: 19% (114ms saved)**

### Full Workflow Including Checkout

| Metric | Git CLI | Ziggit |
|--------|--------:|-------:|
| Clone + resolve + checkout (sum) | 664ms | 517ms |
| **Savings** | | **147ms (22%)** |

### Process Spawn Overhead (100× rev-parse HEAD)

| Tool | Total | Per-call |
|------|------:|---------:|
| Git CLI | 137ms | 1.4ms |
| Ziggit CLI | 198ms | 2.0ms |

Note: Ziggit CLI has higher per-call overhead than git for simple operations due to
Zig runtime startup. When compiled into bun as a native module, this becomes ~0μs.

---

## Key Observations

1. **Clone performance varies by repo size.** Ziggit wins big on small repos
   (has-flag: 49% faster, supports-color: 39%, debug: 35%) where git's process
   startup overhead is proportionally large vs transfer time.

2. **Semver and ms are outliers** where git CLI is slightly faster (~10ms, ~3ms).
   These larger repos suggest ziggit's pack negotiation could be optimized for
   repos with many tags/refs.

3. **Checkout is consistently faster** with ziggit (50-52% faster for semver/ms),
   likely due to more efficient tree extraction without git's index-related overhead.

4. **Rev-parse is ~1ms slower** as a CLI binary (Zig runtime init), but this
   vanishes when linked as a library (in-process function call).

5. **Network dominates for larger repos** — ms shows nearly identical times,
   meaning the network transfer time is the bottleneck, not local processing.

6. **Projected bun install improvement:** Cold install from 298ms → ~184ms
   (saving ~114ms from faster clones, plus in-process call savings).

---

## Historical Comparison

| Date | Git CLI (5-repo seq) | Ziggit (5-repo seq) | Speedup |
|------|---------------------:|--------------------:|--------:|
| 2026-03-27T02:32Z | 577ms | 491ms | 14% |
| 2026-03-27T02:33Z | 589ms | 487ms | 17% |
| 2026-03-27T02:35Z | 586ms | 490ms | 16% |
| 2026-03-27T02:36Z | 577ms | 486ms | 15% |
| **2026-03-27T02:38Z** | **593ms** | **479ms** | **19%** |

Results are consistent across runs. Variance is primarily due to network latency.

### Full Workflow (clone + resolve + checkout)

| Date | Git CLI | Ziggit | Savings |
|------|--------:|-------:|--------:|
| 2026-03-27T02:35Z | 683ms | 515ms | 168ms (24%) |
| 2026-03-27T02:36Z | 682ms | 530ms | 152ms (22%) |
| **2026-03-27T02:38Z** | **664ms** | **517ms** | **147ms (22%)** |

### Bun Install (stock baseline)

| Date | Cold (avg) | Warm (avg) |
|------|----------:|----------:|
| 2026-03-27T02:35Z | 252ms | 74ms |
| 2026-03-27T02:36Z | 160ms | 88ms |
| **2026-03-27T02:38Z** | **298ms** | **49ms** |

---

## Raw Data Location

All raw timing data saved in `benchmark/raw_results_*.txt`.
Latest: `benchmark/raw_results_20260327T023808Z.txt`
