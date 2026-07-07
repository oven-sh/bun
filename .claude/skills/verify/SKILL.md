---
name: verify
description: Build bun and drive the change through the real binary to observe it working.
---

# Verifying a change in this repo

## Build

The Homebrew `rustc` shadows the pinned nightly, so always export the toolchain:

```sh
export PATH="$HOME/.cargo/bin:$PATH" RUSTUP_TOOLCHAIN=nightly-2026-05-06
bun bd              # -> build/debug/bun-debug ; NEVER set a timeout on this
```

Cold build ~20 min, incremental ~2-4 min. Run it as a background task and chain
the drive step onto the same command (`bun bd && ./build/debug/bun-debug ...`) —
a separate follow-up command races the relink.

Network: cargo/rustup need the network, so run the build with the sandbox
disabled. Many runtime tests (quic/net/tls/http) also need loopback sockets and
fail universally under the sandbox — drive them with the sandbox off too.

## Drive

The surface is the CLI. Write a small script and run it through the built binary
rather than importing internals:

```sh
BUN_DEBUG_QUIET_LOGS=1 ./build/debug/bun-debug [flags] script.mjs
```

Pass whatever flags the feature is gated behind (e.g. `--experimental-quic`).
`BUN_DEBUG_QUIET_LOGS=1` is essential — otherwise `[sys]`/`[cachefs]` scope logs
bury the output. `BUN_DEBUG_<scope>=1` turns a specific scope back on
(`BUN_DEBUG_lsquic=1` routes lsquic's own log to stderr).

## Node compat tests (`test/js/node/test/parallel/*.mjs`)

`bun bd test` does NOT run these — it only picks up `*.test.ts`. The real runner
(`scripts/runner.node.mjs`) wants to `bun install` the test fixtures, which 404s
against the corporate registry. Just run the file directly with the flags from
its own `// Flags:` header line:

```sh
./build/debug/bun-debug --experimental-quic --no-warnings test/js/node/test/parallel/test-quic-foo.mjs
```

Loop it (30-50x) when hunting a flake; several quic/net tests are timing races
that only show up a few percent of the time.

## Mutation-check the fix

Before trusting a new test, break the fix and confirm the test fails. A mutation
that stops the crate from compiling is not a valid mutation (e.g. removing a
call also orphans its `use`, and the workspace denies unused imports) — prefer a
one-token change that still builds.
