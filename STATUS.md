# `bun test --isolate --parallel` — overnight status

**Branch:** `claude/isolated-parallel-test` (5 commits, unsigned — SSH agent was locked)
**Design doc:** `docs/dev/isolated-parallel-test.md`, `docs/dev/parallel-test-ipc.md`

## TL;DR

Both flags work and are tested. `--isolate` gives each test file a fresh `ZigGlobalObject` on the same JSC::VM with eager handle cleanup. `--parallel[=N]` runs a coordinator + N worker processes over an fd-3 pipe, each worker isolating between files and recycling after M files.

```sh
bun bd test test/cli/test/isolation.test.ts test/cli/test/parallel.test.ts   # 8 pass / 0 fail
bun bd test --parallel=4 test/js/bun/util/                                    # 49 files, ~47s (vs >180s serial)
```

## What works

**`--isolate`** (sequential, per-file fresh global)
- New C++ entry: `Zig__GlobalObject__createForTestIsolation` (ZigGlobalObject.cpp:569) — creates a `Zig::GlobalObject` on an *existing* `JSC::VM`
- `VirtualMachine.swapGlobalForTestIsolation()` (VirtualMachine.zig:2374): drains microtasks, cancels all timers, closes listening sockets, kills subprocesses, bumps generation, gcUnprotects old global, creates + installs new one
- Generation counter (`test_isolation_generation`) checked at timer fire — stale timers self-reap
- Context-ID inheritance so `Bun.isMainThread` stays correct after swap
- SourceProvider/CodeCache reuse: turns out JSC's `CodeCache` is already VM-level and `RuntimeTranspilerCache` is process-level, so shared deps don't re-parse — no extra plumbing needed

**`--parallel[=N]`** (process pool)
- `src/cli/test/ParallelRunner.zig`: coordinator spawns N workers (`bun test --test-worker --isolate`), distributes files over stdin, reads results from fd-3
- Crash recovery: dead worker's in-flight file re-queued once, then marked fail
- Recycling: `--isolate-recycle-after=M` (default 50), worker exits after M files, coordinator respawns
- Totals aggregate correctly across workers; non-zero exit on any failure
- Perf test asserts parallel < 0.75× serial wall-time on sleep-bound files

## What's rough / TODO

| Area | State | Location |
|---|---|---|
| Outbound sockets (fetch keepalive, net.Socket, WS clients) | not eagerly closed on swap; recycling covers leak | VirtualMachine.zig:2410 TODO |
| FSWatcher / StatWatcher | not closed on swap | same TODO |
| `--preload` scripts | run once in first global only; not re-executed after swap | same TODO |
| Generation check beyond timers | only timers tagged; uws/FS/subprocess callbacks unchecked | — |
| Windows `--parallel` | fd-3 libuv pipe not wired; compiles but won't read IPC | ParallelRunner.zig:~130 |
| Flag forwarding to workers | only timeout/todo/only/update-snapshots/recycle-after; missing bail/coverage/grep/preload/retry | ParallelRunner.zig coordinator spawn |
| Coverage + JUnit aggregation | not collected from workers | — |
| Per-test output | per-file ✓/✗ line + worker stderr passthrough; no `writeTestStatusLine` replay | — |
| Cross-worker `--bail` | each worker bails independently | — |

## Tests added

- `test/cli/test/isolation.test.ts` — 3 tests (leaked global/server/interval invisible across files; control without flag shows leak; module state per-file)
- `test/cli/test/parallel.test.ts` — 5 tests (totals, exit code, crash recovery, perf, default N)

## Verification

Independent adversarial verification: 12/12 PASS after one fix iteration. Initial run found a coordinator/worker recycle handoff race (coordinator dispatched into a worker that was about to exit for recycling, misreporting it as a crash and burning retry budget). Fixed in `cd175e19db` — coordinator now mirrors `files_run` per worker and skips dispatch at the recycle boundary. Regression test added.

## Commits

```
cd175e19db test --parallel: don't dispatch into a recycling worker
32c28b3440 test --parallel: lazily init extra_fds Stdio so Windows union compiles
cacdbfe190 test: add --parallel for process-pool test execution
0b2c03ce17 test --isolate: inherit ScriptExecutionContext identifier on swap
66c553b200 test: add --isolate to run each file in a fresh GlobalObject
```

## Suggested next steps

1. Walk usockets `loop->data.head` contexts in `swapGlobalForTestIsolation` to close *all* sockets, not just listeners — that's the biggest correctness gap
2. Re-run `--preload` after swap (or hoist preload hooks to `BunTestRoot` so they survive)
3. Forward remaining CLI flags to workers
4. Per-test line replay in coordinator so output matches serial
5. Windows fd-3 via libuv named pipe
