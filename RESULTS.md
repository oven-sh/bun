# Bun Fork with Ziggit Integration — Results Summary

**Last updated:** 2026-03-27T04:26Z (Session 24)

## Key Numbers

| Metric | Value |
|--------|-------|
| **Full workflow speedup (4 small repos)** | **4.5×** |
| **Full workflow speedup (all 5 repos)** | **2.1×** |
| **findCommit speedup (avg)** | **7.6×** |
| **cloneBare speedup (small repos)** | **3.5×** |
| **Projected bun install savings (5 git deps)** | **~40ms (7.8%)** |
| **Projected bun install savings (20 git deps)** | **~160ms (24%)** |

## What This Fork Does

Replaces git CLI subprocess spawning in bun's package installer with direct
ziggit library calls. Instead of `fork() + exec("git clone --bare ...")` for
each git dependency, bun calls `ziggit.Repository.cloneBare()` in-process.

## Detailed Benchmarks

See [BUN_INSTALL_BENCHMARK.md](BUN_INSTALL_BENCHMARK.md) for:
- Stock bun install baselines (cold + warm cache)
- Per-operation breakdowns (findCommit, cloneBare, full workflow)
- Per-repo data across 5 GitHub repositories
- Raw run-by-run measurements (3 runs × 20 iterations each)
- Cross-session reproducibility analysis (sessions 21–24)

## Benchmark Environment

- Linux 6.1.141 x86_64, 483MB RAM, 1 vCPU
- Stock bun v1.3.11, Zig 0.15.2, Git 2.43.0
- Ziggit commit b6ce769

## Quick Comparison (Full Workflow per repo)

| Repo | ziggit (μs) | git CLI (μs) | Speedup |
|------|-------------|--------------|---------|
| debug (596KB) | 1,798 | 11,210 | **6.2×** |
| chalk (1.2MB) | 2,614 | 12,277 | **4.7×** |
| is (1.4MB) | 3,624 | 12,991 | **3.6×** |
| node-semver (1.5MB) | 3,737 | 16,631 | **4.5×** |
| express (11MB) | 24,662 | 23,243 | 0.94× |
| **Total** | **36,435** | **76,352** | **2.1×** |

## Stock Bun Install Baselines

| Mode | Avg (bun reported) | Avg (wall clock) |
|------|-------------------|------------------|
| Cold cache | 505ms | 515ms |
| Warm cache | 22ms | 25ms |

## Limitations

- Full bun fork binary cannot be built on this VM (needs ≥8GB RAM, ≥20GB disk)
- Benchmarks use standalone lib_bench binary linking ziggit directly
- Express (11MB) shows no speedup for cloneBare due to git's optimized large-pack copy path
- Cold bun install times have ~25% variance due to GitHub API/network
