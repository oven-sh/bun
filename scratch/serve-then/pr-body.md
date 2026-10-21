### Problem
- Bun.serve reads the state of a returned promise and never calls `then()` (`on_response`, `src/runtime/server/RequestContext.rs`).
- A promise that starts its work in `then()` (`Bun.$`, a `Bun.SQL` query) gets no answer. The openai SDK's `APIPromise<Response>` holds `null` and gives the Response in `then()`. It gets `error: Expected a Response object, but received 'null'`. An `async` handler calls `then()`.

### Fix
- Bun.serve now follows a promise with its own `then` that is pending or fulfilled without a Response. It resolves a new promise with it, so JSC calls `then()` once. That promise answers the request.
- Other results are read as before. A pending promise from `error()` is followed.
- Verified: `test/js/bun/http/serve-handler-then.test.ts` (78 of 123 fail on main), `serve.test.ts`, 11 more suites.
- Self-reviewed: 8 concerns raised, 7 addressed. Not done: tracking issues for the two cases not handled.

### Background
- "Its own `then`": a callable or accessor `then` that is not a property of a `Promise.prototype`.
- A JS cell starts with the ID of its `Structure`. Plain promises of a realm share one.
- Weighed: spec `PromiseResolve` on every result (#41008, #45843). It changes promises that answer today.

### Downsides
- Until now the state answered for a pending promise whose own `then()` throws, never calls back, or reports another value. Now `then()` answers, without the handler's AsyncLocalStorage store.
- Instructions per request (release, JIT off): `Response` +0, `async` handler +0 (+3 on HTTP/2), pending plain promise +3. A pending subclass that inherits `then()`: +246. `.text` +17,664 bytes.
- Not handled: a plain thenable, a settled promise from `error()`.

<details><summary>Notes</summary>

#### Question for a maintainer

Three rules exist for a callback result with its own `then()`. `expect()` on main calls `then()` with no arguments and keeps the state read (`Expect::call_then_if_pending`, #45304). #41008 (bun:test) and #45843 (Bun.cron) propose spec `PromiseResolve`. This PR calls `then()` only for a promise that has its own, and keeps the state read elsewhere. Should this rule stay local to Bun.serve, or become the shared one?

#### What changes

"main" is the answer of a handler that is not `async`. Each "this PR" answer is the answer that main gives when the same handler is `async`. The tests run each row for both. "204" is the answer with `development: false`. In development mode it is a 200 with the welcome text. The diagnostic is the `Expected a Response object` line.

| Returned promise | main | this PR |
|---|---|---|
| Fulfilled with a placeholder, `then()` gives a Response (`APIPromise<Response>` of the openai, anthropic and groq SDKs, p-lazy) | 204 and the diagnostic | 200 |
| Same, `then()` rejects | 204 and the diagnostic | `error()`, 500 |
| Same, `then()` gives no Response | 204 and the diagnostic for the placeholder | 204 and the diagnostic for what `then()` gave |
| Same, `then()` never calls back | 204 and the diagnostic | no answer until the idle timeout |
| Pending, starts its work in `then()` | no answer | 200 |
| Pending, never settles itself, `then()` delivers | no answer | 200 |
| `Bun.$` or a `Bun.SQL` query returned by mistake | no answer, the work does not run | the work runs, then 204 and the diagnostic for its result |
| Pending, `then()` or the `then` accessor throws | the state answers | `error()`, 500 |
| Pending, `then()` never calls back | the state answers | no answer until the idle timeout |
| Pending, `then()` reports another value than the state | the state | what `then()` reports |
| Pending, `then()` upgrades the request and then rejects | the state answers the handshake, no WebSocket | the WebSocket opens, the rejection is unhandled |
| `error()` returns a pending promise that starts its work in `then()` | no answer | what `then()` reports |

The last row follows the same rule for `error()`: the answer is the one of an `async error()`. A pending promise from `error()` whose `then()` fails gets the default error page for that failure. If its `then()` gives no Response, the request gets the diagnostic and the error of the handler is not reported, as for an `async error()` today (#33137).

For these rows, two differences from the `async` handler remain:

- The engine queues the call of `then()` inside an `async` handler, so `then()` has the AsyncLocalStorage store of the handler. Bun.serve queues it after the handler returned, so `then()` has no store. A test records this. It is the same for `error()`.
- Bun.serve reads `then` after the first drain of the microtasks. A microtask of the handler that adds or replaces `then` on the promise is therefore seen.

Not changed:

- A `Response`. A plain promise: one that the `Promise` of the server's realm made, with no own property and its prototype in place. A promise that holds a `Response`, also when its class has its own `then()`: the state answers and `then()` is not called.
- A rejected promise: `error()`, also when its class has a `then()` that gives a Response.
- A promise that is not plain and has no `then` of its own: a subclass that inherits `then()`, a promise of another realm, a promise with own properties, a promise with a `then` property that is not a function. `await` of a subclass whose constructor ignores its executor throws a TypeError, so spec `PromiseResolve` would break that one.
- A promise whose `then` accessor gives nothing to call. The accessor is now read once, and then the state answers as before. (An `async` handler gets the diagnostic for this one.)
- A plain promise after `Promise.prototype.then` was replaced (zone.js): the replacement is not called.
- A request that is aborted, ended or upgraded when the handler returns: `then()` is not called.
- A plain object, a string, a number, a thenable: 204 and the diagnostic.
- A settled promise that `error()` returns. A placeholder there gives the default page for the error.
- `server.fetch()`.

#### How it works

- `JSC__JSPromise__hasCustomThen` (`src/jsc/bindings/JSPromiseCustomThen.cpp`) looks `then` up with a `VMInquiry` slot, which runs no script. It answers yes for a callable value or an accessor that is not a property of a `Promise.prototype` of any realm, and for a Proxy that the lookup meets before it finds `then`.
- Pending promise: `on_response` compares the StructureID of the promise with the one of a plain promise of the server's realm (`NewServer::promise_structure_id`, read once). An equal ID goes on as before. Another ID goes to `on_pending_promise_not_plain`, which is cold.
- Fulfilled promise without a Response: the two calls of `render_missing_invalid_response` become `on_promise_without_response`, which is cold.
- `follow_then` gets the new promise from `follower_of` (`JSPromise::create` + `resolve`, the mechanism of `promise_to_await` in #44833). Then it drains the microtasks, so `then()` runs. Then it reads the request again (aborted, ended, upgraded, closed), as `on_response` does after the handler. Then it reads the new promise: pending subscribes with the usual promise cell, fulfilled goes to `handle_resolve`, rejected goes to `handle_reject`.
- `then()` runs before anything is subscribed. So a request that `then()` upgrades, stops or loses is dropped by the same code as one that the handler upgraded, stopped or lost.
- `handle_resolve` has a second caller now. `#[inline(always)]` keeps it inlined in the settle reaction of a pending promise.
- `error()`: a pending promise with its own `then` is replaced by a new promise in the same way, and the existing code subscribes to that one. There is no drain, because `error()` also runs where no drain is due. `drop_result_if_gone` is the check that was inline after `error()`.

#### Measurements

Release builds of the merge base (9b4284f788) and of this PR, linux x64. Instructions of the JS thread from the entry of the request dispatch to its return (`perf_event_open`, `BUN_JSC_useJIT=0`), minimum over 40 requests (HTTP/2: 160, two interleaved rounds).

| Handler returns | main | this PR |
|---|---|---|
| `Response` | 7,744 | 7,744 |
| `async` handler, a Response | 8,233 | 8,233 |
| Pending plain promise | 9,483 | 9,486 |
| Pending subclass that inherits `then()` | 10,540 | 10,786 |
| Pending subclass whose constructor ignores its executor | 10,950 | 11,196 |
| Pending promise with own properties | 12,241 | 12,415 |
| Pending promise of another realm | 10,785 | 10,997 |
| `async` handler, a string (diagnostic) | 12,668 | 12,712 |
| Plain object (diagnostic) | 15,869 | 15,869 |
| `async` handler, a lazy promise | 17,867 | 17,867 |
| Placeholder promise | 15,745 (204) | 14,915 (200) |
| Lazy promise | no answer | 18,274 (200) |
| HTTP/2, `Response` | 13,664 | 13,664 |
| HTTP/2, `async` handler | 14,152 | 14,155 |
| HTTP/2, pending plain promise | 9,674 | 9,677 |

- Pending-arm gate: `mov (%rbx),%eax`, `cmp 0x670(%r15),%eax`, `jne`. 3 instructions and no call on the equal path, in the 4 `on_response` symbols. The HTTP/2 and HTTP/3 code has `on_response` inlined: 3 instructions, 4 in development mode.
- HTTP/2, `async` handler: the gate does not run there. The fulfilled arm of the inlined copy gained 3 register moves, because it keeps the promise for the cold call.
- The reaction that runs when a pending promise settles: 4,187 instructions on main and on this PR. Its shim stays 443 bytes.
- Calls of the new code in 100 requests: `hasCustomThen` 0 for a `Response`, 0 for an `async` handler, 0 for a pending plain promise, 100 for a pending subclass. `follow_then` 0 for all four.
- With `Promise.prototype.then` replaced: 7,744 to 7,744, 8,354 to 8,354, 9,483 to 9,486.
- Size: `.text` 81,904,485 to 81,922,149 bytes. Stripped binary +20,480 bytes. `on_response` 872 to 896 bytes (4 copies). `process_on_error_promise` 1,127 to 1,582 bytes, and the three cold functions 1,769 bytes together (8 copies each, one copy is some bytes smaller). `NewServer` gets one `u32`. No new exported symbol.
- Cells that one pending request holds: 1 Promise and 1 `NativePromiseContext` for a plain promise, on main and on this PR. 3 Promises and 1 `NativePromiseContext` for a followed lazy promise (the promise, the new one, and the one its `then()` returns).

#### A client that leaves while `then()` runs

`then()` can run the event loop (for example `Bun.build` with a plugin whose `setup()` is `async`), and the client can leave in that time. An earlier shape of this PR subscribed to the new promise before the drain. It then answered through the closed socket, and a 2 MiB file body reached the connection of another client. This shape reads the request again after the drain: nothing is written, and `abort` fires on `request.signal`. That is what main does when the handler itself runs the event loop (#40034). Four tests cover it, for `then()`, the `then` accessor and `error()`. They are skipped on Windows, where a nested run of the event loop frees the closed socket (#40021). Checked on HTTP/1.1 and HTTP/2. On HTTP/3 a nested run of the event loop inside a handler hangs on main too.

#### Other designs and related work

- Call `then()` with no arguments and keep the state read (`Expect::call_then_if_pending`). It starts lazy work, but a promise that only `then()` delivers stays wrong: the placeholder row keeps the diagnostic, and the forwarding row gets no answer.
- Wrap each handler in an `async` function. An `async` handler costs 489 more instructions per request than the same handler without `async` (8,233 and 7,744).
- #44833 adopts every pending promise. This PR adopts only a promise with its own `then`, and also a fulfilled one without a Response.
- A plain thenable (`{ then() {} }`) is not in this PR. It needs a decision on the `Response | Promise<Response>` contract and on the types.
- A settled promise from `error()` is not followed. `error()` still holds the error there, and `then()` could give no Response. Then the error would be lost, as in #33137.
- #33134 changes `render_missing_invalid_response`. This PR does not change it.

#### Tests

- `bun bd test test/js/bun/http/serve-handler-then.test.ts`: 123 pass. With the `src/` of main: 78 fail. The 45 that pass pin behaviour that stays, or run the `async` handler.
- The tests are in their own file, like `serve-reused-response.test.ts`.
- Also ran on the debug build: `serve.test.ts` (the 2 failures are the same on main in my container: the root port test and the sendfile abort test), `serve-pending-promise-abort-leak`, `serve-reused-response`, `bun-serve-routes`, `bun-serve-propagate-errors`, `serve-error-handler-stream`, `bun-server`, `websocket-server`, `websocket-server-upgrade-reentrant`, `serve-http2`, `serve-http3`, `serve-direct-readable-stream`.
- `BUN_JSC_validateExceptionChecks=1` on the new file: 123 pass.

</details>
