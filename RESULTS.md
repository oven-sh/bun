# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-27 (Session 19 — fresh end-to-end benchmarks)
- Ziggit: `b6ce769` (pure Zig git library), Zig 0.15.2
- Bun: 1.3.11 (stock), fork branch: ziggit-integration
- Machine: Linux 6.1.141 x86_64, 483MB RAM, 1 vCPU, 2GB swap
- Git: 2.43.0

## Build Status

Full bun fork binary **cannot be built** on this VM (needs ≥8GB RAM, ≥20GB disk).
`build.zig.zon` correctly wires ziggit as `../ziggit` path dependency.
Library benchmark (`benchmark/lib_bench.zig`) built successfully with ReleaseFast.

---

## Session 19: Fresh End-to-End Benchmarks (2026-03-27T04:10Z)

### Stock Bun Install Baseline (5 git deps: debug, chalk, is, semver, express)

69 packages total (5 git + 64 npm transitive deps).

| Scenario    | Run 1 | Run 2 | Run 3 | Avg    |
|-------------|------:|------:|------:|-------:|
| Cold cache  | 540ms | 472ms | 346ms | **453ms** |
| Warm cache  | 24ms  | 24ms  | 24ms  | **24ms**  |

### Library Integration Benchmark (ziggit lib calls vs git CLI subprocesses)

4 repos, 3 runs × 20 iterations each = 60 measurements per operation per repo.

#### findCommit (rev-parse HEAD) — Average: **6.6× faster**

| Repo        | Size  | ziggit (μs) | git CLI (μs) | Speedup |
|-------------|-------|-------------|--------------|---------|
| debug       | 596KB | 166–182     | 1031–1190    | **6.1–6.5×** |
| chalk       | 1.2MB | 124–153     | 1032–1048    | **6.7–8.4×** |
| is          | 1.4MB | 215–216     | 1055–1069    | **4.8–4.9×** |
| node-semver | 1.6MB | 133–151     | 1041–1098    | **6.9–7.8×** |

#### cloneBare (local bare clone) — Average: **3.3× faster**

| Repo        | Size  | ziggit (μs) | git CLI (μs) | Speedup |
|-------------|-------|-------------|--------------|---------|
| debug       | 596KB | 847–930     | 4392–4665    | **5.0–5.2×** |
| chalk       | 1.2MB | 1216–1736   | 3989–4062    | **2.3–3.2×** |
| is          | 1.4MB | 1669–1831   | 4200–4226    | **2.3–2.5×** |
| node-semver | 1.6MB | 1757–1937   | 5446–5453    | **2.8–3.1×** |

#### Full Workflow (cloneBare + findCommit + checkout) — Average: **5.0× faster**

| Repo        | ziggit (μs) | git CLI (μs) | Speedup |
|-------------|-------------|--------------|---------|
| debug       | 1599–1706   | 11018–11101  | **6.4–6.9×** |
| chalk       | 2434–2567   | 12005–12043  | **4.6–4.9×** |
| is          | 3232–3249   | 12425–12446  | **3.8×**     |
| node-semver | 3476–3487   | 16180–16280  | **4.6×**     |

### Projected Impact

- **5 git deps**: −51ms (−11% of total cold install)
- **20 git deps**: −204ms (−35% of total cold install)
- **50 git deps**: −510ms (−57% of total cold install)

---

## Previous Sessions

### Session 18 (2026-03-27T04:05Z)

| Scenario    | Run 1 | Run 2 | Run 3 | Avg    |
|-------------|------:|------:|------:|-------:|
| Cold cache  | 453ms | 512ms | 431ms | **465ms** |
| Warm cache  | 24ms  | 24ms  | 28ms  | **25ms**  |

findCommit: 6.3× faster | cloneBare: 3.3× faster | Full: 4.9× faster

### Session 17 (2026-03-27T04:01Z)

| Scenario    | Run 1 | Run 2 | Run 3 | Avg    |
|-------------|------:|------:|------:|-------:|
| Cold cache  | 605ms | 395ms | 286ms | **429ms** |
| Warm cache  | 24ms  | 23ms  | 22ms  | **23ms**  |

findCommit: 6.9× faster | cloneBare: 3.5× faster | Full: 4.9× faster
