# Bun 2.0 candidates - env + config surface

All `src/` paths are relative to `/workspace/bun`. Every behavioral claim below was
reproduced against `bun 1.4.0-canary.1 (d816daf47)` and `node v26.3.0` on this machine.

### `$VAR` expansion inside `.env` values: on by default, applies even inside single quotes, no opt-out, silently truncates secrets

what: Bun's `.env` parser performs shell-style `$VAR` / `${VAR}` / `${VAR:-default}` expansion on *every* loaded value - including single-quoted ones - with no config to disable it, diverging from `node --env-file`, the `dotenv` npm package, and `dotenv-expand` (which skips single quotes).
where: `src/dotenv/env_loader.rs:903` and `:950` (`Parser::parse_bytes::<OVERRIDE, false, true>` - `EXPAND` hard-coded `true` for both default `.env*` files and `--env-file`); `expand_value` at `src/dotenv/env_loader.rs:1174-1246`; docs `docs/runtime/environment-variables.mdx:104-136`.
evidence:
- Empirical (this machine), same `.env` → `node --env-file` vs `bun`:
  - `SINGLE='pre$A post$NOPE end'` → node: `pre$A post$NOPE end`, bun: `pre111 post end`
  - `RAW=123$567` → node: `123$567`, bun: `123` (silent truncation)
  - `ESCAPED=ab\$cd` → node: `ab\$cd`, bun: `ab$cd`
  - `bun --env-file=.env` gives the identical expanded results (diverges from the Node flag it mirrors).
- #4177 "add ability to disable variable expansion in .env" - open since 2023, `enhancement, cli`.
- #4994 "environment value is not fully loaded with special character $" - open: `someKey=123$567` → `123`.
- #14059 "Env vars incorrectly loaded if they contain a '$'" - open: "Node does not do that, and neither does the 'dotenv' package. So I need to keep 2 env files for each runtime."
- #15099 "Bun env-expand doesn't work between env files" - open.
- #32411 "env parsing with default substitution causes immediate crash" - open: `FOO="${FOO:-${BAR:-baz}}"` SEGFAULTs. The `${VAR:-default}` syntax is entirely undocumented (`docs/runtime/environment-variables.mdx` never mentions it) and nested use crashes.
- Bun's own Node-compat code already opts out: `src/runtime/node/node_util_binding.rs:178` calls `load_from_string::<true, false>` (`EXPAND=false`) so `util.parseEnv` matches Node - an in-tree admission that the default is wrong for Node parity.
why bad: Real-world secrets routinely contain `$` (bcrypt hashes start with `$2b$`, many generated passwords contain `$$`). Bun silently rewrites them, and the one "safe" escape everyone reaches for - single quotes - does nothing, because `expand_value` runs after the quote type has been discarded. The only escape (`\$`) itself produces a different value than Node does for the same file, so there is no single `.env` that works in both runtimes.
bun 2.0 proposal: Turn expansion OFF by default to match `node --env-file` and `dotenv`. If expansion survives, (a) never expand single-quoted values (dotenv-expand semantics), and (b) add `[env] expand = false` in bunfig plus `--env-file-expand`/`--no-env-expand`. Fix the `${a:-${b:-c}}` crash regardless.
blast radius: high - any `.env` that relies on `DB_URL=postgres://$USER:$PASS@...` composition breaks, but it is a one-line mechanical migration and matches what every other tool already requires.
confidence: high.

### `bun install` auto-loads `.env` with a hard-coded `production` suffix and ignores every opt-out

what: `bun install` (and lockfile loading) unconditionally load `.env` + `.env.production` + `.env.production.local` from the project root - regardless of `NODE_ENV`, `--no-env-file`, `--env-file`, or `bunfig env = false` - and expose the result to every dependency's `postinstall` script.
where: `src/install/PackageManager.rs:1833-1838` (`env.load(entries, &[], dot_env::DotEnvFileSuffix::Production, false)` - empty `env_files`, `skip_default_env=false`, suffix hard-coded); `src/install/lockfile.rs:1856-1860` (identical copy). Contrast with the runtime path at `src/bundler/transpiler.rs:781-787`, which honors the suffix, `--env-file`, and `skip_default_env`.
evidence:
- #31450 "`bun install` ignores `--no-env-file`, `--env-file`, and `bunfig env = false`" - open. The reporter's knob matrix: every one of `--no-env-file`, `--env-file=/dev/null`, `--production`, `NODE_ENV=development`, `bunfig env = false` fails to suppress it, and the repro shows `postinstall sees SOME_API_SECRET = "leaked-prod-value"` from `.env.production`.
- #12011 "`bun install` - .env.development ... not recognised and defaults to .env.production or .env" - open, `bun install, cli`.
- Reproduced here: with `NODE_ENV` unset, `bun install` prints `[0.02ms] ".env.production", ".env"` and a `postinstall` sees `WHICH=prodsecret` from `.env.production`.
- Bun's own security test `test/cli/install/bun-install-registry.test.ts:8970-8975` exists *because* of this: "`bun install` loads the project's `.env` before computing installer options, so a repo-committed `.env` can point `BUN_CONFIG_REGISTRY` at a different registry host."
why bad: Three separate defects compound. (1) npm/pnpm/yarn do not read `.env` at all; the entire behavior is a Bun invention. (2) It exposes production secrets to untrusted lifecycle scripts of every transitive dependency - the exact supply-chain vector. (3) A cloned repo's `.env` can redirect the registry (`BUN_CONFIG_REGISTRY`, `npm_config_registry`) that packages are fetched from. (4) The suffix is `Production` here but `Development` for `bun <file>` in the same directory - the same `.env.*` tree means two different things depending on subcommand.
bun 2.0 proposal: `bun install` should not load `.env*` at all (match npm). At minimum: honor `--no-env-file` / `bunfig env = false`, stop hard-coding `Production`, and never inject `.env*` values into the `postinstall` environment.
blast radius: medium - anyone currently (ab)using `.env` → `BUN_CONFIG_REGISTRY`/`NPM_CONFIG_TOKEN` for installs would need to move to `.npmrc`/`bunfig.toml`, which is where that config belongs.
confidence: high.

### `.env.development` is loaded when `NODE_ENV` is unset, and `.env.local` is silently skipped in test mode

what: With no `NODE_ENV` set, `bun <file>` loads `.env.development` (+ `.env.development.local`); under `bun test` (or `NODE_ENV=test`) Bun silently sets `NODE_ENV=test` and never loads `.env.local`. Neither behavior is documented.
where: default-to-Development: `src/bundler/transpiler.rs:781-787`; the test-mode `.env.local` skip: `src/dotenv/env_loader.rs:731-733` (`if suffix != DotEnvFileSuffix::Test { try .env.local }`, no explanatory comment). Docs `docs/runtime/environment-variables.mdx:10-15` say only "depending on the value of `NODE_ENV`".
evidence:
- #13377 "Bun shouldn't load `.env.development` when `NODE_ENV` isn't set" - open, labeled `bug, docs`: "The docs only say 'depending on value of NODE_ENV' ... This was confusing the heck out of me."
- #19542 "`bun test` will not load environment variables from `.env.local`" - open, `bug, bun:test`.
- #9641 "Load `.env.local` and `.env.test.local` in `bun test`" - closed enhancement.
- #2303 ".env.development always loaded" - closed.
- Reproduced here with `.env` (`W=base`), `.env.local` (`W=local`), `.env.test` (`W=test`): plain `bun -e` prints `NODE_ENV=undefined WHICH=local`; `bun test` in the same dir prints `NODE_ENV=test WHICH=test` - `.env.local` silently dropped.
- The docs precedence list (`environment-variables.mdx:12-14`) lists 3 tiers and omits `.env.{mode}.local` entirely; reproduced here that `.env.development.local` in fact beats `.env.local`. 8 filenames are loaded (`env_loader.rs:784-793`); 4 are documented.
why bad: These are Create-React-App / Next.js *framework* conventions transplanted into a general-purpose runtime. A runtime has no notion of "mode", so inferring `development` from an *absent* `NODE_ENV`, and dropping `.env.local` (the one file people put local secrets in) under `bun test`, are both invisible, undocumented, and not what any Node user expects (`node --env-file` loads exactly what you name).
bun 2.0 proposal: When `NODE_ENV` is unset, load only `.env` and `.env.local` (no mode file). Document the full 8-file list with exact precedence and the test-mode skip - or better, drop the test-mode skip and the mode files entirely and let frameworks keep owning them.
blast radius: medium - projects relying on the implicit `.env.development` pickup would need `NODE_ENV=development`.
confidence: high.

### Automatic `.env` loading is opt-out rather than opt-in, and *which* subcommand loads it is incoherent

what: There is no single answer to "does this `bun` invocation read my `.env`?". Each subcommand hard-codes its own answer, and the opt-outs don't cover them all.
where: `bun <file>` - yes (suffix from env): `src/bundler/transpiler.rs:770-790`. `bun run <script>` / `bunx` - NO, by design: `src/dotenv/env_loader.rs:663-669` ("Do not automatically load .env files in `bun run <script>` ... See https://github.com/oven-sh/bun/issues/9635#issuecomment-2021350123"). `bun install` - YES, Production hard-coded, no opt-out (previous finding). `bun build --compile` output - YES at the *end user's* runtime, by default (`compile_autoload_dotenv: true` and `compile_autoload_bunfig: true` at `src/options_types/context.rs:276-277`; help text `src/runtime/cli/Arguments.rs:413` literally says `(default: true)`).
evidence:
- #23962 "Automatic .env reading doesn't work with `bun run` and `bunx`" - open, `bug, bun install`: "it's nice to have that with `bun run` and `bunx` to keep it consistent."
- #17759 "Allow bunx to load .env files" - open enhancement; #12430 "`bunx` cannot use `--env-file`" - open bug.
- #6338 "Bun's .env reading causes issues with Vite's .env reading" - open since 2023 with many "+1" comments. Diagnosis in the issue: "bun reads the .env file beforehand, and thus already sets 'PUBLICPATH' in the 'real' environment. Then Vite loads the dotEnv files, but doesn't override anything that is already set in process.env." Every tool that does its own `.env` layering (Vite, Next, Prisma, `dotenv`, `dotenv-flow`) is shadowed by Bun's pre-injection, and Bun picks the mode from `NODE_ENV` at *its* startup, not from `--mode production` passed to the tool.
- #22368 "Single-file executable is not setting process.env.NODE_ENV" - open, `bug, bundler`.
why bad: Opt-out auto-loading is the root cause of a whole class of "my tool loads the wrong env" reports: the damage is already done before user code runs. And because the coverage is per-subcommand and inconsistent, users can't reason about it. A `bun build --compile` binary that, when an end user runs it, reads `.env` and `bunfig.toml` from *their* cwd is a real (if niche) security and correctness surprise for a "standalone" executable.
bun 2.0 proposal: Pick ONE consistent rule and make it opt-in-able per invocation: either all runtime-ish commands (`bun`, `bun run`, `bun test`, `bunx`) load `.env*` or none do, with `--env-file`/`--no-env-file`/`bunfig env` honored everywhere including `install`. Flip `--compile-autoload-dotenv` and `--compile-autoload-bunfig` to default `false`.
blast radius: high for removing auto-loading entirely; low for just making the matrix consistent and flipping the `--compile` defaults.
confidence: high.

### `bunfig.toml` silently accepts unknown keys - and the official docs use key names the parser never reads

what: The bunfig parser is a bag of `json.get(b"key")` lookups with no "unknown key" validation; any typo is a silent no-op, and the shipped docs themselves contain a no-op example.
where: whole file `src/bunfig/bunfig.rs` (never iterates unrecognized properties). Doc/impl mismatch: `docs/runtime/bunfig.mdx:237` documents `coverageThreshold = { line = 0.7, function = 0.8, statement = 0.9 }` but the parser reads `b"functions"` / `b"lines"` / `b"statements"` (plural) at `src/bunfig/bunfig.rs:505,511,517`.
evidence:
- Reproduced here: a `bunfig.toml` containing `preoad = [...]`, `smoll = true`, `[tets]`, `[instal] registry = "http://evil"`, `sielnt = true` runs with zero warnings and exit 0.
- The `coverageThreshold` example that has been in the docs uses singular keys; following it does nothing.
- Two more schema warts that the silent-ignore policy hides: `run.elide-lines` is the single kebab-case key (`src/bunfig/bunfig.rs:785`, `docs/runtime/bunfig.mdx:852-859`) in an otherwise-camelCase schema (`logLevel`, `frozenLockfile`, `onlyFailures`, `noOrphans`, `coverageDir`, ...) - a CLI flag name leaked into TOML; and `test.reporter` accepts both `dots` and `dot` (`src/bunfig/bunfig.rs:454`: `expr.get(b"dots").or_else(|| expr.get(b"dot"))`) with only `dots` documented.
why bad: A config file that never rejects anything means a user who writes `elideLines` (the "obvious" spelling) or `coverageThreshold = { line: ... }` (the *documented* spelling) gets a silent no-op. The fact that the official docs shipped a non-functional example for years is the proof that even the maintainers can't tell.
bun 2.0 proposal: Warn (or error) on unknown keys/sections at every level. Rename `run.elide-lines` → `run.elideLines`, drop the `dot` alias, and either make the parser accept the documented singular `coverageThreshold` keys or fix the docs.
blast radius: low - typo'd keys were already doing nothing; the only break is people with junk in their bunfig.
confidence: high.

### The word `env` means three unrelated things across the config surface

what: `env` is used for (a) whether `.env` *files* are loaded, (b) whether environment variables are *inlined into a bundle*, and (c) the list of env *file paths* - with no naming distinction.
where:
- bunfig top-level `env = false` / `[env] file = false` → disable `.env` file loading: `src/bunfig/bunfig.rs:277-316`.
- bunfig `[serve.static] env = "inline" | "disable" | "FOO_*"` → `DotEnvBehavior` (inline into bundle): `src/bunfig/bunfig.rs:1634-1670`.
- `bun build --env <inline|prefix*|disable>` → same `DotEnvBehavior`: `src/runtime/cli/Arguments.rs:523-525`.
- `--env-file <path>` / `--no-env-file` → file paths / toggle: `src/runtime/cli/Arguments.rs:116-118`.
evidence:
- `bun build --env=disable` vs bunfig `env = false` are unrelated despite reading identically.
- The build `--env` variant has its own pile of confusion issues: #19508 "`Bun.build({ env: 'disable' })` still inlines `process.env.NODE_ENV`" (open, `confirmed bug`); #20183 (duplicate theme); #20430 "`bun build` env=inline or env='PUBLIC_*' not working with `Bun.env`" (open).
why bad: When the same three-letter word means "load dotfiles", "bake values into output", and "here are file paths" depending on which table it sits in, users inevitably set the wrong one. This is a pure naming problem that only a breaking rename can fix.
bun 2.0 proposal: Rename the inlining axis to something unambiguous everywhere (`--inline-env` on `bun build`, `inlineEnv` in `[serve.static]`) and reserve bare `env` for the file-loading toggle. Keep `--env-file` as-is (Node's name).
blast radius: medium - `bun build --env` is documented and used, but it's a flag rename with an obvious deprecation path.
confidence: high.

### `BUN_CONFIG_NO_VERIFY` has inverted semantics: `=0` disables integrity verification, `=1` is a no-op

what: The env var that turns off `bun install`'s package integrity verification is a double negative: you must set `BUN_CONFIG_NO_VERIFY=0` to disable verification; `BUN_CONFIG_NO_VERIFY=1` (the value everyone would guess) does nothing.
where: `src/install/PackageManager/PackageManagerOptions.rs:664-666`:
```rust
if let Some(check_bool) = env.get(b"BUN_CONFIG_NO_VERIFY") {
    self.do_.set(Do::VERIFY_INTEGRITY, check_bool != b"0");
}
```
evidence:
- `check_bool != b"0"` → `=1` keeps verification ON; `=0` turns it OFF. The immediately adjacent siblings (`BUN_CONFIG_SKIP_SAVE_LOCKFILE`, `BUN_CONFIG_SKIP_LOAD_LOCKFILE`, `BUN_CONFIG_SKIP_INSTALL_PACKAGES` at `:652-662`) all use `== b"0"` and therefore behave as their names read. `NO_VERIFY` alone is flipped.
- This dates to the original Zig (`git log -S BUN_CONFIG_NO_VERIFY` → `b897ad3ec2`, 2022-07-17: `this.do.verify_integrity = !strings.eqlComptime(check_bool, "0");`) - 4 years of unchanged backwards semantics.
- It coexists with the CLI flag `--no-verify` (`src/install/PackageManager/CommandLineArguments.rs:86,1042`) whose semantics are the obvious "presence = skip". So the flag and the env var with the same name answer `1` differently.
- `BUN_CONFIG_NO_VERIFY` is absent from `docs/pm/cli/install.mdx`'s env-var table and from `docs/runtime/environment-variables.mdx`.
why bad: This is a security-adjacent knob (hash verification of downloaded packages) that is undocumented, inverted relative to its own name, inverted relative to its three siblings, and inverted relative to the CLI flag with the same name. Nobody can set it correctly without reading the source.
bun 2.0 proposal: Fix the comparison to `== b"0"` semantics (so `NO_VERIFY=1` disables) - or better, delete the env var and keep only `--no-verify`. Document whichever survives.
blast radius: low - undocumented, and `=1` already does nothing, so the only possible break is someone who discovered the inversion from source.
confidence: high.

### Global `~/.bunfig.toml` is honored only by the install family; `bun`, `bun run`, `bun test`, `bun build` ignore it

what: The "global vs. local bunfig merge" the docs describe only happens for package-manager commands. Runtime, test, and build commands never open the global file.
where: `src/options_types/command_tag.rs:89-104` - `read_global_config()` returns true only for `Bunx | PackageManager | Install | Add | Remove | Update | Patch | PatchCommit | Outdated | Publish | Audit`. `src/bunfig/arguments.rs:106,155` gates global loading on it. Docs `docs/runtime/bunfig.mdx:14-19` describe the merge generically; `:761` then narrows only "`bun run`".
evidence:
- `TestCommand`, `BuildCommand`, `RunCommand`, `AutoCommand` are absent from `read_global_config()` but `TestCommand`/`BuildCommand` *are* in `ALWAYS_LOADS_CONFIG` (`command_tag.rs:170-187`) - they auto-load the *local* bunfig but never the global one.
- `UpdateInteractiveCommand` is in `ALWAYS_LOADS_CONFIG` but NOT in `read_global_config()`, while plain `UpdateCommand` is in both - `bun update -i` and `bun update` read a different set of config files.
- The global path resolution (`src/bunfig/arguments.rs:20-36`) also diverges from the docs: if `XDG_CONFIG_HOME` is set, `$HOME/.bunfig.toml` is *never* consulted, but `docs/runtime/bunfig.mdx:16-17` presents them as two places you can put it.
why bad: "Put `logLevel`/`telemetry`/`smol`/`console.depth` in `~/.bunfig.toml`" looks like it should work from the docs and silently does nothing for the commands people actually run. The per-command split has no principled reason.
bun 2.0 proposal: Either load the global bunfig for every command or for none; make `$HOME/.bunfig.toml` a real fallback when `$XDG_CONFIG_HOME/.bunfig.toml` doesn't exist; and prefer `$XDG_CONFIG_HOME/bun/bunfig.toml` over a dotfile inside the XDG config dir.
blast radius: low - the change makes global config *more* honored, not less; the only surprise is people who had junk in `~/.bunfig.toml` that was previously ignored.
confidence: high.

### bunfig `[define]` values are a JSON micro-syntax inside TOML strings; the docs explicitly call it a holdover that "will probably change"

what: `[define]` (and `[serve.static].define`) values must be JSON-encoded-inside-a-TOML-string (`"process.env.bagel" = "'lox'"`) instead of plain TOML values.
where: `docs/runtime/bunfig.mdx:77-79`; parsed by `parse_define_map` at `src/bunfig/bunfig.rs:318-345`.
evidence: The docs, verbatim: "The values are parsed as JSON, except single-quoted strings are supported and `'undefined'` becomes `undefined` in JS. **This will probably change in a future release to be just regular TOML instead. It is a holdover from the CLI argument parsing.**"
why bad: It's an explicit, shipped admission of regret that has sat in the docs. The double-encoding (`"'lox'"`) is exactly the kind of thing users get wrong, and there's no migration path without a breaking change.
bun 2.0 proposal: Accept native TOML values in `[define]` (strings, numbers, booleans, inline tables) and translate to define expressions; keep the string-of-JSON form behind a deprecation warning for one release.
blast radius: low - `[define]` is niche; the new form is a superset.
confidence: high (the team already said so).

### The `BUN_CONFIG_*` / `BUN_*` env-var namespace is partly fictional and partly undocumented

what: The documented env-var table and the source disagree in both directions.
where: docs table `docs/pm/cli/install.mdx:345-355`; docs table `docs/runtime/environment-variables.mdx:195-206`; declarations in `src/bun_core/env_var.rs`.
evidence:
- `BUN_CONFIG_LINK_NATIVE_BINS` is documented (`docs/pm/cli/install.mdx:351`) but no code anywhere in `src/` reads it (`grep -rn LINK_NATIVE_BINS src/` → only an orphan `native_bin_links` schema field at `src/options_types/schema.rs:298-299` that nothing populates).
- `BUN_CONFIG_TOKEN` is documented as "Set an auth token **(currently does nothing)**" (`docs/pm/cli/install.mdx:349`) - a shipped admission; the source *does* read it (`src/install/PackageManager/PackageManagerOptions.rs:619`), so either the docs or the code is wrong.
- Undocumented but load-bearing: `BUN_ENV` (see next finding), `BUN_CONFIG_NO_VERIFY`, `BUN_INSTALL_PROGRESS` (`PackageManagerOptions.rs:563`), `BUN_INSTALL_VERBOSE` (`PackageManager.rs:1886`), `BUN_CONFIG_HTTP_RETRY_COUNT`, `BUN_CONFIG_HTTP_IDLE_TIMEOUT`, `BUN_CONFIG_DNS_TIME_TO_LIVE_SECONDS`, `BUN_INSTALL_STREAMING_MIN_SIZE`, plus ~40 `BUN_FEATURE_FLAG_*` escape hatches (`src/bun_core/env_var.rs`) - none appear in `docs/runtime/environment-variables.mdx`.
- The env-var module's own doc comment (`src/bun_core/env_var.rs:11-15`) disowns the mechanism: "environment variables may fail to parse silently ... environment variables are not meant to be a robust configuration mechanism."
- In-tree regret comments: `src/bun_core/env_var.rs:46-51` on the DNS TTL default: "Legacy usage had the default at 30, even though ... Amazon Web Services recommends 5 seconds ... **It's unclear why this was done.**"; `:80-82` on the inotify interval: "**It's unclear why the default here is 100_000**, but this was legacy behavior so we'll keep it for now."
why bad: Users can't distinguish a supported `BUN_CONFIG_*` knob from an internal escape hatch, documented knobs don't exist, and existing knobs aren't documented. An env-var namespace whose own module header says it "may fail to parse silently" and "is not meant to be robust" should not be the primary surface for things like registry URLs and integrity verification.
bun 2.0 proposal: Publish an authoritative table of supported `BUN_*`/`BUN_CONFIG_*` vars, delete the nonexistent `BUN_CONFIG_LINK_NATIVE_BINS` row, resolve the `BUN_CONFIG_TOKEN` docs/code contradiction, and move anything users are meant to set into `bunfig.toml` with the env var as an alias, not the only spelling.
blast radius: low - documentation + pruning.
confidence: high.

### `BUN_ENV` silently overrides `NODE_ENV` everywhere, and is documented nowhere

what: `BUN_ENV` takes precedence over `NODE_ENV` for choosing which `.env.{mode}` files load and for `is_production()` / `is_test()`, yet it appears in zero documentation.
where: `src/dotenv/env_loader.rs:179-183`:
```rust
/// `BUN_ENV` with fallback to `NODE_ENV` - Bun's env precedence for
/// production/test detection.
pub fn get_node_env(&self) -> Option<&[u8]> {
    self.get(b"BUN_ENV").or_else(|| self.get(b"NODE_ENV"))
}
```
evidence: `grep -rn BUN_ENV docs/` → zero hits. The only sighting in the entire issue history is user comments stumbling onto it as a workaround (#6338: "For tests helps `BUN_ENV=test bun run test` ... Noticed that `BUN_ENV=production` doesn't help with production build").
why bad: A second, undocumented, higher-precedence name for the single most load-bearing env var in the ecosystem (`NODE_ENV`) means that anything that happens to set `BUN_ENV` (a shell rc, a Docker image, a CI) silently changes which `.env.*` files Bun loads while `NODE_ENV` still reads correctly in `process.env`. It buys nothing over `NODE_ENV`.
bun 2.0 proposal: Remove `BUN_ENV`, or at minimum document it and demote it below `NODE_ENV`.
blast radius: low - nobody can be relying on an undocumented var at scale.
confidence: high.

### `-i` / `bun i` and `-u` / `-e` mean different things depending on subcommand

what: Short flags are overloaded across subcommands, and `-i` in particular is one keystroke away from a different operation.
where:
- `src/runtime/cli/Arguments.rs:240-242`: `-i   Auto-install dependencies during execution. Equivalent to --install=fallback.` It is the only short flag with *no long form* (confirmed in `bun --help` output).
- `-u, --origin <STR>` in `RUNTIME_PARAMS_` (`Arguments.rs:254`, which has no help text at all) vs `-u, --update-snapshots` in `TEST_ONLY_PARAMS` - `bun -u` and `bun test -u` are unrelated.
- `-e, --eval` in `RUNTIME_PARAMS_` (`Arguments.rs:243`) vs `-e, --external` in `BUILD_ONLY_PARAMS` (`Arguments.rs:477`) - `bun -e` and `bun build -e` are unrelated.
evidence:
- Reproduced: `bun i` runs `bun install`; `bun -i a.ts` runs `a.ts` with network auto-install enabled. `npm i`/`pnpm i`/`yarn` all mean "install".
- `--origin` (`-u`) is a `bun dev`-era relic: it sets `Bun.serve`'s `base_uri` (`src/runtime/server/ServerConfig.rs:773`) and is auto-derived from `--port` as `http://localhost:PORT/` (`Arguments.rs:1336-1341`). It is documented neither in `docs/runtime/bunfig.mdx` nor in the help text (the param spec is the bare string `"-u, --origin <STR>"` - the only flag in the table with no description). The bunfig top-level `origin` key (`src/bunfig/bunfig.rs:369-378`) is also undocumented.
why bad: `bun -i foo.ts` ≠ `bun i foo.ts`. One performs network installs mid-execution; the other installs your lockfile. And `-u`/`--origin`'s blank help text is an in-tree admission nobody wants to explain it.
bun 2.0 proposal: Give `-i` a long form (`--auto-install`) or remove the short alias; free `-u` for `--update-snapshots` everywhere by removing the legacy `-u, --origin`; remove bunfig `origin` and `[bundle]` (see next).
blast radius: low for `-u`/`--origin` (undocumented legacy); medium for `-i` (documented, but a short alias with a long fallback is cheap to migrate).
confidence: high.

### Dead / undocumented bunfig sections the parser still accepts: `[bundle]`, `[debug].editor`, `install.lockfile.path`

what: The parser accepts whole config sections that appear in no documentation and exist only for back-compat with pre-`bun build` Bun.
where / evidence:
- `[bundle]` with `outdir`, `entryPoints`, `packages`, `logLevel`: `src/bunfig/bunfig.rs:853-947`. Not mentioned once in `docs/runtime/bunfig.mdx` (the section header is `bundle`, the command it configured (`bun bun`) no longer exists). `bun build` is configured by CLI flags, not this.
- `[debug].editor`: `src/bunfig/bunfig.rs:1016-1022`. Not in docs.
- `install.lockfile.path` / `install.lockfile.savePath`: `src/bunfig/bunfig.rs:1400-1411`. Not in docs (docs only describe `install.lockfile.save` and `install.lockfile.print`).
- The `install.auto` error message at `src/bunfig/bunfig.rs:736` says `must be one of true, false, or "force" "fallback" "disable"` - but omits `"auto"`, which IS a valid value (`src/options_types/global_cache.rs:15`) and is the documented default. The enum also has `allow_install` and `read_only` variants (`global_cache.rs:4-5`) unreachable from any string spelling.
why bad: Combined with the silent-unknown-key policy, these sections are invisible landmines: they do something, they're not documented, and nobody can tell them apart from a typo.
bun 2.0 proposal: Delete `[bundle]` and bunfig `origin`; document or delete `[debug].editor` and `install.lockfile.path`/`savePath`; fix the `install.auto` error message.
blast radius: low - all undocumented.
confidence: high.

### Compiled (`--compile`) executables auto-load `.env` and `bunfig.toml` from the end user's cwd by default

what: A `bun build --compile` standalone binary, when an end user runs it in any directory, reads that directory's `.env*` files (and `bunfig.toml`) into its `process.env` by default.
where: defaults in `src/options_types/context.rs:276-277` (`compile_autoload_dotenv: true`, `compile_autoload_bunfig: true`); the four `--[no-]compile-autoload-{dotenv,bunfig,tsconfig,package-json}` flags at `src/runtime/cli/Arguments.rs:412-434`; standalone bunfig gating at `src/bunfig/arguments.rs:143-152` (`DISABLE_AUTOLOAD_BUNFIG`).
evidence:
- The help text is explicit: `--compile-autoload-dotenv   Enable autoloading of .env files in standalone executable (default: true)` (`Arguments.rs:413`). Note `tsconfig` and `package-json` default to **false** (`context.rs:278-279`) - the maintainers already decided the "read config from the end user's cwd" family is dangerous enough to default off, but left the two most impactful ones (`.env` - env injection; `bunfig.toml` - registry/preload/define injection) on.
- #22368 "Single-file executable is not setting process.env.NODE_ENV" - open, `bug, bundler` - shows the compile env pipeline already confuses people.
why bad: A "standalone executable" should be self-contained. By default it isn't: the end user's `.env` (possibly containing other apps' secrets, or a planted `BUN_CONFIG_*`) and `bunfig.toml` (which can set `preload`, `[install].registry`, `[define]`) are read into the binary. The asymmetry with `tsconfig`/`package-json` defaults is an in-tree admission that the default is not obviously right.
bun 2.0 proposal: Flip `compile_autoload_dotenv` and `compile_autoload_bunfig` to default `false` so `--compile` output is self-contained; keep the explicit opt-in flags.
blast radius: medium - anyone shipping a `--compile` binary that relies on the user's `.env` would need to add `--compile-autoload-dotenv`; that is the right thing to make explicit.
confidence: medium-high (defaults verified in source; runtime path not rebuilt and re-tested here).

### `Bun.serve`'s default port is spelled five different ways, including the made-up `NODE_PORT`

what: One default port, five config spellings: `BUN_PORT`, `PORT`, `NODE_PORT` env vars, `--port` CLI flag, and `[serve].port` in bunfig - and one of them (`NODE_PORT`) is not a convention anywhere.
where: `src/runtime/server/ServerConfig.rs:745` (`const PORT_ENV: [&[u8]; 3] = [b"BUN_PORT", b"PORT", b"NODE_PORT"]`); `--port` at `src/runtime/cli/Arguments.rs:253`; bunfig `[serve].port` at `src/bunfig/bunfig.rs:385-390`.
evidence:
- `docs/runtime/bunfig.mdx:159` documents only two of the three env names ("Can also be set with the `BUN_PORT` or `PORT` environment variables") - `NODE_PORT` appears in no docs. Node.js itself reads neither `PORT` nor `NODE_PORT`.
- Minor adjacent wart: `src/bunfig/bunfig.rs:389` (`if p == 0 { 3000 } else { p }`) means bunfig `[serve] port = 0` cannot request an OS-assigned port - `0` is silently rewritten to `3000`, unlike `Bun.serve({port: 0})` which works.
- (Verified: env vars only fill the *default*; an explicit `Bun.serve({port: 7777})` is not overridden - so this is redundancy, not a correctness bug.)
why bad: Three env-var names for one value is pure redundancy; `NODE_PORT` implies a Node convention that doesn't exist. And `port = 0` meaning "3000" in one place and "any free port" in every other is a trap.
bun 2.0 proposal: Drop `NODE_PORT`; keep `PORT` (ecosystem convention) and `BUN_PORT` (explicit). Make bunfig `port = 0` mean "OS-assigned" or reject it.
blast radius: low - `NODE_PORT` is undocumented.
confidence: high.
