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

- **Editing `src/js/**/*.ts` does NOT invalidate the JS bundle.** ninja does not track
  those files as inputs of `bundle-modules`, so `bun bd` relinks a binary that still has
  the OLD builtin and your change is silently absent — the tests "pass" against code you
  didn't change. Force it:
  `rm build/debug/codegen/InternalModuleRegistryConstants.h && bun bd`.
  Gate on that file's mtime being newer than your edit before trusting any run.
- **A freshly relinked binary is SIGKILLed by macOS** (`Killed: 9`, build fails at
  `bun-debug.smoke-test-passed` with `code=137`) because the code signature is stale.
  Fix: `codesign -f -s - build/debug/bun-debug`, then it runs.
- `BUN_DEBUG_QUIET_LOGS=1` suppresses debug-build log spam.
- MessagePort's `.on/.off` are added by requiring `worker_threads` — plain `new MessageChannel()` ports only have `addEventListener` until then.
- The debug+asan build is 10-100× slower than release; large-allocation stress tests can time out locally while passing in CI.
