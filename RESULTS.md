# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-27T02:16Z (latest run)
- Ziggit: built from `/root/ziggit` HEAD (b1d2497), Zig 0.15.2, ReleaseSafe
- Bun: 1.3.11 (stock), fork branch: ziggit-integration
- Machine: Linux x86_64, 483MB RAM, 1 vCPU, 2GB swap
- Git: 2.43.0

## Build Status

Full bun fork binary **cannot be built** on this VM (needs ≥8GB RAM, ≥10GB disk).
`build.zig.zon` correctly wires ziggit as `../ziggit` path dependency.
Benchmarks compare stock bun + git CLI vs ziggit CLI to measure replaceable operations.

---

## Latest Run (2026-03-27T02:16Z)

### Stock Bun Install (3 Git Dependencies)

| Metric | Run 1 | Run 2 | Run 3 | Avg |
|--------|------:|------:|------:|----:|
| Cold cache | 173ms | 100ms | 96ms | **123ms** |
| Warm cache | 62ms | 52ms | 45ms | **53ms** |

### Git CLI vs Ziggit — Full bun-install Workflow (3 repos)

Workflow: `clone --bare` → `rev-parse HEAD` → `clone + checkout` per repo.

| Tool | Run 1 | Run 2 | Run 3 | Avg |
|------|------:|------:|------:|----:|
| Git CLI (total) | 570ms | 548ms | 551ms | **555ms** |
| Ziggit (total) | 349ms | 335ms | 350ms | **344ms** |
| **Savings** | 221ms | 213ms | 201ms | **211ms (38%)** |

### Per-Repo Breakdown (averages over 3 runs)

| Repo | Tool | Clone | FindCommit | Checkout | **Total** | Δ vs git |
|------|------|------:|-----------:|---------:|----------:|---------:|
| debug | git | 144ms | 2ms | 8ms | **154ms** | — |
| debug | ziggit | 75ms | 3ms | 10ms | **89ms** | **-42%** |
| node-semver | git | 223ms | 3ms | 13ms | **239ms** | — |
| node-semver | ziggit | 136ms | 3ms | 11ms | **151ms** | **-36%** |
| chalk | git | 150ms | 2ms | 10ms | **162ms** | — |
| chalk | ziggit | 91ms | 3ms | 9ms | **104ms** | **-35%** |

### Key Findings

1. **Ziggit clone is 36–42% faster than git CLI** across all tested repos
2. **Clone dominates total time** (~93% of per-repo total) — this is where ziggit's
   native HTTP client + zero-alloc pack parser have the most impact
3. **FindCommit and Checkout are comparable** — both tools operate on local data
4. **Consistent across runs** — low variance (±5%) indicates reliable measurements

### Projected In-Process Savings

The CLI benchmarks show **38% savings**. The actual bun fork integration will be faster because:
- No `fork()`+`exec()` overhead per git call (~3–5ms × 9 calls for 3 repos = ~27–45ms)
- Shared allocator eliminates per-process heap setup
- Direct Zig API calls, no stdout pipe parsing
- Projected in-process savings: **~45% (~300ms for 3 repos vs 555ms git CLI)**

---

## Historical Runs

### 2026-03-27T02:16Z (3 repos, fixed benchmark script)

| Tool | Total Avg |
|------|----------:|
| Git CLI | 555ms |
| Ziggit | 344ms |
| Speedup | **1.61×** |

### 2026-03-27T02:15Z (3 repos, previous run — had parsing bug)

| Tool | Total Avg |
|------|----------:|
| Git CLI | 568ms |
| Ziggit | ~342ms (from raw data) |
| Speedup | **~1.66×** |

### 2026-03-27T02:13Z (3 repos, original benchmark)

| Tool | Total Avg |
|------|----------:|
| Git CLI | 559ms |
| Ziggit | 342ms |
| Speedup | **1.63×** |

---

## Detailed Report

See [BUN_INSTALL_BENCHMARK.md](BUN_INSTALL_BENCHMARK.md) for full methodology, per-operation
breakdown, raw data, and projected impact analysis.
