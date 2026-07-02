# Bun 2.0 candidates - networking (Bun.listen/connect/udpSocket/dns) and built-in DB/cloud clients

All file paths relative to `/workspace/bun`. All runtime claims were verified against the installed `bun` binary; issue numbers are from `oven-sh/bun`.

### `socket.write()` is unbuffered: partial writes + manual backpressure, no corking

what: `Bun.listen`/`Bun.connect` sockets return a byte count from `write()` and silently drop the rest; there is no built-in write buffering or cork, unlike `node:net` which buffers and returns a boolean.
where: `packages/bun-types/bun.d.ts:5793` (`@returns ... Can return less than the input size if the socket's buffer is full (backpressure)`); `docs/runtime/networking/tcp.mdx:191` ("TCP sockets in Bun do not buffer data, so performance-sensitive code should buffer writes itself") and `tcp.mdx:237` ("Support for corking is planned, but in the meantime backpressure must be managed manually with the `drain` handler"); impl `src/runtime/socket/socket_body.rs:2659-2857` (`write_or_end`).
evidence: Issue #9682 ("only the first ~128kb are sent"). Jarred Sumner's own closing comment: *"While confusing and different from Node, this is working as intended. The docs do state this but need to be made clearer. ... Unlike Node, Bun does not buffer unsent bytes and leaves you to handle backpressure in the `drain` callback."* Docs tell users to hand-roll an `ArrayBufferSink` + `drain` loop. Returning a **byte** count is also unusable when the input is a **string**: the caller has no byte buffer to `subarray(wrote)` without re-encoding to UTF-8 themselves.
why bad: The maintainer's own description of the behavior is "confusing and different from Node". Every correct consumer must re-implement a write buffer + drain state machine; the docs' own workaround is ~12 lines. The string-input case is genuinely unsolvable at the byte level without re-encoding.
bun 2.0 proposal: Either (a) add opt-in kernel corking + a buffered-write mode and make it the default, or (b) change `write()` to Node's `boolean` contract (Bun buffers, `drain` fires when flushed) and expose the zero-copy partial-write variant under a distinct name (`writeSome`). Also ship `socket.cork(cb)` (ws already has `ServerWebSocket.cork`, so the idiom exists in a sibling API).
blast radius: high - `write()`'s return value semantics are load-bearing in every protocol implementation built on `Bun.listen`/`Bun.connect`.
confidence: high.

### `connectError` is a second error channel that the founder already tried to deprecate

what: `Bun.connect`/`Bun.listen` socket handlers have both `error` and `connectError`, and the promise-rejection behavior of `Bun.connect` changes depending on whether `connectError` is supplied.
where: `packages/bun-types/bun.d.ts:6310` (`error?`), `bun.d.ts:6327-6340` (`connectError?`, including "When `connectError` is specified, the rejected promise is not added to the promise rejection queue ... When `connectError` is not specified, the rejected promise is added"); impl `src/runtime/socket/Handlers.rs:34,359` (`on_connect_error`, `"onConnectError"`).
evidence: Issue #4351, **filed by Jarred-Sumner**: *"Deprecate `connectError` ... It's very confusing to have this other error handler. There should only be one error handler."* Opened Aug 2023, closed **NOT_PLANNED** Oct 2025 - i.e. the team wanted the change and could not make it within 1.x.
why bad: Three overlapping error channels (promise rejection, `connectError`, `error`), and the handled/unhandled-rejection status of the promise silently depends on whether an unrelated option is present. The author of the API filed the deprecation request.
bun 2.0 proposal: Exactly what #4351 says: one `error` handler. Always deliver connection failures through the `Bun.connect` rejected promise + `error(socket, err)`; remove `connectError`.
blast radius: medium - only `Bun.connect` clients that rely on the rejection-suppression side effect break.
confidence: high (the maintainer's own issue).

### `Bun.listen({ data: obj })` is shared by reference across ALL accepted sockets

what: The `data` option on `Bun.listen` is documented as "the per-instance data context" but is actually the *same* JS object handed to every accepted socket.
where: `packages/bun-types/bun.d.ts:6363-6366` (`/** The per-instance data context */ data?: Data;` inside `SocketOptions`, inherited by `TCPSocketListenOptions`); impl `src/runtime/socket/Listener.rs:575-577` and `619-622` - each new accepted socket gets `listener.strong_data.get()` via `data_set_cached(...)`.
evidence: Issue #25357 "TCP Socket context data is unexpectedly shared among all sockets" (open). Verified empirically: two connections to a `Bun.listen({ data: { n: 0 } })` server observe `seen[0] === seen[1] === true` and `n === 2`.
why bad: The JSDoc and the docs example (`tcp.mdx:48` "Attach contextual data to a socket in the `open` handler") together make this the first thing every user tries, and it silently produces cross-connection state leakage (i.e., one user's session data leaking into another's) - the worst failure mode for a server. The handler-object-plus-`socket.data` design (`tcp.mdx:26-46`, "An API designed for speed") was explicitly chosen over per-socket EventEmitters for GC pressure, and `socket.data` is the only escape hatch it offers, so the default value of that one hatch being a shared singleton is the design's core footgun.
bun 2.0 proposal: Make the listener-level `data` a *factory* (`data: () => T` or `data(socket)`), or throw when a non-primitive `data` is passed to `Bun.listen`. At minimum, fix the "per-instance" JSDoc. Consider also allowing `Bun.listen`'s `open(socket)` to return the data value.
blast radius: low - nobody depends on accidental sharing; a factory is a superset.
confidence: high.

### `Bun.dns` is an undeclared, undocumented, incomplete duplicate of `node:dns` - and its one declared method disagrees with Node's

what: `Bun.dns` at runtime carries 18 properties that clone `node:dns` (`resolve`, `resolveSrv`, `resolveTxt`, `resolveSoa`, `resolveNaptr`, `resolveMx`, `resolveCaa`, `resolveNs`, `resolvePtr`, `resolveCname`, `resolveAny`, `getServers`, `setServers`, `reverse`, `lookupService`, `lookup`, `prefetch`, `getCacheStats`), but the `.d.ts` declares only 3 and the docs document only 2; `Bun.dns.lookup` shares a name with `node:dns.lookup` but returns a different shape; and `resolve4`/`resolve6` are simply missing.
where: runtime surface built in `src/jsc/bindings/BunObject.cpp:394-442` (`constructDNSObject`); type surface `packages/bun-types/bun.d.ts:1921-2052` (only `lookup`, `prefetch`, `getCacheStats`, `ADDRCONFIG`, `ALL`, `V4MAPPED`); docs `docs/runtime/networking/dns.mdx` (documents only `prefetch` and `getCacheStats`, both under a `<Warning>` "experimental and may change", and steers users to `node:dns` for resolving: "Bun implements its own `dns` module and the `node:dns` module").
evidence: Verified empirically: `Object.keys(Bun.dns)` = 21 entries; `Bun.dns.resolve4 === undefined`; `Bun.dns.resolve !== require("node:dns/promises").resolve` (a second implementation, not a re-export). `await Bun.dns.lookup("localhost")` → `[{address,family,ttl}, ...]` (array), vs `await require("node:dns/promises").lookup("localhost")` → `{address,family}` (single object) - same name, different contract. `bun.d.ts:2016,2035` mark `prefetch`/`getCacheStats` `**Experimental API**`. `bun.d.ts:1981-1983` on the `backend` option: *"Defaults to `c-ares` on Linux ... This default may change in a future version of Bun if c-ares is not reliable enough."* The original RFC #2069 (colinhacks) proposed a *different*, cleaner surface (`dns.a()`, `dns.aaaa()`, TTL-bearing records), which was not what shipped; a commenter on #2069 (RiskyMH) noticed the shipped surface is "very similar to `node:dns`". Also open: #24970 "Bun DNS lookup not working for c-ares provider".
why bad: The only genuinely Bun-specific value is `prefetch` + `getCacheStats`. The other 16 entries are an unmaintained, partial, untyped, undocumented second copy of `node:dns` living on the `Bun` global - pure maintenance liability that the team has stopped documenting. And the one collision (`lookup`) actively teaches the wrong contract.
bun 2.0 proposal: Shrink `Bun.dns` to `{ prefetch, getCacheStats }` (the Bun-specific cache API); delete the untyped `resolve*`/`reverse`/`lookupService`/`getServers`/`setServers` duplicates and point people at `node:dns`. If `lookup` is kept, rename it (`lookupAll`) or match Node's single-object return.
blast radius: low for the undocumented/untyped entries (no one can be using them in typed code); medium for `Bun.dns.lookup`'s return shape.
confidence: high.

### Built-in DB/cloud clients on the `Bun` global: release-coupled API surface with no escape hatch

what: `Bun.sql`/`Bun.SQL`/`Bun.postgres`, `Bun.s3`/`Bun.S3Client`, `Bun.redis`/`Bun.RedisClient` are full database/cloud drivers baked into the runtime binary and exposed as flat properties of the `Bun` global, so every missing protocol feature or provider header is blocked on a Bun release, and there is no way to version or replace them independently.
where: `src/jsc/bindings/BunObject.cpp:943-944` (`S3Client`, `s3`), `:1001-1003` (`sql`, `postgres`, `SQL`), `:1023-1024` (`RedisClient`, `redis`); type surfaces `packages/bun-types/{sql.d.ts,s3.d.ts,redis.d.ts}` (953 + 1488 + 3320 lines).
evidence: Version-coupling issues that are pure "the built-in is missing an option" and stay open for a year+: #16048 "Allow for custom S3 headers/query params" (open since 2024-12-29), #18240 (presign `contentLength`), #18016 (`ResponseCacheControl`), #16667 (presigned POST), #23809 (Object Lock params), #22799 (SQL named params), #23175 (SQL AbortSignal cancel), #30843 (MySQL `CLIENT_FOUND_ROWS`). 53 issues have `Bun.sql`/`Bun.SQL` in the title; 30 are open. The flat-namespace concern was raised in #4786 (2023); a Bun team member (Electroid) replied *"We do this in some cases, for instance, `Bun.dns`. When we introduce new APIs, we'll consider this."* - then `sql`, `SQL`, `postgres`, `s3`, `S3Client`, `redis`, `RedisClient`, `secrets` all shipped flat anyway. The three pairs also use three different naming conventions: `sql`/`SQL`, `s3`/`S3Client`, `redis`/`RedisClient`.
why bad: An npm database client can ship a patch the day S3 adds a header; a built-in client can't, and users can't pin or fork it. Meanwhile the `Bun` namespace now freezes 6 top-level DB/cloud names forever. The inconsistent naming shows the pattern was accreted, not designed.
bun 2.0 proposal: Move the clients behind module specifiers (`bun:sql`, `bun:s3`, `bun:redis`), matching the existing `bun:sqlite` precedent. Keep `Bun.sql` etc. as deprecated re-exports for one major. Pick ONE default-instance/class naming convention. Add an explicit escape hatch (arbitrary headers/params) to `S3Client` so gaps aren't release-blocking.
blast radius: medium - imports change, but behavior doesn't; a codemod covers it.
confidence: medium (the value judgement is debatable; the version-coupling evidence is solid).

### `Bun.postgres` is already a dead alias of `Bun.sql`

what: `Bun.postgres` and `Bun.sql` are literally the same object; `Bun.postgres` has been `@deprecated` since introduction.
where: `src/jsc/bindings/BunObject.cpp:1001-1002` - both `sql` and `postgres` map to `defaultBunSQLObject`. `packages/bun-types/sql.d.ts:941-946`: `/** SQL client for PostgreSQL * @deprecated Prefer {@link Bun.sql} */ const postgres: SQL;`.
evidence: `bun -e 'console.log(Bun.postgres === Bun.sql)'` → `true`. The name is also now actively misleading: `Bun.SQL` supports `postgres`, `mysql`, `mariadb`, AND `sqlite` adapters, so `Bun.postgres` can be a MySQL client if `DATABASE_URL=mysql://...`.
why bad: A deprecated alias kept on a global it can never leave without a major. Its name contradicts what it does.
bun 2.0 proposal: Remove `Bun.postgres`.
blast radius: low - it's been `@deprecated` in the types.
confidence: high.

### `Bun.SQL.Options` shipped with 10 `@deprecated` aliases and 4 spellings of connection-timeout

what: The `Bun.SQL` options object carries a parallel snake_case / abbreviated alias for nearly every field - `host`/`hostname`, `user`/`username`, `pass`/`password`, `db`/`database`, `idle_timeout`/`idleTimeout`, `connection_timeout`/`connect_timeout`/`connectTimeout`/`connectionTimeout`, `max_lifetime`/`maxLifetime`, `ssl`/`tls` - and every alias is already `@deprecated` in the types.
where: `packages/bun-types/sql.d.ts:200-337` (each alias has `@deprecated Prefer {@link X}`).
evidence: Direct quotes: `sql.d.ts:208` `@deprecated Prefer {@link hostname}`; `:233` `@deprecated Prefer {@link username}`; `:246` `@deprecated Prefer {@link password}`; `:259` `@deprecated Prefer {@link database}`; `:278` `@deprecated Prefer {@link idleTimeout}`; `:291,:299,:307` three aliases all `@deprecated Prefer {@link connectionTimeout}`; `:320` `@deprecated Prefer {@link maxLifetime}`; `:333` `@deprecated Prefer {@link tls}`. The aliases exist to mimic the `postgres` (postgres.js) npm package's option names, yet #18866 ("Bun.SQL result has properties missing compared to Postgres.js") shows the compat goal was not actually met. Related: commit `e63608fced` "Fix: Make SQL connection string parsing more sensible ... **without breaking the default fallback of postgres**" - a fix already constrained by back-compat.
why bad: Ten option names that were obsolete the day the API shipped, including four ways to spell one timeout. Every new user reads a 2x-sized option surface; every alias is a permanent conflict source (`{host, hostname}` both set - which wins?).
bun 2.0 proposal: Remove the snake_case and abbreviated aliases; keep only `hostname`, `username`, `password`, `database`, `idleTimeout`, `connectionTimeout`, `maxLifetime`, `tls`.
blast radius: medium - postgres.js users migrating by copy-paste will hit it, but a clear error message fixes it in seconds.
confidence: high.

### `Bun.RedisClient` is a renamed Valkey client that is compatible with no existing Redis library

what: The public name is `RedisClient`/`Bun.redis`, but the implementation is named Valkey throughout, the *default URL scheme* it synthesizes is `valkey://`, the types document the env-var precedence in the wrong order, and the API shape matches neither `ioredis` nor `node-redis` nor `EventEmitter` - so the entire Redis ecosystem (BullMQ, `@fastify/redis`, connect-redis, ...) can't use it.
where: impl dir `src/runtime/valkey_jsc/` (all files named `valkey*`); exposure `src/jsc/bindings/BunObject.cpp:1023-1024` (`RedisClient → BunObject_lazyPropCb_wrap_ValkeyClient`, `redis → ..._valkey`); default URL `src/runtime/valkey_jsc/js_valkey.rs:491-493` (`env.get(b"REDIS_URL").or_else(|| env.get(b"VALKEY_URL"))`, fallback `b"valkey://localhost:6379"`); events as DOM-style properties `packages/bun-types/redis.d.ts:83,90` (`onconnect`, `onclose`).
evidence: Types/docs disagree with the code on precedence: `redis.d.ts:57-58` and `:3315-3316` list `VALKEY_URL` *first*, code checks `REDIS_URL` first, `docs/runtime/redis.mdx` also says the default is `"redis://localhost:6379"` while the code says `valkey://`. Ecosystem-compat meta-issue #23630 (open): *"`Bun.redis` is a `node-redis` replacement, and not `IORedis` ... Multiple ecosystems use `IORedis` and that currently precludes many possible `Bun.redis` implementations"* - resolves #23465, #23629 (BullMQ), #23626 (@fastify/redis). Also note Bun is the only API family using `onconnect =` property-style events here: `Bun.listen` uses a handler object, `Bun.SQL` uses `onconnect` *options*, `RedisClient` uses `onconnect` *instance properties*, and every `node:*` module uses `.on()` - four idioms across sibling APIs.
why bad: The branding churn (Valkey → Redis) is baked into the filesystem, the default URL scheme, and three contradictory docs. More importantly: a built-in Redis client that no Redis-ecosystem library can target delivers most of its value only to greenfield code.
bun 2.0 proposal: Pick one name and finish the rename (including the default URL scheme and the documented env precedence). Make `RedisClient` extend `EventEmitter` (or `EventTarget`) so `onconnect`/`onclose` aren't a fourth callback idiom. Track #23630: either ship an `ioredis`-shaped adapter or document `Bun.redis` as explicitly not a drop-in.
blast radius: low-medium - `onconnect` assignment can keep working alongside `.on("connect")`; the env/URL fix only affects the undocumented fallback.
confidence: high for the naming/doc contradictions (read from source); medium for the "should be ioredis-compatible" judgment.

### Two first-party SQLite APIs: `bun:sqlite` and `Bun.SQL({ adapter: "sqlite" })`

what: Bun ships a synchronous SQLite client (`bun:sqlite` → `Database`, `Statement`) *and* a second, async tagged-template SQLite client inside `Bun.SQL`; the second one's option type literally extends the first's, several `SQL` methods throw on the sqlite adapter, and its default filename is `":memory:"`.
where: `packages/bun-types/sqlite.d.ts:26,117` (`declare module "bun:sqlite"`, `class Database`); `packages/bun-types/sql.d.ts:1` (`import type * as BunSQLite from "bun:sqlite"`), `:169-171` (`interface SQLiteOptions extends BunSQLite.DatabaseOptions { adapter?: "sqlite"; ... }`), `:183-185` (`@default ":memory:"`), `:613,:628,:674` (`@throws {Error} If the adapter does not support distributed transactions (e.g., SQLite)` / `...does not support flushing (e.g., SQLite)`); commit `784271f85e` "SQLite in Bun.sql (#21640)".
evidence: Verbatim from the types above. `SQL.Options = SQLiteOptions | PostgresOrMySQLOptions` (`sql.d.ts:413`) - one class, two adapter families with different capabilities and throwing method subsets. `new SQL({ adapter: "sqlite" })` with no filename silently creates a **non-persistent in-memory database**.
why bad: Duplicate first-party API for the same engine, with the generic one degraded (methods that throw, a union options type). A bare `":memory:"` default means a typo'd `filename` key silently discards all writes.
bun 2.0 proposal: Either make `Bun.SQL({adapter:"sqlite"})` a thin façade documented as "prefer `bun:sqlite`", or fold `bun:sqlite`'s sync API into `Bun.SQL` and deprecate the module. Make `filename` **required** for the sqlite adapter (or require an explicit `":memory:"`). Replace the throwing `flush`/`commitDistributed`/`rollbackDistributed` with adapter-specific subtypes so unsupported methods don't exist on the sqlite type.
blast radius: medium - `bun:sqlite` is widely used; the Bun.SQL-sqlite path is newer.
confidence: high for the duplication and `:memory:` default; medium on the right resolution.

### `Bun.udpSocket().sendMany()` takes a flat interleaved `[data, port, addr, data, port, addr, ...]` array

what: For unconnected UDP sockets, `sendMany` batches datagrams by encoding each one as three consecutive elements of one flat array.
where: `packages/bun-types/bun.d.ts:6646` - `sendMany(packets: readonly (Data | string | number)[]): number;`; `docs/runtime/networking/udp.mdx:86-94` - *"Each set of three array elements describes a packet: the data to send, the target port, and the target address"*, example `socket.sendMany(["Hello", 41234, "127.0.0.1", "foo", 53, "1.1.1.1"])`.
evidence: The declared type `readonly (Data | string | number)[]` provides zero safety - `sendMany(["hello"])` and `sendMany(["hello", "127.0.0.1", 41234])` (transposed) both type-check. One missing element silently shifts the meaning of every subsequent element. Contrast the *connected* overload at `bun.d.ts:6640`, which is a plain array of payloads - so the same method name has two incompatible calling conventions selected by how the socket was created.
why bad: This is a hand-rolled struct-of-positionals encoding that TypeScript cannot model; an off-by-one corrupts every packet after it. No sibling Bun API uses this pattern.
bun 2.0 proposal: `sendMany(packets: Array<{ data, port, address }>)` (or `Array<[data, port, address]>` tuples) for unconnected sockets. Keep the flat form as a deprecated overload or drop it.
blast radius: low - `sendMany` is a niche perf API and the docs example is trivially mechanical to migrate.
confidence: high.

### `socket.readyState` is a numeric enum whose documentation literally says `2` = "Else"

what: `Socket.readyState` returns `-2 | -1 | 0 | 1 | 2`, where `2` is documented as "Else", and after a normal close the observable value is `-1` ("Detached"), never `0` ("Closed").
where: `packages/bun-types/bun.d.ts:5901-5911` - `* - \`-2\` = Shutdown  * - \`-1\` = Detached  * - \`0\` = Closed  * - \`1\` = Established  * - \`2\` = Else`; impl `src/runtime/socket/socket_body.rs:2130-2143` - an if/else chain whose final `else` returns `2`.
evidence: Issue #9577 (closed): *"socket.readyState ... typed as `"open" | "closed" | "closing"` but returns `-1 | 1`"* - the types and runtime disagreed for over a year, and were reconciled by changing the types to the numbers, not by fixing the enum. Verified empirically: `readyState` is `1` after `Bun.connect` resolves and `-1` immediately after `end()` (not `0`). Node's `net.Socket.readyState` is `"opening" | "open" | "readOnly" | "writeOnly" | "closed"`.
why bad: "Else" is an implementation detail leaked into a public contract. Users cannot distinguish Closed from Detached meaningfully, and the one state most want (`"closed"`) is effectively unreachable. Magic negative numbers with a catch-all are the opposite of a designed enum.
bun 2.0 proposal: Switch to string states (`"connecting" | "open" | "halfClosed" | "closed"`). Keep the numbers behind a documented mapping for one major if needed.
blast radius: low-medium - few people branch on `readyState === 2`; anyone branching on `-1` vs `0` is already broken.
confidence: high.

### `socket.reload()` shape: docs, types, and runtime have never agreed

what: Whether `reload()` takes a bare handler object or `{ socket: handlers }` has flip-flopped between the types, the runtime, and the docs; the docs are wrong *today*.
where: `packages/bun-types/bun.d.ts:5936` `reload(options: Pick<SocketOptions<Data>, "socket">): void` (so `{socket: ...}`); `docs/runtime/networking/tcp.mdx:178-182` shows `socket.reload({ data() { ... } })` - the bare form.
evidence: Issue #26290 (closed): *"✅ TypeScript accepts `socket.reload({ data(...){} })` / ❌ Runtime throws: Expected \"socket\" option"*. Verified empirically today: `socket.reload({data(){}})` → `error: Expected "socket" option`; `listener.reload({data(){}})` → `error: Expected "socket" object` (note the two runtime paths even spell the error differently); both `{socket:{...}}` forms succeed. The tcp.mdx example still shows the form that throws.
why bad: Three surfaces (docs, `.d.ts`, runtime) for one 1-argument method have been mutually inconsistent across releases. The extra `{socket:}` wrapper exists only so the argument matches the constructor options bag - it carries no information.
bun 2.0 proposal: Accept a bare `SocketHandler` (`reload(handlers)`), which is what the docs already teach; keep `{socket}` accepted for compat. Unify the two error messages. Fix `tcp.mdx:178`.
blast radius: low - additive.
confidence: high.

### `Bun.listen`/`Bun.connect` reject any socket that has no `data` or `drain` handler

what: Creating a listener or client whose handler object only has `open`/`close`/`error` throws.
where: `src/runtime/socket/Handlers.rs:368-372` - `if result.on_data.is_empty() && result.on_writable.is_empty() { return Err(... "Expected at least \"data\" or \"drain\" callback") }`.
evidence: Verified empirically: `Bun.listen({..., socket:{open(s){}}})` → `error: Expected at least "data" or "drain" callback`.
why bad: A write-only server (accept, push bytes, close) or an accept-and-hand-off listener is a completely legitimate program; requiring a `data` handler to create one is an arbitrary constraint from the internals (the handler-object dispatch wants at least one uWS read callback). Users work around it with `data(){}`, which is pure noise.
bun 2.0 proposal: Remove the check; default to a no-op `data`.
blast radius: low - strictly permissive.
confidence: high.

### `Socket` has five closing methods and two contradictory `end()` overloads

what: A `Bun.Socket` exposes `end()`, `close()`, `terminate()`, `shutdown()`, and `[Symbol.dispose]()`; the listener adds a sixth name, `stop()`. `end()` is declared twice with incompatible return types and contradictory docs.
where: `packages/bun-types/bun.d.ts:5828-5850` - first overload: `end(data?, byteOffset?, byteLength?): number` "initiates a **graceful** shutdown of the socket's write side"; second overload: `end(): void` documented as *"Close the socket **immediately**"*. `bun.d.ts:6245-6253` - `close(): void` "This is a wrapper around `end()` and `shutdown()`"; `:5879` `terminate()`; `:5898` `shutdown(halfClose?)`; `:6199` `[Symbol.dispose]()` "Alias for `socket.end()`"; `:6277` `SocketListener.stop(closeActiveConnections?)`.
evidence: Verbatim quotes above. TypeScript resolves `socket.end()` to the *first* overload (`data?` is optional), so the `end(): void` overload is unreachable dead surface with a false doc. `close()` duplicating "end + shutdown" means there are two spellings of "gracefully close".
why bad: Five (six) names for "stop this thing", one dead overload, and two doc comments for `end()` that contradict each other. Nobody can tell `close()` from `end()` from `shutdown(false)` from the types.
bun 2.0 proposal: Keep `end(data?)` (graceful), `terminate()` (abrupt), and `[Symbol.dispose]` (alias of `end`). Remove `close()` (redundant) and the dead `end(): void` overload. Fold `shutdown(true)` into `end()` / `allowHalfOpen`. Rename `SocketListener.stop()` to `close()` to match `Bun.serve`'s `server.stop()` removal lineage - or at minimum, pick one verb.
blast radius: low for the type cleanup; medium if `close()` is removed.
confidence: high for the overload contradiction (verbatim); medium for the consolidation.

### Non-standard `s3://` protocol and `{ s3: ... }` option bolted onto WHATWG `fetch()` and `Bun.file()`

what: The global `fetch()` accepts `s3://` URLs and a non-standard `s3: S3Options` init option, and `Bun.file("s3://...")` silently returns a network-backed object that the declared return type can't describe.
where: `packages/bun-types/globals.d.ts:1981-1995` - `BunFetchRequestInit.s3?: Bun.S3Options` with example `fetch("s3://bucket/key", { s3: {...} })`; `docs/runtime/s3.mdx:845-851` - *"`fetch` and `Bun.file()` support the `s3://` protocol"*; `packages/bun-types/bun.d.ts:4109-4111` - `Bun.file(path: string | URL, ...): BunFile` with `@param` "If the path starts with `s3://`, the file behaves like {@link S3File}".
evidence: Verified empirically: `Bun.file("s3://b/k")` returns an object with `presign`, `delete`, `stat` functions (an `S3File`) but its static type is `BunFile`, which declares none of them - users must cast. The sibling `verbose` option at `globals.d.ts:1931-1934` already carries the admission *"This API may be removed in a future version of Bun without notice. Not part of the Fetch API specification."* The `s3` option interface itself notes (`globals.d.ts:1918-1923`) that these extensions "don't work when passed to `new Request()`" - so `fetch(url, init)` and `fetch(new Request(url, init))` diverge.
why bad: This is the "non-standard additions bolted onto standard globals" signal exactly. It makes `fetch` non-polyfillable, makes `fetch(req)` and `fetch(url, init)` behave differently, and it creates a dynamic return type (`BunFile` vs `S3File`) that the type system cannot model - a prefix of a *string argument* changes the result's class.
bun 2.0 proposal: Keep `S3Client`/`S3File` as the primary API and make `Bun.s3.file()` the blessed entry point. Remove `s3://` handling from global `fetch` (or gate it behind an explicit opt-in). Have `Bun.file()` throw on `s3://` and point at `Bun.s3.file()`, so the declared type is honest.
blast radius: medium - `fetch("s3://...")` and `Bun.file("s3://...")` are documented and in the wild.
confidence: high for the facts; medium for the proposal (the team clearly likes this feature).

### Legacy TLS / S3 / socket option aliases already marked deprecated

what: Several options in this area carry `@deprecated` aliases that exist only for older-Bun or sibling-library compatibility.
where / evidence:
- `packages/bun-types/deprecated.d.ts:126-151` - `TLSOptions.keyFile` / `certFile` / `caFile`: *"@deprecated since v0.6.3 - Use `key: Bun.file(path)` instead"*. Deprecated for the entire lifetime of 1.x, still shipped. (These feed `Bun.listen({tls})` / `Bun.connect({tls})`.)
- `packages/bun-types/s3.d.ts:407-410` - `S3Options.highWaterMark`: *"@deprecated ... Use `partSize` and `queueSize` instead."*
- `packages/bun-types/s3.d.ts:793-801` - `S3File.unlink` is an alias of `S3File.delete` ("matching the Node.js `fs` API naming"); `S3Client` likewise has both `unlink` and `delete`.
- `src/runtime/socket/SocketConfig.bindv2.ts:61-64` - `hostname` has `altNames: ["host"]` in `Bun.listen`/`Bun.connect`.
- `packages/bun-types/bun.d.ts:6441-6454` - `TCPSocketConnectOptions` carries `exclusive`, `reusePort`, `ipv6Only` (bind-side flags that are meaningless for a *client* `connect`), because listen and connect share one bindgen options dict (`SocketConfig.bindv2.ts:44-87`).
why bad: These are exactly "aliases kept only for compatibility with an older Bun" / "options that leaked from a sibling". None carries information.
bun 2.0 proposal: Delete `keyFile`/`certFile`/`caFile`, `highWaterMark`, the `host` alt-name, and one of `unlink`/`delete`. Split `TCPSocketListenOptions` from `TCPSocketConnectOptions` so `reusePort`/`ipv6Only`/`exclusive` don't appear on `connect`.
blast radius: low - all already marked deprecated or undocumented.
confidence: high (every item is a verbatim quote).
