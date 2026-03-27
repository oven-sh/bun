# Bun Fork with Ziggit Integration — Results Summary

**Last updated:** 2026-03-27T04:23Z (Session 23)

## Key Numbers

| Metric | Value |
|--------|-------|
| **Full workflow speedup (4 small repos)** | **4.7×** |
| **Full workflow speedup (all 5 repos)** | **2.2×** |
| **findCommit speedup (avg)** | **5.7×** |
| **cloneBare speedup (small repos)** | **3.5×** |
| **Projected bun install savings (5 git deps)** | **~41ms (10.2%)** |
| **Projected bun install savings (20 git deps)** | **~164ms (29%)** |

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
- Cross-session reproducibility analysis (sessions 21–23)

## Benchmark Environment

- Linux 6.1.141 x86_64, 483MB RAM, 1 vCPU
- Stock bun v1.3.11, Zig 0.15.2, Git 2.43.0
- Ziggit commit b6ce769

## Quick Comparison (Full Workflow per repo)

| Repo | ziggit (μs) | git CLI (μs) | Speedup |
|------|-------------|--------------|---------|
| debug (596KB) | 1,678 | 11,074 | **6.6×** |
| chalk (1.2MB) | 2,627 | 12,213 | **4.6×** |
| is (1.4MB) | 3,370 | 12,660 | **3.8×** |
| node-semver (1.5MB) | 3,611 | 16,588 | **4.6×** |
| express (11MB) | 23,222 | 22,832 | 0.98× |
| **Total** | **34,508** | **75,367** | **2.2×** |

## Limitations

- Full bun fork binary cannot be built on this VM (needs ≥8GB RAM, ≥20GB disk)
- Benchmarks use standalone lib_bench binary linking ziggit directly
- Express (11MB) shows no speedup for cloneBare due to git's optimized large-pack copy path
- Cold bun install times have ~15% variance due to GitHub API/network
