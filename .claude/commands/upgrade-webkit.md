---
description: Upgrade Bun's WebKit fork to the latest upstream version of WebKit
---

Upgrade Bun's WebKit fork (oven-sh/WebKit, cloned at $BUN_WEBKIT_PATH) to the latest upstream WebKit.

Two modes — pick from ARGUMENTS:

- **Direct (default)**: push the merge straight to oven-sh/WebKit main. Confirm with the user before pushing.
- **Preview** (when ARGUMENTS contains `preview` or `pr`): never push to main. Open a PR on oven-sh/WebKit and use its auto-built preview release instead.

To do that:

- cd $BUN_WEBKIT_PATH (must be a real clone with an `upstream` remote pointing at WebKit/WebKit; vendor/WebKit is only the build's sparse fetch of the pinned commit)
- git fetch upstream
- OLD_BASE=$(git merge-base origin/main upstream/main) — save this for the changelog
- Preview mode: create a working branch (e.g. `bun/upgrade-to-<upstream-short-sha>`) instead of staying on main
- git merge upstream/main
- Fix the merge conflicts (preserve the fork's Bun-specific changes)
- bun run jsc:build:debug — from the bun repo root, builds just JSC
- While it compiles, in another task review the JSC commits between $OLD_BASE and upstream/main (Source/JavaScriptCore, Source/WTF, Source/bmalloc). Write up a summary in a file called "webkit-changes.md"
- bun run build:local — full Bun build with JSC compiled from $BUN_WEBKIT_PATH (`--local-deps=WebKit` on the debug profile); same graph as the JSC build above
- After it compiles, run some code to make sure things work: `bun run build:local -p '42'`
- Publish the new WebKit:
  - Direct: cd $BUN_WEBKIT_PATH, commit, `git push origin main`. The push triggers a release tagged `autobuild-<full-sha>`.
  - Preview: push the branch and open a PR on oven-sh/WebKit. CI publishes a prerelease tagged `autobuild-preview-pr-<PR#>-<first-8-chars-of-head-sha>`. (Auto-triggers only for authors with write access; otherwise `gh workflow run build-preview.yml --repo oven-sh/WebKit -f pr_number=<N>`.)
- Wait until the release exists: `gh release view <tag> --repo oven-sh/WebKit`. It is created only after ALL platform builds succeed (takes a while). Local (non-CI) builds download prebuilts from it; CI compiles the pinned commit from source, so the commit must at least be pushed to oven-sh/WebKit.
- cd back to bun and update WEBKIT_VERSION in scripts/build/deps/webkit.ts:
  - Direct: the new commit sha in your clone
  - Preview: the full preview tag (`autobuild-preview-pr-...`)
- Regenerate the derived file lists from your clone: `bun scripts/build/deps/generate-dep-sources.ts webkit $BUN_WEBKIT_PATH` (rewrites `scripts/build/deps/webkit-sources.ts`: JSC's unified bundles from Sources.txt, the framework header names, generator script inputs — review the diff). If ICU was bumped too: `bun scripts/build/deps/generate-dep-sources.ts icu vendor/icu`.
- Carry WebKit's build changes into `scripts/build/deps/webkit.ts` (bun compiles JSC itself; nothing reads WebKit's cmake or its tree at configure time). In the WebKit clone, diff the old base against the new one for exactly these files:
  `git diff $OLD_BASE upstream/main -- Source/JavaScriptCore/CMakeLists.txt Source/JavaScriptCore/Sources.txt Source/JavaScriptCore/inspector/remote/SourcesSocket.txt Source/WTF/wtf/CMakeLists.txt Source/WTF/wtf/PlatformJSCOnly.cmake Source/bmalloc/CMakeLists.txt Source/cmake/OptionsJSCOnly.cmake Source/cmake/OptionsCommon.cmake Source/cmake/WebKitFeatures.cmake Source/cmake/WebKitCompilerFlags.cmake Source/cmake/OptionsMSVC.cmake`
  and map each hunk:
  - **Loud** (the build fails until you do it): `WTF_SOURCES` / `bmalloc_SOURCES` entries → `wtfSourcesCommon` / `wtfSourcesFor` / `bmallocSources`; `JavaScriptCore_OBJECT_LUT_SOURCES` → `jscLutSources`; `JavaScriptCore_BUILTINS_SOURCES` → `jscBuiltinsSources`; `JavaScriptCore_INSPECTOR_DOMAINS` → `jscInspectorDomains`; new `*_PRIVATE_INCLUDE_DIRECTORIES` / header dirs → `jscIncludeDirs` / `jscHeaderDirs` / `wtfIncludeDirs`; offlineasm `.asm` files → `llintAsm`. (`Sources.txt` changes are covered by the regenerate step above.)
  - **Silent** (builds fine, behaves differently — read the diff): `WEBKIT_OPTION_DEFINE` / `WEBKIT_OPTION_DEFAULT_PORT_VALUE` / `SET_AND_EXPOSE_TO_BUILD` changes → the `rows` table (cmakeconfig.h); compile flags (`WEBKIT_PREPEND_GLOBAL_COMPILER_FLAGS`, `WEBKIT_ADD_TARGET_CXX_FLAGS`, `set_source_files_properties(... COMPILE_OPTIONS ...)`) → `webkitFlags()` or a per-file flag (e.g. `-fobjc-arc` on OSLogPrintStream.mm); generator invocations (`add_custom_command` COMMAND lines, `OFFLINE_ASM_ARGS`, builtins/inspector script arguments) → the matching `gen()` call; a new `add_custom_command` → a new `gen()` edge; DerivedSources headers added to `JavaScriptCore_PRIVATE_FRAMEWORK_HEADERS` → the generated-header list in `writeFrameworkHeaders()`.
- Build once with `bun run build:release --webkit=source` and run something (`-p '42'`); that is the configuration CI builds on every target.
- git checkout -b claude/webkit-upgrade-<sha> (branch must start with `claude/` for CI)
- commit + push (without adding the webkit-changes.md file)
- create a PR titled "Upgrade WebKit to <upstream-short-sha>", paste webkit-changes.md into the description
  - Preview mode: also note in the description that WEBKIT_VERSION points at a preview build and must be bumped to the merge-commit's `autobuild-<sha>` after the oven-sh/WebKit PR merges — do that bump before merging the bun PR
- delete the webkit-changes.md file

Things to check for a successful upgrade:

- Did Source/JavaScriptCore/runtime/JSType.h change? The enum values must align with Bun's mirror in src/jsc/JSType.rs.
- Were there any changes to the WebCore code generator? If there are C++ compilation errors, check for differences in the generated reference code in vendor/WebKit/Source/WebCore/bindings/scripts/test/JS/
- If the merge touched the fork's .github/workflows, the release tarball names must still match prebuiltSuffix() in scripts/build/deps/webkit.ts
