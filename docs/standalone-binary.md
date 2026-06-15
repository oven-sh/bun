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

Linux-x64 release, non-LTO, measured on this branch:

| | bytes | MB |
|---|--:|--:|
| stripped `bun` | 70,389,048 | 67.13 |
| stripped `bun-standalone` | 67,439,800 | 64.32 |
| **delta** | **−2,949,248** | **−2.81** |

Per-crate VM size from `bloaty -d compileunits` (full → standalone):

| crate | full MB | standalone MB | Δ |
|---|--:|--:|--:|
| `bun_runtime` | 6.45 | 5.35 | −1.10 |
| `bun_install` | 2.03 | 1.10 | −0.93 |
| `bun_bundler` | 1.61 | 1.43 | −0.18 |
| `bun_css` | 1.77 | 1.74 | −0.03 |
| `bun_css_jsc` | 0.10 | 0 | −0.10 |
| `bun_install_jsc` | 0.05 | 0.06 | +0.01 |

The remaining `bun_css` / `bun_bundler` / `bun_install` weight is held alive
by **struct-field references from live runtime types**, which gc-sections
cannot sever even when the code paths are unreachable:

  - `bun_runtime::server::ServerInstance.dev_server: Option<Box<DevServer>>`
    → `bake::IncrementalGraph<bundle_v2::Side>` → `BundleV2` → `Chunk.css`.
  - `HTMLBundle` codegen class (`HTMLBundle__create`/`finalize` referenced
    from `ZigGeneratedClasses.cpp`) owns `BundleV2Result`.
  - `bun_bundler::Chunk` has `bun_css::BundlerStyleSheet` field types, and
    `Chunk` is reachable from `Transpiler` (which the runtime keeps).
  - `run_command.rs` workspace-script lookup and `shell_completions.rs`
    reference `bun_install` directly.

Recovering the remaining ~4 MB requires structural splits (own PRs):

  - cfg the `dev_server` field + `AnyRoute::FrameworkRouter` variant to a
    ZST under `bun_standalone`; cfg `pub mod bake` entirely.
  - Gate `HTMLBundle.classes.ts` codegen on a `BUN_STANDALONE` define so
    `ZigGeneratedClasses.cpp` stops referencing it (only C++-side change
    needed; the same `.a` can carry both via weak symbols, or split codegen).
  - Split `bun_bundler` into `bun_transpiler` (Transpiler/options/defines/
    cache/analyze, always on) and `bun_bundler` (BundleV2/Chunk/linker,
    gated). This is what severs the `bun_css` dependency.
  - Route `run_command`'s `package.json` scripts lookup through
    `bun_parsers::json` instead of `bun_install`.

The < 35 MB target additionally requires shipping a reduced ICU data file
(small-icu ≈ 5 MB instead of 24 MB) — a WebKit-prebuilt change.
