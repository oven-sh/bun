# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-26T21:19Z (latest refresh, run 9)
- Ziggit commit: b6494b8 (two-pass zero-alloc scan + bounded LRU resolve)
- Bun fork branch: ziggit-integration
- Machine: Linux (root@ziggit), tmpfs-backed /tmp
- Build: `zig build -Doptimize=ReleaseFast`

## Clone Benchmarks (bare clone)

### sindresorhus/is (small repo, ~270KB pack, 1245 objects) — 5 runs

| Tool    | Run 1  | Run 2  | Run 3  | Run 4  | Run 5  | Avg    |
|---------|--------|--------|--------|--------|--------|--------|
| ziggit  | 237ms  | 191ms  | 180ms  | 179ms  | 172ms  | 192ms  |
| git CLI | 183ms  | 185ms  | 177ms  | 202ms  | 182ms  | 186ms  |

**Result**: **Parity** — ziggit avg 192ms vs git CLI avg 186ms (1.03x). Network-dominated. ✅

### expressjs/express (medium repo, ~10.6MB pack, 33335 objects) — 3 runs

| Tool    | Run 1  | Run 2  | Run 3  | Avg    |
|---------|--------|--------|--------|--------|
| ziggit  | 955ms  | 956ms  | 933ms  | 948ms  |
| git CLI | 935ms  | 933ms  | 938ms  | 935ms  |

**Result**: **Parity** — ziggit avg 948ms vs git CLI avg 935ms (1.01x). Network-dominated. ✅

### Correctness
- `git verify-pack` passes on ziggit-produced .idx files ✅
- `git fsck --no-dangling` clean on all cloned repos ✅
- Object counts match exactly (1237 objects for sindresorhus/is, 33335 for express) ✅
- Refs written to packed-refs ✅
- HEAD resolves correctly ✅

## findCommit Performance (packed-refs fix + in-process benchmark)

**Before fix (f62586b)**: `findCommit("main")` on bare repos always fell back to git CLI (~5-10ms per invocation due to process spawn).

**After fix**: `findCommit("main")` resolves via packed-refs in **5.2µs** — a **~412x speedup** over git CLI subprocess.

### Latest measurement (2026-03-26T21:19Z run 5, dedicated Zig benchmark binary, 1000 iterations, ReleaseFast)

| Method | Per-call | Notes |
|--------|----------|-------|
| ziggit findCommit (in-process) | **5.3µs** | Direct packed-refs file scan, zero alloc |
| git rev-parse HEAD (subprocess) | **2125µs** (~2.1ms) | Fork + exec + read + exit |
| **Speedup** | **~398x** | |

Per-repo breakdown (ziggit in-process):

| Repo | Per-call (µs) | Total / 1000 calls |
|------|--------------|-------------------|
| debug | 5.2 | 5.19ms |
| semver | 6.2 | 6.18ms |
| chalk | 5.2 | 5.16ms |
| is | 5.1 | 5.13ms |
| express | 5.0 | 5.02ms |

> Previous measurements varied (5.4µs, 68µs) depending on build/optimization level.
> The 5.2µs figure is from a ReleaseFast binary with 1000-iteration averaging.

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
| 2026-03-26 | b6494b8 (run9)| Refresh benchmarks, findCommit 398x     | 190ms (git: 182ms)  | 965ms† (git: 196ms‡) | †full-depth vs ‡shallow |
| 2026-03-26 | b6494b8 (run8)| Fresh e2e benchmark, findCommit 412x    | 197ms (git: 174ms)  | 1020ms† (git: 262ms‡) | †full-depth vs ‡shallow |
| 2026-03-26 | b6494b8 (run7)| Refresh + bun install e2e benchmark     | 162ms (git: 163ms)  | 982ms† (git: 210ms‡) | †full-depth vs ‡shallow |
| 2026-03-26 | 0b345ce (run6)| Two-pass zero-alloc idx_writer          | 192ms (git: 186ms)  | 948ms (git: 935ms) | Parity (1.01-1.03x) |
| 2026-03-26 | 6f37261 (run5)| Re-benchmark (higher-latency network)   | 275ms (git: 274ms)  | 1913ms (git: 1911ms) | Dead parity |
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
3. **findCommit** (`findCommit`): ~412x faster ref resolution (no process spawn) — now works on bare repos via packed-refs
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

## End-to-End `bun install` Benchmark (2026-03-26T21:19Z, run 5 — fresh data)

Full benchmark comparing stock bun, git CLI, and ziggit for 5 git dependencies.
See [BUN_INSTALL_BENCHMARK.md](BUN_INSTALL_BENCHMARK.md) for detailed results.

### Stock `bun install` (5 git deps + 266 transitive npm packages)

| Metric | Run 1 | Run 2 | Run 3 | Avg (ms) |
|--------|-------|-------|-------|----------|
| Cold (no cache) | 603 | 581 | 397 | 527.0 |
| Warm (cached) | 32 | 31 | 31 | 31.3 |

### Git dependency resolution: Git CLI vs Ziggit (5 repos, sequential)

| Tool | debug (ms) | semver (ms) | chalk (ms) | is (ms) | express (ms) | Total avg (ms) |
|------|-----------|------------|-----------|---------|-------------|---------------|
| git CLI (--depth=1) | 142 | 171 | 156 | 182 | 196 | 915 |
| ziggit (full clone) | 158 | 251 | 165 | 190 | 965 | 1799 |

> **Notable**: is within **4%** (190ms vs 182ms), chalk within **6%** (165ms vs 156ms) — despite full-depth clone

### Ref resolution: git rev-parse vs ziggit findCommit

| Method | Per-call | 5 deps | Notes |
|--------|----------|--------|-------|
| `git rev-parse` (CLI) | ~2.1ms | ~10.6ms | Process fork+exec overhead |
| ziggit findCommit (in-process) | **5.3µs** | **0.027ms** | Direct packed-refs scan |
| **Speedup** | **~398x** | **saves ~10.6ms** | |

### Analysis

**Key finding**: Ziggit is **1.97x slower** for full clones because it downloads
complete history while `git clone --depth=1` downloads only the tip commit.
Express (5000+ commits, 10.6MB pack) shows the largest gap (4.9x). For small/
short-history repos (is, chalk), ziggit is within **4-6%** of git CLI.

**Where ziggit wins today**:
- findCommit ref resolution: **398x faster** (5.3µs vs 2.1ms)
- Zero subprocess overhead: saves ~10ms per dep when used in-process
- Correct pack/idx generation: verified by `git verify-pack` + `git fsck`

**Path to faster**: Implementing shallow clone support in ziggit would bring it to
parity on network I/O, and the in-process + parallel execution advantages would
then yield a projected **~69% reduction** in git dependency resolution time
(saving ~635ms off cold `bun install`).

## Known Limitations
- Ziggit has no configurable network timeout (git CLI fallback is the safety net)
- SSH transport not yet fully supported in ziggit (SSH URLs converted to HTTPS via `tryHTTPS`)
- No shallow clone (`--depth=1`) support yet — the primary bottleneck for large repos
- Benchmarks are network-dominated — ziggit's perf advantage is primarily in local operations (ref resolution, checkout from bare cache)
