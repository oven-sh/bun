# `bun test --isolate --parallel` — status

**Branch:** `claude/isolated-parallel-test` in `/Users/jarred/code/bun-4` @ `b48e1bd077`
**Design docs:** `docs/dev/isolated-parallel-test.md`, `docs/dev/parallel-test-ipc.md`
**All commits unsigned** (SSH agent locked overnight) — re-sign before pushing.

## TL;DR

```sh
bun bd test test/cli/test/isolation.test.ts test/cli/test/parallel.test.ts   # 20 pass / 0 fail
bun bd test --parallel=4 test/js/bun/util/                                    # 49 files, ~45s, 296% CPU
bun run zig:check-all                                                         # 61/61 targets
```

Independent verification: **13/13 PASS** (core tests, regression, all six feature probes, recycle race, large-suite smoke).

## Features

**`--isolate`** — fresh `ZigGlobalObject` per file on the same `JSC::VM`. Between files: drain microtasks → close all sockets (usockets context walk) → close FSWatchers/StatWatchers → cancel timers → kill subprocesses → bump generation → unprotect old global → create new one. `--preload` re-runs in each fresh global. JSC `CodeCache` is VM-level so shared deps don't re-parse.

**`--parallel[=N]`** — coordinator + N workers over fd-3 IPC (POSIX raw fd, Windows non-overlapped pipe). Workers run with `--isolate`, recycle after `--isolate-recycle-after=M` files. Crash recovery re-queues once. Cross-worker `--bail` stops dispatch at file granularity. All test flags forwarded. Per-test output buffered per file (contiguous), JUnit aggregated, LCOV coverage merged with summed DA counts.

## Key entry points

| | |
|---|---|
| `Zig__GlobalObject__createForTestIsolation` | `src/bun.js/bindings/ZigGlobalObject.cpp:569` |
| `VirtualMachine.swapGlobalForTestIsolation()` | `src/bun.js/VirtualMachine.zig:2374` |
| `us_socket_context_next()` (new C accessor) | `packages/bun-usockets/src/context.c:204` |
| Coordinator / worker | `src/cli/test/ParallelRunner.zig` |
| LCOV merge | `ParallelRunner.zig` `mergeCoverageFragments()` |

## Known limits (documented inline)

- **fetch keepalive pool** (HTTPThread, separate uws loop) not closed on swap; recycling covers fd accumulation. JS-side promises drop with the old global so it's invisible to tests.
- **Coverage `% Funcs`** under `--parallel` takes per-worker max instead of union, because Bun's LCOV writer doesn't emit `FN`/`FNDA` records (pre-existing gap, `CodeCoverage.zig:229`). Line coverage is exact.
- **Windows `--parallel`** compiles on all targets and mirrors `security_scanner.zig`'s working pipe pattern, but hasn't been executed on Windows yet.

## In progress

**Realtime per-test output** — current implementation buffers worker output until `file_done` for clean contiguous display, which means no feedback until a file completes. Reworking to: worker streams `test_start`/`test_done` events over IPC immediately; coordinator renders a live per-worker status block on TTY, plain self-describing lines on non-TTY. Running in a worktree now.
