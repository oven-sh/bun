# Ziggit E2E Validation: `bun install` with Git Dependencies

**Date:** 2026-03-30
**System:** Linux x86_64, 4 cores, 16GB RAM, kernel 6.1.141

## Commit Hashes

| Component | Commit |
|-----------|--------|
| bun-fork  | `8776bea18` (ziggit-integration branch) |
| ziggit    | `55f44f6` |

## Test Setup

```json
{
  "dependencies": {
    "debug": "git+https://github.com/debug-js/debug.git",
    "chalk": "git+https://github.com/chalk/chalk.git",
    "semver": "git+https://github.com/npm/node-semver.git",
    "express": "git+https://github.com/expressjs/express.git"
  }
}
```

All 4 top-level dependencies use `git+https://` protocol (forces git protocol, not tarball).
68 total packages installed (including transitive deps).

## Strace Proof: Zero Git CLI Calls

```
$ strace -f -e trace=execve -o /tmp/strace-clean.txt bun-debug install
$ wc -l /tmp/strace-clean.txt
10 /tmp/strace-clean.txt

$ grep -i 'git' /tmp/strace-clean.txt
(none)

$ cat /tmp/strace-clean.txt
67990 execve("/root/bun-fork/build/debug/bun-debug", [...]) = 0
67998 +++ exited with 0 +++
67997 +++ exited with 0 +++
... (7 worker threads exit)
67990 +++ exited with 0 +++
```

**Result: 0 git CLI subprocess calls.** All git operations (clone, ref resolution, checkout)
handled natively by ziggit's built-in Zig implementation.

## Timing Comparison

All runs: cold cache (`rm -rf node_modules bun.lock ~/.bun/install/cache`), `--no-progress`.

Note: bun-fork is a **debug build** (1.3GB binary with syscall tracing), so times are not
representative of release performance. Stock bun is a release build.

| Run | Stock Bun 1.3.11 (release) | Ziggit Bun (debug build) |
|-----|---------------------------|--------------------------|
| 1   | 378ms                     | 8890ms (strace run)      |
| 2   | 415ms                     | 1580ms                   |
| 3   | 431ms                     | 1803ms                   |
| 4   | —                         | 1973ms                   |
| 5   | —                         | 1769ms                   |
| **Avg (non-strace)** | **~408ms** | **~1781ms** |

### Analysis

- The debug build is ~4.4x slower than stock bun's release build, which is expected for
  an unoptimized debug binary with full syscall logging enabled.
- **The critical validation is the strace proof: zero git CLI fallbacks.**
- All 4 git+https dependencies resolved and installed successfully with 68 total packages.
- A release build of the fork would be needed for fair performance comparison.

## Packages Installed

```
+ chalk@github:chalk/chalk#aa06bb5
+ debug@github:debug-js/debug#6704cea
+ express@github:expressjs/express#6c4249f
+ semver@github:npm/node-semver#6946fef

68 packages installed
```
