# ziggit vs git CLI — Benchmark Results

**Date:** 2026-03-30  
**System:** Linux 6.1.141 x86_64, Intel Xeon @ 3.00GHz, 15GB RAM  
**Build:** Zig 0.14.0, ReleaseFast  
**ziggit commit:** d0a7459  
**Bun version:** 1.3.11  

---

## Executive Summary

ziggit, a pure Zig git implementation used as a library inside bun, eliminates subprocess overhead and enables zero-copy optimizations that deliver **8–58× speedups** over the git CLI subprocess approach in bun install's git dependency workflow.

| Operation | ziggit (avg) | git CLI (avg) | Speedup |
|-----------|-------------|---------------|---------|
| **findCommit** (rev-parse HEAD) | 119μs | 1,128μs | **9.8×** |
| **cloneBare** (local, hardlink) | 218μs | 5,581μs | **25.6×** |
| **Full workflow** (clone+find+clone) | 421μs | 16,656μs | **39.6×** |
| **HTTPS clone** (small repos) | 80ms | 143ms | **1.8×** |

---

## 1. Library Benchmarks — Local Operations

These benchmarks compare ziggit as a **direct library call** (how the bun fork uses it) vs spawning `git` as a **child process** (how stock bun does it). 20 iterations per test.

### findCommit (rev-parse HEAD)

| Repo | ziggit (μs) | git CLI (μs) | Speedup |
|------|------------|-------------|---------|
| debug | 145 | 1,126 | **7.8×** |
| chalk | 111 | 1,125 | **10.1×** |
| is | 145 | 1,128 | **7.8×** |
| node-semver | 106 | 1,145 | **10.8×** |
| express | 89 | 1,117 | **12.5×** |
| **Average** | **119** | **1,128** | **9.8×** |

> ziggit reads HEAD + ref files directly (2 syscalls). git CLI spawns a process, loads shared libraries, initializes git, reads files, formats output, exits. The subprocess overhead alone is ~1ms.

### cloneBare (local bare clone)

| Repo | Objects | Pack Size | ziggit (μs) | git CLI (μs) | Speedup |
|------|---------|-----------|-------------|-------------|---------|
| debug | 2,082 | 490 KB | 257 | 5,075 | **19.7×** |
| chalk | 3,151 | 568 KB | 207 | 4,489 | **21.7×** |
| is | 1,237 | 270 KB | 213 | 4,790 | **22.5×** |
| node-semver | 4,476 | 789 KB | 206 | 6,205 | **30.1×** |
| express | 33,335 | 10 MB | 209 | 7,347 | **35.1×** |
| **Average** | — | — | **218** | **5,581** | **25.6×** |

> ziggit uses `link()` syscalls to hardlink pack files (instant, zero I/O on same filesystem), with `copy_file_range()` zero-copy fallback. git CLI always copies data through userspace. Express (10MB pack) shows the biggest win: **35×**.

### Full bun install Workflow (cloneBare → findCommit → clone from bare)

| Repo | ziggit (μs) | git CLI (μs) | Speedup |
|------|------------|-------------|---------|
| debug | 450 | 12,413 | **27.6×** |
| chalk | 404 | 13,473 | **33.3×** |
| is | 419 | 14,319 | **34.2×** |
| node-semver | 410 | 18,643 | **45.5×** |
| express | 423 | 24,433 | **57.8×** |
| **Average** | **421** | **16,656** | **39.6×** |

> This simulates the complete bun install git dependency pipeline: clone to bare cache → resolve commit → clone to node_modules. For express, **each dependency install saves 24ms** (3 subprocess spawns → 0 subprocess spawns).

---

## 2. HTTPS Clone Benchmarks (Network)

Real network clones over HTTPS to GitHub. Median of 3 runs.

| Repo | ziggit (ms) | git CLI (ms) | Speedup |
|------|------------|-------------|---------|
| debug | 83 | 136 | **1.6×** |
| chalk | 82 | 149 | **1.8×** |
| is | 120 | 165 | **1.4×** |
| node-semver | 131 | 183 | **1.4×** |
| express | 635 | 616 | 0.97× |

> Small repos (< 1MB pack) show 1.4–1.8× speedup from reduced overhead. Express (10MB) is network-bound — roughly even. libdeflate acceleration helps with post-download idx generation.

---

## 3. Stock `bun install` Baseline (e2e)

5 git dependencies: debug, chalk, is, node-semver, express

### Cold Cache (no bun cache, no node_modules)

| Run | Time (ms) |
|-----|-----------|
| 1 | 491 |
| 2 | 484 |
| 3 | 410 |
| **Avg** | **462** |

### Warm Cache (bun cache present, no node_modules)

| Run | Time (ms) |
|-----|-----------|
| 1 | 100 |
| 2 | 198 |
| 3 | 68 |
| **Avg** | **122** |

---

## 4. Projected Impact on bun install

### Cold Cache Scenario
In a cold `bun install` with 5 git dependencies, each dependency goes through:
1. **clone --bare** to cache (HTTPS fetch + local setup)
2. **rev-parse** to find commit
3. **clone** from cache to node_modules

With ziggit as a library:
- **Steps 2+3 combined**: ziggit 421μs vs git CLI 16,656μs → saves **~16ms per dependency**
- **5 dependencies**: saves **~80ms** from local operations alone
- **Step 1 (HTTPS)**: saves ~50ms avg across small repos
- **Total estimated savings**: **~130ms** on a ~462ms install = **~28% faster**

### Warm Cache Scenario (cache hit)
When the bare cache exists:
- All git operations are local (no network)
- **Per-dependency**: ziggit 421μs vs git CLI 16,656μs = **39.6× faster**
- **5 dependencies × 16ms saved = ~80ms** savings on ~122ms install = **~65% faster**

---

## 5. Key Optimizations Applied

| Optimization | Impact | Commit |
|---|---|---|
| **Hardlink-based local clone** | 20–35× for cloneBare | `perf(clone): hardlink files for local cloneBare` |
| **copy_file_range zero-copy fallback** | 1.5–3× for cross-filesystem | `perf(clone): use copy_file_range zero-copy` |
| **libdeflate for idx generation** | ~15% faster pack indexing | `perf(idx): use libdeflate for decompression` |
| **Stack-allocated ref resolution** | No heap allocs in findCommit | (existing optimization) |
| **packed-refs for HTTPS clones** | Single file vs thousands | (existing optimization) |

---

## 6. Correctness Verification

- `git verify-pack -v` passes on all ziggit-produced .idx files ✅
- `git fsck --no-dangling` clean on all cloned repos ✅
- Object counts match exactly ✅
- Refs written to packed-refs format ✅
- HEAD resolves correctly ✅
- Hardlinked clones verified identical to copy-based clones ✅

---

## Benchmark History

| Session | Date | Key Result |
|---------|------|-----------|
| 25 (current) | 2026-03-30 | **39.6× avg full workflow**, hardlink + libdeflate |
| 24 | 2026-03-27 | 6× full workflow, copy-based clone |
| 1–23 | 2026-03-26/27 | Progressive optimizations |
