---
name: verify
description: Drive Bun's debug binary end-to-end to observe a change working at the CLI/runtime surface — not tests, not typecheck.
---

# Verifying a Bun change

**Surface:** the `bun` CLI (`./build/debug/bun-debug`). Almost every change is
observable via `bun-debug -e '<script>'` or `bun-debug <file>`.

## Get a handle

```sh
bun bd                       # builds ./build/debug/bun-debug (takes a while first time)
./build/debug/bun-debug -e 'console.log(Bun.version)'   # sanity
```

`bun bd <args>` builds then execs the args, but for repeated verification runs
after a single build, invoke `./build/debug/bun-debug` directly to skip the
rebuild check.

Set `BUN_DEBUG_QUIET_LOGS=1` to suppress the debug-build's scoped logging noise.

## Drive it

Changed a runtime API, `node:*` compat, or a CLI flag → compose a `-e` one-liner
that reaches it and print the observable result:

```sh
BUN_DEBUG_QUIET_LOGS=1 ./build/debug/bun-debug -e 'process.emitWarning("x")'
BUN_DEBUG_QUIET_LOGS=1 ./build/debug/bun-debug --some-flag -e '...'
BUN_DEBUG_QUIET_LOGS=1 TZ=UTC ./build/debug/bun-debug -e '...'
```

Changed `Bun.serve` / sockets / spawn → the `-e` script starts the server on
`port: 0` and hits it with `fetch`/`net.connect` in the same process, printing
what came back.

Changed the bundler / transpiler / install → drive the corresponding CLI verb
(`./build/debug/bun-debug build entry.ts`, `... install`) against a
`tempDir`-shaped fixture in the session scratchpad and inspect the output
files.

## Compare to the oracle

For Node compat changes, run the identical `-e` script under `node` and diff.
For regressions, run under the last release (`bun -e '...'` without `bd`).

## Gotchas

- macOS: ports/paths — bind `:0`, unix sockets under `os.tmpdir()`.
- Debug build is 10-100x slower than release; keep probes tiny.
- `bun bd test <file>` is the test runner, not verification — don't reach for
  it here.
