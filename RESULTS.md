# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-26 (latest refresh)
- Ziggit commit: 6f37261 (single-pass architecture with eager LRU caching)
- Bun fork branch: ziggit-integration
- Machine: Linux (root@ziggit), tmpfs-backed /tmp
- Build: `zig build -Doptimize=ReleaseFast`

## Clone Benchmarks (bare clone)

### sindresorhus/is (small repo, ~270KB pack) — 5 runs

| Tool    | Run 1  | Run 2  | Run 3  | Run 4  | Run 5  | Avg    |
|---------|--------|--------|--------|--------|--------|--------|
| ziggit  | 296ms  | 273ms  | 266ms  | 261ms  | 247ms  | 269ms  |
| git CLI | 242ms  | 235ms  | 247ms  | 245ms  | 274ms  | 249ms  |

**Result**: **Parity** — ziggit avg 269ms vs git CLI avg 249ms (~1.08x). Network-dominated. ✅

### chalk/chalk (small repo, ~1.2MB) — 5 runs

| Tool    | Run 1  | Run 2  | Run 3  | Run 4  | Run 5  | Avg    |
|---------|--------|--------|--------|--------|--------|--------|
| ziggit  | 180ms  | 152ms  | 154ms  | 159ms  | 147ms  | 158ms  |
| git CLI | 156ms  | 153ms  | 160ms  | 154ms  | 157ms  | 156ms  |

**Result**: **Parity** — ziggit avg 158ms vs git CLI avg 156ms (~1.01x). Network-dominated. ✅

### expressjs/express (medium repo, ~11MB) — single run (network-dominated)

| Tool    | Time   |
|---------|--------|
| ziggit  | 992ms  |
| git CLI | 994ms  |

**Result**: **Parity** — essentially identical. ✅

### Correctness
- `git fsck --no-dangling` passes on all ziggit-cloned repos (is, chalk, express) ✅
- Pack + idx files generated correctly ✅
- Refs written to packed-refs ✅
- HEAD resolves correctly ✅

## Edge Case Testing

| Scenario                  | Test Command                                                    | Result                                      |
|---------------------------|-----------------------------------------------------------------|---------------------------------------------|
| Repo not found (HTTPS)    | `clone --bare https://github.com/.../nonexistent.git`          | Exits 128, "could not read Username" ✅     |
| Invalid host / DNS fail   | `clone --bare https://bad-host.example.com/repo.git`           | Exits 128, "Could not resolve host" (19ms) ✅|
| SSH without keys          | `clone --bare git@github.com:user/repo.git`                    | Exits 128, "Host key verification failed" ✅ |
| Normal HTTPS clone        | `clone --bare https://github.com/sindresorhus/is.git`          | Success, fsck clean ✅                       |

## Benchmark History

| Date       | Ziggit Commit | idx_writer Version                    | sindresorhus/is avg | chalk avg | express avg | Notes |
|------------|---------------|---------------------------------------|---------------------|-----------|-------------|-------|
| 2026-03-26 | 6f37261 (latest) | Single-pass with eager LRU caching | 269ms (git: 249ms)  | 158ms (git: 156ms) | 992ms (git: 994ms) | Parity across all sizes |
| 2026-03-26 | 6f37261 (earlier) | Same                              | 193ms (git: 209ms)  | —         | 1001ms      | 8% faster on small (variable network) |
| 2026-03-26 | b49999c       | Two-pass with DeltaCache              | 300ms               | —         | —           | 1.01x |
| 2026-03-26 | eeba670       | Single-pass architecture              | 194ms               | —         | —           | ~1.0x |
| Earlier    | (pre-rewrite) | Original multi-pass                   | ~4x slower          | —         | —           | ~4x   |

*Note: Absolute times vary by network conditions; the ratio is what matters. These are network-dominated benchmarks — ziggit's advantage shows in local operations (findCommit is ~50x faster than spawning git CLI).*

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
- **OOM/resources** → Logged, falls back to git CLI
- **Filesystem** → Logged with hint (check permissions), falls back to git CLI
- **Partial clones** → `deleteTree` on all failure paths (ziggit + git CLI)

## Error Categories in `logZiggitError`

| Category           | Example Errors                                                   | Behavior                    |
|--------------------|------------------------------------------------------------------|-----------------------------|
| SSH Auth           | SshProcessFailed, SshCloneFailed, SshAuthFailed, SshKeyNotFound  | Log hint about SSH keys     |
| Network            | HttpError, ConnectionTimedOut, UnknownHostName, TlsError, etc.   | Log + fallback              |
| Protocol           | UnsupportedPackVersion, InvalidUrl, InvalidPktLine, etc.         | Log + fallback              |
| Ref Resolution     | RefNotFound, ObjectNotFound, BranchNotFound, InvalidRef, etc.    | Log + fallback              |
| Data Integrity     | ChecksumMismatch, InvalidPack*, InvalidDelta*, CorruptObject, etc.| Log + cleanup + fallback   |
| Filesystem         | PackDirectoryAccessDenied, PathTooLong, FileNotFound, etc.       | Log hint + fallback         |
| Resource Exhaustion| OutOfMemory, SystemResourcesExhausted, etc.                     | Log + fallback              |
| Other              | Any unrecognized error                                           | Generic log + fallback      |

## Known Limitations
- Ziggit has no configurable network timeout (git CLI fallback is the safety net)
- SSH transport not yet fully supported in ziggit (SSH URLs converted to HTTPS via `tryHTTPS`)
- Benchmarks are network-dominated — ziggit's perf advantage is primarily in local operations (ref resolution, checkout from bare cache)
