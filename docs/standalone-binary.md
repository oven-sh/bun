# `bun-standalone` — the `--compile` runtime binary

`bun-standalone` is a second build of the `bun` executable with the toolkit
subcommands compiled out. It exists so that `bun build --compile` can produce
smaller single-file executables: the embedded runtime only needs to _run_
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

|                           |          bytes |        MB |
| ------------------------- | -------------: | --------: |
| stripped `bun`            |     70,389,048 |     67.13 |
| stripped `bun-standalone` |     62,392,896 |     59.50 |
| **delta**                 | **−7,996,152** | **−7.63** |

`bloaty` section diff: `.text` −6.80 MB, `.rodata` −849 KB.

Per-crate VM size from `bloaty -d compileunits` (full → standalone):

| crate             | full MB | standalone MB |     Δ |
| ----------------- | ------: | ------------: | ----: |
| `bun_runtime`     |    6.45 |          4.75 | −1.70 |
| `bun_install`     |    2.03 |          0.03 | −2.00 |
| `bun_css`         |    1.77 |             0 | −1.77 |
| `bun_bundler`     |    1.61 |          0.44 | −1.17 |
| `bun_css_jsc`     |    0.10 |             0 | −0.10 |
| `bun_install_jsc` |    0.05 |             0 | −0.05 |

The remaining `bun_bundler` 0.44 MB is the `Transpiler` half (single-file
TS→JS, options/defines/cache, `analyze_transpiled_module`) which is
structurally embedded in `VirtualMachine` and required by the module loader.

The < 35 MB target additionally requires shipping a reduced ICU data file
(small-icu ≈ 5 MB instead of 24 MB) — a WebKit-prebuilt change. The hard
floor with full ICU is JSC 22.9 MB + ICU 23.7 MB + bindings/crypto/codecs
≈ 57 MB.
