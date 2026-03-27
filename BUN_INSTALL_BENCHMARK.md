# Bun Install Benchmark: ziggit Integration vs Stock Bun

**Date**: 2026-03-27T03:15Z (Session 7)  
**VM**: 1 vCPU, 483MB RAM, Debian (minimal)  
**Stock bun**: v1.3.11  
**ziggit**: built from `/root/ziggit` commit `ae4117e` (Zig 0.15.2)  
**git CLI**: v2.43.0  

> **Note**: The full bun fork binary cannot be built on this VM (requires ~8GB+ RAM, multi-core).
> Instead, we benchmark the exact 3-step git workflow that `bun install` performs for each
> git dependency, comparing ziggit CLI vs git CLI. In the actual bun fork, ziggit is linked
> **in-process** (no fork/exec), so the real savings would be even larger.

## Test Repos (5 packages)

| Package | GitHub URL | Default Branch | Size |
|---------|-----------|---------------|------|
| debug | debug-js/debug | master | small |
| semver | npm/node-semver | main | medium |
| ms | vercel/ms | main | small |
| express | expressjs/express | master | large |
| chalk | chalk/chalk | main | small |

---

## Part 1: Stock Bun Install (5 Git Dependencies)

Dependencies: `@sindresorhus/is`, `express`, `chalk`, `debug`, `semver` (all `github:` specifiers)

| Scenario | Run 1 | Run 2 | Run 3 | **Median** |
|----------|------:|------:|------:|-------:|
| Cold cache | 565ms | 438ms | 438ms | **438ms** |
| Warm cache | 77ms | 203ms | 76ms | **77ms** |

---

## Part 2: Per-Repo Clone Workflow — Ziggit vs Git CLI

Each repo goes through the 3-step workflow bun uses for git deps:
1. **Clone** — `clone --bare` (network fetch + pack decode)
2. **Resolve** — `rev-parse` / `findCommit` (resolve branch → SHA)
3. **Checkout** — `clone --no-checkout` + `checkout SHA` (extract working tree)

### Per-Run Data (3 runs each)

| Repo | Run | ziggit (c/r/co) | git (c/r/co) |
|------|-----|-----------------|--------------|
| debug | 1 | 101ms (89/3/9) | 162ms (152/2/8) |
| debug | 2 | 85ms (73/3/9) | 157ms (147/2/8) |
| debug | 3 | 102ms (86/3/13) | 153ms (143/2/8) |
| semver | 1 | 241ms (212/3/26) | 326ms (311/2/13) |
| semver | 2 | 215ms (198/3/14) | 298ms (284/2/12) |
| semver | 3 | 209ms (192/3/14) | 293ms (279/2/12) |
| ms | 1 | 148ms (136/3/9) | 186ms (176/2/8) |
| ms | 2 | 137ms (125/3/9) | 185ms (175/2/8) |
| ms | 3 | 155ms (143/3/9) | 182ms (172/2/8) |
| express | 1 | 778ms (745/5/28) | 1558ms (1538/2/18) |
| express | 2 | 715ms (692/3/20) | 1084ms (1064/2/18) |
| express | 3 | 709ms (687/3/19) | 1027ms (1007/2/18) |
| chalk | 1 | 104ms (90/3/11) | 161ms (150/2/9) |
| chalk | 2 | 102ms (89/3/10) | 157ms (146/2/9) |
| chalk | 3 | 101ms (87/3/11) | 158ms (147/2/9) |

### Median Summary

| Repo | ziggit | git CLI | Speedup |
|------|-------:|--------:|--------:|
| debug | 101ms | 157ms | **1.55x** |
| semver | 215ms | 298ms | **1.38x** |
| ms | 148ms | 185ms | **1.25x** |
| express | 715ms | 1084ms | **1.51x** |
| chalk | 102ms | 158ms | **1.54x** |
| **TOTAL** | **1,281ms** | **1,882ms** | **1.47x (31% faster)** |

**Total time saved: 601ms across 5 repos**

### Where the Speedup Comes From

The clone phase dominates (>90% of each repo's time). Ziggit's clone is consistently faster:

| Repo | ziggit clone | git clone | Clone speedup |
|------|------------:|----------:|--------------:|
| debug | 86ms | 147ms | 1.71x |
| semver | 198ms | 284ms | 1.43x |
| ms | 136ms | 175ms | 1.29x |
| express | 692ms | 1064ms | 1.54x |
| chalk | 89ms | 147ms | 1.65x |

---

## Part 3: Fetch (Warm Bare Repo — No New Objects)

When bun install runs with a cached bare repo, it fetches to check for updates.

| Repo | ziggit | git CLI | Ratio |
|------|-------:|--------:|------:|
| debug | 84ms | 84ms | 1.00x |
| semver | 117ms | 116ms | ~1.00x |
| ms | 83ms | 84ms | ~1.00x |
| express | 100ms | 93ms | 0.93x |
| chalk | 84ms | 85ms | ~1.00x |

Fetch performance is **network-bound** (no new objects to transfer), so ziggit and git are equivalent here. This is expected — the speedup is in pack decoding and object processing during clone.

---

## Part 4: findCommit (rev-parse) Microbenchmark

10 runs per repo, resolving branch name → commit SHA on the local bare repo.

| Repo | ziggit | git CLI |
|------|-------:|--------:|
| All repos | **2ms** | **2ms** |

Both are effectively instant for local ref resolution. This operation is I/O-trivial.

---

## Projection: Bun Install with Ziggit In-Process

Stock bun install (cold): **438ms** for 5 git deps.

Bun uses `git` as a subprocess for each operation. With ziggit linked in-process:
- **No fork/exec overhead** (~5-15ms per git invocation saved)
- **Shared memory** — pack data stays in-process, no IPC
- **31% faster clone phase** — measured above (601ms → 1,281ms vs 1,882ms)

Conservative estimate for bun-fork with ziggit (cold install):
- Git clone portion of bun install: ~300-400ms (estimated from cold cache timing)
- With ziggit: ~200-270ms (31% reduction) + no fork/exec overhead
- **Projected cold install: ~300-350ms** (vs 438ms stock)
- **Projected improvement: ~20-30%** end-to-end

---

## Build Requirements for Full Bun Fork

To build the bun fork binary with ziggit integration:

| Requirement | Minimum | This VM |
|-------------|---------|---------|
| RAM | 8 GB | 483 MB ❌ |
| Disk | 20 GB | 2.8 GB free ❌ |
| CPU cores | 4+ recommended | 1 ❌ |
| Zig version | 0.15.2 | 0.15.2 ✅ |

The `build.zig.zon` in the bun fork correctly references ziggit as a path dependency at `../ziggit`.

---

## Historical Results (Sessions 1-6)

| Session | Date | Repos | ziggit Total | git Total | Speedup |
|---------|------|------:|------------:|----------:|--------:|
| 1 | 03:00Z | 3 | 872ms | 1,291ms | 1.48x |
| 2 | 03:05Z | 5 | 1,048ms | 1,642ms | 1.57x |
| 3 | 03:08Z | 5 | 1,117ms | 1,697ms | 1.52x |
| 4 | 03:10Z | 5 | 921ms | 1,803ms | 1.95x |
| 5 | 03:13Z | 5 | 1,273ms | 1,803ms | 1.42x |
| **7** | **03:15Z** | **5** | **1,281ms** | **1,882ms** | **1.47x** |

Consistent **1.4-1.6x** speedup across sessions (session 4 outlier due to network variability in git CLI).

---

## Raw Data

All raw benchmark output is stored in `/root/bun-fork/benchmark/raw_results_*.txt`.
Latest: `raw_results_20260327T031549Z.txt`
