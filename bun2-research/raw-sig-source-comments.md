# Bun 2.0 candidates - source comments admitting API design regret

Method: `rg -i` over `src/`, `packages/bun-types/`, and `docs/` for regret-flavored
language (`deprecat`, `legacy`, `backwards compat`, `for compatibility`, `unfortunately`,
`non-standard`, `not spec`, `in the future`, `should wait`, `rename`, `TODO: remove`,
`holdover`, `kept for`, `do not use`, etc.), then opening each hit and confirming the
comment is about a *Bun public API* (Node compat shims mirroring Node's own deprecations
were discarded). GitHub issues fetched via `gh api search/issues`.

---

### fetch() network errors reject with a plain `Error`, not `TypeError`

what: `fetch()` rejections for network failures (ECONNREFUSED, ECONNRESET, TLS errors,
too-many-redirects, ...) are a Bun `SystemError` whose prototype chain is plain `Error`,
not the `TypeError` the Fetch spec mandates for "network error"; the `.code` is a Bun
PascalCase name (`"ConnectionRefused"`) rather than the errno name Node gives.
where: `src/runtime/webcore/fetch/FetchTasklet.rs:1285-1287`; `packages/bun-types/globals.d.ts`
(`SystemError`).
evidence: Source comment (verbatim): `// Fetch-spec "network error" cases that callers
feature-detect via // \`instanceof TypeError\`. Keep this list narrow; the catch-all //
SystemError below is still a plain Error for backwards compat.`
(`FetchTasklet.rs:1285-1287`). Issue #20486 "Native `fetch` incompatibilities with NodeJS
error format and codes" (open) shows `code: 'ConnectionRefused'` vs Node's
`TypeError: fetch failed { cause: { code: 'ECONNREFUSED' } }`. Fetch spec §"fetch method"
step 12.3 requires a `TypeError`.
why bad: Every other runtime (Node/undici, Deno, all browsers) rejects with `TypeError`,
so `err instanceof TypeError` - the idiomatic network-error check - silently misfires in
Bun. The comment shows the team already knows this is wrong and is only adding TypeError
cases one-by-one while keeping the catch-all non-compliant "for backwards compat."
bun 2.0 proposal: Make all network-error rejections a `TypeError` (keep the rich
`cause`/`code`/`errno`/`path` as properties/`cause`), and make `.code` emit POSIX errno
names (`ECONNREFUSED`) instead of Bun-internal tags.
blast radius: medium - anyone catching Bun's current `.code` strings or asserting the
class name breaks, but code written for Node/the-spec starts working.
confidence: high.

### `Blob.prototype` globally carries `File`/`BunFile`/`S3File` members

what: Every `Blob` in Bun exposes `name` (with a setter), `lastModified`, `exists()`,
`unlink()`, `delete()`, `write()`, `stat()`, `writer()`, and `image()` - because
`Bun.file()`/`File`/`S3File` are all just `Blob` with extra prototype members instead of
their own subclasses.
where: `src/runtime/webcore/response.classes.ts:179-192` (the `Blob` `define({...})`).
evidence: Source comments (verbatim, twice): `// TODO: Move this to a separate \`File\`
object or BunFile` / `// This is *not* spec-compliant.` (`response.classes.ts:180,189`);
also `// Non-standard, s3 + BunFile support` (`:194`). Open issues: #20700 "`Blob` has
`name` ... this deviates from the spec and all runtimes including node, deno, firefox and
chrome", #32434 "Move `name` and `lastModified` from `Blob.prototype` to
`File.prototype`", #14102 "File symbol is `Blob` instead of `File`", #32430 "Give File its
own prototype with Symbol.toStringTag \"File\"".
why bad: `"name" in new Blob()` is `true` only in Bun. Libraries that feature-detect
`File` via `"name" in blob` or `blob instanceof File` misbehave; `File` has no distinct
prototype or `Symbol.toStringTag`. This is a layering error, not a bug - the source
admits the fix is to split the class.
bun 2.0 proposal: Give `File`, `BunFile`, and `S3File` their own prototypes inheriting
from `Blob`; remove every non-standard member from `Blob.prototype` itself.
blast radius: medium - code doing `Bun.file(p) instanceof Blob` keeps working; code that
set `.name` on a raw `Blob` or relied on `toStringTag === "Blob"` for a `File` breaks.
confidence: high.

### `NODE_TLS_REJECT_UNAUTHORIZED="false"` disables TLS certificate verification

what: Bun treats both `"0"` and `"false"` as "turn off TLS verification"; Node only
honors the exact string `"0"`, so `NODE_TLS_REJECT_UNAUTHORIZED=false` is a no-op
(i.e. still secure) in Node but insecure in Bun.
where: `src/jsc/bindings/JSEnvironmentVariableMap.cpp:253-255`; `src/js/node/tls.ts:449-452`;
`src/dotenv/env_loader.rs:292-300`.
evidence: Source comment (verbatim): `// TODO: only check "0". Node doesn't check both.
But we already did. So we // should wait to do that until Bun v1.2.0.`
(`JSEnvironmentVariableMap.cpp:253-254`). `tls.ts:451`: `return value !== "0" && value !== "false";`
(Node's is `value !== '0'`). `env_loader.rs:292`: `/// Checks whether
\`NODE_TLS_REJECT_UNAUTHORIZED\` is set to \`0\` or \`false\`.`
why bad: This is a security-relevant silent divergence: an env value that is a harmless
typo/no-op on Node downgrades Bun to accepting any certificate. The comment explicitly
admits the extra check is a mistake they were waiting on a version boundary to remove -
and v1.2.0 has long since shipped.
bun 2.0 proposal: Only `"0"` disables verification, matching Node exactly. (Optionally
print a one-time warning for `"false"`.)
blast radius: low - only users relying on the non-Node spelling `"false"` notice, and for
them the change restores security.
confidence: high.

### `WebSocket` client `binaryType` defaults to non-standard `"nodebuffer"`

what: `new WebSocket(url).binaryType` is `"nodebuffer"` (a Bun/ws-specific value) instead
of the spec-mandated default `"blob"`; setting an invalid value throws a `SyntaxError`
instead of being silently ignored as the spec says.
where: `src/jsc/bindings/webcore/WebSocket.h:320-334`; `src/jsc/bindings/webcore/WebSocket.cpp:1252-1281`.
evidence: Source comment (verbatim): `// In browsers, the default is Blob, however most
applications // immediately change the default to ArrayBuffer. // // And since we know
the typical usage is to override the default, // we set NodeBuffer as the default to
match the default of ServerWebSocket.` (`WebSocket.h:329-333`). The enum is annotated
`// non-standard: NodeBuffer` (`WebSocket.h:322`). `WebSocket.cpp:1280-1281` shows the
spec's ignore behavior commented out and replaced with `return Exception { SyntaxError, ... }`.
Issue #8721 "Support blob `binaryType` in WebSocket" (the spec default wasn't even
*implemented* until late); #26669 reported a crash with `binaryType = "blob"`.
why bad: Per the HTML spec, `binaryType` MUST default to `"blob"`; Node 22+'s global
`WebSocket` (undici), Deno, and all browsers do. Code ported from those runtimes that
does `if (ev.data instanceof Blob)` silently gets a `Buffer` in Bun. The stated rationale
("match ServerWebSocket") optimizes the wrong thing: the client class is a web standard,
the server class is not.
bun 2.0 proposal: Default `binaryType` to `"blob"` (or at worst `"arraybuffer"`); keep
`"nodebuffer"` as an opt-in; on invalid assignment, no-op per spec.
blast radius: medium - any Bun code not setting `binaryType` today sees `Blob` instead of
`Buffer` in `message` events.
confidence: high.

### `Bun.readableStreamTo{Text,JSON,Blob,Bytes,...}` superseded by `ReadableStream.prototype.*`

what: Seven free functions on the `Bun` namespace (`readableStreamToText/JSON/Blob/Bytes/
Array/ArrayBuffer/FormData`) duplicate what `ReadableStream.prototype.{text,json,blob,bytes}()`
now does; four are already `@deprecated`.
where: `packages/bun-types/deprecated.d.ts:44-84`; runtime impl
`src/js/builtins/ReadableStream.ts:110-345`; prototype replacements
`src/jsc/bindings/webcore/JSReadableStream.cpp:166-176`.
evidence: `@deprecated Use {@link ReadableStream.bytes}` / `.blob` / `.text` / `.json`
(`deprecated.d.ts:44,58,70,82`). Issue #29401 "ReadableStream is deprecated but proposed
replacement doesn't exist." (open) - the `@deprecated` pointer confused a user because
`@types/bun` only augments `stream/web`'s `ReadableStream`, not the global one
(`packages/bun-types/overrides.d.ts:28-34`), even though the runtime methods exist
(`JSReadableStream.cpp:168-172`).
why bad: This is the clearest self-admitted "we designed the wrong shape" in the codebase:
Bun invented 7 ad-hoc namespace functions, then implemented the emerging standard and
deprecated its own API. The remaining three (`readableStreamToArray`, `...ArrayBuffer`,
`...FormData`) are still undeprecated in `bun.d.ts:1778-1820`, leaving a half-migrated
surface.
bun 2.0 proposal: Remove all seven from `Bun`; keep only the `ReadableStream.prototype`
methods (and `Response`/`new Blob(stream)` paths for the `FormData`/`Array` cases). Fix
the global-type augmentation so the deprecation pointer resolves.
blast radius: medium - widely used in early Bun tutorials, but the replacement is a
trivial mechanical rewrite.
confidence: high.

### `bun:sqlite` `Database.close()` silently swallows errors by default

what: `db.close(throwOnError)` defaults `throwOnError` to `false`, calling
`sqlite3_close_v2` and discarding failures; the type docs say the team wants `true`.
where: `packages/bun-types/sqlite.d.ts:280-290`; runtime `src/js/bun/sqlite.ts`.
evidence: Doc comment (verbatim): `In the future, Bun may default \`throwOnError\` to
\`true\`, but for backwards compatibility it is \`false\` by default.`
(`sqlite.d.ts:288`).
why bad: An explicit "the default is wrong, we kept it for compat" in the shipped types.
Silent error-swallowing on `close()` is exactly the class of default that hides data
corruption (unfinished statements, busy handles).
bun 2.0 proposal: Default `throwOnError` to `true` (`sqlite3_close`); keep `close(false)`
as the opt-out.
blast radius: low - only code with leaked prepared statements starts seeing the error it
was already having.
confidence: high.

### Standalone executables auto-load `.env` and `bunfig.toml` from the runtime cwd

what: A `bun build --compile` binary reads `.env*` and `bunfig.toml` from whatever
directory it happens to be run in, by default.
where: `docs/bundler/executables.mdx:404-412`.
evidence: Doc (verbatim): `- **\`.env\`** and **\`bunfig.toml\`** loading is **enabled**
... <Note> In a future version of Bun, \`.env\` and \`bunfig.toml\` may also be disabled
by default for more deterministic behavior. </Note>` (`executables.mdx:406-412`).
`tsconfig.json`/`package.json` loading was *already* flipped to disabled-by-default,
leaving the two halves inconsistent.
why bad: A single-file executable is supposed to be self-contained and deterministic; the
current default makes its behavior depend on the invoking directory's dotfiles - a
surprise at best and a config-injection vector at worst. The docs explicitly call the
current state a future breaking change.
bun 2.0 proposal: Default `.env`/`bunfig.toml` loading OFF for `--compile` binaries;
provide `--compile-autoload-env` / `--compile-autoload-bunfig` (the flags for
tsconfig/package.json already exist with this naming scheme).
blast radius: medium - compiled apps that relied on picking up a sibling `.env` need an
explicit flag.
confidence: high.

### `bunfig.toml [define]` values are JSON strings embedded in TOML strings

what: `[define]` requires double-encoding - the TOML value must be a *string containing
JSON* (e.g. `"process.env.bagel" = "'lox'"`), not a TOML value.
where: `docs/runtime/bunfig.mdx:73-80`; `src/bunfig/bunfig.rs`.
evidence: Doc comment, shipped inside the example config block (verbatim): `# The values
are parsed as JSON, except single-quoted strings are supported and 'undefined' becomes
undefined in JS. # This will probably change in a future release to be just regular TOML
instead. It is a holdover from the CLI argument parsing.` (`bunfig.mdx:77-78`).
why bad: The project's own documentation, in the canonical example, tells users the
format is a holdover that will probably change. It's the only `bunfig.toml` key with this
double-encoding, and quoting a string requires three nested quote characters.
bun 2.0 proposal: Accept plain TOML values in `[define]` (strings, numbers, booleans,
inline tables), matching how `Bun.build({ define })` already takes a JS object.
blast radius: low - a migration shim can accept both shapes for one release.
confidence: high.

### Non-standard members on `Headers.prototype` and `FormData.prototype`

what: Bun adds `getAll()`, `count`, and `toJSON()` to the global `Headers.prototype`, and
`toJSON()` and `length` to `FormData.prototype`. `Headers.getAll(name)` is a strict
duplicate of the *standard* `Headers.getSetCookie()`: it throws
`TypeError: Only "set-cookie" is supported.` for every other name.
where: `src/jsc/bindings/webcore/JSFetchHeaders.cpp:77-79, 184-186, 219-221, 304-319`;
`src/jsc/bindings/webcore/JSDOMFormData.cpp:104-105, 201-215`; types
`packages/bun-types/fetch.d.ts:35-70`.
evidence: Source comments (verbatim): `// Non-standard functions`
(`JSFetchHeaders.cpp:77`, `JSDOMFormData.cpp:104`); `/** * Non standard function. **/`
(`JSFetchHeaders.cpp:184-186, 407-409`, `JSDOMFormData.cpp:512-514`). Runtime:
`throwTypeError(..., "Only \"set-cookie\" is supported."_s)` (`JSFetchHeaders.cpp:220`).
Note the type docs even contradict the runtime: `fetch.d.ts:55` says other names
"return[] an empty array", but the runtime throws.
why bad: `getAll` was in a 2015 Fetch draft and was deliberately removed from the spec;
the standardized replacement (`getSetCookie()`) ships in Bun right next to it, so `getAll`
is a pure legacy alias. `count`/`length`/`toJSON` are bolted onto standard globals and
create the expectation that they exist elsewhere.
bun 2.0 proposal: Remove `Headers.prototype.getAll` (point people at `getSetCookie()`).
Keep `toJSON`/`count`/`length` only if made `DontEnum` + documented as Bun extensions, or
move the functionality to `Bun.inspect`/`Object.fromEntries`.
blast radius: low for `getAll`/`count`/`length` (undocumented/obscure); medium for
`Headers.toJSON` (documented and used for `JSON.stringify(headers)`).
confidence: high.

### `Bun.SQL` accepts 10 deprecated option-name aliases (4 spellings of one option)

what: `new Bun.SQL(opts)` accepts `host`/`hostname`, `user`/`username`, `pass`/`password`,
`db`/`database`, `idle_timeout`/`idleTimeout`, `connection_timeout`/`connectTimeout`/
`connect_timeout`/`connectionTimeout`, `max_lifetime`/`maxLifetime`, and `ssl`/`tls` - all
nine snake_case/short forms are `@deprecated` aliases copied from the `postgres` npm
package. `Bun.postgres` is itself a `@deprecated` alias of `Bun.sql`.
where: `packages/bun-types/sql.d.ts:206-334` (aliases), `:944` (`Bun.postgres`);
runtime `src/js/internal/sql/shared.ts:1941-1951`.
evidence: Eight `@deprecated Prefer {@link ...}` annotations (`sql.d.ts:208,233,246,259,
278,291,299,307,320,333`); `@deprecated Prefer {@link Bun.sql}` (`sql.d.ts:944`). Runtime
alias chain: `connectionTimeout ??= options.connection_timeout; connectionTimeout ??=
options.connectTimeout; connectionTimeout ??= options.connect_timeout;`
(`shared.ts:1947-1950`). The runtime's error messages still name the *deprecated*
spellings: `$ERR_INVALID_ARG_VALUE("options.idle_timeout", ...)`, `"options.connection_timeout"`,
`"options.max_lifetime"` (`shared.ts:1981,1995,2005`).
why bad: Four spellings of one option is the direct cost of copying another library's
API surface at launch. The fact that validation errors still print the deprecated names
means the "canonical" names aren't even fully adopted internally.
bun 2.0 proposal: Accept only the camelCase names; keep `url` and per-adapter names.
Remove `Bun.postgres`.
blast radius: low - `Bun.SQL` is young and the canonical names have been the documented
ones for a while.
confidence: high.

### `TLSOptions.keyFile` / `certFile` / `caFile` - deprecated since v0.6.3, still wired

what: The TLS options that take a *file path string* were deprecated over two years ago in
favor of `key: Bun.file(path)` etc., but are still declared, parsed, and honored.
where: types `packages/bun-types/deprecated.d.ts:126-151`; runtime
`src/runtime/socket/SSLConfig.rs:196-208`, `src/runtime/socket/SSLConfig.bindv2.ts:72-82`.
evidence: `@deprecated since v0.6.3 - Use \`key: Bun.file(path)\` instead.`
(`deprecated.d.ts:132,141,148`). Runtime still reads them:
`result.key_file_name = handle_path(global, "keyFile", &key_file)?;` (`SSLConfig.rs:198`).
why bad: Three extra spellings for every TLS-accepting API (`Bun.serve`, `Bun.listen`,
`Bun.connect`, `fetch`), deprecated for ~30 releases, kept only for compat with Bun < 0.7.
bun 2.0 proposal: Remove `keyFile`/`certFile`/`caFile`.
blast radius: low - deprecated for years; migration is mechanical.
confidence: high.

### `BuildError` / `ResolveError` globals kept after the rename to `BuildMessage` / `ResolveMessage`

what: Two globals that were renamed are still installed on `globalThis`, pointing at the
same class structures as the new names.
where: `src/jsc/bindings/ZigGlobalObject.lut.txt:36,41`; types
`packages/bun-types/deprecated.d.ts:176-184`.
evidence: `@deprecated Renamed to \`BuildMessage\`` / `@deprecated Renamed to
\`ResolveMessage\`` (`deprecated.d.ts:177,182`). LUT entries: `BuildError
GlobalObject::m_JSBuildMessage  ClassStructure` / `ResolveError
GlobalObject::m_JSResolveMessage  ClassStructure` (`ZigGlobalObject.lut.txt:36,41`).
why bad: Two extra globals on `globalThis` that exist purely as spelling aliases of other
globals. The `...Error` suffix was the regret (they aren't `Error` subclasses).
bun 2.0 proposal: Remove the `BuildError`/`ResolveError` global bindings.
blast radius: low - only `Bun.build`/plugin error-handling code touches these, and the
new names have been the documented ones since ~1.0.
confidence: high.

### `Bun.serve({ static })` - undocumented alias of `routes`

what: `Bun.serve` reads the routes object from either the `routes` key or the `static`
key; only `routes` appears in the types and docs.
where: `src/runtime/server/ServerConfig.rs:650-658`.
evidence: `fn get_routes_object(...) { for key in ["routes", "static"] { ... } }`
(`ServerConfig.rs:651`). `packages/bun-types/serve.d.ts` declares only `routes`; `rg static`
in `docs/runtime/http/` returns nothing.
why bad: `static` was the name when the feature shipped (static `Response` routes only);
when it grew into the full router it was renamed to `routes` but the old key was kept
silently, with no type, no docs, and no deprecation warning.
bun 2.0 proposal: Remove the `static` key (or at minimum make it warn).
blast radius: low - undocumented for multiple minor versions.
confidence: high.

### `bun pm view` duplicates `bun info`

what: Two CLI commands do the same thing; the help text for one tells you to use the other.
where: `src/runtime/cli/package_manager_command.rs:163`.
evidence: Help text (verbatim): `` bun pm view name[@version]  view package metadata from
the registry (use `bun info` instead) `` (`package_manager_command.rs:163`). `bun info`
has its own docs page (`docs/pm/cli/info.mdx`); `bun pm view` does not.
why bad: Two entry points for one feature, with the legacy one telling the user it is
legacy from inside `--help`. This is the API-duplication signal the help text itself
already flags.
bun 2.0 proposal: Remove `bun pm view` (keep `bun info`).
blast radius: low - both are interactive commands; scripts are unlikely to use `pm view`.
confidence: high.

### Bun Shell `mkdir` spells `--verbose` as `--vebose`

what: In `Bun.$` / the Bun Shell, the builtin `mkdir` accepts the long flag `--vebose`
(a typo) and *rejects* `--verbose` as an illegal option; the typo is explicitly preserved
"for compatibility."
where: `src/runtime/shell/builtin/mkdir.rs:421-440`.
evidence: Source comment (verbatim): `// Note: the \`--vebose\` typo is intentional (kept
for compatibility).` followed by `if flag == b"--vebose" {` (`mkdir.rs:435-436`). The
struct's own doc comment claims `` `-v`, `--verbose` `` works (`mkdir.rs:422`) - it does
not (`parse_long` at `:427-440` only matches `--mode`, `--parents`, `--vebose`; unknown
long flags fall through to `parse_one_flag` at `src/runtime/shell/interpreter.rs:2592-2611`
and become `IllegalOption`).
why bad: A user typing the *correct* GNU flag gets an error, and the misspelling is now
"load-bearing" per the comment. This is the purest example in the tree of a bug that
became an API because nobody wanted a breaking change. (`-v` works.)
bun 2.0 proposal: Accept `--verbose`; either drop `--vebose` or keep it as a silent alias.
blast radius: low - nobody is deliberately typing `--vebose`.
confidence: high.

### Grab-bag: individually small deprecated/legacy surface

what: A set of already-`@deprecated` or self-described-legacy pieces of public surface,
each admitted in source.
where / evidence:
- `Bun.shrink()` - `@deprecated` with no replacement given (`packages/bun-types/bun.d.ts:4831-4836`);
  still installed (`src/runtime/api/BunObject.rs:359,1166`). Duplicates `bun:jsc` memory APIs.
- `import.meta.resolveSync` - `@deprecated Use \`require.resolve\` or \`Bun.resolveSync(...)\`
  instead` (`packages/bun-types/globals.d.ts:1326`). Non-standard `import.meta` member
  that duplicates two other APIs.
- `bun:ffi` `callback()` export - throws `new Error("Deprecated. Use new JSCallback(options, fn)
  instead")` at runtime (`src/js/bun/ffi.ts:414-418`). A throwing tombstone for a removed API.
- `bun:jsc` `jscDescribe` - `/** Renamed from "describe" to avoid confusion with the test
  runner. */` (`packages/bun-types/jsc.d.ts:2-5`). A global-namespace collision baked
  into an API name.
- `FileSystemRouter` `MatchedRoute.scriptSrc` - `// this is for compatibiltiy with
  bun-framework-next old versions` (`src/runtime/api/filesystem_router.classes.ts:85`);
  duplicate of `src` (`:90-93`), kept for a framework that no longer exists.
- `S3File.size` - always `NaN`, `@deprecated Use \`stat()\` instead.`
  (`docs/runtime/s3.mdx:578-584`); `bufferSize` deprecated for `partSize`/`queueSize`
  (`packages/bun-types/s3.d.ts:408`). Both are consequences of `S3File extends Blob`
  (see the Blob finding above).
- `Bun.build({ throw })` - the option only exists because the pre-1.2 default (`false`,
  i.e. swallow errors into `{success: false}`) was wrong; `@throws {AggregateError} When
  build fails and config.throw is true (default in Bun 1.2+)` (`packages/bun-types/bun.d.ts:3737,2843-2849`).
- `fetch(url, { verbose })` - `This API may be removed in a future version of Bun without
  notice.` (`packages/bun-types/globals.d.ts:1930-1935`). Shipped-as-provisional debug
  surface on a standard global.
- Type-only casing/namespace regrets, all in `packages/bun-types/deprecated.d.ts`:
  `Errorlike` → `ErrorLike` (`:118-121`), `ServeOptions` → `Serve.Options` (`:101-104`),
  `SQLQuery`/`SQLOptions`/... → `SQL.*` (`:106-116`), `SpawnOptions` namespace →
  `Spawn` (`bun.d.ts:6671-6674`), plus five `Unused in Bun's types and may be removed`
  types.
why bad: Each is a source-admitted rename, duplicate, or mistake that costs API surface
and documentation weight. None is individually urgent, but together they are the residue
a 2.0 would clear.
bun 2.0 proposal: Delete them all. For `scriptSrc`, `callback`, `shrink`,
`import.meta.resolveSync`, `static`, `BuildError`, `ResolveError`, `keyFile/certFile/caFile`,
and `bun pm view`, that is a simple removal; for `Bun.build({throw:false})` and
`S3File.size`, the option/property goes away with the larger redesign.
blast radius: low in aggregate.
confidence: high for the existence of each; medium for the claim the team would actually
remove every one.

---

## Notable near-misses (excluded)

- `src/resolver/resolver.rs:1415-1418`: `// TODO: This is skipped for now because it is
  impossible to set a resolveDir so we default to the top level directory instead (this
  is backwards compat with Bun 1.0 behavior) // See
  https://github.com/oven-sh/bun/issues/8994`. A real Bun-1.0-era compat hack in the
  plugin/virtual-module resolver, but it is an internal behavior, not a public API shape.
- `Bun.spawn` stdio defaults are asymmetric (`stdin: "ignore"`, `stdout: "pipe"`,
  `stderr: "inherit"` for `spawn` but `"pipe"` for `spawnSync`) - the `@default` comment
  at `packages/bun-types/bun.d.ts:6800,6812,6824-6825` documents the inconsistency itself,
  but there is no regret comment and no issue I could find, so it doesn't meet the bar.
- `src/js/node/_http_incoming.ts:172`, `src/js/internal/streams/*` "Backwards compat"
  comments - these mirror *Node's* own back-compat, not Bun's; excluded per the task.
- libuv / sqlite3 / WebKit `v2` / "backwards compatibility" comments - vendored code.
