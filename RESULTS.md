# Bun Fork with Ziggit Integration — Results Summary

**Last updated:** 2026-03-27T04:20Z (Session 22)

## Key Numbers

| Metric | Value |
|--------|-------|
| **Full workflow speedup (4 small repos)** | **4.6×** |
| **Full workflow speedup (all 5 repos)** | **2.3×** |
| **findCommit speedup (avg)** | **7.2×** |
| **cloneBare speedup (small repos)** | **3.5×** |
| **Projected bun install savings (5 git deps)** | **~42ms (8.9%)** |
| **Projected bun install savings (20 git deps)** | **~168ms (26%)** |

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
- Cross-session reproducibility analysis

## Benchmark Environment

- Linux 6.1.141 x86_64, 483MB RAM, 1 vCPU
- Stock bun v1.3.11, Zig 0.15.2, Git 2.43.0
- Ziggit commit b6ce769

## Limitations

- Full bun fork binary cannot be built on this VM (needs ≥8GB RAM, ≥20GB disk)
- Benchmarks use standalone lib_bench binary linking ziggit directly
- Express (11MB) shows no speedup for cloneBare due to git's optimized large-pack copy path
- Cold bun install times have ~12% variance due to GitHub API/network
