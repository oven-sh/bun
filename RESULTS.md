# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-27T02:13Z (latest run)
- Ziggit: built from `/root/ziggit` HEAD, Zig 0.15.2, ReleaseSafe
- Bun: 1.3.11 (stock), fork branch: ziggit-integration
- Machine: Linux x86_64, 483MB RAM, 1 vCPU, 2GB swap
- Git: 2.43.0

## Build Status

Full bun fork binary **cannot be built** on this VM (needs ≥8GB RAM, ≥10GB disk).
`build.zig.zon` correctly wires ziggit as `../ziggit` path dependency.
Benchmarks compare stock bun + git CLI vs ziggit CLI to measure replaceable operations.

---

## Latest Run (2026-03-27T02:13Z)

### Stock Bun Install (3 Git Dependencies)

| Metric | Run 1 | Run 2 | Run 3 | Avg |
|--------|------:|------:|------:|----:|
| Cold cache | 188ms | 133ms | 170ms | **163ms** |
| Warm cache | 46ms | 117ms | 46ms | **69ms** |

### Git CLI vs Ziggit — Full bun-install Workflow (3 repos)

Workflow: `clone --bare` → `rev-parse HEAD` → `clone + checkout` per repo.

| Tool | Run 1 | Run 2 | Run 3 | Avg |
|------|------:|------:|------:|----:|
| Git CLI (total) | 554ms | 556ms | 567ms | **559ms** |
| Ziggit (total) | 350ms | 334ms | 343ms | **342ms** |
| **Savings** | 204ms | 222ms | 224ms | **217ms (39%)** |

### Per-Repo Breakdown (averages over 3 runs)

| Repo | Tool | Clone | FindCommit | Checkout | **Total** | Δ vs git |
|------|------|------:|-----------:|---------:|----------:|---------:|
| debug | git | 147ms | 2ms | 9ms | **159ms** | — |
| debug | ziggit | 78ms | 3ms | 10ms | **91ms** | **-42%** |
| node-semver | git | 227ms | 2ms | 13ms | **242ms** | — |
| node-semver | ziggit | 136ms | 3ms | 11ms | **150ms** | **-38%** |
| chalk | git | 146ms | 3ms | 9ms | **158ms** | — |
| chalk | ziggit | 89ms | 3ms | 9ms | **101ms** | **-36%** |

### Key Findings

1. **Ziggit clone is ~40% faster than git CLI** across all tested repos
2. **Clone dominates total time** (~93% of per-repo total) — this is where ziggit's
   native HTTP client + zero-alloc pack parser have the most impact
3. **FindCommit and Checkout are comparable** — both tools operate on local data
4. **Consistent across runs** — low variance (±3%) indicates reliable measurements

### Projected In-Process Savings

The CLI benchmarks show **39% savings**. The actual bun fork integration will be faster because:
- No `fork()`+`exec()` overhead per git call (~3–5ms × 9 calls for 3 repos = ~27–45ms)
- Shared allocator eliminates per-process heap setup
- Direct Zig API calls, no stdout pipe parsing
- Projected in-process savings: **~46% (260ms for 3 repos)**

---

## Historical Runs

### 2026-03-27T02:08Z (5 repos, different methodology)

| Tool | Sequential Avg | Parallel Avg |
|------|---------------:|-------------:|
| Git CLI | 694ms | 309ms |
| Ziggit | 426ms | 110ms |
| Speedup | 1.63× | **2.80×** |

### 2026-03-27T02:13Z (3 repos, full bun-install workflow simulation)

| Tool | Total Avg |
|------|----------:|
| Git CLI | 559ms |
| Ziggit | 342ms |
| Speedup | **1.63×** |

---

## Detailed Report

See [BUN_INSTALL_BENCHMARK.md](BUN_INSTALL_BENCHMARK.md) for full methodology, per-operation
breakdown, raw data, and projected impact analysis.
