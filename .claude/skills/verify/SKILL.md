---
name: verify
description: Verify a Bun runtime change by driving the debug binary end-to-end.
---

# Verify a Bun runtime change

Build and drive the debug binary directly — never `bun test`, never import-and-call.

## Build

```sh
bun bd --version   # builds ./build/debug/bun-debug and prints its version
```

## Drive

For any JS-visible change, run the debug binary with `-e` and observe stdout:

```sh
bun bd -e '<repro>'   # builds, then runs; sets BUN_DEBUG_QUIET_LOGS for you
```

For worker/subprocess-shaped changes, spawn a subprocess (still `-e`) so worker teardown / event-loop-idle paths are exercised. Cross-check against `node -e '<same repro>'` for Node-compat changes.

## Gotchas

- **A `src/js/**` edit can silently not reach the binary.** `bundle-modules`
  regenerates `build/<cfg>/codegen/InternalModuleRegistryConstants.h`, but the C++
  TU that embeds it is not always recompiled, so the build succeeds while the
  binary still runs the OLD JS. Gate on the binary, not the build: ask the binary
  you just built — `bun bd -e 'console.log(<Class>.toString().includes("<new-id>"))'`
  (or run `./build/<cfg>/bun` directly). Plain `bun` is the system Bun on $PATH and
  never has your edit, so it answers about the wrong binary.
  If false, `touch src/jsc/bindings/InternalModuleRegistry.cpp` and rebuild.
- **Prefix every `bun bd` with `PATH="$HOME/.cargo/bin:$PATH"`** — Homebrew's `rust`
  formula shadows the pinned nightly, and `bun bd` dies with `the option 'Z' is only
  accepted on the nightly compiler`. `bun bd` re-runs cargo on every invocation, so
  this is needed for follow-up runs too, not just the first build.
- `node:cluster` changes can't be driven with `-e`: `cluster.fork()` re-execs `argv[1]`, so workers need a real file on disk. Write a scratch script and run `./build/debug/bun-debug <file>`.
- Only one `bun bd` per worktree at a time — a second one blocks on the build lock and looks like a runtime hang. Build once, then drive `./build/debug/bun-debug` directly under `timeout`.
- `BUN_DEBUG_QUIET_LOGS=1` suppresses debug-build log spam.
- Debug builds print `[cachefs]`/`[sys]` lines to stdout; filter them before diffing
  output against `node`.
- MessagePort's `.on/.off` are added by requiring `worker_threads` — plain `new MessageChannel()` ports only have `addEventListener` until then.
- The debug+asan build is 10-100× slower than release; large-allocation stress tests can time out locally while passing in CI.
