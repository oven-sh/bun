# ziggit vs git CLI — Benchmark Results

**Date**: 2026-03-26  
**System**: Linux x86_64, Zig 0.14  
**Repo**: https://github.com/octocat/Hello-World.git  
**Local iterations**: 100 | **Network iterations**: 5

## Summary

| Operation     | ziggit (ms) | git CLI (ms) | Speedup |
|---------------|-------------|--------------|---------|
| revParseHead  | 0.036       | 0.944        | **26x** |
| findCommit    | 0.036       | 1.113        | **31x** |
| describeTags  | 0.035       | 1.094        | **31x** |
| clone --bare  | 111         | 147          | **1.3x** |
| fetch         | 91          | 123          | **1.4x** |

**All 5 operations are faster than git CLI.** ziggit is the clear winner.

## Analysis

### Local operations: 26–31x faster ✅

ziggit eliminates process spawn overhead entirely. Each git CLI invocation costs
~1ms just for fork+exec+startup. ziggit reads pack files and refs directly from
the filesystem in ~0.03-0.04ms.

**This is the win that matters for bun.** During `bun install`, each git dependency
triggers multiple local git operations (findCommit, revParseHead, describeTags).
With 10 git dependencies, that's 30+ process spawns saved.

### Network operations: ziggit is FASTER ✅

After filtering refs to skip pull request refs (refs/pull/*):
- **clone --bare**: ziggit is ~1.3x faster than git CLI
- **fetch**: ziggit is ~1.4x faster than git CLI

The key optimization was filtering out thousands of PR refs that inflated the pack
from 1.5KB to 8MB. Now ziggit only fetches refs/heads/*, refs/tags/*, and HEAD.

### Evolution of results

| Metric | Initial | After ref filtering | Change |
|--------|---------|-------------------|--------|
| Clone  | 1367ms (12x slower) | 111ms (1.3x faster) | **~12x improvement** |
| Fetch  | SEGFAULT | 91ms (1.4x faster) | **Fixed + fast** |
| Local ops | 35-44x | 26-31x | Slightly lower (packed-refs fallback adds ~10μs) |

## Fixes applied to ziggit

1. **fetch segfault** (use-after-free): `ref_name` strings in `fetchHttps()` were
   `defer`-freed inside the loop but stored in `local_refs_list`.

2. **clone/fetch performance** (12x improvement):
   - Filter refs to only request refs/heads/*, refs/tags/*, and HEAD
   - Skip refs/pull/* which added thousands of unwanted objects (8MB vs 1.5KB pack)
   - Use packed-refs file instead of individual ref files in bare clone
   - HTTP connection reuse (single TLS handshake for ref discovery + pack fetch)

3. **packed-refs support**:
   - resolveRef now falls back to packed-refs file
   - describeTags scans both refs/tags/ directory and packed-refs
   - fetchHttps reads packed-refs for local ref negotiation

## Integration Strategy

bun uses ziggit for **all operations** with git CLI fallback:
- `findCommit()` → ziggit first, exec fallback
- `download()` → ziggit clone/fetch for HTTPS, exec for SSH
- `checkout()` → ziggit clone+checkout, exec fallback

This gives the 26-31x speedup on local ops AND 1.3-1.4x on network ops.
