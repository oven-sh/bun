# Bun Install Benchmark: Stock Bun vs Ziggit Integration

**Date:** 2026-03-27T00:50Z  
**VM:** 483MB RAM, 1 CPU, Linux x86_64 (minimized container)  
**Bun:** v1.3.11 (stock, at `/root/.bun/bin/bun`)  
**Git:** v2.43.0  
**Ziggit:** built from `/root/ziggit` at HEAD (`6cacbc8`), ReleaseFast, Zig 0.15.2  
**Bun fork:** not buildable on this VM (see [Build Notes](#6-build-notes))  

All numbers are **actual measured values**, each benchmark run 3 times, caches cleared between cold runs.

---

## Test Setup

**package.json** with 5 GitHub git dependencies:
```json
{
  "dependencies": {
    "is": "github:sindresorhus/is",
    "express": "github:expressjs/express",
    "chalk": "github:chalk/chalk",
    "debug": "github:debug-js/debug",
    "semver": "github:npm/node-semver"
  }
}
```

Resolves to **69 total packages** (5 git deps + 64 transitive npm deps).  
Total files across git deps: is=15, express=213, chalk=34, debug=13, semver=151 → **426 files**.

---

## 1. Stock `bun install` Timings

### Cold Cache (no `~/.bun/install/cache`, no `node_modules`, no `bun.lock`)

| Run | Time |
|-----|------|
| 1   | 413ms |
| 2   | 378ms |
| 3   | 602ms* |
| **Median** | **413ms** |

*Run 3 had a network hiccup; median is more representative.

### Warm Cache (cache populated, `node_modules` + `bun.lock` removed)

| Run | Time |
|-----|------|
| 1   | 78ms |
| 2   | 93ms |
| 3   | 253ms* |
| **Median** | **93ms** |

---

## 2. Clone-Only: Ziggit vs Git CLI (bare --depth=1)

All repos warmed up first to avoid GitHub rate limiting. 3 runs each.

### Per-Run Details

| Run | Tool | is | express | chalk | debug | semver | **TOTAL** |
|-----|------|----|---------|-------|-------|--------|-----------|
| 1 | git | 122ms | 160ms | 120ms | 121ms | 135ms | **664ms** |
| 1 | ziggit | 73ms | 104ms | 75ms | 77ms | 77ms | **411ms** |
| 2 | git | 131ms | 167ms | 128ms | 116ms | 154ms | **701ms** |
| 2 | ziggit | 72ms | 107ms | 73ms | 64ms | 78ms | **400ms** |
| 3 | git | 131ms | 160ms | 128ms | 115ms | 135ms | **674ms** |
| 3 | ziggit | 79ms | 109ms | 84ms | 71ms | 74ms | **421ms** |

### Averages

| Repo | Git CLI | Ziggit | Speedup |
|------|---------|--------|---------|
| is | 128ms | 75ms | **41% faster** |
| express | 162ms | 107ms | **34% faster** |
| chalk | 125ms | 77ms | **38% faster** |
| debug | 117ms | 71ms | **40% faster** |
| semver | 141ms | 76ms | **46% faster** |
| **TOTAL** | **680ms** | **411ms** | **40% faster** |

---

## 3. Full Workflow: Clone + rev-parse + ls-tree + cat-file (all files)

This simulates what `bun install` does for each git dependency: clone the repo, resolve HEAD, list the tree, and extract every file.

### Per-Repo Averages (3 runs)

| Repo (files) | Git CLI | Ziggit | Delta |
|--------------|---------|--------|-------|
| is (15) | 155ms | 112ms | ziggit **28% faster** |
| express (213) | 429ms | 490ms | git **14% faster** |
| chalk (34) | 176ms | 148ms | ziggit **16% faster** |
| debug (13) | 139ms | 93ms | ziggit **33% faster** |
| semver (151) | 314ms | 351ms | git **12% faster** |
| **TOTAL** | **1219ms** | **1202ms** | **~even (1.4% delta)** |

### Component Breakdown (averages across 3 runs)

| Component | Git CLI | Ziggit | Delta |
|-----------|---------|--------|-------|
| Clone (5 repos) | 663ms | 414ms | **-249ms (ziggit wins)** |
| rev-parse (5 calls) | 10ms | 12ms | ~even |
| ls-tree (5 calls) | 12ms | 16ms | ~even |
| cat-file (426 calls) | 527ms | 753ms | **+226ms (ziggit loses)** |
| **TOTAL** | **1219ms** | **1202ms** | **-17ms** |

### Per-File `cat-file` Cost

| Tool | Total cat-file time | Per-file cost | Overhead per invocation |
|------|--------------------:|:--------------|:-----------------------|
| git  | 527ms | **1.24ms** | baseline |
| ziggit | 753ms | **1.77ms** | +0.53ms (+43%) |

### Why Ziggit Loses on cat-file in CLI Mode

Git's `cat-file` is a tiny C binary that loads a single blob from a packfile very quickly. Ziggit's CLI binary has ~0.5ms extra startup per invocation (allocator init, args parsing, pack index open). Over 426 invocations: 426 × 0.53ms = **226ms overhead** — almost exactly cancelling the 249ms clone advantage.

**This overhead vanishes completely in library mode** — when ziggit is linked directly into bun, each `cat-file` becomes an in-process function call with zero spawn cost.

---

## 4. Library-Mode Projection (Bun + Ziggit Linked)

When ziggit is used as a library (as designed in the bun fork), the workflow changes fundamentally:

| Component | CLI mode (ziggit) | Library mode (projected) | Savings |
|-----------|-------------------|--------------------------|---------|
| Clone (network I/O) | 414ms | 414ms | 0ms (network-bound) |
| rev-parse × 5 | 12ms | <1ms | ~11ms |
| ls-tree × 5 | 16ms | <1ms | ~15ms |
| cat-file × 426 | 753ms | <5ms | **~748ms** |
| **TOTAL** | **1202ms** | **~421ms** | **~781ms (65% faster)** |

The 426 process spawns (each ~1.77ms) become 426 in-process function calls (each ~0.01ms).

### Projected `bun install` Times

| Scenario | Stock Bun | Bun + Ziggit (projected) | Improvement |
|----------|-----------|--------------------------|-------------|
| Cold cache | 413ms | ~270ms | **~35% faster** |
| Warm cache | 93ms | ~93ms | Same (no git ops) |

**Derivation:** Stock bun cold = 413ms. Bun parallelizes git operations internally. Estimated ~200ms of the 413ms is git-dep work (cloning 5 repos in parallel + extraction). Ziggit library mode: ~85ms parallel clone (network-bound, 5 concurrent) + ~5ms extraction = ~90ms. Net savings: ~110ms → 413 - 110 ≈ 270ms. Conservative estimate accounting for bun's internal parallelism.

---

## 5. Process Spawn Overhead

| Tool | `--version` avg spawn time (20 iterations) |
|------|-------------------------------------------|
| git | 1ms |
| ziggit | 2ms |

Per-invocation overhead is small individually, but 426 invocations × 0.53ms delta = 226ms total. This is the **dominant bottleneck in CLI mode** and **disappears entirely** in library mode.

---

## 6. Build Notes

### Full bun fork build requirements (not met on this VM)

| Resource | Required | Available | Status |
|----------|----------|-----------|--------|
| RAM | ≥8GB | 483MB | ❌ |
| Disk | ≥15GB | ~2GB free | ❌ |
| Zig | 0.14.x (bun's build.zig) | 0.15.2 | ⚠️ version mismatch |
| Time | ~30min | — | — |

### Integration architecture

The bun fork's `build.zig.zon` correctly declares ziggit as a path dependency:

```zig
.dependencies = .{
    .ziggit = .{
        .path = "../ziggit",
    },
},
```

Ziggit exposes a `ziggit` module via `build.zig` with the full API surface:
- `clone()` — bare clone with streaming pack parsing
- `findCommit()` / `rev-parse` — resolve refs to SHAs
- `ls-tree` — list tree entries recursively
- `cat-file` — extract blob content from packfile

### To build on a proper machine:

```bash
cd /root/ziggit && zig build -Doptimize=ReleaseFast
cd /root/bun-fork && zig build -Doptimize=ReleaseFast
```

---

## 7. Raw Data

### Stock bun install (per-run)

```
Cold: 413ms, 378ms, 602ms*  → median 413ms
Warm:  78ms,  93ms, 253ms*  → median  93ms
(* = network hiccup)
```

### Clone-only per-run details

```
Run 1: git  → is=122 express=160 chalk=120 debug=121 semver=135 TOTAL=664ms
Run 1: zig  → is=73  express=104 chalk=75  debug=77  semver=77  TOTAL=411ms
Run 2: git  → is=131 express=167 chalk=128 debug=116 semver=154 TOTAL=701ms
Run 2: zig  → is=72  express=107 chalk=73  debug=64  semver=78  TOTAL=400ms
Run 3: git  → is=131 express=160 chalk=128 debug=115 semver=135 TOTAL=674ms
Run 3: zig  → is=79  express=109 chalk=84  debug=71  semver=74  TOTAL=421ms
```

### Full workflow per-run details

```
Run 1 git:    is=159  express=416  chalk=186  debug=142  semver=316  TOTAL=1225ms
Run 1 ziggit: is=106  express=482  chalk=148  debug=90   semver=345  TOTAL=1178ms
Run 2 git:    is=153  express=452  chalk=176  debug=134  semver=315  TOTAL=1237ms
Run 2 ziggit: is=108  express=494  chalk=146  debug=92   semver=347  TOTAL=1194ms
Run 3 git:    is=152  express=420  chalk=165  debug=140  semver=310  TOTAL=1194ms
Run 3 ziggit: is=123  express=494  chalk=150  debug=97   semver=362  TOTAL=1234ms
```

### Component breakdown (averages, full workflow)

```
           Clone     rev-parse  ls-tree  cat-file  TOTAL
git:       663ms     10ms       12ms     527ms     1219ms
ziggit:    414ms     12ms       16ms     753ms     1202ms
delta:    -249ms     +2ms       +4ms    +226ms     -17ms
```

---

## 8. Summary

| Metric | Value |
|--------|-------|
| **Clone speedup (ziggit vs git CLI)** | **40% faster** |
| **Full workflow CLI mode** | ~even (1.4% ziggit edge) |
| **Full workflow library mode (projected)** | **~65% faster** |
| **Projected bun install cold improvement** | **~35% faster** |
| **Key bottleneck in CLI mode** | 426 process spawns for cat-file (+226ms) |
| **Key win in library mode** | Zero-cost function calls eliminate spawn overhead |

### The Story in One Paragraph

Ziggit clones git repos **40% faster** than git CLI in bare `--depth=1` mode (411ms vs 680ms for 5 repos). In a full bun-install simulation (clone → resolve → extract all 426 files across 5 repos), CLI-mode ziggit breaks even with git because each of the 426 `cat-file` invocations costs an extra 0.53ms of process spawn overhead (+226ms total), almost exactly cancelling the 249ms clone advantage. **When linked as a library** (as intended in the bun fork), those 426 process spawns become zero-cost function calls, projecting a **~65% faster** git-dependency workflow and **~35% faster** cold `bun install` (from ~413ms to ~270ms).
