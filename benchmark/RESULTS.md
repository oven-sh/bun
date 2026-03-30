# Ziggit E2E Validation: `bun install` with Git Dependencies

## Date
2026-03-30

## System Info
- **Kernel:** Linux 6.1.141 x86_64
- **CPUs:** 4
- **Memory:** 15Gi total
- **Build type:** debug (bun-debug, 1.3GB)

## Commits
- **ziggit:** `55f44f6` (wasm: add line numbers in file viewer, submodule support, improved tree sorting)
- **bun-fork:** `8a42d50b8` (ziggit-integration branch)
- **stock bun:** v1.3.11 (af24e281)

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

All 4 top-level dependencies use `git+https://` protocol, forcing the git code path (not tarball download). 68 total packages installed (including transitive deps from npm).

## strace Proof: Zero Git CLI Calls

```
$ grep -ac 'execve.*"/usr/bin/git"' /tmp/strace-output.txt
0
```

**CONFIRMED: Zero `git` subprocess execve calls.** All git operations (clone, ref resolution, checkout) handled entirely by ziggit's in-process Zig implementation.

## Timing Comparison

All runs: cold cache (`rm -rf node_modules bun.lock ~/.bun/install/cache`), `--no-progress`.

### Stock Bun v1.3.11 (release binary)

| Run | bun reported | wall clock |
|-----|-------------|------------|
| 1   | 511ms       | 0.517s     |
| 2   | 428ms       | 0.436s     |
| 3   | 439ms       | 0.449s     |
| **Avg** | **459ms** | **0.467s** |

### Ziggit bun-debug (debug binary, unoptimized)

| Run | bun reported | wall clock |
|-----|-------------|------------|
| 1   | 1.91s       | 2.336s     |
| 2   | 1.73s       | 1.946s     |
| 3   | 1.71s       | 1.927s     |
| **Avg** | **1.78s** | **2.070s** |

### Analysis

The ziggit debug build is ~3.8x slower than stock bun's release binary. This is expected because:

1. **Debug vs Release:** bun-debug is an unoptimized debug build (1.3GB vs ~100MB release). Debug builds have no inlining, no SIMD optimization, full bounds checks, and verbose syscall logging.
2. **Functional correctness confirmed:** All 4 git dependencies resolved and installed correctly with zero git CLI fallbacks.
3. **Same output:** Both produce identical `bun.lock` and `node_modules/` trees (68 packages).

A release build comparison would show much closer performance. The key validation here is **zero git CLI subprocess calls** — all git protocol operations are handled in-process by ziggit.
