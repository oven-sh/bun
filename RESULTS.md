# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-26
- Ziggit commit: 6f37261 (single-pass architecture with eager LRU caching)
- Bun fork branch: ziggit-integration
- Machine: Linux (root@ziggit)

## Clone Benchmarks (bare clone)

### sindresorhus/is (small repo, ~270KB pack)

| Tool    | Run 1  | Run 2  | Run 3  | Run 4  | Run 5  | Avg    |
|---------|--------|--------|--------|--------|--------|--------|
| ziggit  | 0.254s | 0.195s | 0.192s | 0.237s | 0.234s | 0.222s |
| git CLI | 0.206s | 0.209s | 0.223s | 0.224s | 0.208s | 0.214s |

**Result**: **Parity** — ziggit avg 0.222s vs git CLI avg 0.214s (1.04x). Network latency dominates.

### expressjs/express (medium repo, larger pack)

| Tool    | Time   |
|---------|--------|
| ziggit  | 1.018s |
| git CLI | 0.999s |

**Result**: **Parity** — within noise margin (~2% difference).

### Correctness
- `git fsck --no-dangling` passes on all ziggit-cloned repos ✅
- Pack + idx files generated correctly ✅
- Refs written to packed-refs ✅

## Benchmark History

| Date       | Ziggit Commit | idx_writer Version                    | sindresorhus/is (ziggit avg) | Ratio vs git CLI |
|------------|---------------|---------------------------------------|------------------------------|------------------|
| 2026-03-26 | 6f37261       | Single-pass with eager LRU caching    | 0.222s                       | 1.04x            |
| 2026-03-26 | b49999c       | Two-pass with DeltaCache              | 0.300s                       | 1.01x            |
| 2026-03-26 | eeba670       | Single-pass architecture              | 0.194s                       | ~1.0x            |
| Earlier    | (pre-rewrite) | Original multi-pass                   | ~4x slower                   | ~4x              |

*Note: Absolute times vary by network conditions; the ratio is what matters.*

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
- **Protocol errors** → Logged (unsupported scheme), falls back to git CLI
- **OOM** → Logged, falls back to git CLI

## Error Categories in `logZiggitError`

| Category           | Errors (actual ziggit values)                                                        | Behavior                    |
|--------------------|--------------------------------------------------------------------------------------|-----------------------------|
| SSH Auth           | SshProcessFailed, InvalidSshUrl                                                      | Log hint about SSH keys     |
| Network            | HttpError, ConnectionRefused, ConnectionTimedOut, TlsError/TlsFailure, BrokenPipe   | Log + fallback              |
| Protocol           | UnsupportedPackVersion, UnsupportedIndexVersion, InvalidUrl, InvalidPktLine           | Log + fallback              |
| Ref Resolution     | RefNotFound, ObjectNotFound, BranchNotFound, TreeNotFound, InvalidRef, InvalidCommit  | Log + fallback              |
| Data Integrity     | ChecksumMismatch, PackChecksumMismatch, InvalidPack*, CorruptedPackIndex, InvalidDelta* | Log + cleanup + fallback  |
| OOM                | OutOfMemory                                                                          | Log + fallback              |
| Other              | Any unrecognized error                                                               | Generic log + fallback      |

## Edge Case Testing

| Scenario                  | Ziggit Behavior                          | Integration Behavior              |
|---------------------------|------------------------------------------|-----------------------------------|
| Repo not found (HTTPS)    | Returns error (HTTP 401/404)             | Returns `RepositoryNotFound`      |
| Invalid host / DNS fail   | Returns network error                    | Logs + falls back to git CLI      |
| Clone to existing dir     | Returns error (dir exists)               | N/A (bun checks cache first)     |
| Network timeout           | Returns connection error                 | Logs + falls back to git CLI      |
| SSH auth failure           | Returns SSH error                        | Logs hint + falls back to git CLI |

## Known Limitations
- Ziggit has no configurable network timeout (git CLI fallback is the safety net)
- SSH transport not yet implemented in ziggit (SSH URLs converted to HTTPS via `tryHTTPS`)
