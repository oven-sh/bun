---
description: Upgrade Bun's WebKit fork to the latest upstream version of WebKit
---

Upgrade Bun's WebKit fork (vendor/WebKit = oven-sh/WebKit) to the latest upstream WebKit.

Two modes — pick from ARGUMENTS:

- **Direct (default)**: push the merge straight to oven-sh/WebKit main. Confirm with the user before pushing.
- **Preview** (when ARGUMENTS contains `preview` or `pr`): never push to main. Open a PR on oven-sh/WebKit and use its auto-built preview release instead.

To do that:

- cd vendor/WebKit (must be a real clone with an `upstream` remote pointing at WebKit/WebKit)
- git fetch upstream
- OLD_BASE=$(git merge-base origin/main upstream/main) — save this for the changelog
- Preview mode: create a working branch (e.g. `bun/upgrade-to-<upstream-short-sha>`) instead of staying on main
- git merge upstream/main
- Fix the merge conflicts (preserve the fork's Bun-specific changes)
- Do the part of the merge that git does not show: "The ahead-of-time compiler" below, before the build
- bun run jsc:build:debug — from the bun repo root, builds just JSC (and its `jsc` shell), in bun's own build graph. File lists come from the checkout, but `scripts/build/deps/webkit.ts` restates WebKit's generator commands, compiler flags and option values by hand, and nothing checks them. Read `git diff $OLD_BASE upstream/main -- Source/cmake Source/JavaScriptCore/CMakeLists.txt Source/WTF/wtf/CMakeLists.txt Source/bmalloc/CMakeLists.txt` for changed `add_custom_command`s (→ `gen()`), compiler flags (→ `webkitFlags()`) and `WEBKIT_OPTION_*` / `SET_AND_EXPOSE_TO_BUILD` (→ `rows`), and carry them over in the bun PR
- While it compiles, in another task review the JSC commits between $OLD_BASE and upstream/main (Source/JavaScriptCore, Source/WTF, Source/bmalloc). Write up a summary in a file called "webkit-changes.md"
- bun run build:local — full Bun build with the local WebKit (same build directory and objects as the JSC build above)
- After it compiles, run some code to make sure things work: `bun run build:local -p '42'`
- Run the checks of "The ahead-of-time compiler" below, with the local build
- Publish the new WebKit:
  - Direct: cd vendor/WebKit, commit, `git push origin main`. The push triggers a release tagged `autobuild-<full-sha>`.
  - Preview: push the branch and open a PR on oven-sh/WebKit. CI publishes a prerelease tagged `autobuild-preview-pr-<PR#>-<first-8-chars-of-head-sha>`. (The branch has to be in oven-sh/WebKit itself: CI builds nothing for a PR from a fork.) The PR lands as a merge commit, never a squash: the next upgrade finds $OLD_BASE through the upstream parent.
- Wait until the release exists: `gh release view <tag> --repo oven-sh/WebKit`. For a push to main it is created only after ALL platform builds succeed (takes a while). A PR's is published with the lanes that were built, also when some failed. Bun's CI downloads prebuilts from it, so don't open the bun PR before it's up.
- Read the rest of that CI run (`gh pr checks <PR#> --repo oven-sh/WebKit`, or `gh run list --repo oven-sh/WebKit --commit <sha>` for a push). The release does not wait for its `Test` jobs. They run upstream's JSTests and `testaot`, `testb3` and `testair` on the Linux lanes. `JSTests/BUN-TEST-DIFFERENCES.md` in the fork says how to sort a failing test.
- cd back to bun and update WEBKIT_VERSION in scripts/build/deps/webkit.ts:
  - Direct: the new vendor/WebKit commit sha
  - Preview: the full preview tag (`autobuild-preview-pr-...`)
- git checkout -b claude/webkit-upgrade-<sha> (branch must start with `claude/` for CI)
- commit + push (without adding the webkit-changes.md file). The commit has what the ahead-of-time compiler's checks changed in bun: `test/aot/engine-tests`, `src/codegen/builtins/data/own-properties.txt`
- create a PR titled "Upgrade WebKit to <upstream-short-sha>", paste webkit-changes.md into the description
  - Preview mode: also note in the description that WEBKIT_VERSION points at a preview build and must be bumped to the merge-commit's `autobuild-<sha>` after the oven-sh/WebKit PR merges — do that bump before merging the bun PR
- In bun's CI, hold each failing test of the ahead-of-time compiler against a recent build of `main` before you put it down to the upgrade, also in a step that does not hold up the merge (`test/aot/README.md` says what CI runs). List in the PR what fails only here. `test/bundler/compile-aot-size.test.ts` has size bounds that only go down: if the new engine is over one, give the numbers and leave the bound to a maintainer.
- delete the webkit-changes.md file

The ahead-of-time compiler (`bun build --compile --aot`). Its engine half is `Source/JavaScriptCore/aot` in the fork, and its front end is `src/aot` here. Upstream has no such folder, so git never reports a conflict in it. But it is written against upstream's code: it keeps copies and descriptions of upstream's built-ins, it calls JavaScriptCore's internals, and it shares B3 and Air with the JIT. So a merge can break it, or make a compiled program do something else than `bun run` does, where git shows nothing. `Source/JavaScriptCore/aot/README.md` in the fork and `src/aot/CLAUDE.md` here explain the compiler.

Before the build, in vendor/WebKit:

- `git log --oneline <bun's WEBKIT_VERSION>..origin/main -- Source/JavaScriptCore/aot` lists the compiler's commits that the fork's main has and bun's main has not pinned. The merge sits on top of them, so the new pin brings them too. The two halves of the compiler land together (a change under `aot/ir/schema` needs both), so one of these commits can wait for a bun PR that is not merged yet. Name them in webkit-changes.md. When bun does not build or a test of `test/aot` fails later, look at them before you look at upstream.
- Conflicts in upstream's files that the fork changed for the compiler (`b3/`, `heap/`, `runtime/`, `interpreter/`, `llint/`, `wasm/`, mostly under `#if ENABLE(AOT)`): the result has to compile with the compiler and without it. The lanes with no `-aot` in their name are built with `ENABLE_AOT=0`. Here that build is `bun scripts/build.ts --profile=debug-local --aot=off --build-dir=build/debug-local-no-aot --target=jsc`. Never run it beside another build: `--aot=off` has other patches for `vendor/mimalloc`, so its configure removes that folder and fetches it again.
- Read `git diff $OLD_BASE upstream/main -- Source/JavaScriptCore/builtins`, and note the upstream commits that change what a built-in does in C++. A compiled program gets such a change by itself only where the compiler calls upstream's code. Where the compiler has its own, make the change there too. Nothing compares these with upstream's. All but the last are under `aot/builtins/`:
  - The entry of the built-in in a `*.builtins.ts` file: what it takes, returns, reads, writes and calls back, and how compiled code does it (`implementation`).
  - An emitter in a `*Emitter.cpp` file, for an entry with `b.inline(..)`. It writes the code of the built-in itself.
  - A copy of upstream's file in `handwritten/`, for the files that `b.handwritten(..)` lists in `engine-syntax.builtins.ts`. Compiled programs run the copy, not upstream's file.
  - A model in `models/`, for an entry with `model:`. The flow analysis reads it.
  - `src/aot/prelude/` in bun: the compiler's own TypeScript for some array built-ins (`sort`, `indexOf`, `includes`, chains of `map`, `filter` and `join`).
- Objects, closures and environments of compiled programs are cells of the fork's own types: `CompiledObjectType`, `CompiledClosureType`, `SlimClosureType` and `CompiledEnvironmentType` in `runtime/JSType.h`. `CompiledClosureType` is inside `jsFunctionTypes`, and a compiled closure makes some of its properties only when they are asked for. Where upstream adds a fast path that goes by a range of `JSType`, or that reads properties off the `Structure` alone, check that it is right for these cells, or keep them out of it.
- B3 and Air are the compiler's back end. What they generate for a compiled program must not depend on the `Options` of whoever builds it, so an option that changes their code is a field of `B3::Policy` or `Air::Policy` (`b3/B3Policy.cpp`, `b3/air/AirPolicy.cpp`). Do the same for an option that upstream adds, and add it to `backEndOptions` in `test/aot/back-end-options-from-environment.test.ts`.

With the local build:

- `bun run jsc:build:debug` also generates the table of built-ins (the step `gen the table of built-ins`) from upstream's `builtins/*.js`, the `@begin` tables in upstream's C++ and `aot/builtins/*.builtins.ts`. When the step fails, its message names what to declare or to take out: a function of `builtins/*.js` that is new or gone, an `@intrinsic` that nothing declares, a new row of a table. WebKit's own cmake build checks less.
- The engine numbers its built-ins that are written in JavaScript in the order of their names, and tests name them by number (`runtimefunction id=<n>`). So a function that upstream adds, removes or renames moves every number behind it. Compare the list `FOR_EACH_AOT_ENGINE_BUILTIN_FUNCTION` of `AOTBuiltinIDs.h` before and after. Before: in the folder that `bun scripts/build/aot-paths.ts` prints as `AOT_BUILTINS_GENERATED`, which is in the pinned prebuilt (there once `bun bd` has run at the old pin). After: in `build/debug-local/deps/WebKit/JavaScriptCore/DerivedSources/aot`. Where a number moved, change it in `Source/JavaScriptCore/aot/tests` (the `.ir` files and the program texts in the `.cpp` files) and in `test/aot/engine-tests` here. A test with a stale number fails with a diagnostic that does not name the number. Do it again when the fork's main is merged into an open upgrade PR: the tests that landed there since have the old numbers.
- `ASAN_OPTIONS=detect_leaks=0 build/debug-local/jsc --useDollarVM=1 --useShadowRealm=1 --useTemporal=1 --useSharedArrayBuffer=1 vendor/WebKit/JSTests/stress/bun-aot-builtins-table.js` prints nothing when the table agrees with the engine. Otherwise each line names an entry to correct: a built-in that the merge added, removed, moved or implemented another way.
- `bun run build:local --target=testaot` builds the engine's tests against the merged engine. Run them with `ASAN_OPTIONS=detect_leaks=0`, like `jsc` above: some start the `jsc` beside them, and LeakSanitizer fails it at its exit. `build/debug-local/testaot run test/aot/engine-tests` has the tests that name entries of bun's table. `build/debug-local/testaot all vendor/WebKit/Source/JavaScriptCore/aot/tests` has the engine's own, about thirteen times as many. A debug build needs a long time for all of those, and the fork's `Test` jobs run them in a release build. So run at least `testaot run` on the folders `builtins` and `valueflow` and on the files that name a function by number. `--show-output` shows what a failing test printed. If the merge touched `b3/`, also build and run `--target=testb3` and `--target=testair`.
- Compile a program that uses the built-ins the upgrade changes, and run it: `bun run build:local build --compile --aot <file> --outfile <exe>`. It has to print what `bun run build:local <file>` prints.
- `bun run build:local test test/aot/builtins/own-properties.test.ts` holds `src/codegen/builtins/data/own-properties.txt`, the own properties of every built-in object, against the new engine. With `AOT_BUILTINS_UPDATE=1` it rewrites the file. The fork has such a list for its own `jsc`, `Source/JavaScriptCore/aot/tests/host/own-properties.txt`: a property that upstream adds or removes changes both.

Things to check for a successful upgrade:

- Did Source/JavaScriptCore/runtime/JSType.h change? The enum values must align with Bun's mirror in src/jsc/JSType.rs.
- Were there any changes to the WebCore code generator? If there are C++ compilation errors, check for differences in the generated reference code in vendor/WebKit/Source/WebCore/bindings/scripts/test/JS/
- If the merge touched the fork's .github/workflows or .github/scripts/lanes.mjs (the lanes and their names: a lane with the ahead-of-time compiler has `-aot` in its name), the release tarball names must still match prebuiltSuffix() in scripts/build/deps/webkit.ts
