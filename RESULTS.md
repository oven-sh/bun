# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-27 (Session 21 — fresh end-to-end benchmarks)
- Ziggit: `b6ce769` (pure Zig git library), Zig 0.15.2
- Bun: 1.3.11 (stock), fork branch: ziggit-integration
- Machine: Linux 6.1.141 x86_64, 483MB RAM, 1 vCPU, 2GB swap
- Git: 2.43.0

## Build Status

Full bun fork binary **cannot be built** on this VM (needs ≥8GB RAM, ≥20GB disk).
`build.zig.zon` correctly wires ziggit as `../ziggit` path dependency.
Library benchmark (`benchmark/lib_bench.zig`) built successfully with ReleaseFast.

---

## Session 21: Fresh End-to-End Benchmarks (2026-03-27T04:17Z)

### Stock Bun Install Baseline (5 git deps: debug, chalk, is, semver, express)

69 packages total (5 git + 64 npm transitive deps).

| Scenario    | Run 1 | Run 2 | Run 3 | Avg    |
|-------------|------:|------:|------:|-------:|
| Cold cache  | 489ms | 375ms | 401ms | **422ms** |
| Warm cache  | 25ms  | 24ms  | 24ms  | **24ms**  |

### Library Integration Benchmark (ziggit lib calls vs git CLI subprocesses)

5 repos, 3 runs each. 20 iterations per run (10 for express).

#### findCommit (rev-parse HEAD) — Average: **7.3× faster**

| Repo        | Size  | ziggit (μs) | git CLI (μs) | Speedup |
|-------------|-------|-------------|--------------|---------|
| debug       | 596KB | 170         | 1027         | **6.0×** |
| chalk       | 1.2MB | 129         | 1034         | **8.0×** |
| is          | 1.4MB | 206         | 1047         | **5.1×** |
| node-semver | 1.6MB | 133         | 1047         | **7.9×** |
| express     | 11MB  | 109         | 1041         | **9.5×** |

#### cloneBare (local) — **2.4–5.0× faster** for repos ≤1.6MB

| Repo        | Size  | ziggit (μs) | git CLI (μs) | Speedup |
|-------------|-------|-------------|--------------|---------|
| debug       | 596KB | 883         | 4425         | **5.0×** |
| chalk       | 1.2MB | 1266        | 4034         | **3.2×** |
| is          | 1.4MB | 1760        | 4296         | **2.4×** |
| node-semver | 1.6MB | 1846        | 5567         | **3.0×** |
| express     | 11MB  | 9683        | 6572         | 0.68×   |

Note: For the large express repo (11MB), git CLI's optimized pack-copy path beats
ziggit's byte-level copy. This is an optimization target for ziggit.

#### Full Workflow (cloneBare + findCommit + checkout) — **4.6× faster** (small repos)

| Repo        | Size  | ziggit (μs) | git CLI (μs) | Speedup |
|-------------|-------|-------------|--------------|---------|
| debug       | 596KB | 1704        | 11089        | **6.5×** |
| chalk       | 1.2MB | 2530        | 12239        | **4.8×** |
| is          | 1.4MB | 3482        | 12708        | **3.6×** |
| node-semver | 1.6MB | 3648        | 16560        | **4.5×** |
| express     | 11MB  | 20456       | 21473        | 1.0×    |

### Projected Impact on bun install

For a 5-git-dep project (cold cache, avg 422ms):
- Git dep resolution: ~74ms → ~32ms (**42ms saved, 10.0% faster**)
- Scales linearly: 10 deps → ~84ms saved, 20 deps → ~168ms saved

### Key Findings

1. **findCommit is the biggest win**: 7.3× average speedup across all repo sizes.
   Fork+exec overhead (~1ms) dominates for this lightweight operation.

2. **cloneBare wins for typical npm-sized repos**: 2.4–5.0× faster for repos ≤1.6MB.
   Git CLI catches up on large repos (11MB+) due to optimized pack hardlinking.

3. **Full workflow: 4.6× faster for typical deps**: Most npm git dependencies are
   small (median <2MB bare). The 4.6× speedup on the full clone+resolve+checkout
   workflow translates to real savings in `bun install`.

4. **Diminishing returns on warm cache**: Warm `bun install` (24ms) is dominated
   by lockfile parsing and symlink creation, not git operations. Ziggit integration
   primarily benefits cold installs.
