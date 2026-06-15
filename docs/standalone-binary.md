# `bun-standalone` — the `--compile` runtime binary

`bun-standalone` is a second build of the `bun` executable with the toolkit
subcommands compiled out. It exists so that `bun build --compile` can produce
smaller single-file executables: the embedded runtime only needs to *run*
JavaScript, not bundle it, install packages, or run a test suite.

The binary name is `bun-standalone` (`bun-standalone.exe` on Windows). Debug
and instrumented variants follow the same suffix scheme as the full binary
(`bun-standalone-debug`, `bun-standalone-asan`, …).

## What's removed

The CLI dispatch for every subcommand other than the run path is replaced
with an error message pointing at the full Bun install:

  - `bun build`
  - `bun test`
  - `bun install` / `add` / `remove` / `update` / `link` / `unlink` / `pm` /
    `outdated` / `publish` / `audit` / `why` / `info` / `patch`
  - `bun init` / `create` / `x` / `upgrade`

`bun <file>`, `bun run`, `bun --eval/--print`, `bun exec`, `bun repl`, and
the `node`-shim entry remain.

The dispatch sever is the load-bearing change: with the per-tag `exec_*`
bodies gone, `--gc-sections` (driven by `.llvm_addrsig`, which both rustc and
clang emit) drops the now-unreferenced `bundle_v2` / `PackageManager` /
`TestCommand` machinery from the final image. The C++ object set is unchanged
— `build-cpp` produces one archive that both `bun` and `bun-standalone` link
against.

## How it's built

`cfg.standalone` (a boolean on the build `Config`) drives three things:

  - `cargo build -p bun_bin --features standalone` with
    `RUSTFLAGS="… --cfg=bun_standalone"` into a separate `--target-dir`
    (`rust-target-standalone/`), so the full and standalone staticlibs can
    coexist in one build directory.
  - the linked executable is named `bun-standalone[-profile]` and the
    stripped output `bun-standalone`.
  - `bun_core::build_options::STANDALONE_BUILD` is `true`.

Gating in Rust is on `cfg(bun_standalone)` (the global RUSTFLAG), not
`cfg(feature = "standalone")`, so any crate can branch on it without
threading a cargo feature through the workspace graph. The cargo feature on
`bun_bin` → `bun_runtime` exists so `cargo check -p bun_bin --features
standalone` is a valid invocation.

Locally:

```sh
bun run build:standalone           # release → build/release-standalone/bun-standalone
bun run build:standalone:debug     # debug   → build/debug-standalone/bun-standalone-debug
```

In CI, each release platform gets two extra steps that reuse the existing
`build-cpp` artifact:

```
<target>-build-cpp               (shared)
<target>-build-rust              ────────► <target>-build-bun
<target>-build-rust-standalone   ────────► <target>-build-bun-standalone
```

`scripts/build/ci.ts::downloadArtifacts` derives the rust sibling from the
step-key suffix; the cpp sibling is always `<target>-build-cpp`. Packaged
artifacts are `bun-standalone-<os>-<arch>[-musl][-baseline].zip`.

## Size

Linux-x64 release, May 2026 linker map:

| | MB |
|---|--:|
| stripped `bun` | 83.2 |
| bundler + css + install + test + bake + toolkit CLI | −7.1 |
| **`bun-standalone` (this change)** | **~76** |
| | |
| ICU data (`.rodata`) | 23.7 |
| JavaScriptCore `.text` | 22.9 |
| Bun C++ bindings + WebCore + BoringSSL + codecs | ~10 |
| runtime transpiler (parser/printer/ast/resolver) | 2.4 |

The < 35 MB target requires shipping a reduced ICU data file (small-icu is
~5 MB instead of 24 MB) on top of this; that is a WebKit-prebuilt change
tracked separately.

## Follow-up work

This change lands the build infrastructure and the CLI-dispatch sever. The
remaining `#[no_mangle]` entry points that keep subsystem code alive are
mapped in `src/runtime/standalone_build.rs` and gated incrementally:

  - `Bun.build()` / `JSBundlerPlugin__*` → stub to throw, drops `BundleV2`.
  - `Bun.color()` / `JS2Zig__css_internals_*` → stub, drops `bun_css`.
  - `bun:test` module / `Expect*` codegen classes → needs a C++-side
    `#if !BUN_STANDALONE` around `jest.classes.ts` codegen and
    `matchAsymmetricMatcherAndGetFlags` in `bindings.cpp`.
  - `bake` DevServer → cfg the `dev_server` field on `ServerInstance` and the
    `AnyRoute::FrameworkRouter` variant.
  - `bun_standalone_graph` read/write split → make `bun_bundler` /
    `bun_libarchive` / `bun_http` optional behind a `write` feature so the
    standalone binary only carries the graph reader.
  - `--compile` target selection → add `standalone: bool` to `CompileTarget`
    so cross-compile downloads `@oven/bun-standalone-<target>` and same-host
    builds don't short-circuit to `self_exe_path()`.
