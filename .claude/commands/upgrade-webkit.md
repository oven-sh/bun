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
- Wait until the release exists: `gh release view <tag> --repo oven-sh/WebKit`. For a push to main it is created only after ALL platform builds succeed (takes a while). A PR's release is published with the lanes that were built, even when some failed. Bun's CI downloads prebuilts from it, so don't open the bun PR before it's up.
- Read the rest of that CI run (`gh pr checks <PR#> --repo oven-sh/WebKit`, or `gh run list --repo oven-sh/WebKit --commit <sha>` for a push). The release does not wait for its `Test` jobs. They run upstream's JSTests and `testaot`, `testb3` and `testair` on the Linux lanes. `JSTests/BUN-TEST-DIFFERENCES.md` in the fork says how to sort a failing test. A lane itself can fail behind its link, on a check of the finished `jsc`: `Tools/Scripts/aot/README.md` in the fork says what each one finds.
- cd back to bun and update WEBKIT_VERSION in scripts/build/deps/webkit.ts:
  - Direct: the new vendor/WebKit commit sha
  - Preview: the full preview tag (`autobuild-preview-pr-...`)
- git checkout -b claude/webkit-upgrade-<sha> (branch must start with `claude/` for CI)
- commit + push (without adding the webkit-changes.md file). The commit has what the ahead-of-time compiler's checks changed in bun, such as `src/codegen/builtins/data/own-properties.txt`
- create a PR titled "Upgrade WebKit to <upstream-short-sha>", paste webkit-changes.md into the description
  - Preview mode: also note in the description that WEBKIT_VERSION points at a preview build and must be bumped to the merge-commit's `autobuild-<sha>` after the oven-sh/WebKit PR merges — do that bump before merging the bun PR
- The tests of the ahead-of-time compiler (`test/aot`) run in the ordinary shards of bun's CI. Hold each one that fails against a recent build of `main` before you put it down to the upgrade, and list in the PR what fails only here. `test/bundler/compile-aot-size.test.ts` has size bounds that only go down: if the new engine is over one, give the numbers and leave the bound to a maintainer.
- delete the webkit-changes.md file

The ahead-of-time compiler (`bun build --compile --aot`). Its engine half is `Source/JavaScriptCore/aot` in the fork, and its front end is `src/aot` here. Upstream has no such folder, so git never reports a conflict in it. But it is written against upstream's code: it has its own code and descriptions for upstream's built-ins, and it calls JavaScriptCore's internals. So a merge can break it, or make a compiled program do something else than `bun run` does, where git shows nothing. `Source/JavaScriptCore/aot/README.md` in the fork explains the compiler.

Before the build, in vendor/WebKit:

- `git fetch origin` first, and `git fetch origin tag <tag>` if bun's WEBKIT_VERSION is a preview tag. Then `git log --oneline <bun's WEBKIT_VERSION>..origin/main -- Source/JavaScriptCore/aot` lists the compiler's commits that the fork's main has and bun's main has not pinned. The merge sits on top of them, so the new pin brings them too. The two halves of the compiler land together (a change under `aot/ir/schema` needs both), so one of these commits can wait for a bun PR that is not merged yet. Name them in webkit-changes.md. When bun does not build or a test of `test/aot` fails later, look at them before you look at upstream.
- Conflicts in upstream's files that the fork changed for the compiler (`runtime/`, `heap/`, `llint/`, `interpreter/`, `bytecode/`, `wasm/`, mostly under `#if ENABLE(AOT)`): the result has to compile with the compiler and without it. The lanes with no `-aot` in their name are built with `ENABLE_AOT=0`. From the bun repo root, that build is `bun scripts/build.ts --profile=debug-local --aot=off --build-dir=build/debug-local-no-aot --target=jsc`.
- Read `git diff $OLD_BASE upstream/main -- Source/JavaScriptCore/builtins`, and note the upstream commits that change what a built-in does in C++. A compiled program gets such a change by itself only where the compiler calls upstream's code. Where the compiler has its own, make the change there too. Nothing compares these with upstream's:
  - The entry of the built-in in `aot/builtins/*.builtins.ts`: what it takes, returns, reads, writes and calls back, and how compiled code does it (`implementation`).
  - An emitter, for an entry with `b.inline(..)`: a `*Emitter.cpp` file in `aot/builtins/` or `aot/codegen/`. It writes the code of the built-in itself.
  - The compiler's own version of an upstream file in `aot/builtins/handwritten/`, for the files that `b.handwritten(..)` lists in `aot/builtins/engine-syntax.builtins.ts`. Compiled programs run it, not upstream's `builtins/<File>.js`.
  - `src/aot/prelude/` in bun: TypeScript that stands for native code of the engine in compiled programs (`Array.prototype.sort`, `indexOf` and `includes`, `Array.from`).
- Objects, closures and environments of compiled programs are cells of the fork's own types: `CompiledObjectType`, `CompiledClosureType`, `SlimClosureType` and `CompiledEnvironmentType` in `runtime/JSType.h`. `CompiledClosureType` is inside `jsFunctionTypes`, and a compiled closure makes some of its properties only when they are asked for. Where upstream adds a fast path that goes by a range of `JSType`, or that reads properties off the `Structure` alone, check that it is right for these cells, or keep them out of it.

With the local build, from the bun repo root:

- `bun run jsc:build:debug` also generates the table of built-ins (the step `gen the table of built-ins`) from upstream's `builtins/*.js` and `aot/builtins/*.builtins.ts`. When the step fails, its message names what to declare or to take out: a function of `builtins/*.js` that is new or gone, a function that a file in `handwritten/` does not have yet, an `@intrinsic` that nothing declares. WebKit's own cmake build checks less.
- `ASAN_OPTIONS=detect_leaks=0 build/debug-local/jsc --useDollarVM=1 --useShadowRealm=1 --useTemporal=1 --useSharedArrayBuffer=1 vendor/WebKit/JSTests/stress/bun-aot-builtins-table.js` prints nothing when the table agrees with the engine. Otherwise each line names an entry to correct: a built-in that the merge added, removed, moved or implemented another way.
- `bun run build:local --target=testaot` builds the engine's tests against the merged engine. `build/debug-local/testaot all vendor/WebKit/Source/JavaScriptCore/aot/tests` runs them, and `testaot run <file or folder> --show-output` runs a part and shows what a failing test printed. Run them with `ASAN_OPTIONS=detect_leaks=0`, like `jsc` above: the tests under `answers/` start the `jsc` beside `testaot`, and LeakSanitizer fails it at its exit. A debug build needs a long time for all of them, and the fork's `Test` jobs run them in a release build.
- Compile a program that uses the built-ins the upgrade changes, and run it: `bun run build:local build --compile --aot <file> --outfile <exe>`. It has to print what `bun run build:local <file>` prints.
- `bun run build:local test test/aot/builtins/own-properties.test.ts` holds `src/codegen/builtins/data/own-properties.txt`, the own properties of every built-in object, against the new engine. With `AOT_BUILTINS_UPDATE=1` it rewrites the file. The fork has such a list for its own `jsc`, `Source/JavaScriptCore/aot/tests/host/own-properties.txt`: a property that upstream adds or removes changes both.

Things to check for a successful upgrade:

- Did Source/JavaScriptCore/runtime/JSType.h change? The enum values must align with Bun's mirror in src/jsc/JSType.rs.
- Were there any changes to the WebCore code generator? If there are C++ compilation errors, check for differences in the generated reference code in vendor/WebKit/Source/WebCore/bindings/scripts/test/JS/
- If the merge touched the fork's .github/workflows or .github/scripts/lanes.mjs (the lanes and their names: a lane with the ahead-of-time compiler has `-aot` in its name), the release tarball names must still match prebuiltSuffix() in scripts/build/deps/webkit.ts
