---
description: Verify a Bun code change end-to-end by driving the debug binary at its CLI surface — do not just re-run tests.
---

# Verify a Bun change

## Build

```sh
bun bd --version   # builds debug → ./build/debug/bun-debug, prints version on success
```

`bun bd` is build-then-exec: `bun bd <args>` builds then runs `./build/debug/bun-debug <args>`. Don't set a timeout.

## Drive

Set `BUN_DEBUG_QUIET_LOGS=1` when driving so scoped-logger noise doesn't drown observable output. For anything piped-stdin (REPL, prompts), also set `NO_COLOR=1`.

Common surfaces per changed area:

| Change area | Drive with |
|---|---|
| CLI flag / dispatch | `bun bd <flag>` and observe stdout/stderr/exit |
| `bun --interactive` / node:repl | `printf '<lines>\n' \| BUN_DEBUG_QUIET_LOGS=1 NO_COLOR=1 NODE_REPL_HISTORY="" bun bd --interactive` |
| bun-as-node | `(exec -a node ./build/debug/bun-debug <args>)` — argv0 emulation |
| `-e` / `-p` | `bun bd -e '<script>'` |
| node:vm, node:fs, etc. | `bun bd -e 'require("node:vm")…'` — one-shot script |
| Bun.serve / HTTP | `bun bd -e 'Bun.serve({port:0,fetch:…})'` then curl the printed port |
| Bundler | `bun bd build <input> --outdir=/tmp/out` then inspect output |

## Push on it

- New flag: pass empty, twice, with a script positional, combined with `-e`/`-p`.
- REPL/readline: EOF stdin, tampered prototypes, unterminated tokens in `-e`.
- vm.Script: bad syntax, lineOffset/columnOffset combos, cachedData.
- bun-as-node: with/without positionals, with/without `-i`.

## Gotchas

- Debug builds hot-reload `src/js/**` from disk (`BUN_DYNAMIC_JS_LOAD_PATH`) — a `git stash` of a `.js` change is observable without rebuilding, but `.rs`/`.cpp` changes need `bun bd`.
- `bun bd test <file>` is CI's job — verify by driving the CLI instead.
