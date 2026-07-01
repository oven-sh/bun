# JSTransformStreamDefaultController.cpp — combined A (spec fidelity) + B (discipline) review

Target: `src/jsc/bindings/webcore/streams/JSTransformStreamDefaultController.cpp` (413 LOC).
Spec source: `specs/digest/04-transform-queuing-support.md`. Cross-cutting rules: ARCHITECTURE §4.1
(REFINED fact 5), §7.1/§7.1a/§7.2; PHASE-B-LOG rulings (incl. the I1 fix to
`invokePromiseReturningMethod`, applied everywhere EXCEPT this file). `check-streams.py` → CLEAN.

---

### [CRITICAL] The local `invokePromiseReturningMethod` is the UNFIXED (pre-I1) copy: `promiseResolvedWith(result)` runs user JS under a live catch scope with no exception check and no outer throw scope

This file (lines 40–54):

```cpp
static JSC::JSPromise* invokePromiseReturningMethod(...)
{
    auto& vm = JSC::getVM(globalObject);
    auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);      // the ONLY scope in the function
    auto callData = JSC::getCallData(method);
    ASSERT(callData.type != JSC::CallData::Type::None);
    JSC::JSValue result = JSC::call(globalObject, method, callData, thisValue, args);
    if (catchScope.exception()) [[unlikely]] {
        JSC::JSValue thrown = takeAbruptCompletion(globalObject, catchScope);
        if (thrown.isEmpty()) [[unlikely]]
            return nullptr;
        return promiseRejectedWith(globalObject, thrown);   // still inside the catch scope
    }
    return promiseResolvedWith(globalObject, result);       // <-- UNCHECKED user-JS point
}
```

The ratified fix (PHASE-B-LOG "DISCIPLINE SWEEP" ruling I1: "the `promiseResolvedWith(userResult)`
tail ... is a real user-JS point: the ES thenable lookup ... unchecked in 3 of its 4 copies → FIX
all 3 in place NOW") is present in the sibling copy that this file was told to match,
`TransformStreamOperations.cpp:40–61`:

```cpp
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue result;
    JSValue thrown;
    {
        auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        ...
        result = call(globalObject, method, callData, thisValue, args);
        if (catchScope.exception()) [[unlikely]]
            thrown = takeAbruptCompletion(globalObject, catchScope);
    }                                                        // catch scope CLOSED here
    if (result.isEmpty()) {
        if (thrown.isEmpty())
            return nullptr;
        RELEASE_AND_RETURN(scope, promiseRejectedWith(globalObject, thrown));
    }
    RELEASE_AND_RETURN(scope, promiseResolvedWith(globalObject, result));   // exception-checked tail
```

and identically in `JSReadableStreamDefaultController.cpp:33`, `JSReadableByteStreamController.cpp:109`,
`JSWritableStreamDefaultController.cpp:32`. `WebStreamsInternals.h:136–142` states the hazard this
guards: *"resolving with ANY OBJECT (not only a user thenable) performs Get(v, 'then'), so a
user-installed `Object.prototype.then` getter runs synchronously"* — `promiseResolvedWith` is
annotated `userJS: yes`.

Consequence: when the user's `transform()` returns any object and a hostile
`Object.prototype.then` getter throws, the throw happens (a) with no `RETURN_IF_EXCEPTION` /
`RELEASE_AND_RETURN` acknowledging it and (b) inside a still-open `TopExceptionScope` that never
handles it — an exception-scope-verification failure (`BUN_JSC_validateExceptionChecks`) and a
return of a bogus/null promise pointer with the exception pending under a catch scope rather than
a throw scope. This is exactly the defect class the concurrent fix removed from every other copy;
this file (written concurrently, excluded from `fx-discipline`) did not get it.

Minimal fix: replace lines 40–54 with the exact body of `TransformStreamOperations.cpp:40–61`
(outer `DECLARE_THROW_SCOPE`; the `call` + `takeAbruptCompletion` inside a braced
`TopExceptionScope`; both `promiseRejectedWith`/`promiseResolvedWith` tails under
`RELEASE_AND_RETURN(scope, ...)`).

---

### [MAJOR] Enqueue step 5.2: asserts the readable is Errored and throws a possibly-EMPTY `[[storedError]]`; spec throws `readable.[[storedError]]` unconditionally (which may be `undefined`)

Spec (`04-transform-queuing-support.md`, TransformStreamDefaultControllerEnqueue):

```
5. If enqueueResult is an abrupt completion,
   1. Perform ! TransformStreamErrorWritableAndUnblockWrite(stream, enqueueResult.[[Value]]).
   2. Throw stream.[[readable]].[[storedError]].
```

No assertion that the readable is errored; if it is not, `[[storedError]]` is `undefined` and the
step throws `undefined`.

This file (lines 367–374):

```cpp
    if (!thrown.isEmpty()) [[unlikely]] {
        transformStreamErrorWritableAndUnblockWrite(globalObject, stream, thrown);
        RETURN_IF_EXCEPTION(scope, void());
        auto* readable = stream->m_readable.get();
        ASSERT(readable->m_state == ReadableStreamState::Errored);
        throwException(globalObject, scope, readable->m_storedError.get());
```

The `Errored` state is NOT an invariant here. The readable-enqueue's abrupt completion comes from
the user `readableStrategy.size(chunk)` callback (`JSReadableStreamDefaultController.cpp:543`,
executed after this file's CanCloseOrEnqueue guard already passed). If that user callback first
closes the readable — `controller.terminate()` (readable close-requested, queue empty → state
Closed) or `ts.readable.cancel()` — and then throws, the recovery at
`JSReadableStreamDefaultController.cpp:548` (`readableStreamDefaultControllerError`) is a spec
no-op on a non-Readable stream, so the readable ends up **Closed with `m_storedError` never set**.
`m_storedError` is a `WriteBarrier<Unknown>` that is only ever `.clear()`ed at init
(`ReadableStreamOperations.cpp:141`), so `.get()` is the EMPTY JSValue, not `jsUndefined()`.

Consequence: a debug ASSERT crash reachable from user JS; in release,
`throwException(globalObject, scope, JSValue())` throws an exception whose value is the empty
JSValue (corrupt exception state) where the spec requires throwing `undefined`. The rest of the
subsystem already handles this exact case correctly:
`JSReadableStreamDefaultReader.cpp:317: throwException(..., storedError ? storedError : jsUndefined())`.

Minimal fix: drop the ASSERT and throw
`storedError.isEmpty() ? jsUndefined() : storedError` (mirroring
JSReadableStreamDefaultReader.cpp:317).

---

### [MINOR] `ClearAlgorithms` re-labels the controller as a live Identity transformer instead of "cleared"

Spec: *"Set controller.[[transformAlgorithm]] / [[flushAlgorithm]] / [[cancelAlgorithm]] to
undefined."* This file (lines 336–344) clears every algorithm slot (`m_transformer`,
`m_transformMethod`, `m_flushMethod`, `m_cancelMethod`, `m_algorithmContext`) — correct — but also
sets `m_transformerKind = TransformerKind::Identity`. `Identity` is a *live* transform algorithm
(the dispatch at lines 94–101 would happily enqueue the chunk), so "cleared" and "identity
transformer that has not been cleared" are now the same state. No spec-observable divergence today
(no op invokes an algorithm after ClearAlgorithms), but the sentinel silently converts any future
post-clear invocation into a successful enqueue instead of a loud failure, and it destroys the
information the flush/cancel dispatches in `TransformStreamOperations.cpp` key off the same enum.
No behavioral bug; note only.

---

### [MINOR] Same-TU-pair duplication now diverges: `invokePromiseReturningMethod` + `transformReadableController` are re-defined here AND in `TransformStreamOperations.cpp`

`transformReadableController` (lines 31–36) and `invokePromiseReturningMethod` (lines 40–54) are
byte-for-byte-intended copies of the statics at `TransformStreamOperations.cpp:31–36` and `:40–61`
(and 3 more files carry the latter). The 5-copy dedup is already a known Phase-D item
(PHASE-B-LOG: "the 4-copy DEDUP into one shared helper needs an ABI addition → Phase D"), but this
file added a 5th copy of each and its `invokePromiseReturningMethod` copy is now the ONLY divergent
one (see the CRITICAL above) — the concrete cost of the duplication. When the CRITICAL is fixed,
the two TS-side copies become identical again; fold into the Phase-D dedup list.

---

### [Lens D] Comments citing spec/review artifacts

Grep of the file for `digest|BUN-LAYER|ARCHITECTURE|§|review|Phase`:

- line 57: `// completion becomes a rejected promise (the §7.1a completion-record family).`
- lines 358–359: `// The readable-side enqueue interpreted as a completion record (the §7.1a family):`

Both cite ARCHITECTURE §7.1a by section number. Per the DISCIPLINE-SWEEP (g) ruling this exact
class is "notes, not violations" (*"§7.1a itself requires catch sites to cite the rule; keep, or
spell it out ... to drop the doc-section number"*) — listed here per the brief; recommend the
spelled-out wording ("the one sanctioned completion-record catch") for both so nothing in the
shipping tree names a doc section. No `digest`, `BUN-LAYER`, review-ID, or Phase references exist
in the file. The `[reaction-convention]` tag at line 253 resolves to `JSStreamsRuntime.h:11` —
in-tree, sanctioned.

---

## Verified clean

**Lens A — spec-step fidelity vs digest 04:**
- `TransformStreamDefaultControllerEnqueue` (346–380): CanCloseOrEnqueue guard FIRST with a
  TypeError (step 3); readable enqueue as a completion record (step 4); abrupt path calls
  `transformStreamErrorWritableAndUnblockWrite(stream, thrown)` with the ABRUPT value and then
  throws the READABLE's `[[storedError]]` — not `thrown` — matching steps 5.1/5.2 (modulo the
  MAJOR above); backpressure re-read AFTER the enqueue with the `Assert: backpressure is true` +
  `SetBackpressure(stream, true)` pair (steps 6–7). Order exact.
- `TransformStreamDefaultControllerError` (382–387): delegates to `transformStreamError(stream, e)`
  — step 1.
- `TransformStreamDefaultControllerPerformTransform` (389–399): performs `[[transformAlgorithm]]`
  first, then builds a REAL derived `JSPromise` and registers ONLY a rejection reaction
  (`onFulfilled = jsUndefined()`), i.e. "the result of reacting to transformPromise with rejection
  steps" — fulfillment passes through to the derived promise. The handler (255–265) performs
  `TransformStreamError(controller.[[stream]], r)` then re-throws `r`, so the derived promise
  rejects with `r` (the throw-to-reject-derived pattern established by
  `jsWebStreamsHandler_onDirectPullRejected`, JSDirectStreamController.cpp:702). Steps 2.1/2.2 exact.
- `TransformStreamDefaultControllerTerminate` (401–410): RSDefaultControllerClose(readableController)
  → new TypeError → `transformStreamErrorWritableAndUnblockWrite(stream, error)`. Steps 1–5 exact.
- `TransformStreamDefaultControllerClearAlgorithms` (336–344): every algorithm slot (+ the
  transformer object and the encoder/decoder algorithm context) cleared → the transformer becomes
  collectable, matching the op's intent (see the MINOR on the kind sentinel).
- The default `[[transformAlgorithm]]` (58–74) is SetUpFromTransformer step 2 verbatim: Enqueue's
  abrupt completion → rejected promise; else resolved-with-undefined.
- Class section: `desiredSize` reads the READABLE side's controller and returns null for nullopt;
  `enqueue`/`error`/`terminate` are pure `Perform ?` delegations with brand checks
  (`throwThisTypeError`); WebIDL shape (readonly `desiredSize`, 3 methods, toStringTag,
  constructor property) matches.

**Lens B — discipline:**
- §7.1: every op and prototype function opens a `DECLARE_THROW_SCOPE`; every `userJS: yes` callee
  (`readableStreamDefaultControllerEnqueue`, `readableStreamDefaultControllerClose`,
  `transformStreamError`, `transformStreamErrorWritableAndUnblockWrite`,
  `transformStreamDefaultControllerEnqueue/Error/Terminate`) is followed by
  `RETURN_IF_EXCEPTION` or is a `RELEASE_AND_RETURN` tail; the `userJS: no` calls
  (`...HasBackpressure`, `...GetDesiredSize`, `...CanCloseOrEnqueue`,
  `transformStreamSetBackpressure`) are correctly not treated as check points. The one exception
  is the CRITICAL above.
- §7.1a: the only catches are `takeAbruptCompletion` under braced `TopExceptionScope`s at
  sanctioned completion-record sites (the WebIDL callback invoke; the default transform's Enqueue;
  Enqueue's readable-side enqueue), each with the termination `RETURN_IF_EXCEPTION` immediately
  after the braces. No bare `clearException`.
- §7.2: post-user-JS state in Enqueue/Terminate is re-derived exactly where the spec re-derives it;
  no stale-pointer reads across user-JS points.
- No `Strong`/`protect`/`ensureStillAlive`; no per-call `JSFunction`/`JSNativeStdFunction`; the
  only callable is the `[reaction-convention]` handler in the closed X-macro list.
- Cross-file `_TS_CONTROLLER` contract: `jsWebStreamsHandler_onTSPerformTransformRejected` is
  registered at exactly ONE site (line 397), via
  `performPromiseThenWithContext(vm, global, jsUndefined(), handler, /*derived*/ result,
  /*contextCell*/ controller)` — the handler reads `argument(0)` = rejection and `argument(1)` =
  contextCell, matching `JSStreamsRuntime.h:11–14`'s `[reaction-convention]` argument order, and
  the group comment ("context = JSTransformStreamDefaultController", JSStreamsRuntime.h:128).
  `uncheckedDowncast` on the handler's own context is the ratified pattern (PHASE-B-LOG §4.1-fact-5
  refinement ruling). The X-macro entry `V(onTSPerformTransformRejected)` exists and no other file
  names the handler.
- Frozen signature: `JSC::JSPromise* transformStreamDefaultControllerPerformTransform(JSGlobalObject*,
  JSTransformStreamDefaultController*, JSValue chunk)` matches `WebStreamsInternals.h:389` and both
  call sites (`TransformStreamOperations.cpp:228, 322`), as do the other four op signatures
  (`WebStreamsInternals.h:384–390`).
- `visitChildrenImpl` visits all 7 GC members (`m_stream`, `m_finishPromise`, `m_transformer`,
  `m_transformMethod`, `m_flushMethod`, `m_cancelMethod`, `m_algorithmContext`); iso-subspace,
  structure, prototype and constructor boilerplate follow the subsystem template.
- `specs/check-streams.py` reports CLEAN.

---

## Verdict

1 CRITICAL: the file's private `invokePromiseReturningMethod` is the one remaining unfixed copy —
its `promiseResolvedWith(result)` tail is an unchecked user-JS point inside a live catch scope
(the exact I1 defect the concurrent sweep fixed everywhere else); 1 MAJOR: Enqueue's abrupt path
over-asserts Errored and can throw an EMPTY `[[storedError]]` reachable from a user `size()`
callback. Everything else — all five ops' step ordering, the derived-promise "reacting to" shape,
the handler contract, and the mechanism discipline — is faithful; fix the two findings in place
and the file matches the ratified subsystem patterns.
