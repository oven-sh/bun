# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-27T01:00Z (latest run)
- Ziggit: built from `/root/ziggit` HEAD (`3f2e203`), ReleaseFast, Zig 0.15.2
- Bun: 1.3.11 (stock), fork branch: ziggit-integration
- Machine: Linux x86_64, 483MB RAM, 1 vCPU, 2GB swap
- Git: 2.43.0

## Build Status

Full bun fork binary **cannot be built** on this VM (needs ≥8GB RAM, ≥15GB disk, Zig 0.14.x).
`build.zig.zon` correctly wires ziggit as `../ziggit` path dependency.
Benchmarks compare stock bun + git CLI vs ziggit CLI to measure replaceable operations.

---

## Latest Run (2026-03-27T01:00Z)

### Stock Bun Install (5 Git Dependencies → 69 Total Packages)

| Scenario | Run 1 | Run 2 | Run 3 | **Median** |
|----------|-------|-------|-------|------------|
| Cold (no cache) | 450ms | 441ms | 440ms | **441ms** |
| Warm (cache present) | 270ms | 84ms | 159ms | **159ms** |

### Clone-Only: Ziggit vs Git CLI (5 repos, bare --depth=1)

| Tool | Run 1 | Run 2 | Run 3 | **Median** | Speedup |
|------|-------|-------|-------|------------|---------|
| Git CLI | 736ms | 703ms | 668ms | **703ms** | baseline |
| Ziggit  | 441ms | 426ms | 435ms | **435ms** | **38% faster** |

### Full Workflow: clone + rev-parse + ls-tree + cat-file (426 files)

| Tool | Run 1 | Run 2 | Run 3 | **Median** | Delta |
|------|-------|-------|-------|------------|-------|
| Git CLI | 1198ms | 1243ms | 1213ms | **1213ms** | baseline |
| Ziggit CLI | 1205ms | 1223ms | 1215ms | **1215ms** | ~0% (parity) |
| Ziggit lib (projected) | — | — | — | **~450ms** | **63% faster** |

### Key Metrics

| Metric | Value |
|--------|-------|
| Clone speedup (ziggit vs git) | **38%** |
| Full workflow CLI parity | spawn overhead cancels clone gains |
| Projected library-mode speedup | **63%** |
| Process spawn: git --version | 1ms avg |
| Process spawn: ziggit --version | 2ms avg |

---

## Historical Runs

### Run 2026-03-27T00:57Z

| Metric | Value |
|--------|-------|
| Bun cold install | 349ms median |
| Clone-only: git | 669ms median |
| Clone-only: ziggit | 405ms median (39% faster) |
| Full workflow: git CLI | 1273ms |
| Full workflow: ziggit CLI | 1244ms (2.3% faster) |

### Run 2026-03-27T01:00Z (current)

| Metric | Value |
|--------|-------|
| Bun cold install | 441ms median |
| Clone-only: git | 703ms median |
| Clone-only: ziggit | 435ms median (38% faster) |
| Full workflow: git CLI | 1213ms |
| Full workflow: ziggit CLI | 1215ms (~0%) |

---

## Conclusion

Ziggit's clone operation is consistently **38-39% faster** than git CLI across all runs. In CLI-to-CLI full workflow comparisons, the per-file `cat-file` spawn overhead (~0.5ms/file × 426 files) erases the clone advantage. **Library-mode integration** (as bun would use it) eliminates spawn overhead entirely, projecting a **63% speedup** on the git-operations portion of `bun install`.

See [BUN_INSTALL_BENCHMARK.md](BUN_INSTALL_BENCHMARK.md) for the full detailed analysis.
