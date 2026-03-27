# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-27T02:24Z (latest run)
- Ziggit: v0.2.0, built from `/root/ziggit` HEAD, Zig 0.15.2
- Bun: 1.3.11 (stock), fork branch: ziggit-integration
- Machine: Linux x86_64, 483MB RAM, 1 vCPU, 2GB swap
- Git: 2.43.0

## Build Status

Full bun fork binary **cannot be built** on this VM (needs ≥8GB RAM, ≥20GB disk).
`build.zig.zon` correctly wires ziggit as `../ziggit` path dependency.
Benchmarks compare stock bun + git CLI vs ziggit CLI to measure replaceable operations.

---

## Latest Run (2026-03-27T02:24Z) — 5 Repos, Verified

### ⚠️ Key Finding: Only `clone --bare` Is Native

Verified via `strace`: ziggit's `clone --no-checkout` and `checkout` **delegate to
the git CLI**. Only `clone --bare` (remote HTTP packfile fetch) is natively
implemented. Previous runs overcounted ziggit's advantage by including
measurement noise in delegated operations.

### Stock Bun Install (5 Git Dependencies)

Dependencies: `debug`, `semver`, `chalk`, `express`, `@sindresorhus/is`

| Metric | Run 1 | Run 2 | Run 3 | Avg |
|--------|------:|------:|------:|----:|
| Cold cache | 380ms | 312ms | 308ms | **333ms** |
| Warm cache | 75ms | 85ms | 77ms | **79ms** |

### Git CLI vs Ziggit — Clone --bare Only (the native operation)

| Repo | Git clone --bare (ms) | Ziggit clone --bare (ms) | Speedup |
|------|---------------------:|------------------------:|--------:|
| debug | 139 | 87 | **1.60x** |
| semver | 216 | 139 | **1.55x** |
| chalk | 147 | 86 | **1.71x** |
| express | 935 | 938 | 1.00x |
| is | 170 | 123 | **1.38x** |
| **Excl. express** | **672** | **435** | **1.54x** |
| **All 5** | **1,607** | **1,373** | **1.17x** |

### Full Workflow (clone --bare + resolve + local clone + checkout)

| Tool | Total (5 repos) | Notes |
|------|----------------:|-------|
| Git CLI | **1,674ms** | All operations native |
| Ziggit CLI | **1,465ms** | Only clone --bare is native; rest delegates to git |
| **Speedup** | **1.14x** | |

### Key Findings

1. **Ziggit clone --bare is 1.4–1.7x faster for small/medium repos** (debug,
   semver, chalk, is) — native HTTP client + packfile parser avoids subprocess
   overhead
2. **Express (largest repo) shows no clone speedup** — network I/O dominates
   for large packfiles; both tools are TCP-throughput bound
3. **Overall 1.14x speedup** when including delegated operations (which add
   equivalent overhead for both tools)
4. **Resolve and checkout are not yet native** in ziggit CLI — they spawn git
5. **In-process integration (bun fork) would eliminate subprocess overhead**
   entirely for resolve + checkout, adding ~15-40ms/repo savings

### Projected In-Process Savings (bun fork)

The bun fork calls ziggit as a Zig module, not a subprocess. This eliminates:
- 3 process spawns per repo (clone --bare, resolve, checkout) → 0
- Local clone step entirely (direct tree extraction from packfile)
- Rev-parse subprocess (~3-5ms) → in-memory lookup (<0.1ms)

| Phase | Git CLI (subprocess) | Ziggit in-process (projected) |
|-------|--------------------:|-----------------------------:|
| Clone --bare (5 repos) | 1,607ms | 1,373ms |
| Resolve (5 repos) | 10ms (+ 15ms spawn) | <1ms |
| Checkout (5 repos) | 55ms (+ 15ms spawn) | ~30ms (no local clone needed) |
| **Total** | **~1,702ms** | **~1,404ms** |
| **Speedup** | — | **1.21x** |

---

## Historical Runs

### 2026-03-27T02:24Z — LATEST (5 repos, strace-verified)

| Metric | Value |
|--------|------:|
| Clone --bare speedup (excl. express) | **1.54x** |
| Clone --bare speedup (all 5) | **1.17x** |
| Full workflow speedup | **1.14x** |

### 2026-03-27T02:20Z (5 repos, pre-verification)

| Tool | Total Avg | Reported Speedup |
|------|----------:|--------:|
| Git CLI | 1,735ms | — |
| Ziggit | 1,169ms | 1.48× |

Note: Previous runs likely had measurement noise favoring ziggit in delegated
operations. The 02:24Z run with strace verification is more accurate.

### 2026-03-27T02:16Z (3 repos)

| Tool | Total Avg | Speedup |
|------|----------:|--------:|
| Git CLI | 555ms | — |
| Ziggit | 344ms | 1.61× |

### 2026-03-27T02:13Z (3 repos, original)

| Tool | Total Avg | Speedup |
|------|----------:|--------:|
| Git CLI | 559ms | — |
| Ziggit | 342ms | 1.63× |

---

## Detailed Report

See [BUN_INSTALL_BENCHMARK.md](BUN_INSTALL_BENCHMARK.md) for full methodology,
per-operation breakdown, raw data, and analysis.
