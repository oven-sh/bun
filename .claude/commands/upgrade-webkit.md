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
- bun run jsc:build:debug — from the bun repo root, builds just JSC (and its `jsc` shell), in bun's own build graph. File lists come from the checkout, but `scripts/build/deps/webkit.ts` restates WebKit's generator commands, compiler flags and option values by hand, and nothing checks them. Read `git diff $OLD_BASE upstream/main -- Source/cmake Source/JavaScriptCore/CMakeLists.txt Source/WTF/wtf/CMakeLists.txt Source/bmalloc/CMakeLists.txt` for changed `add_custom_command`s (→ `gen()`), compiler flags (→ `webkitFlags()`) and `WEBKIT_OPTION_*` / `SET_AND_EXPOSE_TO_BUILD` (→ `rows`), and carry them over in the bun PR
- While it compiles, in another task review the JSC commits between $OLD_BASE and upstream/main (Source/JavaScriptCore, Source/WTF, Source/bmalloc). Write up a summary in a file called "webkit-changes.md"
- In the same task, run `BUN_WEBKIT_PATH=vendor/WebKit bun scripts/webcore-copies.ts $OLD_BASE upstream/main` from the bun repo root. Put the commit id in place of `$OLD_BASE` if the task's shell does not have the variable. `BUN_WEBKIT_PATH` makes the script read the clone of this routine, also when the shell has another value for it. The script lists the upstream commits in that range that touch a file Bun has its own copy of. Bun does not build Source/WebCore. The files under src/jsc/bindings that come from it (most are in webcore/ and webcrypto/) were copied and edited by hand, and the merge does not change them. An upstream fix reaches a copy only when it is ported. The build is reading the bun checkout: in this task, change no file of the checkout but webkit-changes.md and, where a line below says so, `upstreamOf` in the script
  - For each commit, read `git -C vendor/WebKit show <sha> -- <the files listed under it>` beside Bun's copy. A behavior change (a bug fix, a spec update) applies when the copy still has the code that it changes, even where the lines no longer match. If the title names a behavior, try it with the installed `bun`. A refactor that changes no behavior needs no port
  - "% same" is how much of the code of the upstream file the copy also has. The upstream file is taken as it was before these commits, or as the commit that adds it has it. A file with fewer than 8 lines of code has no number. The number tells how well a diff of the file lines up with the copy. It is low when Bun has few of the file's functions, and when either side has edited them. A low number is no reason to skip a commit
  - "(binding)" marks Bun's `JS<Name>.cpp` for a changed `<Name>.idl`: compare the change with that binding
  - "(gone)" marks an upstream file that the new base does not have, on each commit that touches it. `git -C vendor/WebKit show --stat <sha>` of the newest of those commits shows where its code went, if that commit also adds the new file. If an earlier commit added it, `git -C vendor/WebKit grep -l '<a function of the gone file>' -- Source` finds it
  - `upstreamOf` in the script names the upstream files of a copy that have another file name than the copy. Without an entry, only a file of the same name leads to a copy. When a commit moves code of a copy into an upstream file of another name (it renames the file or splits it), name that file for the copy in `upstreamOf` and run the script again. When the script says that a file in `upstreamOf` "is gone since" a commit, name the file that has its code now, or take the file out
  - Not listed: changes to upstream's implementation of streams. src/jsc/bindings/webcore/streams is Bun's own. A changed `.idl` of a stream class is listed when Bun has a `JS<Name>.cpp` for it. Also not listed: WebCore code that Bun keeps in a file of another name, unless `upstreamOf` names it
  - In webkit-changes.md, write how many commits the script listed. For each commit that applies, write the number of the issue or PR that already covers it (search first), of the PR that ports it ("this PR" for a port in the upgrade PR), or of a new issue. Write "already in Bun" for a fix that Bun has in another form. Port with a test, after the build below has finished or in a PR of its own
- bun run build:local — full Bun build with the local WebKit (same build directory and objects as the JSC build above)
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
