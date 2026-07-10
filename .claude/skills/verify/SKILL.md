---
name: verify
description: Build Bun and drive the changed code at its real surface (CLI, socket, FFI) to observe it running.
---

# Verifying a change to Bun

**Build:** `bun bd` (no timeout — it can take many minutes). Exit 0 is setup, not evidence.

**Drive:** `bun bd run <script.js>` builds *and* runs, forwarding args to the debug binary.
Put driver scripts under `~/code/tmp/**` — Santa blocks unsigned executables elsewhere.

## Two ways to invoke the debug build

| Need | Use |
|---|---|
| run a script, stay in the repo | `bun bd run /path/to/drive.js` |
| any command, from another cwd | `/Users/jarred/code/bun/build/debug/bun-debug <cmd>` |

`bun bd` is a **package.json script** — it only resolves with the repo root as cwd.
A probe that `cd`s into a temp dir must call the binary by absolute path.
The binary refuses `bun-debug test <file>` on purpose ("use `bun bd test`"); every other
subcommand (`pm pack`, `install`, `build`, `run`) works directly. Directory args to
`bun-debug test` also trip a filter guard — pass explicit file paths.

## Surfaces, by what you touched

| Changed | Drive it with |
|---|---|
| `src/uws_sys/**`, `src/runtime/server/**` | `Bun.serve({port:0})` + real `fetch()`; `routes:` for static routes |
| WebSocket / `Response::upgrade` | `Bun.serve` + `new WebSocket(...)`, echo a `Uint8Array` |
| TLS / `SSL_CTX` | `Bun.serve({tls:{cert,key}})` + `fetch(https, {tls:{rejectUnauthorized:false}})`. Make a cert with `openssl req -x509 -newkey rsa:2048 -nodes -subj /CN=localhost -addext subjectAltName=DNS:localhost` |
| `ConnectingSocket` (connect-failure path) | `Bun.connect()` to a port you opened then closed → `connectError` fires |
| `src/runtime/bake/**` (dev server) | run `bun-debug index.html --port 0`, read the URL off stdout, then open `ws://host:port/_bun/hmr` |
| `libdeflate`, `zstd`, `node:zlib` | `Bun.gzipSync`/`gunzipSync`, `Bun.zstdCompressSync`, `zlib.brotliCompress`. Feed garbage in too — it must throw, not crash |
| `libarchive` | write side = `bun-debug pm pack`; read side = `bun-debug install ./x.tgz --no-save`, then check the extracted file exists |
| `src/jsc/CachedBytecode.rs` | `bun-debug build x.js --bytecode --target=bun --outdir=out` then run `out/x.js` |
| `src/tcc_sys/**` | `import { cc } from "bun:ffi"` and call a compiled C symbol |
| Yarr `RegularExpression` | `.npmrc` with `public-hoist-pattern[]=*x*`, then `bun-debug install --dry-run` |
| `TextCodec` | `TextDecoder`, including `{stream:true}` across a split multi-byte codepoint |
| `JSUint8Array` | `crypto.getRandomValues(new Uint8Array(n))` (DOMJIT fast path); `ws.send(bytes)` |
| `SourceProvider` | `new Error().stack` must contain `file:line` |
| `Strong` / `Weak` | `WeakRef` + `Bun.gc(true)`; churn thousands of promises |

## Before pushing: the three gates CI runs

`bun bd` passing is not "CI will be green". CI runs these, and each has caught a
break that every host-target check missed:

```sh
bun run rust:clippy                                   # `-D` lints — a HARD gate
bun run rust:check-all                                # all 6 targets typecheck
cargo clippy --workspace --no-deps --keep-going \
  --target x86_64-unknown-linux-gnu                   # CI's clippy runs on LINUX
```

- **Clippy is a compile error, not a warning.** `mem_forget`, `boxed_local`,
  `undocumented_unsafe_blocks`, `mut_from_ref`, `vec_box`, `not_unsafe_ptr_arg_deref`
  are all `-D`. A `Box<Self>` reclaim fn or a `&self -> &mut T` FFI accessor will trip
  them; when the lint is wrong (heap-stable `Vec<Box<T>>`, an `unsafe fn` whose contract
  IS the aliasing), `#[allow(...)]` **with a reason comment** — don't contort the code.
- **Clippy's lint set is per-target.** A `#[cfg]`'d field can make an impl derivable on
  macOS and non-compiling on Linux. Host clippy clean ≠ CI clippy clean; run the Linux
  target explicitly. (Windows has ~32 pre-existing `bun_core` clippy errors — not a CI job.)
- **`--keep-going` still skips crates whose dependency failed**, so clippy needs several
  rounds. `cargo clippy --message-format=json` + collect every `level=="error"` gets the
  whole crate's diagnostics per round instead of the first one.

## Gotchas that cost real time

- **A debug assert you add is only real if it's in the binary**: `strings build/debug/bun-debug | rg '<your panic message>'`.
- **`cargo check` is not an oracle.** It never monomorphizes, so it never evaluates
  `const { assert!(...) }` inside a generic fn (`bun_opaque::opaque_deref*`). Finish with
  `cargo build -p bun_bin` or `bun bd`.
- **Generated code is built by ninja, not cargo.** `build/debug/codegen/*.rs` goes stale under
  a bare `cargo check`. Regenerate a single file with e.g.
  `bun src/codegen/generate-host-exports.ts build/debug/codegen`, or just run `bun bd`.
- **Multi-file test runs share one process.** RSS/GC assertions (`gcUntilCountAtMost`,
  "does not leak memory") and tests that mutate process globals (`buffer.kMaxLength`) fail
  when run alongside other files even with `--isolate`. Re-run the file alone before believing it.
- **Compare against a baseline binary, not intuition.** `~/code/bun-3` tracks `main` and usually
  has a built `build/debug/bun-debug`. Run the same file with it to tell a regression from a
  pre-existing flake.
