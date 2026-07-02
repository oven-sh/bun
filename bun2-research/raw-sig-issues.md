# Bun 2.0 candidates - API design regrets mined from GitHub + source

All file paths are relative to `/workspace/bun`. Issue numbers are `oven-sh/bun`.

### `__esModule` CJS default-import heuristic

what: When a default-importing ESM module loads a CJS module that has an `__esModule` marker AND a `default` export, Bun gives you `module.exports.default` (Babel semantics) instead of the whole `module.exports` namespace (Node semantics).
where: `src/jsc/bindings/JSCommonJSModule.cpp:975` ("Bun's interpretation of the `__esModule` annotation" - the comment itself says "Note that this interpretation is slightly different"); meta-issue #9267.
evidence: Maintainer-filed issue #9267 "Remove workaround for `__esModule`" (OPEN) body: "This has just caused more issues than it solved, will be removed in Bun 1.1." A maintainer comment on #9267 lists "Will fix #6388, Will fix #4506, Will fix #7465, Maybe fixes #3881, Maybe fixes #4677." Later duplicates: #32698 "Default import of a bare CommonJS package with `__esModule` returns `exports.default` instead of the namespace (differs from Node)", #18615 "Default import gets wrapped in extra default", #17311, #3383.
why bad: Node.js never honors `__esModule`, so the same `import pkg from "cjs-pkg"` yields different objects in Node vs Bun. Because it's a *runtime* heuristic keyed on package internals, users can't predict which shape they'll get, and it silently breaks real packages (OpenTelemetry, pathlib-js, NestJS, etc.). The team explicitly declared it a net negative in early 2024 and it is still shipping.
bun 2.0 proposal: Match Node: default-import of CJS always gives `module.exports`; drop the `__esModule` special case entirely (or gate the old behavior behind an opt-in `bunfig` flag for one release).
blast radius: high - any ESM code default-importing a TS/Babel-transpiled CJS package changes shape.
confidence: high.

### Hardcoded npm-package overrides (`undici`, `ws`, `node-fetch`, `isomorphic-fetch`, `@vercel/fetch`)

what: Bun's module resolver silently replaces these five *npm packages* (not Node builtins) with partial built-in reimplementations, even when the real package is installed in `node_modules`.
where: `src/resolve_builtins/HardcodedModule.rs:272-276` (`b"node-fetch" | b"isomorphic-fetch" | b"undici" | b"ws" | b"@vercel/fetch"`), `:715-718`, and `:754-765` (which also hijacks `next/dist/compiled/node-fetch` and `next/dist/compiled/undici`); shims live in `src/js/thirdparty/{undici.js,ws.js,node-fetch.ts,isomorphic-fetch.ts,vercel_fetch.js}`.
evidence: #17799 "Remove the undici polyfill" (OPEN). Roadmap issue #159 (Winter 2024 section) literally lists "Investigate removing our `undici` override". #2955 "npm `ws` package overridden by broken baked-in module", #3844 "Bun overrides 'ws' package even when --target=node", #19748 "Undici native module is outdated", #27783 "SyntaxError: Export named 'cacheStores' not found in module 'undici'", #14498, #21492, #25481, #7920, #21944, #29423, #22805.
why bad: Users who `bun add undici@X` get Bun's partial shim, not what they installed - version pins and changelogs are meaningless, and every missing API surfaces as a baffling runtime error in someone else's library. The team's own roadmap already flags the undici one for removal.
bun 2.0 proposal: Stop overriding any npm package. If Bun wants a fast path, do it inside `node:http`/`fetch`, not by shadowing module resolution of third-party specifiers.
blast radius: medium - code that *relies* on the shim (e.g. the `ws`-shim-over-`Bun.serve` websocket upgrade path) would need to install the real package; everyone else only gains compatibility.
confidence: high.

### `fetch()` network failures are plain `Error`s with Bun-invented codes

what: A failed `fetch()` rejects with a plain `Error` carrying PascalCase Zig-enum codes (`ConnectionRefused`, `FailedToOpenSocket`, …) instead of the spec-mandated `TypeError` and Node's POSIX `ECONNREFUSED`/`ENOTFOUND` codes.
where: `src/runtime/webcore/fetch/FetchTasklet.rs:1287` - source comment: "Keep this list narrow; the catch-all SystemError below is still a plain Error for backwards compat."
evidence: The comment above is an in-tree admission. #20486 "Native `fetch` incompatibilities with NodeJS error format and codes" (OPEN; reporter quotes fetch spec §12.3: network errors MUST be `TypeError`), #11345 "different error codes between Node and Bun in axios" (got `ConnectionRefused` where Node gives `ENOTFOUND`).
why bad: `err instanceof TypeError` is the spec-blessed, cross-runtime way to detect a network failure, and `err.code === 'ECONNREFUSED'` is what every Node library (axios, got, retry middleware) switches on. Bun's shape breaks both, and the only thing keeping it is "backwards compat" with older Bun.
bun 2.0 proposal: Reject with `TypeError("fetch failed", { cause })` where `cause` carries the Node-style `code`/`errno`/`syscall`/`hostname` - exactly what undici does.
blast radius: medium - any code matching on Bun's current `.code` strings or `.name === 'Error'` breaks; standards-conformant code starts working.
confidence: high.

### Standard `RequestInit.keepalive` repurposed to mean "HTTP connection reuse"

what: Bun reads the WHATWG Fetch `keepalive` option and interprets `keepalive: false` as "send `Connection: close` / don't reuse this socket" - an unrelated, Bun-specific meaning.
where: `src/runtime/webcore/fetch.rs:915-937` (`disable_keepalive = !keepalive_value.as_boolean()`); `src/http/lib.rs:1643` ("`disable_keepalive` is set when fetch is called with `keepalive: false`"). Documented as a Bun extension at `docs/runtime/networking/fetch.mdx:260-261` ("// Disable connection reuse for this request  keepalive: false,").
evidence: Source + docs above. WHATWG Fetch defines `keepalive` as "allow the request to outlive the page" with a **default of `false`** and a 64 KiB body cap; it has nothing to do with TCP/HTTP keep-alive. #30124 / #30127 ("Request getters return fixed values, ignoring init: referrer, integrity, keepalive") show the `Request.keepalive` getter is also non-conformant.
why bad: Code that explicitly passes the *spec default* (`keepalive: false`) - e.g. anything that copies a `RequestInit` verbatim, or polyfill-generated code - silently gets `Connection: close` on every request in Bun and loses pooling. Overloading a standard option name with a contradictory meaning is the worst form of spec divergence because it can't be feature-detected.
bun 2.0 proposal: Move the knob to a Bun-namespaced option (e.g. `{ bun: { keepAlive: false } }` or `{ connectionReuse: false }`) and make `keepalive` a spec-conformant no-op (Node/undici ignore it too).
blast radius: low - almost nobody passes `keepalive: false` on purpose today precisely because it has a different meaning everywhere else.
confidence: high.

### `Bun.serve` `idleTimeout`: 10 s default, `u8`-capped at 255, inconsistent with WebSockets

what: The HTTP `idleTimeout` defaults to 10 seconds, is stored in a `u8` (so values > 255 throw), and the sibling WebSocket handler's `idleTimeout` defaults to 120 - a 12× inconsistency Bun's own code flags.
where: `src/runtime/server/ServerConfig.rs:25` - `pub idle_timeout: u8, // TODO: should we match websocket default idleTimeout of 120?`; `:75` (`idle_timeout: 10`); `:1133-1135` ("Bun.serve expects idleTimeout to be 255 or less"). Types: `packages/bun-types/serve.d.ts:809` (`@default 10`) vs `:482` (WS `@default 120`).
evidence: The in-source TODO above. #15589 "Bun.serve expects idleTimeout to be 255 or less" (OPEN). #27470 "Bun.serve hard-caps idleTimeout at 255 seconds". #27479: default 10 s kills quiet SSE streams. #25605 was a contributor PR to widen to u16 and raise the default (closed). Docs at `docs/runtime/http/server.mdx:217` admit the footgun: "including in-flight requests where your handler is still running but hasn't written any bytes to the response yet. Browsers and `fetch()` clients see this as a connection reset."
why bad: A handler that takes 11 s to produce its first byte gets a silent connection reset by default - Node has no such default handler timeout. The option is typed `number` (seconds) but an internal `u8` leaks through as an arbitrary 255 ceiling. And two options with the same name on the same `Bun.serve()` call have different defaults.
bun 2.0 proposal: Widen to at least `u16` seconds, raise the HTTP default to match the WebSocket 120, and stop counting "handler is still computing" as idle (or raise only on a separate, generous request timeout).
blast radius: medium - servers implicitly relying on the 10 s reset would hold connections longer; everything else just stops breaking.
confidence: high.

### `Bun.serve` defaults to development mode (stack-trace error pages) unless `NODE_ENV=production`

what: `development` defaults to `process.env.NODE_ENV !== 'production'`, and in development mode unhandled errors are rendered as a full HTML page with the stack trace and source context.
where: `packages/bun-types/serve.d.ts:712` - `@default process.env.NODE_ENV !== 'production'`; implementation `src/runtime/server/ServerConfig.rs:81,735-739`. Type docstring `serve.d.ts:1140`: "In development mode, `Bun.serve()` returns rendered error messages with stack traces instead of a generic 500 error. **Don't use development mode** [in production]".
evidence: Source + types above. #22055 "Only show dev error page in `Bun.serve` if browser-based `User-Agent`" (OPEN). #6015 "open-in-editor feature is enabled by default" (OPEN since 1.0.3; reports an RCE vector in the dev error page - the handler is now a `501` stub at `src/runtime/bake/DevServer.rs:1871`, but the default-on design remains). `ServerConfig.rs:816` also silently flips `reusePort` to `true` whenever `development: false` is passed, contradicting the `@default false` in `serve.d.ts:780`.
why bad: "Leak stack traces unless you remembered to set an env var" is fail-open. Every container image that forgets `NODE_ENV=production` ships a server that tells attackers file paths and code. Bun's own docstring says not to use the default.
bun 2.0 proposal: Default `development` to `false`. Turn dev mode on only when Bun can positively detect it (`bun --hot`, `bun dev`, `development: true`).
blast radius: low - people lose pretty error pages locally until they pass `development: true` or use `--hot`; no production code breaks.
confidence: high.

### `bun:sqlite` `strict: false` default silently binds missing named parameters as NULL

what: By default, a typo'd key in the bind object is *silently ignored* (the parameter binds NULL) and bind keys must include the `$`/`:`/`@` sigil; sane behavior is opt-in via `strict: true`.
where: `docs/runtime/sqlite.mdx:79`: "By default, `bun:sqlite` requires binding parameters to include the `$`, `:`, or `@` prefix, **and does not throw an error if a parameter is missing**." `packages/bun-types/sqlite.d.ts:84` (`strict?: boolean; @since v1.1.14`).
evidence: Docs quote above - the doc's own example shows `.all({ messag: "Hello world" })` (typo) not throwing by default. `strict` was added as opt-in in v1.1.14 via #11887 precisely because flipping the default would break compat. #13409 (OPEN), #17726. Same pattern: `packages/bun-types/sqlite.d.ts:288` - `Database.close(throwOnError)`: "In the future, Bun may default `throwOnError` to `true`, but for backwards compatibility it is `false` by default."
why bad: Silently writing NULL into the database on a key typo is a data-corruption footgun, not a "lenient mode". The `@since v1.1.14` marker on `strict` and the `close()` comment are both explicit "we know the default is wrong" admissions.
bun 2.0 proposal: `strict: true` and `close(throwOnError = true)` become the defaults; `strict: false` becomes opt-in.
blast radius: medium - code relying on sigil-prefixed keys or on missing params binding NULL starts throwing.
confidence: high.

### Closed HTTP-method set: unknown methods silently become `GET` / get rejected

what: `fetch()` coerces any method not in a hardcoded enum to `GET`, and `Bun.serve` returns `400` for any request whose method isn't in that enum - both violate RFC 9110's open method set and the Fetch spec.
where: `src/http_types/Method.rs:6` (closed `enum Method`; `Method::which(b"Get")` and `Method::which(b"OPtions")` both return `None` per its own unit test at `:404-405`); `src/runtime/webcore/fetch.rs:639` - `.unwrap_or(Method::GET)`.
evidence: #21566 "Non-standard and broken handling of HTTP methods in both `fetch` and `Bun.serve`" (OPEN; cites RFC 9110 §9 + fetch spec "There are no restrictions on methods. `CHICKEN` is perfectly acceptable"), which itself consolidates #6021 and #6556.
why bad: `fetch(url, {method: "pAtCh"})` silently sends `GET` - a data-loss-grade silent rewrite. The Fetch spec says to uppercase exactly six methods and pass everything else through verbatim. It also makes Bun.serve unusable behind proxies that forward extension methods.
bun 2.0 proposal: Store the method as a string; normalize only the six spec-listed methods; pass everything else through on both client and server.
blast radius: low - only adds capability; nobody depends on `pAtCh` turning into `GET`.
confidence: high.

### `Bun.readableStreamTo*` deprecated toward non-standard, *untyped* `ReadableStream.prototype.*`

what: Four of the seven `Bun.readableStreamTo*` helpers are `@deprecated` in favor of `ReadableStream.prototype.{text,json,bytes,blob}()` - which are Bun-only, non-standard additions to a Web global, and don't even have type declarations.
where: `packages/bun-types/deprecated.d.ts:44-84` (`@deprecated Use {@link ReadableStream.bytes}` etc.); the *non*-deprecated siblings (`readableStreamToArrayBuffer`, `readableStreamToFormData`, `readableStreamToArray`) still live in `packages/bun-types/bun.d.ts:1778-1820`.
evidence: #29401 "ReadableStream is deprecated but proposed replacement doesn't exist." (OPEN) - `stream.text()` is a TS error on a typed `ReadableStream` while `Bun.readableStreamToText` shows a deprecation strikethrough. (Verified at runtime: `typeof stream.text === "function"` in bun 1.4.0-canary.)
why bad: Bun deprecated its own documented API in favor of an API it neither standardized nor typed, and only deprecated half the family. `ReadableStreamDefaultReader.readMany()` (`packages/bun-types/globals.d.ts:744`, "Only available in Bun") and `Blob.prototype.formData()` (`globals.d.ts:1489`, "This is a non-standard addition to the `Blob` API") are the same pattern of bolting Bun-only methods onto WHATWG globals.
bun 2.0 proposal: Pick one story - either ship + type the prototype methods and deprecate *all seven* `readableStreamTo*` functions, or un-deprecate the functions. Stop adding unprefixed non-standard methods to WHATWG prototypes.
blast radius: low - types + a handful of helper functions.
confidence: high.

### Three names for environment variables: `process.env` / `Bun.env` / `import.meta.env`

what: Bun exposes environment variables under three aliases that the docs call identical but that have repeatedly diverged in behavior, types, and bundler treatment.
where: `docs/runtime/environment-variables.mdx:150`: "Bun also exposes these variables as `Bun.env` and `import.meta.env`, both aliases of `process.env`." `src/runtime/api/BunObject.rs:2131` ("This is aliased to Bun.env").
evidence: #15359 "process.env and Bun.env have different results" (two values of `NODE_ENV` in the same process). #18753 "make Bun.env, process.env and import.meta.env all consume each other" - a bugfix required to make the aliases actually alias. #20961 "`process.env` incorrectly extends ImportMetaEnv", #18594 (TS declaration merging broke). Bundler: `import.meta.env` is inlined by the bundler (#28692, #21772, #8548) but `Bun.env` is not (#5833 "Bun.env missing values when using bundler", #20430), so the "aliases" compile differently.
why bad: Three spellings for one concept triples the bug surface (each divergence above was a real shipped bug) and the bundler treating them differently means code that works at runtime breaks when bundled. `import.meta.env` in particular is a Vite-ism with no standard behind it.
bun 2.0 proposal: Keep `process.env` as the source of truth. Keep `Bun.env` as a documented trivial alias if desired. Deprecate `import.meta.env` at runtime (it only exists to make copy-pasted Vite code not crash).
blast radius: low/medium - `import.meta.env` users would see a deprecation; nothing else changes.
confidence: medium.

### Three+ names for the current module's path on `import.meta`

what: Bun invented `import.meta.dir`, `import.meta.path`, and `import.meta.file`; Node later standardized `import.meta.dirname`/`import.meta.filename`; Bun now ships both sets plus `__dirname`/`__filename`.
where: `packages/bun-types/globals.d.ts:1302-1311` (`path`, `dir`, `file`) and `:1359-1363` - `dirname`: "Alias of `import.meta.dir`. Exists for Node.js compatibility"; `filename`: "Alias of `import.meta.path`. Exists for Node.js compatibility". Also `:1326` - `import.meta.resolveSync` is `@deprecated`, and `:1335` - `import.meta.require`: "**This API is not stable** and may change or be removed in the future."
evidence: Types quoted above. `import.meta.path` naming is also internally misleading (it's the *file* path, while `path` elsewhere in Bun means a directory-or-file string), and `import.meta.file` (basename only) has no counterpart anywhere in the ecosystem. #15994, #4216, #2865 show the bundler mishandling the non-standard ones.
why bad: Five properties (`dir`/`dirname`/`path`/`filename`/`file`) express two values. The "Exists for Node.js compatibility" comments are the tell: the ecosystem converged on different names after Bun shipped its own, and Bun now carries both forever.
bun 2.0 proposal: Keep the Node names (`dirname`, `filename`) as primary; `@deprecated` `dir`, `path`, and `file`; delete `resolveSync` (it's already deprecated) and make `require` internal-only.
blast radius: medium - `import.meta.dir` is widely used in Bun code and tutorials, but a deprecation-then-removal path is mechanical.
confidence: high.

### `Request` getters return fixed stub values; `credentials` defaults to `"include"`

what: `request.credentials` always returns `"include"` (spec default is `"same-origin"`), and `destination`/`integrity` (and per #30124 also `referrer`/`referrerPolicy`/`keepalive`) return hardcoded values that ignore the `RequestInit` they were constructed with.
where: `src/runtime/webcore/Request.rs:748-750` - `get_credentials` unconditionally returns `common_strings().include()`; `:752-758` - `get_destination`/`get_integrity` return `""`.
evidence: #17052 "Request has wrong default for credential property" (OPEN; quotes fetch.spec.whatwg.org/#request-class: "If input is a string, it defaults to 'same-origin'"; Node and all browsers return `"same-origin"`). #30124 "Request getters return fixed values, ignoring init: referrer, referrerPolicy, integrity, keepalive" (OPEN).
why bad: These are spec-defined reflected properties with a one-line correct implementation; returning a constant means any code that round-trips or clones a `Request` (middleware, frameworks) silently loses options in Bun. `"include"` is also the permissive end of the spectrum, so it's wrong *and* unsafe-leaning.
bun 2.0 proposal: Store and reflect the init values; default `credentials` to `"same-origin"` per spec.
blast radius: low - very little code reads `request.credentials` on a server, and changing it only makes it spec-correct.
confidence: high.

### `Bun.generateHeapSnapshot()` (JSC format) returns a pre-parsed object

what: In the default `"jsc"` format Bun JSON.parses the snapshot and returns a JS object, while the `"v8"` format returns a `string`/`ArrayBuffer` - an inconsistent, memory-expensive return type the code itself calls a mistake.
where: `src/jsc/bindings/BunObject.cpp:836`: "// Returning an object was a bad idea but it's a breaking change // so we'll just keep it for now."
evidence: The source comment above is a verbatim admission.
why bad: Parsing a multi-hundred-MB JSON heap snapshot *into the heap you are snapshotting* defeats the purpose, and the two formats of the same function return incompatible types for no reason other than history.
bun 2.0 proposal: Return a `string` (or `ArrayBuffer`) for the JSC format too, matching the v8 overload.
blast radius: low - `Bun.generateHeapSnapshot("jsc")` callers add a `JSON.parse`.
confidence: high.

### `install.linkWorkspacePackages` defaults to `true`

what: Bun always links workspace packages by name into `node_modules`, even when the `package.json` pins a published registry version; the Bun team has already queued flipping the default.
where: `src/install/PackageManager/PackageManagerOptions.rs:113` - `link_workspace_packages: true,`.
evidence: Team tracking issue #20292 "Breaking changes for Bun v1.3" (closed) contains the *still-unchecked* item: "default value `false` for `install.linkWorkspacePackages`". #8811 "Add link-workspace-packages option or another way to opt out of linking workspace packages" is the original report (monorepos where `"package-a": "1.0.0"` must come from the registry, not the sibling workspace).
why bad: Silently substituting the local workspace copy for a pinned registry version is a correctness hazard (you test against code that won't be what's deployed). pnpm's equivalent (`link-workspace-packages`) defaults to the safe behavior. Bun's own team listed this as a wanted breaking change and never shipped it.
bun 2.0 proposal: Default `false`; auto-link only `workspace:*` protocol specifiers.
blast radius: medium - monorepos relying on implicit linking need `workspace:*` specifiers or the config flag.
confidence: high.

### Docker images default to the `baseline` (no-AVX2) build

what: `oven/bun` tags point at the slower, compatibility-mode `baseline` binary; the team filed an issue to flip this for 1.2 and never did.
where: Issue only (release infra).
evidence: #12180 "Change Docker images to use non-baseline by default" (OPEN, team-filed): "We should change the default in Bun 1.2 to use the non-baseline images, and introduce new `-baseline` tags". It was linked from the "Breaking changes for Bun 1.2" tracking issue #12181.
why bad: Nearly every production deploy target supports AVX2, so the default silently costs performance for everyone to serve a shrinking minority; the team said so themselves two major versions ago.
bun 2.0 proposal: Non-baseline by default, `-baseline` suffix tags for the rest.
blast radius: low - only affects users pulling fresh images onto pre-2013 x86 CPUs.
confidence: high.

### `bun run <script>` executes a package's `node` shebang with `node`, not Bun

what: When a package-bin shebang says `#!/usr/bin/env node`, Bun launches real Node instead of itself; you must pass `--bun` to get Bun. The team wanted to flip this before 1.0.
where: CLI behavior; issue only.
evidence: #4464 "Make `--bun` default, introduce `--node`" (OPEN, team-filed): "Currently, when Bun runs a script with a shebang in package.json, it will default to Node. **Before 1.0, we should change this** so that it defaults to Bun, and introduce `--node`". Roadmap #159 (Winter 2024): "If `bun` present then ignore node shebangs by default (#9346)".
why bad: `bun run build` frequently doesn't run Bun at all, which surprises users ("why is my Vite build still on Node?") and means the headline "Bun is fast" doesn't apply to the commands most people run. Two roadmap cycles planned to change it.
bun 2.0 proposal: Default to Bun; add `--node` as the escape hatch, exactly as #4464 says.
blast radius: high - tools with genuine Node-only native deps would need `--node`; this is why it keeps slipping.
confidence: high.

### Compiled executables auto-load `.env` and `bunfig.toml` from the *user's* CWD

what: A `bun build --compile` binary silently reads `.env` and `bunfig.toml` from whatever directory it's run in; the docs already warn this default will change.
where: `docs/bundler/executables.mdx:410-411`: "**`.env`** and **`bunfig.toml`** loading is **enabled** … <Note> In a future version of Bun, `.env` and `bunfig.toml` may also be disabled by default for more deterministic behavior. </Note>"
evidence: Doc quote above is a first-party stated intent. `tsconfig.json`/`package.json` loading was already flipped to disabled for the same reason (same doc section), so this is the known-bad half that hasn't been flipped yet.
why bad: A distributed binary that changes behavior based on a stray `.env` in the end user's CWD is non-deterministic and a minor injection surface; the team has already fixed half of this and documented the rest as pending.
bun 2.0 proposal: Disable both by default; keep the existing `--compile-autoload-*` opt-in flags.
blast radius: low - compiled apps that relied on ambient `.env` add one flag.
confidence: high.

### Static-route matching in the router uses an ad-hoc case-insensitivity hack

what: Routes with uppercase characters are registered twice under two keys to fake case-insensitive matching, with no option to control it.
where: `src/router/lib.rs:633-639`: "Longer-term: We should have an option for controlling this behavior / … for allowing case-sensitive matching / But the default should be case-insensitive matching. **This hack is below the engineering quality bar I'm happy with. It will cause unexpected behavior.**"
evidence: Verbatim in-tree comment above.
why bad: The author is on record that the shipped behavior is wrong, undesigned, and will misbehave; there is no knob, so whatever a user gets is by accident.
bun 2.0 proposal: Make matching explicitly case-insensitive (the comment's stated preference) with a documented `caseSensitive` option.
blast radius: low - only affects `Bun.FileSystemRouter` / static route maps with mixed-case paths.
confidence: high.

### Zombie aliases and deprecated surface carried "for backwards compat"

what: A long tail of renamed/superseded API is still exported with no removal date.
where / evidence:
- `packages/bun-types/deprecated.d.ts:176-184` - globals `BuildError`/`ResolveError`, "Renamed to `BuildMessage`"/"Renamed to `ResolveMessage`".
- `deprecated.d.ts:119-121` - `Bun.Errorlike`, "Renamed to `ErrorLike`" (a *casing* rename kept forever).
- `deprecated.d.ts:126-151` - `TLSOptions.keyFile`/`certFile`/`caFile`, "@deprecated **since v0.6.3** - Use `key: Bun.file(path)` instead" - deprecated for 20+ minor versions. Related: #3459 "Deprecate `dhParamsFile`, implement `dhParams`" (OPEN).
- `deprecated.d.ts:102-117` - `Bun.ServeOptions`, `Bun.SQLQuery`, `Bun.SQLOptions`, … all renamed into namespaces.
- `packages/bun-types/bun.d.ts:4834-4836` - `Bun.shrink()` `@deprecated` with no replacement named.
- `packages/bun-types/bun.d.ts:6672-6674` - `Bun.SpawnOptions` → "`@deprecated` use `Bun.Spawn` instead".
- `packages/bun-types/sql.d.ts:208-333` - nine `Bun.SQL.Options` keys (`host`, `user`, `pass`, `db`, `idle_timeout`, `connect_timeout`, `connectTimeout`, `max_lifetime`, `ssl`) each `@deprecated` in favor of the camelCase name; `sql.d.ts:944` - top-level `Bun.SQL` export itself "@deprecated Prefer `Bun.sql`".
- `src/runtime/server/ServerConfig.rs:651` - `for key in ["routes", "static"]`: `static` is an undocumented, untyped alias for the `routes` option; it appears nowhere in `serve.d.ts` or docs.
- `packages/bun-types/globals.d.ts:1326-1328` - `import.meta.resolveSync` `@deprecated`.
- `src/js/bun/ffi.ts:469,517` - "// Bind it because it's a breaking change to not do so // Previously, it didn't need to be bound".
why bad: None of these can be removed inside 1.x, so each one is permanent API-surface tax, autocomplete noise, and a fork point for docs/tutorials. `Errorlike` vs `ErrorLike` and `snake_case` vs `camelCase` SQL options mean there are two spellings of *everything* in `Bun.sql`.
bun 2.0 proposal: Delete the whole `deprecated.d.ts` surface, the `static` alias, the snake_case SQL option names, and `Bun.shrink()` in one pass.
blast radius: low individually; medium in aggregate (the `keyFile`/`certFile` one will hit real TLS configs).
confidence: high.

### `trustedDependencies` *replaces* a hidden built-in allowlist instead of extending it

what: If the `trustedDependencies` key exists in `package.json` at all - even as `[]` - Bun's built-in list of ~367 default-trusted packages is discarded entirely; the field replaces rather than extends.
where: `src/install/default-trusted-dependencies.txt` (367 entries); behavior documented by the fix PR #31027 (merged), which closed #31026.
evidence: #31026 "Clarify behavior of empty `trustedDependencies`" - "`\"trustedDependencies\": []` … actually disables the default list entirely." PR #31027 body shows the three-row truth table (key omitted → 500 defaults; `["pkg"]` → only pkg; `[]` → nothing). Related regret about the hidden list itself: #7642 "Allow disabling postinstall for top 500 packages" (OPEN), #12855 "Add an option to explicitly untrust a dependency" (OPEN), #30337.
why bad: Adding one entry to `trustedDependencies` silently *removes* ~367 packages from the trusted set - the opposite of what the name and every other "additional X" field implies, and it's a *security* setting, so the surprise cuts in the unsafe direction (users who wanted to add one package suddenly find `esbuild`'s postinstall no longer runs and add it too, widening the list by hand).
bun 2.0 proposal: Make `trustedDependencies` additive to the default list; add a separate `untrustedDependencies`/`trustPolicy` key to opt out of the built-ins.
blast radius: low - only people who set the key AND depended on the defaults being disabled (rare, and the docs never promised it).
confidence: high.

### Bun invented its own lockfile format (`bun.lockb`) and had to reverse it

what: (Historical, mostly-resolved - included because the reversal cost is still being paid.) Bun 1.x shipped a proprietary *binary* lockfile; text `bun.lock` only became the default in 1.2.
where: `bun.lockb` read/migrate support throughout `src/install/`; `docs/pm/` still documents migration.
evidence: #11863 "Implement a text-based lockfile format" (the 1.2 reversal), #5486, #6276, #7295 "Help dependabot team to support bun" - the binary format blocked Dependabot/Renovate for ~2 years. #15858, #16914 show the text-format rollout had its own breakage.
why bad: A format no diff tool, code host, or security scanner could read was a pure design regret; it is the single clearest precedent that Bun will take a breaking change to fix a default.
bun 2.0 proposal: Drop `bun.lockb` *write* support entirely (keep one-way migration), so the format can't come back via `save-text-lockfile=false`.
blast radius: low - 1.2 already moved everyone.
confidence: high.

### Precedent: defaults Bun already admits were wrong (corroborating signals, not new asks)

These are smaller, but each carries a first-party admission and shows the same "default was wrong, fix deferred for compat" pattern:

- **`Bun.build()` used to not throw on failure.** `packages/bun-types/bun.d.ts:3737`: "`@throws {AggregateError}` When build fails and config.throw is true (**default in Bun 1.2+**)" - i.e. before 1.2 the default silently resolved `{success:false}`. The legacy behavior is kept behind `throw: false`.
- **`bun -p` meant `--port`, not `--print`.** #14223 "Switch `bun -p` from `--port` to `--print`" - "This will match `node -p` behavior." (Fixed in 1.2; shows single-letter flags were claimed before checking Node.)
- **`bun test --only` flag.** `test.only()` originally had no effect without `bun test --only` (unlike every other test runner). That was fixed, but the flag remains (`src/runtime/cli/Arguments.rs:572`) and `docs/test/writing-tests.mdx:192` still documents the *old* behavior ("The following command runs tests #1, #2 and #3: `bun test`"), so users still learn the wrong semantics. #22168, #18189, #33087.
- **Unused-import elision in JS.** `src/js_parser/scan/scan_imports.rs:265`: "I think, in this project, we want this behavior, even in JavaScript … **This is a breaking change though.**" - a wanted default change deferred indefinitely.
- **MIME sniffing in `Bun.serve` responses.** `src/runtime/server/RequestContext.rs:4420`: "TODO: should we get the mime type off of the Blob.Store if it exists? A little wary of doing this right now due to **causing some breaking change**".

where: as cited inline.
evidence: as cited inline.
why bad: Each is an author-acknowledged wrong default or missing semantic, explicitly deferred because of backwards compatibility - exactly the category a 2.0 exists to clear.
bun 2.0 proposal: Sweep them in the same release: remove `--only`, fix the stale doc, ship the import-elision change behind a flag-then-default, and take the MIME-type-from-Blob change.
blast radius: low each.
confidence: high (every item has a verbatim in-tree quote or a team-authored issue).
