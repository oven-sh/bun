Fixes #15844

### Problem
- A JSX option from `bunfig.toml`, a `--jsx-*` flag or `Bun.build({ jsx })` is lost when `tsconfig.json` sets the same option. tsconfig `"jsx": "react-jsx"` plus bunfig `jsx = "react"` gives `jsxDEV`.
- `TSConfigJSON::merge_jsx` merges each tsconfig.json over a dense `Pragma`, which cannot tell a stated option from a default.

### Fix
- First commit: each source states only what it was given (`jsx::Stated`) and `Pragma::from(Stated)` alone fills defaults. Four defects end (Notes).
- Second commit: an option that one of those sources states is read as if the project's tsconfig.json and the files it extends did not state it. Other tsconfig.json files keep theirs.
- Verified: `test/bundler/transpiler/jsx-tsconfig-react-jsx.test.ts` (15 of 27 fail on main). Output matrix, 5,127 cells against main: 0 unexplained differences.
- Self-reviewed: 6 concerns raised, 3 addressed, 3 need a maintainer (Notes).

### Background
- `Pragma` is what the parser reads. Layers, lowest first: the user's sources, the working directory's tsconfig.json and `NODE_ENV`, the file's tsconfig.json.
- The project's tsconfig.json is the nearest to the working directory. `TSConfigJSON` keeps what each file of an `extends` chain states.
- Considered a "was set" bitset on `Pragma` gating `merge_jsx`: the merge stays in every resolve.

### Downsides
- Breaking, no flag: a bunfig.toml key that tsconfig.json overrides today starts to apply. The docs sample (`jsxFactory = "h"`) beside `bun init`'s tsconfig.json throws `ReferenceError: h is not defined`.
- `api::TransformOptions` grows from 584 to 752 bytes. `Pragma` shrinks from 152 to 64, release `.text` by 26,880 bytes.

<details><summary>Notes</summary>

**What the self-review changed.** A review of this branch raised six concerns.
- Addressed: the rule also beat a nested tsconfig.json, a dependency's tsconfig.json and `--tsconfig-override`. Nobody asked for that. The rule now holds only for what the project's tsconfig.json and the files it extends state.
- Addressed: the new docs sentence had no limits. The docs now say which commands read the bunfig.toml keys and which files keep their own tsconfig.json.
- Addressed: a unit test pinned that `--jsx-side-effects` alone has no effect. #46007 and #41920 change that, so the pin is gone. The behaviour is still main's.
- Needs a maintainer: the rule is a breaking change without a flag (Downsides). `.claude/docs/landing-prs.md` asks for a flag when a default changes. Options: ship it as asked, keep tsconfig.json first and warn when it overrides a bunfig.toml key, or apply the rule to flags only.
- Needs a maintainer: should `--jsx-*` flags and `Bun.build({ jsx })` win over tsconfig.json as bunfig.toml does? This PR says yes: flags already override bunfig.toml, and `tsc --jsx` overrides tsconfig.json. esbuild does the opposite. If the answer is "bunfig.toml only", the change is in `jsx::Sources::stated`.
- Needs a maintainer: size and overlap. The first commit is about 1,100 lines and touches the JSX lines of `Arguments.rs` and `bunfig.rs` that #46007 also changes. With `jsx::Sources`, #46007 does not need `cli_overrides.jsx_*` or `jsx_side_effects`: the flags are already a source of their own. Whichever lands second has a rebase. If the carrier is too much, the rule also fits in a gate inside `merge_jsx` (about 550 lines with the ahead-of-time compiler's copy). That version keeps the four defects below.

**What the code review changed.**
- The rule follows an option to the file that states it. A tsconfig.json in a subdirectory that takes an option with `extends` from the project's tsconfig.json, or from a file that the project's one extends, no longer brings that option back over bunfig.toml. Each merged `TSConfigJSON` keeps what each file of its chain states (`jsx_of_files`), and `BundleOptions::lay_tsconfig` lays them file by file. The ahead-of-time compiler reads a file of the project without the stated options (`project_config_files`).
- A file of the project is known by the real path of its directory and its name, not by the address of its parsed value (`TSConfigJSON::name_files_under`). A tsconfig.json that is read again after its directory changed, or that is reached through a symbolic link to its directory, is still the project's. Not handled: a path that differs only in letter case on a case-insensitive volume. That file gets main's result.
- A `--jsx-factory=`, `--jsx-fragment=` or `--jsx-import-source=` flag with an empty value states nothing, as an empty value in bunfig.toml and in `Bun.build` (first commit). On main the empty flag reset the bunfig.toml value to the default, selected the production runtime and made `--jsx-side-effects` count.
- The ahead-of-time compiler's copy of the rule had a `development` bit that nothing read. It is gone: the bundler decides `development` and hands it over.

**The first commit can land alone.** It keeps main's order. To take the rule back out later, make `jsx::Sources::stated` state nothing.

**Defects that end with the old carrier (first commit).** In each one the dense `Pragma` was written in the wrong order or copied whole.
- `bun run --jsx-factory=x file.jsx` beside a bunfig.toml that sets `jsxFactory` took bunfig.toml, because `bun run` loads bunfig.toml after the flags and the load overwrote them. `bun file.jsx` took the flag. Both take the flag now.
- `NODE_ENV=production bun build` beside a tsconfig.json that states no dev or production runtime used the development runtime. The whole-`Pragma` copy of the tsconfig wrote its default over what `NODE_ENV` chose. Open PR #38050 fixes the same case.
- A `key` after a spread compiles to `createElement`, imported from the package of `jsxImportSource`. With the import source in tsconfig.json the import came from `react` on every path except the plain CLI without a bunfig.toml (also in #38050). `Bun.Transpiler#scanImports` listed `react` in the same way. The import source is one value now (`jsx::ImportSource`), so the runtime module and the package cannot differ.
- `bun test --parallel` beside a bunfig.toml: the coordinator sent its merged JSX state to the workers as `--jsx-*` flags. The workers then used the production runtime and a serial run the development one. The coordinator now sends only the flags that were typed, and each worker reads bunfig.toml itself.

**Not changed.**
- The dev or production default of each source: any bunfig.toml means development, a `--jsx-*` flag with a value means production, `Bun.build` means development. They are three constants in `jsx::Sources` now. #48152, #48337 and #48338 change them.
- `bun run` and `bun test` apply the tsconfig.json of the working directory to every file. `bun build` applies the nearest one to each file.
- In `Bun.build`, an entry point from `files` uses the built-in defaults, and a file that a plugin resolves takes the program's options and not its tsconfig.json.
- A standalone executable with `autoloadTsconfig` reads the JSX options of tsconfig.json only when `.env` autoload is on.
- `NODE_ENV` wins over a stated dev or production choice where it did before. `jsx = "react-jsxDEV"` in bunfig.toml with `NODE_ENV=production` still gives the production runtime.

**Output matrix.** One process for each cell, on the canary of the merge base (1.4.4-canary.1+447ff870b) and on a debug build of this branch.
- 4,662 cells: 7 tsconfig.json states x 6 bunfig.toml states x (5 flag sets x 6 CLI entry points + 7 `Bun.build` variants) x 3 `NODE_ENV` values. Each file has an element, a fragment and a `key` after a spread.
- 465 cells: a nested tsconfig.json, `extends`, a nested tsconfig.json that extends the project's one or its base file, `--tsconfig-override`, a package in node_modules with its own tsconfig.json, `Bun.Transpiler`, a Worker, and `Bun.build` with a file in memory and a plugin module.
- Expected output of a cell: what main prints when the options that the user's sources state are taken out of the project's tsconfig.json and the files it extends.
- Result: 2,952 cells equal main. 1,585 move by the rule. 590 move only by the four defects above (87 `bun run` flags, 12 `NODE_ENV=production`, 491 `createElement` package). 0 other differences.

**Measurements.** Local release builds of the merge base and of this branch, same toolchain. The binary sizes and the timing were taken before the rule was narrowed to the project's files. About 250 lines of source changed after that. The type sizes are current.
- `build/release/bun`: 143,284,496 to 143,259,920 bytes. `.text`: 112,978,537 to 112,951,657 bytes (26,880 fewer). `.bss`: 256 more.
- Type sizes (`-Zprint-type-sizes`): `jsx::Pragma` 152 to 64 bytes, `resolver::Result` 288 to 192, `TSConfigJSON` 312 to 256, the resolver's `BundleOptions` 960 to 808, `api::TransformOptions` 584 to 752.
- Allocations for one `Pragma` clone, counted in a unit test, for the states default / import source / factory / both: 0 / 4 / 2 / 6 on main, 0 / 0 / 0 / 0 here. The runtime clones a `Pragma` for each transpiled module, and main's resolver cloned one for each resolve.
- A tsconfig.json with `extends` costs one allocation for each file of its chain and one for the list, when it is loaded. A tsconfig.json without `extends` costs none. A build in which no user source states a JSX option lays each tsconfig.json as one merged value, as before.
- `bun build` of 3,001 `.tsx` files, 15 interleaved runs each: median 1,346 ms on main (1,212 to 1,744) and 1,377 ms here (1,193 to 2,538). The difference is below the noise. The two outputs are byte-identical.
- Instruction counts are not measured: `perf` and `valgrind` are not in the build container.

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
