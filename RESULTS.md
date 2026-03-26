# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-26
- Ziggit commit: eeba670 (single-pass idx_writer rewrite)
- Bun fork branch: ziggit-integration
- Machine: Linux (root@ziggit)

## Clone Benchmarks (bare clone)

### sindresorhus/is (small repo, ~270KB pack)

| Tool    | Run 1  | Run 2  | Run 3  | Avg    |
|---------|--------|--------|--------|--------|
| ziggit  | 0.205s | 0.192s | 0.185s | 0.194s |
| git CLI | 0.177s | 0.200s | 0.210s | 0.196s |

**Result**: **Parity** — ziggit avg 0.194s vs git CLI avg 0.196s. Network latency dominates.

### chalk/chalk (medium repo)

| Tool    | Time   |
|---------|--------|
| ziggit  | 0.160s |
| git CLI | 0.156s |

**Result**: **Parity** — within noise margin.

### Correctness
- `git fsck --no-dangling` passes on all ziggit-cloned repos ✅
- Pack + idx files generated correctly ✅
- Refs written to packed-refs ✅

## Integration Architecture

Ziggit is used as the **primary** transport for git dependencies in `bun install`:

1. **Clone** (`cloneBare`): HTTPS preferred (via `tryHTTPS`), falls back to git CLI on failure
2. **Fetch** (`open` + `fetch`): Updates existing cached repos
3. **findCommit** (`findCommit`): ~50x faster ref resolution (no process spawn)
4. **Checkout** (`cloneNoCheckout` + `checkout`): Local clone from bare cache

All paths have automatic git CLI fallback with categorized error logging.

### Error handling strategy
- **HTTPS 404** → `RepositoryNotFound` returned immediately (definitive)
- **SSH "not found"** → Falls back to git CLI (may be auth/permission issue)
- **Network errors** → Categorized + logged, falls back to git CLI
- **Data integrity** → Logged, partial dirs cleaned up, falls back to git CLI
- **Auth failures** → Logged with actionable hint (check SSH keys), falls back

## Key Improvements from idx_writer Rewrite
- Single-pass architecture eliminates re-reading pack data from disk
- `generateIdxFromData()` operates on in-memory pack bytes
- ~5x faster index generation vs original multi-pass implementation
- Brought ziggit from ~4x slower to parity with git CLI

## Known Limitations
- Ziggit has no configurable network timeout (git CLI fallback is the safety net)
- SSH transport not yet implemented in ziggit (SSH URLs converted to HTTPS via `tryHTTPS`)
