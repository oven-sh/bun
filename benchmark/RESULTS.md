# ziggit vs git CLI — Benchmark Results

**Date:** 2026-03-26 (run 21 — bun install integration benchmarks)
**System:** Linux x86_64, 483MB RAM, 1 vCPU (PREEMPT_DYNAMIC)
**Build:** ReleaseFast
**ziggit commit:** 0af9997
**Bun version:** 1.3.11

## bun install Benchmarks (5 git dependencies)

### Stock `bun install` (cold + warm)

| Run | Cold (ms) | Warm (ms) |
|-----|-----------|-----------|
| 1   | 567       | 32        |
| 2   | 382       | 31        |
| 3   | 501       | 30        |
| **Avg** | **483** | **31** |

### Sequential Clone: git CLI vs ziggit (--depth 1)

| Repo     | Git CLI (ms) median | Ziggit (ms) median | Speedup |
|----------|--------------------|--------------------|---------|
| debug    | 134                | 80                 | **1.68×** |
| semver   | 164                | 163                | 1.01×   |
| chalk    | 146                | 134                | **1.09×** |
| is       | 160                | 149                | **1.07×** |
| express  | 203                | 275                | 0.74×   |
| **Total** | **887**           | **870**            | **1.02×** |

### Parallel Clone (5 repos simultaneous)

| Run | Git CLI (ms) | Ziggit (ms) |
|-----|-------------|-------------|
| 1   | 376         | 443         |
| 2   | 351         | 437         |
| 3   | 349         | 442         |
| **Avg** | **359** | **441** |

### findCommit: git rev-parse vs ziggit (per-call)

| Method | Per-call | Speedup |
|--------|----------|---------|
| git rev-parse (subprocess) | ~2,050 µs | — |
| ziggit findCommit (in-process) | ~5.5 µs | **373×** |

---

## Clone --bare Benchmarks (historical)

### sindresorhus/is (1237 objects, ~270KB pack)

| Run | ziggit (ms) | git CLI (ms) |
|-----|-------------|--------------|
| 1   | 177         | 195          |
| 2   | 192         | 179          |
| 3   | 172         | 173          |
| 4   | 181         | 180          |
| 5   | 185         | 206          |
| **avg** | **181** | **187** |

### expressjs/express (33335 objects, ~6MB pack)

| Run | ziggit (ms) | git CLI (ms) |
|-----|-------------|--------------|
| 1   | 233         | 232          |
| 2   | 234         | 224          |
| 3   | 205         | 233          |
| **avg** | **224** | **230** |

## Correctness

- `git verify-pack` passes on all ziggit-produced .idx files ✅
- `git fsck --no-dangling` clean on all cloned repos ✅
- Object counts match exactly ✅
- Refs written to packed-refs ✅
- HEAD resolves correctly ✅

## Benchmark History

| Date       | Ziggit Commit | Test                        | Result                      |
|------------|---------------|-----------------------------|-----------------------------|
| 2026-03-26 | 0af9997       | bun install sim (5 deps)    | seq 1.02×, findCommit 373×  |
| 2026-03-26 | 6f37261       | clone --bare (is)           | 181ms vs 187ms (0.97×)      |
| 2026-03-26 | 6f37261       | clone --bare (express)      | 224ms vs 230ms (0.97×)      |
| 2026-03-26 | b49999c       | Two-pass + DeltaCache       | 203ms (git: 198ms)          |
| Earlier    | (pre-rewrite) | Original multi-pass         | ~4× slower                  |
