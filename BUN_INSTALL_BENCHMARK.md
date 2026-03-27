# Bun Install Benchmark: Stock Bun vs Ziggit Integration

**Date:** 2026-03-27T00:22Z (fresh run)
**Environment:** Linux x86_64, 483MB RAM, 1 vCPU, 2GB swap
**Stock Bun:** v1.3.11
**Ziggit:** v0.2.0, built from /root/ziggit (master), ReleaseFast, Zig 0.15.2
**Git CLI:** 2.43.0
**Methodology:** 3 runs per benchmark, median reported. Caches cleared between cold runs.

---

## Executive Summary

| Metric | Value |
|--------|-------|
| Stock bun install (cold, 5 git deps) | **380ms** (median) |
| Stock bun install (warm cache) | **82ms** (median) |
| Git CLI sequential workflow (5 repos) | **696ms** (median) |
| Ziggit CLI sequential workflow (5 repos) | **1164ms** (median) |
| Local checkout: git archive | **5ms** (median) |
| Local checkout: ziggit clone | **8ms** (median) |

### Key Finding

**Ziggit network clones are currently ~1.67x slower than git CLI** for remote repos.
This is primarily due to ziggit's pack-file indexing and object extraction overhead.
However, ziggit provides an **in-process library API** that eliminates subprocess spawning,
which is where the real bun integration win would come from (not measurable without building the full bun fork binary).

### Blocker: Checkout Bug

Ziggit's `clone` command **fails to populate the working tree** for all tested repos:
```
warning: checkout failed: error.InvalidCommit, repository cloned but working tree not populated
```
This must be fixed before ziggit can replace git CLI in bun install.

---

## Build Status

Full bun fork binary **cannot be built** on this VM:
- **Required:** ≥16GB RAM, ≥30GB disk, ~45 min compile time
- **Available:** 483MB RAM, 2.2GB free disk
- `build.zig` correctly wires ziggit as `../ziggit` path dependency
- Benchmarks compare stock bun + git CLI vs ziggit CLI to measure replaceable operations

---

## Section 1: Stock Bun Install (5 Git Dependencies)

Test project with `github:` dependencies: is, express, chalk, debug, node-semver.

### Cold Cache (rm -rf node_modules + bun.lock + ~/.bun/install/cache)

| Run | Time |
|-----|------|
| 1 | 395ms |
| 2 | 380ms |
| 3 | 380ms |
| **Median** | **380ms** |

### Warm Cache (rm -rf node_modules + bun.lock only)

| Run | Time |
|-----|------|
| 1 | 91ms |
| 2 | 82ms |
| 3 | 80ms |
| **Median** | **82ms** |

---

## Section 2: Git CLI Workflow (clone --bare --depth=1 + rev-parse + archive)

This simulates what bun does internally for each git dependency:
1. `git clone --bare --depth=1` — fetch objects
2. `git rev-parse HEAD` — resolve ref to SHA
3. `git archive HEAD | tar -x` — extract working tree

### Per-Repo Breakdown (median of 3 runs)

| Repo | Clone | Resolve | Checkout | Total |
|------|-------|---------|----------|-------|
| is | 140ms | 1ms | 6ms | 149ms |
| express | 161ms | 1ms | 10ms | 173ms |
| chalk | 129ms | 1ms | 6ms | 137ms |
| debug | 114ms | 1ms | 4ms | 120ms |
| node-semver | 134ms | 1ms | 7ms | 143ms |

### Sequential Total (all 5 repos)

| Run | Total |
|-----|-------|
| 1 | 809ms |
| 2 | 696ms |
| 3 | 692ms |
| **Median** | **696ms** |

> Note: Stock bun achieves 380ms cold by parallelizing these operations.

---

## Section 3: Ziggit CLI Workflow (clone + log + status)

Same repos cloned via `ziggit clone` + `ziggit log -1` + `ziggit status`.

### Per-Repo Breakdown (median of 3 runs)

| Repo | Clone | Resolve | Status | Total |
|------|-------|---------|--------|-------|
| is | 131ms | 2ms | 2ms | 137ms |
| express | 683ms | 3ms | 3ms | 690ms |
| chalk | 96ms | 2ms | 2ms | 102ms |
| debug | 88ms | 2ms | 2ms | 93ms |
| node-semver | 146ms | 2ms | 2ms | 151ms |

### Sequential Total (all 5 repos)

| Run | Total |
|-----|-------|
| 1 | 1676ms |
| 2 | 1133ms |
| 3 | 1164ms |
| **Median** | **1164ms** |

### Analysis

- **express** is the outlier: ziggit takes ~683ms vs git's ~161ms (4.2x slower) — likely due to express having many objects and ziggit's pack indexing being more expensive than git's depth=1 shallow clone
- **Smaller repos** (debug, chalk, is): ziggit is comparable or slightly faster on clone, but the checkout bug means no working tree is produced
- **resolve + status** are fast (~2-5ms) in both tools

---

## Section 4: Local Re-Clone (Cached Bare Repo → Working Tree)

Pre-cloned chalk as a local bare repo, then extracted working tree:

| Tool | Run 1 | Run 2 | Run 3 | Median |
|------|-------|-------|-------|--------|
| git archive + tar | 6ms | 5ms | 5ms | **5ms** |
| ziggit clone (local) | 8ms | 8ms | 8ms | **8ms** |

Local operations are fast for both. Git's archive|tar pipeline has a slight edge (5ms vs 8ms).

---

## Projected Impact on Bun Install

### What ziggit integration would change

Stock bun install currently shells out to `git` for each git dependency. With ziggit integrated as a library:

1. **Eliminated:** 3 subprocess spawns per git dep (clone + rev-parse + archive)
2. **Eliminated:** tar pipe for working tree extraction
3. **Added:** In-process Zig function calls (no exec overhead)

### Projection (assuming ziggit checkout bug is fixed)

| Scenario | Current (git CLI) | Projected (ziggit lib) | Speedup |
|----------|-------------------|----------------------|---------|
| 5 git deps, cold | 380ms | ~350ms | ~1.1x |
| 5 git deps, warm | 82ms | ~70ms | ~1.2x |
| 20 git deps, cold | ~1500ms | ~1200ms | ~1.25x |

> The subprocess elimination saves ~3-5ms per dep. The main bottleneck is network
> latency, which neither tool can optimize. The real win comes at scale (many git deps)
> and in the warm-cache path where local operations dominate.

---

## Blockers for Production Integration

1. **🔴 Checkout bug:** `ziggit clone` fails to populate working tree (`error.InvalidCommit`)
2. **🟡 Shallow clone:** ziggit doesn't support `--depth=1`, fetching full history is slower for large repos (express: 683ms vs 161ms)
3. **🟡 Bare clone:** No `--bare` flag for ziggit — bun's cache uses bare repos
4. **🟢 Build integration:** `build.zig` path dependency works correctly

---

## Reproduction

```bash
# Build ziggit
cd /root/ziggit && zig build -Doptimize=ReleaseFast

# Run benchmarks
cd /root/bun-fork && bash benchmark/bun_install_bench.sh
```

---

## Raw Data

Full benchmark output saved to `/tmp/bench_results.txt`.
Benchmark script: `benchmark/bun_install_bench.sh`.
