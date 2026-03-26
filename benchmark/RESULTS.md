# ziggit vs git CLI — Benchmark Results

**Date**: 2026-03-26  
**System**: Linux x86_64, Zig 0.14  
**Repo**: https://github.com/octocat/Hello-World.git  
**Local iterations**: 100 | **Network iterations**: 5

## Summary

| Operation     | ziggit (ms) | git CLI (ms) | Speedup |
|---------------|-------------|--------------|---------|
| revParseHead  | 0.027       | 0.928        | **35x** |
| findCommit    | 0.026       | 1.102        | **42x** |
| describeTags  | 0.027       | 0.980        | **36x** |
| clone --bare  | 552         | 139          | 0.25x   |
| fetch         | 542         | 108          | 0.20x   |

## Analysis

### Local operations: 35–42x faster ✅

ziggit eliminates process spawn overhead entirely. Each git CLI invocation costs
~1ms just for fork+exec+startup. ziggit reads pack files and refs directly from
the filesystem in ~0.025ms.

**This is the win that matters for bun.** During `bun install`, each git dependency
triggers multiple local git operations (findCommit, revParseHead, describeTags).
With 10 git dependencies, that's 30+ process spawns saved.

### Network operations: git CLI still faster

- **clone --bare**: git CLI is ~4x faster (was 12x before optimizations)
- **fetch**: git CLI is ~5x faster

The gap is mainly:
1. **TLS implementation**: Zig's stdlib TLS vs system OpenSSL/BoringSSL
2. **idx generation**: ziggit must decompress every object to compute SHA-1 for the
   pack index. This takes ~400ms for the 8MB Hello-World pack.
3. **Fetch with many refs**: Hello-World has ~2800 refs (PRs, tags). Negotiation
   with many wants is slow.

### Previous results (before fixes)

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Fetch  | SEGFAULT | 542ms | **Fixed** |
| Clone  | 1367ms | 552ms | **2.5x faster** |
| Local ops | 35-44x | 35-42x | Stable |

## Fixes applied to ziggit

1. **fetch segfault** (use-after-free): `ref_name` strings in `fetchHttps()` were
   `defer`-freed inside the loop but stored in `local_refs_list`. The pointers were
   dangling by the time `fetchNewPack()` accessed them.

2. **clone performance**:
   - HTTP connection reuse (single TLS handshake for ref discovery + pack fetch)
   - Object resolution cache in idx generation (avoids redundant decompression)
   - O(N) fanout table (was O(256*N))
   - Reusable decompression buffer across objects
   - Stack-based format buffers instead of heap allocation
   - Generate idx from in-memory pack data (skip re-reading from disk)
   - Deduplicate want hashes in fetch negotiation

## Integration Strategy

bun uses ziggit for **all operations** with git CLI fallback:
- `findCommit()` → ziggit first, exec fallback
- `download()` → ziggit clone/fetch for HTTPS, exec for SSH
- `checkout()` → ziggit clone+checkout, exec fallback

This gives the 35-42x speedup on local ops while maintaining compatibility.
