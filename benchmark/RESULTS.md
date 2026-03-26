# ziggit vs git CLI — Benchmark Results

**Date:** 2026-03-26 (refreshed with two-pass idx_writer)
**System:** Linux hdr 6.1.141 x86_64 (PREEMPT_DYNAMIC)
**Build:** ReleaseFast
**ziggit commit:** b49999c (two-pass idx_writer with DeltaCache)

## Clone --bare Benchmarks

### sindresorhus/is (1237 objects, 1.2MB pack)

| Run | ziggit (ms) | git CLI (ms) |
|-----|-------------|--------------|
| 1   | 212         | 207          |
| 2   | 206         | 195          |
| 3   | 205         | 189          |
| 4   | 200         | 188          |
| 5   | 191         | 210          |
| **avg** | **203** | **198** |

> At parity. Run-to-run variance (~20ms) exceeds the difference between tools.
> Network latency and TLS handshake dominate total time.

### octocat/Hello-World (tiny repo)

| Run | ziggit (ms) | git CLI (ms) |
|-----|-------------|--------------|
| 1   | 160         | 187          |
| 2   | 152         | 142          |
| 3   | 142         | 165          |
| 4   | 149         | 157          |
| 5   | 158         | 150          |
| **avg** | **152** | **160** |

> ziggit slightly faster on average (1.05x), but within noise.

## Local Operations

| Operation | ziggit (ms) | git CLI (ms) | Speedup |
|-----------|-------------|--------------|---------|
| revParseHead | 0.035 | 0.929 | **26.7x** |
| findCommit | 0.035 | 1.086 | **31.4x** |
| describeTags | 0.034 | 1.091 | **32.5x** |

**27-32x faster** — the primary win for bun's package manager, which calls
findCommit/revParse hundreds of times during a single `bun install`.

## Correctness Verification

All ziggit-generated repos verified against git CLI output:
- ✅ `git fsck` — no errors
- ✅ `git verify-pack -v` — all pack indexes valid
- ✅ Pack SHA matches between ziggit and git CLI for identical remote state
- ✅ Delta chain statistics identical (chain length distribution matches)

## idx_writer Evolution

| Version | Commit | sindresorhus/is | Notes |
|---------|--------|-----------------|-------|
| Original | pre-eeba670 | ~250ms+ | Fast but unstable for large packs |
| Single-pass | eeba670 | ~818ms median | Correct but high variance |
| Two-pass + DeltaCache | b49999c | ~203ms avg | Correct, stable, parity with git |

The two-pass architecture (b49999c) resolves delta chains via DeltaCache for proper
CRC32 and offset entries. Network latency now fully dominates clone time.

## Key Wins

### Local Operations (27-32x faster)
Eliminates `fork()/exec()` overhead. Git CLI spawns a new process (~1ms), while ziggit
reads pack index files directly (~0.035ms). This matters for bun's package manager which
calls findCommit/revParse hundreds of times during a single `bun install`.

### Network Operations (~1.0x vs git CLI)
- **clone --bare**: ziggit reuses a single HTTP client for ref discovery + pack fetch
  (1 TLS handshake instead of 2). Smart ref filtering skips PR refs.
- **fetch**: ziggit reuses HTTP client between discoverRefs and fetchPack.
- Network latency dominates — idx_writer speed is invisible at network scale.

## Integration Status (bun fork)

- ✅ `clone --bare` → ziggit primary, git CLI fallback
- ✅ `fetch` → ziggit primary, git CLI fallback
- ✅ `findCommit` → ziggit primary, git CLI fallback
- ✅ `checkout` → ziggit primary, git CLI fallback
- ✅ All protocols: HTTPS, SSH, SCP-style (`git@host:path`)
- ✅ Error categorization: SSH auth, network, protocol, data integrity, OOM
- ✅ Partial clone cleanup on failure (deleteTree before fallback)
- ✅ RepositoryNotFound propagated immediately (no pointless fallback)
- ✅ `errdefer` for dir handle cleanup on all error paths
