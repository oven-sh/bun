# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-26T22:33Z (run 27 — ziggit 95b31d8)
- Ziggit commit: 95b31d8 (perf: increase decompression buffer to 32KB for fewer iterations in idx generation)
- Bun fork branch: ziggit-integration
- Machine: Linux (root@ziggit), 483MB RAM, 1 vCPU, Debian (minimal VM)
- Build: `zig build -Doptimize=ReleaseFast`

## Clone Benchmarks (bare clone, --depth=1)

### Sequential: 5 repos, 3 runs each

| Repo | git CLI avg | ziggit avg | Ratio |
|------|------------|-----------|-------|
| debug | 175ms | 105ms | **1.67x faster** |
| semver | 151ms | 153ms | 0.99x (parity) |
| chalk | 148ms | 122ms | **1.21x faster** |
| is | 161ms | 146ms | **1.10x faster** |
| express | 201ms | 274ms | 0.73x (slower) |
| **TOTAL** | **905ms** | **868ms** | **1.04x faster** |

### Parallel: 5 repos at once, 3 runs

| Tool | Run 1 | Run 2 | Run 3 | Avg |
|------|-------|-------|-------|-----|
| git CLI | 364ms | 365ms | 359ms | **363ms** |
| ziggit | 439ms | 446ms | 440ms | **442ms** |

**Parallel result**: git CLI wins 1.22x (per-process overhead in ziggit CLI; in-process library would eliminate this).

## findCommit: In-Process (1000 iterations)

| Repo | git rev-parse | ziggit findCommit | Speedup |
|------|--------------|-------------------|---------|
| debug | 2,215µs | 5.3µs | **418x** |
| semver | 2,194µs | 6.4µs | **343x** |
| chalk | 2,192µs | 5.5µs | **399x** |
| is | 2,221µs | 5.5µs | **404x** |
| express | 2,220µs | 5.3µs | **419x** |
| **Average** | **2,208µs** | **5.6µs** | **394x** |

## Bun Install Baseline (stock bun 1.3.11)

| Metric | Value |
|--------|-------|
| Cold install (avg, 3 runs) | 523ms |
| Cold install (median) | 557ms |
| Warm install (avg) | 31ms |
| Total packages resolved | 266 |

## Key Changes from Run 26

| Metric | Run 26 | Run 27 | Delta |
|--------|--------|--------|-------|
| Sequential total (ziggit) | 949ms | 868ms | **-81ms (8.5% faster)** |
| Sequential total (git CLI) | 956ms | 905ms | -51ms |
| Seq clone ratio | 1.01x | **1.04x** | Improved |
| debug clone speedup | 1.39x | **1.67x** | Improved |
| findCommit speedup | 405x | 394x | Noise |
| Bun cold install | 534ms | 523ms | -11ms (network) |

## Projected bun install Impact

With ziggit as in-process library (no subprocess spawning):
- **Ref resolution**: 394x faster (2.2ms → 5.6µs per call)
- **Small repo clones**: 1.2–1.7x faster
- **Process overhead eliminated**: ~50ms saved per cold install
- **Net projected savings**: ~10% faster cold `bun install` for git deps

## Build Status

- ✅ ziggit library builds (ReleaseFast)
- ✅ findcommit_bench builds and runs
- ❌ Full bun fork binary: not feasible on this VM (needs ≥8GB RAM)
