# Bun 2.0: what to break

Synthesis of 20 research passes over `/workspace/bun` (16 area agents + 4 signal agents). Every item below has at least one of: a verbatim source/docs quote, a `file:line`, or an issue number - and most were re-verified against the checkout while editing. Items that were "just bugs" or pure missing features were discarded.

---

## Tier 1: clear wins (strong evidence, team would likely agree)

### `__esModule` CJS default-import unwrapping
what: Default-importing a CJS module that sets `exports.__esModule = true` + `exports.default` yields `exports.default` in Bun and the whole `module.exports` namespace in Node.
where: `src/jsc/bindings/JSCommonJSModule.cpp:975-1002` ("Bun's interpretation of the `__esModule` annotation").
evidence: Maintainer-filed issue #9267 "Remove workaround for `__esModule`" - OPEN, labeled `breaking`: "This has just caused more issues than it solved, **will be removed in Bun 1.1**." Never removed. #32698 closed NOT_PLANNED as "documented divergence" (it is not documented: `grep -r __esModule docs/` → nothing). Fallout: #3881, #18615, #29304, #17311.
why bad: The single largest source of "works in Bun, breaks in Node" for Babel/tsc-compiled packages, and the team said in writing it was a net negative.
bun 2.0 proposal: Ship #9267 - `default` is always `module.exports`; delete the special case.
blast radius: high - but it's the one change that most improves Node portability.

### `bun run` defaults `node`-shebang scripts to real Node
what: `bun run <script>` honors `#!/usr/bin/env node` and spawns the system `node`; `--bun` is the opt-in, implemented by symlinking a fake `node` into a shared `/tmp/bun-node-<sha>` dir.
where: `src/runtime/cli/run_command.rs:1968` (`needs_to_force_bun = force_using_bun || !found_node`); `src/install/lib.rs:466-492, 630-641`.
evidence: #4464 "Make `--bun` default, introduce `--node`" - OPEN, labeled `breaking`, team-filed: "**Before 1.0, we should change this** so that it defaults to Bun." Also on roadmap #159. The shim has documented multi-user/multi-build collision modes (`lib.rs:469-471, 648-655`), and is silently forced *on* when `node` is absent from `$PATH`.
why bad: "I installed Bun to use Bun" is false for most `bun run dev` invocations; behavior differs between machines based on whether Node happens to be installed.
bun 2.0 proposal: Exactly #4464: default to Bun, add `--node`. Replace the `/tmp` PATH-symlink with per-exec shebang interception.
blast radius: high - the single most-requested, team-endorsed breaking change.

### `Bun.serve` `idleTimeout`: 10 s, counts in-flight handlers, capped at 255
what: Connections are reset after 10 s of no bytes - *including while the user's handler is still running* - and the value is a `u8`.
where: `src/runtime/server/ServerConfig.rs:25` - `pub idle_timeout: u8, // TODO: should we match websocket default idleTimeout of 120?`; `:75` (`idle_timeout: 10`); `:1133-1139` (throws above 255).
evidence: The in-source TODO is a literal regret. `docs/runtime/http/server.mdx:217`: "including in-flight requests where your handler is still running… Browsers and `fetch()` clients see this as a connection reset." #13712 (sleep 15 s → `curl: (52) Empty reply`); #13811 tagged **`regression`** (the 10 s default landed in a 1.1.x patch and broke working SSE); #15589/#27470 (255 cap). The sibling WS `idleTimeout` defaults to 120 and caps at 960 (`WebSocketServerContext.rs:358-378`) - same name, different contract.
why bad: No other runtime times out a running handler by default. The 255 cap is a `u8` leaking into the public API. Two options with the same name and unit behave nothing alike.
bun 2.0 proposal: Default `0` (disabled) or stop the idle clock once the handler is invoked; widen past `u8`; unify the two `idleTimeout`s.
blast radius: medium-high - anyone relying on the implicit 10 s reaper needs an explicit timeout.

### `trustedDependencies` silently *replaces* a hidden 367-package default allowlist
what: Lifecycle scripts are blocked by default *except* for 367 package names compiled into the binary (name-only, no version/integrity pin). Writing any `trustedDependencies` array - even `[]` - discards that list entirely.
where: `src/install/default-trusted-dependencies.txt`; `src/install/lockfile.rs:3333-3365` (verified: the `if let Some(trusted_dependencies)` branch returns without ever consulting `default_trusted_dependencies::has`).
evidence: `docs/pm/lifecycle.mdx:58`: "Defining `trustedDependencies` … **replaces** the default list rather than extending it." #7642 OPEN ("a big step backwards for security"); #31026; #3756 OPEN ("a `trustedDependencies` field that **no other package manager supports**"); #32218 OPEN - npm v12 is standardizing `allowScripts` (github.blog changelog 2026-06-09), a name collision waiting to happen.
why bad: Three regrets fused: (1) "secure by default" is untrue - 367 packages run arbitrary code by name; (2) the common fix (`["my-pkg"]`) silently un-trusts esbuild/sharp/etc.; (3) the field name is about to collide with npm.
bun 2.0 proposal: Delete the built-in list (block everything, print what was blocked). Make the field additive - or adopt `allowScripts` and alias the old name.
blast radius: high - but it fails loudly, and it's a security default.

### Bun silently shadows installed npm packages (`ws`, `undici`, `node-fetch`, bare `ffi`, …)
what: The resolver hardcodes `ws`, `undici`, `node-fetch`, `isomorphic-fetch`, `@vercel/fetch`, bare `ffi`, and even `next/dist/compiled/{ws,node-fetch,undici}` to Bun's own partial shims, ignoring whatever is in `node_modules`.
where: `src/resolve_builtins/HardcodedModule.rs:272-276, 714` (`// Thirdparty packages we override`); shims in `src/js/thirdparty/`.
evidence: #17799 "Remove the undici polyfill" (OPEN, `good first issue`). Roadmap #159 lists "Investigate removing our `undici` override." Verified: with `ws@99.0.0` installed, `require("ws")` returns the shim and `require.resolve("ws")` returns the literal string `"ws"`, while `require("ws/package.json").version` is `"99.0.0"` - the package and its implementation disagree. Incompleteness issues: #7920 (breaks `@elastic/elasticsearch`), #27783, #14498, #19748, #21492, #25481, #3844, #2955. Not mentioned anywhere in `docs/`.
why bad: The lockfile says one thing and the runtime loads another, with no opt-out. undici's `MockAgent`/`setGlobalDispatcher` and the entire `ws` version-pinned ecosystem silently get something else. The `next/dist/compiled/*` hijack is a time bomb tied to Next.js internals.
bun 2.0 proposal: Remove all npm-package aliases from the runtime target (keep only `node:*`). If a fast path is wanted, put it inside `node:http`/`fetch`, not in the resolver.
blast radius: medium - `bun install` already installs the real packages.

### `bun install` reads `.env` + a hard-coded `.env.production` and ignores every opt-out
what: `bun install` (and lockfile loading) unconditionally load `.env`, `.env.production`, `.env.production.local` from the project root - regardless of `NODE_ENV`, `--no-env-file`, `--env-file`, or `bunfig env = false` - and expose the result to every dependency's `postinstall`.
where: `src/install/PackageManager.rs:1833-1838` (`DotEnvFileSuffix::Production`, `skip_default_env=false`, empty `env_files`); duplicated at `src/install/lockfile.rs:1856-1860`.
evidence: #31450 OPEN - the reporter's matrix shows every opt-out fails, and `postinstall sees SOME_API_SECRET = "leaked-prod-value"`. #12011 OPEN. Bun's own security test `test/cli/install/bun-install-registry.test.ts:8970-8975` exists *because* a repo-committed `.env` can repoint `BUN_CONFIG_REGISTRY`.
why bad: npm/pnpm/yarn read no `.env` at all. This injects production secrets into untrusted lifecycle scripts (the exact supply-chain vector) and lets a cloned repo's `.env` redirect the registry. The suffix is `Production` for `install` but `Development` for `bun <file>` - the same tree means two things.
bun 2.0 proposal: `bun install` should not read `.env*` at all. At minimum: honor `--no-env-file`/`bunfig env = false`, drop the hard-coded `Production`, and never inject `.env*` into the `postinstall` environment.
blast radius: medium - anyone abusing `.env` → `BUN_CONFIG_REGISTRY` moves to `.npmrc`/`bunfig`.

### `.env` `$VAR` expansion is on by default, applies inside single quotes, has no opt-out
what: Bun's `.env` parser performs shell-style `$VAR`/`${VAR:-x}` expansion on every value - including single-quoted ones - with no config to disable it, diverging from `node --env-file`, `dotenv`, and `dotenv-expand`.
where: `src/dotenv/env_loader.rs:903, 950` - `Parser::parse_bytes::<OVERRIDE, false, true>` (EXPAND hard-coded `true`); `expand_value` at `:1174-1246`.
evidence: Verified vs Node: `SINGLE='pre$A post$NOPE end'` → Node preserves, Bun expands; `RAW=123$567` → Node `123$567`, Bun `123` (silent truncation). #4177 OPEN since 2023 ("add ability to disable variable expansion"); #4994; #14059 ("Node does not do that, and neither does 'dotenv'. So I need to keep 2 env files"); #32411 OPEN (`${FOO:-${BAR:-baz}}` SEGFAULTs). Bun's *own* Node-compat code already opts out: `src/runtime/node/node_util_binding.rs:178` calls `load_from_string::<true, false>` (EXPAND=false) so `util.parseEnv` matches Node - an in-tree admission.
why bad: Real secrets contain `$` (every bcrypt hash starts with `$2b$`). Bun silently rewrites them; single quotes (the escape everyone reaches for) do nothing; the only escape (`\$`) produces a different value than Node reads from the same file.
bun 2.0 proposal: Off by default, matching `node --env-file`/`dotenv`. If kept, never expand single-quoted values, and add `--no-env-expand`. Fix the nested-default SEGV regardless.
blast radius: high for anyone composing `DB_URL=…$USER:$PASS@…` - a one-line mechanical migration.

### `--compile` binaries auto-load `.env` and `bunfig.toml` from the end user's cwd
what: A `bun build --compile` executable, run by an end user in any directory, reads that directory's `.env*` and `bunfig.toml` into itself by default.
where: `src/options_types/context.rs:276-279` - `compile_autoload_dotenv: true`, `compile_autoload_bunfig: true`, but `tsconfig`/`package-json` already default `false`; flags at `src/runtime/cli/Arguments.rs:412-434`.
evidence: `docs/bundler/executables.mdx:404-412` Note block, verbatim: "In a future version of Bun, `.env` and `bunfig.toml` **may also be disabled by default** for more deterministic behavior." The team already flipped the other two; these are the known-bad half. #22368 OPEN.
why bad: A "standalone executable" isn't: a stray `.env` (other apps' secrets, planted `BUN_CONFIG_*`) or `bunfig.toml` (registry, `preload`, `[define]`) changes its behavior. The docs call the current default out as pending.
bun 2.0 proposal: Flip both to `false`; keep the existing opt-in flags.
blast radius: medium - compiled CLIs relying on ambient `.env` add one flag.

### `Blob`, `File`, and `BunFile` are one native class
what: `Bun.file()`, `new File()`, and `new Blob()` all produce the same native `Blob`; `File.prototype === Blob.prototype`; `Blob.prototype` carries 11 non-standard members (`exists`, `unlink`, `delete`, `write`, `writer`, `stat`, `name`, `lastModified`, `json`, `formData`, `image`).
where: `src/runtime/webcore/response.classes.ts:158-207`; `src/jsc/bindings/JSDOMFile.cpp:13-64`.
evidence: Verbatim source (verified): `response.classes.ts:179-180, 188-189` - "`// TODO: Move this to a separate File object or BunFile` / `// This is *not* spec-compliant.`"; `JSDOMFile.cpp:50-51`: "This is not quite right. But we'll fix it if someone files an issue about it."; `:61`: "Note: this breaks [Symbol.hasInstance]". Verified: `new Blob().lastModified === 4503599627370495`; `await new Blob().exists() === true`; `Object.prototype.toString.call(new File([],"x")) === "[object Blob]"`. Open confirmed bugs: #14102, #20700, #26967, #32434, #32430. An unmerged fix branch exists (`origin/claude/fix-bunfile-class-26967`).
why bad: Observable WHATWG File API violation on a web-standard global. `instanceof`, `constructor.name`, `"name" in blob` feature-detection, and `Symbol.toStringTag` all misbehave; there is no exported `BunFile` to brand-check. Forcing S3 onto `Blob` also produced the `@deprecated size: NaN` on `S3File`.
bun 2.0 proposal: Real `BunFile extends File extends Blob` (the unmerged branch). Move the 11 members to the right prototypes. Export `Bun.BunFile`.
blast radius: medium - `Bun.file()` users keep working; only duck-typing on raw `Blob` changes.

### Reading `BunFile.size` or calling `.exists()` permanently caches a size that corrupts later I/O
what: The first `.size` access (or `.exists()`, which calls it) memoizes the file size onto the object forever; later `Bun.write`, `.text()`, `.arrayBuffer()` use the stale value and silently truncate or write nothing.
where: `src/runtime/webcore/Blob.rs:2349-2427` (`get_size`/`resolve_size`, with `self.size.set(0)` on stat failure at `:2423`), `:1309-1312` (`exists()` → `resolve_size`).
evidence: #4930 "Calling `BunFile.exists` makes `Bun.write` write nothing" - OPEN since Bun 1.0.0 (2.5 years), reconfirmed on 1.2.9. Reproduced on 1.4.0: `await out.exists(); await Bun.write(out, Bun.file(src))` → 0 bytes. The `.d.ts` says the opposite twice ("size is not valid until the contents are read at least once" - `bun.d.ts:2078-2080`). `.size` also returns `0` for missing files, `Infinity` for pipes, and `4096` for directories while `.exists()` says `false` for the same path.
why bad: A getter that looks like a cheap read does a blocking `stat()` *and* irreversibly changes future I/O. A 2.5-year-old open data-loss bug that cannot be fixed without a semantic break.
bun 2.0 proposal: Stop memoizing (re-stat on each access and never feed the cache into read/write), or adopt the File API snapshot model (changed mtime/size → `NotReadableError`). Route callers to `await file.stat()`.
blast radius: medium - only observable for files that change after the handle is created, which is the broken case today.

### `bun:sqlite` defaults: silent NULL on missing params, silent int truncation, silent `close()`
what: By default a typo'd/missing named parameter binds `NULL` with no error (and keys must carry the `$`/`:`/`@` sigil); INTEGERs above 2^53 silently round to the nearest double; `db.close()` discards failures. All three safe behaviors are opt-in (`strict`, `safeIntegers`, `close(true)`).
where: `src/jsc/bindings/sqlite/JSSQLStatement.cpp:944, 160-164`; `packages/bun-types/sqlite.d.ts:55, 62-84, 288`.
evidence: The team scaffolded and abandoned the fix: `JSSQLStatement.cpp:57-59` has `#ifndef BREAKING_CHANGES_BUN_1_2 / #define BREAKING_CHANGES_BUN_1_2 0`, and `test/harness.ts:18` has `export const BREAKING_CHANGES_BUN_1_2 = false;` - both added by the same PR (#11887, v1.1.14) that made `strict`/`safeIntegers` opt-in; the 1.2 break never shipped. `sqlite.d.ts:288`, verbatim: "In the future, Bun may default `throwOnError` to `true`, but for backwards compatibility it is `false` by default." `docs/runtime/sqlite.mdx:79` documents the silent-NULL default. Reproduced: storing `990760989492400188` reads back `990760989492400100`. Node's `node:sqlite` and better-sqlite3 both default safe.
why bad: Two of the three are silent data corruption. The default diverges from the API Bun credits as its inspiration (better-sqlite3) and from `node:sqlite`.
bun 2.0 proposal: `strict: true`, `safeIntegers: true`, `close()` throws - exactly the abandoned `BREAKING_CHANGES_BUN_1_2` plan. Accept keys with or without the prefix.
blast radius: medium-high - code relying on silent NULL or on `number` return breaks loudly (good).

### `Bun.password.hash/verify` (async) stringify arbitrary input; the sync twins throw
what: `await Bun.password.hash(undefined)` produces a real bcrypt hash of the 9-byte string `"undefined"` and `verify("undefined", h)` → `true`; `hashSync(undefined)` throws.
where: `src/runtime/crypto/PasswordObject.rs:756, 859, 866`.
evidence: Three verbatim source comments (verified): `// TODO: this most likely should error like \`hashSync\` instead of stringifying.` Reproduced for `undefined`, `42`, `{}` (→ `"[object Object]"`).
why bad: A missing form field silently becomes the password `"undefined"` - a security bug the sync variant already prevents, in the one API family that must never coerce. The maintainers wrote down that it's wrong, three times.
bun 2.0 proposal: Validate like `hashSync`/`verifySync` (throw `ERR_INVALID_ARG_TYPE`); delete the three TODOs.
blast radius: low - code passing non-strings here is already buggy.

### `NODE_TLS_REJECT_UNAUTHORIZED="false"` disables TLS verification (Node: no-op)
what: Bun treats both `"0"` and `"false"` as "turn off certificate verification"; Node only honors the exact string `"0"`.
where: `src/jsc/bindings/JSEnvironmentVariableMap.cpp:253-258` (verified); `src/js/node/tls.ts:449-452`.
evidence: Verbatim source comment (verified): `// TODO: only check "0". Node doesn't check both. But we already did. So we / // should wait to do that until Bun v1.2.0.` Bun is past 1.2.0.
why bad: A security-relevant silent divergence: a value that is a harmless typo on Node downgrades Bun to accepting any certificate. The comment names the version boundary the team was waiting for.
bun 2.0 proposal: Only `"0"` disables, matching Node; optionally warn once on `"false"`.
blast radius: low - and the change *restores* security for the affected users.

### `install.linkWorkspacePackages` defaults to `true`
what: A bare semver dep (`"pkg-a": "1.0.0"`) inside a workspace silently resolves to the local workspace copy instead of the registry.
where: `src/install/PackageManager/PackageManagerOptions.rs:113`; `src/install/lockfile/Package.rs:1885`.
evidence: The team's own breaking-change tracker - #20292 "Breaking changes for Bun v1.3" - lists, still unchecked: "default value `false` for `install.linkWorkspacePackages`". #8811 is the original request. Modern pnpm defaults this to `false`.
why bad: A pinned registry version is silently swapped for the workspace HEAD, so CI/publish sees a tree the lockfile doesn't describe. The team already agreed and ran out of minor-release budget.
bun 2.0 proposal: Default `false`; only the `workspace:` protocol links.
blast radius: high (every Bun monorepo using bare semver for siblings) but it fails loudly.

### `fetch()` errors are plain `Error`s with Bun-invented codes; unknown HTTP methods silently become `GET`
what: (a) Network failures reject with a plain `Error` carrying PascalCase codes (`ConnectionRefused`) instead of the spec-mandated `TypeError` with Node errno codes. (b) Any method not in a closed hardcoded enum is coerced to `GET` by `fetch()` and 400'd by `Bun.serve`.
where: (a) `src/runtime/webcore/fetch/FetchTasklet.rs:1285-1287`; (b) `src/http_types/Method.rs:6` (closed enum), `src/runtime/webcore/fetch.rs:639` (`.unwrap_or(Method::GET)`).
evidence: (a) Verbatim source comment (verified): "Keep this list narrow; the catch-all SystemError below is **still a plain Error for backwards compat**." #20486 OPEN (quotes Fetch spec §12.3: network errors MUST be `TypeError`); #11345. (b) #21566 OPEN "Non-standard and broken handling of HTTP methods" (quotes RFC 9110 §9 + Fetch spec: "`CHICKEN` is perfectly acceptable"), consolidating #6021, #6556.
why bad: `err instanceof TypeError` and `err.code === 'ECONNREFUSED'` are what every retry library switches on; both misfire. `fetch(url, {method:"pAtCh"})` silently sends `GET` - a data-loss-grade rewrite.
bun 2.0 proposal: Reject with `TypeError("fetch failed", { cause })` carrying Node-style `code`/`errno` (undici's shape). Store methods as strings, case-normalizing only the six spec-listed ones.
blast radius: medium for error shape (code written for Node starts working); low for methods.

### Auto-install is on by default, and the source calls it "quite buggy and untested"
what: When no `node_modules` exists above cwd, Bun abandons Node resolution and downloads bare imports from npm at runtime, ignoring `bun.lock`, `package.json` ranges, `.npmrc`, and bunfig registries.
where: `src/options_types/global_cache.rs:6-7` (`#[default] auto`), `:31-50`; `src/resolver/resolver.rs:941-958`.
evidence: Verbatim source comment: "auto install, as of writing, is also **quite buggy and untested, it always installs the latest version regardless of a user's package.json or specifier**. in addition to being not fully stable, it is completely unexpected to invoke a package manager after bundling an executable." Confirmed by OPEN issues: #21832 (`confirmed bug`), #21030 (container shipped `dist/` + `bun.lock`, Bun auto-installed zod **4** where the lockfile said 3.22), #11434, #14378. `docs/runtime/auto-install.mdx:24-26` promises the exact lockfile honoring the comment says doesn't happen.
why bad: "No `node_modules`" is indistinguishable from "forgot to run `bun install`" - the moment you least want silent `latest` from the public registry. Documented behavior and implementation flatly disagree.
bun 2.0 proposal: Default to `disable` (error with "run `bun install`" / "pass `-i`"). If it stays, it must share the install resolver (lock, `.npmrc`, scopes).
blast radius: medium - the "download a gist and `bun x.ts` it" demo needs `-i`.

### `Bun.readableStreamTo*`: half-deprecated toward a non-standard replacement that doesn't typecheck
what: 4 of 7 `Bun.readableStreamTo*` helpers are `@deprecated` in favor of Bun-only `ReadableStream.prototype.{text,json,bytes,blob}` - which are themselves non-standard, and whose types only augment `stream/web`, never the global `ReadableStream`. Meanwhile the standard `ReadableStream.from()` is missing.
where: `packages/bun-types/deprecated.d.ts:44-84`; un-deprecated siblings at `bun.d.ts:1778, 1809, 1820`; `overrides.d.ts:28-35` (the `declare module "stream/web"` augmentation).
evidence: #29401 OPEN, title: "ReadableStream is deprecated but proposed replacement doesn't exist." - `stream.text()` is `error TS2339` with `lib.dom`. The surviving helpers declare `Promise<T> | T` returns but always return a Promise (verified). Docs (`utils.mdx`, `binary-data.mdx`) still teach all 7 with no deprecation note. #3700 OPEN "Support `ReadableStream.from()`" - in the WHATWG standard and in Node 20.6, Deno, Firefox.
why bad: The team deprecated its own API toward one it never typed, only half-migrated, and the replacement is *also* non-standard. Three sources of truth (types, docs, runtime) disagree.
bun 2.0 proposal: Delete all seven; ship `ReadableStream.from()`; if the prototype consumers stay, type them on the global.
blast radius: medium - in every old tutorial, but the rewrite is mechanical.

### `bun test` shares one process; `mock.module()` is process-global and irreversible
what: `mock.module()` writes a registry that is never reset and cannot be undone; because `bun test` runs every file in one process by default, mocks leak across files.
where: `src/jsc/bindings/BunPlugin.cpp:507`; `docs/test/mocks.mdx:413` ("`mock.restore()` … does not reset modules overridden with `mock.module()`"); `docs/test/runtime-behavior.mdx:302-314`.
evidence: #31316 ("Real-world vitest → bun test migration") calls it "**the headline blocker**." #7823, #7376, #30242, #6024, #9243. The maintainer closing #12823: "Fixed by #29354 - `bun test --isolate` … **may become the default in Bun v1.4**."
why bad: The default is the unsafe one: test correctness depends on file ordering, and there is no `jest.unmock`/`resetModules`. The team has written that the default should flip.
bun 2.0 proposal: Make per-file isolation the default; add `mock.module.restore()`; keep `--no-isolate`.
blast radius: high - but the maintainer has already named it.

### `development: false` silently turns on `SO_REUSEPORT`
what: Passing `development: false` (but not `reusePort`) to `Bun.serve` sets `reusePort: true`, so two servers on one port silently load-balance instead of getting `EADDRINUSE`.
where: `src/runtime/server/ServerConfig.rs:816` - `args.reuse_port = args.development == DevelopmentOption::Production;` (verified verbatim). `serve.d.ts:780` says `reusePort` `@default false` - wrong for this path.
evidence: Jarred on #1443: "Originally, `reusePort: true` did not exist, it was implicitly the default behavior … **This is very confusing in development** … So we added `reusePort: true` to make this behavior explicit." Line 816 is the undocumented residue of the old default. `rg reusePort docs/` never mentions the coupling.
why bad: A debug-page toggle silently changes a socket-level flag, removing the `EADDRINUSE` safety net in exactly the production configuration. The `.d.ts` is factually wrong.
bun 2.0 proposal: Delete line 816. `reusePort` defaults `false` unconditionally.
blast radius: low - anyone relying on it gets a clear `EADDRINUSE` and a one-line fix.

### `connectError`: the API's own author filed the deprecation
what: `Bun.connect`/`Bun.listen` handlers have both `error` and `connectError`; the promise's unhandled-rejection status silently depends on whether `connectError` is present.
where: `packages/bun-types/bun.d.ts:6310, 6327-6340`; `src/runtime/socket/Handlers.rs:34, 359`.
evidence: Issue #4351, **filed by Jarred-Sumner**: "Deprecate `connectError` … **It's very confusing to have this other error handler. There should only be one error handler.**" Opened Aug 2023, closed NOT_PLANNED Oct 2025 - wanted, but un-shippable inside 1.x.
why bad: Three overlapping error channels (rejection, `connectError`, `error`), and an unrelated option changes rejection semantics. The maintainer said so.
bun 2.0 proposal: One `error(socket, err)`; connection failures always reject the `Bun.connect` promise.
blast radius: medium - only code relying on the rejection-suppression side effect.

### `ResolveMessage` / `BuildMessage` / `SQLiteError` are not real `Error`s
what: `require()`/`import()` failures throw `ResolveMessage`/`BuildMessage`, which do not extend `Error` and whose messages differ from Node's; `bun:sqlite` errors are plain `Error`s with `name` forged and `instanceof` spoofed via `Symbol.hasInstance` string comparison.
where: `src/jsc/ResolveMessage.rs`, `src/jsc/BuildMessage.rs`; `src/js/bun/sqlite.ts:685-696` ("// This class is never actually thrown / // so we implement instanceof so that it could theoretically be caught").
evidence: #7531 "BuildMessage/ResolveMessage should extend `Error`" - OPEN, `bug`, **filed by then-Bun-team member paperclover**. Reproduced: `require("nope")` → `instanceof Error === false`, no `stack`/`requireStack`, message `"Cannot find package 'nope'…"` vs Node's `"Cannot find module 'nope'"`. Fallout: #9919 (ESLint), #6730, #6555. For SQLite: `Object.getPrototypeOf(e) === SQLiteError.prototype` is `false` (reproduced); the `.d.ts` declares `class SQLiteError extends Error`, which is not what is thrown.
why bad: `err instanceof Error`, `err.stack`, `err.name === "Error"`, and the ubiquitous `/^Cannot find module '(.+)'/` regex (Express views, jest resolvers) all misbehave. Sentry special-cases non-Error throwables.
bun 2.0 proposal: `ResolveMessage extends Error`, `BuildMessage extends SyntaxError`, adopt Node's message wording + `requireStack`; give `bun:sqlite` a real native error class.
blast radius: low - nobody depends on `instanceof Error` being *false*.

### The `@deprecated` graveyard + source-admitted micro-regrets
what: A dedicated 185-line `packages/bun-types/deprecated.d.ts`, 54 `@deprecated` tags across the types, plus a handful of one-line source-admitted regrets with near-zero blast radius - all individually blocked on a major.
where / evidence (each verbatim, each verified or issue-cited):
- `TLSOptions.keyFile`/`certFile`/`caFile` - "@deprecated **since v0.6.3** - Use `key: Bun.file(path)`" (`deprecated.d.ts:132,141,148`); still parsed at `src/runtime/socket/SSLConfig.rs:197-206`. The oldest surviving deprecation in the package, in a TLS code path.
- Globals `BuildError`/`ResolveError` - "@deprecated Renamed to `BuildMessage`/`ResolveMessage`" (`deprecated.d.ts:177,182`); still installed on `globalThis` (`ZigGlobalObject.lut.txt:36,41`).
- `Errorlike` → `ErrorLike` - a *casing typo* kept forever (`deprecated.d.ts:119`).
- `Bun.shrink()` - bare `@deprecated` with **no replacement named** (`bun.d.ts:4834`).
- `Bun.postgres` - `@deprecated Prefer {@link Bun.sql}` (`sql.d.ts:944`); verified `Bun.postgres === Bun.sql`. The name is now a lie (`Bun.SQL` also speaks MySQL/MariaDB/SQLite).
- `Bun.SQL.Options` - **ten** `@deprecated` snake_case aliases from `postgres.js`, including **four spellings of one timeout** (`connection_timeout`/`connect_timeout`/`connectTimeout`/`connectionTimeout`, `sql.d.ts:291,299,307`). The runtime's own error messages still print the deprecated names (`src/js/internal/sql/shared.ts:1981,1995,2005`).
- `Bun.resolve` - "`Use {@link resolveSync} instead. This async version has **no performance benefit; it exists for future-proofing**.`" (`bun.d.ts:1554`); `import.meta.resolveSync` `@deprecated` (`globals.d.ts:1326`). Five overlapping resolvers.
- `Bun.spawn`'s `SpawnOptions`/`OptionsObject` - both `@deprecated` (`bun.d.ts:6671-6674, 6707-6710`).
- `S3Options.highWaterMark` `@deprecated`; `import.meta.hot.decline()` - `/** No-op @deprecated */` (`devserver.d.ts:137-141`); seven types tagged "Unused in Bun's types and may be removed" (`deprecated.d.ts:2-30,123,153`).
- `Bun.serve({ static })` - undocumented, untyped alias of `routes` (`ServerConfig.rs:651`: `for key in ["routes", "static"]`), plus `webSocket`, `host`, `baseURI`, and a pre-0.3 **top-level TLS shim** where any stray `ca`/`passphrase` key flips the server into TLS mode (`ServerConfig.rs:1419-1428`, verbatim `// @compatibility Bun v0.x - v0.2.1`).
- `bun pm view` - help text (verbatim, `package_manager_command.rs:163`): "view package metadata from the registry (**use `bun info` instead**)".
- `bun shell mkdir` accepts `--vebose` and rejects `--verbose` - verbatim, `mkdir.rs:435`: "`// Note: the \`--vebose\` typo is intentional (kept for compatibility).`" (verified in source). A copy/paste typo is load-bearing API.
- `Bun.generateHeapSnapshot("jsc")` returns a parsed *object* - verbatim, `BunObject.cpp:836`: "`// Returning an object was a bad idea but it's a breaking change`" (verified).
- `FileSystemRouter` case-insensitivity hack - verbatim, `src/router/lib.rs:638`: "`// This hack is below the engineering quality bar I'm happy with. It will cause unexpected behavior.`" (verified).
- `BUN_CONFIG_NO_VERIFY` has **inverted** semantics: `=0` disables package-integrity verification, `=1` is a no-op (verified: `PackageManagerOptions.rs:664-666` - `check_bool != b"0"`, the opposite comparison of its three adjacent `BUN_CONFIG_SKIP_*` siblings at `:652-662`). Undocumented, security-adjacent, and inverted relative to the `--no-verify` CLI flag of the same name.
- `BUN_ENV` silently takes precedence over `NODE_ENV` for `.env.{mode}` selection (`src/dotenv/env_loader.rs:179-183`) and appears in **zero** documentation (`grep -rn BUN_ENV docs/` → nothing).
why bad: Each is an individually-acknowledged mistake. None can be removed inside 1.x, so the file only grows; `deprecated.d.ts` is the single densest regret signal in the repo.
bun 2.0 proposal: Delete the lot in one pass. 2.0 is the only release where this is legal.
blast radius: low individually; low-medium in aggregate (`keyFile`/`certFile` will hit real TLS configs).

---

## Tier 2: worth debating (real cost both ways)

### Module format decided by content sniffing - `"type"`, `.mjs`, `.cjs` are ignored
what: Bun decides CJS-vs-ESM by scanning syntax (`import`/`export` → ESM; else `require`/`__dirname`/`"use strict"` at top → CJS), ignoring `package.json` `"type"` and the `.mjs`/`.cjs` extensions Node treats as the source of truth. `require`, `__dirname`, `__filename` are also all defined inside real Bun ESM.
where: `src/js_parser/parse/parse_entry.rs:1736-1781`; `src/bundler/options.rs:699-700` (`.mjs`/`.cjs` → plain `Js`).
evidence: Verbatim source comment: "**Divergence from esbuild and Node.js**: we default to ESM when there are no exports. However, this breaks certain packages." Reproduced: a `"type":"module"` `.js` with `"use strict";` is CJS in Bun, ESM in Node; `foo.mjs` with `module.exports` runs in Bun, SyntaxErrors in Node; `typeof __dirname === "undefined"` (the universal CJS/ESM detection idiom) is false in Bun ESM. #18584, #27425, #32057.
why bad: The same file has different `this`, globals, and export shape depending on which runtime loads it - the root of an entire class of "works in Bun, breaks in Node."
bun 2.0 proposal: Honor `.mjs`/`.cjs` and `"type"`; keep sniffing only for `.js` with no `"type"`. Stop treating `"use strict"` as a CJS signal.
blast radius: high - a lot of Bun-only code depends on the leniency. That is exactly what the debate is about.

### `bun:ffi`: pointers are lossy IEEE-754 doubles
what: Native pointers are JS `number`s (`Pointer = number & {…}`). The implementation's own bound is `MAX_ADDRESSABLE_MEMORY = (1<<56)-1` (`FFIObject.rs:916-918`) - *above* a double's 2^53 exact range - so pointers can silently corrupt. Plus: native validation failures are *returned* as `Error` values instead of thrown (and `new CString(badPtr)` uses the error's `.toString()` as the string's *content*); `JSCallback({threadsafe:true})` is documented as not working from library-spawned threads (the only reason it exists) and its `returns:"void"` guard is provably dead code; `toBuffer` without a finalizer *adopts* (frees) foreign memory while `toArrayBuffer` borrows.
where: `packages/bun-types/ffi.d.ts:339`; `src/jsc/JSValue.rs:94-105`; `src/runtime/ffi/FFIObject.rs:426-596, 914-918`; `src/jsc/bindings/JSFFIFunction.cpp:208-223`; `src/runtime/ffi/ffi_body.rs:1819-1829` (the guard reads the out-param's default before it is assigned).
evidence: #29346 / #22751 (pointer segfaults at `0xFFFFFFFFFFFFFFFF`); the docs' own arithmetic is wrong (`ffi.mdx:361`: "leaves about 11 bits of extra space" - it's 1). `ffi.mdx:320`: "A future version of Bun will enable them to be called from any thread" - i.e. `threadsafe` is named for something it doesn't do (#28113, #24529 OPEN segfaults). `ffi.mdx:6-9`: "**should not be relied on in production**"; `ffi.mdx:482`: "A future version of Bun may add a CLI flag to disable `bun:ffi`." Deno broke compat in 1.31 to move pointers off `number` for exactly this reason.
why bad: Silent pointer corruption is an unfixable-by-design memory-safety hazard; the module mixes throw/return/stringify for errors; `threadsafe` is a lie.
bun 2.0 proposal: Opaque/`bigint` pointers; every native entry throws; reimplement `threadsafe` on a real MPSC channel or remove the option.
blast radius: high within `bun:ffi` - but the module is *labeled experimental and disavowed for production*, so 2.0 is its one chance.

### `expect().resolves` / `.rejects` synchronously block the event loop
what: In `bun:test`, `expect(p).resolves.toBe(x)` spins the event loop inside the matcher until the promise settles, so Bun users write it without `await` - the exact opposite of Jest/Vitest, where the chain returns a Promise that MUST be awaited.
where: `src/runtime/test_runner/expect.rs:409, 852, 1454` (`wait_for_promise`); types at `test.d.ts:928, 936` (not `Promise<...>`).
evidence: #15457 "Undocumented incompatibility between `bun:test` and `jest`": "The matchers from `bun:test` will block until the `Promise` is resolved or rejected." Also #15428, #19679.
why bad: A `bun:test`-authored un-awaited `expect(p).rejects.toThrow()` is a **vacuous no-op** in every other runner (the repo's own review guide calls un-awaited `.rejects` a rejected pattern). Blocking the loop inside a matcher deadlocks under fake timers and is undefined under `test.concurrent`. The types lie (they say `void`).
bun 2.0 proposal: Make them terminal matchers that return `Promise<void>` (Jest semantics); ship a transition lint.
blast radius: medium - tests that already `await` (the idiomatic form) keep working.

### `ReadableStream({ type: "direct" })`: a second, non-standard stream protocol; standard `"bytes"` declared unsupported
what: Bun adds a third `underlyingSource.type` whose bare-object controller has consumer-dependent identity and a `write()` whose *return value* depends on which function consumes the stream (verified: 5 (UTF-16 length) via `toText`, 6 (UTF-8 bytes) via `toArrayBuffer`), signaling backpressure by returning a negative number. Meanwhile the public types say the *standard* byte mode is unsupported - which is false.
where: `bun.d.ts:300-314`, `globals.d.ts:698-731`; `src/js/builtins/ReadableStreamInternals.ts:1176, 1516-1636`; `src/runtime/webcore/streams.rs:383-402, 566`.
evidence: In-source spec-divergence admission (`ReadableStreamInternals.ts:1176`): "`// Direct streams allow $pull to be called multiple times, unlike the spec.`" `bun.d.ts:304-307`, verbatim: `/** Mode "bytes" is not supported. */ type?: undefined;` - **false** (verified: `{type:"bytes"}` + BYOB reader works on 1.4). In-source post-mortem (`ReadableStreamInternals.ts:2132-2142`): native streams "was a type: 'bytes' until Bun v1.1.44, but pendingPullIntos was not really compatible…" - so `fetch().body.getReader({mode:"byob"})` silently diverges from every other runtime. Fallout: #11232, #10632, #8404, #13811, #31887.
why bad: An entire second stream protocol grafted onto a WHATWG constructor, squatting an extension point WHATWG owns, while the types actively steer users *away* from the standard mode with a false statement.
bun 2.0 proposal: Fix the `type?: undefined` lie immediately (1.x). For 2.0, make native sources real byte streams again; move the zero-copy path behind `type:"bytes"`/`byobRequest` and remove `"direct"` from the public constructor.
blast radius: high - `type:"direct"` is the documented SSE/SSR fast path.

### Non-standard additions bolted onto WHATWG globals (umbrella)
what: Bun extends standard globals with un-prefixed members that no spec or other runtime has, several already obsoleted by the standard.
where / evidence (all verified at runtime or verbatim):
- `Headers.prototype.getAll()` - removed from the Fetch Standard in **2016**; its WHATWG replacement `getSetCookie()` ships right next to it but is **absent from Bun's own types** (`fetch.d.ts:36-70`). The doc says other names "return an empty array"; the runtime throws `Only "set-cookie" is supported.` (`JSFetchHeaders.cpp:220`). Plus non-standard `toJSON()`/`count`.
- `Blob.prototype.json()/formData()/image()`, `FormData.from()` (not even in `@types/bun`), `URLSearchParams.prototype.toJSON()`, `ReadableStreamDefaultReader.prototype.readMany()` ("Only available in Bun", `globals.d.ts:744`). Source comments: `// Non-standard functions` (`JSFetchHeaders.cpp:77`, `JSDOMFormData.cpp:104`).
- `new Request({url, ...init})` and `Response.json(body, 404)` - neither shape is in the Fetch spec; both throw in Node 26 (verified). `Response.json({}).headers.get("content-type")` is `"application/json;charset=utf-8"` vs the spec's mandated `"application/json"` (#19603) - `Blob.type` gets the same silent `;charset=utf-8` promotion (`src/http_types/MimeType.rs:59-97`).
- `console[Symbol.asyncIterator]` yields lines from **stdin** (`globals.d.ts:1141-1169`); `HTMLRewriter` (a single-vendor Cloudflare API, the only entry in `docs/runtime/globals.mdx` whose "Source" column reads `Cloudflare`) lives on `globalThis`, not `Bun.*`; `fetch.preconnect()` hangs off the standard `fetch` function.
- `fetch("file:///…")` reads the filesystem and `fetch("s3://…")` hits S3 (verified; Node throws). WHATWG Fetch on `file:` URLs: "When in doubt, return a network error."
why bad: Each is a forward-compat landmine the web platform can collide with, and a one-way portability trap (works in Bun, throws elsewhere). The `getAll` case is already a collision - Bun types the dead method and omits the live one.
bun 2.0 proposal: Keep genuinely-useful extensions under `Bun.*` or a `bun:` module. Remove `getAll` (point at `getSetCookie`), the `Response.json(x, number)` overload, `console[Symbol.asyncIterator]`, and the charset promotion. Gate `file://`/`s3://` in `fetch` behind an opt-in.
blast radius: low-medium per item; each has a one-line standard rewrite.

### `fetch`'s 9 Bun extensions don't survive `new Request()`, and `keepalive` is repurposed
what: `proxy`, `unix`, `tls`, `s3`, `verbose`, `decompress`, `compress`, `maxRedirects`, `protocol` are honored only as a second argument to `fetch()`, not through a `Request` - so every fetch-wrapping library (`ky`, `ofetch`, MSW) silently loses them. Separately, the standard `RequestInit.keepalive` is read as "HTTP connection reuse" (a different concept), and the parser even accepts a *number*.
where: `packages/bun-types/globals.d.ts:1918-1923, 1930-1935, 2018`; `src/runtime/webcore/fetch.rs:914-938`.
evidence: The `.d.ts`'s own doc comment on the interface: "These extensions are not part of `RequestInit` because **they don't work when passed to `new Request()`**." `verbose`: "**This API may be removed in a future version of Bun without notice.**" `protocol` accepts four spellings of two values (`"http2"|"http1.1"|"h2"|"h1"`). #6349 OPEN (breaks `ky`). WHATWG `keepalive` means "outlive the page" (the `sendBeacon` case, 64 KiB cap), not connection pooling. `docs/.../fetch.mdx:261` documents the wrong meaning.
why bad: `fetch(url, init)` and `fetch(new Request(url, init))` silently diverge; a standard option name has a contradictory, non-feature-detectable meaning.
bun 2.0 proposal: Either make the extensions round-trip through `Request`, or move them to an explicit `Bun.Agent`/`dispatcher` object (undici's design). Rename the pooling knob off `keepalive`. Delete `verbose` (it pre-announced its own removal).
blast radius: medium - options keep working at the `fetch()` call site.

### `import.meta` has two names for every fact, plus a Vite collision
what: Bun invented `import.meta.dir`/`path`/`file` before Node standardized `dirname`/`filename`; both sets now ship. `import.meta.env` is a third alias of `process.env`.
where: `packages/bun-types/globals.d.ts:1299-1363`.
evidence: Verbatim (`globals.d.ts:1359, 1362`): `dirname` - "**Alias of `import.meta.dir`**. Exists for Node.js compatibility"; `filename` - same - i.e. the doc treats the *Node-standard* names as the aliases. `import.meta.file` (basename, `"index.tsx"`) sits next to `import.meta.filename` (absolute path): the two most-similar names mean different things. `import.meta.env === process.env` (verified) - a third env alias that collides with Vite's statically-replaced, prefix-filtered concept, and the bundler inlines `import.meta.env` but not `Bun.env` (#5833, #28692), so "aliases" compile differently. Real divergence bugs: #15359, #18753, #20961.
why bad: Five properties express two path values; three spellings of the environment triples the bug surface. The "Node compatibility" comments invert history.
bun 2.0 proposal: Keep `dirname`/`filename` and `process.env` as primaries; deprecate then remove `dir`/`path`/`file`/`resolveSync`/`import.meta.env`.
blast radius: medium - `import.meta.dir` is pervasive in Bun code. A trivial codemod; that is the whole debate.

### tsconfig `paths`/`baseUrl` are applied at runtime - including from tsconfigs inside `node_modules`
what: Bun's runtime resolver applies `compilerOptions.paths`/`baseUrl` from the *nearest enclosing* `tsconfig.json` as the first step of every resolve. `baseUrl: "."` turns bare specifiers into project-relative lookups that shadow real npm packages, and a `tsconfig.json` shipped inside a dependency rewrites that dependency's own `require()`s.
where: `src/resolver/resolver.rs:1895-1917, 1022-1053`; `docs/runtime/module-resolution.mdx:286-310`. Tellingly, tsconfig autoload is already **off by default** for `--compile` (`Arguments.rs:425`).
evidence: Reproduced: project `baseUrl: "."` + a root `lodash.ts` → `import "lodash"` loads the local file, not `node_modules/lodash` (Node loads the real package). A dep shipping its own `tsconfig.json` with `baseUrl: "."` silently redirects its own dependency graph. `tsc` itself never applies `paths` at emit; TypeScript's docs say it's type-check-only. "Nearest enclosing" means an alias silently changes meaning across workspace packages: #21056, #14694, #3617, #23695, #4774, #26793 all OPEN.
why bad: Code written against this runs *only* in Bun. The `node_modules` + `baseUrl` case is a supply-chain-shaped footgun with no opt-out. The team already turned it off for `--compile` - an implicit admission.
bun 2.0 proposal: Never read tsconfigs inside `node_modules`; stop honoring `baseUrl` as a bare-specifier fallback (esbuild warns for the same reason); keep plain `paths` but behind an explicit opt-in, steering toward the Node-standard `package.json#imports`.
blast radius: high for `paths` (loved, pervasive); low for the `node_modules`/`baseUrl` halves - which almost never carry intended behavior.

### `bun <name>` resolution order + the system-`$PATH` fallthrough
what: `bun <x>` resolves against ~45 built-in subcommands (plus 8 "reserved for future use") *before* package.json scripts, so `bun deploy`/`bun build`/`bun info`/`bun a` never run your script, and every new Bun subcommand is a silent retroactive break. `bun run <x>` and the naked `bun <x>` are documented as identical but give the child a different `$PATH`. And when nothing matches, `bun run <x>` falls through to *any binary on the system `$PATH`*.
where: `src/runtime/cli/mod.rs:924-1096` (keyword table), `:1069-1079` (8 reserved names), `:788` (the error text itself: "is a subcommand reserved for future use by Bun"); `src/runtime/cli/run_command.rs:2689-2727` (the `$PATH` fallback), `:2036-2052` (the ancestor `node_modules/.bin` PATH walk to `/`); docs `docs/runtime/index.mdx:36` ("it behaves identically") vs `:210-221` (four-level resolution order).
evidence: Verified: with `"scripts": {"deploy": …, "info": …}`, `bun deploy` prints the "reserved for future use" error and `bun info` queried the **npm registry** for a stranger's package. Verified: `bun file.mjs` leaves PATH alone; `bun run file.mjs` prepends `node_modules/.bin` for every ancestor up to `/node_modules/.bin` (duplicated). #31877 OPEN: "`bun run --if-present test` tries to run `/bin/test`" - npm exits 0. #14397, #23093, #22614.
why bad: `--if-present`'s contract is violated because a *system binary* "exists"; a typo'd CI script name executes `/usr/bin/<typo>`. The subcommand namespace is structurally un-extendable. `bunx <name>` has the same flaw (#18127: `bunx sv create` ran runit's `/usr/bin/sv`); the team already patched *only* the scoped-package case.
bun 2.0 proposal: Remove the system-`$PATH` fallback from `bun run` (`bunx`/`bun exec` covers it); make `--if-present` check script existence; stop the `.bin` PATH walk at the package root; make `bun X` and `bun run X` identical; freeze the keyword set.
blast radius: medium-high - `bun dev`/`bun start` are muscle memory; the `$PATH` fallback removal alone is a clear win.

### `Bun.build()` silently swallows unknown options; the loader names have five sources of truth
what: Any unrecognized config key - typos, esbuild names, even top-level `outfile` - is silently dropped with no warning. Separately, the valid loader set differs between the TS `Loader` union, the accepted map, the runtime error message, `docs/bundler/esbuild.mdx`, and the `onLoad`-result list - with direct contradictions.
where: `src/runtime/api/JSBundler.rs:443+` (no did-I-read-everything check), `:410` (`outfile` only under `compile`), `:806-809` (`entryPoints` is a secret esbuild alias); `src/options_types/bundle_enums.rs:174-201`; `packages/bun-types/bun.d.ts:5349-5363`.
evidence: Verified on 1.4.0: `Bun.build({entrypoints:[…], minfy:true, spliting:true, banana:"yes"})` succeeds with zero feedback (esbuild errors: `Invalid option in build() call: "minfy"`). `Bun.build({entrypoints:[…], outfile:"./x.js"})` writes nothing, errors nothing - and **the `.d.ts`'s own JSDoc example** (`bun.d.ts:3014-3021`) uses a top-level `outfile` that is silently dropped. `Bun.build({loader:{".node":"napi"}})` → a `TypeError` that *names `"napi"` as valid in the same message* (and `"napi"` is the only spelling the TS type allows). `loader:"dataurl"`/`"base64"` are accepted everywhere and emit `var x = "";` - silent data loss (#20917 OPEN). `{sourcemap:true}` means `"linked"` with `outdir` and `"inline"` without (`JSBundler.rs:650-658`); the `.d.ts` says it's always inline. `bytecode:true` silently mutates `format` from `"esm"` to `"cjs"` - source comment (`JSBundler.rs:586`): "Default to CJS for bytecode, since esm doesn't really work yet."
why bad: A bundler config is exactly where a typo must fail loudly; shipping an unminified/unsplit/misnamed bundle is worse than an error. The docs, the types, the error strings, and the implementation each give a different answer.
bun 2.0 proposal: Reject unknown top-level keys (listing near-miss esbuild names). Generate the `Loader` union, the error message, and `LOADER_API_NAMES` from one table. Make `outfile` a real key or remove the `entryPoints` half-compat alias.
blast radius: medium - configs with dead keys start erroring, which is the point.

### `Bun.$` shell: a lazy `Promise` subclass + a global-mutating singleton
what: (a) `Bun.$\`…\`` is a `Promise` subclass that does nothing until `.then()`; an un-awaited `$` call silently never executes. (b) `$.nothrow()`/`$.throws()`/`$.env()`/`$.cwd()` mutate the single imported `$` in place while being typed as returning a new `$` - a library calling `$.nothrow()` disables throwing for every other module in the process. (c) Interpolating `undefined`/`null` produces the literal words `"undefined"`/`"null"` and the types permit it.
where: (a) `src/js/builtins/shell.ts:106-250` (`#run()` called only from `then()`); the abandoned eager alternative is commented out at `:146`. (b) `shell.ts:260-315`. (c) `packages/bun-types/shell.d.ts:2-10` (drags `null|undefined` in via `SpawnOptions.Readable`).
evidence: (a) Reproduced: `Bun.$\`touch /tmp/m\`; await Bun.sleep(300)` → the file does not exist. `google/zx` starts eagerly. The types also advertise a `get stdin(): WritableStream` (`shell.d.ts:91`) that has never existed at runtime (verified `undefined`). (b) Reproduced across two modules: a library's `$.nothrow()` made `main.ts`'s `await $\`exit 1\`` not throw. The docs teach it as a feature (`shell.mdx:108`). (c) Reproduced: `$\`echo ${undefined}/sub\`` → `undefined/sub`; a plain `{}` *does* throw, so the hard-error path exists - it just exempts the two most dangerous values. `ShellError.info` is a source-admitted back-compat duplicate (`shell.ts:32-33`: "We previously added this so that errors would display the info property / We fixed that, but now it displays both.").
why bad: A `Promise` whose side effect depends on being observed violates the one invariant everyone has about promises; ambient mutable global config is the classic library-breaks-application footgun; `rm -rf ${dir}/sub` with a possibly-undefined `dir` type-checks.
bun 2.0 proposal: Start the interpreter eagerly on a microtask (the commented-out approach). Make `$.nothrow()` etc. return a new `Shell`. Throw on `undefined` interpolation (matching zx). Delete the phantom `stdin` getter.
blast radius: medium - code that constructs-but-conditionally-awaits `$` objects starts running them.

### `Bun.spawn` surface inconsistencies
what: Four independent contract violations on one API:
- `Subprocess.killed` is `true` after *any* exit, including `exit(0)`. The `.d.ts` admits it - the property named `killed` is documented as `/** Whether the process has exited */` (`bun.d.ts:7271-7274`) - while the user docs (`child-process.mdx:134`) and Node both say the opposite.
- `Bun.spawn({ipc})` defaults `serialization` to `"advanced"`, which the source documents as "**Only valid for bun <--> bun communication**" (`src/jsc/ipc.rs:206`) - so the out-of-the-box IPC handshake with a `node` child delivers zero messages and zero errors (reproduced). Bun even exports `NODE_CHANNEL_SERIALIZATION_MODE=advanced` to the child, but Node's `"advanced"` is a *different* wire format.
- `Bun.spawn`'s default stdio is `["ignore","pipe","inherit"]` while `Bun.spawnSync`'s is `["ignore","pipe","pipe"]` - verbatim in the `.d.ts` (`bun.d.ts:6824-6825`) - despite the docs saying they "support the same inputs and parameters."
- `await proc.exited` resolves to `128 + signal` (or a magic `254`) on signal death, while `proc.exitCode` is `null` - two properties both documented as "the exit code" give different answers (`subprocess.rs:1303-1334`).
evidence: All verbatim quotes / reproduced above. `proc.stdio` is typed `[null, null, null, …]` with two `// TODO: align this with options` comments (`subprocess.rs:836-837`) - the bug is promoted to the contract.
why bad: Every one is a silent divergence from Node or from the adjacent sibling; together they make the most safety-critical API (process spawning) untrustworthy.
bun 2.0 proposal: `killed` = "`.kill()` was called"; IPC defaults to `"json"`; `stderr` defaults to `"pipe"` on both; `exited` resolves to the same `number | null` as `exitCode`.
blast radius: medium - each change is individually observable but small.

### `Bun.serve({ development })` is fail-open and does three unrelated things
what: `development` defaults to `process.env.NODE_ENV !== 'production'`, so a container that forgot `NODE_ENV=production` serves full HTML stack-trace pages by default. The same flag also controls HMR/bundling and (covertly) `reusePort` (Tier 1).
where: `packages/bun-types/serve.d.ts:712` - `@default process.env.NODE_ENV !== 'production'`; `:1137-1144` - "Don't use development mode in production: it risks leaking sensitive information." `src/runtime/server/ServerConfig.rs:717-740`.
evidence: The two `.d.ts` quotes contradict each other by construction. #22055 OPEN is users working around the dev page leaking to non-browser clients. #6015 OPEN since 1.0.3 reports the dev error page's open-in-editor handler as an RCE vector.
why bad: "Leak stack traces unless you remembered an env var" is fail-open; the safe value should be the absence-of-signal value. Bun has better positive dev signals (`--hot`, `--watch`, a TTY) and already reads `--production`.
bun 2.0 proposal: Default `development: false`; enable only on a positive dev signal or explicit `development: true`. Decouple from `reusePort` entirely.
blast radius: high - every local `bun server.ts` loses the pretty error page unless a dev signal is present. That is the debate.

### WebSocket spec violations: `binaryType: "nodebuffer"` default + `upgrade()` subprotocol echo
what: (a) `new WebSocket(url).binaryType` defaults to the non-standard `"nodebuffer"` instead of the HTML-spec-mandated `"blob"`, and assigning an invalid value throws instead of being silently ignored. (b) `server.upgrade()` unconditionally echoes the client's entire `Sec-WebSocket-Protocol` header into the 101 response, which RFC 6455 §4.2.2 forbids (the server must select one or omit the header) - and there is no way to pass "none".
where: (a) `src/jsc/bindings/webcore/WebSocket.h:320-334`; `WebSocket.cpp:1252-1281` (the spec's ignore-behavior is commented out). (b) `src/runtime/server/server_body.rs:1945-1973, 2130-2137`.
evidence: (a) Verbatim source rationale: "In browsers, the default is Blob, however most applications immediately change the default to ArrayBuffer … we set NodeBuffer as the default to match the default of ServerWebSocket." The enum is annotated `// non-standard: NodeBuffer`. Node 22+'s global `WebSocket`, Deno, and every browser default to `"blob"`. #8721, #26669. (b) #18243 OPEN (`bug`), quoting RFC 6455; #26038; #25773 (browsers reject the echoed list when they offered more than one). `uWebSockets.js`, `ws`, and Deno all require the app to select.
why bad: (a) is a spec violation on a web-standard global whose stated rationale optimizes a non-standard sibling; (b) is a spec violation with no upside - a server that implements no subprotocol still "accepts" whatever the client asked for.
bun 2.0 proposal: Default `binaryType` to `"blob"` (or `"arraybuffer"`) with `"nodebuffer"` opt-in. Never echo the subprotocol; add `server.upgrade(req, { protocol })`.
blast radius: medium for `binaryType` (un-set code sees `Blob` instead of `Buffer`); medium for the echo.

### `Bun.listen`/`Bun.connect` footguns: shared `data`, unbuffered `write()`
what: (a) `Bun.listen({ data: obj })` - documented as "the per-instance data context" - hands the *same* object by reference to every accepted socket. (b) `socket.write()` returns a byte count and silently drops the rest; there is no buffering or cork.
where: (a) `bun.d.ts:6363-6366`; `src/runtime/socket/Listener.rs:575-577, 619-622`. (b) `src/runtime/socket/socket_body.rs:2659-2857`; `docs/.../tcp.mdx:191, 237`.
evidence: (a) #25357 OPEN "TCP Socket context data is unexpectedly shared among all sockets"; reproduced (two connections observe each other's state). (b) #9682 ("only the first ~128kb are sent"), closed by Jarred: "**While confusing and different from Node, this is working as intended.** … Unlike Node, Bun does not buffer unsent bytes." The docs tell users to hand-roll a ~12-line `ArrayBufferSink` + `drain` loop and say "Support for corking is planned." The byte count is also unusable when the input is a *string* (the caller has no byte buffer to `subarray`).
why bad: (a) is the worst failure mode for a server - one user's session data leaking into another's - and it's the *first thing* the docs teach. (b) the maintainer's own description of the behavior is "confusing and different from Node."
bun 2.0 proposal: (a) Make listener-level `data` a factory (`data: () => T`), a strict superset. (b) Add buffered writes + `socket.cork()` (the idiom already exists on `ServerWebSocket.cork`), or adopt Node's `boolean` + `drain` contract.
blast radius: low for the factory (nobody depends on accidental sharing); high for `write()` semantics (load-bearing in every protocol built on it) - hence Tier 2.

### `HTMLRewriter` Zalgo + `Bun.Transpiler` defaults
what: (a) When any HTMLRewriter handler returns a Promise, the synchronous `transform()` spins the *entire event loop* (timers, I/O, other promise jobs) inside the call. (b) `transform()`'s return type depends on the argument's runtime class (Response/string/ArrayBuffer), the `.d.ts` overloads are wrong for every TypedArray input, and the declared Blob/BunFile/ReadableStream inputs throw. (c) `Bun.Transpiler` defaults `deadCodeElimination: true` - so the docs' own example `transform("<div>hi!</div>")` returns `""` - and the zero-arg default loader is `jsx` (so TypeScript input throws).
where: (a) `src/runtime/api/html_rewriter.rs:1309-1316, 640-642`; `src/jsc/event_loop.rs:921-937`. (b) `html-rewriter.d.ts:169-181`; `html_rewriter.rs:438-511`. (c) `src/runtime/api/JSTranspiler.rs:106, 93`.
evidence: (a) In-code admission (`html_rewriter.rs:640`): "Since we're **still using** vm.waitForPromise, we have to also override the error rejection handler." Verified: `setTimeout`/`queueMicrotask` scheduled *before* a sync `transform()` whose handler `await`s fire *inside* the call. This is the structural cause of HTMLRewriter's recurring UAF class (commits `0561f87d42`, `4c8a33ebdb`, `e5e9734c02`, `35e9f3d4a2`; open #31804). (b) Bun's own tests mark the stream cases `it.todo` (`test/js/workerd/html-rewriter.test.js:947-955`); #17259, #11758, #14216. Also: `HTMLRewriter` is the only entry in `docs/runtime/globals.mdx` whose Source column reads "Cloudflare" - a single-vendor API on `globalThis` instead of `Bun.*`. (c) Reproduced verbatim from the docs; #14789; the JSDoc labels the knob `@experimental` yet it is on by default. `new Bun.Transpiler().transformSync("let x: number = 1")` throws.
why bad: (a) is textbook release-of-Zalgo and the root of a memory-safety class; (b) and (c) are APIs whose first-from-the-docs usage appears broken.
bun 2.0 proposal: Make `transform(Response)` async (or throw on Promise-returning handlers from the sync path); split `transform(Response): Response` from `transformText(string): string`. Default `deadCodeElimination: false` and the loader to `"tsx"` on `Bun.Transpiler`. Expose HTMLRewriter as `Bun.HTMLRewriter`.
blast radius: high for (a) (signature change); low for (c) (output only gets more faithful).

---

## Tier 3: noted but probably not worth the break

### The `Bun.*` namespace grab-bag: stdlib duplicates and a dead parallel crypto surface
what: Dozens of `Bun.*` members exist only because `node:*` wasn't ready in 0.x, or are superseded internally.
evidence: `Bun.fileURLToPath`/`pathToFileURL`/`allocUnsafe`/`concatArrayBuffers` are byte-identical to their `node:url`/`Buffer` twins (the `concatArrayBuffers` JSDoc itself says "consider `Buffer.concat`", `bun.d.ts:1751-1766`). `Bun.nanoseconds()` returns a `number` whose own JSDoc documents the data loss ("After about 14.8 weeks of uptime… the returned value keeps counting but loses precision", `bun.d.ts:4788-4797`). The compression family is internally inconsistent (gzip → `Uint8Array`, sync-only; zstd → `Buffer`, sync+async; no brotli - verified). `Bun.sha` + `Bun.SHA1/MD4/MD5/SHA224/256/384/512/SHA512_256` are nine undocumented names fully superseded by `Bun.CryptoHasher` (verified `Bun.sha(x,"hex") === Bun.CryptoHasher.hash("sha512-256",x,"hex")`); their shared base class is annotated "**This class only exists in types**" (`bun.d.ts:4855`), and `Bun.sha` being secretly SHA-512/256 plus a headline `Bun.MD4` are both traps. `Bun.gc`/`Bun.shrink`/`Bun.generateHeapSnapshot` duplicate `bun:jsc`. `crypto.timingSafeEqual` on the WHATWG `Crypto` global exists only because `node:crypto` wasn't done in 2022 (commit `f649aae36f`). `Bun.cwd` and `Bun.origin` exist at runtime but are `DontEnum` and undeclared; `FetchEvent` types describe a pre-1.0 API that no longer exists.
bun 2.0 proposal: Deprecate the pure duplicates; delete the nine hash names and `CryptoHashInterface`; make `Bun.nanoseconds` return `bigint`; remove `Bun.cwd`/`Bun.origin`/`FetchEvent`/`crypto.timingSafeEqual`.
blast radius: low-medium per item; every one has a mechanical one-line replacement.

### Import attributes: ~22 non-standard values squatting the `type:` key TC39 owns
what: Bun accepts `with { type: X }` for `toml`, `yaml`, `text`, `file`, `sqlite`, `sh`, `md`, `base64`, `dataurl`, `napi`, … on the same `type` key the web is standardizing (`"json"`/`"css"`, with `"bytes"`/`"text"` proposals in flight).
where: `src/ast/loader.rs:30-53, 147-153`; `docs/bundler/loaders.mdx:274-290` (`embed: "true"` as a *string* boolean).
evidence: `loader.rs:174`: `// TODO: loader for reading bytes and creating module or instance` - Bun knows a `bytes` loader is coming, and TC39 has a Stage-2 `type: "bytes"` proposal that could collide. `type: "file"` returns a path string; `type: "sqlite"` returns a `Database` - semantics no spec will ever adopt. Bun's parser also still accepts the *abandoned* `assert {type:"macro"}` keyword (`src/js_parser/parse/mod.rs:1335-1341`) that Node 23 and V8 removed; the source comment on it is stale ("Once Prettier & TypeScript support import attributes…" - they have for years).
bun 2.0 proposal: Move Bun-only loaders to a Bun-prefixed attribute key (`with { loader: "sqlite" }`); keep `type:` for values that match or will match the standard. Drop the `assert` keyword.
blast radius: medium - in tutorials, but a transpile-time rewrite makes a deprecation period cheap.

### Legacy residue from fixes Bun already shipped
what: The 1.2-era reversals left scar tissue that only a major can clear.
evidence:
- Binary `bun.lockb`: the default flipped to text in 1.2, but the binary *writer* (`install.saveTextLockfile = false`), the `bun <path>.lockb` CLI overload (prints it as a *yarn* lockfile), the `-y, --yarn` flag, and `install.lockfile.print` (which silently no-ops on `"bun"`) all remain (`src/install/lockfile/bun.lockb.rs`; `src/runtime/cli/mod.rs:1462-1467, 1883-1915`; `src/bunfig/bunfig.rs:1385-1396`).
- `Bun.build` pre-1.2 resolved `{success:false}` on failure; the fix landed in 1.2 and left `throw?: boolean` (whose only purpose is to restore the regretted behavior) and a `success` field that is always `true` on the default path (`bun.d.ts:2843-2849, 3629`; only `success: TRUE` site at `js_bundle_completion_task.rs:691`). Maintainer paperclover on #12181: "people continue to run into this footgun."
- `bun test --only` survives from when `.only()` was a no-op without the flag; the docs still teach the old semantics (`docs/test/writing-tests.mdx:189-200`).
bun 2.0 proposal: Delete the `bun.lockb` writer (keep a read-once migrator), `--yarn`, the `.lockb` CLI overload, `Bun.build({throw})`, `BuildOutput.success`, and `--only`.
blast radius: low - all are escape hatches back to already-reversed behavior.

### CLI flag and subcommand namespace drift
what: Short flags are overloaded across subcommands, and the `bun X` / `bun pm X` split is arbitrary.
evidence: `-i` = auto-install on `bun <file>` but `bun i` = `bun install` - and `-i` is the only short flag with *no long form* (`Arguments.rs:240-242`). `-p` = `--print` on run, `--production` on install, `--package` on bunx. `-u, --origin <STR>` is a pre-1.0 `bun dev` flag still accepted with **no help text at all** - the only undescribed entry in the table (`Arguments.rs:254`). The team already treated `bun -p` ambiguity as a breaking-change candidate on the 1.2 tracker (#12181; dylan-conway: "Another change we should consider"). `bun pm view` vs `bun info`, `bun pm hash` vs `hash-print` (both print `fmt_meta_hash()`), `bun patch --commit` vs `bun patch-commit` ("available for compatibility with pnpm", `docs/pm/cli/patch.mdx`).
bun 2.0 proposal: One meaning per short flag across the CLI; delete `-u/--origin`; collapse the duplicate `pm` subcommands.
blast radius: low.

### `NODE_OPTIONS` is silently ignored
what: Bun never reads `NODE_OPTIONS`; it invented a parallel `BUN_OPTIONS`.
where: `BUN_OPTIONS` at `src/bun_core/env_var.rs:95`, spliced into argv at `src/bun_core/util.rs:4053`.
evidence: Reproduced: `NODE_OPTIONS="--require x.cjs" bun -e …` → not applied; `NODE_OPTIONS="--bogus"` → no error (Node rejects). #28817 OPEN; #22880 OPEN (VS Code debug terminals inject via `NODE_OPTIONS`).
why bad: `NODE_OPTIONS` is *the* cross-process injection point - debuggers, APM auto-instrumentation, container base images. Silently dropping it is worse than erroring.
bun 2.0 proposal: Parse it, apply supported flags, warn on unsupported ones.
blast radius: low - it's a no-op today. Tier 3 only because it's more "not implemented" than "regretted design."

### `Bun.file()` dispatches on runtime type; stdio is modeled as `Blob`
what: `Bun.file(x)`'s first argument means four unrelated things by type: `number` → fd, `Uint8Array` → *path bytes* (not content), `"s3://…"` string → an S3-backed object with a different class, `URL`/`string` → path - and the two forms validate differently (`Bun.file(new URL("https://…"))` throws; `Bun.file("https://…")` is silently accepted as a relative path). `Bun.stdin`/`stdout`/`stderr` are `BunFile`s, so `Bun.stdout.size === Infinity`, `Bun.stdout.unlink()` throws synchronously against its `Promise<void>` type, and `Bun.stdin.text()` is one-shot where a file-backed `BunFile` is re-readable.
where: `bun.d.ts:4111, 4152, 4168`; `src/runtime/webcore/Blob.rs:3784-3816`; `src/runtime/api/BunObject.rs:2993-3099`.
evidence: All verified. #9506 OPEN; #13477 OPEN (`Bun.write(Bun.stdout, "")` tries to `ftruncate` fd 1 on Windows); #14874 OPEN. Relative `Bun.file("x")` is also re-resolved against the *live* cwd at read time (verified), a TOCTOU hazard.
bun 2.0 proposal: `Bun.file(path: string | URL, opts?)` only; move fds to `Bun.file({fd})` and `s3://` to the explicit `Bun.s3.file()`. Give stdio a narrower stream type.
blast radius: medium - `Bun.file(fd)` and `s3://` are documented.

### `bun create <x>` dispatches five unrelated modes, one of which deletes the destination
what: The same positional resolves to a React-component generator, a local template in 3 possible directories, a GitHub repo, or `create-<x>` from npm - and the *local-template* branch recursively deletes the destination directory while every other branch refuses to overwrite.
where: `src/runtime/cli/create_command.rs:1658-1795`; `docs/runtime/templating/create.mdx:154-157`, verbatim: "running `bun create` with a local template **deletes the entire destination folder** if it already exists."
evidence: #27948 OPEN: "**I just lost a whole project** … my project was gone without a whimper." The pre-1.0 `@bun-examples` npm scope is still queried as a fallback (`create_command.rs:2095, 2383`); the docs still describe pre-1.0 framework detection whose code is commented out.
bun 2.0 proposal: Never delete without `--force`, in every branch. Split the modes behind explicit flags. Drop `@bun-examples`.
blast radius: low - scaffolding is one-shot.

### `bun:test` surface accretion
what: A cluster of smaller test-runner regrets.
evidence: ~35 `jest-extended` matchers (`toBeOdd`, `toBeNil`, `toInclude`, …) are vendored into core `Matchers<T>` and linked to `jest-extended.jestcommunity.dev` from the JSDoc; `pass`/`fail` forced a zero-argument `expect()` overload into the callable type (`test.d.ts:632`). `test.todo(name, fn)` + the `--todo` flag duplicate `test.failing` - the `failing` JSDoc admits it verbatim (`test.d.ts:516-517`). The 14 "globals" (`test`, `expect`, …) are a transpiler injection that vanishes entirely the moment the file imports *anything* from `bun:test` (#4007, open since 2023: `import { mock } from "bun:test"` makes a bare `test(…)` a `ReferenceError`). `import … from "vitest"` is silently rewritten to `bun:test` (`HardcodedModule.rs:783-791`), so the real Vitest cannot be used side-by-side. Five matcher aliases (`toBeCalled`, `lastCalledWith`, …) that Jest itself deleted in Jest 30.
bun 2.0 proposal: Move jest-extended behind an opt-in import; make `test.todo(name)` Jest-compatible and remove `--todo`; make the globals real (or require imports) and never revoke them on import; stop aliasing the `vitest` specifier.
blast radius: medium in aggregate; low per item.

---

## Method / coverage

### What was scanned
Twenty independent research passes over the `/workspace/bun` checkout, each verifying claims against the installed Bun 1.4.0(-canary) and Node 26 where relevant. Sixteen were **area** passes: `Bun.build`/bundler/plugins/macros; crypto + hashing (`Bun.hash`/`Bun.password`/`CryptoHasher`/CSRF/UUID); env + config (`.env`, `bunfig.toml`, `BUN_*` env vars); `bun:ffi`; file I/O (`Bun.file`/`BunFile`/`Bun.write`/`FileSink`/stdio); `Bun.*` globals + non-standard extensions to web standards; `bun install`/lockfile/workspaces/`bunx`; networking clients (`Bun.listen`/`connect`/`udpSocket`/`dns`) + built-in DB/cloud clients (`Bun.sql`/`s3`/`redis`); intentional Node.js divergences; `bun run` + module resolution + auto-install; `Bun.serve`; `Bun.spawn`/`Bun.$`; `bun:sqlite`; Bun-specific stream APIs; `bun:test`; `Bun.Transpiler` + `HTMLRewriter`. Four were **signal** passes: docs prose admitting regret; GitHub issues (especially the `breaking` label and team-filed issues); `rg` over `src/` for regret-flavored source comments; and every `@deprecated` tag in `packages/bun-types/` (54 of them, plus the dedicated 185-line `deprecated.d.ts`).

During editing, the ~20 most load-bearing source-comment and code claims were re-verified directly against the checkout (all held verbatim): the `__esModule` comment block, the `idleTimeout` `u8` + TODO, `BUN_CONFIG_NO_VERIFY`'s inverted comparison, `mkdir --vebose`, the `NODE_TLS_REJECT_UNAUTHORIZED` "wait until v1.2.0" comment, the `development→reusePort` assignment, the three `Bun.password` TODOs, the `trustedDependencies` replace-not-extend control flow, the npm-package override table, the `generateHeapSnapshot` / router-quality-bar / fetch-backwards-compat / Blob-not-spec-compliant comments, and the hard-coded `EXPAND=true` template parameter. Issue numbers cited by multiple independent agents with identical quotes (#9267, #4464, #20292, #4351, #7531) were treated as corroborated; issue numbers cited by a single agent were kept only where a verified source quote stood beside them.

Dropped as "really just bugs" rather than design regrets: `jest.resetAllMocks` being bound to `clearAllMocks`, `socket.reload()`'s shape drift, `websocket.error` missing from types, `Request` getters returning stub constants, and `server.requestIP()` returning `null` after `await`.

### Where coverage is thin (a human should look here before believing the list is complete)
- **Newer 1.2/1.3 surface**: `Bun.Glob`, `Bun.CookieMap`, `Bun.Archive`, `Bun.secrets`, `Bun.color`, the image APIs, `Bun.semver`, `Bun.FileSystemRouter` (beyond one source comment), and `Bun.markdown` got little or no dedicated attention. The `Bun.sql`/`Bun.S3Client`/`Bun.redis` clients were examined mainly for *naming/alias* problems, not for their wire-protocol behavior or option semantics.
- **Workers**: `new Worker`, `preload` in workers, worker termination, and structured clone got only incidental coverage (one open issue cited).
- **`node:*` module-by-module depth**: the CJS/ESM interop layer and a few headline modules were examined; the hundreds of individual `node:http`/`node:fs`/`node:stream`/`node:crypto` behaviors were not systematically compared to Node. N-API and the V8 C++ API surfaces were not examined at all.
- **The dev server / Bake / HMR** (`import.meta.hot`, `bun --hot` vs `--watch`, HTML routes, the `vite:*` event aliases) got one pass each from the run-resolve and types agents; no one exercised it end-to-end.
- **Windows**: every runtime verification was on linux-x64. Windows-specific defaults (backends, `FileSink` Promise returns, path handling) were observed only through source comments.
- **Performance/memory defaults**: `smol`, GC tuning knobs, `BUN_JSC_*`, and the `--compile` bytecode story were not evaluated as design choices.
- **`bun publish` / `bun audit` / `bun pm scan` / `bun outdated`**: the publish and security-scan subcommands were essentially untouched.
- **Cross-cutting CLI audit**: no pass produced an authoritative "which flags exist on which subcommand, and which collide" matrix; the short-flag findings above are samples, not a census.

---

Raw per-agent working notes (unvetted; superset of what made this report) are in the raw-*.md files below.
