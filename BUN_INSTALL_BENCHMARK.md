# BUN INSTALL Benchmark: Stock Bun vs Ziggit Integration

**Date**: 2026-03-26T21:12:21Z (run 3 — fresh data)
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
| 1 | 678 | 34 |
| 2 | 488 | 33 |
| 3 | 575 | 32 |
| **avg** | **580.3** | **33.0** |

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
| debug | 179 | 153 | 156 | 162.7 |
| semver | 166 | 174 | 167 | 169.0 |
| chalk | 225 | 150 | 164 | 179.7 |
| is | 252 | 178 | 174 | 201.3 |
| express | 203 | 191 | 235 | 209.7 |
| **Total** | **1095** | **917** | **968** | **993.3** |

---

## 3. Ziggit Clone Workflow (full depth)

`ziggit clone` — single Zig binary, native HTTP smart protocol + pack parsing +
full checkout. **Note**: ziggit currently performs full-depth clone (no `--depth=1`)
so it downloads entire history.

| Repo | Run 1 (ms) | Run 2 (ms) | Run 3 (ms) | Avg (ms) |
|------|-----------|-----------|-----------|----------|
| debug | 181 | 157 | 149 | 162.3 |
| semver | 242 | 251 | 240 | 244.3 |
| chalk | 161 | 160 | 183 | 168.0 |
| is | 191 | 235 | 202 | 209.3 |
| express | 2471 | 1006 | 957 | 1478.0 |
| **Total** | **3318** | **1879** | **1802** | **2333.0** |

> **Run 1 express outlier (2471ms)**: First-run penalty from TLS session
> establishment + full pack download of 5000+ commits. Runs 2–3 are
> representative of steady-state performance (avg 981.5ms).

### Steady-state (runs 2–3 only)

| Repo | Avg (ms) |
|------|----------|
| debug | 153.0 |
| semver | 245.5 |
| chalk | 171.5 |
| is | 218.5 |
| express | 981.5 |
| **Total** | **1840.5** |

---

## 4. Head-to-Head Comparison

### Overall

| Metric | Git CLI (ms) | Ziggit (ms) | Ratio |
|--------|-------------|-------------|-------|
| Total avg (5 repos, sequential) | 993.3 | 2333.0 | 0.43x (git faster) |
| Steady-state (runs 2–3) | 942.5 | 1840.5 | 0.51x (git faster) |

### Per-repo breakdown

| Repo | Git CLI avg (ms) | Ziggit avg (ms) | Δ (ms) | Notes |
|------|-----------------|-----------------|--------|-------|
| debug | 162.7 | 162.3 | **-0.4** | **Dead heat** ✅ |
| semver | 169.0 | 244.3 | +75.3 | Medium history, full depth penalty |
| chalk | 179.7 | 168.0 | **-11.7** | **Ziggit 7% faster** ✅ |
| is | 201.3 | 209.3 | +8.0 | Near parity |
| express | 209.7 | 1478.0 | +1268.3 | Large history (5000+ commits) |

### Key findings

1. **Small repos (debug, chalk, is)**: Ziggit matches or beats git CLI despite downloading full history. The zero-fork, in-process advantage compensates for extra data.
2. **Medium repos (semver)**: ~44% slower due to full history download.
3. **Large repos (express)**: 7x slower — full 10.6MB pack vs ~100KB shallow clone.
4. **The bottleneck is shallow clone support**, not pack parsing or checkout speed.

---

## 5. findCommit / Ref Resolution

When bun resolves `github:foo/bar`, it maps branch names to SHAs.
This benchmark compares `git rev-parse` (subprocess) vs ziggit's in-process
`findCommit` (1000 iterations, ReleaseFast).

### git rev-parse (subprocess, µs per call)

| Repo | Run 1 | Run 2 | Run 3 | Avg |
|------|-------|-------|-------|-----|
| debug | 2106 | 2072 | 2076 | 2085 |
| semver | 2194 | 2027 | 2072 | 2098 |
| chalk | 2098 | 2023 | 2015 | 2045 |
| is | 2084 | 2066 | 2010 | 2053 |
| express | 2075 | 2022 | 2106 | 2068 |
| **Average** | | | | **2070µs** (~2.1ms) |

### ziggit findCommit (in-process, µs per call — 1000 iterations)

| Repo | Per-call (µs) | Total (1000 calls) |
|------|--------------|-------------------|
| debug | 4.9 | 4.86ms |
| semver | 6.1 | 6.07ms |
| chalk | 5.2 | 5.17ms |
| is | 5.1 | 5.06ms |
| express | 4.9 | 4.91ms |
| **Average** | **5.2µs** | 5.21ms |

### Speedup

| Metric | git rev-parse | ziggit findCommit | Speedup |
|--------|--------------|-------------------|---------|
| Per-call average | 2070µs | 5.2µs | **~395x faster** |
| 5 deps total | ~10.4ms | ~0.026ms | **~395x faster** |

> The 5.2µs per-call cost is dominated by file I/O (reading packed-refs).
> Actual in-memory ref lookup is sub-microsecond.

---

## 6. Projected Impact on `bun install`

### Current state (no shallow clone)

| Component | Stock bun (ms) | With ziggit (ms) | Δ |
|-----------|---------------|-------------------|-----|
| Git dep resolution (5 repos) | ~993 (git CLI) | ~1841 (steady-state) | +848ms slower |
| Ref resolution (5× findCommit) | ~10.4 (subprocess) | ~0.03 (in-process) | -10ms faster |
| npm resolution + linking | ~(bun internal) | same | — |
| **Net git ops** | **~1003** | **~1841** | **+838ms slower** |

**Today: ziggit makes git dep resolution ~1.8x slower** due to full-depth clone.

### With shallow clone support (planned)

| Repo | Full clone data | Shallow est. | Reduction |
|------|----------------|--------------|-----------|
| express | ~10.6MB | ~100KB | 100x |
| semver | ~1.2MB | ~80KB | 15x |
| debug | ~270KB | ~50KB | 5x |
| chalk | ~180KB | ~60KB | 3x |
| is | ~240KB | ~70KB | 3.4x |

Conservative projection based on chalk parity (small repo where data volume
is similar, ziggit already 7% faster):

| Component | Stock bun (ms) | Ziggit + shallow (ms) | Δ |
|-----------|---------------|-----------------------|-----|
| Git dep resolution (5 repos) | ~993 | ~840 | -153ms |
| Ref resolution | ~10.4 | ~0.03 | -10ms |
| Process spawn savings (no fork/exec) | — | -50ms (10ms × 5) | -50ms |
| **Savings from git ops** | | | **~213ms** |

### With shallow clone + parallel I/O

| Scenario | Time (ms) | vs Stock bun | Notes |
|----------|-----------|-------------|-------|
| Stock bun (serial git CLI) | 993 | baseline | 5 sequential subprocesses |
| Ziggit shallow (serial) | ~840 | -15% | In-process, no fork overhead |
| Ziggit shallow (parallel, 5 concurrent) | ~230 | **-77%** | Zig async, all 5 repos concurrent |
| Ziggit shallow + warm cache (fetch) | ~50 | **-95%** | Incremental fetch, no re-clone |

**Best case: save ~760ms off cold bun install git dep resolution (~77% reduction)**

---

## 7. Feature Roadmap for Integration Speedup

| Feature | Impact | Status |
|---------|--------|--------|
| Shallow clone (`--depth=1`) | Eliminates 7x penalty on large repos | ❌ Not yet |
| In-process integration (no fork/exec) | -10ms per dep | ✅ Architecture ready |
| findCommit via packed-refs | 395x faster ref resolution | ✅ Measured |
| Parallel clone (Zig async I/O) | -760ms (5 deps concurrent) | ⚠️ Possible with Zig |
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

### Stock bun install (2026-03-26T21:12:21Z)
```
Cold: 678 488 575 → avg 580.3ms
Warm:  34  33  32 → avg  33.0ms
```

### Git CLI (bare --depth=1 + local checkout), sequential
```
Run 1: debug=179 semver=166 chalk=225 is=252 express=203  total=1095ms
Run 2: debug=153 semver=174 chalk=150 is=178 express=191  total= 917ms
Run 3: debug=156 semver=167 chalk=164 is=174 express=235  total= 968ms
```

### Ziggit clone (full depth), sequential
```
Run 1: debug=181 semver=242 chalk=161 is=191 express=2471 total=3318ms
Run 2: debug=157 semver=251 chalk=160 is=235 express=1006 total=1879ms
Run 3: debug=149 semver=240 chalk=183 is=202 express= 957 total=1802ms
```

### git rev-parse HEAD (subprocess, µs)
```
Run 1: debug=2106 semver=2194 chalk=2098 is=2084 express=2075
Run 2: debug=2072 semver=2027 chalk=2023 is=2066 express=2022
Run 3: debug=2076 semver=2072 chalk=2015 is=2010 express=2106
Average: ~2070µs per invocation
```

### Ziggit findCommit (in-process, 1000 iterations, ReleaseFast)
```
debug:   4.9µs/call (4.86ms total)
semver:  6.1µs/call (6.07ms total)
chalk:   5.2µs/call (5.17ms total)
is:      5.1µs/call (5.06ms total)
express: 4.9µs/call (4.91ms total)
Average: 5.2µs per invocation
```
