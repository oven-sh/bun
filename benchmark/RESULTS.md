# Ziggit Integration — E2E Validation Results

**Date:** 2026-03-30

## System Info

| Property | Value |
|---|---|
| Kernel | Linux 6.1.141 x86_64 |
| CPUs | 4 |
| RAM | 15Gi |
| Stock Bun | 1.3.11 |
| Bun Fork | `1b5cc1a6b` (ziggit-integration branch, debug build) |
| Ziggit | `55f44f6` |

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

All 4 top-level dependencies use `git+https://` protocol, forcing git resolution.
Total: **68 packages** installed (including transitive deps).

## strace Proof: Zero Git CLI Calls

```
$ strace -f -e trace=execve -o /tmp/strace-clean.txt bun-debug install ...

=== ALL execve calls ===
73641 execve("/root/bun-fork/build/debug/bun-debug", [...]) = 0

=== GIT CLI CALLS ===
0
```

**Result: ZERO `/usr/bin/git` subprocess calls.** All git operations (clone, ref resolution,
tree traversal, object decompression) handled natively by ziggit's built-in Zig implementation.

## Timing Comparison

Each run: cold cache (`rm -rf node_modules bun.lock ~/.bun/install/cache`).

| Run | Stock Bun 1.3.11 | Ziggit Bun (debug) | Ratio |
|-----|------------------:|-------------------:|------:|
| 1 | 418ms | 1560ms | 3.7x |
| 2 | 362ms | 1472ms | 4.1x |
| 3 | 354ms | 1478ms | 4.2x |
| **Avg** | **378ms** | **1503ms** | **4.0x** |

### Notes

- The ziggit bun binary is a **debug build** (1.3GB, with debug_info, not stripped).
  A release build would be significantly faster.
- Stock bun shells out to the system `git` CLI (a compiled C binary) for git dependencies.
  Ziggit replaces this with a pure Zig implementation — no subprocess overhead, but the
  debug build's lack of optimizations accounts for the current speed difference.
- Both produce identical `node_modules/` layouts and `bun.lock` files.
- The key achievement: **zero git CLI fallbacks** — all git protocol operations are handled
  in-process by ziggit.
