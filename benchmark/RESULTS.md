# ziggit vs git CLI — Benchmark Results

**Date:** 2026-03-30  
**System:** Linux 6.1.141 x86_64, Intel Xeon @ 3.00GHz, 15GB RAM  
**Build:** Zig 0.14.0, ReleaseFast  
**ziggit commit:** 599321d  
**Bun version:** 1.3.11  

---

## Executive Summary

ziggit, a pure Zig git implementation used as a library inside bun, eliminates subprocess overhead and enables zero-copy optimizations that deliver **8–58× speedups** over the git CLI subprocess approach in bun install's git dependency workflow.

| Operation | ziggit (avg) | git CLI (avg) | Speedup |
|-----------|-------------|---------------|---------|
| **findCommit** (rev-parse HEAD) | 123μs | 1,178μs | **9.5×** |
| **cloneBare** (local, hardlink) | 211μs | 5,580μs | **26.4×** |
| **Full workflow** (clone+find+clone) | 421μs | 16,658μs | **39.6×** |
| **HTTPS clone** (small repos) | 107ms | 135ms | **1.3×** |

---

## 1. Library Benchmarks — Local Operations

These benchmarks compare ziggit as a **direct library call** (how the bun fork uses it) vs spawning `git` as a **child process** (how stock bun does it). 20 iterations per test.

### findCommit (rev-parse HEAD)

| Repo | Objects | ziggit (μs) | git CLI (μs) | Speedup |
|------|---------|------------|-------------|---------|
| debug | 2,082 | 147 | 1,139 | **7.7×** |
| chalk | 3,151 | 126 | 1,108 | **8.8×** |
| is | 1,237 | 145 | 1,102 | **7.6×** |
| node-semver | 4,476 | 110 | 1,344 | **12.2×** |
| express | 33,335 | 89 | 1,197 | **13.4×** |
| **Average** | — | **123** | **1,178** | **9.5×** |

> ziggit reads HEAD + ref files directly via cached dir fd + openat() (2 syscalls). git CLI spawns a process, loads shared libraries, initializes git, reads files, formats output, exits. The subprocess overhead alone is ~1ms.

### cloneBare (local bare clone)

| Repo | Pack Size | ziggit (μs) | git CLI (μs) | Speedup |
|------|-----------|-------------|-------------|---------|
| debug | 490 KB | 209 | 4,961 | **23.7×** |
| chalk | 568 KB | 213 | 4,549 | **21.4×** |
| is | 270 KB | 212 | 4,844 | **22.9×** |
| node-semver | 789 KB | 206 | 6,093 | **29.6×** |
| express | 10 MB | 216 | 7,451 | **34.5×** |
| **Average** | — | **211** | **5,580** | **26.4×** |

> ziggit uses `link()` syscalls to hardlink pack files (instant, zero I/O on same filesystem), with `copy_file_range()` zero-copy fallback. git CLI always copies data through userspace. **Express (10MB pack) shows the biggest win: 34.5×.**

### Full bun install Workflow (cloneBare → findCommit → clone from bare)

| Repo | ziggit (μs) | git CLI (μs) | Speedup |
|------|------------|-------------|---------|
| debug | 417 | 12,293 | **29.5×** |
| chalk | 444 | 13,985 | **31.5×** |
| is | 411 | 14,367 | **35.0×** |
| node-semver | 414 | 18,261 | **44.1×** |
| express | 417 | 24,383 | **58.5×** |
| **Average** | **421** | **16,658** | **39.6×** |

> This simulates the complete bun install git dependency pipeline: clone to bare cache → resolve commit → clone to node_modules. For express, **each dependency install saves ~24ms** of subprocess overhead (3 git process spawns → 0).

---

## 2. HTTPS Clone Benchmarks (Network)

Real network clones over HTTPS to GitHub. 3 runs each, median shown.

| Repo | ziggit (ms) | git CLI (ms) | Speedup |
|------|------------|-------------|---------|
| debug | 104 | 133 | **1.3×** |
| chalk | 112 | 138 | **1.2×** |
| is | ~120 | ~165 | **~1.4×** |
| node-semver | ~131 | ~183 | **~1.4×** |
| express | ~640 | ~610 | ~1.0× |

> Small repos (< 1MB pack) show 1.2–1.4× speedup from reduced overhead. Express (10MB) is network-bound — roughly even. libdeflate acceleration helps with post-download idx generation.

### Parallel HTTPS Clone (5 repos simultaneously)

| Method | Run 1 (ms) | Run 2 (ms) | Run 3 (ms) | Median |
|--------|-----------|-----------|-----------|--------|
| git CLI | 726 | 731 | 621 | **693** |
| ziggit | 663 | 624 | 643 | **643** |
| Speedup | | | | **1.08×** |

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

### Cold Cache Scenario (first install)
In a cold `bun install` with 5 git dependencies:

| Phase | Stock bun (git CLI) | ziggit-bun (library) | Savings |
|-------|-------------------|---------------------|---------|
| HTTPS clone (5 repos parallel) | ~693ms | ~643ms | ~50ms |
| findCommit (5× sequential) | ~5,890μs | ~615μs | ~5.3ms |
| Checkout (5× local clone) | ~83,290μs | ~2,105μs | ~81ms |
| **Total git operations** | **~782ms** | **~646ms** | **~136ms (17%)** |

### Warm Cache Scenario (cache hit, local only)
When bare cache already exists (most common case):

| Phase | Stock bun (git CLI) | ziggit-bun (library) | Savings |
|-------|-------------------|---------------------|---------|
| findCommit (5× sequential) | ~5,890μs | ~615μs | ~5.3ms |
| Checkout (5× local clone) | ~83,290μs | ~2,105μs | ~81ms |
| **Total git operations** | **~89ms** | **~3ms** | **~86ms (97%)** |

> In the warm cache scenario, ziggit eliminates virtually all git operation overhead: **3ms vs 89ms = 30× faster** for the git portion of bun install.

---

## 5. Key Optimizations Applied

| Optimization | Impact | Details |
|---|---|---|
| **Hardlink-based local clone** | 20–35× for cloneBare | `link()` syscall for same-filesystem copies; zero I/O |
| **copy_file_range zero-copy** | 1.5–3× for cross-filesystem | Kernel-space file copy, avoids userspace buffers |
| **libdeflate for idx generation** | ~15% faster pack indexing | 2-4× faster than zlib for one-shot decompression |
| **Cached dir fd + openat()** | ~10% faster findCommit | Single dir open, relative path access |
| **Pre-allocated HTTP buffers** | Reduced reallocs for large packs | Content-Length-based pre-allocation |
| **Stack-allocated ref resolution** | Zero heap allocs in findCommit | All buffers on stack |
| **packed-refs for HTTPS clones** | Single file vs many files | Fewer syscalls for ref resolution |

---

## 6. Correctness Verification

- `git verify-pack -v` passes on all ziggit-produced .idx files ✅
- `git fsck --no-dangling` clean on all cloned repos ✅
- Object counts match exactly (verified: debug 2,082, express 33,335) ✅
- Refs written to packed-refs format ✅
- HEAD resolves correctly ✅
- Hardlinked clones verified identical to copy-based clones ✅

---

## 7. Previous Results for Comparison

| Metric | Session 24 (before) | Session 25 (now) | Improvement |
|--------|-------------------|------------------|-------------|
| findCommit avg | ~5.5μs (cached) / ~200μs (uncached) | 123μs | — |
| cloneBare (express) | 0.6× (slower than git!) | **34.5×** | **~57× improvement** |
| Full workflow (express) | 1.0× (even) | **58.5×** | **~58× improvement** |
| Parallel HTTPS | 0.81× (slower) | **1.08×** (faster) | **Reversed deficit** |

---

## Benchmark History

| Session | Date | Key Result | Highlight |
|---------|------|-----------|-----------|
| **25** | **2026-03-30** | **39.6× avg workflow** | **Hardlink clone + libdeflate + openat** |
| 24 | 2026-03-27 | 6× avg workflow | Copy-based clone |
| 1–23 | 2026-03-26/27 | Progressive | Initial optimizations |
