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
- bun run build:local — full Bun build against the local WebKit (reuses the JSC build above)
- After it compiles, run some code to make sure things work: `bun run build:local -p '42'`
- Publish the new WebKit:
  - Direct: cd vendor/WebKit, commit, `git push origin main`. The push triggers a release tagged `autobuild-<full-sha>`.
  - Preview: push the branch and open a PR on oven-sh/WebKit. CI publishes a prerelease tagged `autobuild-preview-pr-<PR#>-<first-8-chars-of-head-sha>`. (Auto-triggers only for authors with write access; otherwise `gh workflow run build-preview.yml --repo oven-sh/WebKit -f pr_number=<N>`.)
- Wait until the release exists: `gh release view <tag> --repo oven-sh/WebKit`. It is created only after ALL platform builds succeed (takes a while). Bun's CI downloads prebuilts from it, so don't open the bun PR before it's up.
- cd back to bun and update WEBKIT_VERSION in scripts/build/deps/webkit.ts:
  - Direct: the new vendor/WebKit commit sha
  - Preview: the full preview tag (`autobuild-preview-pr-...`)
- git checkout -b claude/webkit-upgrade-<sha> (branch must start with `claude/` for CI)
- commit + push (without adding the webkit-changes.md file)
- create a PR titled "Upgrade WebKit to <upstream-short-sha>", paste webkit-changes.md into the description
  - Preview mode: also note in the description that WEBKIT_VERSION points at a preview build and must be bumped to the merge-commit's `autobuild-<sha>` after the oven-sh/WebKit PR merges — do that bump before merging the bun PR
- delete the webkit-changes.md file

Things to check for a successful upgrade:

- Did Source/JavaScriptCore/runtime/JSType.h change? The enum values must align with Bun's mirror in src/jsc/JSType.rs.
- Were there any changes to the WebCore code generator? If there are C++ compilation errors, check for differences in the generated reference code in vendor/WebKit/Source/WebCore/bindings/scripts/test/JS/
- If the merge touched the fork's .github/workflows, the release tarball names must still match prebuiltSuffix() in scripts/build/deps/webkit.ts
