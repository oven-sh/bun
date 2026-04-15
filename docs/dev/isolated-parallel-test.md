# Isolated & Parallel `bun test`

**Status:** in progress (branch `claude/isolated-parallel-test`)

## Goal

Run `bun test` with per-file isolation and N-way process parallelism, without paying full process-startup cost per file.

## Design

### Isolation: GlobalObject swap, same VM

Each test file runs in a fresh `ZigGlobalObject` on the **same** `JSC::VM`. Between files:

1. Drain microtasks + one event loop tick (quiesce in-flight async from the old file)
2. `closeAllActiveHandlesForTestIsolation()` — eagerly close sockets, timers, watchers, subprocesses
3. Bump `VirtualMachine.test_isolation_generation`
4. Create fresh `ZigGlobalObject`, point `VirtualMachine.global` at it
5. Unprotect old global → GC reclaims its module graph, prototypes, user objects

The VM (heap, JIT tiers, mimalloc) stays warm. Module graph and built-in prototypes are per-global, so JS-level isolation is real.

### Generation counter (safety net)

`VirtualMachine.test_isolation_generation: u32`, bumped on swap. Native callbacks that fire into JS check `if (self.generation != vm.test_isolation_generation) { self-close; return; }` at the dispatch choke points:

- `EventLoop` task dispatch
- Timer fire
- uws socket callback trampolines
- FSWatcher event delivery
- Subprocess exit/stdio callbacks

This catches handles that escaped the eager-close registry. Stale callbacks self-reap instead of firing into the wrong global.

### SourceProvider cache: VM-scoped

`RuntimeTranspilerCache` (and JSC `CachedBytecode` where applicable) is hoisted to `VirtualMachine` level, keyed by resolved-path + content-hash. A fresh global's module `fetch` checks this cache before transpiling, so shared deps (`harness`, `bun:test`, common imports) parse once per process, not once per file.

### Parallelism: process pool

`bun test --parallel[=N]`:

- Coordinator process discovers test files, spawns N workers (default: cpu count)
- IPC over pipes (reuse `Bun.spawn` ipc / child_process framing)
- Coordinator → worker: `{ file: string }`
- Worker → coordinator: streamed test results (reuse existing reporter event shape)
- Worker runs each file with the isolation swap above
- Worker self-recycles: exits after M files or when RSS > watermark; coordinator respawns
- On worker crash: re-queue its in-flight file to a fresh worker, mark "isolate-hard" (gets its own short-lived worker on retry)

### Why not fork()

`fork()` doesn't compose with JSC's threads. Long-lived workers sidestep it: startup is paid N times total, not per-file. Bytecode cache on disk means even respawned workers don't re-parse.

### Why not fresh VM per file

JSC VM init (heap, JIT, builtins) is the expensive part. Multiple globals per VM is supported and GC handles global teardown cheaply. The cost is on the Zig side — `VirtualMachine` holds event-loop/handle state that needs reset. Recycling-on-watermark covers whatever reset misses.

## Flags

- `--isolate` — per-file global swap, sequential (single process)
- `--parallel[=N]` — process pool, implies `--isolate` in workers
- `--isolate-recycle-after=<M>` — worker exits after M files (default 50)
- `--isolate-recycle-rss=<bytes>` — worker exits when RSS exceeds (default 1.5 GiB)

## Known leak surfaces (covered by recycling)

- `JSC::Strong<>` held in Zig structs that pin old-global objects
- Native handles whose Zig owner outlives the global
- Anything `closeAllActiveHandles` misses

## Test plan

- `test/cli/test/isolation.test.ts` — leaked server in file A not visible in file B; global mutation not visible; module cache not shared
- `test/cli/test/parallel.test.ts` — parallel run results match serial; shared dep transpiled once (assert via cache stats); worker crash recovery
