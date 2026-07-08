---
description: Verify a change to the Bun runtime by driving the debug build end-to-end.
---

# Verifying a Bun runtime change

**Build once, then drive `./build/debug/bun-debug` directly** — don't
re-run `bun bd` for every probe (a no-op rebuild still costs seconds
of cargo dep-checking).

```bash
bun bd --revision                          # build; prints version+hash on success
./build/debug/bun-debug -e '<snippet>'     # drive it
BUN_DEBUG_QUIET_LOGS=1 ...                 # suppress the very chatty debug tracing
```

## Surfaces by area

- **JS-visible API** (`Bun.*`, Web APIs, `node:*` modules): a `-e`
  one-liner is the surface. `./build/debug/bun-debug -e 'console.log(new Request("https://x").url)'`.
- **CLI** (`bun install`, `bun build`, `bun test`): run the subcommand
  in a `mktemp -d` scratch dir. Use `bunEnv` from `test/harness.ts` if
  you need the CI-equivalent env.
- **Server/socket** (`Bun.serve`, `net`/`tls`/`http`): start a server on
  `port: 0` in the `-e` script and hit it from the same process.
- **Memory/lifetime fixes** (leaks, UAF, teardown): set
  `BUN_DESTRUCT_VM_ON_EXIT=1` so the VM actually tears down instead of
  `_exit`ing; ASAN in the debug build then reports on stderr. A clean
  `exitCode 0` + `signalCode null` is the pass signal — don't grep
  stderr for "AddressSanitizer".

## Gotchas

- `test/` deps need `cd test && bun install` first; some experimental
  React deps (`react-server-dom-bun`) only resolve against the public
  registry, not internal mirrors — set
  `NPM_CONFIG_REGISTRY=https://registry.npmjs.org` if `bun install` 404s.
- Debug builds are 10-100× slower than release; a 5s test-file timeout
  that CI hits comfortably will time out locally. Widen with
  `--timeout 30000` before assuming a hang.
- `require("harness")` only resolves inside `test/` (path-mapped);
  from a bare `-e` script, `cd test` first and `require("./harness.ts")`.
