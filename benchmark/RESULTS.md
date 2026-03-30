# Ziggit Integration — E2E Validation Results

**Date:** 2026-03-30
**System:** Linux x86_64, Intel Xeon @ 3.00GHz, 16GB RAM
**Kernel:** 6.1.141

## Commit Hashes

| Component | Commit | Branch |
|-----------|--------|--------|
| bun-fork | `1e2def0fcc2e807e41c18bb3cf767d86cfda214a` | `ziggit-integration` |
| ziggit | `55f44f6ab0fd5434f6d2262e7f27855ff0fca8f5` | `master` |
| stock bun | `1.3.11 (af24e281)` | release |

## Test Setup

```json
{
  "name": "ziggit-e2e-test",
  "dependencies": {
    "debug": "git+https://github.com/debug-js/debug.git",
    "chalk": "git+https://github.com/chalk/chalk.git",
    "semver": "git+https://github.com/npm/node-semver.git",
    "express": "git+https://github.com/expressjs/express.git"
  }
}
```

All 4 top-level dependencies use `git+https://` protocol, forcing git protocol resolution (not npm tarball).
68 total packages installed (including transitive deps).

## strace Proof: Zero Git CLI Calls

```
$ grep -ac '/usr/bin/git' /tmp/strace-output.txt
0
```

**Result: 0 execve calls to `/usr/bin/git`** — ziggit handles all git operations in-process via the native Zig library linked into bun. No subprocess fallback occurred.

## Timing Comparison

> **Note:** The ziggit bun binary is a **debug build** (`bun-debug`, 1.3GB) with verbose syscall tracing enabled (`[sys]` log lines on every syscall). This adds significant overhead — the numbers below reflect debug instrumentation cost, not production performance.

### Stock Bun (release, v1.3.11)

| Run | bun-reported | wall clock |
|-----|-------------|------------|
| 1 | 536ms | 0.541s |
| 2 | 522ms | 0.531s |
| 3 | 443ms | 0.448s |
| **avg** | **500ms** | **0.507s** |

### Ziggit Bun (debug build, v1.3.11-debug)

| Run | bun-reported | wall clock |
|-----|-------------|------------|
| 1 | 1.66s | 1.876s |
| 2 | 1.65s | 1.859s |
| 3 | 1.51s | 1.724s |
| **avg** | **1.61s** | **1.82s** |

### Analysis

The debug build is ~3.2x slower than stock release bun, which is expected given:
1. **Debug build** — no optimizations, full assertions, 1.3GB binary
2. **Verbose syscall tracing** — every `[sys]` log line is a write to stderr
3. Stock bun uses optimized release build with git CLI subprocess calls

The critical result is **zero git CLI fallbacks** — all git operations (clone, ref resolution, tree walking) are handled entirely in-process by ziggit's native Zig implementation.

## Installed Packages

All 4 git dependencies resolved correctly:
```
+ chalk@github:chalk/chalk#aa06bb5
+ debug@github:debug-js/debug#6704cea
+ express@github:expressjs/express#6c4249f
+ semver@github:npm/node-semver#6946fef
```

68 packages installed successfully with lockfile saved.
