# Catch scopes that should be throw scopes

Audit of all 196 `DECLARE_TOP_EXCEPTION_SCOPE` (formerly `DECLARE_CATCH_SCOPE`)
usages in `src/`. Criteria from JSC's `TopExceptionScope.h`:

> TopExceptionScope is intended to be used at the top of the JS stack when we
> wouldn't want to propagate exceptions further. Most code should use ThrowScope
> to do exception handling (including clearing exceptions) as termination
> exceptions mean that almost all catch sites can also rethrow.

A site is flagged when it **propagates** an exception to its caller (via
`RETURN_IF_EXCEPTION`, or returning on `scope.exception()` without a clear) and
is **not** top-of-stack.

Methodology: per-function agent audit of each scope, cross-checked by a
mechanical scan tracking each scope variable's use of `RETURN_IF_EXCEPTION` vs
`clearException`/`takeAbruptCompletion`/`tryClearException`, then spot-checked
manually. The streams code uses a nested-scope pattern (outer `ThrowScope` +
inner catch scope that clears via `takeAbruptCompletion`); all of those verified
**correct** and are not listed here. Upstream WebCore was consulted for the
forked files.

---

## Should be `DECLARE_THROW_SCOPE` (33)

### Host functions / getters returning directly to JS

| file:line | function | why |
|---|---|---|
| `src/jsc/modules/NodeTTYModule.cpp:16` | `jsFunctionTty_isatty` | `RETURN_IF_EXCEPTION` at L18 propagates to JS |
| `src/jsc/bindings/sqlite/JSSQLStatement.cpp:1760` | `jsSQLStatementOpenStatementFunction` (inner `topExceptionScope`) | `RETURN_IF_EXCEPTION` at L1762 propagates; `tryClearException` on next line is unreachable. Outer `scope` (ThrowScope at L1731) should be used instead. |

### Lazy property builders (`constructXxx` in `BunProcess.cpp`)

All propagate via `RETURN_IF_EXCEPTION` to the lazy-property getter that reifies
into a JS-visible slot. The sibling `Process_stubEmptyArray` at L3886 shows the
correct pattern (clear + report) if the intent is not to propagate; otherwise
these should be ThrowScope.

| file:line | function |
|---|---|
| `src/jsc/bindings/BunProcess.cpp:212` | `constructVersions` |
| `src/jsc/bindings/BunProcess.cpp:273` | `constructProcessReleaseObject` |
| `src/jsc/bindings/BunProcess.cpp:2506` | `constructProcessReportObject` |
| `src/jsc/bindings/BunProcess.cpp:2550` | `constructProcessConfigObject` (final `freeze()` path propagates) |
| `src/jsc/bindings/BunProcess.cpp:3899` | `Process_stubEmptySet` |
| `src/jsc/bindings/BunProcess.cpp:4107` | `constructFeatures` |

### extern "C" / Rust-facing helpers that propagate

Rust callers check via their own `ThrowScope`/`JsResult`, so these propagate.

| file:line | function | why |
|---|---|---|
| `src/jsc/bindings/bindings.cpp:2941` | `JSModuleLoader__import` | `EXCEPTION_ASSERT` peeks, returns null with exception pending; Rust maps null → `JsError::Thrown` |
| `src/jsc/bindings/bindings.cpp:3452` | `JSC__JSModuleLoader__loadAndEvaluateModule` | same pattern |
| `src/jsc/bindings/bindings.cpp:3464` | `JSC__AnyPromise__wrap` | clears first exception, then `RETURN_IF_EXCEPTION` propagates any throw from `reject`/`resolve` |
| `src/jsc/bindings/bindings.cpp:4528` | `JSC__JSValue__stringIncludes` | `RETURN_IF_EXCEPTION` propagates |
| `src/jsc/bindings/bindings.cpp:5099` | `JSC__JSValue__forEachPropertyImpl` | `RETURN_IF_EXCEPTION` propagates callback exceptions |
| `src/jsc/bindings/bindings.cpp:5452` | `JSC__JSValue__isInstanceOf` | `RETURN_IF_EXCEPTION` propagates |
| `src/jsc/bindings/ErrorCode.cpp:348` | `determineSpecificType` | many `RETURN_IF_EXCEPTION`; callers have ThrowScope |
| `src/jsc/bindings/ErrorCode.cpp:496` | `Bun__ErrorCode__inspectForErrorMessage` | `RETURN_IF_EXCEPTION` propagates to Rust |
| `src/jsc/bindings/JSBundlerPlugin.cpp:528` | `JSBundlerPlugin__matchOnLoad` | early `RETURN_IF_EXCEPTION` paths don't clear |
| `src/jsc/bindings/JSBundlerPlugin.cpp:567` | `JSBundlerPlugin__matchOnResolve` | same |

### V8 shim API (`Maybe`/`MaybeLocal` = exception pending)

V8 API semantics: `Nothing()`/`MaybeLocal()` means exception pending for
caller's `TryCatch`. These propagate by contract.

| file:line | function |
|---|---|
| `src/jsc/bindings/v8/V8Object.cpp:48` | `v8::Object::Set(ctx, key, value)` |
| `src/jsc/bindings/v8/V8Object.cpp:68` | `v8::Object::Set(ctx, index, value)` |
| `src/jsc/bindings/v8/V8Object.cpp:85` | `v8::Object::Get(ctx, key)` |
| `src/jsc/bindings/v8/V8Object.cpp:105` | `v8::Object::Get(ctx, index)` |

### llhttp callbacks (propagate through C to outer ThrowScope)

Called from llhttp C code; exception left pending for `HTTPParser::execute()`'s
ThrowScope at L168. These are not top-of-stack.

| file:line | function |
|---|---|
| `src/jsc/bindings/node/http/NodeHTTPParser.cpp:336` | `HTTPParser::onMessageBegin` |
| `src/jsc/bindings/node/http/NodeHTTPParser.cpp:400` | `HTTPParser::onHeaderField` |
| `src/jsc/bindings/node/http/NodeHTTPParser.cpp:476` | `HTTPParser::onHeadersComplete` |
| `src/jsc/bindings/node/http/NodeHTTPParser.cpp:564` | `HTTPParser::onBody` |
| `src/jsc/bindings/node/http/NodeHTTPParser.cpp:595` | `HTTPParser::onMessageComplete` |

### sqlite callbacks (propagate through C to outer ThrowScope)

Called from sqlite C code; exception left pending for the enclosing host
function's ThrowScope.

| file:line | function |
|---|---|
| `src/jsc/bindings/sqlite/NodeSqlite.cpp:485` | `callUserDefinedFunction` (xFunc) |
| `src/jsc/bindings/sqlite/NodeSqlite.cpp:608` | `aggregateXStep` |
| `src/jsc/bindings/sqlite/NodeSqlite.cpp:637` | `aggregateXFinal` |
| `src/jsc/bindings/sqlite/NodeSqlite.cpp:1710` | `applyChangesetXConflict` |
| `src/jsc/bindings/sqlite/NodeSqlite.cpp:1741` | `applyChangesetXFilter` |
| `src/jsc/bindings/sqlite/NodeSqlite.cpp:1878` | `sessionTableFilter` |

---

## Borderline (9)

Propagates on some path but either matches upstream WebCore or is
termination-only.

| file:line | function | note |
|---|---|---|
| `src/jsc/bindings/webcore/MessagePort.cpp:79` | `MessagePort::postMessage` | `RETURN_IF_EXCEPTION` propagates; **upstream has no scope here at all** (relies on `ExceptionOr`). Bun added one; should be ThrowScope if kept. |
| `src/jsc/bindings/webcore/JSDOMPromiseDeferred.h:355` | `callPromiseFunction` (both overloads, +L374) | `RETURN_IF_EXCEPTION` propagates secondary throw after `rejectPromiseWithExceptionIfAny`; **matches upstream WebCore** exactly. |
| `src/jsc/bindings/webcore/BroadcastChannel.cpp:84` | `BroadcastChannel::dispatchMessage` | peeks, `RELEASE_ASSERT(termination)`, returns without clear. Top-of-stack dispatch; termination-only propagation. |
| `src/jsc/bindings/webcore/MessagePort.cpp:354` | `MessagePort::dispatchOne` | same termination-only pattern; **matches upstream**. |
| `src/jsc/bindings/webcore/MessageEvent.cpp:102` | `MessageEvent::create(..., SerializedScriptValue&&, ...)` | peeks `scope.exception()`, sets `deserialized = jsUndefined()`, does **not clear**, then continues calling JS-touching code. Likely wants a clear; otherwise propagate. |
| `src/jsc/bindings/ZigGlobalObject.cpp:3040` | `GlobalObject::addBuiltinGlobals` | `assertNoExceptionExceptTermination()` + `RETURN_IF_EXCEPTION`; init-time, termination-only propagate. |
| `src/jsc/bindings/BunProcess.cpp:4061` | `constructProcessPermissionObject` | scope declared, clear on one path, `RETURN_IF_EXCEPTION` on another. |
| `src/jsc/bindings/ExposeNodeModuleGlobals.cpp:103` | `ExposeNodeModuleGlobals_getEntry` | mixed clear/propagate paths. |
| `src/jsc/modules/ObjectModule.cpp:27` | `generateObjectModuleSourceCode` | mixed clear/propagate paths. |

---

## Verified correct (not listed, 154 sites)

Notable groups confirmed correct:
- All `src/jsc/bindings/webcore/streams/*` catch scopes (nested inside outer ThrowScope; clear via `takeAbruptCompletion`).
- `JSDOMPromiseDeferred.h` `DeferredPromise::resolve/reject*` (use `DEFERRED_PROMISE_HANDLE_AND_RETURN_IF_EXCEPTION` → `handleUncaughtException` clears).
- napi/NAPI boundaries (clear via `tryClearException`).
- `headers-handwritten.h` assertion macros.
- `bindings.cpp` `TopExceptionScopeBinding` exports (L5994/5999/6004/6009: these ARE the scope implementation).
- `Worker.cpp:538` `dispatchErrorWithValue` (uses `CLEAR_IF_EXCEPTION`).
- `SerializedScriptValue.cpp:6643/7039` (clear).
- `ErrorCode.cpp:200` `ErrorCodeCache::createError` (uses `tryClearException`).
