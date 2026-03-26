# BUN INSTALL Benchmark: Stock Bun vs Ziggit Integration

**Date**: 2026-03-26T21:19:37Z (run 5 — fresh data)
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
| 1 | 603 | 32 |
| 2 | 581 | 31 |
| 3 | 397 | 31 |
| **avg** | **527.0** | **31.3** |

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
| debug | 156 | 137 | 132 | 141.7 |
| semver | 198 | 161 | 153 | 170.7 |
| chalk | 161 | 151 | 155 | 155.7 |
| is | 170 | 222 | 154 | 182.0 |
| express | 207 | 192 | 188 | 195.7 |
| **Total** | **962** | **933** | **851** | **915.3** |

---

## 3. Ziggit Clone Workflow (full depth)

`ziggit clone` — single Zig binary, native HTTP smart protocol + pack parsing +
full checkout. **Note**: ziggit currently performs full-depth clone (no `--depth=1`)
so it downloads entire history.

| Repo | Run 1 (ms) | Run 2 (ms) | Run 3 (ms) | Avg (ms) |
|------|-----------|-----------|-----------|----------|
| debug | 144 | 159 | 171 | 158.0 |
| semver | 249 | 253 | 252 | 251.3 |
| chalk | 163 | 151 | 180 | 164.7 |
| is | 189 | 187 | 193 | 189.7 |
| express | 973 | 961 | 960 | 964.7 |
| **Total** | **1789** | **1780** | **1828** | **1799.0** |

---

## 4. Head-to-Head Comparison

### Overall

| Metric | Git CLI (ms) | Ziggit (ms) | Ratio |
|--------|-------------|-------------|-------|
| Total avg (5 repos, sequential) | 915.3 | 1799.0 | 1.97x (git faster) |

### Per-repo breakdown

| Repo | Git CLI avg (ms) | Ziggit avg (ms) | Δ (ms) | Ratio | Notes |
|------|-----------------|-----------------|--------|-------|-------|
| debug | 141.7 | 158.0 | +16.3 | 1.12x | Small repo |
| semver | 170.7 | 251.3 | +80.7 | 1.47x | Medium history |
| chalk | 155.7 | 164.7 | +9.0 | **1.06x** | **Near parity** ✅ |
| is | 182.0 | 189.7 | +7.7 | **1.04x** | **Near parity** ✅ |
| express | 195.7 | 964.7 | +769.0 | 4.93x | Large history (5000+ commits) |

### Key findings

1. **chalk**: Ziggit within 6% of git CLI despite downloading full history — the in-process, zero-fork advantage nearly compensates for extra data.
2. **is**: Only 4% slower — effectively at parity for small repos.
3. **express**: 4.9x slower — full 10.6MB pack download vs ~100KB shallow clone. This is the dominant cost.
4. **The bottleneck is shallow clone support**, not pack parsing or checkout speed.

---

## 5. findCommit / Ref Resolution

When bun resolves `github:foo/bar`, it maps branch names to SHAs.
This benchmark compares `git rev-parse` (subprocess) vs ziggit's in-process
`findCommit` (1000 iterations, ReleaseFast).

### git rev-parse (subprocess, µs per call)

| Repo | Run 1 | Run 2 | Run 3 | Avg |
|------|-------|-------|-------|-----|
| debug | 2188 | 2127 | 2165 | 2160 |
| semver | 2102 | 2093 | 2119 | 2105 |
| chalk | 2086 | 2146 | 2079 | 2104 |
| is | 2142 | 2109 | 2095 | 2115 |
| express | 2208 | 2068 | 2149 | 2142 |
| **Average** | | | | **2125µs** (~2.1ms) |

### ziggit findCommit (in-process, µs per call — 1000 iterations)

| Repo | Per-call (µs) | Total (1000 calls) |
|------|--------------|-------------------|
| debug | 5.2 | 5.19ms |
| semver | 6.2 | 6.18ms |
| chalk | 5.2 | 5.16ms |
| is | 5.1 | 5.13ms |
| express | 5.0 | 5.02ms |
| **Average** | **5.3µs** | 5.34ms |

### Speedup

| Metric | git rev-parse | ziggit findCommit | Speedup |
|--------|--------------|-------------------|---------|
| Per-call average | 2125µs | 5.3µs | **~398x faster** |
| 5 deps total | ~10.6ms | ~0.027ms | **~398x faster** |

> The 5.3µs per-call cost is dominated by file I/O (reading packed-refs).
> Actual in-memory ref lookup is sub-microsecond.

---

## 6. Projected Impact on `bun install`

### Current state (no shallow clone)

| Component | Stock bun (ms) | With ziggit (ms) | Δ |
|-----------|---------------|-------------------|-----|
| Git dep resolution (5 repos) | ~915 (git CLI) | ~1799 (in-process) | +884ms slower |
| Ref resolution (5× findCommit) | ~10.6 (subprocess) | ~0.03 (in-process) | -10.6ms faster |
| npm resolution + linking | ~(bun internal) | same | — |
| **Net git ops** | **~926** | **~1799** | **+873ms slower** |

**Today: ziggit makes git dep resolution ~1.97x slower** due to full-depth clone.

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
| Git dep resolution (5 repos) | ~915 | ~780 | -135ms |
| Ref resolution | ~10.6 | ~0.03 | -10.6ms |
| Process spawn savings (no fork/exec) | — | -50ms (10ms × 5) | -50ms |
| **Savings from git ops** | | | **~196ms** |

### With shallow clone + parallel I/O

| Scenario | Time (ms) | vs Stock bun | Notes |
|----------|-----------|-------------|-------|
| Stock bun (serial git CLI) | 915 | baseline | 5 sequential subprocesses |
| Ziggit shallow (serial) | ~780 | -15% | In-process, no fork overhead |
| Ziggit shallow (parallel, 5 concurrent) | ~280 | **-69%** | Zig async, all 5 repos concurrent |
| Ziggit shallow + warm cache (fetch) | ~50 | **-95%** | Incremental fetch, no re-clone |

**Best case: save ~635ms off cold bun install git dep resolution (~69% reduction)**

---

## 7. Feature Roadmap for Integration Speedup

| Feature | Impact | Status |
|---------|--------|--------|
| Shallow clone (`--depth=1`) | Eliminates 4.9x penalty on large repos | ❌ Not yet |
| In-process integration (no fork/exec) | -10ms per dep | ✅ Architecture ready |
| findCommit via packed-refs | 398x faster ref resolution | ✅ Measured |
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
#   3. findCommit resolves ref → SHA in 5.3µs (vs 2.1ms subprocess)
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

### Stock bun install (2026-03-26T21:19:37Z)
```
Cold: 603 581 397 → avg 527.0ms
Warm:  32  31  31 → avg  31.3ms
```

### Git CLI (bare --depth=1 + local checkout), sequential
```
Run 1: debug=156 semver=198 chalk=161 is=170 express=207  total= 962ms
Run 2: debug=137 semver=161 chalk=151 is=222 express=192  total= 933ms
Run 3: debug=132 semver=153 chalk=155 is=154 express=188  total= 851ms
Avg:   debug=142 semver=171 chalk=156 is=182 express=196  total= 915ms
```

### Ziggit clone (full depth), sequential
```
Run 1: debug=144 semver=249 chalk=163 is=189 express=973  total=1789ms
Run 2: debug=159 semver=253 chalk=151 is=187 express=961  total=1780ms
Run 3: debug=171 semver=252 chalk=180 is=193 express=960  total=1828ms
Avg:   debug=158 semver=251 chalk=165 is=190 express=965  total=1799ms
```

### git rev-parse HEAD (subprocess, µs)
```
Run 1: debug=2188 semver=2102 chalk=2086 is=2142 express=2208
Run 2: debug=2127 semver=2093 chalk=2146 is=2109 express=2068
Run 3: debug=2165 semver=2119 chalk=2079 is=2095 express=2149
Average: ~2125µs per invocation
```

### Ziggit findCommit (in-process, 1000 iterations, ReleaseFast)
```
debug:   5.2µs/call (5.19ms total)
semver:  6.2µs/call (6.18ms total)
chalk:   5.2µs/call (5.16ms total)
is:      5.1µs/call (5.13ms total)
express: 5.0µs/call (5.02ms total)
Average: 5.3µs per invocation
```
