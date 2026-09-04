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
- bun run jsc:build:debug — from the bun repo root, builds just JSC
- While it compiles, in another task review the JSC commits between $OLD_BASE and upstream/main (Source/JavaScriptCore, Source/WTF, Source/bmalloc). Write up a summary in a file called "webkit-changes.md"
- bun run build:local — full Bun build with JSC compiled from vendor/WebKit (or $BUN_WEBKIT_PATH), same graph as the JSC build above
- After it compiles, run some code to make sure things work: `bun run build:local -p '42'`
- Publish the new WebKit:
  - Direct: cd vendor/WebKit, commit, `git push origin main`. The push triggers a release tagged `autobuild-<full-sha>`.
  - Preview: push the branch and open a PR on oven-sh/WebKit. CI publishes a prerelease tagged `autobuild-preview-pr-<PR#>-<first-8-chars-of-head-sha>`. (Auto-triggers only for authors with write access; otherwise `gh workflow run build-preview.yml --repo oven-sh/WebKit -f pr_number=<N>`.)
- Wait until the release exists: `gh release view <tag> --repo oven-sh/WebKit`. It is created only after ALL platform builds succeed (takes a while). Local (non-CI) builds download prebuilts from it; CI compiles the pinned commit from source, so the commit must at least be pushed to oven-sh/WebKit.
- cd back to bun and update WEBKIT_VERSION in scripts/build/deps/webkit.ts:
  - Direct: the new vendor/WebKit commit sha
  - Preview: the full preview tag (`autobuild-preview-pr-...`)
- Build once with `bun run build:release --webkit=source` (CI builds JSC/WTF/bmalloc from source in bun's own graph on every target). The file lists in the "Source mode: file lists" section of scripts/build/deps/webkit.ts mirror WebKit's CMakeLists (WTF_SOURCES, bmalloc_SOURCES/\_C_SOURCES, JavaScriptCore_OBJECT_LUT_SOURCES, \_BUILTINS_SOURCES, \_INSPECTOR_DOMAINS, include dirs): a file upstream added, removed or renamed shows up as "no such file" or an undefined/duplicate symbol — diff the upstream CMakeLists change and edit the list to match. Also diff `Source/cmake/OptionsJSCOnly.cmake`, `WebKitFeatures.cmake`, `WebKitCompilerFlags.cmake` and the generator invocations in `Source/JavaScriptCore/CMakeLists.txt` between the old and new base: a new option, compile flag or generator argument there does not fail the build, it has to be carried into webkit.ts (the `rows` table / flag lists / `gen` calls) by hand.
- git checkout -b claude/webkit-upgrade-<sha> (branch must start with `claude/` for CI)
- commit + push (without adding the webkit-changes.md file)
- create a PR titled "Upgrade WebKit to <upstream-short-sha>", paste webkit-changes.md into the description
  - Preview mode: also note in the description that WEBKIT_VERSION points at a preview build and must be bumped to the merge-commit's `autobuild-<sha>` after the oven-sh/WebKit PR merges — do that bump before merging the bun PR
- delete the webkit-changes.md file

Things to check for a successful upgrade:

- Did Source/JavaScriptCore/runtime/JSType.h change? The enum values must align with Bun's mirror in src/jsc/JSType.rs.
- Were there any changes to the WebCore code generator? If there are C++ compilation errors, check for differences in the generated reference code in vendor/WebKit/Source/WebCore/bindings/scripts/test/JS/
- If the merge touched the fork's .github/workflows, the release tarball names must still match prebuiltSuffix() in scripts/build/deps/webkit.ts
