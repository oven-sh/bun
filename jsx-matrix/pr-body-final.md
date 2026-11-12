Fixes #15844

### Problem
- A JSX option from `bunfig.toml`, a `--jsx-*` flag or `Bun.build({ jsx })` is lost when `tsconfig.json` sets the same option. tsconfig `"jsx": "react-jsx"` plus bunfig `jsx = "react"` gives `jsxDEV`, which neither file states.
- Cause: `TSConfigJSON::merge_jsx` (9 callers) merges each tsconfig.json over a dense `Pragma`, which cannot tell a stated option from a default.

### Fix
- Each source states only what it was given (`jsx::Stated`). `Pragma::from(Stated)` alone fills defaults. `merge_jsx` and `api::Jsx` are gone.
- Rule (second commit): a tsconfig.json does not decide an option that one of those sources states. `NODE_ENV` still picks dev or production.
- Verified: `test/bundler/transpiler/jsx-tsconfig-react-jsx.test.ts` (14 of 25 fail on main). Output matrix of 5,067 cells against main: 0 unexplained differences.

### Background
- `Pragma` is the JSX configuration the parser reads. Layers, lowest first: the user's sources, the working directory's tsconfig.json and `NODE_ENV`, the file's tsconfig.json.
- Considered a "was set" bitset on `Pragma` with a gate in `merge_jsx` (this PR's first version). It keeps the merge in every resolve. The sparse value removes it and ends four more defects (Notes).

### Downsides
- Behaviour change: an option set both in tsconfig.json and in bunfig.toml, a flag or `Bun.build` now takes the latter, also under a nested, node_modules or `--tsconfig-override` tsconfig.json. esbuild does the opposite.
- `api::TransformOptions` grows from 584 to 752 bytes per transpiler. `Pragma` shrinks from 152 to 64. A `Pragma` clone with a stated import source and factory: 6 allocations before, 0 now.

<details><summary>Notes</summary>

**Defects that end with the old carrier (first commit).** In each one the dense `Pragma` was written in the wrong order or copied whole.
- `bun run --jsx-factory=x file.jsx` beside a bunfig.toml that sets `jsxFactory` took bunfig.toml, because `bun run` loads bunfig.toml after the flags and the load overwrote them. `bun file.jsx` took the flag. Both take the flag now.
- `NODE_ENV=production bun build` beside a tsconfig.json that states no dev or production runtime used the development runtime. The whole-`Pragma` copy of the tsconfig wrote its default over what `NODE_ENV` chose. Open PR #38050 fixes the same case.
- A `key` after a spread compiles to `createElement`, imported from the package of `jsxImportSource`. With the import source in tsconfig.json the import came from `react` on every path except the plain CLI without a bunfig.toml (also in #38050). `Bun.Transpiler#scanImports` listed `react` in the same way. The import source is one value now (`jsx::ImportSource`), so the runtime module and the package cannot differ.
- `bun test --parallel` beside a bunfig.toml: the coordinator sent its merged JSX state to the workers as `--jsx-*` flags. The workers then used the production runtime and a serial run the development one. The coordinator now sends only the flags that were typed, and each worker reads bunfig.toml itself.

**Not changed.**
- The dev or production default of each source: any bunfig.toml means development, a `--jsx-*` flag with a value means production, `Bun.build` means development. They are three constants in `jsx::Sources` now. #48152, #48337 and #48338 change them.
- `bun run` and `bun test` apply the tsconfig.json of the working directory to every file. `bun build` applies the nearest one to each file.
- A file that `Bun.build` takes from `files` uses the built-in defaults.
- `--jsx-side-effects` alone has no effect.
- An option that a source states wins over `NODE_ENV` only where it did before. For example `jsx = "react-jsxDEV"` in bunfig.toml with `NODE_ENV=production` still gives the production runtime.

**Output matrix.** One process for each cell, on the canary of the merge base (1.4.4-canary.1+89452d2ac) and on a debug build of this branch.
- 4,662 cells: 7 tsconfig.json states x 6 bunfig.toml states x (5 flag sets x 6 CLI entry points + 7 `Bun.build` variants) x 3 `NODE_ENV` values. Each file has an element, a fragment and a `key` after a spread.
- 405 cells: a nested tsconfig.json, `extends`, `--tsconfig-override`, a package in node_modules with its own tsconfig.json, `Bun.Transpiler`, a Worker, and `Bun.build` with a file in memory and a plugin module.
- Expected output of a cell: what main prints beside the tsconfig.json that is left when the options that the user's sources state are taken out of it.
- Result: 2,870 cells equal main. 1,607 move by the rule. 590 move only by the four defects above (87 `bun run` flags, 12 `NODE_ENV=production`, 491 `createElement` package). 0 other differences.

**Measurements.** Local release builds of the merge base and of this branch, same toolchain.
- `build/release/bun`: 143,284,496 to 143,259,920 bytes. `.text`: 112,978,537 to 112,951,657 bytes (26,880 fewer). `.bss`: 256 more.
- Type sizes (`-Zprint-type-sizes`): `jsx::Pragma` 152 to 64 bytes, `resolver::Result` 288 to 192, `TSConfigJSON` 312 to 232, the resolver's `BundleOptions` 960 to 808, `api::TransformOptions` 584 to 752.
- Allocations for one `Pragma` clone, counted in a unit test, for the states default / import source / factory / both: 0 / 4 / 2 / 6 on main, 0 / 0 / 0 / 0 here. The runtime clones a `Pragma` for each transpiled module and main's resolver cloned one for each resolve.
- `bun build` of 3,001 `.tsx` files, 15 interleaved runs each: median 1,346 ms on main (1,212 to 1,744) and 1,377 ms here (1,193 to 2,538). The difference is below the noise. The two outputs are byte-identical.
- Instruction counts are not measured: `perf` and `valgrind` are not in the build container.

**esbuild.** esbuild 0.21.5 applies tsconfig.json over `--jsx` and `--jsx-factory`. `REVIEW.md` makes the reference implementation the spec for ported code, so this is a deliberate difference. It follows the request that an explicitly set option in bunfig.toml wins.

**Open question for a maintainer.** Should `--jsx-*` flags and `Bun.build({ jsx })` win over tsconfig.json as bunfig.toml does? This PR says yes, because `docs/runtime/bunfig.mdx` says that flags override bunfig.toml. If the answer is "bunfig.toml only", the change is in `jsx::Sources::stated`. The first commit alone keeps main's order and can land without the second.

**Earlier version of this PR.** It added `set_fields` to `api::Jsx` and `Pragma` and a gate in `merge_jsx`. It allocated once for each resolve for projects with `jsxImportSource` in tsconfig.json, it did not change the ahead-of-time compiler's copy of the merge, and `set_fields` was a second record of what the values already say.

</details>

<!-- robobun:evidence:begin -->

---

**[review]** gate passed · iteration 4 · 15 files touched

<details><summary>fails on main (without fix)</summary>

```console
ASAN without fix: BUILD FAILED (no junit output)
$ BUN_DEBUG_QUIET_LOGS=1 bun scripts/build.ts --profile=debug --quiet test "--reporter=junit" "--reporter-outfile=/tmp/mechgate.xml" test/bundler/bundler_jsx.test.ts "test/regression/issue/15844.test.ts"
ninja: Entering directory `/workspace/bun/build/debug'
[1/4] gen generated_host_exports.rs
generated_host_exports.rs: 92 exports (host=3, lazy=10, generic=79, rust=0); 240 extern-C blocks audited
[1/4] cargo bun_bin → libbun_rust.a (--target x86_64-unknown-linux-gnu)

  nightly-2026-07-20-x86_64-unknown-linux-gnu unchanged - rustc 1.99.0-nightly (9f36de775 2026-07-19)

FAILED: rust-target/x86_64-unknown-linux-gnu/debug/libbun_rust.a 
/workspace/bun/build/release/bun /workspace/bun/scripts/build/stream.ts rust --console --env=CARGO_TERM_COLOR=always --env=BUN_CODEGEN_DIR=/workspace/bun/build/debug/codegen --env=CC=/usr/lib/llvm-21/bin/clang --env=CXX=/usr/lib/llvm-21/bin/clang++ --env=AR=/usr/lib/llvm-21/bin/llvm-ar --env=CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER=/usr/lib/llvm-21/bin/clang++ --env=CARGO_HOME=/root/.cargo --env=RUSTUP_HOME=/root/.rustup --env=RUSTUP_TOOLCHAIN=nightly-2026-07-20 --env=CARGO_PROFILE_RELEASE_LTO=off --env=CARGO_PROFILE_RELEASE_CODEG
... (truncated)

release without fix: 14 failed, 4 skipped
bun test v1.4.0-canary.1 (6e906e468)

test/bundler/bundler_jsx.test.ts:
(pass) bundler > jsx/AutomaticDev [22.06ms]
(pass) bundler > jsx/AutomaticProd [12.11ms]
(todo) bundler > jsx/AutomaticFragmentDev
(todo) bundler > jsx/AutomaticFragmentProd
(pass) bundler > jsx/AutomaticFragmentNamedImportDev [12.63ms]
(pass) bundler > jsx/AutomaticFragmentNamedImportProd [11.95ms]
(pass) bundler > jsx/AutomaticLocalShadowDev [12.51ms]
(pass) bundler > jsx/AutomaticLocalShadowProd [14.73ms]
(pass) bundler > jsx/AutomaticLocalShadowMinifyIdentifiersProd [7.41ms]
(pass) bundler > jsx/AutomaticLocalShadowMinifyIdentifiersDev [5.39ms]
(pass) bundler > jsx/ClassicDev [12.10ms]
(pass) bundler > jsx/ClassicProd [12.98ms]
(pass) bundler > jsx/ClassicPragmaDev [11.35ms]
(pass) bundler > jsx/ClassicPragmaProd [14.49ms]
(todo) bundler > jsx/PragmaMultipleDev
(todo) bundler > jsx/PragmaMultipleProd
(pass) bundler > jsx/FactoryDev [13.08ms]
(pass) bundler > jsx/FactoryProd [13.25ms]
(pass) bundler > jsx/FactoryImportDev [12.67ms]
(pass) bundler > jsx/FactoryImportProd [13.06ms]
(pass) bundler > jsx/FactoryImportExplicitReactDefaultDev [7.25ms]
(pass) bundler > jsx/FactoryImportExplicitReact
... (truncated)
```

</details>

<details><summary>passes on PR (with fix)</summary>

```console
ASAN with fix: 4 skipped
$ BUN_DEBUG_QUIET_LOGS=1 bun scripts/build.ts --profile=debug --quiet test "--reporter=junit" "--reporter-outfile=/tmp/mechgate.xml" test/bundler/bundler_jsx.test.ts "test/regression/issue/15844.test.ts"
bun test v1.4.0 (6e906e468)

test/bundler/bundler_jsx.test.ts:
(pass) bundler > jsx/AutomaticDev [1034.77ms]
(pass) bundler > jsx/AutomaticProd [664.03ms]
(todo) bundler > jsx/AutomaticFragmentDev
(todo) bundler > jsx/AutomaticFragmentProd
(pass) bundler > jsx/AutomaticFragmentNamedImportDev [633.79ms]
(pass) bundler > jsx/AutomaticFragmentNamedImportProd [623.48ms]
(pass) bundler > jsx/AutomaticLocalShadowDev [675.23ms]
(pass) bundler > jsx/AutomaticLocalShadowProd [655.63ms]
(pass) bundler > jsx/AutomaticLocalShadowMinifyIdentifiersProd [347.75ms]
(pass) bundler > jsx/AutomaticLocalShadowMinifyIdentifiersDev [319.09ms]
(pass) bundler > jsx/ClassicDev [691.13ms]
(pass) bundler > jsx/ClassicProd [722.17ms]
(pass) bundler > jsx/ClassicPragmaDev [669.17ms]
(pass) bundler > jsx/ClassicPragmaProd [660.26ms]
(todo) bundler > jsx/PragmaMultipleDev
(todo) bundler > jsx/PragmaMultipleProd
(pass) bundler > jsx/FactoryDev [655.32ms]
(pass) bundler > jsx/FactoryProd [683.29ms]
... (truncated)

release with fix: 4 skipped
$ bun scripts/build.ts --profile=release
[configured] bun-profile → bun (stripped)
  target       linux-x64-gnu
  build type   Release
  build dir    ./build/release
  revision     2b315348f9
  features     baseline

23 deps, 129 codegen, 1172 objects in 726ms

ninja: Entering directory `/workspace/bun/build/release'
[1/1244] install /workspace/bun
bun install v1.4.0-canary.1 (6e906e468)

Checked 26 installs across 63 packages (no changes) [4.00ms]
[2/1244] gen ErrorCode+*.h
[3/1244] install /workspace/bun/packages/bun-error
bun install v1.4.0-canary.1 (6e906e468)

Checked 1 install across 2 packages (no changes) [1.00ms]
[4/1244] install /workspace/bun/src/node-fallbacks
bun install v1.4.0-canary.1 (6e906e468)

Checked 111 installs across 104 packages (no changes) [11.00ms]
[5/1244] gen bindgenv2
[6/1244] gen node-fallbacks/react-refresh.js
Bundled 1 module in 10ms

  react-refresh.js  4.81 KB  (entry point)

[7/1244] fetch tinycc
[tinycc] up to date
[8/1243] fetch zlib
[zlib] up to date
[9/1243] gen ProcessBindingConstants.lut.h
Generating /workspace/bun/build/release/codegen/ProcessBindingConstants.lut.h from /workspace/bun/src/jsc/bindings/ProcessBindingConsta
... (truncated)
```

</details>

<details><summary>diff hotspot</summary>

```
Cargo.lock                                   |   2 +-
 docs/runtime/bunfig.mdx                      |   2 +
 src/bundler/transpiler.rs                    |   6 +-
 src/bunfig/bunfig.rs                         |  21 +++-
 src/options_types/Cargo.toml                 |   1 +
 src/options_types/jsx.rs                     |  18 ++++
 src/options_types/schema.rs                  |   2 +
 src/resolver/Cargo.toml                      |   1 -
 src/resolver/tsconfig_json.rs                |  29 ++---
 src/runtime/api/JSBundler.rs                 |   6 ++
 src/runtime/api/js_bundle_completion_task.rs |   1 +
 src/runtime/cli/Arguments.rs                 |  20 +++-
 src/runtime/cli/test/parallel/runner.rs      |  18 ++--
 test/bundler/bundler_jsx.test.ts             |  16 ++-
 test/regression/issue/15844.test.ts          | 153 +++++++++++++++++++++++++++
 15 files changed, 251 insertions(+), 45 deletions(-)
```

</details>

**gate history** · 9 passed · 0 rejected · iteration 4

<details><summary>evidence per changed file</summary>

```
file                                          reads  edits  tests
Cargo.lock                                        0      0      0
docs/runtime/bunfig.mdx                           1      1      0
src/bundler/transpiler.rs                        10      6      0
src/bunfig/bunfig.rs                              1      1      0
src/options_types/Cargo.toml                      1      1      0
src/options_types/jsx.rs                          3      5      0
src/options_types/schema.rs                       1      1      0
src/resolver/Cargo.toml                           1      1      0
src/resolver/tsconfig_json.rs                     7      8      0
src/runtime/api/JSBundler.rs                      2      1      0
src/runtime/api/js_bundle_completion_task.rs      5      1      0
src/runtime/cli/Arguments.rs                      2      2      0
src/runtime/cli/test/parallel/runner.rs           3      3      0
test/bundler/bundler_jsx.test.ts                  0      0      0
test/regression/issue/15844.test.ts               5      6      0
```

</details>

<!-- robobun:evidence:end -->
