# Bun Install Benchmark: Stock Bun vs Ziggit Integration

**Date:** 2026-03-27 02:13 UTC  
**Machine:** x86_64, 1 CPU, 483MB RAM  
**Stock Bun:** v1.3.11  
**Git:** git version 2.43.0  
**Ziggit:** built from `/root/ziggit` (Zig 0.15.2, ReleaseSafe)  
**Runs per benchmark:** 3  

---

## Summary

Building the full bun fork binary is **not feasible** on this VM (483MB RAM, 1 CPU, 2.4GB free disk).
The bun fork requires ≥8GB RAM and multi-core for `zig build -Doptimize=ReleaseFast`.

Instead, we benchmark:
1. **Stock bun install** with git dependencies (baseline)
2. **Ziggit CLI vs git CLI** performing the *exact same workflow* that `bun install` uses
   for git dependencies: `clone --bare` → `findCommit (rev-parse)` → `checkout`

---

## Part 1: Stock Bun Install (git dependencies)

| Scenario | Run 1 | Run 2 | Run 3 | Average |
|----------|------:|------:|------:|--------:|
| Cold cache | 188ms | 133ms | 170ms | **163ms** |
| Warm cache | 46ms | 117ms | 46ms | **69ms** |

Dependencies: `debug`, `node-semver`, `chalk` (all `github:` specifiers)

> Note: Bun uses its own HTTP-based GitHub tarball fetcher for `github:` deps, not
> git clone. The Part 2 benchmark isolates the git operations pathway specifically.

---

## Part 2: Ziggit vs Git CLI — Per-Repo Breakdown

Workflow per repo (mirrors `src/install/repository.zig`):
1. `clone --bare <url>` — fetch packfile from remote
2. `rev-parse HEAD` — resolve default branch to SHA (`findCommit`)
3. `clone --no-checkout <bare> <dir> && checkout <sha>` — extract working tree

### Individual Run Data (ms)

| Run | Repo | Tool | Clone | FindCommit | Checkout | **Total** |
|-----|------|------|------:|-----------:|---------:|----------:|
| 1 | debug | git | 139 | 3 | 9 | **151** |
| 1 | debug | ziggit | 81 | 3 | 10 | **94** |
| 1 | node-semver | git | 231 | 3 | 12 | **246** |
| 1 | node-semver | ziggit | 141 | 3 | 11 | **155** |
| 1 | chalk | git | 145 | 3 | 9 | **157** |
| 1 | chalk | ziggit | 89 | 3 | 9 | **101** |
| 2 | debug | git | 145 | 2 | 9 | **156** |
| 2 | debug | ziggit | 75 | 3 | 10 | **88** |
| 2 | node-semver | git | 219 | 2 | 13 | **234** |
| 2 | node-semver | ziggit | 135 | 3 | 12 | **150** |
| 2 | chalk | git | 154 | 2 | 10 | **166** |
| 2 | chalk | ziggit | 84 | 3 | 9 | **96** |
| 3 | debug | git | 158 | 2 | 9 | **169** |
| 3 | debug | ziggit | 77 | 4 | 11 | **92** |
| 3 | node-semver | git | 232 | 2 | 13 | **247** |
| 3 | node-semver | ziggit | 132 | 3 | 11 | **146** |
| 3 | chalk | git | 139 | 3 | 9 | **151** |
| 3 | chalk | ziggit | 93 | 3 | 9 | **105** |

### Averages (ms) over 3 runs

| Repo | Tool | Clone | FindCommit | Checkout | **Total** | **Δ** |
|------|------|------:|-----------:|---------:|----------:|------:|
| debug | git | 147 | 2 | 9 | **159** | — |
| debug | ziggit | 78 | 3 | 10 | **91** | **-42%** |
| node-semver | git | 227 | 2 | 13 | **242** | — |
| node-semver | ziggit | 136 | 3 | 11 | **150** | **-38%** |
| chalk | git | 146 | 3 | 9 | **158** | — |
| chalk | ziggit | 89 | 3 | 9 | **101** | **-36%** |

### Totals (sum of all 3 repos, averaged)

| Metric | Value |
|--------|------:|
| Git CLI total | **559ms** |
| Ziggit total | **342ms** |
| **Δ Savings** | **217ms (39%)** |

The **clone step dominates** — ziggit's clone is ~40% faster than git's. The `findCommit`
and `checkout` steps are comparable because they operate on local data.

---

## Projection: Bun Install with Ziggit Integration

Stock bun install (cold) takes **163ms** for 3 git dependencies using its HTTP tarball
fetcher. For repos that require actual git operations (private repos, non-GitHub hosts,
specific SHAs), bun falls back to `git clone` subprocess calls.

For the git-operations pathway:

| Metric | Git CLI | Ziggit CLI | Ziggit In-Process (projected) |
|--------|--------:|-----------:|------------------------------:|
| 3 repos total | 559ms | 342ms | **~300ms** |
| Savings vs git CLI | — | 217ms (39%) | **~260ms (46%)** |
| Per-repo average | 186ms | 114ms | **~100ms** |

### Why in-process savings will be higher than CLI benchmarks show

These benchmarks use the ziggit **CLI binary**, which still pays process spawn costs.
The bun fork calls ziggit as an **in-process Zig library** (linked via `build.zig.zon`):

1. **No process spawning** — eliminates `fork()`+`exec()` overhead (~3–5ms × 3 calls per repo × N repos)
2. **Shared allocator** — memory reuse across clone/resolve/checkout; no per-process heap setup
3. **No pipe I/O** — results returned directly as Zig values, not parsed from stdout
4. **Parallel-safe** — bun can call ziggit concurrently from its thread pool without fd contention
5. **Pack parsing** — ziggit's two-pass zero-alloc pack scanner vs git's malloc-heavy approach

### Where ziggit wins most

The **clone** step shows the biggest improvement (~40% faster). This is where ziggit's
native HTTP client and zero-alloc pack parser have the most impact:
- Ziggit uses `std.http` directly vs git's curl-based transport
- Pack index is built with bounded-memory two-pass scan
- No subprocess orchestration (`git-remote-https`, `git-fetch-pack`, etc.)

---

## Build Requirements for Full Bun Fork

To build and test `bun-fork` with ziggit integration end-to-end:

| Requirement | Value |
|-------------|-------|
| RAM | ≥8 GB (16 GB recommended) |
| Disk | ≥10 GB free |
| CPU | ≥4 cores recommended |
| Zig | 0.15.x (matching bun's pinned version) |
| Command | `cd /root/bun-fork && zig build -Doptimize=ReleaseFast` |
| Ziggit dep | Resolved via `build.zig.zon` → `../ziggit` |

The integration is in `src/install/repository.zig` which:
- Tries ziggit first for clone, fetch, findCommit, and checkout
- Falls back to git CLI on any ziggit error (SSH auth, unsupported protocol, etc.)
- Categorizes errors with actionable debug messages

---

## Notes on Methodology

- **Cold cache** for bun install: `~/.bun/install/cache` deleted + `node_modules` + `bun.lock` removed
- **Warm cache** for bun install: only `node_modules` + `bun.lock` removed (git/tarball cache retained)
- **Ziggit checkout fallback**: For repos where ziggit's bare clone doesn't set HEAD symref
  (e.g., `main`-default repos), the checkout step falls back to git CLI. This is the same
  fallback behavior implemented in `repository.zig`.
- All times measured with `date +%s%3N` (millisecond precision)
- Each benchmark run clones fresh from the network (no local repo cache)
- Disk cleanup between each repo to stay within 2.4GB free disk constraint
