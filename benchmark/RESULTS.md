# E2E Benchmark: ziggit bun vs stock bun

**Date:** 2026-03-30
**Machine:** Linux x86_64, same host for all tests
**Stock bun:** v1.3.x release build (99MB)
**Ziggit bun:** debug build with ASAN + syscall tracing (1.3GB)

## Results

| Test | Description               | Stock Bun (avg) | Ziggit Bun (avg) | Ratio | Git CLI Calls |
|------|---------------------------|-----------------|-------------------|-------|---------------|
| A    | 1 git dep                 |          262ms  |           488ms   | 1.86x | 0             |
| B    | 4 git deps                |         1072ms  |          1155ms   | 1.08x | 0             |
| C    | Large repo (three.js)     |         7318ms  |         23253ms   | 3.18x | 0             |
| D    | Mixed git+npm             |          908ms  |          1251ms   | 1.38x | 0             |
| E    | Specific tag (#4.3.4)     |          285ms  |           480ms   | 1.68x | 0             |

### Key findings

1. **Zero git CLI fallbacks** across all tests — verified via `strace -f -e trace=execve`. No `execve("git", ...)` calls detected.
2. **Debug build overhead:** The ziggit bun is a debug build with AddressSanitizer and full debug symbols (1.3GB vs 99MB). Expected overhead is 3-5x for CPU-bound operations.
3. **Test B (4 git deps) shows only 1.08x ratio** — close to parity even with debug overhead, because network latency dominates.
4. **Test C (three.js) shows 3.18x** — large repo checkout is CPU-intensive (many files to write), so debug overhead is more visible.
5. **All tests passed** — no errors or failures on any test.

## Raw timing data

### Stock Bun
```
Test A (1 git dep):       434ms, 230ms, 122ms  → avg 262ms
Test B (4 git deps):      790ms, 959ms, 1467ms → avg 1072ms
Test C (three.js):        8255ms, 6382ms        → avg 7318ms
Test D (mixed git+npm):   1201ms, 441ms, 1082ms → avg 908ms
Test E (tag #4.3.4):      320ms, 312ms, 223ms   → avg 285ms
```

### Ziggit Bun (debug build)
```
Test A (1 git dep):       539ms, 425ms, 501ms   → avg 488ms
Test B (4 git deps):      1241ms, 1176ms, 1049ms → avg 1155ms
Test C (three.js):        33344ms, 13163ms       → avg 23253ms
Test D (mixed git+npm):   1305ms, 1233ms, 1216ms → avg 1251ms
Test E (tag #4.3.4):      447ms, 570ms, 423ms   → avg 480ms
```

## Test configurations

### Test A — Small (1 git dep)
```json
{"name":"test-a","dependencies":{"debug":"git+https://github.com/debug-js/debug.git"}}
```

### Test B — Multiple git deps
```json
{"name":"test-b","dependencies":{
  "debug":"git+https://github.com/debug-js/debug.git",
  "chalk":"git+https://github.com/chalk/chalk.git",
  "semver":"git+https://github.com/npm/node-semver.git",
  "express":"git+https://github.com/expressjs/express.git"
}}
```

### Test C — Large repo (many files)
```json
{"name":"test-c","dependencies":{"three":"git+https://github.com/mrdoob/three.js.git"}}
```

### Test D — Mixed (git + npm)
```json
{"name":"test-d","dependencies":{
  "debug":"git+https://github.com/debug-js/debug.git",
  "lodash":"^4.17.21",
  "express":"^4.18.2",
  "chalk":"git+https://github.com/chalk/chalk.git"
}}
```

### Test E — Specific commit/tag
```json
{"name":"test-e","dependencies":{
  "debug":"git+https://github.com/debug-js/debug.git#4.3.4"
}}
```

## Strace verification

All tests verified with `strace -f -e trace=execve`. The only `execve` calls containing "git" are the bun-debug binary path itself (which contains "ziggit" in its path). Zero calls to `/usr/bin/git` or any git CLI binary.

## Methodology

- Each test: cold cache (`rm -rf node_modules bun.lock ~/.bun/install/cache`)
- Tests A, B, D, E: 3 runs each; Test C: 2 runs (large repo)
- `timeout 180` per run
- `--no-progress` flag to suppress UI output
- Same host, sequential execution
