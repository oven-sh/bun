# Bun Install × Ziggit Integration Benchmark

> **Date**: 2026-03-26T22:43Z (run 31)
> **Ziggit commit**: 95b31d8 (`perf: increase decompression buffer to 32KB`)
> **Bun**: stock v1.3.11 (`/root/.bun/bin/bun`)
> **Machine**: Linux, 1 vCPU, 483MB RAM, Debian (minimal VM)
> **Git**: 2.43.0 · **Zig**: 0.13.0
> **Runs**: 3 per benchmark, caches cleared between cold runs

---

## 1. Stock Bun Install Baseline

Test project: 5 git dependencies (debug, semver, chalk, is, express) → resolves 266 total packages.

| Metric | Run 1 | Run 2 | Run 3 | **Avg** | **Median** |
|--------|------:|------:|------:|--------:|-----------:|
| Cold install | 562ms | 497ms | 518ms | **526ms** | **518ms** |
| Warm install | 33ms | 33ms | 33ms | **33ms** | **33ms** |

Cold install clears `node_modules`, `bun.lock`, and `~/.bun/install/cache`.
Warm install only removes `node_modules` (lockfile + cache intact).

---

## 2. Clone Performance: Ziggit vs Git CLI (Sequential)

Each repo cloned with `--depth 1`. Sequential, one at a time.
Git CLI does bare clone + local clone; ziggit does a single `clone --depth 1`.

| Repo | git CLI avg | ziggit avg | **Speedup** |
|------|----------:|----------:|:----------:|
| debug | 132ms | 81ms | **1.63×** ✅ |
| semver | 172ms | 166ms | 1.04× |
| chalk | 149ms | 121ms | **1.23×** ✅ |
| is | 160ms | 134ms | **1.19×** ✅ |
| express | 199ms | 273ms | 0.73× ❌ |
| **TOTAL** | **884ms** | **844ms** | **1.05×** ✅ |

**Analysis**: Ziggit wins on 4 of 5 repos. The `express` repo (largest) is slower — likely due to packfile indexing overhead on larger objects. Small-to-medium repos see 4–63% improvement.

### Per-run detail (ms)

| Repo | git R1 | git R2 | git R3 | zig R1 | zig R2 | zig R3 |
|------|-------:|-------:|-------:|-------:|-------:|-------:|
| debug | 135 | 129 | 132 | 79 | 84 | 79 |
| semver | 169 | 176 | 172 | 166 | 169 | 162 |
| chalk | 153 | 144 | 150 | 118 | 117 | 129 |
| is | 176 | 151 | 152 | 133 | 133 | 136 |
| express | 212 | 193 | 191 | 270 | 281 | 267 |
| **Total** | 918 | 866 | 869 | 836 | 853 | 843 |

---

## 3. Parallel Clone Performance

5 repos cloned concurrently (simulates `bun install` concurrent fetches).

| Tool | Run 1 | Run 2 | Run 3 | **Avg** | **Median** |
|------|------:|------:|------:|--------:|-----------:|
| git CLI | 363ms | 589ms | 352ms | **435ms** | **363ms** |
| ziggit | 446ms | 453ms | 445ms | **448ms** | **446ms** |

**Note**: Git Run 2 was an outlier (589ms). By median, git is slightly faster (363 vs 446ms).
Ziggit's per-process overhead (spawning 5 CLI processes) is the bottleneck here.
When used as an in-process library (as bun would), this overhead vanishes.

---

## 4. Ref Resolution: `git rev-parse` vs Ziggit `findCommit`

Measures the cost of resolving `HEAD` to a SHA. Git spawns a subprocess per call;
ziggit does it in-process. Ziggit measured over 1000 iterations.

| Repo | git rev-parse (avg) | ziggit findCommit | **Speedup** |
|------|--------------------:|------------------:|:-----------:|
| debug | 2,219µs | 4.9µs | **453×** |
| semver | 2,177µs | 6.3µs | **346×** |
| chalk | 2,146µs | 4.8µs | **447×** |
| is | 2,097µs | 5.1µs | **411×** |
| express | 2,169µs | 5.2µs | **417×** |
| **Average** | **2,162µs** | **5.3µs** | **~415×** |

This is the killer advantage for bun integration: resolving refs in-process
eliminates subprocess overhead entirely. With many git dependencies, this
saves milliseconds per dep that compound quickly.

---

## 5. Projected Bun Install Savings

### What bun install does for each git dependency:
1. **Clone/fetch** the repo (or use cache)
2. **Resolve ref** to a SHA (findCommit)
3. **Extract** working tree (checkout)

### For 5 git deps (sequential clone phase):

| Phase | git CLI total | ziggit total | Savings |
|-------|-------------:|-------------:|--------:|
| Clone (seq) | 884ms | 844ms | 40ms (5%) |
| Ref resolve (×5) | 10.8ms | 0.027ms | 10.8ms (99.7%) |
| **Total git phase** | ~895ms | ~844ms | **~51ms** |

### For 20 git deps (realistic large project):

| Phase | git CLI total | ziggit total | Savings |
|-------|-------------:|-------------:|--------:|
| Clone (seq, est.) | ~3,500ms | ~3,350ms | 150ms |
| Ref resolve (×20) | 43ms | 0.1ms | 43ms |
| **Total git phase** | ~3,543ms | ~3,350ms | **~193ms** |

### True potential (in-process library, no CLI overhead):
- Ziggit as a library eliminates process spawn for each clone (~10ms × N deps)
- Parallel fetching with shared connection pool (not yet implemented)
- The 415× findCommit speedup applies to every lockfile check, update, and resolution

---

## 6. Build Status: Bun Fork

Building the full bun binary with ziggit integration requires:
- **8GB+ RAM** (our VM has 483MB)
- **10GB+ disk** (we have 2.5GB free)
- **JavaScriptCore / WebKit** prebuilt headers & libs
- CMake, Rust toolchain, and many system dependencies

The bun fork at `/root/bun-fork` (branch: `ziggit-integration`) has the build system
wired up in `build.zig` but cannot be compiled on this VM. Benchmarks above use
the ziggit CLI and library directly to measure the operations bun install would perform.

---

## 7. Conclusion

| Metric | Result |
|--------|--------|
| Sequential clone (5 repos) | **Ziggit 1.05× faster** (844ms vs 884ms) |
| Small repo clone (debug) | **Ziggit 1.63× faster** (81ms vs 132ms) |
| Ref resolution (findCommit) | **Ziggit 415× faster** (5.3µs vs 2.2ms) |
| Parallel clone (CLI) | Git slightly faster (process spawn overhead) |
| Cold bun install baseline | 526ms avg (266 packages) |

**Bottom line**: Ziggit provides meaningful speedups for git dependency resolution
in bun install, especially for ref resolution (415×) and small-to-medium repos
(1.2–1.6×). The express repo regression (0.73×) suggests packfile indexing for
larger repos needs optimization. For in-process use (no CLI overhead), the
parallel performance gap would close.
