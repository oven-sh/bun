# Bun 2.0 candidates from `packages/bun-types/**/*.d.ts`

Scope: every `@deprecated` tag in `packages/bun-types/` (excluding `vendor/`), plus compat
overloads, alias accretion, non-standard bolt-ons, and wrong-in-hindsight defaults that
the type files themselves document. 54 `@deprecated` tags were found in Bun's own `.d.ts`
files; all are catalogued below. There is a dedicated 185-line file,
`packages/bun-types/deprecated.d.ts`, whose sole purpose is to hold compat shims - that
file is the single densest signal in the repo.

---

### `Bun.sql` option bag: 10 deprecated `postgres`-package alias keys, incl. 4 spellings of one timeout

what: `Bun.SQL.Options` accepts a second, deprecated name for nearly every field because it was modeled on the `postgres` npm package's snake_case option names.
where: `packages/bun-types/sql.d.ts:208` (`host` -> `hostname`), `:233` (`user` -> `username`), `:246` (`pass` -> `password`), `:259` (`db` -> `database`), `:278` (`idle_timeout` -> `idleTimeout`), `:291` (`connection_timeout`), `:299` (`connectTimeout`), `:307` (`connect_timeout`) - all three -> `connectionTimeout`, `:320` (`max_lifetime` -> `maxLifetime`), `:333` (`ssl` -> `tls`).
evidence: ten separate `@deprecated Prefer {@link ...}` tags, e.g. `sql.d.ts:289-302`:
> `* Maximum time in seconds to wait when establishing a connection (alias for connectionTimeout)`
> `* @deprecated Prefer {@link connectionTimeout}`
repeated verbatim for `connectTimeout` and `connect_timeout` - **four** accepted spellings of one knob. Introduced/formalized by PR #22260 ("Fix: Make SQL connection string parsing more sensible").
why bad: four names for one timeout and two for every other field is pure accretion from emulating `porsager/postgres`. It doubles the option-parsing surface, makes typos silently "work" (they hit the other alias), and every new adapter (mysql, sqlite, mariadb - `sql.d.ts:268`) inherits the whole mess.
bun 2.0 proposal: keep only the camelCase canonical names (`hostname`, `username`, `password`, `database`, `idleTimeout`, `connectionTimeout`, `maxLifetime`, `tls`); make the deprecated keys hard errors.
blast radius: medium - anyone who copied config from `postgres.js` docs breaks, but the fix is mechanical renames.
confidence: high.

### `Bun.readableStreamTo*`: half-deprecated family whose replacement is also non-standard (and invisible to TS)

what: 4 of the 7 `Bun.readableStreamTo*` helpers are `@deprecated` in favor of Bun-only methods bolted onto `ReadableStream.prototype`; the other 3 are not deprecated, and the replacements don't type-check when `lib.dom` is loaded.
where: `packages/bun-types/deprecated.d.ts:44` (`readableStreamToBytes` -> `ReadableStream.bytes`), `:58` (`readableStreamToBlob`), `:70` (`readableStreamToText`), `:82` (`readableStreamToJSON`). The NOT-deprecated siblings: `bun.d.ts:1778` (`readableStreamToArrayBuffer`), `:1809` (`readableStreamToFormData`), `:1820` (`readableStreamToArray`). The replacements live only in a `declare module "stream/web"` augmentation (`overrides.d.ts:28-35`), so they never reach the DOM-lib `ReadableStream`.
evidence: `@deprecated Use {@link ReadableStream.text}` (`deprecated.d.ts:70`). Open issue **#29401** - "ReadableStream is deprecated but proposed replacement doesn't exist": `stream.text() // compiler error: Property 'text' does not exist on type 'ReadableStream<any>'`. The prototype methods themselves are non-standard (`src/jsc/bindings/webcore/JSReadableStream.cpp:99-138`).
why bad: users are pushed off a working API onto one TypeScript can't see, the migration is half-done (3 of 7 kept), and the "standard" destination is itself a Bun invention on a WHATWG global.
bun 2.0 proposal: pick one: either remove all 7 `Bun.readableStreamTo*` and ship the prototype methods in a way TS always sees, or keep the free functions and drop the prototype extensions.
blast radius: medium - `readableStreamToText`/`ToJSON` are widely used in older Bun code.
confidence: high.

### `bun:sqlite` `Database.close()` default - the types admit it's wrong

what: `Database.close(throwOnError)` defaults to `false`, silently swallowing a real failure; the JSDoc says outright that the default exists only for back-compat.
where: `packages/bun-types/sqlite.d.ts:279-291`.
evidence: verbatim, `sqlite.d.ts:288`:
> `* In the future, Bun may default \`throwOnError\` to \`true\`, but for backwards compatibility it is \`false\` by default.`
why bad: this is the single clearest written admission of a regretted default in the entire types package. `sqlite3_close_v2` hiding an in-use database is exactly the error-swallowing the CLAUDE.md error-handling rules forbid elsewhere.
bun 2.0 proposal: flip the default to `true`; remove the parameter or invert it to `force?: boolean`.
blast radius: low - almost nobody passes the argument; code that was silently leaking now sees an error.
confidence: high.

### `bun:sqlite` `safeIntegers: false` and `strict: false` defaults

what: by default integers are silently truncated to 52 bits and parameter-binding mismatches are silently ignored; the safe behavior is opt-in.
where: `packages/bun-types/sqlite.d.ts:52-60` (`safeIntegers`), `:62-84` (`strict`).
evidence: `sqlite.d.ts:55`: `* When \`false\`, integers are returned as \`number\` and truncated to 52 bits.` `@default false @since v1.1.14`. `sqlite.d.ts:63-65`: `When set to \`false\` or \`undefined\`: - Queries missing bound parameters do NOT throw an error`. Both were added in v1.1.14 as opt-ins because the pre-existing (worse) behavior was already shipped.
why bad: silent 52-bit truncation of INTEGERs and silently-unbound parameters are data-corruption footguns. The very fact that the *safer* behavior needed a flag is the regret.
bun 2.0 proposal: default `strict: true` and `safeIntegers: true`.
blast radius: medium - `safeIntegers` changes return types from `number` to `bigint`, which is a real source break.
confidence: high.

### `Bun.serve({ static })` → `routes` rename: the old name survives as an untyped runtime alias, and the new name broke Hono

what: `static` was renamed to `routes` in Bun 1.2.3; the runtime still accepts `static` (no longer typed), and `routes` needed an array-ignoring heuristic because framework instances already had a `.routes` array.
where: runtime alias: `src/runtime/server/ServerConfig.rs:651` - `for key in ["routes", "static"]`. Heuristic: `ServerConfig.rs:652-657` with the issue URL inline. Types: only `routes` exists (`serve.d.ts:606,616,668,682`).
evidence: `ServerConfig.rs:653`: `// https://github.com/oven-sh/bun/issues/17568` followed by `if routes.is_array() { return Ok(None); }`. Issue **#17568** "The simplest hono app fails to start" (Bun 1.2.3) - `Bun.serve(honoApp)` blew up because `Hono#routes` is an array.
why bad: the option was named into a collision with the ecosystem's most popular `export default app` shape, then patched with a type-sniffing heuristic, and the superseded `static` key lives on silently. Three layers of regret in one option.
bun 2.0 proposal: drop the `static` alias; consider a name that can't collide with userland objects (or only read `routes` when `fetch` is absent).
blast radius: low for `static` (it was short-lived and is already untyped); zero for the heuristic.
confidence: high.

### `Headers.getAll()` - Bun types expose an API the WHATWG spec deleted in 2016, and hide the standard one

what: Bun's `Headers` type adds `getAll(name: "set-cookie")`, a method removed from the Fetch Standard in 2016; the standard replacement `getSetCookie()` is implemented in the runtime but absent from Bun's type overrides. Bun also adds non-standard `toJSON()` and `count`.
where: `packages/bun-types/fetch.d.ts:36-70` (`toJSON`, `count`, `getAll` on `BunHeadersOverride`). Runtime has both: `src/jsc/bindings/webcore/JSFetchHeaders.cpp:309` (`getAll`) and `:318` (`getSetCookie`).
evidence: `fetch.d.ts:69`: `getAll(name: "set-cookie" | "Set-Cookie"): string[];` - no `getSetCookie` declared anywhere in `packages/bun-types/`. Closed issue **#9412**: "Type 'Headers' is missing the following properties from type 'Headers': toJSON, count, getAll" - the extensions break structural assignability with `lib.dom`'s `Headers`. Issue **#6755** ("Headers.toJSON should support `set-cookie`").
why bad: Bun is typing a dead spec method, not typing the live one, and the non-standard members (`count`, `toJSON`) make Bun's `Headers` structurally incompatible with every other runtime's `Headers` type.
bun 2.0 proposal: remove `getAll` (or keep as runtime-only), add `getSetCookie(): string[]` to the types, drop `count` (derivable) and keep `toJSON` only if kept un-enumerable.
blast radius: low - `getAll` is a one-line swap to `getSetCookie`.
confidence: high.

### `new ReadableStream({ type: "direct" })` - non-standard stream mode; standard `"bytes"` mode documented as unsupported

what: Bun replaced the standard `ReadableByteStream` (`type: "bytes"`) with a proprietary `type: "direct"` mode, and the types explicitly declare the standard mode unsupported.
where: `packages/bun-types/bun.d.ts:300-314`, `packages/bun-types/globals.d.ts:77-78`.
evidence: `bun.d.ts:304-307`: `/** Mode "bytes" is not supported. */ type?: undefined;` followed by `interface DirectUnderlyingSource { ... type: "direct"; }`. The implementation comment in `src/js/builtins/ReadableStreamInternals.ts:2132-2142` is an explicit design post-mortem: `// This was a type: "bytes" until Bun v1.1.44, but pendingPullIntos was not really compatible with how we send data to the stream ... those pendingPullIntos were often never actually drained.` Open issues **#6643** ("Use readable byte stream for Blob.stream() and Response.body"), **#12908** ("ReadableStreamBYOBReader needs a ReadableByteStreamController"), **#7091** (BYOB `{min}`).
why bad: this is a straight WHATWG divergence that buys Bun a private fast path at the cost of the entire BYOB-reader ecosystem (`getReader({mode:"byob"})` fails on `fetch().body`). The team already tried and reverted `"bytes"` once.
bun 2.0 proposal: make Bun's native sources real readable *byte* streams and delete `"direct"`, or at minimum support `type: "bytes"` alongside it so BYOB works.
blast radius: medium - `type: "direct"` is documented and used; but the payoff is standard-stream interop everywhere.
confidence: high.

### `deprecated.d.ts` rename residue: `BuildError`, `ResolveError`, `Errorlike`, `ServeOptions`, `SQLQuery`, `SQLTransactionContextCallback`, `SQLSavepointContextCallback`, `SQLOptions`

what: eight global/namespace type names kept only because they predate a rename or a namespacing pass.
where: `packages/bun-types/deprecated.d.ts:102-121` and `:176-184`.
evidence: verbatim tags:
- `:102` `@deprecated Use {@link Serve.Options Bun.Serve.Options<T, R>} instead` (`ServeOptions`)
- `:106` `@deprecated Use {@link SQL.Query Bun.SQL.Query}` (`SQLQuery`)
- `:109` / `:112` / `:115` - `SQLTransactionContextCallback` / `SQLSavepointContextCallback` / `SQLOptions`
- `:119` `@deprecated Renamed to \`ErrorLike\`` (`Errorlike` - a casing fix)
- `:177` `@deprecated Renamed to \`BuildMessage\`` (`declare var BuildError`)
- `:182` `@deprecated Renamed to \`ResolveMessage\`` (`declare var ResolveError`)
why bad: `BuildError`/`ResolveError` are *global variables*, not just types, so two names for the same class are visible at runtime. `Errorlike` exists purely because of a capital-L typo. These have obvious one-token migrations and no reason to survive a major.
bun 2.0 proposal: delete all eight.
blast radius: low - pure type/global renames with documented replacements.
confidence: high.

### `Bun.postgres` - a whole second name for `Bun.sql`

what: `Bun.postgres` is a deprecated alias of `Bun.sql`, still exported by the runtime.
where: type: `packages/bun-types/sql.d.ts:944`; runtime: `src/js/bun/sql.ts:1074` (`postgres: SQL,`).
evidence: `sql.d.ts:941-946`: `* SQL client for PostgreSQL` / `* @deprecated Prefer {@link Bun.sql}` / `const postgres: SQL;`.
why bad: the name is now a lie - `Bun.sql` also speaks MySQL, MariaDB, and SQLite (`sql.d.ts:268`), so `Bun.postgres` is both redundant and misleading about what it returns.
bun 2.0 proposal: delete `Bun.postgres`.
blast radius: low.
confidence: high.

### `TLSOptions.keyFile` / `certFile` / `caFile` - deprecated since v0.6.3, still implemented ~3 years later

what: path-string TLS options superseded by `Bun.file()` values in v0.6.3 but never removed from the runtime.
where: types: `packages/bun-types/deprecated.d.ts:126-151`; runtime: `src/runtime/socket/SSLConfig.rs:197-206` (all three still parsed).
evidence: `deprecated.d.ts:132`: `@deprecated since v0.6.3 - Use \`key: Bun.file(path)\` instead.` (and `:141`, `:148` for `cert`/`ca`). `SSLConfig.rs:197`: `if let Some(key_file) = generated.key_file.get() { result.key_file_name = handle_path(global, "keyFile", &key_file)?; }`.
why bad: this is the oldest surviving `@deprecated` in the types (a `since v0.6.x` tag in a 1.3.x codebase), and it silently maintains two TLS config code paths through security-critical code.
bun 2.0 proposal: remove `keyFile`/`certFile`/`caFile` from `SSLConfig` parsing and from `TLSOptions`.
blast radius: low - migration is `key: Bun.file(path)`.
confidence: high.

### `Bun.resolve` - an async function with no async benefit, kept "for future-proofing"

what: `Bun.resolve(id, parent)` is an async twin of `Bun.resolveSync` that the docs themselves say has no reason to exist.
where: `packages/bun-types/bun.d.ts:1549-1556`.
evidence: `bun.d.ts:1554`, verbatim:
> `* Use {@link resolveSync} instead. This async version has no performance benefit; it exists for future-proofing.`
Add `import.meta.resolveSync` (separately `@deprecated` at `globals.d.ts:1326`: `Use \`require.resolve\` or \`Bun.resolveSync(moduleId, path.dirname(parent))\` instead`) and `import.meta.resolve`, and Bun has **four** module-resolution entry points. `import.meta.resolve` also diverges from Node (Node returns a URL without touching the filesystem; Bun throws if the target doesn't exist - open issue **#21617**).
why bad: four overlapping resolvers, one self-admittedly useless, one deprecated, one non-Node-compatible.
bun 2.0 proposal: keep `import.meta.resolve` (Node-compatible: return a URL, don't stat) and `Bun.resolveSync`; delete `Bun.resolve` and `import.meta.resolveSync`.
blast radius: low.
confidence: high.

### `Bun.shrink()` - deprecated, still wired up, redundant with three other GC entry points

what: `Bun.shrink()` is `@deprecated` with no stated replacement, yet is still implemented; Bun separately exposes `Bun.gc(force)`, `Bun.unsafe.gcAggressionLevel()`, and `bun:jsc`'s `fullGC()`/`gcAndSweep()`/`edenGC()`.
where: type: `packages/bun-types/bun.d.ts:4831-4836`; runtime: `src/runtime/api/BunObject.rs:1166` (`global_object.vm().shrink_footprint()`); siblings: `bun.d.ts:4765` (`gc`), `:4718` (`gcAggressionLevel`), `jsc.d.ts:7-9`.
evidence: `bun.d.ts:4834`: a bare `@deprecated` with no forwarding target - the only one of its kind in the package.
why bad: a deprecation with no replacement is undeletable debt; and "make the GC do something" already has 5+ spellings across two modules.
bun 2.0 proposal: delete `Bun.shrink` (fold into `Bun.gc({shrink:true})` if the behavior matters).
blast radius: low.
confidence: high.

### `WebSocket.URL` (uppercase) and instance `CONNECTING/OPEN/CLOSING/CLOSED` with a self-contradictory deprecation

what: Bun's `WebSocket` type carries a legacy uppercase `URL` property plus per-instance ready-state constants; the constants' `@deprecated` message points users to the thing it is deprecating.
where: `packages/bun-types/bun.d.ts:4352-4356` (`URL`), `:4473-4480` (constants).
evidence: `:4354` `@deprecated Use url instead` on `readonly URL: string;`. `:4473-4480`, verbatim and repeated four times:
> `/** @deprecated Use instance property instead */` `readonly CONNECTING: 0;`
- these ARE the instance properties; the message was meant to say "static".
why bad: `URL` is a pre-standard WebSocket property no other modern runtime ships; the constants' docs are nonsense (per spec, IDL constants live on both the interface object and the prototype and neither is deprecated). Both are noise carried for compatibility with an older Bun.
bun 2.0 proposal: remove `URL`; either un-deprecate the instance constants or fix the message.
blast radius: low.
confidence: high (for `URL` and the wrong message), medium (that the team intends to remove the instance constants).
)

### `Bun.SpawnOptions` / `Spawn.OptionsObject` - two deprecated indirections onto `Bun.Spawn`

what: the `SpawnOptions` namespace is an `export import` alias of `Spawn`, and `Spawn.OptionsObject` is an alias of `Spawn.BaseOptions` - both deprecated.
where: `packages/bun-types/bun.d.ts:6671-6674` and `:6707-6710`.
evidence: `:6672` `@deprecated use {@link Bun.Spawn} instead` on `export import SpawnOptions = Spawn;`; `:6708` `@deprecated use BaseOptions or the specific options for the specific {@link spawn} or {@link spawnSync} usage`.
why bad: three names (`SpawnOptions`, `Spawn`, `Spawn.BaseOptions`/`Spawn.OptionsObject`) for one concept; pure rename residue.
bun 2.0 proposal: delete both aliases.
blast radius: low - type-only.
confidence: high.

### `import.meta.hot.decline()` - a shipped no-op

what: the dev-server HMR API exposes `decline()`, documented as doing nothing.
where: `packages/bun-types/devserver.d.ts:137-141`.
evidence: verbatim: `/** No-op  @deprecated */ decline(): void;`.
why bad: an API that exists only so Vite-shaped code doesn't throw; it gives users a false sense that they opted a module out of HMR.
bun 2.0 proposal: remove it (or make it actually decline and un-deprecate).
blast radius: low.
confidence: high.

### `S3Options.highWaterMark` - deprecated duplicate of `partSize` + `queueSize`

what: an S3 buffer-size knob superseded by two clearer knobs.
where: `packages/bun-types/s3.d.ts:407-410`.
evidence: `:408`, verbatim: `@deprecated The size of the internal buffer in bytes. Defaults to 5 MiB. Use \`partSize\` and \`queueSize\` instead.` Note `partSize`/`queueSize` exist at `s3.d.ts:268,278`.
why bad: `highWaterMark` is a Node-streams term that doesn't map onto multipart-upload semantics; it was replaced within the same major.
bun 2.0 proposal: delete `highWaterMark` from `S3Options`.
blast radius: low.
confidence: high.

### `delete()` / `unlink()` duplicated across `BunFile`, `S3File`, and `S3Client`

what: the same "remove this file" capability is exposed under two names in three places.
where: `packages/bun-types/bun.d.ts:2186` (`BunFile.unlink`) + `:2189-2191` (`delete` - "same as unlink"); `packages/bun-types/s3.d.ts:791` (`S3File.delete`) + `:793-801` (`unlink` - "Alias for delete()"); `packages/bun-types/s3.d.ts:1229` (`S3Client.unlink` static) + `:1230-1257` (`delete` + instance `unlink`, both "Alias for {@link S3Client.unlink}").
evidence: `bun.d.ts:2189` `Deletes the file (same as unlink)`; `s3.d.ts:794` `Alias for \`delete()\`, matching the Node.js \`fs\` API naming.` - the two files even disagree on which name is canonical (BunFile's doc says `delete` is the alias of `unlink`; S3File's says `unlink` is the alias of `delete`).
why bad: inconsistent canon between sibling APIs is exactly the "inconsistent naming vs sibling Bun APIs" signal; neither `delete` nor `unlink` is clearly primary.
bun 2.0 proposal: pick one (`delete()` is the Web/Blob-ish one) and keep it across all three; drop the other.
blast radius: low.
confidence: high.

### `Bun.SQL`: `close`/`end`, `begin`/`transaction`, `beginDistributed`/`distributed` alias pairs

what: three method pairs on the `SQL` interface that do the same thing under a second, `postgres.js`-compatible name.
where: `packages/bun-types/sql.d.ts:657` (`close`) + `:660-669` (`end`, "Alias of {@link SQL.close}"); `:797-827` (`transaction`, "Begins a new transaction. Alias of {@link begin}"); `:906-908` (`distributed`, "Alias of {@link beginDistributed}").
evidence: explicit `@alias begin` / `@alias {@link beginDistributed}` tags at `sql.d.ts:804,831,907`.
why bad: combined with the 10 deprecated option aliases above, `Bun.sql` carries the entire `postgres.js` surface as a shadow API. These aren't even `@deprecated`, so they'll be copied into new code forever.
bun 2.0 proposal: `@deprecated` then remove `end`, `transaction`, `distributed` (keep `close`, `begin`, `beginDistributed`).
blast radius: medium - `sql.end()` is idiomatic in `postgres.js` code.
confidence: medium (these may be intentional permanent `postgres.js` compat).

### `bun:redis` `hmset` (3 overloads) and `substr` - Redis's own deprecations mirrored into Bun's new API

what: a brand-new client ships three overloads of a command Redis deprecated in 4.0.0 and one Redis calls deprecated outright.
where: `packages/bun-types/redis.d.ts:582,593,611` (`hmset`), `:2568` (`substr`).
evidence: `:582` `@deprecated Use {@link hset} instead. Since Redis 4.0.0, \`HSET\` supports multiple field-value pairs.` (x3); `:2568` `@deprecated Use {@link getrange} instead. SUBSTR is a deprecated Redis command.`; `:609` notes one overload exists for `(array syntax, backward compat)`.
why bad: the API was born with back-compat baggage - "backward compat" with whom, for an API that never existed before? These should never have shipped typed and un-prefixed.
bun 2.0 proposal: remove `hmset` and `substr` from the typed surface (keep `.send()` for raw commands).
blast radius: low - brand new API.
confidence: high.

### `bun:sqlite` `Database.exec` - alias of `Database.run`

what: two names for "execute a statement and get `{changes, lastInsertRowid}`".
where: `packages/bun-types/sqlite.d.ts:186` (`run`) and `:188-193` (`exec`).
evidence: `:189-191`, verbatim: `* This is an alias of {@link Database.run}` / `* @deprecated Prefer {@link Database.run}`. Also `Database.open` (`sqlite.d.ts:126-136`) is documented as `This is an alias of \`new Database()\``.
why bad: `exec` in `better-sqlite3` means "run many statements, return nothing" while `run` means "run one, return changes" - making them *aliases* in Bun both duplicates the name and breaks the expectation users carry over.
bun 2.0 proposal: remove `exec` (or give it `better-sqlite3` semantics and un-alias it).
blast radius: low.
confidence: high.

### `Bun.serve({ development })` default is tied to `NODE_ENV`

what: `Bun.serve` renders full stack traces in HTTP responses unless `NODE_ENV === 'production'`.
where: `packages/bun-types/serve.d.ts:710-714` and `:1138-1144`.
evidence: `serve.d.ts:712`: `@default process.env.NODE_ENV !== 'production'`; `:1140-1142`: `In development mode, \`Bun.serve()\` returns rendered error messages with stack traces instead of a generic 500 error. Don't use development mode` [in production].
why bad: a security-sensitive behavior is keyed on an env var many deployers never set. Forgetting `NODE_ENV=production` leaks source paths and stack frames to the internet. The safe value should be the absence-of-signal value.
bun 2.0 proposal: default `development: false`; enable it only when explicitly requested (or when `bun --hot`/the dev server is running).
blast radius: medium - developers who never set `NODE_ENV` lose the nice error page until they pass `development: true`.
confidence: medium (clear footgun; no written team admission found).

### Bun's `fetch()` `RequestInit`: 9 non-standard options, one self-flagged as removable

what: `BunFetchRequestInit` adds `tls`, `verbose`, `proxy`, `s3`, `unix`, `protocol`, `decompress`, `compress`, `maxRedirects` to WHATWG `RequestInit`, and the types admit they are non-portable and in one case disposable.
where: `packages/bun-types/globals.d.ts:1908-2083`.
evidence: `globals.d.ts:1921-1922` on the interface itself: `These extensions are not part of \`RequestInit\` because they don't work when passed to \`new Request()\`.` `:1931-1933` on `verbose`: `Log the raw HTTP request and response to stdout, as a debugging aid. This API may be removed in a future version of Bun without notice. Not part of the Fetch API specification.` `Not part of the Fetch API specification.` also appears at `:1945, :2015, :2025, :2050, :2074, :2105`. `protocol` is additionally `@experimental` (`:2016`).
why bad: the types document a fundamental asymmetry: these options only work on `fetch()` but not on `Request`, so `fetch(new Request(url, init))` silently drops them. `verbose` is already declared removable.
bun 2.0 proposal: at minimum delete `verbose` (replace with an env var / `BUN_CONFIG_VERBOSE_FETCH`); make the remaining extensions also work on `Request` or throw when ignored.
blast radius: low for `verbose`; high to change the `Request` asymmetry.
confidence: high (for the `verbose` deletion and the documented asymmetry).

### `Response.json(body, number)` and `new Request({url, ...})` - spec-shape deviations

what: `Response.json`'s second argument accepts a bare status number (spec says `ResponseInit` only), and `Request` has a non-standard object-with-`url` constructor overload.
where: `packages/bun-types/globals.d.ts:1880` (`json(body?: any, init?: ResponseInit | number)`); `:1848` (`new (requestInfo: RequestInit & { url: string }): Request;`). Runtime: `src/runtime/webcore/Response.rs:1012` (`else if arg_init.is_number()`).
evidence: `globals.d.ts:1880` types it; `Response.rs:1010-1016` implements the number branch for the `json` static. Neither form exists in the WHATWG Fetch spec (whose `Response.json(data, init)` takes only a `ResponseInit`).
why bad: code written against Bun's sugar (`Response.json(x, 404)`) is a runtime error in Node, Deno, browsers, and Workers - the worst kind of portability trap because it's silent and ergonomic.
bun 2.0 proposal: keep at most `Response.json(x, {status: 404})`; remove the bare-number overload from types (a deprecation warning at runtime first).
blast radius: medium - the number form is genuinely convenient and likely in the wild.
confidence: high that it's non-standard; medium that the team would break it.

### "Unused in Bun's types and may be removed" - 8 orphaned public type names

what: a cluster of exported types kept with a self-describing "we don't even use these" tag.
where: `packages/bun-types/deprecated.d.ts:2` (`Platform`), `:16` (`Architecture`), `:19` (`UncaughtExceptionListener`), `:26` (`UnhandledRejectionListener`), `:30` (`MultipleResolveListener`), `:123` (`ShellFunction`), `:153` (`ReadableIO`).
evidence: each carries verbatim `@deprecated Unused in Bun's types and may be removed`.
why bad: exported names nothing in Bun references are pure API surface with no owner - the definition of a 2.0 deletion.
bun 2.0 proposal: delete all of them.
blast radius: low.
confidence: high.

### Hashing: four overlapping families plus a phantom class

what: Bun exposes `Bun.sha()` (hard-coded to SHA-512/256), eight concrete classes (`Bun.SHA1`..`Bun.SHA512_256`, `Bun.MD4`, `Bun.MD5`), the generic `Bun.CryptoHasher`, and the non-crypto `Bun.hash.*` - plus `node:crypto.createHash`. Their shared "base class" doesn't exist at runtime.
where: `packages/bun-types/bun.d.ts:5078-5172` (classes + `sha`), `:4924` (`CryptoHasher`), `:4854-4857` (`CryptoHashInterface`).
evidence: `bun.d.ts:4855`, verbatim: `* This class only exists in types` (`abstract class CryptoHashInterface<T>`). `bun.d.ts:5102-5104` on `SHA1`: `This is not the default because it's not cryptographically secure and it's slower than {@link SHA512} / Consider {@link SHA512_256} instead` - "the default" refers to `Bun.sha()` having a hard-coded algorithm. `MD4` (`:5122`) is a broken-since-1995 hash exposed as a first-class `Bun.MD4`.
why bad: three spellings of "hash these bytes with SHA-256" (`new Bun.SHA256()`, `Bun.SHA256.hash()`, `new Bun.CryptoHasher("sha256")`) plus a types-only base class is the textbook duplication the project's own review rules forbid. `Bun.sha` being secretly `sha512-256` is a naming trap.
bun 2.0 proposal: keep `Bun.CryptoHasher` + `Bun.hash.*`; delete the eight per-algorithm classes, `Bun.sha()`, and the phantom `CryptoHashInterface`.
blast radius: medium - `Bun.SHA256.hash()` appears in tutorials.
confidence: medium (clear duplication; no explicit deprecation yet).

### `bun:ffi` `FFIType`: triple-aliased type names

what: every integer/float type is spelled three ways (stdint, Rust, C), all mapping to the same enum value.
where: `packages/bun-types/ffi.d.ts:18-340`.
evidence: explicit `Alias of {@link ...}` JSDoc at `ffi.d.ts:182` (`i32` -> `int32_t`), `:214` (`u32`), `:225` (`i64`), `:244` (`f64`), `:254` (`f32`), `:290` (`pointer` -> `ptr`); plus the un-tagged triples `char`(0)/`int8_t`(1)/`i8`(1) at `:19,38,57` and `int32_t`/`i32`/`int` all `= 5`.
why bad: `FFIType.char = 0` but `FFIType.int8_t = 1` and `FFIType.i8 = 1` - three C-ish names, two of which are synonyms and one of which is not, is a correctness trap, and the triple naming is pure accretion.
bun 2.0 proposal: pick one naming convention (stdint: `int32_t`, `uint64_t`, `float`, `double`, `ptr`) and deprecate the rest.
blast radius: low - type-level; string keys also accepted.
confidence: medium.

### `bun:test`: `test.todo(fn)` vs `test.failing(fn)` - two inverted-result primitives, one non-Jest

what: Bun's `test.todo` accepts an implementation that runs under `--todo` with inverted pass/fail; `test.failing` does the same thing but always. Jest's `test.todo` takes no implementation at all.
where: `packages/bun-types/test.d.ts:502-519`.
evidence: `:505-507`: `These tests only run when the \`--todo\` flag is passed. With the flag, a \`.todo\` test that passes is marked as \`fail\``; `:516-517`, verbatim: `\`test.failing\` is similar to {@link test.todo} except that it always runs, regardless of the \`--todo\` flag.` - the docs themselves describe the overlap.
why bad: Bun invented `.todo(fn)` semantics, then had to add the Jest-compatible `.failing` for the same job, and now keeps both plus a CLI flag whose only purpose is to distinguish them.
bun 2.0 proposal: make `test.todo` Jest-compatible (name only, no body, never runs) and point implemented-but-expected-to-fail tests at `test.failing`; remove `--todo`.
blast radius: medium - Bun's own test suite uses `.todo` with bodies heavily.
confidence: medium.

### `bun:test`: five Jest-legacy matcher aliases Jest itself has removed

what: `toBeCalled`, `toBeCalledTimes`, `toBeCalledWith`, `lastCalledWith`, `nthCalledWith` (and `toThrowError`) are aliases of the `toHaveBeen*`/`toThrow` forms.
where: `packages/bun-types/test.d.ts:1441` (`toThrowError` - `@alias toThrow`), `:1851,1862,1873,1884,1895` (the five `@alias toHaveBeen*` tags).
evidence: explicit `@alias` tags at each line, e.g. `:1851` `@alias toHaveBeenCalled` on `toBeCalled(): void;`.
why bad: Jest deprecated these aliases in 26 and deleted them in Jest 30 (2025); Bun is now *more* backward-compatible with dead Jest versions than Jest is.
bun 2.0 proposal: `@deprecated` then remove them to track Jest 30.
blast radius: low-medium - old Jest codebases migrated to `bun test` may use them.
confidence: medium.

### `console[Symbol.asyncIterator]` - stdin reading bolted onto `console`

what: `for await (const line of console)` reads stdin, a capability Bun put on the `console` global.
where: `packages/bun-types/overrides.d.ts:389-403` (`declare module "console"` augmentation).
evidence: `overrides.d.ts:391-401`: `Asynchronously reads lines from standard input (fd 0) ... for await (const line of console)`.
why bad: `console` is a WHATWG-defined object for *output*; making it the stdin iterator is a category error and duplicates `Bun.stdin.stream()` and `node:readline`. No other runtime can adopt this.
bun 2.0 proposal: remove; point users at `Bun.stdin` / a `Bun.lines()` helper.
blast radius: low - rarely discovered.
confidence: medium.

### Lower-confidence / minor (listed for completeness)

- **`Bun.dns.lookup` backend default is self-described as tentative.** `bun.d.ts:1981-1982`: `Defaults to \`"c-ares"\` on Linux and \`"system"\` on macOS. This default may change in a future version of Bun if c-ares is not reliable enough.` A default the team reserves the right to flip. (`bun.d.ts:1978-2011`) - confidence: high that it's a hedge, low that it flips.
- **`BunMessageEvent.initMessageEvent` / `CustomEvent.initCustomEvent` / `DOMException.code`** (`deprecated.d.ts:86-99, 166-174`) - DOM-level deprecations Bun must keep for lib.dom parity; not Bun's design to change.
- **`process.assert`** (`deprecated.d.ts:157-163`, `@deprecated Use the \`node:assert\` module instead`) - a Node-compat leftover Node itself removed.
- **`fetch.d.ts` file header admits structural debt**: `fetch.d.ts:2-10`: `This file does not declare any global types. ... so that our documentation generator can pick it up ... This may change in the future, which would be a nice thing`.
- **`S3File.size: NaN`** - `docs/runtime/s3.mdx:578-582`: `Size is not synchronously available because it requires a network request. @deprecated Use \`stat()\` instead.` Inheriting `Blob.size` onto a network object forced a property that is always wrong; `BunFile.size` has the same flavor of problem (`bun.d.ts:4092`: `\`size\` is not valid until the contents of the file are read at least once`).
- **`bun:jsc` `jscDescribe`** - `jsc.d.ts:2-5`: `Renamed from "describe" to avoid confusion with the test runner.` - already a past name-collision fix; evidence that `bun:jsc`'s JSC-internal names leak.
- **Image resize `"linear"` / `toBuffer()`** - `bun.d.ts:8242` `// alias for bilinear (Sharp)`, `:8407` `Sharp-compatible alias for {@link buffer}` - more third-party-compat aliasing baked into a brand-new API.
