# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-27T01:28Z (latest run)
- Ziggit: built from `/root/ziggit` HEAD (8bdce12), Zig 0.15.2, ReleaseFast
- Bun: 1.3.11 (stock), fork branch: ziggit-integration
- Machine: Linux x86_64, 483MB RAM, 1 vCPU, 2GB swap
- Git: 2.43.0

## Build Status

Full bun fork binary **cannot be built** on this VM (needs ≥8GB RAM, ≥15GB disk, Zig 0.14.x).
`build.zig.zon` correctly wires ziggit as `../ziggit` path dependency.
Benchmarks compare stock bun + git CLI vs ziggit CLI to measure replaceable operations.

---

## Latest Run (2026-03-27T01:28Z)

### Stock Bun Install (5 Git Dependencies → 266 Total Packages)

| Scenario | Run 1 | Run 2 | Run 3 | Median |
|----------|-------|-------|-------|--------|
| Cold cache | 485ms | 465ms | 328ms | **465ms** |
| Warm cache | 76ms | 81ms | 78ms | **78ms** |

### Clone: Ziggit vs Git CLI (5 repos, bare --depth=1)

| Tool | Run 1 | Run 2 | Run 3 | Median | Speedup |
|------|-------|-------|-------|--------|---------|
| Git CLI | 700ms | 658ms | 639ms | **658ms** | baseline |
| Ziggit  | 401ms | 390ms | 417ms | **401ms** | **1.64×** |

### Full Workflow: clone + rev-parse + ls-tree + cat-file (all 426 blobs)

| Tool | Run 1 | Run 2 | Run 3 | Median | Speedup |
|------|-------|-------|-------|--------|---------|
| Git CLI | 1,250ms | 1,204ms | 1,226ms | **1,226ms** | baseline |
| Ziggit CLI | 1,212ms | 1,206ms | 1,227ms | **1,212ms** | **1.01×** |

### Spawn Overhead (200 iterations)

| Tool | Per-call | Delta |
|------|----------|-------|
| git | 0.95ms | — |
| ziggit | 1.53ms | +0.57ms |
| × 426 files | | **+245ms** |

### Projected Library-Mode Performance

| Metric | Git CLI | Ziggit Library | Speedup |
|--------|---------|----------------|---------|
| Full git dep workflow | ~1,205ms | ~406ms | **~3.0×** |
| bun install (cold) | ~465ms | ~165ms | **~2.8×** |

---

## Per-Repo Clone Medians (ms)

| Repo | Files | Git CLI | Ziggit | Speedup |
|------|-------|---------|--------|---------|
| sindresorhus/is | 15 | 130 | 74 | 1.76× |
| expressjs/express | 213 | 162 | 110 | 1.47× |
| chalk/chalk | 34 | 124 | 69 | 1.80× |
| debug-js/debug | 13 | 121 | 73 | 1.66× |
| npm/node-semver | 151 | 132 | 72 | 1.83× |

## Key Findings

1. **Clone speed**: Ziggit is **1.64× faster** than git CLI for shallow bare clones
2. **CLI workflow**: Gains canceled by spawn overhead (+0.57ms/call × 426 = +245ms)
3. **Library mode** (the real integration): Projected **~3× faster** — zero spawn cost
4. **Bottom line**: `bun install` with ziggit library should drop from ~465ms → ~165ms for git-heavy projects

See [BUN_INSTALL_BENCHMARK.md](./BUN_INSTALL_BENCHMARK.md) for full details.
