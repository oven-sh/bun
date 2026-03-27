# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-27 (Session 18 — fresh end-to-end benchmarks)
- Ziggit: `203a21b` (pure Zig git library), Zig 0.15.2
- Bun: 1.3.11 (stock), fork branch: ziggit-integration
- Machine: Linux 6.1.141 x86_64, 483MB RAM, 1 vCPU, 2GB swap
- Git: 2.43.0

## Build Status

Full bun fork binary **cannot be built** on this VM (needs ≥8GB RAM, ≥20GB disk).
`build.zig.zon` correctly wires ziggit as `../ziggit` path dependency.
Library benchmark (`benchmark/lib_bench.zig`) built successfully with ReleaseFast.

---

## Session 18: Fresh End-to-End Benchmarks (2026-03-27T04:05Z)

### Stock Bun Install Baseline (5 git deps: debug, chalk, is, semver, express)

69 packages total (5 git + 64 npm transitive deps).

| Scenario    | Run 1 | Run 2 | Run 3 | Avg    |
|-------------|------:|------:|------:|-------:|
| Cold cache  | 453ms | 512ms | 431ms | **465ms** |
| Warm cache  | 24ms  | 24ms  | 28ms  | **25ms**  |

### Library Integration Benchmark (ziggit lib calls vs git CLI subprocesses)

4 repos, 3 runs × 20 iterations each = 60 measurements per operation per repo.

#### findCommit (rev-parse HEAD) — Average: **6.3× faster**

| Repo        | Size  | ziggit (μs) | git CLI (μs) | Speedup |
|-------------|-------|-------------|--------------|---------|
| debug       | 596KB | 162–174     | 999–1055     | **6.0–6.2×** |
| chalk       | 1.2MB | 131–205     | 1023–1202    | **4.9–7.9×** |
| is          | 1.4MB | 210–214     | 1045–1099    | **4.9–5.1×** |
| node-semver | 1.6MB | 129–141     | 1041–1061    | **7.5–8.1×** |

#### cloneBare (local bare clone) — Average: **3.3× faster**

| Repo        | Size  | ziggit (μs) | git CLI (μs) | Speedup |
|-------------|-------|-------------|--------------|---------|
| debug       | 596KB | 820–1199    | 4291–4579    | **3.8–5.2×** |
| chalk       | 1.2MB | 1182–1207   | 3920–3949    | **3.2–3.3×** |
| is          | 1.4MB | 1675–1697   | 4148–4175    | **2.4×**     |
| node-semver | 1.6MB | 1789–1799   | 5526–5554    | **3.0–3.1×** |

#### Full Workflow (cloneBare + findCommit + checkout) — Average: **4.9× faster**

| Repo        | ziggit (μs) | git CLI (μs) | Speedup |
|-------------|-------------|--------------|---------|
| debug       | 1654–1673   | 10766–10872  | **6.4–6.5×** |
| chalk       | 2396–2462   | 11806–11910  | **4.8–4.9×** |
| is          | 3210–3227   | 12327–12685  | **3.8–3.9×** |
| node-semver | 3560–3629   | 16351–16526  | **4.5–4.6×** |

### Projected Impact

- **5 git deps**: −50ms (−11% of total cold install)
- **20 git deps**: −204ms (−34% of total cold install)
- **50 git deps**: −510ms (−56% of total cold install)

---

## Previous Sessions

### Session 17 (2026-03-27T04:01Z)

| Scenario    | Run 1 | Run 2 | Run 3 | Avg    |
|-------------|------:|------:|------:|-------:|
| Cold cache  | 605ms | 395ms | 286ms | **429ms** |
| Warm cache  | 24ms  | 23ms  | 22ms  | **23ms**  |

findCommit: 6.9× faster | cloneBare: 3.5× faster | Full: 4.9× faster
