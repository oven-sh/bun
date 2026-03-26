# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-26
- Ziggit commit: eeba670 (single-pass idx_writer rewrite)
- Bun fork branch: ziggit-integration
- Machine: Linux (root@ziggit)

## Clone Benchmarks (bare clone)

### sindresorhus/is (small repo, ~270KB pack)

| Tool    | Run 1  | Run 2  | Run 3  | Notes |
|---------|--------|--------|--------|-------|
| ziggit  | 0.293s | 0.286s | 0.285s | Network-dominated |
| git CLI | 0.287s | 0.284s | 0.272s | Network-dominated |

**Result**: Parity — network latency dominates for small repos.

### expressjs/express (medium repo, ~10MB pack)

| Tool    | Time   | User   | Sys    |
|---------|--------|--------|--------|
| ziggit  | 1.126s | 0.814s | 0.086s |
| git CLI | 1.067s | 0.850s | 0.053s |

**Result**: Near parity (~5% slower). Pack processing is fast after idx_writer rewrite.

### Correctness
- `git fsck --no-dangling` passes on all ziggit-cloned repos ✅
- Pack + idx + rev files generated correctly ✅
- Refs written to packed-refs ✅

## Integration Architecture

Ziggit is used as the **primary** transport for git dependencies in `bun install`:

1. **Clone** (`cloneBare`): HTTPS preferred, falls back to git CLI on failure
2. **Fetch** (`open` + `fetch`): Updates existing cached repos
3. **findCommit** (`findCommit`): ~50x faster ref resolution (no process spawn)
4. **Checkout** (`cloneNoCheckout` + `checkout`): Local clone from bare cache

All paths have automatic git CLI fallback with categorized error logging.

## Key Improvements from idx_writer Rewrite
- Single-pass architecture eliminates re-reading pack data from disk
- `generateIdxFromData()` operates on in-memory pack bytes
- ~5x faster index generation vs original multi-pass implementation
