# ziggit vs git CLI — Benchmark Results

**Date:** 2026-03-26 (refreshed with single-pass idx_writer + LRU caching)
**System:** Linux hdr 6.1.141 x86_64 (PREEMPT_DYNAMIC)
**Build:** ReleaseFast
**ziggit commit:** 6f37261 (single-pass idx_writer with eager LRU DeltaCache)

## Clone --bare Benchmarks

### sindresorhus/is (1237 objects, ~270KB pack)

| Run | ziggit (ms) | git CLI (ms) |
|-----|-------------|--------------|
| 1   | 177         | 195          |
| 2   | 192         | 179          |
| 3   | 172         | 173          |
| 4   | 181         | 180          |
| 5   | 185         | 206          |
| **avg** | **181** | **187** |

**Result:** Dead parity (0.97x). Network-dominated. ✅

### expressjs/express (33335 objects, ~6MB pack)

| Run | ziggit (ms) | git CLI (ms) |
|-----|-------------|--------------|
| 1   | 233         | 232          |
| 2   | 234         | 224          |
| 3   | 205         | 233          |
| **avg** | **224** | **230** |

**Result:** Dead parity (0.97x). Network-dominated. ✅

*Note: Express times are lower than previous runs due to GitHub CDN cache warm-up. Absolute times vary by network conditions; the ratio is what matters.*

## Correctness

- `git verify-pack` passes on all ziggit-produced .idx files ✅
- `git fsck --no-dangling` clean on all cloned repos ✅
- Object counts match exactly ✅
- Refs written to packed-refs ✅
- HEAD resolves correctly ✅

## findCommit Performance

| Method          | Time     | Notes                                    |
|-----------------|----------|------------------------------------------|
| ziggit (native) | ~68µs    | Direct packed-refs file scan, no spawn   |
| git CLI         | ~5-10ms  | `git log --format=%H -1 main` via exec   |

**~100x speedup** for ref resolution — critical for `bun install` which calls findCommit for every git dependency.

## Benchmark History

| Date       | Ziggit Commit | idx_writer Architecture         | sindresorhus/is avg | express avg         |
|------------|---------------|---------------------------------|---------------------|---------------------|
| 2026-03-26 | 6f37261       | Single-pass + eager LRU cache   | 181ms (git: 187ms)  | 224ms (git: 230ms)  |
| 2026-03-26 | b49999c       | Two-pass + DeltaCache           | 203ms (git: 198ms)  | —                   |
| 2026-03-26 | eeba670       | Single-pass                     | 194ms (git: 192ms)  | —                   |
| Earlier    | (pre-rewrite) | Original multi-pass             | ~4x slower          | —                   |
