# ziggit vs git CLI — Benchmark Results

**Date**: 2026-03-26
**System**: Linux x86_64, Zig 0.13.0, ReleaseFast
**Repo**: https://github.com/octocat/Hello-World.git
**Local iterations**: 100 | **Network iterations**: 5
**ziggit version**: latest master (commit 782c688) — with HTTPS + SSH native transport

## Summary

| Operation     | ziggit (ms) | git CLI (ms) | Speedup |
|---------------|-------------|--------------|---------|
| revParseHead  | 0.036       | 0.951        | **26x** |
| findCommit    | 0.036       | 1.115        | **31x** |
| describeTags  | 0.041       | 1.236        | **30x** |
| clone --bare  | 77          | 121          | **1.6x** |
| fetch         | 105         | 108          | **1.0x** |

**All 5 operations are faster than git CLI.**

## What This Means for Bun

During `bun install` with git dependencies, bun calls these operations:

1. **`findCommit()`** — called per git dep on every install → **31x faster**
2. **`revParseHead()`** — called per git dep → **26x faster**
3. **`describeTags()`** — called per git dep → **30x faster**
4. **`clone --bare`** — called once per new git dep (cached) → **1.6x faster**
5. **`fetch`** — called to update cached deps → **1.0x (parity)**

### Example: 10 git dependencies

| Metric | git CLI | ziggit | Savings |
|--------|---------|--------|---------|
| Local ops (30 calls) | ~33ms | ~1.1ms | **32ms saved** |
| Clone (10 first-time) | ~1210ms | ~770ms | **440ms saved** |
| Total first install | ~1243ms | ~771ms | **38% faster** |
| Subsequent installs (local only) | ~33ms | ~1.1ms | **97% faster** |

The biggest win is on **subsequent installs** where repos are already cached
and only local ops (findCommit, revParseHead, describeTags) are needed.

## Integration Architecture

bun's `src/install/repository.zig` uses ziggit for **all protocols**:

```
download() → clone/fetch
  1. Try ziggit (HTTPS native HTTP, SSH native ssh_transport.zig)
  2. Git CLI fallback only on ziggit failure

findCommit()
  1. Try ziggit (direct pack file / ref reading)
  2. Git CLI fallback only on ziggit failure

checkout()
  1. Try ziggit (local clone + tree checkout)
  2. Git CLI fallback only on ziggit failure
```

**Protocol coverage** (all via ziggit, no git CLI needed):
- `https://github.com/user/repo.git` → ziggit native HTTP (smart_http.zig)
- `git@github.com:user/repo.git` → ziggit native SSH (ssh_transport.zig)
- `ssh://git@github.com/user/repo.git` → ziggit native SSH
- Local bare repos → ziggit native file I/O

Git CLI is only reached if ziggit encounters an unexpected error.

## Evolution

| Metric | v1 (initial) | v2 (ref filter) | v3 (current) |
|--------|-------------|-----------------|--------------|
| clone --bare | 1367ms (12x slower) | 111ms (1.3x faster) | 77ms (1.6x faster) |
| fetch | SEGFAULT | 91ms (1.4x faster) | 105ms (1.0x parity) |
| revParseHead | 0.023ms (40x) | 0.036ms (26x) | 0.036ms (26x) |
| findCommit | 0.026ms (44x) | 0.036ms (31x) | 0.036ms (31x) |
| describeTags | 0.024ms (42x) | 0.035ms (31x) | 0.041ms (30x) |
| SSH support | ❌ git CLI only | ❌ git CLI only | ✅ native |
| WASM | ❌ didn't compile | ❌ didn't compile | ✅ 108KB .wasm |

## Key Optimizations Applied

1. **Ref filtering**: Skip `refs/pull/*` — reduced pack from 8MB to 1.5KB
2. **HTTP connection reuse**: Single TLS handshake for ref discovery + pack fetch
3. **idx generation cache**: Avoid redundant decompression in delta chains
4. **Packed-refs**: Use packed-refs file instead of individual ref files
5. **SSH transport**: Native ssh child process with pkt-line protocol (no git CLI needed)
