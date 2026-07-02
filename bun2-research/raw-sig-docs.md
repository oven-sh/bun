# Bun 2.0 candidates - signal: user docs admitting regret / awkwardness

Method: `rg` across `docs/**/*.mdx` for regret language, cross-referenced against `packages/bun-types/*.d.ts` `@deprecated` markers, the Bun repo's own `breaking` issue label, and runtime probes. Every finding has a verbatim quote or issue number.

---

### Bun.serve `idleTimeout` default: 10 s, and capped at 255

what: `Bun.serve` silently resets any connection - including an in-flight request whose handler just hasn't written bytes yet - after 10 seconds, and the option cannot be set higher than 255 seconds.
where: docs/runtime/http/server.mdx:217-236, docs/runtime/http/server.mdx:364-373; option type at packages/bun-types/bun.d.ts (`idleTimeout`).
evidence: Doc: "By default, `Bun.serve` closes connections after **10 seconds** of inactivity. A connection is idle when no data is being sent or received, **including in-flight requests where your handler is still running but hasn't written any bytes to the response yet.** Browsers and `fetch()` clients see this as a connection reset." (server.mdx:217). "The maximum value is `255`" (server.mdx:219). Issues: #13712 "Bun.serve() silently drops connection after 10 seconds" (closed as docs), #27479 "Document Bun.serve default idleTimeout behavior for SSE/streaming" (closed - they documented it rather than fix it), #15589 "Bun.serve expects idleTimeout to be 255 or less" (open, labeled `bun:serve`).
why bad: The single most common slow-handler shape (LLM call, DB query, upstream fetch) gets a TCP reset by default with no status code and no log. The docs need three separate callouts plus a dedicated `server.timeout(req, 0)` escape hatch to explain one default. The `255` ceiling is a uWebSockets `u8` leaking straight into the public API.
bun 2.0 proposal: Default `idleTimeout` to 0 (disabled) or start the idle clock only after headers are flushed (matching Node, whose server does not time out an in-flight handler by default); accept any non-negative number of seconds.
blast radius: medium - the new default only makes previously-failing requests succeed, but anyone relying on the implicit 10 s reaper for DoS protection loses it.
confidence: high.

### `bun run` executes `#!/usr/bin/env node` shebangs with Node, not Bun

what: When a `package.json` script or bin has a `node` shebang, `bun run` delegates to the system `node` binary unless you pass `--bun` - so "running it with Bun" frequently does not run it with Bun.
where: docs/runtime/index.mdx:128-143; flag `--bun`.
evidence: Doc: "By default, Bun respects this shebang and executes the script with `node`. The `--bun` flag overrides it: the CLI runs with Bun instead of Node.js." (index.mdx:137). Issue #4464 "Make `--bun` default, introduce `--node`" - **OPEN, labeled `breaking`** - maintainer body: "Currently, when Bun runs a script with a shebang in package.json, it will default to Node. **Before 1.0, we should change this** so that it defaults to Bun, and introduce `--node`". Related: #29578 (persist `--bun` at install), #9346 (`engines` field).
why bad: The team wrote down, pre-1.0, that this default was wrong and never shipped the change. It is the #1 source of "Bun works but my scripts still need Node installed" confusion and defeats the Node-free pitch; the fix (`--node` opt-out) was designed seven years of issues ago.
bun 2.0 proposal: Exactly what #4464 says: default to Bun for all shebangs, add `--node` for opt-out.
blast radius: high - every project whose `node_modules/.bin` CLIs depend on a V8/Node-specific behavior would start running under Bun.
confidence: high.

### `Bun.readableStreamTo*()` is deprecated in the types but is still the documented API

what: All four `Bun.readableStreamToText/Bytes/Blob/JSON()` helpers carry `@deprecated` in the type definitions, yet `docs/runtime/utils.mdx` and `docs/runtime/binary-data.mdx` still teach them as the recommended conversion API and never mention the replacement.
where: packages/bun-types/deprecated.d.ts:44,58,70,82 vs docs/runtime/utils.mdx:746-778 ("## `Bun.readableStreamTo*()` - Bun implements a set of convenience functions…") and docs/runtime/binary-data.mdx:742-795 (every "To X" recipe uses `Bun.readableStreamToArrayBuffer`).
evidence: `deprecated.d.ts:44`: "`@deprecated Use {@link ReadableStream.bytes}`" (and `.blob`/`.text`/`.json`). Issue #29401 "ReadableStream is deprecated but proposed replacement doesn't exist." (OPEN, labeled `types`): user report that `stream.text()` is a TS2339 error while `readableStreamToText` is flagged deprecated. Inconsistently, `readableStreamToArrayBuffer`, `readableStreamToArray`, and `readableStreamToFormData` (bun.d.ts:1778,1809,1820) are **not** deprecated - the family was only half-retired.
why bad: Three sources of truth disagree: the types say deprecated, the docs say recommended, and the deprecation message points at instance methods that don't typecheck on the global `ReadableStream` (they exist at runtime - verified `typeof ReadableStream.prototype.text === "function"` in Bun 1.4.0 - but `overrides.d.ts:28` only augments `stream/web`'s interface, not the global). Users who follow the deprecation hit a compile error.
bun 2.0 proposal: Delete `Bun.readableStreamTo*` entirely, ship the `ReadableStream.prototype.text/bytes/json/blob()` types on the global, and rewrite the two doc pages.
blast radius: medium - the functions are widely copy-pasted from Bun's own docs, but the migration is mechanical.
confidence: high.

### Compiled executables auto-load `.env` and `bunfig.toml` from whatever directory they're run in

what: A `bun build --compile` binary reads `./.env` and `./bunfig.toml` from the runtime working directory by default - and the docs explicitly say this default may be flipped.
where: docs/bundler/executables.mdx:404-412.
evidence: Doc (verbatim Note block): "In a future version of Bun, `.env` and `bunfig.toml` may also be disabled by default for more deterministic behavior." Context two lines above: "`.env` and `bunfig.toml` loading is **enabled** - these often contain runtime configuration that may vary per deployment" vs "`tsconfig.json` and `package.json` loading is **disabled**".
why bad: This is the strongest form of evidence this task asked for: the Bun docs, in Bun's voice, state the current default is non-deterministic and flag it for a future breaking change. Shipping a single-file executable that silently changes behavior based on a stray `bunfig.toml` or `.env` in the user's `cwd` is a correctness and security surprise.
bun 2.0 proposal: Do what the docs already promise - disable both by default behind `--compile-autoload-env` / `--compile-autoload-bunfig`, mirroring the existing `--compile-autoload-tsconfig` / `--compile-autoload-package-json` flags.
blast radius: medium - anyone distributing a compiled CLI that relies on a deploy-time `.env` would need the opt-in flag.
confidence: high.

### `import.meta.dir` / `.path` / `.file`: three Bun names now shadowed by (and contradicting) Node's

what: Bun invented `import.meta.dir` and `import.meta.path`; after Node standardized `import.meta.dirname`/`.filename`, Bun added those too and documents its originals as redundant - and `import.meta.file` (the basename) now sits next to `import.meta.filename` (the absolute path), which mean different things.
where: docs/runtime/module-resolution.mdx:345-358 (the `import.meta` table).
evidence: Doc, verbatim from the table: `import.meta.dirname` - "An alias to `import.meta.dir`, for Node.js compatibility"; `import.meta.filename` - "An alias to `import.meta.path`, for Node.js compatibility"; `import.meta.file` - "The name of the current file, e.g. `index.tsx`"; `import.meta.path` - "Absolute path to the current file". Issue #7778 "Node compat: Add `import.meta.dirname` and `import.meta.filename`" (closed - the moment the duplication was created).
why bad: Four properties express two concepts, and the pair with the most similar names (`file` vs `filename`) are the pair that disagree: `import.meta.file === "index.tsx"` while `import.meta.filename === "/abs/path/index.tsx"`. There is no standard and no Node equivalent for `.dir`/`.path`/`.file`; they exist only as a pre-standardization bet Bun lost.
bun 2.0 proposal: Deprecate and then remove `import.meta.dir`, `import.meta.path`, `import.meta.file` (and the `import.meta.env` alias, below) in favor of the Node names.
blast radius: medium - `import.meta.dir` is used pervasively in Bun-first code; a codemod is trivial.
confidence: high.

### Three names for the environment: `process.env`, `Bun.env`, `import.meta.env`

what: `Bun.env` and `import.meta.env` are documented as plain aliases of `process.env`, adding two redundant spellings - and `import.meta.env` collides with what the name already means in Vite (build-time, statically replaced, `MODE`/`DEV`-shaped).
where: docs/runtime/environment-variables.mdx:150; docs/runtime/utils.mdx:26; docs/runtime/module-resolution.mdx:349.
evidence: "Bun also exposes these variables as `Bun.env` and `import.meta.env`, **both aliases of `process.env`**." (environment-variables.mdx:150). "`Bun.env` - An alias for `process.env`." (utils.mdx:26). "`import.meta.env` - An alias to `process.env`." (module-resolution.mdx:349).
why bad: Duplicate API surface that buys nothing: both aliases are documented as identical to the thing they alias. Reusing Vite's `import.meta.env` name for live `process.env` is an active trap - code ported from Vite expects inlined, DCE-able constants and gets a mutable runtime object.
bun 2.0 proposal: Remove `import.meta.env`; keep `Bun.env` only if it gains a reason to exist (typed, frozen, or bundler-inlined), otherwise remove it too.
blast radius: low - mechanical rename to `process.env`.
confidence: high.

### `packages/bun-types/deprecated.d.ts`: a whole file of renames kept for back-compat

what: Bun maintains a dedicated `deprecated.d.ts` whose contents are almost entirely "we renamed this" - globals, option keys, and types kept only so old code typechecks.
where: packages/bun-types/deprecated.d.ts (entire file, 185 lines).
evidence: Verbatim entries: `keyFile`/`certFile`/`caFile` - "`@deprecated since v0.6.3 - Use \`key: Bun.file(path)\` instead.`" (lines 132,141,148); `Errorlike` - "`@deprecated Renamed to \`ErrorLike\``" (line 119); `declare var BuildError` - "`@deprecated Renamed to \`BuildMessage\``" and `ResolveError` → `ResolveMessage` (lines 176-184); `ServeOptions` → `Serve.Options`; `SQLQuery`/`SQLOptions`/`SQLTransactionContextCallback` → `SQL.*`. Elsewhere: `WebSocket.URL` - "Legacy URL property (same as url) `@deprecated Use url instead`" (bun.d.ts:4353-4356, a non-standard uppercase twin of the standard `WebSocket.url`); `Bun.shrink()` `@deprecated` with no replacement (bun.d.ts:4834); S3 `highWaterMark` - "`@deprecated ... Use \`partSize\` and \`queueSize\` instead`" (s3.d.ts:408).
why bad: Each entry is an individually-acknowledged design mistake (wrong name, wrong casing `Errorlike`, "Error" used for a non-Error, path-string options superseded by `Bun.file()`). None can be deleted inside 1.x, so the file only grows. `BuildError`/`ResolveError` are still declared as **globals** five majors after the rename.
bun 2.0 proposal: Delete `deprecated.d.ts` and the corresponding runtime aliases; 2.0 is the only release where this is legal.
blast radius: low - everything here already has a documented, type-checked replacement.
confidence: high.

### `bun:sqlite`: `Database.exec` is a deprecated alias of `Database.run`; `.query()` vs `.prepare()` differ only in hidden caching

what: The Database class ships two pairs of near-duplicates - `exec` (deprecated) vs `run`, and `query` (caches the compiled statement on the Database) vs `prepare` (doesn't) - distinguished only by a side effect their names don't convey.
where: packages/bun-types/sqlite.d.ts:188-193; docs/runtime/sqlite.mdx:168-192.
evidence: Type: "This is an alias of {@link Database.run} `@deprecated Prefer {@link Database.run}`" (sqlite.d.ts:191). Issue #22527 "Deprecated exec call referenced in WAL mode docs" (closed, labeled `docs, bun:sqlite`) - Bun's own docs were still teaching the deprecated alias. For query/prepare, the docs need a 20-line `<Note>` titled "**What does \"cached\" mean?**" (sqlite.mdx:173) concluding "Use `.prepare()` instead of `.query()` when you want a fresh `Statement` instance that isn't cached" (sqlite.mdx:188).
why bad: `exec`/`run` is pure duplication. `query`/`prepare` is worse: neither name says "cached", the cache is unbounded per `Database`, and the docs' own example of when it bites ("dynamically generating SQL … don't want to fill the cache") is a memory leak, not a preference. An explanation that long in user docs is the smell this task asked me to look for.
bun 2.0 proposal: Remove `exec`. Rename the caching variant to something honest (`cachedQuery` or a `{ cache: true }` option on `prepare`) or make `query` uncached and add an explicit LRU-bounded cache opt-in.
blast radius: medium - `db.query()` is the headline bun:sqlite example everywhere.
confidence: high.

### `Bun.serve<MyData>()` type parameter - already removed as a breaking change, and the docs say so

what: The generic parameter on `Bun.serve` for typing `ws.data` was removed (replaced by inferring from the `data` property) because the design never worked in TypeScript; the docs carry the admission.
where: docs/runtime/http/websockets.mdx:169-171.
evidence: Doc (verbatim `<Info>` block): "Previously, you could specify the type of `ws.data` with a type parameter on `Bun.serve`, like `Bun.serve<MyData>({...})`. **This pattern was removed due to a limitation in TypeScript** in favor of the `data` property." PR #20918 "[1.3] `Bun.serve({ websocket })` types" carried the `breaking` label and the banner "⚠️ This is a breaking change for 1.3 - do not merge before ⚠️"; it closed #19659, #19246, #22948.
why bad: Not a 2.0 candidate (already done) - included because it is the clearest proof that the Bun team does ship exactly this category of fix when given a major/minor boundary, and the docs retain the regret in writing. It calibrates the rest of this list.
bun 2.0 proposal: n/a (done in 1.3).
blast radius: n/a.
confidence: high.

### `bun <name>`: a four-level resolution order that differs from `bun run <name>`

what: The bare `bun X` and `bun run X` forms resolve the same token to different things; a built-in subcommand, a package.json script, a source file, a project bin, and a system command all compete, and the tiebreak rules take a dedicated doc section to state.
where: docs/runtime/index.mdx:101, docs/runtime/index.mdx:210-221 ("## Resolution order").
evidence: "If a built-in `bun` command has the same name, the built-in command takes precedence; use the explicit `bun run <script>` to run your package script instead." (index.mdx:101). "Unless you use `bun run`, a name with an allowed extension resolves to the file rather than a `package.json` script. When a `package.json` script and a file have the same name, `bun run` prefers the script. The full resolution order is: 1. `package.json` scripts … 4. (`bun run` only) System commands: `bun run ls`" (index.mdx:212-220). Issue #14397 "Implement `bun run-script`" (open) asks for an unambiguous escape hatch.
why bad: `bun build.ts` runs the file but `bun run build.ts` runs a *script* named `build.ts` if one exists - inverted precedence between the long and short form. A project cannot have scripts named `install`, `test`, `add`, `init`, etc. via the short form. Rule 4 means `bun run rm` shells out to the system `rm`. This is exactly the "long explanation as a smell" the task describes.
bun 2.0 proposal: Make `bun X` and `bun run X` identical; reserve built-in names explicitly (error on collision, like `npm`); drop silent system-command fallback.
blast radius: medium - muscle-memory breakage, but collisions are rare and currently silent.
confidence: medium.

### The `__esModule` CJS-interop workaround: team says "caused more issues than it solved"

what: Bun special-cases the `__esModule` marker when importing CommonJS from ESM; the maintainers have had an open, `breaking`-labeled issue to remove it since before 1.1.
where: Behavior described in docs/runtime/module-resolution.mdx:312-327 ("Low-level details of CommonJS interop in Bun" accordion); tracking issue.
evidence: Issue #9267 "Remove workaround for `__esModule`" - **OPEN, labeled `breaking`** - full body: "**This has just caused more issues than it solved, will be removed in Bun 1.1.**" (It is still present at 1.4.)
why bad: A maintainer-authored, one-sentence obituary for the design that then sat unshipped for three major-minor cycles is the purest form of the signal this task asked for. CJS default-export interop is the single largest source of Bun-vs-Node ecosystem breakage.
bun 2.0 proposal: Ship #9267: remove the `__esModule` synthesis and match Node's `cjs-module-lexer` semantics exactly.
blast radius: high - touches every ESM→CJS import in every project; also why it never shipped in 1.x.
confidence: high (the admission) / medium (that 2.0 is when it lands).

### `install.linkWorkspacePackages` default is `true`; the team's own 1.3 breaking tracker wanted `false`

what: By default Bun symlinks workspace packages rather than resolving them from the registry range; flipping this default was an explicit, unfulfilled item on the Bun 1.3 breaking-changes tracker.
where: docs/runtime/bunfig.mdx:573-579.
evidence: Doc: "Whether to link workspace packages from the monorepo root to their respective `node_modules` directories. **Default `true`**." Issue #20292 "Breaking changes for Bun v1.3" (the team's own meta-tracker, labeled `breaking`) lists, still unchecked: "`- [ ] default value \`false\` for \`install.linkWorkspacePackages\``".
why bad: The only two items on the official 1.3 breaking list were this and the `Bun.serve` types; one shipped, this one didn't. pnpm made the equivalent flag default `false` for the same reason: always-link means the registry version in `package.json` is never actually installed, so CI and publish see a different tree than the lockfile describes.
bun 2.0 proposal: Flip the default to `false`, as #20292 already specifies.
blast radius: medium - every Bun monorepo, but the failure mode is a visible install diff, not silent corruption.
confidence: high.

### Non-standard methods bolted onto standard globals: `Blob.prototype.json/formData`, `URLSearchParams.prototype.toJSON`, `ReadableStream.prototype.text/bytes/json/blob`

what: Bun extends several WHATWG globals with convenience methods that are not in any spec, declared in a file literally named `overrides.d.ts`.
where: packages/bun-types/overrides.d.ts:11-70.
evidence: `interface BunConsumerConvenienceMethods { text(); bytes(); json(); }` applied to `ReadableStream` and `Blob` (overrides.d.ts:11-33); `Blob` additionally gains `formData()` and `image()` (lines 47,58); `URLSearchParams` gains `toJSON()` (line 69). Runtime-verified on Bun 1.4.0: `Blob.prototype.json`, `Blob.prototype.formData`, `URLSearchParams.prototype.toJSON`, `ReadableStream.prototype.text` are all `"function"`. None appear in the File API, URL, or Streams specs. The file's own comment admits the shape is ad-hoc: "It has no `blob()` method because it's the lowest common denominator of these objects: a `Blob` in Bun does not have a `.blob()` method."
why bad: This is the task's "non-standard additions bolted onto standard globals" signal verbatim. Each one is a future web-compat landmine (if WHATWG ever specs `Blob.json()` with different semantics, Bun is stuck) and makes code non-portable in the invisible direction - it works in Bun and throws in Node/browsers.
bun 2.0 proposal: Keep the `ReadableStream` consumers if the WHATWG proposal lands with matching semantics; move `Blob.json/formData/image` and `URLSearchParams.toJSON` behind `Bun.`-namespaced functions or delete them.
blast radius: low - each is a one-line replacement (`JSON.parse(await blob.text())`, `Object.fromEntries(usp)`).
confidence: high.

### `S3File.size` is a deprecated lie (`NaN`); `delete`/`unlink` are duplicate methods

what: `S3File` extends `Blob`, inheriting a synchronous `size` that cannot be known without a network round-trip, so it is hard-coded to `NaN` and marked deprecated; separately, `delete` and `unlink` are documented as the same method on both `S3File` and `S3Client`.
where: docs/runtime/s3.mdx:578-584, docs/runtime/s3.mdx:627, docs/runtime/s3.mdx:841.
evidence: Doc-embedded type: "Size is not synchronously available because it requires a network request. `@deprecated Use \`stat()\` instead.` `size: NaN;`" (s3.mdx:579-584). "`delete` is the same as `unlink`." (s3.mdx:627). "`// S3Client.unlink is alias of S3Client.delete`" (s3.mdx:841). A third spelling, static `S3Client.size()`, is documented un-deprecated at s3.mdx:791-794.
why bad: Inheriting from `Blob` forced a property that can only return a wrong value, and the "fix" was to deprecate it in place rather than not have it. The delete/unlink duplication (plus `exists` as both a static, an instance method, and a `Blob` semantic) is accidental surface from mirroring both the POSIX and the HTTP mental model.
bun 2.0 proposal: Remove `size` from `S3File` (it's already `NaN`); pick one of `delete`/`unlink`; remove `S3Client.size()` in favor of `stat()`.
blast radius: low - `size` already returns `NaN`, so nothing correct depends on it.
confidence: high.

### `bun:ffi` shipped as a headline API but documented as "should not be relied on in production" - and may be deletable by flag

what: The FFI module is presented alongside Bun's stable APIs but its own docs open with a production warning and end by reserving the right to ship a kill switch.
where: docs/runtime/ffi.mdx:6-9; docs/runtime/ffi.mdx:482.
evidence: "`bun:ffi` is **experimental**, with known bugs and limitations, and **should not be relied on in production**. The most stable way to interact with native code from Bun is to write a Node-API module." (ffi.mdx:6-9). "Don't use raw pointers outside of FFI. **A future version of Bun may add a CLI flag to disable `bun:ffi`.**" (ffi.mdx:482).
why bad: An API that's been shipping since 0.x, has its own doc chapter and a companion C-compiler feature (docs/runtime/c-compiler.mdx), yet is officially disavowed for production and has a pre-announced disable switch, is in limbo by the team's own description. The raw-`ptr`-as-JS-number design is the memory-unsafety the disable flag is about.
bun 2.0 proposal: Either graduate it (stabilize `dlopen`/`CString`, make pointers opaque objects rather than numbers) or demote it to an opt-in flag and point users at Node-API, as the docs already do.
blast radius: low-medium - a small but committed user base; the docs have warned them since the beginning.
confidence: medium (the regret is documented; the direction isn't).

### Minor: compat aliases Bun carries from other tools

what: A handful of aliases exist solely because another tool spelled it differently, documented as such.
where / evidence:
- `bun patch-commit` - "`# \`patch-commit\` is available for compatibility with pnpm`" (docs/pm/cli/patch.mdx:63); the real command is `bun patch --commit`.
- HMR events - "For compatibility with Vite, these events are also available with the `vite:*` prefix instead of `bun:*`." (docs/bundler/hot-reloading.mdx:227).
- `bun build` CLI flags - `--asset-names`→`--asset-naming`, `--entry-names`→`--entry-naming`, `--chunk-names`→`--chunk-naming`, each annotated "Renamed for consistency with naming in JS API" (docs/bundler/esbuild.mdx:57,62,66) - the *old* esbuild spellings are still the row labels because users keep reaching for them.
- `import.meta.hot.decline()` - "No-op `@deprecated`" (packages/bun-types/devserver.d.ts:138-141).
why bad: Individually harmless; collectively they mean every alias another tool ever used is part of Bun's permanent API surface. 2.0 is the only time to shed them.
bun 2.0 proposal: Remove `patch-commit`, the `vite:*` prefix, and `decline()`; keep only the canonical `--*-naming` flags.
blast radius: low.
confidence: medium.

---

## Not included, and why

- `S3File.size`'s sibling `Bun.file().size` / `Bun.file().type` - these are lazy but *correct* (stat-backed), no regret language found.
- `bun install` lockfile: the binary `bun.lockb` → text `bun.lock` migration (docs/pm/lockfile.mdx:51, docs/pm/cli/install.mdx:440) is a past regret the team already fixed in 1.2; only the `saveTextLockfile = false` escape hatch and the `bun ./bun.lockb` pretty-printer remain as legacy surface.
- `bun -p` meaning `--port` instead of Node's `--print` - already fixed; #14223 "Switch `bun -p` from `--port` to `--print`" (closed, labeled `breaking`).
- Redis `exists()`/`sismember()` returning booleans instead of the integer counts Redis and every other client return (docs/runtime/redis.mdx:351-352) - a real, documented divergence, but it's a deliberate ergonomic choice and I found no user complaints, so it falls below the evidence bar.
- Everything tagged `experimental and may change` (DNS cache stats, `Bun.secrets`, webview, Worker termination, `--format cjs|iife`) - honest labeling, not regret.
