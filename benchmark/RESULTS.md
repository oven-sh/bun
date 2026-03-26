# ziggit vs git CLI — Benchmark Results

**Date**: 2026-03-26  
**System**: Linux x86_64, Zig 0.14  
**Repo**: https://github.com/octocat/Hello-World.git  
**Local iterations**: 100 | **Network iterations**: 5

## Summary

| Operation     | ziggit (ms) | git CLI (ms) | Speedup |
|---------------|-------------|--------------|---------|
| revParseHead  | 0.044       | 0.965        | **22x** |
| findCommit    | 0.035       | 1.114        | **32x** |
| describeTags  | 0.035       | 1.095        | **31x** |
| clone --bare  | 91          | 133          | **1.5x** |
| fetch         | 86          | 112          | **1.3x** |

## Analysis

### Local operations: 22–32x faster ✅

ziggit eliminates process spawn overhead entirely. Each git CLI invocation costs
~1ms just for fork+exec+startup. ziggit reads pack files and refs directly from
the filesystem in ~0.03-0.04ms.

**This is the win that matters for bun.** During `bun install`, each git dependency
triggers multiple local git operations (findCommit, revParseHead, describeTags).
With 10 git dependencies, that's 30+ process spawns saved.

### Network operations: ziggit is FASTER ✅

After filtering refs to skip pull request refs (refs/pull/*):
- **clone --bare**: ziggit is ~1.5x faster than git CLI
- **fetch**: ziggit is ~1.3x faster than git CLI

The key optimization was filtering out thousands of PR refs that inflated the pack
from 1.5KB to 8MB. Now ziggit only fetches refs/heads/*, refs/tags/*, and HEAD.

### Previous results (before latest fixes)

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Clone  | 1367ms (12x slower) | 91ms (1.5x faster) | **~15x improvement** |
| Fetch  | SEGFAULT → 542ms | 86ms (1.3x faster) | **Fixed + 6x faster** |
| Local ops | 35-44x | 22-32x | Slightly lower due to packed-refs fallback |

## Fixes applied to ziggit

1. **fetch segfault** (use-after-free): `ref_name` strings in `fetchHttps()` were
   `defer`-freed inside the loop but stored in `local_refs_list`.

2. **clone/fetch performance** (15x improvement):
   - Filter refs to only request refs/heads/*, refs/tags/*, and HEAD
   - Skip refs/pull/* which added thousands of unwanted objects (8MB vs 1.5KB pack)
   - Use packed-refs file instead of individual ref files in bare clone
   - HTTP connection reuse (single TLS handshake for ref discovery + pack fetch)

3. **packed-refs support**:
   - resolveRef now falls back to packed-refs file
   - describeTags scans both refs/tags/ directory and packed-refs

## Integration Strategy

bun uses ziggit for **all operations** with git CLI fallback:
- `findCommit()` → ziggit first, exec fallback
- `download()` → ziggit clone/fetch for HTTPS, exec for SSH
- `checkout()` → ziggit clone+checkout, exec fallback

This gives the 22-32x speedup on local ops AND 1.3-1.5x on network ops.
