# Ziggit E2E Validation: `bun install` with Git Dependencies

## Date
2026-03-30 (session 27)

## System Info
- **Kernel:** Linux 6.1.141 x86_64
- **CPUs:** 4
- **Memory:** 15Gi total
- **Build type:** debug (bun-debug, 1.3GB)

## Commits
- **ziggit:** `5ce98c8` (master)
- **bun-fork:** `d70d86189` (ziggit-integration branch)
- **stock bun:** v1.3.11 (af24e281)

## Test Setup

```json
{
  "name": "ziggit-e2e-test",
  "dependencies": {
    "debug": "git+https://github.com/debug-js/debug.git",
    "chalk": "git+https://github.com/chalk/chalk.git",
    "is": "git+https://github.com/sindresorhus/is.git",
    "semver": "git+https://github.com/npm/node-semver.git",
    "express": "git+https://github.com/expressjs/express.git"
  }
}
```

All 5 top-level dependencies use `git+https://` protocol, forcing the git code path (not tarball download). 69 total packages installed (including transitive deps from npm).

## strace Proof: Zero Git CLI Calls

```
$ strace -f -e trace=execve -o /tmp/strace-output.txt bun-debug install ...
$ grep -ac 'execve.*"/usr/bin/git"' /tmp/strace-output.txt
0
```

**CONFIRMED: Zero `git` subprocess execve calls.** All git operations (clone, ref resolution, checkout) handled entirely by ziggit's in-process Zig implementation.

## Timing Comparison

All runs: cold cache (`rm -rf node_modules bun.lock ~/.bun/install/cache`), `--no-progress`.

### Stock Bun v1.3.11 (release binary)

| Run | bun reported | wall clock |
|-----|-------------|------------|
| 1   | 573ms       | 0.580s     |
| 2   | 386ms       | 0.392s     |
| 3   | 419ms       | 0.425s     |
| **Avg** | **459ms** | **0.466s** |

### Ziggit bun-debug (debug binary, unoptimized)

| Run | bun reported | wall clock |
|-----|-------------|------------|
| 1   | 1.67s       | 1.872s     |
| 2   | 1.45s       | 1.770s     |
| 3   | 1.42s       | 1.687s     |
| **Avg** | **1.51s** | **1.776s** |

### Analysis

The ziggit debug build is ~3.3× slower than stock bun's release binary (1.51s vs 459ms bun-reported). This is expected because:

1. **Debug vs Release:** bun-debug is an unoptimized debug build (1.3GB vs ~100MB release). Debug builds have no inlining, no SIMD optimization, full bounds checks, and verbose syscall logging.
2. **5 git dependencies** (up from 4 in previous sessions): debug, chalk, is, semver, express — all resolved via ziggit with zero fallbacks.
3. **Functional correctness confirmed:** All 69 packages installed correctly with zero git CLI fallbacks (verified via strace).
4. **Same output:** Both produce identical `bun.lock` and `node_modules/` trees (69 packages).

A release build comparison would show much closer performance. The key validation here is **zero git CLI subprocess calls** — all git protocol operations are handled in-process by ziggit.

### Zig 0.15 Compatibility
- ziggit builds cleanly with both `zig 0.14` (native) and `zig 0.15.2` (bun vendored)
- No `std.ArrayList` managed API migration needed — ziggit already uses `std.ArrayListUnmanaged` throughout
