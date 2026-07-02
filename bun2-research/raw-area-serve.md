# Bun 2.0 candidates: Bun.serve / HTTP server

All file paths are relative to `/workspace/bun`. All issue numbers are `oven-sh/bun`.

### HTTP `idleTimeout` defaults to 10s and silently kills in-flight handlers / SSE

what: `Bun.serve`'s connection `idleTimeout` defaults to 10 seconds and counts a request as "idle" while the user's handler is still running, so any handler slower than 10s (or a quiet SSE/streaming response) gets its connection reset; it is also stored in a `u8`, capping it at 255s.
where: `packages/bun-types/serve.d.ts:809` (`@default 10`); `src/runtime/server/ServerConfig.rs:25,75` (`pub idle_timeout: u8, // TODO: should we match websocket default idleTimeout of 120?`, `idle_timeout: 10`); `src/runtime/server/ServerConfig.rs:1133-1139` (throws `"Bun.serve expects idleTimeout to be 255 or less"`); `docs/runtime/http/server.mdx:215-236`.
evidence: Source comment is a literal regret: `// TODO: should we match websocket default idleTimeout of 120?` (ServerConfig.rs:25). The docs themselves ship a warning box: "A connection is idle when no data is being sent or received, **including in-flight requests where your handler is still running**... Browsers and `fetch()` clients see this as a connection reset" and "If your stream goes quiet for longer than `idleTimeout`, Bun closes the connection mid-response" (server.mdx:217,232-236). #13712 "Bun.serve() silently drops connection after 10 seconds" (an `await Bun.sleep(15000)` handler → `curl: (52) Empty reply`). #13811 "server sent events changed in bun v1.1.27 and 1.1.26" is tagged **`regression`** - the 10s default shipped in a 1.1.x patch release and immediately broke working SSE code ("In bun v1.1.25 (and before) everything works as expected. Starting in 1.1.26 I get disconnected after 8 seconds"). #15589 + #27470: "Bun.serve hard-caps idleTimeout at 255 seconds".
why bad: A default timeout that fires *during the user's own handler* is a footgun no other runtime has (Node's `server.timeout` default is 0 = disabled; `requestTimeout`/`headersTimeout` apply to receiving, not to the handler running). The 10s value is short enough to bite ordinary apps, the `u8` cap is an arbitrary implementation detail leaked into the API, and the same option name means something different for WebSockets (see below).
bun 2.0 proposal: Default to `0` (disabled) or at minimum stop the idle clock once the handler has been invoked and the full request body is read; widen the field past `u8` and drop the 255 cap; make `idleTimeout: 0` the documented opt-out rather than `server.timeout(req, 0)` per-request.
blast radius: high - changes the default lifecycle of every `Bun.serve` connection; slow-loris protection would need a separate, correctly-scoped knob.
confidence: high.

### `development: false` silently turns on `reusePort` (contradicting the documented default)

what: Explicitly passing `development: false` (but not `reusePort`) silently sets `reusePort: true`, so two servers binding the same port do not get `EADDRINUSE` - they silently `SO_REUSEPORT` load-balance; the type docs say `reusePort` `@default false` and no doc mentions the coupling.
where: `src/runtime/server/ServerConfig.rs:816` - `args.reuse_port = args.development == DevelopmentOption::Production;` (runs whenever the `development` key is present, before the explicit `reusePort` key is parsed at :1272). `packages/bun-types/serve.d.ts:780` (`@default false`). Also `ServerConfig.rs:727-729`: `reuse_port` additionally defaults to `true` whenever `NODE_UNIQUE_ID` is set (node:cluster child) - also undocumented.
evidence: Jarred Sumner on #1443 ("No error is thrown when port is taken"): "Originally, `reusePort: true` did not exist, it was implicitly the default behavior (i.e. no option), which means we did not throw an error when the port was already in use. **This is very confusing in development**, but in production this feature is important. So we added `reusePort: true` to make this behavior explicit". Line 816 is the residue: the old "confusing" default survives whenever a user writes `development: false`. `docs/guides/http/cluster.mdx` and `serve.d.ts` never mention it; `rg -n reusePort docs/` confirms.
why bad: An unrelated, debugging-oriented option (`development`) silently changes a socket-level flag (`SO_REUSEPORT`), which removes the `EADDRINUSE` safety net in exactly the configuration people use in production. The type declaration (`@default false`) is factually wrong for this path.
bun 2.0 proposal: Delete line 816. `reusePort` should default to `false` unconditionally (keep the `NODE_UNIQUE_ID` case, which is scoped to node:cluster, or document it). If starting two servers on the same port is desired, require `reusePort: true`.
blast radius: low - almost nobody *relies* on `development: false` implying `SO_REUSEPORT`; the few who do get a clear `EADDRINUSE` and a one-line fix.
confidence: high.

### The `error` handler receives only the error - no `Request`

what: `error(error)` gets a single argument; there is no way to see which URL/headers/method caused the failure, so error reporting, per-route error pages, and structured logging are all impossible from the documented handler.
where: `packages/bun-types/serve.d.ts:728` - `error?: (this: Server<WebSocketData>, error: ErrorLike) => Response | Promise<Response> | void | Promise<void>`. `src/runtime/server/RequestContext.rs:3392-3398` - `on_error.get().call(global, server_js_value, &[value])` (one argument).
evidence: #15475 "get data from request in Bun.serve Error handler" (open, `enhancement`), where Jarred says: "careful with the PR, it might be difficult to do consistently because **it's easy to free the request object too early. That was the main reason we didn't do this**... But I don't think we actually tried. so might be imagining it to be harder than it is". #33137 "error() returning a deferred Promise<undefined> swallows the original error and responds 204" shows the `Response | void | Promise<void>` union is itself a footgun.
why bad: Every comparable API passes the request context to the error hook (Express `(err, req, res, next)`, Fastify `setErrorHandler(err, request, reply)`, Hono `onError(err, c)`). The current signature was shaped by an internal lifetime constraint, not by design. It is also asymmetric with its sibling - `fetch` gets `(req, server)`, `error` gets neither as an argument (only `this`), so the near-universal arrow-function style loses access to the server entirely.
bun 2.0 proposal: `error(error, request, server)`. Adding parameters is almost non-breaking; the 2.0-sized part is tightening the return type to `Response | Promise<Response> | undefined` and defining `undefined` precisely (fall through to the default page), fixing #33137's 204 class of bug.
blast radius: low - adding trailing parameters breaks nobody; tightening the return union may surface latent bugs like #33137 but that's the point.
confidence: high.

### `server.upgrade()` unconditionally echoes the client's `Sec-WebSocket-Protocol` - RFC 6455 violation

what: If the client offers any subprotocols, Bun copies the request's entire `Sec-WebSocket-Protocol` header into the 101 response; there is no way to select one or to omit it, which RFC 6455 §4.2.2 requires.
where: `src/runtime/server/server_body.rs:1945-1948` and `:1970-1973` (the *request's* `sec-websocket-protocol` is read into `sec_websocket_protocol`) → `:2130-2137` (`resp.upgrade(ws, key, proto_str.slice(), ext_str.slice(), …)` writes it back). The only override is to pass a replacement value in `upgrade(req, { headers })` (`:2055-2059`) - there is no way to pass "none".
evidence: #18243 (open, `bug`, `bun:serve`): "There is currently no way to prevent the server from accepting a WebSocket sub-protocol... The server should be able to specify which sub-protocol to accept or to omit the header", citing https://datatracker.ietf.org/doc/html/rfc6455#section-4.2.2. #26038 "WebSocket server auto-echoes first offered subprotocol instead of requiring explicit selection" (closed). #25773 "upgrade() with Sec-WebSocket-Protocol header fails with 'Mismatch client protocol'" (closed) - browsers reject the echoed list when they offered more than one.
why bad: It is a spec violation with no upside: a server that hasn't implemented any subprotocol will still "accept" whatever a client asked for, and a client offering multiple protocols gets a malformed response. `uWebSockets.js`, `ws`, and Deno all require the app to select.
bun 2.0 proposal: Never echo by default. Add `server.upgrade(req, { protocol: "chat" })` (or `protocol: null`) as the one explicit way to set it; keep reading an explicit `Sec-WebSocket-Protocol` in `options.headers` for back-compat but stop deriving it from the request.
blast radius: medium - code that works today by accident (single-protocol clients) keeps working; code that relies on the echo to "accept" would need the one-line `protocol:` option.
confidence: high.

### `websocket.error` exists at runtime and in the prose docs but not in the types - and has the wrong signature

what: The runtime parses a `websocket.error(error)` callback (invoked when another websocket handler throws), the docs list it as one of the handlers, but `WebSocketHandler<T>` in `serve.d.ts` has no `error` field; when it *is* invoked it receives only `(error)` with `this = undefined` and no `ws`, unlike every sibling handler.
where: parsed at `src/runtime/server/WebSocketServerContext.rs:129-137` (`("error", &mut handler.on_error)`); invoked at `WebSocketServerContext.rs:90-94` - `on_error.call(global_object, JSValue::UNDEFINED, &[error_value])`; documented at `docs/runtime/http/websockets.mdx:60` ("methods for `open`, `message`, `close`, `drain`, and `error`"); absent from the `WebSocketHandler<T>` interface at `packages/bun-types/serve.d.ts:383-517` (verified by grep: no `error` key).
evidence: The three-way runtime/docs/types mismatch above is the evidence; also `docs/runtime/http/websockets.mdx:119` shows `websocket: {}, // handlers`, which the runtime *rejects* (`WebSocketServerContext.rs:160`: `"WebSocketServerContext expects a message handler"`), so the reference doc for this object is already out of sync with the implementation.
why bad: A user who types `websocket: { error(e) {} }` in TypeScript gets an excess-property error for a feature that works and is documented. And even if they use it, they cannot tell *which socket* errored, because the one handler that most needs `ws` is the one that doesn't get it.
bun 2.0 proposal: Add `error?(ws: ServerWebSocket<T>, error: unknown)` to the type and pass `ws` first like every other handler; or, if it's meant to be internal, remove the key from the parser and the docs.
blast radius: low - additive types plus a new leading parameter; the existing 1-arg form would still destructure correctly if `error` is appended instead.
confidence: high.

### `server.requestIP(req)` is a pointer-chasing lookup that returns `null` after any `await`

what: `requestIP` resolves the IP by dereferencing the live uWS request context stored inside the `Request`; once the connection is torn down (or the context is recycled) it returns `null`, so calling it after an `await` - the normal place to log - frequently yields `null` for no documented reason.
where: `src/runtime/server/server_body.rs:1593-1606` - `request.request_context.get_remote_socket_info()` else `NULL`. The d.ts (`serve.d.ts:1044-1055`) documents only "closed or is a unix socket" as the `null` cases.
evidence: #11756 "`requestIP` returns `null` after async call" (closed bug), #6613 "cannot access ip address after async" (closed bug), #22969 "server.requestIP() sometimes returns null" (closed bug) - three separate reports of the same lifecycle design over two years.
why bad: The API shape (a late-bound lookup keyed on Request identity) is the bug; every "fix" has been a band-aid. The information is known at accept time and is cheap to capture. It also forces the `server` object into every layer that wants an IP, whereas Node (`req.socket.remoteAddress`) and Deno (`info.remoteAddr`) deliver it with the request.
bun 2.0 proposal: Capture the remote address eagerly on the `Request` (or `BunRequest`) as a lazily-materialized own property so it survives the connection; keep `server.requestIP()` as a thin wrapper. Define exactly when it is `null` (unix socket only).
blast radius: low - strictly more calls succeed; the only cost is a few bytes per request.
confidence: high.

### `export default { fetch }` implicit-serve is a duck-typing heuristic that doesn't know about `routes`

what: `bun run file.ts` auto-starts a server if the module's default export passes `def && def !== globalThis && (typeof def.fetch === 'function' || def.app != undefined) && typeof def.stop !== 'function'` - a shape test that (a) fires on any unrelated object with a `fetch` method, and (b) does **not** fire for a `routes`-only config, the form Bun itself has recommended since 1.2.3.
where: `src/bundler/entry_points.rs:287-288` and `:325-326` (`isServerConfig`, generated into the `bun:main` wrapper). `rg routes src/bundler/entry_points.rs` → 0 hits.
evidence: The two negative clauses are themselves the evidence of a fragile heuristic: `!== globalThis` exists because `globalThis.fetch` is a function, and `typeof def.stop !== 'function'` exists to avoid re-serving a `Server` instance (which has `.stop`). The positive `def.app != undefined` branch references an option the maintainers have already disowned: `src/runtime/server/ServerConfig.rs:1255`: `// "app" is likely to be removed in favor of the HTML loader.` Meanwhile `export default { routes: { "/": () => new Response("hi") } }` - valid per `Bun.serve` since 1.2.3 - is silently not served.
why bad: Implicitly starting a network listener based on the structural shape of a default export is surprising (any library object with a `fetch()` method qualifies), and the heuristic has already drifted out of sync with `Bun.serve`'s own accepted config. Two more negative patches away from being unmaintainable.
bun 2.0 proposal: Either (a) key the implicit-serve path on a single unambiguous signal - a `Symbol` brand, or `export default Bun.serve.options({...})` / `satisfies Serve.Options` being purely type-level means a runtime brand is needed - or (b) at minimum add `typeof def.routes === 'object'` to the heuristic and deprecate the `def.app` branch alongside `app`.
blast radius: medium - the `export default { fetch }` pattern is widely used; (b) is additive, (a) is a real break.
confidence: high.

### Undocumented back-compat option keys: `webSocket`, `host`, `static`, `baseURI`, top-level TLS, `keyFile`/`certFile`/`caFile`

what: `Bun.serve()` accepts at least six option keys that appear nowhere in `serve.d.ts` or the docs, all retained for compatibility with older Buns; the `Server` object likewise exposes `address` and `closeIdleConnections()` that are absent from the types.
where:
- `webSocket` (capital-S alias for `websocket`, checked *first*): `src/runtime/server/ServerConfig.rs:1143-1147`. Zero tests, zero docs.
- `host` (alias for `hostname`): `ServerConfig.rs:1193-1197`.
- `static` (alias for `routes`, its pre-1.2.3 name): `ServerConfig.rs:651` - `for key in ["routes", "static"]`. Still exercised by `test/js/bun/http/bun-serve-html.test.ts` (5+ uses) but untyped.
- `baseURI`: `ServerConfig.rs:1181` (its own error text still misspells it: `"new URL(baseuRI).toString()"` at :1460).
- Top-level TLS options (no `tls:` wrapper): `ServerConfig.rs:1419-1428` - verbatim: `// @compatibility Bun v0.x - v0.2.1` / `// this used to be top-level, now it's "tls" object`. Because `SSLConfig::from_js` is fed the *whole* options object, any of `key`, `cert`, `ca`, `passphrase`, `rejectUnauthorized`, `requestCert`, `secureOptions`, `dhParamsFile`, `lowMemoryMode` at the top level (`src/runtime/socket/SSLConfig.bindv2.ts:23-80`, `SSLConfig.rs:155-188`) flips the server into TLS mode.
- `keyFile`/`certFile`/`caFile`: still parsed (`SSLConfig.rs:198-206`, `SSLConfig.bindv2.ts:72-78`) but marked `@deprecated since v0.6.3` in `packages/bun-types/deprecated.d.ts:126-151`.
- `server.address` getter + `server.closeIdleConnections()`: defined in `src/runtime/server/server.classes.ts:33-35,70-73` and implemented (`server_body.rs:2489,2568`), absent from `serve.d.ts` (verified by grep).
evidence: verbatim `@compatibility Bun v0.x - v0.2.1` comment; `@deprecated since v0.6.3` annotations; grep of `packages/bun-types/serve.d.ts` returning 0 for `app|baseURI|onNodeHTTPRequest|static(option)|host|webSocket|closeIdleConnections|address`.
why bad: This is a parallel, invisible API surface. `webSocket` in particular is checked *before* `websocket`, so a typo of the documented name silently wins. The top-level-TLS shim means an accidental `passphrase` or `ca` key on a merged config object silently changes the scheme of the server. Every alias is a place where the documented spelling and the working spelling can diverge.
bun 2.0 proposal: Drop `webSocket`, `host`, `keyFile`/`certFile`/`caFile`, and the top-level TLS shim (all deprecated or pre-0.3-era). Either document+type `static` and `baseURI` or remove them. Add `address` and `closeIdleConnections()` to `serve.d.ts` (Node's `http.Server` has `closeIdleConnections()`, so that one should stay).
blast radius: low - all are undocumented; `static` is the only one with meaningful in-tree usage and could get a one-release warning.
confidence: high.

### `websocket.data` is a type-only field the runtime never reads (and the name collides with the real `data`)

what: The documented pattern for typing `ws.data` is to put `data: {} as MyType` inside the `websocket` handler object, but the native parser never reads a `data` key - it is pure TypeScript fiction - while `server.upgrade(req, { data })` is the thing that actually sets it. Users reasonably assume `websocket.data` is an initial/default value.
where: `packages/bun-types/serve.d.ts:384-402` - own admission: "This pattern exists in Bun due to a [TypeScript limitation (#26242)](https://github.com/microsoft/TypeScript/issues/26242)". `src/runtime/server/WebSocketServerContext.rs:129-137` parses exactly `error, message, open, close, drain, ping, pong` (plus the numeric options at :278-429); `data` is not among them.
evidence: the d.ts apology quoted above, plus #24181 "Default object for WebSocket contextual data `ws.data`": "if you don't initialise it in `server.upgrade()` then it doesn't exist (is `undefined`)... Would you consider making this the default so `server.upgrade(req)` does the equivalent of `server.upgrade(req, { data: {} })`?" - i.e. a user read `websocket.data` as a runtime default, which is the obvious reading.
why bad: It is a runtime value that exists only to be a type annotation; it silently does nothing, and it shadows the name of the real per-connection `data`. That is the opposite of "the types describe the runtime."
bun 2.0 proposal: Make `websocket.data` mean what it looks like - a per-connection default merged under `upgrade()`'s `data` (solving #24181) - and keep the type inference; or move the type parameter to `Bun.serve<WSData>(...)` / `Bun.Server<WSData>` exclusively (which the 1.3 `Server<WebSocketData>` generic already enables) and drop the fake field.
blast radius: low/medium - making it a real default is additive; removing the field breaks only type-checking.
confidence: high.

### The `idleTimeout` name is reused at two levels with incompatible contracts

what: `Bun.serve({ idleTimeout })` (HTTP) defaults to 10, errors above 255, and is a hard connection cap; `Bun.serve({ websocket: { idleTimeout } })` defaults to 120, errors above 960, and any value in 1–7 is **silently rounded up to 8**. Same name, same unit, completely different defaults, caps, and coercion rules - none of which appears in the types or docs.
where: HTTP: `src/runtime/server/ServerConfig.rs:25,75,1133-1139`; `serve.d.ts:809` (`@default 10`). WebSocket: `src/runtime/server/WebSocketServerContext.rs:358-378` (`> 960` → throw; `> 0` → `idle_timeout.max(8)` with a comment: "uws does not allow idleTimeout to be between (0, 8)... therefore round up"); `serve.d.ts:482` (`@default 120`, no mention of 960 or 8).
evidence: The source regret is explicit on the HTTP side: `ServerConfig.rs:25`: `// TODO: should we match websocket default idleTimeout of 120?`. #26554 "Bun.serve WebSocket idleTimeout and sendPings do not work well together" shows the interaction with the default-on `sendPings` (which keeps resetting the WS idle timer) makes the WS one effectively unreachable.
why bad: Two knobs with the same name and unit should behave the same; they don't on any axis. Silently rounding 1–7 up to 8 violates Bun's own "never silently coerce; errors name the constraint" rule. The 255 vs 960 caps are both leaked implementation details (`u8` / uWS limits).
bun 2.0 proposal: Unify the defaults (the source TODO already proposes 120), document both caps, and throw on WS values in 1–7 instead of silently rounding.
blast radius: medium for the HTTP default (same blast radius as the first finding); low for the rest.
confidence: high.

### `development` defaults from `NODE_ENV` and the types contradict themselves about it

what: `development` defaults to `process.env.NODE_ENV !== 'production'`, so the default for a freshly-deployed container that forgot `NODE_ENV=production` is the full stack-trace HTML error page - which the *same file* tells you not to ship.
where: `packages/bun-types/serve.d.ts:712` - `@default process.env.NODE_ENV !== 'production'`; `packages/bun-types/serve.d.ts:1137-1144` - "Don't use development mode in production: it risks leaking sensitive information." `src/runtime/server/ServerConfig.rs:717-740` (default `Development`; flipped to `Production` only by `NODE_ENV=production` or `--production`).
evidence: the two d.ts quotes above contradict each other by construction. `docs/runtime/http/error-handling.mdx:17-19` shows the dev page. #22055 "Only show dev error page in `Bun.serve` if browser-based `User-Agent`" is users working around the dev page leaking into non-browser clients. Combined with the `reusePort` coupling above, `development` is doing three unrelated things (error-page verbosity, HMR/bundling, `SO_REUSEPORT`).
why bad: "Leak stack traces unless an env var is set" is fail-open. Every other server framework that has this switch (Express `env`, Fastify) is criticized for the same default. Bun also has a much more reliable signal - `bun build --compile` / `--production` - and already reads it (`ServerConfig.rs:738`).
bun 2.0 proposal: Default `development` to `false` unless a positive dev signal exists (`bun --hot`, `bun --watch`, an interactive TTY, or explicit `development: true`). Decouple it from `reusePort` entirely.
blast radius: high - every `bun server.ts` during local development would stop showing the nice error page unless one of the dev signals is present; worth a 2.0.
confidence: medium (the default is deliberate and Express-shaped, but the self-contradicting docs and the extra couplings say it has grown past its design).

### `server.fetch()` is shipped with a "not fully implemented" disclaimer and a different calling convention

what: The `server.fetch(request)` mock entrypoint is documented in the `.d.ts` as "not fully implemented", and it invokes the user's `fetch` handler with **one** argument (`request`) instead of `(request, server)`, so `server` is `undefined` only on this path.
where: `packages/bun-types/serve.d.ts:901-908` - verbatim: "This feature is not fully implemented: it doesn't normalize URLs consistently in all cases and it doesn't always call the `error` handler." `src/runtime/server/server_body.rs:2334-2336` - `// TODO: set Host header`, `// TODO: set User-Agent header`, `// TODO: unify with fetch() implementation.` Single-arg call: `server_body.rs:2451` - `on_request.call(&global_this, self.js_value_assert_alive(), &[request_value])` vs. the real request path `server_body.rs:2922` / `mod.rs:1039` - `call(global, js_value, &[prepared.js_request, js_value])`.
evidence: #6286 "`serve#fetch` `server` argument is `undefined` in testing context" (open since Bun 1.0.4, `bug`). All quotes above are verbatim from the shipped types/source.
why bad: Shipping a method whose own JSDoc says it is half-implemented, and which calls your handler with a different arity than production, is a trap specifically for tests - exactly where people reach for it.
bun 2.0 proposal: Either finish it (route through the same dispatch as a real request - same arity, same `error` handler, same URL normalization) or remove it and point people at a real loopback request against `server.url`.
blast radius: low - the method is already caveated as incomplete.
confidence: high.

### `routes` values and `fetch` return types are different shapes for "respond with X"

what: A route value may be `Response | false | HTMLBundle | BunFile` (or a handler / a method map), but the `fetch` handler may only return a `Response`. `return Bun.file("x")` or `return htmlBundle` from `fetch` - the exact things `routes` accepts - are rejected.
where: `packages/bun-types/serve.d.ts:579` - `type BaseRouteValue = Response | false | HTMLBundle | BunFile;` vs. `:604,614` - `fetch(...): MaybePromise<Response>`.
evidence: #17595 "Allow returning `HTMLBundle` instead of `Response` in `Bun.serve`'s `fetch`" (open, `enhancement`, `bun:serve`, `bake:dev`).
why bad: Two entry points to the same dispatcher accept different value spaces for the same meaning; the difference is historical (`routes` is newer), not principled. Users graduating from `routes` to a `fetch` fallback have to learn a second return contract.
bun 2.0 proposal: Make `fetch` accept the same response union as a route value (`Response | BunFile | HTMLBundle`), coercing `BunFile`/`HTMLBundle` exactly as `routes` already does.
blast radius: low - strictly widens what `fetch` accepts.
confidence: medium.

### `server.upgrade()` returns a bare `false` for at least four unrelated failure causes

what: `upgrade()` returns `false` when: the `Request` is not the *identical* object Bun handed to `fetch` (a `req.clone()`, `new Request(req)`, or any framework-wrapped request has no internal `request_context`), the connection already aborted, the request already responded, or `Sec-WebSocket-Key` is malformed - all indistinguishable, and the first is by far the most surprising.
where: `src/runtime/server/server_body.rs:1882-1907` (`request_context.get::<ServerRequestContext>()` → `Ok(FALSE)`), `:1899-1901` (aborted → `FALSE`), `:1903-1907` (no upgrade context → `FALSE`), `:1980-1982` (`key.len != 24` → `FALSE`). Only the "no `websocket` config" case throws (`:1737-1741`).
evidence: #11382 "websocket server.upgrade fails if Request is not original request" (open, `bug`, `bun:serve`). #23754 "Server.upgrade doesn't accept an array in options.headers" shows the options are also under-specified.
why bad: `upgrade()`'s contract is "the upgrade was refused", but the dominant real-world `false` is "you passed a Request that is not *the* Request", which is a programmer error that should throw. Coupling the upgradeability to JS object identity is invisible and breaks every middleware framework (Hono/Elysia) that wraps `Request`.
bun 2.0 proposal: Throw a descriptive error (`"upgrade() requires the original Request from the fetch handler"`) for the identity/missing-context case instead of returning `false`; reserve `false` for "the client can't be upgraded" (aborted, bad key, already responded). Longer term, expose an upgrade token that survives cloning.
blast radius: low/medium - code that guards `if (!server.upgrade(req)) return new Response(...)` with a *wrong* request object today gets a silent 400-ish; after the change it gets a thrown error, which is the intent.
confidence: high.

### `fetch` receives the `Server` twice (`this` and arg 2); `error` receives it once (`this` only)

what: The `fetch` handler is invoked with `this = server` *and* `server` as the second positional argument; the `error` handler only gets `this = server`, which is unreachable from arrow functions - the overwhelmingly common style.
where: `src/runtime/server/server_body.rs:2922` and `src/runtime/server/mod.rs:1039` - `call(global, js_value, &[prepared.js_request, js_value])` (`js_value` = the server, as both `this` and args[1]). `packages/bun-types/serve.d.ts:604,614` (`fetch(this: Server, req, server)`) vs `:728` (`error?: (this: Server, error) => ...` - no `server` parameter).
evidence: `rg 'this\.upgrade|this\.requestIP' docs/` → 0 hits: no Bun doc ever uses the `this` binding, so it is pure legacy. #15475 (error handler needs more context) is the downstream symptom.
why bad: Two ways to get the same object in `fetch`, zero ways in `error` if you write an arrow function - which is the opposite of consistent. The `this` binding exists only to support the earliest `export default { fetch(req) { this.upgrade(req) } }` idiom.
bun 2.0 proposal: Add `server` as a trailing parameter to `error` (already proposed above alongside `request`). Stop documenting the `this` binding in the types; consider dropping it in 2.0.
blast radius: low - additive for `error`; dropping `this` only affects code nobody in the docs or tests writes.
confidence: medium.
