# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-27T02:05Z (latest run)
- Ziggit: built from `/root/ziggit` HEAD, Zig 0.15.2, ReleaseFast
- Bun: 1.3.11 (stock), fork branch: ziggit-integration
- Machine: Linux x86_64, 483MB RAM, 1 vCPU, 2GB swap
- Git: 2.43.0

## Build Status

Full bun fork binary **cannot be built** on this VM (needs ≥16GB RAM, ≥10GB disk).
`build.zig.zon` correctly wires ziggit as `../ziggit` path dependency.
Benchmarks compare stock bun + git CLI vs ziggit CLI to measure replaceable operations.

---

## Latest Run (2026-03-27T02:05Z)

### Stock Bun Install (5 Git Dependencies, 69 packages)

| Metric | Run 1 | Run 2 | Run 3 | Avg |
|--------|-------|-------|-------|-----|
| Cold cache | 549ms | 389ms | 822ms | **586ms** |
| Warm cache | 185ms | 158ms | 86ms | **143ms** |

### Git CLI vs Ziggit — Clone Workflow (5 repos)

| Tool | Run 1 | Run 2 | Run 3 | Avg |
|------|-------|-------|-------|-----|
| Git CLI (total) | 811ms | 687ms | 693ms | **730ms** |
| Ziggit (total) | 431ms | 435ms | 416ms | **427ms** |
| **Savings** | 380ms | 252ms | 277ms | **303ms (41%)** |

### Per-Repo Breakdown

| Repo | Git CLI Avg | Ziggit Avg | Speedup |
|------|-------------|------------|---------|
| debug | 138ms | 73ms | 1.89× |
| node-semver | 143ms | 76ms | 1.88× |
| chalk | 131ms | 81ms | 1.62× |
| express | 176ms | 115ms | 1.53× |
| is | 142ms | 82ms | 1.73× |

### Head-to-Head: debug-js/debug (5 runs)

| Metric | Git CLI | Ziggit |
|--------|---------|--------|
| Average | 117ms | 70ms |
| Best | 111ms | 60ms |
| Worst | 125ms | 84ms |
| **Speedup** | — | **1.67×** |

---

## Key Finding

**Ziggit is 1.5–1.9× faster than git CLI** for the shallow clone + resolve workflow that `bun install` uses for git dependencies. Across 5 repositories, this translates to **303ms saved per install** (41% of git operation time).

With library-level integration (eliminating process spawn overhead), the improvement is projected to be **50-60%**.

---

## Full Details

See [BUN_INSTALL_BENCHMARK.md](./BUN_INSTALL_BENCHMARK.md) for complete methodology, raw data, and projections.
