# BUN INSTALL Benchmark: Stock Bun vs Ziggit Integration

**Date**: 2026-03-26 (fresh run)
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
| 1 | 1279 | 33 |
| 2 | 1032 | 32 |
| 3 | 802 | 31 |
| **avg** | **1037.7** | **32.0** |

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
| debug | 142 | 132 | 134 | 136.0 |
| node-semver | 186 | 157 | 150 | 164.3 |
| chalk | 168 | 150 | 160 | 159.3 |
| is | 175 | 157 | 159 | 163.7 |
| express | 211 | 205 | 216 | 210.7 |
| **Total** | **951** | **870** | **890** | **903.7** |

---

## 3. Ziggit Clone Workflow (per-repo)

`ziggit clone` — single Zig binary, native HTTP smart protocol + pack parsing +
full checkout. **Note**: ziggit currently performs full-depth clone (no `--depth=1`)
so it downloads entire history.

| Repo | Run 1 (ms) | Run 2 (ms) | Run 3 (ms) | Avg (ms) |
|------|-----------|-----------|-----------|----------|
| debug | 149 | 156 | 183 | 162.7 |
| node-semver | 260 | 232 | 243 | 245.0 |
| chalk | 174 | 154 | 171 | 166.3 |
| is | 184 | 195 | 210 | 196.3 |
| express | 966 | 978 | 976 | 973.3 |
| **Total** | **1804** | **1784** | **1853** | **1813.7** |

---

## 4. Head-to-Head Comparison

### Overall

| Metric | Git CLI (ms) | Ziggit (ms) | Ratio |
|--------|-------------|-------------|-------|
| Total avg (5 repos, sequential) | 903.7 | 1813.7 | 0.50x (git faster) |
| Total min | 870 | 1784 | 0.49x (git faster) |

### Per-repo breakdown

| Repo | Git CLI avg (ms) | Ziggit avg (ms) | Δ (ms) | Ratio | Notes |
|------|-----------------|-----------------|--------|-------|-------|
| debug | 136.0 | 162.7 | +26.7 | 0.84x | Small repo, near parity |
| node-semver | 164.3 | 245.0 | +80.7 | 0.67x | Medium history |
| chalk | 159.3 | 166.3 | +7.0 | 0.96x | **Near parity** ✅ |
| is | 163.7 | 196.3 | +32.7 | 0.83x | Small repo |
| express | 210.7 | 973.3 | +762.7 | 0.22x | Large history (5000+ commits) |

### Why ziggit is slower (for now)

The dominant factor is **shallow clone support**:

1. **Git CLI uses `--depth=1`**: Downloads only the latest commit + tree. For
   express, this means ~100KB instead of ~10.6MB.
2. **Ziggit downloads full history**: No shallow clone support yet, so every
   object in the repo is transferred and parsed.
3. **express is 5x slower** because it has 5000+ commits worth of pack data.
4. **chalk is at parity** (0.96x) because it has short history — full clone ≈
   shallow clone in data volume.

### What's fast about ziggit

Despite the full-clone handicap, ziggit demonstrates:

- **Zero process spawn overhead**: In-process integration saves ~10ms per dep
  (git CLI spawns 2 processes: bare clone + local clone)
- **findCommit in 68µs**: Resolving refs via packed-refs is ~150x faster than
  `git rev-parse` (which takes ~11ms due to process startup)
- **Single-pass pack parsing**: Zig-native pack + idx writer with zero-alloc
  scan is CPU-efficient

---

## 5. findCommit / Ref Resolution

When bun resolves `github:foo/bar`, it needs to map branch names to SHAs.

| Method | Time | How |
|--------|------|-----|
| `git rev-parse HEAD` (CLI) | ~11ms | Fork + exec + read packed-refs + exit |
| ziggit findCommit (in-process) | ~68µs | Direct packed-refs file read, zero alloc |

**Speedup: ~160x** for ref resolution. With 5 git deps, this saves ~55ms.

---

## 6. Projected Impact on `bun install`

### Current state (no shallow clone)

| Component | Stock bun (ms) | With ziggit (ms) | Δ |
|-----------|---------------|-------------------|-----|
| Git dep resolution (5 repos) | ~904 (git CLI) | ~1814 (ziggit) | +910ms slower |
| Ref resolution (5× findCommit) | ~55 (5× git CLI) | ~0.3 (5× in-process) | -55ms faster |
| npm resolution + linking | ~134 | ~134 | same |
| **Total cold install** | **~1038** | **~1948** | **+910ms slower** |

**Today: ziggit would make bun install ~1.9x slower** due to missing shallow clone.

### With shallow clone support (planned)

If ziggit supported `--depth=1`, download sizes would match git CLI:

| Repo | Full clone (bytes) | Shallow (est.) | Speedup factor |
|------|-------------------|----------------|----------------|
| express | ~10.6MB | ~100KB | ~100x less data |
| node-semver | ~1.2MB | ~80KB | ~15x less data |
| debug | ~270KB | ~50KB | ~5x less data |

**Projected times with shallow clone:**

| Component | Stock bun (ms) | With ziggit + shallow (ms) | Δ |
|-----------|---------------|---------------------------|-----|
| Git dep resolution (5 repos) | ~904 | ~810 (at parity, less fork overhead) | -94ms |
| Ref resolution (5× findCommit) | ~55 | ~0.3 | -55ms |
| In-process (no subprocess spawn) | — | saves ~50ms (10ms × 5 deps) | -50ms |
| **Savings from git ops** | | | **~199ms** |
| **Parallel clones (all 5 concurrent)** | ~904 serial | ~220 parallel | **~684ms** |

**Best case with shallow + parallel: save ~850ms off cold bun install (~82% of git time)**

### Feature roadmap for bun integration speedup

| Feature | Impact | Status |
|---------|--------|--------|
| Shallow clone (`--depth=1`) | Eliminates 5x penalty on large repos | ❌ Not yet |
| In-process integration (no fork/exec) | -10ms per dep | ✅ Architecture ready |
| findCommit via packed-refs | -55ms total | ✅ Implemented (68µs) |
| Parallel clone (Zig async I/O) | -680ms (5 deps concurrent) | ⚠️ Possible with Zig |
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
#   3. Continue with npm resolution → same as stock bun
```

To build the fork on a proper machine:
```bash
cd /root/ziggit && zig build -Doptimize=ReleaseFast
cd /root/bun-fork && zig build -Doptimize=ReleaseFast
# or: cmake -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build
```

---

## 8. Raw Benchmark Data

### Stock bun install
```
Cold run 1: 1279ms — Resolved, downloaded and extracted [266]
Cold run 2: 1032ms — Resolved, downloaded and extracted [266]
Cold run 3:  802ms — Resolved, downloaded and extracted [266]
Warm run 1:   33ms — (lockfile cached)
Warm run 2:   32ms
Warm run 3:   31ms
```

### Git CLI (bare --depth=1 + local checkout), sequential
```
Run 1: debug=142 semver=186 chalk=168 is=175 express=211  total=951ms
Run 2: debug=132 semver=157 chalk=150 is=157 express=205  total=870ms
Run 3: debug=134 semver=150 chalk=160 is=159 express=216  total=890ms
```

### Ziggit clone (full depth), sequential
```
Run 1: debug=149 semver=260 chalk=174 is=184 express=966  total=1804ms
Run 2: debug=156 semver=232 chalk=154 is=195 express=978  total=1784ms
Run 3: debug=183 semver=243 chalk=171 is=210 express=976  total=1853ms
```

### Git rev-parse HEAD (CLI, per-repo)
```
debug=10-11ms  semver=10-11ms  chalk=10-11ms  is=10-11ms  express=10-11ms
Average: ~10.7ms per invocation (dominated by process startup)
```

### Ziggit findCommit (in-process, from RESULTS.md)
```
Average: ~68µs per invocation (direct packed-refs scan)
```
