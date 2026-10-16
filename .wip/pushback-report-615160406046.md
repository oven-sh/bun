# Design review: #36696, "bunx, bun create: read install config from the project root, like bun add"

## 1. Disposition

**`supersede`**: the feature is wanted and keeps this PR number, but this diff is replaced rather than merged or rebased, because #45307 merged to main on 2026-10-16 (e6f65f33c7) with the primitives the feature needs and a bunx test this diff contradicts, and its two design blockers (all 36 `[install]` fields reach the tool install; one `bunx` run uses more than one project root) need a different mechanism.

**Desirability verdict:** `wanted-in-a-different-shape` (confidence 0.75); pr_disposition `rework`. Do not close #36696. Do not merge this diff.

### The bigger shape

Same feature, same PR number, rebuilt on main 5866b5f13d. #36696 stays open as the feature's home; the current diff is dropped, not landed as step 1.

For a reader who has not opened the diff:

- **Main today.** `bunx <tool>` and `bun create <npm template>` spawn `bun add` inside a per-tool directory, `<install cache>/.bunx-<uid>/<tool>@<version>` (the "tree" below, reused for 24 hours). That install reads only the user's config, so a project's registry, scopes and tokens are ignored (#5361).
- **This diff.** It spawns that `bun add` in the invoking directory with a new hidden flag, `--bunx-install-dir <tree>`. `PackageManager::init` gets a read-only mode that loads bunfig.toml, .npmrc and .env at the project root, then changes directory a second time into the tree. The bunx parent appends `+config=<hash>` to the tree name, hashed from the path, size and mtime of each bunfig.toml/.npmrc found on a separate ancestor walk.
- **Refs.** Those prefixed `main:` are at 5866b5f13d (`git show origin/main:<path>`); all others are the PR working tree at 2d289ac0a6.

Main now has the pieces to deliver the feature without the flag, the `init` mode or the file-identity hash:

1. **One root, computed once in the bunx parent.**
   - Hoist the existing `bun_install::package_manager_real::project_directory(top_level_dir)` call out of `if !is_versioned` in `BunxCommand::exec` (main: /workspace/bun/src/runtime/cli/bunx_command.rs:897-898).
   - It wraps `find_project` (main: /workspace/bun/src/install/PackageManager.rs:2370; wrapper at :2437): `PackageJsonWalk` plus `find_workspace_root`, opened read-only, and it passes over a package.json that only has `type`.
   - Use that one directory for the project bin lookup, the tree name and the config root.
   - Delete `BunxCommand::project_config_cache_key` (/workspace/bun/src/runtime/cli/bunx_command.rs:450-513).
   - In `PackageManager::init`, delete the `read_only_walk` arms, `read_parent!` and the second-chdir block (/workspace/bun/src/install/PackageManager.rs:1941-2064, 2302-2349).
2. **The child stays in the tree.**
   - Keep main's spawn with `cwd` = the tree (main: /workspace/bun/src/runtime/cli/bunx_command.rs:1111) and `BUN_INTERNAL_BUNX_INSTALL=<tree>` (main: :1094-1096).
   - `run_tasks::is_bunx_tree(getcwd())` checks that marker (main: /workspace/bun/src/install/PackageManager/runTasks.rs:1930); a process that merely inherits the variable runs elsewhere and gets no bunx treatment.
   - Pass the root to the child through the internal environment, next to `BUN_INTERNAL_BUNX_HAS_COPY` (main: :1102-1104).
   - Delete `bun add --bunx-install-dir` (/workspace/bun/src/install/PackageManager/CommandLineArguments.rs:361, 1679-1686).
   - When `is_bunx_tree` holds, `init` overlays `bun_bunfig::arguments::load_install_section(root)` (main: /workspace/bun/src/bunfig/arguments.rs:212) with `overlay_bunfig_install`.
   - It also adds `<root>/.npmrc` to the `project_npmrcs` of `load_npmrc_files` (main: /workspace/bun/src/install/PackageManager.rs:1954), as `init_with_runtime_once` does for auto-install (main: :3137-3207).
3. **One decision per key, enforced by the compiler.**
   - Add `fn for_bunx(Api::BunInstall) -> Api::BunInstall` beside `overlay_bunfig_install` (main: /workspace/bun/src/install/PackageManager.rs:1839), destructured with no `..`, so a 37th field does not compile until someone decides it.
   - Proposed keep-list: `default_registry`, `scoped`, `url_auth`, `ca`, `cafile`, `minimum_release_age_ms`, `minimum_release_age_excludes`, `security_scanner`. Drop the other 28.
   - The cache directory stays the user's. `user_cache_directory` (main: :2047) and main's test (main: /workspace/bun/test/cli/install/bunx.test.ts:1677-1692) already pin that.
4. **Name the tree from the values the install will use.**
   - Main does this with `+trust` and `+min-age=<value>` (main: /workspace/bun/src/runtime/cli/bunx_command.rs:792-798, "What decides the content of a tree is part of its name"). Do not use file path, size and mtime.
   - A bunfig.toml that only sets `[install.cache]` then does not rename the tree, and a registry from `.env` or from a different root cannot share a tree with another registry.
   - Spell the new suffix without `=` (see the blocker in section 3).
5. **Keep from this PR.**
   - `Options.config_root` / `config_dir()` for the scanner's cwd (/workspace/bun/src/install/PackageManager/PackageManagerOptions.rs:51, 660-666).
   - /workspace/bun/test/cli/install/prefix-registry.ts, and the registry, scope, token, scanner and min-age tests.
   - Add rows for a type-only package.json, a nested package that is not a workspace member, a workspace member that holds the config, and a `.env` registry.
   - Leave script-spawned bunx (`BUN_WHICH_IGNORE_CWD`, main: /workspace/bun/src/runtime/cli/bunx_command.rs:745-750; the node-gyp shim) on user config.
6. **A separate small PR on main** for the settings a bunx install must override to work at all.
   - Put them in `Options::load`, gated on `is_bunx_tree` instead of `config_root`.
   - Clear `Enable::FROZEN_LOCKFILE` there (today at /workspace/bun/src/install/PackageManager/PackageManagerOptions.rs:1204-1208) and move the two user-level tests with it (/workspace/bun/test/cli/install/bunx.test.ts:2775-2792).
   - Whether `production`, `dryRun`, `linker` and `optional` join is the maintainer's call. Main has this bug today from `~/.bunfig.toml` alone.
7. **The body and docs name what is excluded.**
   - The legacy `bun create` templates, the `--compile --target` download (#25713), the scaffolder's own `bun install`, and lifecycle-script bunx.
   - For the scanner, either install a declared scanner on the bunx side or state that `bunx` exits 1 in a scanner-configured checkout before `bun install`.

**Maintainer sign-off is needed on four policies:**

- **Which files count.** The project root only (as `bun add` and npm do), or auto-install's chain from the root down to the cwd (main: /workspace/bun/src/install/PackageManager.rs:3145-3154). This includes whether the cwd's own bunfig.toml and .npmrc are read when the cwd is a shared directory such as /tmp; main's walk already ignores a package.json in a shared directory above the cwd (main: :2099-2107).
- **The keep-list in 3.**
- **The scanner in a fresh checkout.**
- **An unreadable project config.** Fail closed as #45307 does, or skip.

**Rough size (an estimate, not measured):** 150-250 source lines in bunx_command.rs, PackageManager.rs and env_var.rs, against +217/-19 today, with `init` losing its new mode. About +560 test lines, mostly carried over. The separate PR in 6 is 10-20 lines plus two tests.

**First step.** Force-push #36696 with a branch started from main 5866b5f13d. Its first commit hoists the `project_directory(top_level_dir)` call out of `if !is_versioned` in `BunxCommand::exec` and makes that one directory the config root and the tree-name input. The PR body states the root rule and the `for_bunx` keep-list for Jarred-Sumner's sign-off before anything else is reviewed.

### Why this diff is replaced and not rebased

1. **The base moved under it.** Dry three-way merge against main (re-run for this review):
   - /workspace/bun/src/install/PackageManager.rs conflicts: 145 PR-side lines, the `read_parent!` workspace loop against main's extracted `find_workspace_root` and `is_bunx_tree(child_cwd)`.
   - /workspace/bun/src/install/PackageManager/PackageManagerOptions.rs conflicts on the relative cache directory, and /workspace/bun/docs/runtime/bunfig.mdx conflicts.
   - /workspace/bun/src/runtime/cli/bunx_command.rs merges with no conflict into a broken state: the child is spawned in the invoking directory with `--bunx-install-dir`, while `BUN_INTERNAL_BUNX_INSTALL` now carries the tree path and main's dispatch expects the child to be in the tree (main: /workspace/bun/src/runtime/cli/mod.rs:729-731).
2. **It contradicts a test on main.** main: /workspace/bun/test/cli/install/bunx.test.ts:1677-1692 ("The files of the user, which the install that bunx spawns reads too. Not those of the project.") requires that a project bunfig.toml with `[install.cache] dir = "of-the-project"` neither renames the tree nor creates a directory in the project. Re-run on the PR build: the tree is `px-probe@latest+config=<hash>` and `of-the-project/` appears in the project.
3. **One run uses more than one project root, and they disagree.** Re-run: a nested package that is not a workspace member, below a project whose bunfig.toml names the PROJECT registry.
   - `bunx px-probe` in the nested directory installs from the USER registry into `px-probe@latest+config=<hash>`.
   - `bunx px-probe` at the project root then prints SERVED-BY-USER with zero requests.
   - In the other order, the nested directory runs the PROJECT copy with zero requests.
4. **All 36 `[install]` fields reach the tool install; about 8 have an ask.** Re-run: `dryRun = true` in the project's bunfig.toml makes `bunx` exit 1 with "could not determine executable to run for package px-probe". `offline`, `optional` and `linker` break it too (from the probes, not re-run here).
5. **The hidden flag is a user-reachable `bun add` option.** Re-run:
   - `bun add px-probe --bunx-install-dir <dir>` typed in a project exits 0 and installs from the project's registry into `<dir>`.
   - It is not in `bun add --help`.
   - A missing `<dir>` gives "ENOENT: Bun could not find a file, and the code that produces this error is missing a better error"; an empty one gives "failed to read/parse package.json for workspace ''".

Rebuilding on main's `project_directory` / `load_install_section` / `is_bunx_tree` removes the flag, the `read_only_walk` arms and the second chdir, and with them most of section 3.

### Basis

- **Reviewed:** the local branch at 2d289ac0a6 (a47917bca7 merged with main 5f5799ed16), 11 files, +781/-19 (source +217/-19 in 6 files, tests +562). Main 5866b5f13d is 16 commits ahead of that base.
- **Not pushed:** GitHub still shows the abandoned `--config=` draft fb3d4b73c1 (4 files, +622/-10, draft, conflicting). The branch must be pushed whatever else happens.
- **Concerns:** every one below survived adversarial refutation, with 4 skeptics per premise concern and 2 per execution concern.
- **Re-run for this synthesis:** the items marked "re-run", on /workspace/bun/build/debug/bun-debug (scripts /tmp/synth-verify/a.ts, b.ts, c.ts; harness /tmp/synth-verify/h.ts); the dry merge (/tmp/synth-verify/merge/); and a re-read of every `main:` ref.
- **Carried, not re-run:** everything else comes from the concern probes.

## 2. Why

**The feature is wanted and is routed to this PR.**

- https://github.com/oven-sh/bun/issues/5361 is open since 2023-09-14 with 11 thumbs-up (labels `bug`, `enhancement`). Its top comment asks for "the same [install] configuration options as bun install".
- Jarred-Sumner closed https://github.com/oven-sh/bun/issues/13247 as its duplicate on 2026-08-13.
- The "Not taken" list of #44968 (commit 9510e74152) reads "#36696: own feature (config root for bunx / create); #13247, #5361 open".
- #45307 does not deliver it: on main the spawned install still reads only the user's files (main: /workspace/bun/src/install/PackageManager.rs:2044-2046).
- A search of open PRs for "5361" returns #36696 and five unrelated PRs.
- Prior art supports the premise (premise 14): npm, pnpm, yarn and `deno run` take registry and credentials from the project for one-off execution. The PR build matched npm's local-prefix rule in all 9 layouts run against npm 11.16.0.

The two steelmen agree on the feature and differ only on this diff. Both were argued from the premise findings that had survived at that point, while #45307 was still open; it has merged since, which fixes the order.

> YES: "Not one of the five surviving findings, including the two that want the mechanism rebuilt on #45307, recommends closing this: all five say keep the feature as its own PR, and the only maintainer disposition of #36696 (the #44968 "Not taken" list) routes the feature to it with #5361 and #13247 left open, while #45307 neither mentions nor delivers it."

> NO: "In either merge order this diff does not survive the maintainer's own open PR #45307, which rewrites the same bunx/init hunks, already loads a project's install config by explicit directory with no mode inside `init`, and adds a bunx test commented "Not those of the project" that this build fails on both assertions, so what a maintainer would merge is a different diff built on those primitives [...]"

Both hold. Keep the PR, replace the diff.

**Design blocker: every `[install]` key reaches the tool install (premise 1; 10 and 15 for the user-level half; 14 for prior art).**

- All 36 `Api::BunInstall` fields of a project's bunfig.toml/.npmrc flow into the tool install. The diff hand-patches two: it clears `frozenLockfile` (/workspace/bun/src/install/PackageManager/PackageManagerOptions.rs:1204-1208) and joins a relative cache directory onto the project (:736-750).
- About 8 fields have an ask. Several of the rest break `bunx` in projects that work today:
  - `dryRun` (re-run, exit 1) and `offline` fail outright.
  - `optional = false` or `.npmrc omit=optional` installs and caches a tree without the tool's optional dependencies, which is where esbuild-style tools ship their platform binary.
  - `linker = "isolated"` makes `bunx -p pkg <bin of a dependency>` fail.
  - The cache directory is forbidden by main's test.
- The sentence at /workspace/bun/docs/runtime/bunfig.mdx:794 promises "the same files as `bun add`". Narrowing that after release is a breaking change.
- Main already has both halves of the fix:
  - `overlay_bunfig_install` destructures all 36 fields with no `..` (main: /workspace/bun/src/install/PackageManager.rs:1839; counted).
  - Auto-install takes "only the registries and their credentials" from a project `.npmrc` (main: /workspace/bun/src/install/PackageManager/PackageManagerOptions.rs:691-692).
  - /workspace/bun/src/bunfig/bunfig.rs:799-815 and 1465-1478 already drop `globalDir` / `globalBinDir` from a project's bunfig with a warning.
- The two parts that go beyond npm's model here, every install key shaping the tree and a tree named by config-file identity instead of the registry, are the two pnpm shipped and took back. It fixed the cache-key half as a bug in 9.6.0.

The same keys break bunx from user-level config alone:

- `~/.bunfig.toml` `dryRun = true`, `~/.npmrc` `dry-run=true` and `BUN_CONFIG_SKIP_INSTALL_PACKAGES=1` each give exit 1.
- `linker = "isolated"` and `optional = false` leave the tool without its dependency's bin or its optional dependency.
- `frozenLockfile = true` and `production = true` give "lockfile had changes, but lockfile is frozen".

Environment variables reach the same options, so a filter on `Api::BunInstall` cannot cover them. The overrides belong on the merged options in the bunx child, in their own PR. Tying that fix to a 781-line feature keyed on `config_root` leaves main broken for as long as the feature waits.

**Design blocker: one run, more than one project root (premise 2, 7; 4 for the policy; 9 for cost; 14 for `.env`).**

Main has a documented project-root function that bunx already calls: `project_directory` (main: /workspace/bun/src/install/PackageManager.rs:2437). This diff takes the config root from `init`'s nearest-package.json walk and the tree name from a third walk, `project_config_cache_key`, which counts the cwd plus every ancestor whose listing has a package.json (/workspace/bun/src/runtime/cli/bunx_command.rs:472). Rebased as is, one run would use three definitions:

- `project_directory` for the project's own copy of the tool;
- `init`'s walk for registry, scopes, credentials, `minimumReleaseAge` and the scanner;
- the key walk for the tree name.

They disagree in layouts that exist:

- **A nested package that is not a workspace member** (examples/, fixtures, a vendored project). Re-run, item 3 above. For the 24 hours the tree stays fresh, the project root runs a copy that came from the user registry and never passed the project's release-age gate or scanner.
- **A registry named in `.env`.** Re-run: a directory whose only config is `.env` with `BUN_CONFIG_REGISTRY` fills the un-suffixed `px-probe@latest`, and a plain directory then prints SERVED-BY-DOTENV with zero requests. The key covers 2 of the 6 config files the child reads.
- **A type-only package.json** (this repository has two). `bun file.mjs` auto-install takes the project's registry there, pinned by a test on main; bunx would not, so the 404 of #5361 stays for that layout.

/workspace/bun/REVIEW.md:40: cache keys cover every input that shapes the output, registry of origin included, and "A false hit is far worse than a false miss."

Main answers "whose bunfig.toml and .npmrc count" three ways:

- `bun add` reads the root only.
- Auto-install reads from the project root down to the importing file; the nearer file wins, and a scanner counts when in doubt (main: /workspace/bun/src/install/PackageManager.rs:3145-3186).
- `bun create`'s script check reads the typed-in folder and home (`config_ignores_scripts`, main: :2014).

This diff pins bunx to the first in a test row and a doc line. The issues do not say which directory, and the maintainer has not chosen. With `find_project`, the title's "like bun add" is inexact in the type-only layout, so the body has to say which definition bunx takes.

Cost:

- The diff's child walk lists every workspace member (`process_names_array`, /workspace/bun/src/install/PackageManager.rs:2143): 30-50 microseconds per member in a release build. That takes a 3-4 ms warm `bunx` to 28-45 ms in an 800-member workspace if the parent runs it on every run.
- `find_project` on main passes `members: None` to `find_workspace_root` (main: :2415-2421), which matches the `workspaces` patterns without reading any member.
- The rebuild gets the cheap form by using it. Measure a warm `bunx` from a member of a large workspace in the rebuild.

**The mechanism is at the wrong level (premise 3, 6, 8, 11).**

- All three config loaders are bound to the process cwd:
  - bunfig: /workspace/bun/src/bunfig/arguments.rs:285-298
  - .env: /workspace/bun/src/dotenv/env_loader.rs:665
  - .npmrc: /workspace/bun/src/install/PackageManager.rs:2286
- The diff keeps that coupling and works around it inside the function every install command calls. `read_only_walk` branches at /workspace/bun/src/install/PackageManager.rs:1951, 1968, 2026, 2059 and 2064.
- A block at :2302-2349 then changes directory again and re-points eight pieces of process state by hand: process cwd, CWD_BUF, the fs top-level dir, ROOT_PACKAGE_JSON_PATH, original_package_json_path_buf, workspace_package_json_cache, workspace_name_hash, entries_option.
- `init` grows from 727 to 799 lines. It has 12 call sites in 11 files and took 29 commits in 6 months.
- Main solved the same problem (the install root is not the config root) for auto-install by passing directories explicitly, with no mode in `init`.
- The diff's test "skips a project bunfig.toml that it cannot read" (/workspace/bun/test/cli/install/bunx.test.ts:2625) pins the opposite of #45307's fail-closed rule.
- /workspace/bun/.claude/docs/landing-prs.md:24 says anything user-reachable becomes de-facto supported forever. The typed flag is that.

**`init` ends up with two detached-install modes (premise 5).**

- `-g` (/workspace/bun/src/install/PackageManager.rs:1850-1870) and `--bunx-install-dir` (:1941, :2305-2349) plumb the same three directories (typed, config, install) separately.
- `config_root.is_empty()` doubles as the "is bunx" bit (/workspace/bun/src/install/PackageManager/PackageManagerOptions.rs:661, 738, 1206).
- One consequence is item 5 of section 3.
- The other is a contract gap: `bun add -g` still ignores the project's scopes, "Fixes #5361" closes the tracker for #13247, and nothing says that is intended.
- With the child kept in the tree, the bunx mode disappears. The body states that `-g` stays on user config on purpose, the line npm draws between `npm exec` and `npm install -g`.

**Script-spawned bunx is pulled in with no ask and no benefit (premise 12, 16).**

- `BunxCommand::exec` has three entry points:
  - typed `bunx` (/workspace/bun/src/runtime/cli/mod.rs:1381);
  - `bun create` (:1817);
  - the shim `bun x --silent node-gyp` that `bun install` puts on PATH for lifecycle scripts (/workspace/bun/src/install/PackageManager.rs:1267-1281; /workspace/bun/src/install/PackageManager/PackageManagerLifecycle.rs:335).
- About 50 issue searches found no request for the shim to follow the project registry.
- The diff does not deliver it either. The shim runs in `node_modules/<dep>`, so the child reads config there while the key hashes the outer project's files.
- Costs with nothing gained:
  - The project gets a new node-gyp tree after every edit, `touch` or checkout of bunfig.toml.
  - A warm offline build now needs the network.
  - The project registry is still not used.
- Only an `npm_config_registry` export from `bun install` would reach that path, and that is a separate change.
- Leave script-spawned bunx on user config and name it as excluded (/workspace/bun/REVIEW.md:33).

**The scanner gate is an undisclosed break (premise 13).**

- Fail-closed is the maintainers' line and stays.
- 17 issues mention "security scanner"; none asks for it to cover bunx. #31149 asks to skip or defer it.
- On the PR build, in a checkout with the scanner in devDependencies, `[install.security] scanner = "probe-scanner"` and no node_modules:
  - `bun add px-probe` exits 0 (it installs the scanner, then scans).
  - `bun x px-probe` and `bun create px-probe out` exit 1, with a hint to `bun add --dev` a package that is already a devDependency.
- 3 of 28 sampled scanner-configured projects with CI would go from green to red. About 175 public repos name a project-level scanner.
- The author wrote on the PR on 2026-10-01 that this "is a product decision. I will ask a maintainer for it". No maintainer has answered.

**The title and the docs sentence over-claim for `bun create` (premise 17, 18).**

- Two consumers still hardcode registry.npmjs.org:
  - the legacy templates `elysia`, `elysia-buchta` and `stric` (/workspace/bun/src/runtime/cli/create_command.rs:1513, 1746);
  - the `bun build --compile --target` download (/workspace/bun/src/options_types/compile_target.rs:120-130; #25713, in flight as #36173).
- A `create-*` tool that runs `bun install` in the new directory still gets a 404 for `@scope/*` in all four cells tested (2 layouts, bunfig and .npmrc), and exits 1 with a half-made `out/`.
- Do not fold any of them in. Name them, and write "`bun create <npm template>`" in the title and at /workspace/bun/docs/runtime/bunfig.mdx:794.

## 3. If it proceeds anyway: execution concerns

This applies only if the author keeps this diff against the disposition. Thirty concerns survived: 2 design blockers and 28 should-fix, merged here into 13. Each ends with what the rebuild does to it.

### Design blocker

**`+config=<hex>` puts `=` in the path of the node-gyp that Bun's own shim runs, so `bun install` of a native addon exits 1 in any project that has a bunfig.toml or .npmrc.** That is the population this PR is for. (execution 1, 2)

- Evidence:
  - The suffix is appended whenever the cwd or an ancestor with package.json lists either file, whatever its content (/workspace/bun/src/runtime/cli/bunx_command.rs:802-804).
  - The shim runs `bun x --silent node-gyp` from the package directory (/workspace/bun/src/install/PackageManager.rs:1269-1285).
  - node-gyp passes `-I <tree>/node_modules/node-gyp/addon.gypi`; gyp writes that path as a prerequisite of `Makefile:` and escapes only spaces; GNU make reads `Makefile: <word>=<rest>` as a target-specific variable.
  - End to end with node-gyp 13.1.0 (`sh /tmp/eqrev/repro.sh`): with no config file, exit 0 and the addon is built; with a bunfig.toml or .npmrc, exit 1 in the default Linux and macOS cache layouts.
  - Re-run of the make step alone (GNU Make 4.4.1): "recipe commences before first target" when the `=` path is the first prerequisite; clean with `+config-` or when the path sorts second.
  - No test reaches it: no cwd in /workspace/bun/test/cli/install/bunx.test.ts:2455-2811 has its own package.json below the config, and the existing shim tests set `npm_config_node_gyp` or ship a fake node-gyp.
- Do:
  - Keep `=` out of every tree name (`+config-<hex>`).
  - Add `=` to `BANNED_PATH_CHARS` (/workspace/bun/src/runtime/cli/bunx_command.rs:768-770).
  - Add a shim test in /workspace/bun/test/cli/install/bun-install-lifecycle-scripts.test.ts and a `node_modules/dep` row run in both orders.
- After the rebuild: stays. A keep-list value spelled the way main spells `+min-age=<value>` (main: /workspace/bun/src/runtime/cli/bunx_command.rs:796-798) puts `=` back in the path, so the new suffix and main's `+min-age=` both need an `=`-free spelling.

### Should-fix

**1. The tree name does not determine what filled the tree: it comes from a parent-side copy of the child's config discovery that nothing checks, and it leaves out `.env`.** (execution 3, 4, 12, 25)

- Evidence:
  - The parent hashes bunfig.toml and .npmrc only (/workspace/bun/src/runtime/cli/bunx_command.rs:450-513).
  - The child also merges the root's `.env*` (/workspace/bun/src/install/PackageManager.rs:2257-2276) into the loader that answers `BUN_CONFIG_REGISTRY` and its npm spellings, tokens and script env (/workspace/bun/src/install/PackageManager/PackageManagerOptions.rs:911-929, 945, 980-986).
  - Six layouts on the PR build have a name that does not match the config; the `.env` one is re-run above.
  - `bunx pkg@1.0.0` loses the one property it had on main, the same tree from any directory. `bunx --no-install pkg@1.0.0` fails in any project with a bunfig.toml.
  - `bunx --silent` still prints the `[Nms] ".env"` banner (/workspace/bun/src/dotenv/env_loader.rs:538, 622).
  - `bunx --env-file=X` reads X plus the default files, where `bun add --env-file=X` reads X only (child argv at /workspace/bun/src/runtime/cli/bunx_command.rs:1043-1070).
- Do:
  - Load the root's `.env*` into a second loader used only for `${VAR}` expansion.
  - Push `--no-env-file` to the child when the parent got `--env-file`.
  - Set `env.quiet` under `--silent`.
  - Add `px-probe@1.0.0` rows.
- After the rebuild: the false hits go with value-based names; the `.env` decision and the two flags stay.

**2. Path, size and mtime in the key strand a tree at every fresh checkout, `touch` or branch switch, and hide a tool that is already installed.** (execution 11, 17)

- Evidence:
  - The key is built at /workspace/bun/src/runtime/cli/bunx_command.rs:500-509.
  - 20 checkouts gave 20 trees (1 without a config file).
  - `bun pm cache prune` removed none, because names starting with `.` are never pruned (/workspace/bun/src/install/PackageManager/PackageManagerDirectories.rs:441-443; /workspace/bun/src/runtime/cli/pm_cache_prune_command.rs:116; pinned by /workspace/bun/test/cli/install/bun-pm.test.ts:1890-1937).
  - After `touch bunfig.toml` with the registry down, `bunx tool` exits 1 instead of warn-and-run (/workspace/bun/src/runtime/cli/bunx_command.rs:1151).
  - `bunx --no-install tool` fails (:971-977), against /workspace/bun/docs/pm/bunx.mdx:49.
- Do: hash the bytes, not the mtime.
- After the rebuild: gone.

**3. Checked-in project files move and reshape the code bunx executes.** (execution 7, 26, 27, 28)

- Evidence:
  - Cache directory (/workspace/bun/src/install/PackageManager/PackageManagerOptions.rs:736-750; re-run above), against the `.bunx-<uid>` trust boundary (/workspace/bun/src/runtime/cli/bunx_command.rs:515; /workspace/bun/test/cli/install/bunx.test.ts:1610-1634).
  - `linker = "isolated"` or `.npmrc node-linker` (:765-768): bunx puts only `<tree>/node_modules/.bin` on PATH (/workspace/bun/src/runtime/cli/bunx_command.rs:571-610), so the tool loses its dependencies' bins and `bunx -p pkg <dep-bin>` exits 1.
  - `optional = false`, `peer = false`, `.npmrc omit=` (:824-832): the install succeeds and the tool fails at run time on every run.
  - `ignore-scripts=true`: `bunx --trust` exits 0 with a `+trust` tree whose scripts never ran, and default-trusted tools (supabase, cypress, electron, puppeteer) lose their postinstall.
- Do: pin each next to the FROZEN_LOCKFILE clear (:1204-1208), and exit 1 with a message when `--trust` cannot be honoured.
- After the rebuild: gone. None of these keys is on the keep-list, and the user-level cases go to the separate PR.

**4. The read-only walk settles doubt toward the laxer root or aborts, and most of it has no test.** (execution 5, 15, 16, 23, 24)

- Evidence:
  - The arms are at /workspace/bun/src/install/PackageManager.rs:1948-1951, 1968-1972 and 2055-2064.
  - With a package.json the caller cannot write or open, `bun add` stops with EACCES and bunx installs from that root's registry (the layout of /workspace/bun/docs/guides/ecosystem/docker.mdx:21-54).
  - With an unparsable workspace-root package.json (conflict markers mid-merge), `bunx` from a member drops the root's registry, scanner and release-age gate without a word. That tree is reused under the root's `+config=` name once the file is fixed.
  - A root that can be entered but not listed aborts a cold `bunx` with a pathless `error: 'main' returned error.EACCES` (:2238-2245) where main installs.
  - Six of seven load-bearing clauses, plus four more, can be reverted with every new test green (for example `.npmrc` in the key, /workspace/bun/src/runtime/cli/bunx_command.rs:484-487).
- Do:
  - Do not pick a root when a package.json that decides it cannot be read; name the file and stop.
  - Add a "layouts where `bun add` stops" table with expected exit codes, and one test per clause (/workspace/bun/REVIEW.md:10).
  - No owner or fstat check in the walk.
- After the rebuild: the arms are gone, `find_project` reports `unreadable`, and fail-closed-or-skip is sign-off item four.

**5. `init` still returns the invoking cwd, which silently turns on `bunx tool@./dir`.** (execution 6, 19)

- Evidence:
  - The comment at /workspace/bun/src/install/PackageManager.rs:2302-2304 says only the cafile base keeps the invoking cwd.
  - The return at :2613 feeds `respell_local_paths` (/workspace/bun/src/install/PackageManager/updatePackageJSONAndInstall.rs:231-234; /workspace/bun/src/install/PackageManager/add_remove_with_filter.rs:428-431).
  - Folder, `file:`, `link:` and local tarball specs go from a clear error on main to installing from the invoking directory into a tree named by the unresolved literal.
  - A second directory that typed the same literal ran the first directory's code.
- Do: return the install directory and test that these specs still fail. A deliberate feature is its own PR (#11729).
- After the rebuild: gone.

**6. A duplicated, unchecked buffer write turns ENAMETOOLONG into a panic.** (execution 14, 22)

- Evidence:
  - /workspace/bun/src/install/PackageManager.rs:2225-2231 and :2326-2332 are the same six statements.
  - A tree path of 4083 to 4095 bytes aborts with `panic: range end index 4103 out of range for slice of length 4096` at :2330 (exit 134).
  - A deep invoking directory panics in the first copy, where main works.
  - /workspace/bun/REVIEW.md:47 and :57 apply.
- Do: one checked `enter_root` helper.
- After the rebuild: gone with the second chdir.

**7. Deleting the marker's workspace-search skip was not neutral, and bunx under a lifecycle script reads `node_modules/<dep>`.** (execution 9, 10)

- Evidence:
  - The gate at /workspace/bun/src/install/PackageManager.rs:2051-2052 lost `!is_bunx_install`.
  - The marker is still exported (/workspace/bun/src/runtime/cli/bunx_command.rs:1077-1080) and stripped only for the tool (:1117-1118).
  - So a `--trust` package whose postinstall runs `bun install` or `bun pm` walks every package.json from the tree up through the cache and $HOME, and fails on a malformed one.
  - ca7af85935 had the narrow form; 97282c8e47 dropped it with no reason given.
  - Under the shim, the child roots at `node_modules/<dep>/package.json` while the key hashes `<project>/bunfig.toml`.
- Do: restore the gated skip with a test row, and map a cwd under `node_modules` to the enclosing project or to no project config.
- After the rebuild: gone. `is_bunx_tree` compares directories, and script-spawned bunx stays on user config.

**8. The scanner now runs under bunx on the tool's stdin and stdout, and `bunx <scanner package>` installs the scanner and then fails.** (execution 20, 30)

- Evidence:
  - `Stdio::Inherit` at /workspace/bun/src/install/PackageManager/security_scanner.rs:908-911 and 1009-1012.
  - The prompt gates on `Output::is_stdin_tty()` only and prints to stdout (:369-378).
  - A `warn` advisory exits 1 wherever stdin is not a TTY; `x=$(bunx tool)` blocks on a prompt the user cannot see; advisory text lands in captured output.
  - The lookup uses the config root (:911) but the bootstrap still uses the tree (:699, :85-144, :264-281): "installed successfully", then "could not be found after installation attempt" (:1334-1361).
- Do:
  - Send the install's stdout to stderr under bunx (/workspace/bun/src/runtime/cli/bunx_command.rs:1084-1090).
  - Gate the prompt on the stream it writes to.
  - Skip NeedsInstall when `config_root` is set.
  - Test each.
- After the rebuild: stays. The scanner is on the keep-list.

**9. Bun's own hint becomes a dead end, and the daily refresh under project config is an untested mode.** (execution 8, 21)

- Evidence:
  - With a private default registry in the project `.npmrc`, `bun pm whoami` and `bun publish` say "run `bunx npm login`". On a machine without npm that prints `error: GET <registry>/npm - 401`, and bunx has no `--registry`.
  - A day-old tree with a lapsed token fails 3 of 3 runs with `GET .../PROJECT/px-probe - 401`, public tools included. Main refreshes those from the user registry.
- Do:
  - No 401/403 fallback: npx fails the same way, and a policy registry's 403 must not be bypassed.
  - State both under Downsides with the command that works (`BUN_CONFIG_REGISTRY=https://registry.npmjs.org bunx npm login`).
  - Name the file that set the registry in the 401/403 error.
  - Add day-old cells with `age()`.
- After the rebuild: stays.

**10. A relative `cafile` in the root's config breaks bunx from every subdirectory and workspace member.** (execution 18)

- Evidence:
  - /workspace/bun/src/install/PackageManager.rs:2528-2551 joins it onto the invoking cwd.
  - From `src/deep`: `HTTPThread: could not find CA file: '<project>/src/deep/certs/ca.pem'`, exit 1.
  - The PR lists this input as covered and has no test with a cafile.
  - Main resolves it against the config file since #45307.
- Do: add a relative-cafile row for the subdirectory and workspace-member layouts.
- After the rebuild: stays as a test row. `cafile` is on the keep-list.

**11. The only doc change is one sentence, and it is incomplete.** (execution 13)

- Evidence:
  - /workspace/bun/docs/runtime/bunfig.mdx:794 names two files. `.env` is a third and picks the registry on its own (re-run).
  - The pages for bunx, `bun create`, the scanner and `minimumReleaseAge` are untouched.
  - The PR's own stated downside (a public tool 404s in a project with a private default registry) is documented nowhere.
- Do: rewrite the sentence and add a configuration section to /workspace/bun/docs/pm/bunx.mdx, modeled on /workspace/bun/docs/runtime/auto-install.mdx:46-57.
- After the rebuild: stays, with the keep-list as its content.

**12. Nothing here has been compiled or run on Windows.** (execution 29)

- Evidence:
  - The reviewed commits have 0 statuses and 0 check runs.
  - The diff edits `spawn_windows` (/workspace/bun/src/install/PackageManager/security_scanner.rs:1012), which the Linux build does not compile.
  - `bun run rust:check-all` is not reported.
  - By reading, not run: from a UNC directory with no package.json the walk climbs above the share root and the install fails at chdir.
  - By reading, not run: the `$HOME` exclusion is a raw byte compare (/workspace/bun/src/runtime/cli/bunx_command.rs:481-486).
- Do: push, then report Windows CI for bunx.test.ts and bun-create.test.ts and the `rust:check-all` result.
- After the rebuild: stays. The UNC walk goes with the arms.

## 4. What was checked and held up

- **The premise.** Demand, reach, tracker history, value against cost and the counterfactual were each probed and none undercuts it. If this closes, #5361 stays open and nothing else delivers it.
- **Maintainer stance and intent.** The direction is not rejected and is routed to this PR; only the shape is undecided. The current behaviour (user config only) is an artifact of where the child is spawned, not a decision.
- **Other routes to the same result.** No in-flight PR supersedes it. "Users can already do this in a few lines" was probed and does not apply. No Node or web spec applies, and the direction is toward npm.
- **Naming the tree by registry identity, as a swap inside this diff.** Refuted 2 of 2: file identity is an accepted validator under /workspace/bun/REVIEW.md:40, and the swap alone did not fix the costs that concern led with. The rebuild takes value-based names for two other reasons: main's test forbids a cache-only bunfig.toml from renaming the tree, and the two false hits reproduced above.
- **Contract objections.** A missing opt-out flag, the env token and the user's release-age gate following the project registry, an unset token variable, and the failure message not naming the config file were all refuted or found not to apply. The claim that no override exists was wrong on the PR build; the rest are corollaries of documented, already-tested rules or a shared install message this PR does not touch.
- **Tests.** Parallel test helpers (a preference, not an enforced convention) and the time budget of the 30-cell matrix were dismissed. The same-size, same-tick edit of a config file was refuted by 1 of 2: the facts hold, the severity is low, and it is moot once the name stops using mtime.