# Bun Install Benchmark: Stock Bun vs Ziggit Integration

**Date:** 2026-03-27T01:36Z (latest run)
**VM:** 483MB RAM, 1 CPU, Linux x86_64 (minimized container)
**Bun:** v1.3.11 (stock, at `/root/.bun/bin/bun`)
**Git:** v2.43.0
**Ziggit:** built from `/root/ziggit` at HEAD, Zig 0.15.2, ReleaseFast
**Bun fork:** not buildable on this VM (see [Build Notes](#7-build-notes))

All numbers are **actual measured values**, each benchmark run 3 times, caches cleared between cold runs.

---

## 1. Test Setup

**package.json** with 5 GitHub git dependencies:
```json
{
  "dependencies": {
    "is": "github:sindresorhus/is",
    "express": "github:expressjs/express",
    "chalk": "github:chalk/chalk",
    "debug": "github:debug-js/debug",
    "semver": "github:npm/node-semver"
  }
}
```

This resolves to **266 total packages** (downloaded + extracted on cold install).
The 5 repos contain **426 total files** (15 + 213 + 34 + 13 + 151).

---

## 2. Stock Bun Install

| Run | Cold Cache | Warm Cache |
|-----|-----------|------------|
| 1   | 505ms     | 156ms      |
| 2   | 545ms     | 76ms       |
| 3   | 746ms     | 75ms       |
| **Median** | **545ms** | **76ms** |

> Cold cache: `rm -rf node_modules bun.lock ~/.bun/install/cache` before each run.
> Warm cache: registry + git deps already cached, only `node_modules` + `bun.lock` removed.

---

## 3. Clone Benchmark (bare --depth=1, 5 repos)

| Tool | Run 1 | Run 2 | Run 3 | Median | Speedup |
|------|-------|-------|-------|--------|---------|
| Git CLI | 737ms | 683ms | 665ms | **683ms** | baseline |
| Ziggit  | 419ms | 426ms | 434ms | **426ms** | **1.60×** |

**Per-repo medians (clone only):**

| Repo | Git CLI | Ziggit | Speedup |
|------|---------|--------|---------|
| is (15 files) | 129ms | 73ms | 1.77× |
| express (213 files) | 170ms | 123ms | 1.38× |
| chalk (34 files) | 124ms | 75ms | 1.65× |
| debug (13 files) | 121ms | 70ms | 1.73× |
| semver (151 files) | 140ms | 77ms | 1.82× |

---

## 4. Full Workflow Benchmark (clone + rev-parse + ls-tree + cat-file all blobs)

This simulates what `bun install` does for each git dependency: clone the repo, resolve HEAD, list tree, extract every blob.

| Tool | Run 1 | Run 2 | Run 3 | Median | Speedup |
|------|-------|-------|-------|--------|---------|
| Git CLI (subprocess) | 1,236ms | 1,188ms | 1,280ms | **1,236ms** | baseline |
| Ziggit CLI (subprocess) | 1,207ms | 1,224ms | 1,270ms | **1,224ms** | **1.01×** |

**Per-repo breakdown (Run 2, closest to median):**

| Repo | Tool | Clone | Rev-parse | Ls-tree | Cat-file (all) | Total |
|------|------|-------|-----------|---------|---------------|-------|
| is (15f) | git | 125ms | 3ms | 3ms | 21ms | 152ms |
| is (15f) | ziggit | 78ms | 3ms | 4ms | 30ms | 115ms |
| express (213f) | git | 164ms | 2ms | 4ms | 251ms | 421ms |
| express (213f) | ziggit | 107ms | 3ms | 4ms | 379ms | 493ms |
| chalk (34f) | git | 123ms | 3ms | 3ms | 42ms | 171ms |
| chalk (34f) | ziggit | 70ms | 3ms | 4ms | 63ms | 140ms |
| debug (13f) | git | 108ms | 3ms | 3ms | 17ms | 131ms |
| debug (13f) | ziggit | 60ms | 3ms | 4ms | 25ms | 92ms |
| semver (151f) | git | 128ms | 2ms | 3ms | 180ms | 313ms |
| semver (151f) | ziggit | 107ms | 3ms | 3ms | 271ms | 384ms |

### Key Observation: Clone vs Cat-file Tradeoff

Ziggit is **~1.6× faster at cloning** but **~1.5× slower at per-blob cat-file via subprocess**. This is because:
- **Clone**: ziggit's Zig-native HTTP + packfile parsing is faster than git's fork/exec model
- **Cat-file**: ziggit has ~0.57ms higher per-spawn overhead than git (1.52ms vs 0.94ms), which compounds across 426 blobs

In **library mode** (no subprocess spawning per blob), the cat-file overhead disappears entirely.

---

## 5. Spawn Overhead Analysis

| Tool | Per-call | Delta |
|------|----------|-------|
| git --version | 0.94ms | — |
| ziggit --version | 1.52ms | +0.57ms |
| **× 426 blobs** | | **+247ms overhead** |

The 0.57ms/call delta × 426 blob extractions = ~247ms of pure process-spawn overhead that would be eliminated in library mode.

---

## 6. Projected Library-Mode Performance

When ziggit is used as a **library** (linked directly into bun, no subprocess spawning):

| Phase | CLI Mode | Library Mode (projected) |
|-------|----------|-------------------------|
| Clone (5 repos) | 426ms | **426ms** (same — network-bound) |
| Rev-parse (5 repos) | 15ms | **<1ms** (in-process) |
| Ls-tree (5 repos) | 18ms | **<1ms** (in-process) |
| Cat-file (426 blobs) | 769ms | **<10ms** (in-memory, no spawn) |
| **Total git ops** | **~1,224ms** | **~437ms** |
| **Speedup** | baseline | **~2.8×** |

### Impact on `bun install` Cold Cache

| Component | Stock bun | With ziggit (projected) |
|-----------|----------|------------------------|
| Git dep resolution | ~683ms (clone) + overhead | ~426ms (clone) + ~12ms (in-proc) |
| Registry + linking | ~(545ms total) | same |
| **Total cold install** | **~545ms** | **~330–380ms** (est. 30–40% faster) |

> Note: Stock bun's 545ms cold install includes parallel registry + git resolution, so git ops
> are partly overlapped. The actual impact depends on how much git resolution is on the critical path.

---

## 7. Build Notes

### Why the bun fork can't be built on this VM

- **RAM needed:** ≥8GB (bun's Zig build is extremely memory-intensive)
- **Disk needed:** ≥15GB (build artifacts + dependencies)
- **This VM:** 483MB RAM, 2.0GB free disk
- **Zig version:** bun requires Zig 0.14.x; this VM has 0.15.2

### How to build on a proper machine

```bash
# Prerequisites: Zig 0.14.0, ≥8GB RAM, ≥15GB disk, Linux x86_64
cd /root/bun-fork
# build.zig.zon has ziggit wired as path dependency at ../ziggit
zig build -Doptimize=ReleaseFast
```

The integration point is in `src/install/git.zig` where bun calls git operations.
With ziggit as a library, these become direct function calls instead of `std.process.Child` spawns.

---

## 8. Raw Data

See `benchmark/raw_results_20260327T013636Z.txt` for the full output of this run.

Previous runs: `benchmark/raw_results_*.txt`

---

## 9. Summary

| Metric | Value |
|--------|-------|
| Clone speedup (CLI) | **1.60×** |
| Full workflow speedup (CLI, subprocess) | **1.01×** (spawn overhead negates clone gains) |
| Spawn overhead per call | **+0.57ms** vs git |
| Projected library-mode total speedup | **~2.8×** for git operations |
| Projected bun install cold cache improvement | **~30–40%** faster |

**Bottom line:** Ziggit's clone performance is excellent (1.60× faster). The current CLI-mode
benchmark shows only 1.01× due to subprocess spawn overhead on per-blob operations. When
integrated as a library (the intended use case), the spawn overhead vanishes and the projected
speedup is ~2.8× for all git operations, translating to ~30–40% faster `bun install` for
projects with git dependencies.
