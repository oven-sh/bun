Fixes #15844.

## Repro

```sh
printf '{ "compilerOptions": { "jsx": "react-jsx" } }' > tsconfig.json
printf 'jsx = "react"\njsxFactory = "React.createElement"\n' > bunfig.toml
printf 'export const App = () => <div className="app">hello</div>;\n' > index.tsx

bun build ./index.tsx --external react
# before: jsxDEV from react/jsx-dev-runtime  (bunfig ignored)
# after:  React.createElement                (bunfig wins)
```

## Cause

`TSConfigJSON::merge_jsx` applied every field tsconfig set, regardless of whether the incoming `Pragma` already carried a user-set value. The user-set side (`api::Jsx` / `Pragma`) had no per-field was-set tracking, so nothing could gate that overwrite. `configure_linker_with_auto_jsx` likewise did a wholesale `options.jsx = tsconfig.jsx` copy (or skipped tsconfig entirely) instead of merging.

## Fix

- `options_types::jsx`: add `JsxField` / `JsxFieldSet` (moved from the resolver) and `Pragma.set_fields`; carry it through `api::Jsx` and `Pragma::from_api`.
- `bunfig.rs`: populate `set_fields` for each `jsx*` key actually present, and stop materialising an `api::Jsx` when no `jsx*` keys are present (previously every bunfig load created one with default values, which itself masked tsconfig).
- `Arguments.rs` / `JSBundler.rs`: populate `set_fields` for each `--jsx-*` flag / `Bun.build({jsx})` option passed.
- `tsconfig_json.rs`: `merge_jsx` now computes `jsx_flags.difference(current.set_fields)` and only applies those. The tsconfig `extends` chain still merges child-over-parent because the base config's `set_fields` is empty.
- `transpiler.rs` `configure_linker_with_auto_jsx`: always merge the root tsconfig instead of the wholesale copy, so explicit user config survives and non-tracked fields like `side_effects` are preserved.
- `test/parallel/runner.rs`: the `bun test --parallel` coordinator re-emits the jsx config to each worker as `--jsx-*` flags. It forwarded `--jsx-runtime` whenever any jsx config existed, which under the new rule would mark the runtime user-set in the worker and block its tsconfig. It now forwards only the fields in `set_fields`, so a parallel run transpiles the same as a serial one.
- `docs/runtime/bunfig.mdx`: document the precedence.

## Precedence

`--jsx-*` / `bunfig.toml` `jsx*` / `Bun.build({jsx})` > `tsconfig.json` `compilerOptions.jsx*` > defaults, per field. A field not set in the higher tier still falls through to tsconfig.

## Behavior change

`Bun.build({jsx: {runtime: "automatic"}})` with a `tsconfig.json` that sets `"jsx": "react-jsx"` now emits the production `jsx` runtime (tsconfig's `development: false` fills the gap the user did not set) instead of `jsxDEV`. Previously `Bun.build({jsx})` caused tsconfig JSX to be skipped entirely. One `jsxSideEffects` snapshot in `bundler_jsx.test.ts` updated to reflect this; its `sideEffects` assertion is unchanged.

## Verification

`test/regression/issue/15844.test.ts` covers bunfig `jsx`/`jsxFactory`/`jsxImportSource` overriding tsconfig, `--jsx-runtime` overriding tsconfig, tsconfig still applying when bunfig has no jsx keys, the `jsxImportSource` key-after-spread fallback, a bunfig `react-jsxDEV` surviving an unrelated `--jsx-*` flag, and `bun test` versus `bun test --parallel=2` producing the same runtime on one fixture (the bunfig/CLI override cases fail on the released binary and pass here).

`bundler_jsx.test.ts`, `esbuild/tsconfig.test.ts`, `jsx-tsconfig-react-jsx.test.ts`, `transpiler-tsconfig-uaf.test.ts`, and `test/config/bunfig/` all pass.

## Overlap

This PR originally also carried the one-line `--tsconfig-override` fd fix for #22023; that is the same change as #34980, which is now the PR for it, so the resolver hunk and its tests were dropped from this branch (b97aa8c7e7) and the two no longer touch the same files. #36269 addresses the `--jsx-*` vs tsconfig dev/prod interaction from the bundler side with a different mechanism and will need reconciling with the `set_fields` approach here. #36209 changes the `development` default in `Arguments.rs` and is orthogonal.

## Rebase notes

The branch is squashed to one commit and rebased onto main. Two rebases needed manual resolution:

- #39631 (`jsx: keep the default factory when a tsconfig or pragma factory has no members`) changed `Pragma::from_api` to return `Pragma` instead of `Result<Pragma>`; this PR adds `pragma.set_fields = jsx.set_fields` before that return. Resolved by keeping both. An explicit but invalid factory such as `--jsx-factory=.` still marks `Factory` as user-set, so it yields the built-in default rather than the tsconfig value; valid flags and tsconfig-only configs behave as before. The `factoryMemberList` tests from #39631 pass on this branch.
- #39732 (dead code removal across Cargo manifests) removed `enum-map` from `src/resolver/Cargo.toml` and `enumset` from `src/options_types/Cargo.toml`, while this PR removes `enumset` from the resolver and starts using it in `options_types`. Resolved so the resolver keeps neither and `options_types` gets `enumset` back. The net `Cargo.lock` change is that one dependency edge moving from `bun_resolver` to `bun_options_types`, which is where `JsxField` now lives.

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




