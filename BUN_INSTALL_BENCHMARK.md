# BUN INSTALL Benchmark: Stock Bun vs Ziggit Integration

**Date**: 2026-03-26T21:15:56Z (run 4 — fresh data)
**System**: x86_64, 483MB RAM, 1 vCPU, Debian (minimal VM)
**Bun version**: 1.3.11
**Git version**: 2.43.0
**Zig version**: 0.13.0
**Ziggit commit**: b6494b8 (two-pass zero-alloc scan + bounded LRU resolve)
**Ziggit build**: ReleaseFast
**Runs per test**: 3

## Test Repos (git dependencies)

| Repo | URL |
|------|-----|
| debug | github:debug-js/debug |
| node-semver | github:npm/node-semver |
| chalk | github:chalk/chalk |
| @sindresorhus/is | github:sindresorhus/is |
| express | github:expressjs/express |

---

## 1. Stock `bun install` (full end-to-end)

| Run | Cold (ms) | Warm (ms) |
|-----|-----------|-----------|
| 1 | 584 | 32 |
| 2 | 618 | 31 |
| 3 | 499 | 32 |
| **avg** | **567.0** | **31.7** |

> **Note**: `bun install` resolves 266 packages total (5 git deps + transitive
> npm deps), generates lockfile, links node_modules, and runs lifecycle scripts.
> Cold runs clear `~/.bun/install/cache`, `bun.lock`, and `node_modules`.
> Warm runs keep lockfile and cache, only delete `node_modules`.

---

## 2. Git CLI Clone Workflow (per-repo)

Simulates bun's internal git dep resolution: `git clone --bare --depth=1` +
`git clone` (local checkout from bare). Sequential, caches cleared between runs.

| Repo | Run 1 (ms) | Run 2 (ms) | Run 3 (ms) | Avg (ms) |
|------|-----------|-----------|-----------|----------|
| debug | 168 | 136 | 141 | 148.3 |
| semver | 191 | 157 | 151 | 166.3 |
| chalk | 175 | 175 | 148 | 166.0 |
| is | 193 | 167 | 161 | 173.7 |
| express | 273 | 249 | 265 | 262.3 |
| **Total** | **1000** | **884** | **866** | **916.7** |

---

## 3. Ziggit Clone Workflow (full depth)

`ziggit clone` — single Zig binary, native HTTP smart protocol + pack parsing +
full checkout. **Note**: ziggit currently performs full-depth clone (no `--depth=1`)
so it downloads entire history.

| Repo | Run 1 (ms) | Run 2 (ms) | Run 3 (ms) | Avg (ms) |
|------|-----------|-----------|-----------|----------|
| debug | 178 | 180 | 185 | 181.0 |
| semver | 263 | 249 | 261 | 257.7 |
| chalk | 157 | 160 | 209 | 175.3 |
| is | 188 | 195 | 207 | 196.7 |
| express | 1013 | 1044 | 1002 | 1019.7 |
| **Total** | **1799** | **1828** | **1864** | **1830.3** |

---

## 4. Head-to-Head Comparison

### Overall

| Metric | Git CLI (ms) | Ziggit (ms) | Ratio |
|--------|-------------|-------------|-------|
| Total avg (5 repos, sequential) | 916.7 | 1830.3 | 2.00x (git faster) |

### Per-repo breakdown

| Repo | Git CLI avg (ms) | Ziggit avg (ms) | Δ (ms) | Ratio | Notes |
|------|-----------------|-----------------|--------|-------|-------|
| debug | 148.3 | 181.0 | +32.7 | 1.22x | Small repo, full-depth penalty |
| semver | 166.3 | 257.7 | +91.3 | 1.55x | Medium history |
| chalk | 166.0 | 175.3 | +9.3 | **1.06x** | **Near parity** ✅ |
| is | 173.7 | 196.7 | +23.0 | 1.13x | Small repo |
| express | 262.3 | 1019.7 | +757.3 | 3.89x | Large history (5000+ commits) |

### Key findings

1. **chalk**: Ziggit within 6% of git CLI despite downloading full history — the in-process, zero-fork advantage nearly compensates for extra data.
2. **is**: Only 13% slower — close to parity for small repos.
3. **express**: 3.9x slower — full 10.6MB pack download vs ~100KB shallow clone.
4. **The bottleneck is shallow clone support**, not pack parsing or checkout speed.

---

## 5. findCommit / Ref Resolution

When bun resolves `github:foo/bar`, it maps branch names to SHAs.
This benchmark compares `git rev-parse` (subprocess) vs ziggit's in-process
`findCommit` (1000 iterations, ReleaseFast).

### git rev-parse (subprocess, µs per call)

| Repo | Run 1 | Run 2 | Run 3 | Avg |
|------|-------|-------|-------|-----|
| debug | 2278 | 2173 | 2193 | 2215 |
| semver | 2073 | 2028 | 2179 | 2093 |
| chalk | 2107 | 2078 | 2046 | 2077 |
| is | 2207 | 2159 | 2054 | 2140 |
| express | 2174 | 2123 | 2064 | 2120 |
| **Average** | | | | **2129µs** (~2.1ms) |

### ziggit findCommit (in-process, µs per call — 1000 iterations)

| Repo | Per-call (µs) | Total (1000 calls) |
|------|--------------|-------------------|
| debug | 5.0 | 5.02ms |
| semver | 5.1 | 5.09ms |
| chalk | 5.1 | 5.12ms |
| is | 5.1 | 5.06ms |
| express | 5.6 | 5.56ms |
| **Average** | **5.2µs** | 5.17ms |

### Speedup

| Metric | git rev-parse | ziggit findCommit | Speedup |
|--------|--------------|-------------------|---------|
| Per-call average | 2129µs | 5.2µs | **~412x faster** |
| 5 deps total | ~10.6ms | ~0.026ms | **~412x faster** |

> The 5.2µs per-call cost is dominated by file I/O (reading packed-refs).
> Actual in-memory ref lookup is sub-microsecond.

---

## 6. Projected Impact on `bun install`

### Current state (no shallow clone)

| Component | Stock bun (ms) | With ziggit (ms) | Δ |
|-----------|---------------|-------------------|-----|
| Git dep resolution (5 repos) | ~917 (git CLI) | ~1830 (in-process) | +913ms slower |
| Ref resolution (5× findCommit) | ~10.6 (subprocess) | ~0.03 (in-process) | -10.6ms faster |
| npm resolution + linking | ~(bun internal) | same | — |
| **Net git ops** | **~928** | **~1830** | **+902ms slower** |

**Today: ziggit makes git dep resolution ~2.0x slower** due to full-depth clone.

### With shallow clone support (planned)

| Repo | Full clone data | Shallow est. | Reduction |
|------|----------------|--------------|-----------|
| express | ~10.6MB | ~100KB | 100x |
| semver | ~1.2MB | ~80KB | 15x |
| debug | ~270KB | ~50KB | 5x |
| chalk | ~180KB | ~60KB | 3x |
| is | ~240KB | ~70KB | 3.4x |

Conservative projection (based on chalk/is parity where data volume is similar):

| Component | Stock bun (ms) | Ziggit + shallow (ms) | Δ |
|-----------|---------------|-----------------------|-----|
| Git dep resolution (5 repos) | ~917 | ~780 | -137ms |
| Ref resolution | ~10.6 | ~0.03 | -10.6ms |
| Process spawn savings (no fork/exec) | — | -50ms (10ms × 5) | -50ms |
| **Savings from git ops** | | | **~198ms** |

### With shallow clone + parallel I/O

| Scenario | Time (ms) | vs Stock bun | Notes |
|----------|-----------|-------------|-------|
| Stock bun (serial git CLI) | 917 | baseline | 5 sequential subprocesses |
| Ziggit shallow (serial) | ~780 | -15% | In-process, no fork overhead |
| Ziggit shallow (parallel, 5 concurrent) | ~280 | **-69%** | Zig async, all 5 repos concurrent |
| Ziggit shallow + warm cache (fetch) | ~50 | **-95%** | Incremental fetch, no re-clone |

**Best case: save ~637ms off cold bun install git dep resolution (~69% reduction)**

---

## 7. Feature Roadmap for Integration Speedup

| Feature | Impact | Status |
|---------|--------|--------|
| Shallow clone (`--depth=1`) | Eliminates 3.9x penalty on large repos | ❌ Not yet |
| In-process integration (no fork/exec) | -10ms per dep | ✅ Architecture ready |
| findCommit via packed-refs | 412x faster ref resolution | ✅ Measured |
| Parallel clone (Zig async I/O) | ~69% reduction (5 deps concurrent) | ⚠️ Possible with Zig |
| Incremental fetch (bare cache reuse) | Skip re-clone on warm install | ❌ Not yet |

---

## 8. Build Notes

### Bun fork build status

Full bun fork binary **cannot be built on this VM**:

| Resource | Required | Available |
|----------|----------|-----------|
| RAM | ~8 GB | 483 MB |
| Disk | ~15 GB | 2.9 GB free |
| Dependencies | CMake, Clang 17+, LLVM, ICU | Not installed |

### How the integration works (in the fork)

```
# build.zig.zon dependency
.ziggit = .{ .path = "../ziggit" }

# bun install flow:
#   1. Parse package.json git deps  → same as stock bun
#   2. For each git dep:
#      stock:  spawn `git clone --bare` subprocess → parse → checkout
#      fork:   call ziggit.clone() in-process → zero-copy pack parse → checkout
#   3. findCommit resolves ref → SHA in 5.2µs (vs 2.1ms subprocess)
#   4. Continue with npm resolution → same as stock bun
```

To build the fork on a proper machine:
```bash
cd /root/ziggit && zig build -Doptimize=ReleaseFast
cd /root/bun-fork && zig build -Doptimize=ReleaseFast
```

### Benchmark reproduction

```bash
cd /root/ziggit && zig build -Doptimize=ReleaseFast
cd /root/bun-fork/benchmark && zig build -Doptimize=ReleaseFast
bash /root/bun-fork/benchmark/bun_install_bench.sh
```

---

## 9. Raw Data

### Stock bun install (2026-03-26T21:15:56Z)
```
Cold: 584 618 499 → avg 567.0ms
Warm:  32  31  32 → avg  31.7ms
```

### Git CLI (bare --depth=1 + local checkout), sequential
```
Run 1: debug=168 semver=191 chalk=175 is=193 express=273  total=1000ms
Run 2: debug=136 semver=157 chalk=175 is=167 express=249  total= 884ms
Run 3: debug=141 semver=151 chalk=148 is=161 express=265  total= 866ms
Avg:   debug=148 semver=166 chalk=166 is=174 express=262  total= 917ms
```

### Ziggit clone (full depth), sequential
```
Run 1: debug=178 semver=263 chalk=157 is=188 express=1013 total=1799ms
Run 2: debug=180 semver=249 chalk=160 is=195 express=1044 total=1828ms
Run 3: debug=185 semver=261 chalk=209 is=207 express=1002 total=1864ms
Avg:   debug=181 semver=258 chalk=175 is=197 express=1020 total=1830ms
```

### git rev-parse HEAD (subprocess, µs)
```
Run 1: debug=2278 semver=2073 chalk=2107 is=2207 express=2174
Run 2: debug=2173 semver=2028 chalk=2078 is=2159 express=2123
Run 3: debug=2193 semver=2179 chalk=2046 is=2054 express=2064
Average: ~2129µs per invocation
```

### Ziggit findCommit (in-process, 1000 iterations, ReleaseFast)
```
debug:   5.0µs/call (5.02ms total)
semver:  5.1µs/call (5.09ms total)
chalk:   5.1µs/call (5.12ms total)
is:      5.1µs/call (5.06ms total)
express: 5.6µs/call (5.56ms total)
Average: 5.2µs per invocation
```
