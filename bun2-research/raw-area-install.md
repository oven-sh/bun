# Bun 2.0 candidates - `bun install` / lockfile / bunfig / workspaces / bunx

### Binary `bun.lockb` and its orbit of workarounds (shipped admission)
what: Bun shipped a binary lockfile (`bun.lockb`) as the default for its entire 0.x/1.0/1.1 life, replaced it with text `bun.lock` in v1.2, but still ships the binary writer, the binary reader, a hidden `bun <path>.lockb` CLI overload that prints it as a *yarn* lockfile, the `--yarn`/`-y` flag, near-duplicate `bun pm hash`/`hash-print`/`hash-string` introspection commands, and two docs guides teaching the old workarounds.
where: `src/install/lockfile/bun.lockb.rs`; `src/runtime/cli/mod.rs:1462-1467` and `:1883-1915` (`/// \`bun ./bun.lockb\` - print lockfile as yarn.lock (or its hash with \`--hash\`)`); `src/install/PackageManager/CommandLineArguments.rs:58` (`-y, --yarn`); `src/bunfig/bunfig.rs:1383-1396` (`install.lockfile.print`); `src/runtime/cli/package_manager_command.rs:332-368` (hash/hash-print/hash-string); docs: `docs/pm/lockfile.mdx:32-53`, `docs/runtime/bunfig.mdx:471-480` (`install.saveTextLockfile = false` still writes `bun.lockb`), `docs/guides/install/git-diff-bun-lockfile.mdx` (git textconv workaround), `docs/guides/install/yarnlock.mdx` (`bun bun.lockb` prints yarn.lock).
evidence: `docs/pm/lockfile.mdx:51` - "Bun v1.2 changed the default lockfile format to the text-based `bun.lock`" (the flip IS the admission; blog linked from the doc: https://bun.com/blog/bun-lock-text-lockfile). Issue trail caused by the binary format: #5486 (request for text lockfile + `.gitignore bun.lockb`), #8274/#8306 (`.gitattributes` workaround in `bun init`), #9904 (odd file permissions), #13268 ("open bun.lockb make vscode crash"), #11037 ("bun.lockb prevents auto imports"), #13743 (`bun ./bun.lockb` runs through the script runner and prints dotenv messages), #11535 (`bun bun.lockb` crashes), #23980 open (crash when `bun.lockb` coexists with `bun.lock`), #20359 (docs still described lockb as default). `src/bunfig/bunfig.rs:1390`: `"Invalid lockfile format, only 'yarn' output is implemented"` - and `print = "bun"` is silently accepted as a no-op (`bunfig.rs:1385-1396`).
why bad: A binary lockfile is unreviewable in PRs and unmergeable in git; that one choice forced an entire parallel surface into existence (git textconv, `bun <file>.lockb`, `--yarn`, `bun pm hash*`). All of it is now legacy but still shipping and still documented.
bun 2.0 proposal: Remove the `bun.lockb` *writer* (delete `install.saveTextLockfile`), remove the `bun <path>.lockb` CLI overload, remove `--yarn`/`install.lockfile.print`, collapse `bun pm hash`/`hash-print` into one command (they print the same `fmt_meta_hash()`), keep only a read-once migrator.
blast radius: low - the default already flipped in 1.2; remaining users are one `bun install` away from migrating.
confidence: high.

### `trustedDependencies` + the baked-in 367-package default allow list
what: `bun install` blocks dependency lifecycle scripts by default - except for a 367-entry list of package names compiled into the binary; and if the user writes ANY `trustedDependencies` array, it silently *replaces* (does not extend) that default list. Meanwhile npm v12 is standardizing the same concept under a different field name (`allowScripts`).
where: `src/install/default-trusted-dependencies.txt` (367 entries, name-only, no version or integrity pinning); `src/install/lockfile.rs:3333-3365` - `has_trusted_dependency()` returns from the user list branch without ever consulting the default list (the default at `:3363` is only reached when `self.trusted_dependencies` is `None`); docs `docs/pm/lifecycle.mdx:35-66`.
evidence: `docs/pm/lifecycle.mdx:58` (verbatim): "Defining `trustedDependencies` in `package.json` **replaces** the default list rather than extending it." Issues: #7642 open "Allow disabling postinstall for top 500 packages" (commenter: "I understand the reasoning behind enabling pre/post install scripts for the top packages but it was a big step backwards for security"; another: "Are you sure? The documentation says these are just added to the already existing list"); #31026 (docs clarification needed for `[]`); #23070 open "`npm i` parity re. postinstalls" ("larger shops are saying that they need an escape hatch ... they cannot know their trusted dependencies ahead of time ... need a way to fully match npm with a `bun install --unsafe` flag"); #3756 open - explicitly: "Removes the need for users to maintain a `trustedDependencies` field that **no other package manager supports**"; #32218 open "Support `allowScripts`" (npm v12's spelling, citing https://github.blog/changelog/2026-06-09-upcoming-breaking-changes-for-npm-v12/); #11396 "Postinstall not blocked when installing @swc/core"; plus the long "my native module doesn't work" stream: #5472, #4891, #9527, #3497, #4705, #25900, #24329, #7594.
why bad: Three regrets fused together: (1) "secure by default" is not true - 367 packages run arbitrary code by name with no version/integrity pin, which is both a surprise and a supply-chain risk; (2) the replace-not-extend rule means the common fix (`"trustedDependencies": ["my-pkg"]`) silently *un-trusts* esbuild/sharp/etc. and breaks the next install; (3) the field name is about to collide with an npm standard.
bun 2.0 proposal: Delete the built-in default list (block everything by default, print the blocked list loudly). Make `trustedDependencies` additive, or replace it with npm's `allowScripts` / pnpm's `onlyBuiltDependencies` spelling and accept the old one as an alias with a deprecation warning.
blast radius: high - every project relying on a default-trusted package's postinstall breaks; must ship with a loud migration message.
confidence: high.

### `--production` silently implies `--frozen-lockfile` (and the docs disagree with each other and the code)
what: `bun install --production` / `[install] production = true` does not just omit `devDependencies`: it also enables `FROZEN_LOCKFILE` and `FAIL_EARLY`, so the install *errors out* if `bun.lock` is stale - undocumented, and divergent from `npm install --omit=dev`.
where: `src/install/PackageManager/PackageManagerOptions.rs:817-821` (CLI: `if cli.production { dev_dependencies = false; FAIL_EARLY; FROZEN_LOCKFILE }`) and `:506-512` (same from bunfig, plus `FORCE_SAVE_LOCKFILE = false`).
evidence: #10949 OPEN (since v1.1.7) "`bun install --production` enforce more settings than the docs state" - "error: lockfile had changes, but lockfile is frozen"; #7842 closed "Align install `--production` with the other package managers"; #4945, #21949, #11091, #2564 (closed by *changing `--production`* instead of adding `--no-frozen-lockfile` - dylan-conway: "Instead of `--no-frozen-lockfile`, `--production` was changed"). The two docs pages also contradict each other and the code: `docs/pm/cli/install.mdx:161` says production omits `devDependencies` **or** `optionalDependencies`; `docs/runtime/bunfig.mdx:433` says only `devDependencies`; the code (`:818`) only disables `dev_dependencies`.
bun 2.0 proposal: `--production` == `--omit=dev`, nothing else. Freeze is a separate concern (`--frozen-lockfile` / `bun ci`). Delete `[install] production` from bunfig (redundant with `[install] dev = false`).
blast radius: medium - Dockerfiles that rely on the implicit freeze need to add `--frozen-lockfile`.
confidence: high.

### Three spellings for "which dep kinds to install" - and the bunfig keys mean the OPPOSITE of the identically-named CLI flags
what: You can control dep kinds via `--omit dev|optional|peer`, via bunfig booleans `[install] dev/optional/peer`, and via `--production`. Worse: on `bun add`, `--dev`/`--optional`/`--peer` mean "*save* to devDependencies/optionalDependencies/peerDependencies", while in bunfig `install.dev`/`install.optional`/`install.peer` mean "*install* deps of that kind". Same token, orthogonal axis.
where: `src/install/PackageManager/CommandLineArguments.rs:108` (`--omit`), `:131-137` (`-d, --dev` = "Add dependency to \"devDependencies\""); `src/bunfig/bunfig.rs:1413-1419` (bunfig `optional`/`peer`/`dev` → schema fields literally named `save_optional`/`save_peer`/`save_dev`); `src/install/PackageManager/PackageManagerOptions.rs:485-500` (those `save_*` fields are applied as omit toggles: `local_package_features.dev_dependencies = save`).
evidence: `docs/runtime/bunfig.mdx:411-418` "`install.dev` - Whether to install development dependencies" vs `docs/pm/cli/add.mdx:22-30` "`--dev` ... add a package as a dev dependency". The internal schema name `save_dev` (a save-kind name) wired to an install-kind behavior shows the confusion is baked in. Also `PackageManagerOptions.rs:833-838`: `if cli.development { ... } else if cli.optional { ... } else if cli.peer { ... }` - combining flags silently drops all but the first.
bun 2.0 proposal: Replace the bunfig booleans with npm's `omit = [...]` / `include = [...]`. Keep `bun add --dev/--optional/--peer` as the only save-kind spelling. Delete `install.production`.
blast radius: low - these bunfig keys are rarely set.
confidence: high.

### `--no-save` is npm's flag name with non-npm semantics
what: Bun's `--no-save` means "don't update package.json **or** the lockfile". npm's `--no-save` means only "don't write to package.json" (the lockfile is a separate `--no-package-lock`). Because Bun already owns the name, it cannot add npm's behavior without a breaking rename.
where: `src/install/PackageManager/CommandLineArguments.rs:61-64` (help: `--no-save  Don't update package.json or save a lockfile`) and `:1208-1213` (link/unlink invert the default: `cli.no_save = !args.flag(b"--save")` vs `cli.no_save = args.flag(b"--no-save")`); `src/install/PackageManager/PackageManagerOptions.rs:695-699` (`SAVE_LOCKFILE = false; WRITE_PACKAGE_JSON = false`). `docs/pm/lockfile.mdx:24-30` documents it purely as a lockfile opt-out.
evidence: #10716 OPEN "Support `bun add --no-save`" - "Just like npm, bun should allow you to install a package without modifying `package.json`"; #16965 open "`bun install --no-save` saves a lockfile when it shouldn't"; #30407 open "Add a flag for `bun update` to update the lockfile without saving to `package.json`"; #14710 open, #12994 open (`--no-save` ignored in combination with `--yarn`).
bun 2.0 proposal: `--no-save` → package.json only (npm semantics). Add `--no-lockfile` (already exists in bunfig as `install.lockfile.save = false`). Make `bun link`'s inverted default explicit instead of reusing the same flag.
blast radius: medium - anyone using `--no-save` today for "no lockfile" starts getting a lockfile.
confidence: high.

### `install.linkWorkspacePackages` default `true` - the team's own breaking-change tracker lists it
what: A named semver dependency (`"pkg-a": "1.0.0"`) inside a workspace silently resolves to the local workspace copy instead of the registry, because `linkWorkspacePackages` defaults to `true`. The Bun team put flipping it to `false` on the official "Breaking changes for Bun v1.3" tracker, but the default is still `true` at HEAD.
where: `src/install/PackageManager/PackageManagerOptions.rs:113` (`link_workspace_packages: true`); `src/install/lockfile/Package.rs:1885` (`if pm.options.link_workspace_packages && satisfies`); `docs/runtime/bunfig.mdx:573-580`.
evidence: #20292 "Breaking changes for Bun v1.3" - first (unchecked) bullet: "default value `false` for `install.linkWorkspacePackages`". #8811 closed is the original opt-out request. The #20292 comment thread documents the pain of the related 1.3 monorepo-default changes ("I feel like I'm taking crazy pills"; "breaking changes as consequential as this shouldn't be shipped in a minor version release") - which is exactly the argument for doing it in a 2.0.
why bad: It violates the package-author contract: a pinned registry version gets swapped for the workspace HEAD. Modern pnpm already defaults `link-workspace-packages` to `false`; npm only links when the spec matches. Bun is the odd one out and the team already agrees.
bun 2.0 proposal: Default `false`; only the `workspace:` protocol links.
blast radius: high - every Bun monorepo that references siblings by bare semver. But it fails loudly (missing package / wrong version).
confidence: high that it's a regret (their own tracker); medium on whether they'd absorb the blast.

### Auto-install on by default, gated on "is there a `node_modules` folder", and config-named three different ways
what: If `bun run` finds no `node_modules` up the tree, it switches module-resolution algorithms AND starts downloading packages from npm at runtime (default `latest`). The feature is called `--install <auto|fallback|force|disable>` on the CLI, `install.auto` in bunfig, `-i` as a shorthand, and `GlobalCache` internally - and two of the internal modes (`allow_install`, `read_only`) have no config spelling at all.
where: `src/options_types/global_cache.rs:3-20` (enum + `MAP` accepting only `auto|force|disable|fallback`) and `:31-50` (`can_use(has_a_node_modules_folder)`); `src/runtime/cli/Arguments.rs:238-241` (`--install`, `-i`); `src/bunfig/bunfig.rs:728-754` (`install.auto` - also accepts bare booleans; the error message at `:736` lists `true, false, "force" "fallback" "disable"` and omits the documented `"auto"`); `docs/runtime/auto-install.mdx`.
evidence: `docs/runtime/auto-install.mdx:6` - "If Bun finds no `node_modules` directory in the working directory or higher, it **abandons Node.js-style module resolution**". Open issues where this bit people in production: #21030 "auto-install doesn't respect bun.lock or package.json" (container shipped `dist/` + `bun.lock` without `node_modules`; Bun silently auto-installed zod **4** where the lockfile said 3.22); #21832 "does not respect version resolution order and always resolve to latest"; #11434 (bunfig registry ignored), #14378 (.npmrc registry ignored), #31934, #29018, #9292, #10142. The feature also introduces the non-standard `import {z} from "zod@3.0.0"` import syntax (`auto-install.mdx:46-54`).
why bad: An invisible filesystem condition (`node_modules` present?) flips the runtime into a mode that contacts the public registry and resolves `latest`. That is a reproducibility and supply-chain footgun that has repeatedly surprised people deploying with Bun. And `install.auto`/`--install`/`-i`/`install.prefer` is an inconsistent option family.
bun 2.0 proposal: Make auto-install opt-in (`--install=auto` / `-i`). Rename the bunfig key from `install.auto` to match the `--install` flag. When it IS on, honor `bun.lock`/`package.json` ranges (bugs #21030/#21832).
blast radius: medium - single-file scripts lose the "just run it" magic unless they pass `-i`.
confidence: medium-high (long issue trail; no maintainer statement found).

### `install.cache.disable` doesn't disable the cache; `--no-cache` ≠ `install.cache.disable`
what: Setting `[install.cache] disable = true` moves the package cache into `node_modules/.cache` rather than disabling it; the `--no-cache` CLI flag instead disables the *manifest* cache (== `install.cache.disableManifest`). Two things called "cache", two things called "disable", none of the four spellings match each other.
where: `src/install/PackageManager/PackageManagerDirectories.rs:389-420` (when `Enable::CACHE` is false → cache at `node_modules/.cache`, `:416`); `src/install/PackageManager/PackageManagerOptions.rs:465-471` (bunfig `disable_cache` → `Enable::CACHE`; `disable_manifest_cache` → `Enable::MANIFEST_CACHE`) vs `:717-720` (`--no-cache` → `Enable::MANIFEST_CACHE` only). Also `install.cache` is a polymorphic TOML key: `false` | `"path"` | `{dir, disable, disableManifest}` (`src/bunfig/bunfig.rs:1434-1460`).
evidence: `docs/runtime/bunfig.mdx:622-624` admits it in prose: "when true, **don't load from the global cache. Bun may still write to node_modules/.cache**". `docs/pm/npmrc.mdx:147-159` maps `.npmrc`'s `cache=false` ("disable caching") onto this same half-disable.
bun 2.0 proposal: `--no-cache` and a single `install.noManifestCache` share one name; rename `cache.disable` to something honest or delete it (it isn't a cache disable); drop the `install.cache = <bool|string>` polymorphic shorthands.
blast radius: low.
confidence: high.

### `catalog`/`catalogs` accepted in two places with a hidden first-wins rule - the code comment admits the first place was a mistake
what: Bun reads catalogs from `package.json` `"workspaces": { "catalog": ..., "catalogs": ... }` (yarn-object style) AND from top-level `"catalog"`/`"catalogs"` - but the top-level form is only consulted when a `workspaces` key exists AND no catalog was found inside it, so `workspaces.catalog` silently shadows a top-level `catalog`.
where: `src/install/lockfile/Package.rs:3033-3055`.
evidence: verbatim code comment at `src/install/lockfile/Package.rs:3046-3049`: "`\"workspaces\"` being an object instead of an array is sometimes unexpected to people. therefore if you also are using workspaces, allow \"catalog\" and \"catalogs\" in top-level \"package.json\" so it's easier to guess." `docs/pm/catalogs.mdx:60` documents both locations ("`catalog` and `catalogs` also work at the top level of `package.json`") but not the precedence rule.
why bad: A second spelling was bolted on *because* the first was confusing (the comment says so), and the resulting shadowing rule is undocumented. pnpm (the origin of catalogs) uses `pnpm-workspace.yaml`, so neither location buys interop.
bun 2.0 proposal: Make top-level `"catalog"`/`"catalogs"` the one canonical location; warn (then error) on the `workspaces`-object form.
blast radius: low.
confidence: high.

### `overrides` silently shadows `resolutions`; neither is fully implemented
what: Bun accepts both npm's `overrides` and yarn's `resolutions` in `package.json`, but if *both* exist, `resolutions` is silently ignored (`else if`). Nested overrides and `name@range` selectors are unsupported.
where: `src/install/lockfile/OverrideMap.rs:139-162` (`if let Some(overrides) ... else if let Some(resolutions)`; same `else if` in `parse_count` at `:105-124`); warnings at `:212/:239/:344` ("Bun currently does not support nested ...").
evidence: the `else if` above (no warning is emitted when both keys are present). #6608 open "Support nested \"resolutions\" / \"overrides\""; #19059 open "overrides / resolutions don't respect version numbers". `docs/pm/overrides.mdx:48-51` "Bun only supports top-level `overrides`".
why bad: Two spellings of one feature where one silently wins is the classic migration trap (a yarn monorepo that picks up a stray `overrides` key loses all its `resolutions`). And because Bun claims overrides compatibility but silently drops nesting/version selectors, `bun install` can produce a materially different tree than `npm install` from the same manifest.
bun 2.0 proposal: Error (or at minimum warn) when both keys exist; error (don't ignore) on unsupported nested/ranged overrides; treat `resolutions` as a pure alias for `overrides` or drop it.
blast radius: low.
confidence: high.

### `--backend` vs `--linker`: two "how are files placed" knobs with colliding vocabulary, and a hardlink default that corrupts the global cache on edit
what: `--backend` selects the file-copy syscall (`hardlink` | `symlink` | `copyfile` | `clonefile` | `clonefile_each_dir`); `--linker`/`install.linker` selects the node_modules layout (`hoisted` | `isolated`). "symlink" and "hardlink" are `--backend` values but read like linker strategies; the internal name for `linker` is `node_linker`; `.npmrc` additionally accepts npm's `install-strategy` AND pnpm/yarn's `node-linker` (with yarn's `pnpm`/`node-modules` values). `--backend` has no bunfig key. And the `hardlink` default (Linux/Windows) means files in `node_modules` share inodes with `~/.bun/install/cache`, so editing one corrupts the cache for every project on the machine.
where: `src/install/PackageManager/CommandLineArguments.rs:47-54` (BACKEND_PARAM), `:113-115` (`--linker`); `src/bunfig/bunfig.rs:1366-1377` (`install.linker` → `install.node_linker`); `docs/pm/cli/install.mdx:452-492`, `docs/pm/npmrc.mdx:196-229`, `docs/pm/global-cache.mdx:54-70`.
evidence: The cache-corruption footgun is admitted verbatim in `docs/pm/cli/patch.mdx` (Note box): "Don't skip `bun patch <pkg>`. It ensures the package folder in `node_modules/` contains a fresh copy ... **If you skip it, you might end up editing the package globally in the cache.**" #10327 closed "Windows: package patch is applied to the bun cache files" is this exact bug *inside Bun's own patch feature*. `docs/pm/npmrc.mdx:198`: "For compatibility with other package managers, Bun accepts both npm's `install-strategy` and pnpm/yarn's `node-linker`."
bun 2.0 proposal: Rename `--backend` to something non-colliding (`--copy-method`); make `linker` the single user-visible word for layout and accept `nodeLinker` as an alias. In hoisted+hardlink mode, make cache files read-only (or use reflinks where available) so `node_modules` edits cannot corrupt the cache.
blast radius: low for the rename; medium for hardening hardlinks.
confidence: high on the naming, high on the footgun; medium on the fix shape.

### `bunx` installs into the OS temp dir with a 24h `@latest` TTL, while docs claim the "global cache"
what: `bunx <pkg>` materializes its install into `<TMPDIR>/bunx-<uid>-<pkg>/node_modules`, not into `~/.bun/install/cache`, and re-resolves `latest` only if the install is more than 24 hours old. Neither fact is documented; `bun pm cache` prints a different directory; `bun pm cache rm` has to special-case the temp dir.
where: `src/runtime/cli/bunx_command.rs:267` (`const SECONDS_CACHE_VALID: i64 = 60 * 60 * 24;`), `:817` (`RealFS::platform_temp_dir()`), `:855-882` (path layout + rationale comment); `src/runtime/cli/package_manager_command.rs:405-463` (`bun pm cache rm` walks `$TMPDIR` for `bunx-<uid>-*`).
evidence: `docs/pm/bunx.mdx:47` says "Installed packages are stored in Bun's [global cache](/pm/global-cache) for future use" - the global-cache doc (`docs/pm/global-cache.mdx:6`) says that is `~/.bun/install/cache`. Issues: #4989 OPEN "bunx bug: `@latest` doesn't pull latest from registry"; #12245 OPEN "Bunx force update cache".
why bad: The location is invisible, doc-contradicting, and OS-reaped (temp cleaners wipe it at unpredictable times, so bunx re-downloads "randomly"); and there is no flag to force a refresh inside the 24h window, so `bunx pkg@latest` can lie for up to a day.
bun 2.0 proposal: Move bunx installs under `$BUN_INSTALL/install/cache/` (or a dedicated `~/.bun/bunx/`), so `bun pm cache` is truthful and the OS doesn't reap them. Make an explicit `@latest`/dist-tag always re-resolve (or add `--force`). Document the TTL.
blast radius: low.
confidence: high.

### `bunx <name>` falls through to arbitrary executables on `$PATH`
what: When no version is specified, `bunx <name>` searches the user's *entire* `$PATH` (not just `node_modules/.bin` dirs) before consulting npm, so any same-named system binary wins over the npm package.
where: `src/runtime/cli/bunx_command.rs:957-977` - the `which()` call uses `path_for_bin_dirs` (which is `<node_modules/.bin dirs> + $PATH`, built at `:820-845`) for non-scoped names; the scoped-package branch at `:958-964` carries this comment: "If the bin name is a guess derived from a scoped package name, **exclude the original system $PATH so we don't match unrelated system binaries**" - i.e. the team already identified the problem and patched only the scoped case.
evidence: #18127 OPEN "bunx triggers external command" - `bunx sv create my-app` on a system with runit's `/usr/bin/sv` executes the *service manager* instead of installing the `sv` npm package ("fail: my-app: can't change to service directory"). `docs/pm/bunx.mdx:47` describes the behavior as "checks for a locally installed package first, then falls back to auto-installing it from `npm`" - no mention of `$PATH`.
why bad: Correctness (runs the wrong program) and a mild security problem (an earlier `$PATH` entry wins over npm). The asymmetry - scoped packages already excluded from `$PATH`, unscoped ones not - is the tell that this is known-bad.
bun 2.0 proposal: Restrict `bunx`'s implicit lookup to `node_modules/.bin` chains + the bunx cache (what the docs already claim). Require an explicit flag to exec arbitrary PATH programs.
blast radius: low-medium (`bunx <globally-installed-tool>` would start installing from npm instead).
confidence: high.

### `bun pm` is a grab-bag; its subcommands' top-level twins use different names
what: `bun pm` holds 17+ subcommands (pack, bin, ls/list, whoami, hash, hash-print, hash-string, cache, migrate, untrusted, trust, default-trusted, version, pkg, view, why, scan), while a different, overlapping set is top-level (`publish`, `outdated`, `audit`, `why`, `info`, `patch`). `bun pm view` == top-level `bun info` (different word). `bun pm ls` has a top-level alias `bun list` but not `bun ls`. `bun pm version` and `bun pm pkg` mirror npm's *top-level* `npm version`/`npm pkg`. `bun pm hash` and `bun pm hash-print` both print `lockfile.fmt_meta_hash()`.
where: `src/runtime/cli/package_manager_command.rs:244-712` (subcommand dispatch; hash vs hash-print at `:332-357`); `src/runtime/cli/mod.rs:1056-1085` (top-level set; `list`→PackageManagerCommand at `:1080`, `info`→InfoCommand at `:1065`, `why` at `:1083`); `docs/pm/cli/pm.mdx`.
evidence: #1720 closed "`bun pm cache rm` is unusable due to being overridden by `bun pm cache`"; #18277 closed "bun list as an alias for bun pm ls"; #6382 open "`bun pm cache rm -g` isn't working"; #10008 open "Support workspaces in `bun pm`". The `bun pm cache rm` handler at `package_manager_command.rs:405-463` special-cases the bunx temp dir - evidence that "cache" is two unrelated directories unified only by this subcommand.
why bad: Users must memorize an arbitrary split between `bun X` and `bun pm X`, and for `view`/`info` the same command has two unrelated names. npm puts `version`, `pkg`, `pack`, `ls`, `view` at the top level.
bun 2.0 proposal: Make every `bun pm X` also available as `bun X` (matching npm), and make `info`/`view` aliases of each other in both places. Delete `hash-print`. Keep `bun pm` as a compatibility namespace only.
blast radius: low (mostly additive; can be done without removing `bun pm`).
confidence: medium-high.

### `install.prefer` lives under `[install]` but has zero effect on `bun install`
what: `install.prefer = "offline" | "latest" | "online"` and the `--prefer-offline`/`--prefer-latest` flags only affect the *runtime resolver* (auto-install during `bun run`), not `bun install`. Yet the bunfig key is under `[install]` and is documented alongside install settings.
where: `src/bunfig/bunfig.rs:756-767` (stored in `ctx.debug.offline_mode_setting`); `src/resolver/resolver.rs:3709` is the only consumer; `src/runtime/cli/Arguments.rs:248-251` declares the flags on the RUN params table - they do not exist in `src/install/PackageManager/CommandLineArguments.rs` at all.
evidence: `docs/runtime/bunfig.mdx:500-515` documents `install.prefer` as "Configure how Bun resolves package versions against the npm registry when running scripts ... Equivalent to `--prefer-offline`" - and those flags are `bun run` flags, not `bun install` flags. Also the bunfig error at `bunfig.rs:764` says "must be one of online or offline", omitting the documented `"latest"`.
bun 2.0 proposal: Move the key to `[run]` (or fold it into the auto-install mode). If a real offline *install* mode is wanted, add it separately (yarn `--offline`, pnpm `--offline`).
blast radius: low.
confidence: high.

### Dead bunfig keys: `install.lockfile.path` / `install.lockfile.savePath`
what: Both keys are parsed by the bunfig loader into the options schema but no code reads them.
where: parsed at `src/bunfig/bunfig.rs:1400-1411`; declared at `src/options_types/schema.rs:276-279`; a repo-wide grep for `.lockfile_path` / `.save_lockfile_path` finds only the writer and the declaration - `PackageManagerOptions::load()` never consults them. Also `install.lockfile.print = "bun"` is accepted as a silent no-op (`bunfig.rs:1385-1396`).
evidence: the grep above; not mentioned in `docs/runtime/bunfig.mdx` at all.
why bad: Config surface that validates and does nothing is a trap; anyone who sets it assumes it works.
bun 2.0 proposal: Delete both keys (and the no-op `"bun"` value), or error on them as unknown.
blast radius: none.
confidence: high.

### `install.frozenLockfile = true` is a one-way door: no CLI negation exists
what: The bunfig `install.frozenLockfile` and CLI `--frozen-lockfile` only ever *set* the bit (the code is `if x { enable.set(FROZEN_LOCKFILE, true) }` in both paths). There is no `--no-frozen-lockfile`, so once the bunfig key is `true`, `bun add`/`bun update` become impossible without editing config. The same `bool-only-sets-true` pattern applies to `install.production` and `install.exact`.
where: `src/install/PackageManager/PackageManagerOptions.rs:515-518` (bunfig) and `:823-825` (CLI); `src/install/PackageManager/CommandLineArguments.rs:72` (only `--frozen-lockfile` is declared).
evidence: #23913 OPEN "Allow for override of `bunfig.toml` `frozenLockfile` setting via the command line"; #16387 OPEN "add an explicit `bun install` flag to disable frozen lockfiles"; #2564 was the original `--no-frozen-lockfile` request and was closed without adding it.
bun 2.0 proposal: Every boolean install flag gets a `--no-X` negation; bunfig booleans become tri-state so the CLI can override in either direction.
blast radius: low (purely additive plus a small precedence fix).
confidence: high.

### `-p` means three different things across the install/run/bunx surface
what: `bun -p '<expr>'` = `--print`; `bun install -p` / `bun add -p` = `--production`; `bunx -p <pkg>` = `--package`.
where: `src/runtime/cli/Arguments.rs:245` (`-p, --print`); `src/install/PackageManager/CommandLineArguments.rs:59` (`-p, --production`); `src/runtime/cli/bunx_command.rs:118` (`-p` == `--package`).
evidence: The team already treated `bun -p` ambiguity as a breaking-change candidate: #12181 ("Breaking changes for Bun 1.2"), dylan-conway: "Another change we should consider: `bun -p` shorthand for `--print`. Currently it is `--port`. https://github.com/oven-sh/bun/issues/14223". They fixed the run side; the install/bunx overloads remain.
bun 2.0 proposal: One meaning per short flag across the whole CLI. Keep `-p`=`--package` on `bunx` (npx parity) and `-P`/`--prod` on install; drop `-p`=`--production`.
blast radius: low.
confidence: medium (the install `-p` is rarely typed).

### `bun patch --commit` and `bun patch-commit`: two spellings, doc-admitted
what: The same action exists as a `--commit` flag on `bun patch` and as a separate `bun patch-commit` top-level command.
where: `src/runtime/cli/mod.rs:1034-1039` (both `patch` and `patch-commit` are distinct top-level tags); `src/install/PackageManager.rs:516-517`; `src/install/PackageManager/CommandLineArguments.rs:1215-1229` (both parse into the same `PatchOpts::Commit`).
evidence: `docs/pm/cli/patch.mdx` (verbatim): "`patch-commit` is available for compatibility with pnpm". Related DX regrets: #12256 open "bun patch is a DX regression compare to patch-package", #13397 open, #12090 open.
bun 2.0 proposal: Pick one (likely `bun patch-commit`, the pnpm spelling) and make the other a hidden alias or remove it.
blast radius: low.
confidence: high (the doc comment is the admission).
