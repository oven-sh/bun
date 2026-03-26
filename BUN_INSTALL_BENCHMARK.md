# BUN INSTALL Benchmark: Stock Bun vs Ziggit Integration

**Date**: 2026-03-26 (run 2 — fresh data)
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
| 1 | 873 | 33 |
| 2 | 508 | 32 |
| 3 | 579 | 30 |
| **avg** | **653.3** | **31.7** |

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
| debug | 169 | 160 | 136 | 155.0 |
| semver | 186 | 173 | 157 | 172.0 |
| chalk | 184 | 146 | 188 | 172.7 |
| is | 189 | 155 | 168 | 170.7 |
| express | 216 | 219 | 203 | 212.7 |
| **Total** | **1016** | **922** | **921** | **953.0** |

---

## 3. Ziggit Clone Workflow (per-repo)

`ziggit clone` — single Zig binary, native HTTP smart protocol + pack parsing +
full checkout. **Note**: ziggit currently performs full-depth clone (no `--depth=1`)
so it downloads entire history.

| Repo | Run 1 (ms) | Run 2 (ms) | Run 3 (ms) | Avg (ms) |
|------|-----------|-----------|-----------|----------|
| debug | 172 | 163 | 160 | 165.0 |
| semver | 257 | 223 | 246 | 242.0 |
| chalk | 168 | 155 | 166 | 163.0 |
| is | 188 | 192 | 205 | 195.0 |
| express | 998 | 971 | 966 | 978.3 |
| **Total** | **1854** | **1773** | **1811** | **1812.7** |

---

## 4. Head-to-Head Comparison

### Overall

| Metric | Git CLI (ms) | Ziggit (ms) | Ratio |
|--------|-------------|-------------|-------|
| Total avg (5 repos, sequential) | 953.0 | 1812.7 | 0.53x (git faster) |
| Total min | 921 | 1773 | 0.52x (git faster) |

### Per-repo breakdown

| Repo | Git CLI avg (ms) | Ziggit avg (ms) | Δ (ms) | Ratio | Notes |
|------|-----------------|-----------------|--------|-------|-------|
| debug | 155.0 | 165.0 | +10.0 | 0.94x | Small repo — **near parity** ✅ |
| semver | 172.0 | 242.0 | +70.0 | 0.71x | Medium history |
| chalk | 172.7 | 163.0 | **-9.7** | **1.06x** | **Ziggit faster** ✅ |
| is | 170.7 | 195.0 | +24.3 | 0.88x | Small repo |
| express | 212.7 | 978.3 | +765.7 | 0.22x | Large history (5000+ commits) |

### Why ziggit is slower overall (for now)

The dominant factor is **shallow clone support**:

1. **Git CLI uses `--depth=1`**: Downloads only the latest commit + tree. For
   express, this means ~100KB instead of ~10.6MB.
2. **Ziggit downloads full history**: No shallow clone support yet, so every
   object in the repo is transferred and parsed.
3. **express is 4.6x slower** because it has 5000+ commits of pack data.
4. **chalk is actually faster** with ziggit (1.06x) — short history where full
   clone ≈ shallow clone in data volume, and ziggit's zero-fork advantage wins.

---

## 5. findCommit / Ref Resolution (NEW: in-process benchmark)

When bun resolves `github:foo/bar`, it needs to map branch names to SHAs.
This benchmark compares git rev-parse (subprocess) vs ziggit's in-process
findCommit using a dedicated Zig benchmark binary (1000 iterations, ReleaseFast).

### git rev-parse (subprocess, µs)

| Repo | Run 1 | Run 2 | Run 3 | Avg |
|------|-------|-------|-------|-----|
| debug | 5563 | — | — | ~5563µs |
| semver | 2215 | — | — | ~2215µs |
| chalk | 2198 | — | — | ~2198µs |
| is | 2262 | — | — | ~2262µs |
| express | 2232 | — | — | ~2232µs |
| **Average** | | | | **~2894µs** (~2.9ms) |

### ziggit findCommit (in-process, µs per call — 1000 iterations)

| Repo | Per-call | Total (1000 calls) |
|------|----------|-------------------|
| debug | **5.7µs** | 5.66ms |
| semver | **5.6µs** | 5.57ms |
| chalk | **5.4µs** | 5.44ms |
| is | **5.3µs** | 5.33ms |
| express | **5.1µs** | 5.12ms |
| **Average** | **5.4µs** | 5.42ms |

### Speedup

| Metric | git rev-parse | ziggit findCommit | Speedup |
|--------|--------------|-------------------|---------|
| Per-call average | 2894µs | 5.4µs | **~536x faster** |
| 5 deps total | ~14.5ms | ~0.027ms | **~536x faster** |

> The 5.4µs per-call is dominated by file I/O (reading packed-refs). The
> actual ref resolution in memory is sub-microsecond.

---

## 6. Projected Impact on `bun install`

### Current state (no shallow clone)

| Component | Stock bun (ms) | With ziggit (ms) | Δ |
|-----------|---------------|-------------------|-----|
| Git dep resolution (5 repos) | ~953 (git CLI) | ~1813 (ziggit, full depth) | +860ms slower |
| Ref resolution (5× findCommit) | ~14.5 (5× subprocess) | ~0.03 (5× in-process) | -14ms faster |
| npm resolution + linking | ~(bun internal) | same | — |
| **Net git ops** | **~968** | **~1813** | **+845ms slower** |

**Today: ziggit would make git dep resolution ~1.9x slower** due to missing shallow clone.

### With shallow clone support (planned)

If ziggit supported `--depth=1`, download sizes would match git CLI:

| Repo | Full clone (bytes) | Shallow (est.) | Data reduction |
|------|-------------------|----------------|----------------|
| express | ~10.6MB | ~100KB | ~100x less |
| semver | ~1.2MB | ~80KB | ~15x less |
| debug | ~270KB | ~50KB | ~5x less |
| chalk | ~180KB | ~60KB | ~3x less |
| is | ~240KB | ~70KB | ~3.4x less |

**Projected times with shallow clone** (conservative estimate based on chalk parity):

| Component | Stock bun (ms) | With ziggit + shallow (ms) | Δ |
|-----------|---------------|---------------------------|-----|
| Git dep resolution (5 repos) | ~953 | ~830 (matching data vol, less fork overhead) | -123ms |
| Ref resolution (5× findCommit) | ~14.5 | ~0.03 | -14ms |
| Process spawn savings (no fork/exec) | — | -50ms (10ms × 5 deps avoided) | -50ms |
| **Savings from git ops** | | | **~187ms** |

### With shallow clone + parallel I/O

| Scenario | Time (ms) | vs Stock bun | Notes |
|----------|-----------|-------------|-------|
| Stock bun (serial git CLI) | 953 | baseline | 5 sequential subprocesses |
| Ziggit shallow (serial) | ~830 | -13% | In-process, no fork overhead |
| Ziggit shallow (parallel, 5 concurrent) | ~220 | **-77%** | Zig async, all 5 repos concurrent |
| Ziggit shallow + warm cache (fetch) | ~50 | **-95%** | Incremental fetch, no re-clone |

**Best case: save ~730ms off cold bun install git dep resolution (~77% reduction)**

### Feature roadmap for bun integration speedup

| Feature | Impact | Status |
|---------|--------|--------|
| Shallow clone (`--depth=1`) | Eliminates 4.6x penalty on large repos | ❌ Not yet |
| In-process integration (no fork/exec) | -10ms per dep, -50ms for 5 deps | ✅ Architecture ready |
| findCommit via packed-refs | 536x faster ref resolution (5.4µs vs 2.9ms) | ✅ Measured |
| Parallel clone (Zig async I/O) | -730ms (5 deps concurrent) | ⚠️ Possible with Zig |
| Incremental fetch (bare cache reuse) | Skip re-clone on warm install | ❌ Not yet |

---

## 7. Build Notes

### Bun fork build status

The full bun fork binary **cannot be built on this VM** due to resource constraints:

| Resource | Required | Available |
|----------|----------|-----------|
| RAM | ~8 GB | 483 MB |
| Disk | ~15 GB | 2.9 GB free |
| Dependencies | CMake, Clang 17+, LLVM, ICU, etc. | Not installed |

### How the integration works (in the fork)

```
# build.zig.zon
.ziggit = .{ .path = "../ziggit" }

# bun install flow:
#   1. Parse package.json git deps  → same as stock bun
#   2. For each git dep:
#      stock:  spawn `git clone --bare` subprocess → parse pack → checkout
#      fork:   call ziggit.clone() in-process → zero-copy pack parse → checkout
#   3. findCommit resolves ref → SHA in 5.4µs (vs 2.9ms subprocess)
#   4. Continue with npm resolution → same as stock bun
```

To build the fork on a proper machine:
```bash
cd /root/ziggit && zig build -Doptimize=ReleaseFast
cd /root/bun-fork && zig build -Doptimize=ReleaseFast
# or: cmake -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build
```

### Benchmark reproduction

```bash
# Build ziggit + findCommit benchmark
cd /root/ziggit && zig build -Doptimize=ReleaseFast
cd /root/bun-fork/benchmark && zig build -Doptimize=ReleaseFast

# Run full benchmark suite
bash /root/bun-fork/benchmark/bun_install_bench.sh
```

---

## 8. Raw Benchmark Data

### Stock bun install (2026-03-26, run 2)
```
Cold run 1: 873ms — Resolved, downloaded and extracted [266]
Cold run 2: 508ms — Resolved, downloaded and extracted [266]
Cold run 3: 579ms — Resolved, downloaded and extracted [266]
Warm run 1:  33ms — (lockfile cached)
Warm run 2:  32ms
Warm run 3:  30ms
```

### Git CLI (bare --depth=1 + local checkout), sequential
```
Run 1: debug=169 semver=186 chalk=184 is=189 express=216  total=1016ms
Run 2: debug=160 semver=173 chalk=146 is=155 express=219  total=922ms
Run 3: debug=136 semver=157 chalk=188 is=168 express=203  total=921ms
```

### Ziggit clone (full depth), sequential
```
Run 1: debug=172 semver=257 chalk=168 is=188 express=998  total=1854ms
Run 2: debug=163 semver=223 chalk=155 is=192 express=971  total=1773ms
Run 3: debug=160 semver=246 chalk=166 is=205 express=966  total=1811ms
```

### git rev-parse HEAD (subprocess, nanosecond precision)
```
debug=5563µs  semver=2215µs  chalk=2198µs  is=2262µs  express=2232µs
Average: ~2894µs per invocation (dominated by process startup)
```

### Ziggit findCommit (in-process, 1000 iterations, ReleaseFast)
```
debug:   5.7µs/call (5.66ms total)
semver:  5.6µs/call (5.57ms total)
chalk:   5.4µs/call (5.44ms total)
is:      5.3µs/call (5.33ms total)
express: 5.1µs/call (5.12ms total)
Average: 5.4µs per invocation (direct packed-refs file scan)
```
