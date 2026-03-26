# ziggit vs git CLI — Benchmark Results

**Date:** 2026-03-26
**System:** Linux hdr 6.1.141 x86_64 (PREEMPT_DYNAMIC)
**Repo:** https://github.com/octocat/Hello-World.git
**Build:** ReleaseFast
**Local iterations:** 100, **Network iterations:** 5

## Summary

| Operation | ziggit (ms) | git CLI (ms) | Speedup |
|-----------|-------------|--------------|---------|
| clone --bare | 71.69 | 130.41 | **1.82x** |
| revParseHead | 0.035 | 0.929 | **26.7x** |
| findCommit | 0.035 | 1.086 | **31.4x** |
| fetch | 60.83 | 91.26 | **1.50x** |
| describeTags | 0.034 | 1.091 | **32.5x** |

**All 5 operations faster than git CLI. No segfaults.**

## Key Wins

### Local Operations (27-32x faster)
The massive speedup on local ops comes from eliminating `fork()/exec()` overhead.
Git CLI spawns a new process (~1ms), while ziggit reads files directly (~0.035ms).
This matters for bun's package manager which calls these ops hundreds of times during install.

### Network Operations (1.5-1.8x faster)
- **clone --bare**: ziggit reuses a single HTTP client for ref discovery + pack fetch (1 TLS handshake instead of 2). Uses `savePackFast()` to skip redundant SHA-1 verification. Smart ref filtering skips PR refs.
- **fetch**: ziggit reuses HTTP client between discoverRefs and fetchPack. Smart ref filtering skips PR refs.

## Fixes Applied (ziggit repo)
1. **fetch segfault fix**: Reuse HTTP client in `fetchNewPack()`, add `errdefer` for discovery cleanup
2. **clone perf**: Skip redundant SHA-1 verification in `savePackFast()`, use stack buffers for paths
3. **ref filtering**: Skip pull request refs during clone/fetch (reduces unnecessary objects)
4. **SHA-1 optimization**: Skip redundant SHA-1 verification in pack save during clone/fetch

## Integration Status (bun fork)
- ✅ `clone --bare` → ziggit primary, git CLI fallback
- ✅ `fetch` → ziggit primary, git CLI fallback
- ✅ `findCommit` → ziggit primary, git CLI fallback
- ✅ `checkout` → ziggit primary, git CLI fallback
- ✅ All protocols: HTTPS, SSH, SCP-style (`git@host:path`)
