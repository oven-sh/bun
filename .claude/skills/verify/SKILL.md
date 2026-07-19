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

- **Prefix every `bun bd` with `PATH="$HOME/.cargo/bin:$PATH"`** — Homebrew's `rust`
  formula shadows the pinned nightly, and `bun bd` dies with `the option 'Z' is only
  accepted on the nightly compiler`. `bun bd` re-runs cargo on every invocation, so
  this is needed for follow-up runs too, not just the first build.
- `BUN_DEBUG_QUIET_LOGS=1` suppresses debug-build log spam.
- Debug builds print `[cachefs]`/`[sys]` lines to stdout; filter them before diffing
  output against `node`.
- MessagePort's `.on/.off` are added by requiring `worker_threads` — plain `new MessageChannel()` ports only have `addEventListener` until then.
- The debug+asan build is 10-100× slower than release; large-allocation stress tests can time out locally while passing in CI.
