# Ziggit Integration — E2E Validation Results

**Date:** 2026-03-30
**System:** Linux 6.1.141 x86_64, 4 CPUs, 16GB RAM

## Commit Hashes

| Component | Version / Commit |
|-----------|-----------------|
| bun-fork | `0902855e5` (ziggit-integration branch) |
| ziggit | `55f44f6` |
| stock bun | 1.3.11 (`af24e281`) |

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

All 4 dependencies use `git+https://` protocol (forces git protocol, not tarball).
Each run: clean `node_modules`, `bun.lock`, and `~/.bun/install/cache`.

## strace Proof — Zero Git CLI Calls

```
$ grep 'execve.*"/usr/bin/git"' /tmp/strace-output.txt | wc -l
0
```

**The only `execve` call was for `bun-debug` itself.** Ziggit's native Zig git implementation
handles all git operations (clone, ref resolution, tree walking, checkout) in-process with
zero subprocess fallbacks.

## Timing Comparison

Note: bun-fork is a **debug build** (1.3GB, unoptimized). Stock bun is a release build.

### Stock Bun 1.3.11 (release build)

| Run | bun install time | wall time |
|-----|-----------------|-----------|
| 1 | 457ms | 0.464s |
| 2 | 568ms | 0.574s |
| 3 | 357ms | 0.363s |
| **avg** | **461ms** | **0.467s** |

### Ziggit Bun (debug build)

| Run | bun install time | wall time |
|-----|-----------------|-----------|
| 1 | 1359ms | 1.609s |
| 2 | 1376ms | 1.654s |
| 3 | 1444ms | 1.704s |
| **avg** | **1393ms** | **1.656s** |

### Summary

| Metric | Stock Bun (release) | Ziggit Bun (debug) | Ratio |
|--------|--------------------|--------------------|-------|
| Avg install time | 461ms | 1393ms | 3.0x |
| Avg wall time | 0.467s | 1.656s | 3.5x |
| Git CLI calls | uses git subprocess | **0** (native) | ✅ |
| Packages installed | 68 | 68 | ✅ |

The 3x slowdown is expected for a debug build vs release build. The critical validation is:
- ✅ **Zero git CLI subprocess calls** (confirmed via strace)
- ✅ **All 4 git dependencies resolved and installed correctly**
- ✅ **68 packages installed** (same as stock bun)
- ✅ **Lockfile generated successfully**
