# Adversarial review — lens A: SPEC-STEP FIDELITY
## Target: `src/jsc/bindings/webcore/streams/TransformStreamOperations.cpp`
## Ground truth: `specs/digest/04-transform-queuing-support.md` (WHATWG transcription), `specs/BUN-LAYER-DESIGN.md` §9.2, the frozen headers (`WebStreamsInternals.h`, `JSStreamsRuntime.h`)

Method: every op in the file was put side-by-side with its numbered digest steps
(digest lines 163–361) and diffed step-by-step, including both "always diverge"
hot spots (SinkWrite's backpressure-wait chain; SinkAbort/SinkClose/SourceCancel's
react-then-settle-both-sides sequences) and all seven `_TS_OPERATIONS` reaction
handlers against their registration sites' context/field indices.

`python3 specs/check-streams.py <file>` → CLEAN.

No CRITICAL. No MAJOR. Three MINOR findings, none observably divergent at runtime.

---

### [MINOR] `_TS_OPERATIONS` handlers — registration context contradicts the frozen header's documented contract

The frozen header, `JSStreamsRuntime.h:115-117`:

> ```
> // owner: TransformStreamOperations.cpp. context = the JSTransformStream, EXCEPT
> // onTSSinkWriteBackpressureChangeFulfilled, whose context is an
> // InternalFieldTuple{transformStream, chunk}.
> ```

i.e. per the header, only ONE of the seven handlers takes a tuple; the other six take the
bare `JSTransformStream`.

The .cpp registers FOUR of them with an `InternalFieldTuple{stream, reason}` instead:

```cpp
// transformStreamDefaultSinkAbortAlgorithm, line 243-245
auto* context = InternalFieldTuple::create(vm, globalObject->internalFieldTupleStructure(), stream, reason);
cancelPromise->performPromiseThenWithContext(vm, globalObject, runtime->onTSSinkAbortCancelFulfilled(), runtime->onTSSinkAbortCancelRejected(), jsUndefined(), context);
```
```cpp
// transformStreamDefaultSourceCancelAlgorithm, line 282-284
auto* context = InternalFieldTuple::create(vm, globalObject->internalFieldTupleStructure(), stream, reason);
cancelPromise->performPromiseThenWithContext(vm, globalObject, runtime->onTSSourceCancelFulfilled(), runtime->onTSSourceCancelRejected(), jsUndefined(), context);
```

and the four handler bodies (`onTSSinkAbortCancelFulfilled/Rejected` at lines 329-331,
350; `onTSSourceCancelFulfilled/Rejected` at 395-397, 417) correspondingly do
`uncheckedDowncast<InternalFieldTuple>(callFrame->argument(1))->getInternalField(0/1)`.

**Divergence.** Handler ↔ registration DO agree on every field index (I checked all
four: field 0 = stream, field 1 = reason; the rejected handlers take `r` from
`argument(0)` and only `stream` from field 0 — all correct per digest steps
7.1.2.1/7.2.1 of SinkAbort and 7.1.2.1/7.2.1 of SourceCancel). So there is no
runtime bug TODAY. But the file violates the frozen header's stated contract for
`onTSSinkAbortCancelFulfilled`, `onTSSinkAbortCancelRejected`,
`onTSSourceCancelFulfilled`, `onTSSourceCancelRejected`. Anyone adding a second
registration site from the header comment (passing the bare `JSTransformStream`)
would hit `uncheckedDowncast<InternalFieldTuple>` type confusion on a
`JSTransformStream` cell. Only `onTSSinkCloseFlush{Fulfilled,Rejected}` actually
match the header's "context = the JSTransformStream".

Note the .cpp is arguably RIGHT and the header WRONG: the digest requires `reason`
inside the reaction (SinkAbort 7.1.2.1 "Perform !
ReadableStreamDefaultControllerError(readable.[[controller]], **reason**)";
SourceCancel 7.1.2.1 likewise), and a bare-stream context has nowhere to carry it.

**Minimal fix.** Update `JSStreamsRuntime.h:115-117` to:
"context = the JSTransformStream for onTSSinkCloseFlush{Fulfilled,Rejected};
an InternalFieldTuple{transformStream, chunk} for
onTSSinkWriteBackpressureChangeFulfilled; an InternalFieldTuple{transformStream,
reason} for onTSSinkAbortCancel* and onTSSourceCancel*." (If the header is truly
frozen and unamendable, the .cpp instead needs a different reason channel — but
there is none that is spec-faithful, so the comment is the bug.)

---

### [MINOR] `createTransformStream` — CreateTransformStream steps 1–2 (`Assert: ! IsNonNegativeNumber(HWM)`) omitted

BUN-LAYER §9.2 defines this function as "the spec abstract op **CreateTransformStream**
(`TransformStreamInternals.ts:37-79`)". That reference implementation's first substantive
steps (== the AO's steps 1–2) are:

> ```js
> $assert(writableHighWaterMark >= 0);
> $assert(readableHighWaterMark >= 0);
> ```

`TransformStreamOperations.cpp:102-111`:

```cpp
JSTransformStream* createTransformStream(JSGlobalObject* globalObject, TransformerKind kind, JSCell* algorithmContext, double writableHighWaterMark, JSObject* writableSizeAlgorithm, double readableHighWaterMark, JSObject* readableSizeAlgorithm)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* domGlobalObject = defaultGlobalObject(globalObject);

    auto* stream = JSTransformStream::create(vm, WebCore::getDOMStructure<JSTransformStream>(vm, *domGlobalObject));
    auto* startPromise = JSPromise::create(vm, globalObject->promiseStructure());
```

**Divergence.** No `ASSERT(writableHighWaterMark >= 0)` / `ASSERT(readableHighWaterMark
>= 0)`. Debug-assert-only, and every current caller passes the header defaults
(`1`, `0`), so nothing is observable — but it is a spec-`Assert`-implied guard the
digest/AO family specifies and the implementation dropped. Every OTHER `Assert:` in
this file's ops IS mirrored (`ASSERT(stream->m_backpressure != backpressure)`,
`ASSERT(!stream->m_controller)`, `ASSERT(stream->m_writable->m_state == Writable)`,
`ASSERT(writable->m_state == Writable)` in the backpressure handler,
`ASSERT(stream->m_backpressure)` + `ASSERT(stream->m_backpressureChangePromise)` in
SourcePull), which makes the omission an inconsistency, not a policy.

**Minimal fix.** Add
```cpp
ASSERT(writableHighWaterMark >= 0);
ASSERT(readableHighWaterMark >= 0);
```
at the top of `createTransformStream`.

---

### [MINOR] `createTransformStream` — allocates + resolves a `startPromise`; BUN-LAYER §9.2 says "no promise is allocated"

BUN-LAYER §9.2, describing exactly this function for the TextEncoder/TextDecoder arms:

> The transformer's start step for these kinds is trivial (resolved-undefined) — §4.1
> fact 6: **no promise is allocated.**

(§4.1 fact 6, ARCHITECTURE.md: "'React to a promise resolved with X' where X is a
non-thenable we constructed … needs **no promise at all**: queue one native microtask
directly.")

`TransformStreamOperations.cpp:109-121`:

```cpp
auto* startPromise = JSPromise::create(vm, globalObject->promiseStructure());
initializeTransformStream(globalObject, stream, startPromise, ...);
...
// The internal kinds' start algorithm is trivial.
resolvePromise(globalObject, startPromise, jsUndefined());
```

**Divergence.** A `JSPromise` cell is allocated per internal TransformStream (i.e. per
`new TextEncoderStream()` / `new TextDecoderStream()`) that §9.2 says should not exist;
the design intends `startResult = jsUndefined()` handed straight to
`createReadableStream`/`createWritableStream` (both already accept `JSC::JSValue
startResult`, and ARCHITECTURE §4 says the fact-6 elision applies there).

**Not observable**: performPromiseThen-on-pending followed by resolve-with-undefined
queues exactly one reaction job, same as fact 6's "queue one native microtask" — so
microtask ordering is identical either way. Also, the impl arguably HAD no choice:
the frozen `WebStreamsInternals.h:369` declares
`initializeTransformStream(..., JSC::JSPromise* startPromise, ...)`, which forces a
real `JSPromise` through this path. So this is a header-vs-§9.2 contradiction that the
implementation resolved in the header's favor. Flagged so the discrepancy is recorded,
not as a behavior bug.

**Minimal fix.** Either (a) amend §9.2 to drop the "no promise is allocated" claim for
this arm (it conflicts with the frozen `initializeTransformStream` signature), or (b)
have `createTransformStream` bypass `initializeTransformStream` and pass
`jsUndefined()` as `startResult` to the two inner `create*Stream` calls directly.
(a) is the cheaper, behavior-preserving fix.

---

## Ops verified clean

Every numbered step diffed against digest 04 lines 163–361; found faithful:

- **`initializeTransformStream`** — digest §InitializeTransformStream steps 1–11. Writable
  created before readable (5 before 8); step 9's "set [[backpressure]] and
  [[backpressureChangePromise]] to undefined" realized as `m_backpressure = false` +
  `.clear()` (the digest's own Note at 179 explicitly blesses the strictly-boolean
  variant, and it keeps `transformStreamSetBackpressure`'s step-1 `Assert` satisfied);
  step 10 `SetBackpressure(true)`; step 11 `m_controller.clear()` last. ✓
- **`transformStreamError`** — steps 1–2, right objects (`readable`'s default controller,
  then `ErrorWritableAndUnblockWrite`). ✓
- **`transformStreamErrorWritableAndUnblockWrite`** — steps 1–3 in order:
  ClearAlgorithms(controller) → `WSDCErrorIfNeeded(stream.[[writable]].[[controller]], e)`
  → UnblockWrite. ✓
- **`transformStreamSetBackpressure`** — steps 1–4 verbatim, incl. the step-1 `Assert`
  and the step-2 "if not undefined" guard. Returns the NEW promise only via the slot. ✓
- **`transformStreamUnblockWrite`** — step 1. ✓
- **`setUpTransformStreamDefaultController`** — steps 2–4 (`ASSERT(!stream->m_controller)`,
  set `controller.[[stream]]`, set `stream.[[controller]]`); step 1 is the static type;
  steps 5–7 are the `TransformerKind`/method-member encoding. ✓
- **`setUpTransformStreamDefaultControllerFromTransformer`** — non-object transformer →
  `Identity` (= the spec's default enqueue transform + resolved-undefined flush/cancel);
  object → `JavaScript` with per-member `transform`/`flush`/`cancel` capture; step 8. ✓
- **`performFlushAlgorithm` / `performCancelAlgorithm`** — digest §SetUp…FromTransformer
  steps 3–4 (defaults = resolved-undefined) and 6–7 (invoke with «controller» /
  «reason», callback-this = transformer). WebIDL abrupt-completion → rejected promise via
  `invokePromiseReturningMethod`. TextEncoder/TextDecoder have flush arms and NO cancel
  arm, exactly per BUN-LAYER §9.2. ✓
- **`transformStreamDefaultSinkWriteAlgorithm`** — steps 1–4 token-for-token, including
  the backpressure-wait chain: step-1 assert; step 3.2 assert on
  `backpressureChangePromise`; step 3.3 = a fresh derived promise `result` reacted with
  ONLY a fulfillment handler (`onRejected = jsUndefined()`), returned; step 4 the direct
  `PerformTransform`. Fulfillment handler = steps 3.3.1–3.3.5: reads `stream.[[writable]]`,
  `"erroring"` → **throw** `writable.[[storedError]]` (rejects the derived promise),
  assert `"writable"`, return `PerformTransform(controller, chunk)`. Context tuple
  `{stream, chunk}` and field indices agree at both ends. Correct state (`Erroring`, not
  `Errored`). ✓
- **`transformStreamDefaultSinkAbortAlgorithm`** — steps 1–8: finishPromise memo-return;
  finishPromise created BEFORE the cancel algorithm runs (so a reentrant abort from the
  user's `cancel()` sees it); ClearAlgorithms after; reaction fulfilled = 7.1
  (readable `"errored"` → **reject** finish with `readable.[[storedError]]`; else
  `RSDCError(readable.controller, reason)` then **resolve** finish), rejected = 7.2
  (`RSDCError(readable.controller, r)` then **reject** finish with `r`). Order, object,
  and resolve-vs-reject all correct. ✓
- **`transformStreamDefaultSinkCloseAlgorithm`** — steps 1–8: same shape with the flush
  algorithm; fulfilled = 7.1 (readable `"errored"` → reject with `readable.[[storedError]]`;
  else `RSDCClose(readable.controller)` then resolve), rejected = 7.2
  (`RSDCError` then reject with `r`). Uses the CLOSE op (not error) on the happy path. ✓
- **`transformStreamDefaultSourceCancelAlgorithm`** — steps 1–8: fulfilled = 7.1
  (writable `"errored"` → reject with `writable.[[storedError]]`; else
  `WSDCErrorIfNeeded(writable.controller, reason)` → `UnblockWrite` → resolve),
  rejected = 7.2 (`WSDCErrorIfNeeded(…, r)` → `UnblockWrite` → reject with `r`).
  The `UnblockWrite` is present on BOTH arms and precedes settling, per spec. It correctly
  operates on the **writable** side (contrast SinkAbort, which operates on the readable). ✓
- **`transformStreamDefaultSourcePullAlgorithm`** — steps 1–4 incl. both asserts;
  `SetBackpressure(false)` BEFORE the read of `[[backpressureChangePromise]]`, so it
  returns the freshly-created promise, as the spec requires. ✓
- **All 7 `_TS_OPERATIONS` reaction handlers** — each body does exactly its registration
  site's "Upon fulfillment/rejection" sub-steps with the right context type and field
  indices (see finding 1 for the header-comment caveat).

Out of scope for this file (implemented elsewhere, per `WebStreamsInternals.h`'s owner
annotations): `TransformStreamDefaultControllerEnqueue` / `…Error` /
`…PerformTransform` / `…Terminate` / `…ClearAlgorithms`, the constructor, and the
`SinkKind::Transform` / `SourceKind::Transform` dispatch tables.

## Verdict

The file is a faithful, step-for-step transcription of digest 04's 13 transform ops; both
classic divergence hot spots (SinkWrite's backpressure-wait chain, and the
SinkAbort/SinkClose/SourceCancel react-then-settle sequences) are correct in order,
object, state, and resolve-vs-reject polarity. The only findings are three MINORs: a
stale reaction-context contract in the frozen `JSStreamsRuntime.h` comment, two dropped
`Assert`-implied HWM guards in `createTransformStream`, and a `startPromise` allocation
that BUN-LAYER §9.2 says should not exist (forced by the frozen
`initializeTransformStream` signature; not observable).
