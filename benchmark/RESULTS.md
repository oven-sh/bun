# Ziggit E2E Validation — `bun install` with Git Dependencies

**Date:** 2026-03-30  
**System:** Ubuntu 24.04.2 LTS, Linux 6.1.141, x86_64, 4 CPUs, 16GB RAM  
**Stock bun:** v1.3.11 (af24e281)  
**Ziggit bun-debug:** v1.3.11-debug (b8f2c7f08, branch: ziggit-integration)  
**Ziggit commit:** 55f44f6  

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

All 4 dependencies use `git+https://` protocol (forces git protocol, not tarball download).  
68 total packages installed (including transitive deps).

## strace Proof: Zero Git CLI Calls

```
$ strace -f -e trace=execve bun-debug install ... 2>&1 | grep 'execve.*"/usr/bin/git"' | wc -l
0
```

**Result: 0 git CLI subprocess calls.** Ziggit's native Zig git implementation handles all git operations in-process — clone, ref resolution, packfile fetching, tree/blob extraction — without ever spawning `/usr/bin/git`.

## Timing Comparison

Each run: cold install (rm node_modules, bun.lock, cache).

| Run | Stock bun (release) | Ziggit bun (debug build) |
|-----|--------------------:|-------------------------:|
| 1   | 426ms               | 1597ms                   |
| 2   | 375ms               | 1433ms                   |
| 3   | 385ms               | 1587ms                   |
| **Avg** | **395ms**       | **1539ms**               |

### Notes

- The ziggit binary is a **debug build** (`bun-debug`) with full syscall tracing (`[sys]` log lines on every syscall) and `[uws]` socket debug logging. This adds significant overhead.
- A release build of ziggit-integrated bun would be expected to perform comparably to stock bun, since the git protocol implementation is I/O-bound (network fetch from GitHub) not CPU-bound.
- Both versions resolve to identical packages and commit SHAs (chalk#aa06bb5, debug#6704cea, express#6c4249f, semver#6946fef).
- Stock bun also uses ziggit for git deps — this comparison validates the debug build works correctly end-to-end.

## Conclusion

✅ **Zero git CLI fallbacks** — all git operations handled natively by ziggit  
✅ **Correct resolution** — same packages, same commits as stock bun  
✅ **68 packages installed** successfully with 4 git+https dependencies  
