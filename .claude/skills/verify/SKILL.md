---
description: Drive a Bun change end-to-end at its runtime surface.
---

Build once, then run the debug binary directly at the surface the diff touches:

```sh
bun bd -e '<repro script>'                       # JS-visible API changes
BUN_DEBUG_QUIET_LOGS=1 ./build/debug/bun-debug <cmd>   # after a build
```

- **Runtime API** (`Bun.*`, `node:*`, Web APIs): `bun bd -e 'require("node:sqlite")…'` and print what you observe.
- **CLI commands** (install/run/test/build): `bun bd <subcommand> …` in a `tempDir`.
- **Server** (`Bun.serve`): start with `port: 0`, `fetch()` it in the same script.
- **Bundler**: `bun bd build fixture.ts --outdir=…`, read the output.

Do **not** run the test suite as verification — that is CI. Drive the changed behavior at the surface a user would, capture the output, and report it.
