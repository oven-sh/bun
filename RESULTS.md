# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-27T02:08Z (latest run)
- Ziggit: built from `/root/ziggit` HEAD, Zig 0.15.2, ReleaseFast
- Bun: 1.3.11 (stock), fork branch: ziggit-integration
- Machine: Linux x86_64, 483MB RAM, 1 vCPU, 2GB swap
- Git: 2.43.0

## Build Status

Full bun fork binary **cannot be built** on this VM (needs ≥16GB RAM, ≥10GB disk).
`build.zig.zon` correctly wires ziggit as `../ziggit` path dependency.
Benchmarks compare stock bun + git CLI vs ziggit CLI to measure replaceable operations.

---

## Latest Run (2026-03-27T02:08Z)

### Stock Bun Install (5 Git Dependencies, 14 packages)

| Metric | Run 1 | Run 2 | Run 3 | Avg |
|--------|-------|-------|-------|-----|
| Cold cache | 165ms | 137ms | 96ms | **133ms** |
| Warm cache | 8ms | 5ms | 6ms | **6ms** |

### Git CLI vs Ziggit — Sequential Clone Workflow (5 repos)

| Tool | Run 1 | Run 2 | Run 3 | Avg |
|------|-------|-------|-------|-----|
| Git CLI (total) | 733ms | 687ms | 664ms | **694ms** |
| Ziggit (total) | 431ms | 424ms | 424ms | **426ms** |
| **Savings** | 302ms | 263ms | 240ms | **268ms (39%)** |

### Git CLI vs Ziggit — Parallel Clone (5 repos concurrent)

| Tool | Run 1 | Run 2 | Run 3 | Avg |
|------|-------|-------|-------|-----|
| Git CLI | 313ms | 306ms | 307ms | **309ms** |
| Ziggit | 120ms | 101ms | 110ms | **110ms** |
| **Speedup** | 2.61× | 3.03× | 2.79× | **2.80×** |

### Per-Repo Breakdown (sequential averages)

| Repo | Git CLI Avg | Ziggit Avg | Speedup |
|------|-------------|------------|---------|
| debug | 125ms | 75ms | 1.67× |
| node-semver | 154ms | 99ms | 1.56× |
| ms | 141ms | 87ms | 1.62× |
| ini | 134ms | 80ms | 1.68× |
| mime | 141ms | 85ms | 1.66× |

### Key Finding

**Parallel clone (realistic bun install scenario): ziggit is 2.80× faster than git CLI.**

The clone operation (HTTP smart protocol + pack decode) accounts for ~93% of total time.
Ziggit's Zig-native HTTP client + zero-alloc pack parser eliminates process spawn overhead
and dynamic linking costs that compound when running multiple git processes concurrently.

---

## Detailed Report

See [BUN_INSTALL_BENCHMARK.md](BUN_INSTALL_BENCHMARK.md) for full methodology, per-operation
breakdown, and projected impact analysis.
