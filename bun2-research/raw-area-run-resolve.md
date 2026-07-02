# Bun 2.0 candidates - `bun run`, entrypoint dispatch, module resolution, auto-install

All code citations are at commit `5b55beb711` of `/workspace/bun`. Behaviors marked
"verified" were reproduced on Bun 1.4.0 / 1.4.0-canary on linux-x64 during this research.

### `bun <name>`: the subcommand namespace silently shadows package.json scripts, and the team keeps reserving MORE names

what: `bun <x>` resolves against ~45 built-in subcommand keywords (plus 8 names "reserved for future use") *before* package.json scripts, so `bun deploy`, `bun build`, `bun info`, `bun a`, `bun login`, etc. never run your script - and every Bun release that adds a subcommand is a silent breaking change to this namespace.
where: `src/runtime/cli/mod.rs:924-1096` (`Command::which()` keyword table); `src/runtime/cli/mod.rs:1069-1079` (`deploy`,`cloud`,`config`,`use`,`auth`,`login`,`logout`,`prune` → `ReservedCommand`); error text `src/runtime/cli/mod.rs:788`; docs `docs/runtime/index.mdx:101`, `docs/runtime/index.mdx:210-219`.
evidence:
  - Verified: with `"scripts": {"deploy": "...", "build": "...", "info": "...", "a": "..."}`, `bun deploy` prints `Uh-oh. bun deploy is a subcommand reserved for future use by Bun.`; `bun build` runs the bundler (`error: Missing entrypoints`); `bun a` runs `bun add`; `bun info` queried the **npm registry for a package named after my local package** and printed a stranger's package metadata.
  - The error string itself is an admission: `"is a subcommand reserved for future use by Bun.\n\nIf you were trying to run a package.json script called {0}, use bun run {0}."` (mod.rs:788).
  - Issue #23093 (OPEN, enhancement): "`bun build` = `bun run build`" - asks for exactly the ambiguity to be resolved the other way.
  - Issue #22614: "`bun whoami` is reserved, but `bun pm whoami` does exist".
  - Single-letter aliases `a`/`c`/`i`/`r`/`x` (mod.rs:1002,1008,1019,1028,1040) are especially collision-prone.
why bad: The shortcut `bun <script>` (explicitly positioned against `yarn <script>`) is fundamentally un-extendable: every new `bun` subcommand steals a script name retroactively, and the team has already had to hard-reserve 8 more. It cannot be fixed without a breaking change.
bun 2.0 proposal: Keep `bun <file>` (anything path-like), but drop the "bare name → package.json script" fallback from the naked `bun` command entirely; require `bun run <script>` (or adopt `bun <script>` only when `--` / a new short form like `bun -s` is used). At minimum, freeze the keyword set and document it as a contract.
blast radius: high - `bun dev`, `bun start` are muscle memory for a large share of users.
confidence: high.

### `bun run <name>` silently falls through to arbitrary system binaries on `$PATH`

what: When `<name>` is not a script, not a file, and not in `node_modules/.bin`, `bun run <name>` searches the entire system `$PATH` and `exec`s whatever it finds - so a missing/typo'd script name silently runs an unrelated system program.
where: `src/runtime/cli/run_command.rs:2689-2727` (`// ── node_modules/.bin / system $PATH fallback`); `bin_dirs_only` is only `true` for the naked `bun <x>` form (`src/runtime/cli/mod.rs:1470-1474`); documented at `docs/runtime/index.mdx:219` ("4. (`bun run` only) System commands: `bun run ls`").
evidence:
  - Issue #31877 (OPEN, bug): "`bun run --if-present test` tries to run `/bin/test` - works as expected in npm".
  - Verified: in a fresh `package.json` with no scripts, `bun run --if-present test` → `error: "/usr/bin/test" exited with code 1` (npm exits 0); `bun run --if-present ls` lists the cwd; `bun run true` exits 0.
  - Issue #14397 (OPEN): "Implement `bun run-script`" - users asking for an unambiguous form.
why bad: `--if-present`'s contract ("exit 0 if the entrypoint does not exist") is violated because a system binary "exists". A typo in a CI script name executes `/usr/bin/<typo>` instead of erroring. npm/pnpm/yarn never do this.
bun 2.0 proposal: Remove the system-`$PATH` fallback from `bun run` (keep `node_modules/.bin`). `bun x` / `bunx` already covers "run an arbitrary binary". At minimum make `--if-present` check script existence, not PATH.
blast radius: medium - only scripts that rely on `bun run <some-system-tool>` break, and `bunx`/`bun exec` are the replacements.
confidence: high.

### `bun X` and `bun run X` are documented as identical but give the program a different `process.env.PATH`

what: `bun run file.mjs` mutates `process.env.PATH` to prepend `<dir>/node_modules/.bin` for **every ancestor directory up to `/`** (plus the bun-node shim dir); `bun file.mjs` and `bun ./file.mjs` do not, because the path-looking fast path boots the VM before PATH stitching ever runs.
where: fast path returns at `src/runtime/cli/run_command.rs:2406` (`maybe_open_with_bun_js`, defined at `:2795-2902`, never configures PATH); PATH stitching happens later at `:2439` → `configure_path_for_run_with_package_json_dir` whose ancestor-walk loop is at `:2036-2052`. The fast path is enabled by extension only for the naked form: `src/runtime/cli/mod.rs:1473` (`allow_fast_run_for_extensions: tag == Tag::AutoCommand`). Docs: `docs/runtime/index.mdx:36` - "you can omit the `run` keyword and use the 'naked' command; **it behaves identically**."
evidence:
  - Verified on Bun 1.4.0: `bun file.mjs` → PATH unchanged; `bun ./file.mjs` → PATH unchanged; `bun run file.mjs` → PATH = `/tmp/pathcheck/node_modules/.bin:/tmp/pathcheck/node_modules/.bin:/tmp/node_modules/.bin:/node_modules/.bin:<original>` (note the duplicate entry and the walk all the way to `/node_modules/.bin`).
  - Issue #32225: "`child_process.spawn` resolves binaries differently than Node (PATH prioritization differs for node_modules/.bin)" - the user ran `bun run minimal.mjs`. robobun closed it NOT_PLANNED saying "bun run prepends node_modules/.bin to PATH exactly like npm run" - but the user was running a *file*, not a script; `node file.js` never mutates PATH.
why bad: Three problems from one design: (1) the docs' "behaves identically" claim is false; (2) running a *file* (not a script) shouldn't inherit `npm run`'s PATH semantics at all; (3) walking to filesystem root picks up `/node_modules/.bin` and `$HOME/node_modules/.bin`, which is a mild hijack surface and diverges from npm (which stops at the package root).
bun 2.0 proposal: Never stitch PATH when the target resolved to a source file; only stitch for package.json scripts; stop the ancestor walk at the enclosing package root (first `package.json` / `node_modules`).
blast radius: medium - code that relies on `node_modules/.bin` being on PATH after `bun run file.ts` breaks; the script case (the npm-compatible one) keeps working.
confidence: high.

### `--bun` default is a pre-1.0 regret the team labelled `breaking` and never shipped

what: `bun run <script>` defaults to honoring `#!/usr/bin/env node` shebangs (spawning real Node); the opt-in `--bun` flag symlinks a fake `node` into a world-shared `/tmp/bun-node-<git-sha>` directory and prepends it to `$PATH` - and this substitution is silently forced **on** whenever `node` isn't already on `$PATH`.
where: `src/runtime/cli/run_command.rs:1968` (`needs_to_force_bun = force_using_bun || !found_node`); shim impl `src/install/lib.rs:466-492` (`BUN_NODE_DIR`) and `:565-680`; docs `docs/runtime/bunfig.mdx:785-812` ("By default, this is enabled if `node` is not already in your `$PATH`"), `docs/runtime/index.mdx:127-141`.
evidence:
  - Issue #4464 (OPEN, labelled `enhancement`+`breaking`, filed 2023): "Make `--bun` default, introduce `--node`. ... **Before 1.0, we should change this** so that it defaults to Bun". It was never done; still open.
  - Code comment `src/install/lib.rs:469-471`: "the SHA alone does not uniquely identify a binary - two local builds at the same commit share this dir"; `:648-655`: "The dir is keyed only on GIT_SHA_SHORT, so two different binaries built at the same commit ... collide here."
  - `src/install/lib.rs:630-641`: if `/tmp/bun-node-<sha>` already exists and is owned by **another user**, the function does `return Ok(())` - `--bun` becomes a silent no-op for the second user on a multi-user host.
  - Verified: `bun run --bun w` (script = `which node; node -e ...`) → `/tmp/bun-node-d816daf47/node` / Bun 1.4.0. With `node` removed from PATH and **no** `--bun`, the same script still gets the Bun shim: `/tmp/bun-node-d816daf47/node` / 1.4.0.
  - Related open issues: #29578 ("Support `--bun` flag in `bun install` to persist Bun-execution"), #9346 ("Use the `engines` field to automatically replace node with bun"), #5362 ("Cross-runtime compatible shebangs").
why bad: Three regrets compounded: (a) the default was supposed to flip before 1.0; (b) the on/off state is partly implicit (presence of `node` on `$PATH`), so the same project behaves differently on dev laptops vs CI/Docker images without Node; (c) the mechanism - a per-version directory in shared `/tmp` - has documented collision and silent-failure modes.
bun 2.0 proposal: Flip the default to `--bun` and add `--node` (exactly #4464). Move the shim out of shared `/tmp` to `$XDG_RUNTIME_DIR`/`$HOME/.cache/bun`. Never silently substitute based on whether `node` happens to be installed - make it an explicit, persisted choice (bunfig `run.bun`).
blast radius: high - every `package.json` script whose CLI only works under real Node changes behavior.
confidence: high.

### `import "./x"` and `require("./x")` resolve to different files; five divergent extension-order tables; `--extension-order` only controls one of them

what: Bun maintains five separate extensionless-resolution priority lists (CJS default, ESM default, CJS-in-node_modules, ESM-in-node_modules, main-field), the ESM one puts `.jsx` ahead of `.ts`, the documented `--extension-order` flag and its advertised default control none of the orders users hit, and the docs describe yet another order.
where: `src/bundler/options.rs:2028-2049` (`bundle_options_defaults`: `EXTENSION_ORDER = [.tsx,.ts,.jsx,.cts,.cjs,.js,.mjs,.mts,.json]`, `MODULE_EXTENSION_ORDER = [.tsx,.jsx,.mts,.ts,.mjs,.js,.cts,.cjs,.json]`, plus `node_modules::*`); a *drifted* duplicate lives at `src/resolver/options.rs:168-186`; `--extension-order` only overrides `extension_order.default.default` at `src/bundler/options.rs:1882-1884`; help text `src/runtime/cli/Arguments.rs:148` claims `"Defaults to: .tsx,.ts,.jsx,.js,.json"`; docs list a third order at `docs/runtime/module-resolution.mdx:35-50` (`.tsx, .jsx, .ts, .mjs, .js, .cjs, .json`).
evidence:
  - Verified: with `util.jsx` and `util.ts` side-by-side, `require("./util")` → `util.ts` ("TS") but `import "./util"` → `util.jsx` ("JSX"). Same specifier, same directory, two different files.
  - Verified: `bun --extension-order .ts,.jsx main.mjs` still resolves `util.jsx` - the documented flag is dead for ESM imports, the common case.
  - `src/resolver/options.rs:183` and `src/bundler/options.rs:2047-2048` disagree on the node_modules ESM order (`.mjs,.jsx,.js,.mts,…` vs `.mjs,.jsx,.mts,.js,.cjs,…`) - the "duplicated so self-contained" mirror has already gone stale.
  - `test/js/bun/resolve/resolve-ts.test.ts:13-22` spells out the intended asymmetry ("In node_modules, prefer non-ts files over ts files / Outside node_modules, prefer ts files over non-ts files") and cites #5426 as its motivation.
why bad: No user can predict which file an extensionless import loads; `.jsx` beating `.ts` in an ESM TypeScript project is indefensible; the one configurability knob the docs advertise doesn't work; and the tables have already diverged between two copies in the tree.
bun 2.0 proposal: One table. `.ts > .tsx > .js > .jsx > .mjs > .cjs > .json`, identical for `import` and `require`. Make `--extension-order` set **all** the tables or delete the flag. Delete the duplicate in `src/resolver/options.rs` and import the canonical one.
blast radius: low/medium - only projects with same-named files in multiple extensions change, and those are already getting nondeterministic-feeling results.
confidence: high.

### Auto-install on by default, while a source comment admits it is "quite buggy and untested" and ignores the lockfile/registry config

what: When there is no `node_modules` directory anywhere above the cwd, Bun silently downloads every imported bare specifier from npm at module-resolution time (`GlobalCache::auto` is the default), but the implementation ignores `bun.lock`, package.json version ranges, `.npmrc`, and bunfig registries - contradicting its own docs.
where: default: `src/options_types/global_cache.rs:6-7` (`#[default] auto`) and `:31-50` (`can_use` is true whenever `node_modules` is absent). The regret comment: `src/resolver/resolver.rs:941-958`. Docs claiming lockfile/package.json are honored: `docs/runtime/auto-install.mdx:20-27`.
evidence:
  - `src/resolver/resolver.rs:951-954` (verbatim): "auto install, as of writing, is also quite buggy and untested, **it always installs the latest version regardless of a user's package.json or specifier**. in addition to being not fully stable, it is completely unexpected to invoke a package manager after bundling an executable."
  - Issue #21832 (OPEN, **confirmed bug**): "auto-install does not respect version resolution order and always resolve to latest".
  - Issue #21030 (OPEN): "Bun auto-install doesn't respect bun.lock or package.json".
  - Issue #11434 (OPEN): "Bun auto-install does not leverage the registry settings from .bunfig.toml"; #14378 (OPEN): "Auto-install doesn't work when using a registry in .npmrc".
  - `docs/runtime/auto-install.mdx:24-26` promises the exact lockfile/package.json resolution the source comment says does not happen.
why bad: A default that performs silent network installs is already aggressive; one that also ignores the user's pinned versions and private-registry config is a supply-chain hazard. The trigger ("no node_modules exists") is indistinguishable from "I forgot to run `bun install`", which is when you *least* want `latest`.
bun 2.0 proposal: Change the default from `auto` to `disable` (error with "run `bun install`" / "pass `-i` to auto-install"). Keep `auto` as an opt-in. If auto-install stays, it must share the exact resolution path (`bun.lock`, `.npmrc`, bunfig scopes) with `bun install`.
blast radius: medium - the "download a gist and `bun x.ts` it with no package.json" demo breaks; real projects with `node_modules` are unaffected.
confidence: high.

### tsconfig `paths` / `baseUrl` are honored at runtime - non-standard, and only for the single "nearest enclosing" tsconfig

what: Bun's runtime module resolver applies `compilerOptions.paths`/`baseUrl` from the nearest enclosing `tsconfig.json`/`jsconfig.json` as the **first** step of every bare/absolute resolve, a behavior TypeScript itself says is type-check-only and which Node, tsx, and every bundler-at-runtime disagree on.
where: `src/resolver/resolver.rs:1895-1917` ("First, check path overrides from the nearest enclosing TypeScript 'tsconfig.json' file") and `:1022-1053` (`resolve_via_tsconfig_paths` → `dir_info.enclosing_tsconfig_json`). Docs `docs/runtime/module-resolution.mdx:286-299`.
evidence:
  - #21056 (OPEN, enhancement): "Bun should resolve tsconfig paths in imported modules in a workspace" - only the entrypoint's enclosing tsconfig applies, so aliases in workspace sibling packages silently fail.
  - #14694 (OPEN): "Bun breaks path aliases on monorepo".
  - The feature is partially wired per entry point: #23761 ("Does not use tsconfig paths when resolving *.html"), #26793 ("`Bun.build()` `tsconfig` option doesn't resolve path aliases (CLI works)"), #29590 ("`bun test --changed` ignores tsconfig `paths` aliases, silently skipping affected tests"), #26193 ("paths with .js extension pattern not resolved at runtime").
  - Bun also honors `"extends"`/project-references inconsistently: #23695, #4774.
why bad: Code written against this runs only in Bun - it fails in Node, `tsx`, `ts-node`, Vitest, Jest. Because it is keyed to the "nearest enclosing" tsconfig, the alias silently changes meaning (or disappears) the moment the file is imported from a different package, which is the #21056/#14694 class of monorepo breakage. It is also the feature most often duplicated by the standard `package.json#imports` (`#alias`) mechanism, which Bun already supports.
bun 2.0 proposal: Deprecate runtime `paths` in favor of `package.json#imports` (which the same docs section already recommends as the Node-compatible option). If kept, apply it per-package (each file uses its own enclosing tsconfig) consistently across *every* entry point (runtime, `Bun.build`, test, HTML), and gate it behind an explicit bunfig key so it isn't a surprise.
blast radius: high - `"@/*"` aliases are pervasive in Bun codebases.
confidence: medium (the feature is loved; the regret signal is its half-implemented variant matrix and monorepo semantics, not the feature itself).

### `__esModule` CJS-interop workaround: the team said "will be removed in Bun 1.1 - it has just caused more issues than it solved"

what: When `require()`/`import`ing a CJS module whose exports carry the Babel/TS `__esModule: true` marker, Bun rewires the `default` ES export to `exports.default` instead of `module.exports` - a deliberate divergence from Node that the team scheduled for removal two major-ish versions ago.
where: `src/jsc/bindings/JSCommonJSModule.cpp:965-1050` (`populateESMExports`), comment block at `:975-1002` ("Bun's interpretation of the `__esModule` annotation").
evidence:
  - Issue #9267 (OPEN, labelled **`breaking`**), body verbatim: "**This has just caused more issues than it solved, will be removed in Bun 1.1.**"
  - The code comment `:998-1002` also admits a second divergence inside the workaround: "We ignore the value of the annotation. We only look for the existence of the value being set" - i.e. `__esModule: false` is treated as `true`.
  - Comment cites oven-sh/bun#3383, nodejs/node#40891, evanw/esbuild#1591 as the rabbit hole.
why bad: It changes what `import x from "<cjs-pkg>"` evaluates to versus Node for any package transpiled by Babel/tsc (most of npm), and the team has stated in writing that the net effect was negative. Left in place only because removing it is breaking.
bun 2.0 proposal: Ship #9267: match Node's CJS-namespace semantics (`default` = `module.exports`, period).
blast radius: high - changes the default import of a very large set of npm packages.
confidence: high.

### Extensionless + index resolution for ESM, plus the `.js → .ts` rewrite, in a runtime

what: Bun resolves extensionless relative ESM specifiers (`./hello` → 13 candidate files including `hello/index.json`) and rewrites explicit `./foo.js` imports to `foo.ts`/`foo.tsx` - bundler/tsc behaviors ported into a runtime, where Node's ESM loader requires exact extensions and never rewrites.
where: the 13-step probe list: `docs/runtime/module-resolution.mdx:35-50`. The `.js`→`.ts` rewrite: `src/resolver/resolver.rs:5844-5900` (with a code comment: "At the time of writing this specific behavior comes from the function `loadModuleFromFile()` in ... the TypeScript compiler source code"). The node_modules carve-out the team already had to add: `src/bun_core/feature_flags.rs:95-96` (`// https://github.com/oven-sh/bun/issues/5426` / `DISABLE_AUTO_JS_TO_TS_IN_NODE_MODULES: bool = true`).
evidence:
  - Issue #5426 (closed): `capnp-ts` ships compiled `.js` next to source `.ts`; Bun's rewrite loaded the **`.ts` source** inside node_modules and crashed with "Indirectly exported binding name 'AnyArena' is not found" - the motivating bug for the feature flag.
  - `test/js/bun/resolve/resolve-ts.test.ts:13-22` documents the resulting rule-set the team converged on ("In node_modules, prefer non-ts files over ts files ... `./dir/*.js` should NOT be resolve to `./dir/*.ts`") and names #5426.
  - `src/resolver/resolver.rs:5861`: "NOTE: the node_modules gate only applies to the `.mjs` arm." - the carve-out is partial by its own admission.
why bad: Code written for Bun with extensionless ESM imports is not portable to Node, so the "compatible with the Node ecosystem" story is one-directional. The `.js`→`.ts` rewrite in particular is a heuristic that keeps sprouting counterexamples (the feature flag, the `.mjs`-only gate, the per-directory extension-order flip), which is the classic sign of a structural problem.
bun 2.0 proposal: Keep extensionless resolution for `require()` (CJS-spec behavior) and for the entrypoint; for `import`, require the extension (or at minimum drop the implicit `index.*` and the `.js`→`.ts` rewrite). Alternatively gate the non-Node behavior behind `tsconfig "moduleResolution": "bundler"` so it tracks a user intent signal.
blast radius: high - enormous amount of Bun code uses extensionless imports.
confidence: medium (the team clearly values the DX; the regret signal is in the accumulated carve-outs, not a stated intent to remove).

### `bun create <x>` is five unrelated features behind one ambiguous positional, one of which silently deletes the destination directory

what: The same positional dispatches to (1) a React component → full project generator, (2) `$BUN_CREATE_DIR/<x>`, (3) `./.bun-create/<x>`, (4) `$HOME/.bun-create/<x>`, (5) `<owner>/<repo>` on GitHub, (6) `create-<x>` from npm / the legacy `@bun-examples` scope - and the local-template branch **recursively deletes** the destination while the other branches refuse to overwrite.
where: dispatch chain `src/runtime/cli/create_command.rs:1658-1795`; still-live legacy registry URLs `src/runtime/cli/create_command.rs:2095` (`https://registry.npmjs.org/bun-examples-all/latest`) and `:2383` (`https://registry.npmjs.org/@bun-examples/{}/latest`); docs warning `docs/runtime/templating/create.mdx:154-157`: "Unlike remote templates, running `bun create` with a local template **deletes the entire destination folder** if it already exists."
evidence:
  - Issue #27948 (OPEN): "destructive bun create local template" - "**I just lost a whole project** ... my project was gone without a whimper."
  - The docs (`create.mdx:232-267`) still describe pre-1.0 behavior ("IF Next.js is detected, add `bun-framework-next`", "IF Relay is detected, add `bun-macro-relay`") whose code is commented out at `create_command.rs:894-1066`; the `@bun-examples` npm scope is a pre-1.0 remnant still queried as a fallback.
  - #27430: "bun create vite fails with too many arguments error"; #20314 / #29087: `--` argument forwarding broken.
why bad: A scaffolding command whose behavior flips between "refuse to overwrite" and "rm -rf the destination" depending on whether `~/.bun-create/<name>` happens to exist on that machine is a data-loss footgun, not a CLI nicety; and the same name means something different on two developers' machines.
bun 2.0 proposal: Make destructive behavior consistent (never delete without `--force`, all branches). Drop the `@bun-examples` scope. Split the modes behind explicit flags (`--template`, `--github`, `--local`) rather than heuristics on the positional.
blast radius: low - scaffolding is one-shot; the npm/GitHub paths (the common ones) don't change.
confidence: high.

### `bun init` writes a `CLAUDE.md` / `.cursor` rule into your repo based on what binaries are on `$PATH`

what: `bun init` probes `$PATH` for a `claude` executable and whether `.cursor/` exists, and if so writes `CLAUDE.md` and/or `.cursor/rules/use-bun-instead-of-node-vite-npm-pnpm.mdc` into the new project - on by default, opt-out only via an undocumented environment variable.
where: `src/runtime/cli/init_command.rs:846-847` (`Template::create_agent_rule()` - called unless `--minimal`), `:1467-1510` (`is_claude_code_installed`, `BUN_AGENT_RULE_DISABLED` / `CLAUDE_CODE_AGENT_RULE_DISABLED` env-var opt-outs).
evidence:
  - Issue #32252 (OPEN): "Sudden CLAUDE.md created after `bun init` without any prior warnings (enabled by default rather than opt-in)".
  - `docs/runtime/templating/init.mdx` and `docs/snippets/cli/init.mdx` do not document the opt-out env vars.
why bad: A project scaffolder whose output depends on which unrelated binaries happen to be on the developer's `$PATH` is non-reproducible, and silently writing third-party-tool config is a surprising side effect for an "empty project" command.
bun 2.0 proposal: Make agent-rule generation an explicit `bun init` prompt / `--agent-rules` flag; never key it off `$PATH` contents.
blast radius: low - one extra file.
confidence: high.

### Five documented regrets in one paragraph: `bunfig [define]` values are a "holdover"

what: `bunfig.toml` `[define]` values are parsed as JSON-inside-TOML-strings (with a single-quote extension), and the docs say so is an accident of history.
where: `docs/runtime/bunfig.mdx:74-80`; the single-quote extension is its own feature flag: `src/bun_core/feature_flags.rs:20-21` (`ALLOW_JSON_SINGLE_QUOTES`: "This feature flag exists so when you have defines inside package.json, you can use single quotes in nested strings.").
evidence: `docs/runtime/bunfig.mdx:78` verbatim: "The values are parsed as JSON ... **This will probably change in a future release to be just regular TOML instead. It is a holdover from the CLI argument parsing.**"
why bad: The team already wrote the deprecation into the docs; it just hasn't happened because it's breaking.
bun 2.0 proposal: Accept plain TOML values in `[define]`; keep the string-encoded form as a fallback for one version.
blast radius: low - `[define]` in bunfig is rare.
confidence: high.

### `--require` and `--import` are both aliases of `--preload` (and of each other)

what: Node's `-r/--require` (synchronous CJS preload) and `--import` (async ESM preload, where `register()` hooks live) have materially different semantics; Bun documents both as "Alias of --preload, for Node.js compatibility" and folds them into one preload list.
where: `src/runtime/cli/Arguments.rs:201-202` (help text, verbatim: `"--require <STR>... Alias of --preload, for Node.js compatibility"`, `"--import <STR>... Alias of --preload, for Node.js compatibility"`); combined into one list at `src/runtime/cli/Arguments.rs:940-968`. Docs: `docs/snippets/cli/run.mdx:136-142`.
evidence: the help-text strings above are the admission. Related: bunfig `preload` is also documented as the plugin-registration mechanism (`docs/runtime/bunfig.mdx:30-31`), so one key serves three jobs (Node `-r`, Node `--import`, Bun plugin registration); Workers don't load it at all (#12608, OPEN: "Worker does not load `preload` from bunfig.toml").
why bad: Tooling that distinguishes the two (e.g. `node --import tsx` vs `node -r ts-node/register`, `module.register()` loader hooks) gets silently-different behavior in Bun. Bunfig `preload` being inconsistently applied (main thread yes, Workers no) is a second axis of the same design.
bun 2.0 proposal: Keep `--preload` as the Bun-native name; make `--require` reject ESM-only modules and `--import` support `register()` semantics, or explicitly document them as "parsed for compatibility but behave as `--preload`" rather than "Alias". Load bunfig `preload` in Workers.
blast radius: low.
confidence: medium.

### `--hot` and `--watch`: two overlapping flags, one with no disposal story, both with `--hot`-wins tie-breaking

what: Bun ships both `--watch` (hard process restart) and `--hot` (soft module-cache reload with persistent `globalThis`); `--hot` has no way to dispose timers/listeners/class state across reloads, the docs call the implementation "a starting point", and passing both flags silently takes `--hot`.
where: `src/runtime/cli/Arguments.rs:971-989` (`if --hot { ... } else if --watch { ... }` - `--hot` wins, no warning); `docs/runtime/watch-mode.mdx:142-145` ("Support for Vite's `import.meta.hot` is planned") and `:149-157` ("This implementation isn't particularly optimized. ... It's a starting point.").
evidence:
  - Issue #8963 (OPEN): "Timers are not canceled after `--hot` reload".
  - Issue #16839 (OPEN): "Hot Reload Fails to Reset Timers and Class State, Causing Stale Async Behavior".
  - `--watch` alone enables crash-auto-restart (`set_auto_reload_on_crash(true)`, Arguments.rs:983) - another undocumented semantic difference.
why bad: Users genuinely cannot tell which flag to use; `--hot` without a disposal API (`import.meta.hot.dispose`) is a leak generator by construction, and the team has documented that the real fix (Vite's `import.meta.hot`) is a different design.
bun 2.0 proposal: Ship `import.meta.hot` (accept/dispose) and make `--hot` imply it; emit an error on `--hot --watch` together; document that `--hot` is only meaningful for long-lived servers.
blast radius: low (flags, not data).
confidence: medium.

### `-u, --origin <STR>` is a pre-1.0 `bun dev` flag still accepted with no help text

what: The root `bun run` argument table still accepts `-u, --origin <STR>` (which used to configure the pre-1.0 `bun dev` server's public origin); it has no description in `--help`, no docs page, and is not in `docs/snippets/cli/run.mdx`.
where: `src/runtime/cli/Arguments.rs:254` - `parse_param!("-u, --origin <STR>")` (the only entry in the table with no description text); consumed at `src/runtime/cli/Arguments.rs:991-993` → `opts.origin`, which threads into `src/bundler/options.rs:1872-1875`.
evidence: absence of the flag from `docs/snippets/cli/run.mdx` (every other runtime flag is documented there) and the lone undescribed `parse_param!` entry.
why bad: Dead legacy surface: it reserves a short flag (`-u`) that could be useful, and anything that still reads `opts.origin` is untested code nobody can reach intentionally.
bun 2.0 proposal: Remove `-u/--origin` from the runtime argument table (keep it for `bun build` if the bundler still needs it).
blast radius: low.
confidence: medium.

### `-i` and `--install` are the same concept with three different values

what: `-i` sets auto-install to `fallback`; `--install` with an empty value sets it to `force`; the documented default for `--install` is `auto`. `bun i` (no dash) is `bun install`.
where: `src/runtime/cli/Arguments.rs:1077-1095` (`-i → fallback`, empty `--install` → `force`); docs `docs/snippets/cli/run.mdx:148-155` (documents `-i` as "Equivalent to --install=fallback" and `--install` default as `auto`).
evidence: the code at Arguments.rs:1086-1087 (`else if enum_value.is_empty() { ctx.debug.global_cache = options::GlobalCache::force; }`) - a third meaning documented nowhere.
why bad: `-i` should be shorthand for `--install`; instead it picks a different mode than either `--install`'s default or its bare form. Combined with `bun i` meaning `bun install`, `-i`/`i` is maximally overloaded.
bun 2.0 proposal: Make `-i` exactly `--install` and pick one value for the bare form; document it.
blast radius: low.
confidence: high.
