# Bun CI Optimization Report

**Generated:** 2026-03-25
**Current state:** ~35-42 min on main, ~180 min on PRs
**Target:** <15 min on main, <30 min on PRs

---

## Executive Summary

Bun's CI is architected well (parallel cpp/zig builds, dynamic pipeline generation, prebuilt WebKit) but deployed in a way that defeats most of its own optimizations: **ccache and the Zig cache are wiped between every build** because their directories live inside the git checkout that `git clean -ffxdq` nukes. Meanwhile, **windows-aarch64 builds Zig natively on slow Azure ARM64** (23-25 min) when Zig can cross-compile from the existing Linux host in ~12 min, and **Linux links run full LTO on every PR** (13-15 min) when PRs don't need release-grade binaries. Fixing just these three issues — cache persistence, Windows Zig cross-compilation, and PR-only LTO skip — would cut main-branch builds from ~38 min to ~15 min and cost almost nothing to implement. PR builds are a separate disaster: darwin test agents are so scarce that tests don't even _start_ for 80+ minutes; the fix is reducing darwin platform count on PRs (4→1) and letting merge-queue be the safety net.

---

## How CI Works Today

### Pipeline generation

The static entry point is `/Users/alistair/code/bun/.buildkite/bootstrap.yml` (17 lines). It runs `node .buildkite/ci.mjs` on a `build-darwin` agent, which generates the real pipeline as YAML and uploads it via `buildkite-agent pipeline upload`. The generator (`/Users/alistair/code/bun/.buildkite/ci.mjs`, 1427 lines) inspects the commit message, branch, and PR files to decide what to build.

### Build graph (per platform)

Each of the **12 build platforms** (darwin×2, linux-glibc×4, linux-musl×3, windows×3) generates a 3-step fan-in:

```
build-cpp ──┐
            ├──→ build-bun ──→ [verify-baseline] ──→ release
build-zig ──┘
```

- **build-cpp** — Compiles 542 C++ files + 18 vendored deps into `libbun.a`. Runs on c7i.4xlarge/c8g.4xlarge (16 vCPU). Downloads ~200MB WebKit prebuilt tarball fresh every time.
- **build-zig** — Runs `zig build obj` to produce `bun-zig.o`. All non-Windows targets **cross-compile from a single Linux-aarch64-musl r8g.large host** (2 vCPU!). Windows builds natively on Azure. 35-min timeout.
- **build-bun** — Downloads artifacts from both siblings, links with `-flto=full` on Linux (13-15 min). Runs on r7i.xlarge/r8g.xlarge.
- **verify-baseline** — QEMU/SDE instruction scanning for baseline targets. ~1 min.

### What's wrong with the build

`/Users/alistair/code/bun/scripts/build/config.ts:412` sets `cacheDir = ${buildDir}/cache` — **inside the git checkout**. Between every build, Buildkite runs `git clean -ffxdq` (noted in `cmake/tools/SetupBuildkite.cmake:25`), wiping:

- ccache dir (`${cacheDir}/ccache`)
- Zig local+global cache (`${cacheDir}/zig/`)
- WebKit prebuilt tarball (`${cacheDir}/webkit-*`)
- 18 vendored dep tarballs (`${cacheDir}/tarballs/`)
- Zig compiler download (`vendor/zig/`)

**Every single build starts from absolute zero.** The ccache configuration, the `-ffile-prefix-map` path normalization, the identity-stamp caching — all of it exists, none of it works. Adding insult to injury, `CCACHE_SLOPPINESS` is gated behind `!cfg.ci` (`scripts/build/configure.ts:174`) with a stale "FIXME: Ubuntu 18.04" comment — base images are now AL2023/Alpine 3.23.

There's also an IAM instance profile named `buildkite-build-agent` attached for "S3 build cache access" (`scripts/machine.mjs:484`) — **but nothing consumes it**. Someone planned an S3 ccache backend and never wired it up.

### Test execution

Tests only run on **non-main branches** (PRs + merge queue). 17 test platforms × variable sharding = **~232 test agents per PR**:

- darwin: 2 shards × 4 platforms = 8 agents
- linux: 20 shards × 10 platforms = 200 agents
- windows: 8 shards × 3 platforms = 24 agents

Sharding is naive modulo (`scripts/runner.node.mjs:1876-1880`): `index % maxShards === shardId` on alphabetically sorted tests. Integration tests cluster alphabetically into the same shards, so shard times are wildly uneven. Within each shard, tests run **strictly sequentially** (`pLimit(1)`) even though the `--parallel` flag exists and is fully wired — CI just doesn't pass it.

### Release (main branch only)

- **windows-sign** — Depends on ALL 3 windows-\*-build-bun. Loops through 6 zips sequentially in `/Users/alistair/code/bun/.buildkite/scripts/sign-windows-artifacts.ps1:263`. Signing can't start until the slowest Windows build (aarch64, ~25 min) finishes.
- **release** — Depends on windows-sign + all non-windows build-bun. Runs `/Users/alistair/code/bun/.buildkite/scripts/upload-release.sh` which processes 22 zips in a sequential for-loop with a `wait` inside each iteration. ~4m15s.

---

## Where the 45 Minutes Go

### Main-branch critical path (35-42 min measured)

Two competing chains, roughly equal:

**Path A (usually wins — 33-38 min):**

```
pipeline-gen (25s)
  → windows-aarch64-build-zig (23-25m, native Azure ARM64, cold Zig cache)
  → windows-aarch64-build-bun (2m link)
  → windows-sign (1-6m, sequential 6-zip loop)
  → release (4m15s)
```

**Path B (close second — 31-33 min):**

```
pipeline-gen (25s)
  → linux-aarch64-build-zig (12-14m, cross-compiled on 2-vCPU r8g.large)
  → linux-aarch64-build-bun (14m, full LTO on r8g.xlarge)
  → release (4m15s)
```

### Per-step timings (measured from builds 41920, fe4a66e086)

| Step               | Platform        | Duration   | Notes                                     |
| ------------------ | --------------- | ---------- | ----------------------------------------- |
| build-zig (cold)   | windows-aarch64 | **23-25m** | Native Azure ARM64 — THE bottleneck       |
| build-bun (LTO)    | linux-\*        | **13-15m** | `-flto=full` on ~100MB binary             |
| build-cpp          | darwin-x64      | 12-15m     | Intel Mac, cold ccache                    |
| build-zig (cold)   | linux/darwin    | 11-14m     | Cross-compiled on r8g.large (2 vCPU)      |
| build-cpp          | linux-\*        | 8-12m      | Cold ccache, 18 deps rebuilt              |
| release            | darwin          | 4m15s      | 22 sequential download-upload cycles      |
| build-cpp          | darwin-aarch64  | 3m40s      | Apple Silicon, persistent agent, warm-ish |
| build-bun (no LTO) | windows/darwin  | 1.5-4m     |                                           |
| build-zig (warm)   | all             | 1.5-4m     | When Zig cache hits — rare                |

### PR critical path (180+ min measured)

PR builds are dominated by **darwin test queue contention**. Observed: `darwin-14-x64-test-bun` didn't START until 79.5 min into the build. With only 2 shards per darwin platform and 4 darwin platforms sharing a static Mac pool, any concurrent PR load causes massive queuing.

```
build (35m) → wait for darwin agent (60-130m!) → darwin tests (30m) = 180m
```

Linux tests finish in 5-8 min with 20-way sharding. Windows: 15-19 min with 8-way. Darwin: 29-33 min with 2-way, plus the queue wait.

---

## Top 5 Quick Wins

Ranked by savings-per-effort. All are trivial-to-small effort, low risk.

### 1. Disable full LTO on PR builds ⚡

**Savings:** 10-12 min off PR critical path
**Effort:** Trivial (one conditional)
**Risk:** Low
**Files:** `/Users/alistair/code/bun/.buildkite/ci.mjs:456`

PRs don't need the 2-3% runtime perf from `-flto=full`. Add `if (!isMainBranch()) args.push('--lto=off')` to `getBuildArgs()`. Linux link drops from 14 min to ~2-3 min. Main branch keeps full LTO so release binaries are unchanged. Add `[force lto]` commit flag as escape hatch.

### 2. Cross-compile Windows Zig from Linux ⚡

**Savings:** 18-22 min off main-branch critical path
**Effort:** Small (delete one conditional)
**Risk:** Medium (needs validation that COFF output links cleanly)
**Files:** `/Users/alistair/code/bun/.buildkite/ci.mjs:372` (`getZigAgent()`)

`scripts/build/zig.ts:47` already supports `-target aarch64-windows-msvc`. The native Azure build appears to be a workaround for an SEH bug in the ReleaseSafe compiler _on that host_ — irrelevant if we never run the compiler there. Delete the `if (os === 'windows')` early-return in `getZigAgent()` so Windows targets fall through to the Linux cross-compile host. Test on a branch with `[force builds]`.

### 3. Move cacheDir out of git tree + enable CCACHE_SLOPPINESS

**Savings:** 5-8 min off darwin-x64-build-cpp (persistent agents go cold→warm); prerequisite for S3 cache
**Effort:** Small
**Risk:** Low
**Files:** `scripts/build/config.ts:412`, `scripts/build/configure.ts:174`, `cmake/tools/SetupCcache.cmake:39-45`, `.buildkite/Dockerfile`

Point `cacheDir` at `/var/lib/buildkite-agent/cache/build` via `BUN_CI_CACHE_DIR` env var. Delete the `if (!cfg.ci)` guard on CCACHE_SLOPPINESS. Delete the commented-out "FIXME: Ubuntu 18.04" branch in SetupCcache.cmake. Add `mkdir -p` + `ENV` to Dockerfile. This unblocks ccache, zig cache, WebKit tarball, and dep tarball persistence on persistent agents immediately.

### 4. Collapse darwin test matrix on PRs (4→1)

**Savings:** Reduces darwin queue demand by 75%; 79.5m agent-wait → <10m typical
**Effort:** Trivial (one filter)
**Risk:** Medium (merge-queue becomes the safety net for Intel Mac / macOS 13 bugs)
**Files:** `/Users/alistair/code/bun/.buildkite/ci.mjs:1303`

On PRs, test only `darwin-aarch64-14`. Run all 4 darwin platforms on merge-queue. Add `[full darwin]` commit flag. Intel Mac and macOS 13 bugs are rare enough that merge-queue catches them before they hit main.

```js
const activeTestPlatforms = isMergeQueue()
  ? testPlatforms
  : testPlatforms.filter(
      p => p.os !== "darwin" || (p.arch === "aarch64" && p.release === "14"),
    );
```

### 5. Parallelize release upload + fan out windows-sign

**Savings:** 4-7 min off main-branch critical path (release 4m→1.5m, sign starts 8-10m earlier for x64)
**Effort:** Small
**Risk:** Low
**Files:** `.buildkite/scripts/upload-release.sh:246-248`, `.buildkite/ci.mjs:774-803`

**Release:** Replace sequential `for artifact in ...; do download; upload & wait; done` with batch `buildkite-agent artifact download 'bun-*.zip' .` + fire all 66 uploads + single `wait`.

**Sign:** Generate three `windows-{x64,x64-baseline,aarch64}-sign` steps, each depending only on its own build-bun. x64 signing overlaps with aarch64's Zig compile instead of waiting for it.

---

## Top 5 Big Bets

Higher effort, transformative impact.

### 1. Content-addressed S3 cache for bun-zig.o

**Savings:** 12-25 min off PR critical path on ~70% of PRs (non-Zig changes)
**Effort:** Medium
**Risk:** Low
**Files:** new `scripts/zig-cache-key.ts`, `.buildkite/ci.mjs` `getBuildZigStep()`

Hash the Zig inputs (`git ls-tree HEAD -- src/**/*.zig build.zig*` + zig version + target + profile), check S3 for a cached `bun-zig.o` with that hash. On hit, the 12-25 min Zig step becomes a 10-second download. Populate from main-branch builds. Most PRs touch C++/TS/tests, not Zig — they'd skip Zig compilation entirely.

```sh
aws s3 cp s3://bun-ci-cache/zig-obj/${key}.o bun-zig.o \
  || (bun scripts/build.ts --profile=ci-zig-only ... \
      && aws s3 cp bun-zig.o s3://bun-ci-cache/zig-obj/${key}.o)
```

**Prerequisite:** also fix `build.zig:82` which bakes the git SHA into `build_options` — every commit invalidates the entire Zig cache. Move SHA to a separately-generated file imported only where `bun --version` reads it.

### 2. Wire ccache S3 remote storage

**Savings:** 6-10 min off build-cpp on all 12 platforms
**Effort:** Small (the IAM role already exists!)
**Risk:** Medium (S3 latency on first run)
**Files:** `scripts/build/configure.ts:162-183`, `cmake/tools/SetupCcache.cmake`, S3 bucket creation

`scripts/machine.mjs:484-487` already attaches IAM instance profile `buildkite-build-agent` with comment "enable S3 build cache access" — but nothing consumes it. ccache ≥4.6 supports `remote_storage = s3://bucket/prefix` natively. Every ephemeral EC2 agent currently compiles 542 C++ files + 18 deps from scratch. With S3-backed ccache, the second PR touching the same source tree gets ~90% hit rate.

### 3. Duration-weighted test sharding

**Savings:** 8-15 min off PR test wall-clock
**Effort:** Medium
**Risk:** Low
**Files:** `scripts/runner.node.mjs:1876-1880`, `scripts/buildkite-slow-tests.js`, new `test/test-durations.json`

Replace modulo sharding with greedy bin-packing (longest-processing-time-first). `scripts/buildkite-slow-tests.js` already exists to collect timing data — just wire it to emit JSON, commit it, and have the runner use it. Slowest Linux shard drops from ~15 min outlier to ~8 min mean. Bigger win on darwin where 2 shards amplify imbalance.

### 4. Auto-skip builds for test-only PRs

**Savings:** 25-30 min off critical path on ~7% of PRs (entire compile phase disappears)
**Effort:** Small
**Risk:** Medium (need reliable artifact fallback to main branch)
**Files:** `.buildkite/ci.mjs:1399`, `scripts/utils.mjs:1336`

7% of commits touch only `test/**`. The `[skip build]` directive already exists and triggers `getLastSuccessfulBuild()` artifact reuse — but it's manual. Auto-detect test-only changesets and set `options.skipBuilds = true`. Modify `getLastSuccessfulBuild()` to fall back to main branch's latest passing build when `prev_branch_build` is null.

### 5. Path-based platform matrix reduction

**Savings:** Eliminates ~70% of compute on narrow PRs; massively reduces queue contention
**Effort:** Medium
**Risk:** Medium
**Files:** `.buildkite/ci.mjs:1360-1399`

`changedFiles` is already fetched from GitHub but only used for docs-only skip. Extend it: if a PR touches only `test/**` + `src/js/**` (pure JS/TS), build+test only 3 canary platforms (linux-x64, darwin-aarch64, windows-x64). If only `src/bun.js/bindings/**` (C++), skip musl + baseline variants. Merge queue always runs full matrix. Add `[full ci]` escape hatch.

---

## Full Proposal List

### Build caching (the structural fix)

| Proposal                                          | Savings                          | Effort  | Risk | Files                                                       |
| ------------------------------------------------- | -------------------------------- | ------- | ---- | ----------------------------------------------------------- |
| Move cacheDir out of git tree + CCACHE_SLOPPINESS | 5-8m darwin; unblocks everything | small   | low  | `config.ts:412`, `configure.ts:174`, `SetupCcache.cmake:40` |
| Wire ccache S3 remote (IAM role exists)           | 6-10m × 12 platforms             | small   | med  | `configure.ts:162`, new S3 bucket                           |
| Persist Zig global cache via S3 tarball           | 8-12m zig steps                  | med     | med  | `zig.ts:144`, `ci.mjs` hooks                                |
| Isolate git SHA from Zig build_options            | Multiplier on Zig cache          | small   | low  | `build.zig:82`                                              |
| Pre-bake WebKit + dep tarballs into AMI           | 1-3m × 12 platforms              | small   | low  | `.buildkite/Dockerfile`, `fetch-cli.ts`                     |
| Cache verify-baseline Rust binary                 | 2-3m × 3 targets                 | trivial | low  | `ci.mjs:666`                                                |
| Mirror Intel SDE to S3                            | 1-2m windows-verify              | trivial | low  | `ci.mjs:644`                                                |
| Stop destroying cacheDir mid-build                | Enables warm ccache              | trivial | low  | `ci.ts:264`, `Globals.cmake:503`                            |
| Switch Linux release link to ThinLTO              | 8-10m linux link                 | trivial | med  | `CompilerFlags.cmake:272`                                   |
| Content-addressed dep lib S3 cache                | 4-7m build-cpp                   | med     | low  | `source.ts`                                                 |

### Pipeline parallelization

| Proposal                                           | Savings                   | Effort  | Risk | Files                                       |
| -------------------------------------------------- | ------------------------- | ------- | ---- | ------------------------------------------- |
| Fan out windows-sign into 3 per-arch steps         | 3-5m main critical path   | small   | low  | `ci.mjs:774-803`                            |
| Parallelize upload-release.sh                      | 2-3m release step         | trivial | low  | `upload-release.sh:246`                     |
| Per-platform release upload fan-out                | 2-4m main critical path   | med     | med  | `ci.mjs:811-836`, split `upload-release.sh` |
| Bump Zig cross-compile host r8g.large→2xlarge      | 4-7m zig steps            | trivial | low  | `ci.mjs:384`                                |
| Enable intra-shard test parallelism (`--parallel`) | 10-15m darwin, 3-5m linux | small   | med  | `ci.mjs:717`, `runner.node.mjs:430`         |
| Duration-weighted test sharding                    | 8-15m test wall-clock     | med     | low  | `runner.node.mjs:1876`                      |
| Pipeline download+sign phases in sign ps1          | 1-2m windows-sign         | trivial | low  | `sign-windows-artifacts.ps1:263`            |
| Move verify-baseline off r-series agents           | Frees link-agent pool     | trivial | low  | `ci.mjs:660`                                |

### Skip/conditional logic

| Proposal                                         | Savings                                | Effort  | Risk | Files                                     |
| ------------------------------------------------ | -------------------------------------- | ------- | ---- | ----------------------------------------- |
| Wire up existing `isDocumentation()` helper      | Full skip on ~12% of PRs               | trivial | low  | `ci.mjs:1395`, `utils.mjs:1105`           |
| Auto-skip builds for test-only PRs               | 25-30m on ~7% of PRs                   | small   | med  | `ci.mjs:1399`, `utils.mjs:1336`           |
| Fix 500-file pagination cap (use compare API)    | Correctness + 2-3s                     | trivial | low  | `ci.mjs:1367-1390`, `utils.mjs:1084`      |
| Add path filters to GHA lint.yml/format.yml      | 2-3m GHA per docs PR                   | trivial | low  | `.github/workflows/{lint,format}.yml`     |
| Skip verify-baseline when no native code changed | 1-2m on ~15-20% of PRs                 | small   | low  | `ci.mjs:612`                              |
| Tiered test matrix for low-risk changes          | 30-60m when darwin contended           | small   | med  | `ci.mjs:1304` (tier field exists, unused) |
| [sign windows] + [skip build] combo              | ~25m when iterating on release tooling | small   | low  | `ci.mjs:1316-1322`                        |

### Test execution

| Proposal                                          | Savings                                  | Effort  | Risk | Files                                         |
| ------------------------------------------------- | ---------------------------------------- | ------- | ---- | --------------------------------------------- |
| Bump darwin sharding 2→6 + skip OS-agnostic tests | 15-25m PR critical path                  | med     | med  | `ci.mjs:710`, new `test/darwin-skip-dirs.txt` |
| Tiered Linux matrix (defer distro dupes to MQ)    | 20 agent-hours/PR, less queue contention | small   | low  | `ci.mjs:1300`                                 |
| Fast-fail canary job before 232-agent fanout      | ~50 agent-hours on red PRs               | med     | low  | `ci.mjs`, `runner.node.mjs --smoke` (exists)  |
| Reduce flaky-retry backoff 5-15s → 1/2/4s         | 1-4m per shard with flakes               | trivial | low  | `runner.node.mjs:446`                         |
| Source-to-test path mapping (selective exec)      | 50-80% test reduction on focused PRs     | large   | high | new `test/path-map.json`, `runner.node.mjs`   |

### Artifact & dependency transfer

| Proposal                                             | Savings                          | Effort  | Risk | Files                              |
| ---------------------------------------------------- | -------------------------------- | ------- | ---- | ---------------------------------- |
| Skip WebKit lib re-upload (fetch direct in link)     | 2-4m link + 2-3m cpp upload      | small   | low  | `ci.ts:244-251`, `download.ts:168` |
| Replace gzip -1 with zstd -3, compress bun-zig.o     | 1-2m upload + 1-2m download × 12 | trivial | low  | `ci.ts:276,231,271,497`            |
| Parallelize artifact downloads in link-only          | 30-90s × 11 platforms            | trivial | low  | `ci.ts:490-494`                    |
| Narrow test-shard download from `**` to specific zip | 5GB less transfer/build          | trivial | low  | `runner.node.mjs:1970`             |
| Bundle dep libs into single compressed tarball       | 30-60s upload + download         | small   | low  | `ci.ts:243-251`                    |

### Aggressive/unconventional

| Proposal                                        | Savings                                      | Effort  | Risk | Files                               |
| ----------------------------------------------- | -------------------------------------------- | ------- | ---- | ----------------------------------- |
| Cross-compile Windows Zig from Linux            | 18-22m main critical path                    | small   | med  | `ci.mjs:372`                        |
| Content-addressed S3 cache for bun-zig.o        | 12-25m on ~70% of PRs                        | med     | low  | new `scripts/zig-cache-key.ts`      |
| Disable full LTO on PR builds                   | 10-12m PR critical path                      | trivial | low  | `ci.mjs:456`                        |
| Batch all 9 non-Windows Zig into one mega-job   | 5-8m + 70% less CPU-hours                    | med     | med  | `ci.mjs` `getBuildZigStep()`        |
| Collapse darwin test matrix on PRs (4→1)        | 75% less darwin queue demand                 | trivial | med  | `ci.mjs:1303`                       |
| Two-tier PR CI (5-min smoke before full matrix) | ~90% compute on red PRs                      | med     | low  | `ci.mjs`, `runner.node.mjs --smoke` |
| Speculative link with cached zig.o              | Removes Zig from critical path on 70% of PRs | large   | high | requires S3 zig cache first         |

---

## Suggested Implementation Order

### Phase 0: One-liners (do today, <1 hour total)

1. **Disable LTO on PRs** — `ci.mjs:456` add `if (!isMainBranch()) args.push('--lto=off')`
2. **Bump Zig host r8g.large → r8g.2xlarge** — `ci.mjs:384` change instance type
3. **Reduce flaky-retry backoff** — `runner.node.mjs:446` change sleep to `1000 * (2 ** (attempt-2))`
4. **Narrow test-shard artifact download** — `runner.node.mjs:1970` change `**` to `bun-*-profile.zip`
5. **Wire up `isDocumentation()` helper** — `ci.mjs:1395` replace `startsWith('docs/')` with existing helper
6. **Add path filters to GHA lint/format** — `.github/workflows/{lint,format}.yml` add `paths-ignore`

**Expected result:** PR build drops from ~35m to ~22m (LTO skip alone is 10-12m). Docs-only PRs skip entirely.

### Phase 1: Cache foundation (1-2 days)

7. **Move cacheDir out of git tree** — `config.ts:412`, `configure.ts:174`, `SetupCcache.cmake`, `Dockerfile`
8. **Stop destroying cacheDir mid-build** — `ci.ts:264`, `Globals.cmake:503`
9. **Isolate git SHA from Zig build_options** — `build.zig:82` move to generated file
10. **zstd compression for artifacts** — `ci.ts:276,231,271,497`
11. **Parallelize artifact downloads in link-only** — `ci.ts:490-494`

**Expected result:** Persistent darwin agents go warm. Foundation for S3 cache.

### Phase 2: Critical-path attack (2-3 days)

12. **Cross-compile Windows Zig from Linux** — `ci.mjs:372` delete early-return, test on branch
13. **Fan out windows-sign to 3 steps** — `ci.mjs:774-803`
14. **Parallelize upload-release.sh** — `upload-release.sh:246`
15. **Wire ccache S3 remote** — create bucket, `configure.ts:162`, verify ccache ≥4.6
16. **Skip WebKit lib re-upload** — `ci.ts:244-251`

**Expected result:** Main-branch critical path drops from 33-38m to ~15-18m. Linux LTO link becomes the new bottleneck (addressed by Phase 0 LTO skip on PRs, ThinLTO on main if desired).

### Phase 3: PR test latency (3-5 days)

17. **Collapse darwin test matrix on PRs (4→1)** — `ci.mjs:1303` filter
18. **Enable intra-shard `--parallel`** — `ci.mjs:717`, triage flakes
19. **Duration-weighted test sharding** — `buildkite-slow-tests.js` → JSON → `runner.node.mjs:1876`
20. **Auto-skip builds for test-only PRs** — `ci.mjs:1399`, `utils.mjs:1336` fallback
21. **Tiered Linux matrix (defer distro dupes)** — `ci.mjs:1300` use existing `tier` field

**Expected result:** PR test wall-clock drops from 180m to ~30-40m. Darwin queue contention resolved.

### Phase 4: Structural optimizations (1-2 weeks)

22. **Content-addressed S3 cache for bun-zig.o** — biggest remaining win for non-Zig PRs
23. **Path-based platform matrix reduction** — classifier in `ci.mjs`
24. **Persist Zig global cache via S3 tarball** — complements #22
25. **Pre-bake WebKit + deps into AMI** — `Dockerfile` + `fetch-cli.ts --prefetch-only`
26. **Fast-fail canary job** — two-tier pipeline with `--smoke` mode
27. **Content-addressed dep lib cache** — skip rebuilding unchanged vendored deps

**Expected result:** Typical PR (non-Zig change) builds in <15 min end-to-end.

### Not recommended (yet)

- **Speculative link** — too complex, do S3 zig cache first and see if it's still needed
- **Source-to-test path mapping** — high risk of false negatives, needs a week of tuning before trustworthy
- **ThinLTO on main** — only if benchmarks show <2% regression; full LTO is fine for the binary users actually download

---

## Dead Code to Delete While You're In There

- `scripts/utils.mjs:1105` `isDocumentation()` — fully written, never called (wire it up instead per Phase 0)
- `scripts/utils.mjs:1084` `getChangedFiles()` — cleaner than inline fetch in `ci.mjs:1367`, never imported
- `ci.mjs:1365,1386-1387` `newFiles` array — computed, logged, never used
- `cmake/tools/SetupCcache.cmake:39-45` "FIXME: Ubuntu 18.04" commented-out branch — base images are AL2023 now

---

## Summary Table: Expected End State

| Metric                   | Today              | After Phase 0-1 | After Phase 2 | After Phase 3        | After Phase 4 |
| ------------------------ | ------------------ | --------------- | ------------- | -------------------- | ------------- |
| Main-branch build        | 35-42m             | 35-42m          | **15-18m**    | 15-18m               | 12-15m        |
| PR build (critical path) | ~35m               | **~22m**        | ~18m          | ~18m                 | ~12m          |
| PR test wall-clock       | 180m               | 180m            | 180m          | **30-40m**           | 20-30m        |
| Test-only PR             | ~35m build + tests | ~22m            | ~18m          | **~5m** (skip build) | ~5m           |
| Docs-only PR             | full build (~12%)  | **skip**        | skip          | skip                 | skip          |
