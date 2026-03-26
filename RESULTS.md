# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-26 (latest refresh, run 4)
- Ziggit commit: 6f37261 (single-pass idx_writer with eager LRU caching)
- Bun fork branch: ziggit-integration
- Machine: Linux (root@ziggit), tmpfs-backed /tmp
- Build: `zig build -Doptimize=ReleaseFast`

## Clone Benchmarks (bare clone)

### sindresorhus/is (small repo, ~270KB pack) — 5 runs

| Tool    | Run 1  | Run 2  | Run 3  | Run 4  | Run 5  | Avg    |
|---------|--------|--------|--------|--------|--------|--------|
| ziggit  | 193ms  | 176ms  | 184ms  | 192ms  | 178ms  | 185ms  |
| git CLI | 189ms  | 180ms  | 180ms  | 181ms  | 195ms  | 185ms  |

**Result**: **Dead parity** — ziggit avg 185ms vs git CLI avg 185ms (1.00x). Network-dominated. ✅

### expressjs/express (medium repo, ~6MB pack) — 3 runs

| Tool    | Run 1  | Run 2  | Run 3  | Avg    |
|---------|--------|--------|--------|--------|
| ziggit  | 961ms  | 967ms  | 924ms  | 951ms  |
| git CLI | 932ms  | 948ms  | 928ms  | 936ms  |

**Result**: **Parity** — ziggit avg 951ms vs git CLI avg 936ms (1.02x). Network-dominated. ✅

### Correctness
- `git verify-pack` passes on ziggit-produced .idx files ✅
- `git fsck --no-dangling` clean on all cloned repos ✅
- Object counts match exactly (1237 objects for sindresorhus/is, 33335 for express) ✅
- Refs written to packed-refs ✅
- HEAD resolves correctly ✅

## findCommit Performance (packed-refs fix)

**Before fix (f62586b)**: `findCommit("main")` on bare repos always fell back to git CLI (~5-10ms per invocation due to process spawn).

**After fix**: `findCommit("main")` resolves via packed-refs in **68µs** — a **~100x speedup** over git CLI fallback.

| Method          | Time     | Notes                                    |
|-----------------|----------|------------------------------------------|
| ziggit (native) | ~68µs    | Direct packed-refs file scan, no spawn   |
| git CLI         | ~5-10ms  | `git log --format=%H -1 main` via exec   |

This is critical for bun's integration because `findCommit` is called for every git dependency during `bun install`.

## Edge Case Testing

| Scenario                  | Test Command                                                    | Result                                      |
|---------------------------|-----------------------------------------------------------------|---------------------------------------------|
| Repo not found (HTTPS)    | `clone --bare https://github.com/.../nonexistent.git`          | Exits 128, "could not read Username" ✅     |
| Invalid host / DNS fail   | `clone --bare https://bad-host.example.com/repo.git`           | Exits 128, "Could not resolve host" (19ms) ✅|
| SSH without keys          | `clone --bare git@github.com:user/repo.git`                    | Exits 128, "Host key verification failed" ✅ |
| Normal HTTPS clone        | `clone --bare https://github.com/sindresorhus/is.git`          | Success, fsck clean ✅                       |

## Benchmark History

| Date       | Ziggit Commit | Change                                  | sindresorhus/is avg | express avg | Notes |
|------------|---------------|-----------------------------------------|---------------------|-------------|-------|
| 2026-03-26 | 6f37261 (run4)| Re-benchmark (latest idx_writer)        | 185ms (git: 185ms)  | 951ms (git: 936ms) | Dead parity |
| 2026-03-26 | 6f37261 (run3)| Single-pass with eager LRU caching      | 199ms (git: 200ms)  | — | Parity |
| 2026-03-26 | f62586b       | packed-refs fix for bare repos          | 193ms (git: 192ms)  | — | findCommit now 100x faster |
| 2026-03-26 | b49999c       | Two-pass with DeltaCache                | 300ms               | — | 1.01x |
| 2026-03-26 | eeba670       | Single-pass architecture                | 194ms               | — | ~1.0x |
| Earlier    | (pre-rewrite) | Original multi-pass                     | ~4x slower          | — | ~4x   |

*Note: Absolute times vary by network conditions; the ratio is what matters. These are network-dominated benchmarks — ziggit's advantage shows in local operations (findCommit is ~100x faster than spawning git CLI).*

## Integration Architecture

Ziggit is used as the **primary** transport for git dependencies in `bun install`:

1. **Clone** (`cloneBare`): HTTPS preferred (via `tryHTTPS`), falls back to git CLI on failure
2. **Fetch** (`open` + `fetch`): Updates existing cached repos
3. **findCommit** (`findCommit`): ~100x faster ref resolution (no process spawn) — now works on bare repos via packed-refs
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
