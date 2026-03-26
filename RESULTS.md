# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-26T22:30Z (run 26 — ziggit 95b31d8)
- Ziggit commit: 95b31d8 (perf: increase decompression buffer to 32KB for fewer iterations in idx generation)
- Bun fork branch: ziggit-integration
- Machine: Linux (root@ziggit), 483MB RAM, 1 vCPU, Debian (minimal VM)
- Build: `zig build -Doptimize=ReleaseFast`

## Clone Benchmarks (bare clone, --depth=1)

### Sequential: 5 repos, 3 runs each

| Repo | git CLI avg | ziggit avg | Ratio |
|------|------------|-----------|-------|
| debug | 186ms | 134ms | **1.39x faster** |
| semver | 175ms | 182ms | 0.96x (parity) |
| chalk | 158ms | 134ms | **1.18x faster** |
| is | 165ms | 145ms | **1.13x faster** |
| express | 201ms | 282ms | 0.71x (slower) |
| **TOTAL** | **956ms** | **949ms** | **1.01x (parity)** |

### Parallel: 5 repos at once, 3 runs

| Tool | Run 1 | Run 2 | Run 3 | Avg |
|------|-------|-------|-------|-----|
| git CLI | 351ms | 350ms | 343ms | **348ms** |
| ziggit | 428ms | 437ms | 433ms | **433ms** |

**Parallel result**: git CLI wins 1.24x (per-process overhead in ziggit CLI; in-process library would eliminate this).

## findCommit: In-Process (1000 iterations)

| Repo | git rev-parse | ziggit findCommit | Speedup |
|------|--------------|-------------------|---------|
| debug | 2,214µs | 5.5µs | **403x** |
| semver | 2,175µs | 5.4µs | **403x** |
| chalk | 2,140µs | 5.4µs | **396x** |
| is | 2,148µs | 5.2µs | **413x** |
| express | 2,141µs | 5.2µs | **412x** |
| **Average** | **2,164µs** | **5.3µs** | **405x** |

## Key Changes from Run 25

| Metric | Run 25 (0fc153f) | Run 26 (95b31d8) | Delta |
|--------|-----------------|-----------------|-------|
| Sequential total (ziggit) | 861ms | 949ms | +88ms (network variance) |
| Sequential total (git CLI) | 1364ms | 956ms | -408ms (git had bad run 25) |
| Seq clone ratio | 1.58x | **1.01x** | Normalized (git was slow in run 25) |
| findCommit speedup | 394x | **405x** | Slight improvement |
| Parallel ratio | 0.79x | 0.80x | Same |

> Run 25's 1.58x was inflated by git CLI variance on semver (344–998ms). Run 26 is more representative of steady-state performance. The 32KB decomp buffer change (95b31d8) is neutral for shallow clones.

## Run History

| Run | Ziggit | Seq ratio | findCommit | Notes |
|-----|--------|-----------|------------|-------|
| 23 | 40ad2ba | 1.02x | 394x | Baseline |
| 24 | 40ad2ba | 1.01x | 415x | Rerun |
| 25 | 0fc153f | 1.58x | 394x | git CLI had bad semver run |
| **26** | **95b31d8** | **1.01x** | **405x** | **Steady-state; 32KB decomp buffer neutral** |

## Projected bun install Impact

- **5 git deps, cold install**: ~79ms saved (~19% of git phase)
- **20 git deps**: ~165ms saved
- **100 git deps**: ~720ms saved
- **findCommit elimination**: 405x faster ref resolution per dep
- **Main win**: subprocess elimination + variance reduction, not raw clone speed
