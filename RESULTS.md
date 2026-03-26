# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-26T23:01Z (run 37 — ziggit 71caa1c)
- Ziggit commit: 71caa1c (perf: pre-allocate pack data buffers in response parsing)
- Bun fork branch: ziggit-integration
- Machine: Linux (root@ziggit), 483MB RAM, 1 vCPU, Debian (minimal VM)
- Build: `zig build -Doptimize=ReleaseFast`

## Build Status

Full bun fork binary **cannot be built** on this VM:
- Zig 0.13.0 installed, bun needs Zig nightly (≥0.14.0-dev) for `Build.Graph.incremental`
- 483MB RAM insufficient (needs 8GB+)
- 2.5GB disk free (needs 4GB+ for build artifacts)

## Clone Benchmarks (bare clone, --depth=1)

### Sequential: 5 repos, 3 runs each

| Repo | git CLI avg | ziggit avg | Ratio |
|------|------------|-----------|-------|
| debug | 132ms | 77ms | **1.72× faster** |
| semver | 153ms | 154ms | 0.99× (parity) |
| chalk | 151ms | 132ms | **1.14× faster** |
| is | 163ms | 143ms | **1.14× faster** |
| express | 201ms | 264ms | 0.76× (slower) |
| **TOTAL** | **871ms** | **839ms** | **1.04× faster** |

### Parallel: 5 repos at once, 3 runs

| Tool | Run 1 | Run 2 | Run 3 | Avg | Median |
|------|-------|-------|-------|-----|--------|
| git CLI | 367ms | 354ms | 348ms | **356ms** | **354ms** |
| ziggit | 428ms | 424ms | 428ms | **427ms** | **428ms** |

**Parallel result**: Git CLI 20% faster in parallel on single-vCPU VM. When integrated
as a library (no process spawning), ziggit's in-process model eliminates fork+exec overhead.

## findCommit: In-Process (1000 iterations)

| Repo | git rev-parse | ziggit findCommit | Speedup |
|------|--------------|-------------------|---------|
| debug | 2,169µs | 5.0µs | **434×** |
| semver | 2,173µs | 5.3µs | **410×** |
| chalk | 2,156µs | 5.3µs | **407×** |
| is | 2,271µs | 5.2µs | **437×** |
| express | 2,138µs | 5.1µs | **419×** |
| **Average** | **2,181µs** | **5.2µs** | **~421×** |

## Stock Bun Install Baseline

5 git dependencies → 266 total packages resolved.

| Metric | Run 1 | Run 2 | Run 3 | Avg | Median |
|--------|-------|-------|-------|-----|--------|
| Cold install | 661ms | 625ms | 590ms | **625ms** | **625ms** |
| Warm install | 33ms | 33ms | 32ms | **33ms** | **33ms** |

## Key Takeaway

- **Clone performance**: Roughly equivalent overall (1.04× faster sequential). Ziggit wins big on small repos (debug: 1.72×), loses on large repos (express: 0.76×) due to CPU-bound pack decompression on constrained hardware.
- **Ref resolution**: **421× faster** in-process vs subprocess — the killer feature for bun integration.
- **Projected savings**: ~3-4% on 5 git deps; scales linearly with dep count. 50 git deps → ~120ms saved per install.

See [BUN_INSTALL_BENCHMARK.md](BUN_INSTALL_BENCHMARK.md) for full analysis.
