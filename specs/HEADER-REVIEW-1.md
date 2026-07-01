# HEADER-REVIEW-1 — spec + design completeness

Reviewer lens: spec/design completeness only. Method: independently re-derived the
reaction-handler set from every `Upon fulfillment` / `Upon rejection` / `React to` /
`reacting to` / `Wait until` / `queue a microtask` site in `specs/digest/0[1-4]-*.md` and
every `performPromiseThenWithContext` / `.then(` / `queueMicrotask` / `JSBoundFunction` site
in `specs/BUN-LAYER-DESIGN.md`, and diffed it against `JSStreamsRuntime.h`; independently
verified 150/150 ops + signatures against OP-SIGNATURES.md as reconciled by PHASE-A-NOTES §3;
diffed SLOT-TABLES + the BUN-LAYER member set + the enums against every class header; diffed
the 16 Prototype/Constructor shapes against `JSCookie.h`. PHASE-A-NOTES §3's 11 resolutions
and §4's 13 inventions were treated as ratified and are not re-litigated.

**Verified clean (no findings):** all 150/150 op rows + 8/8 internal-method surfaces are
declared with signatures matching OP-SIGNATURES as reconciled (the ~35 adversarially chosen
ops — byte-controller Respond*/FillPullIntoDescriptor*/PullInto/EnqueueClonedChunkToQueue,
the WS erroring state machine, the TS default sink/source algorithms, the 8 Misc ops,
Fulfill{Read,ReadInto}Request, BYOBReaderRead, ExtractHighWaterMark/SizeAlgorithm,
readableStreamTee/PipeTo — all match); all 73 SLOT-TABLES slots + every named BUN-LAYER
member are present on the right class; all 10 enums exist with the exact ARCHITECTURE §4 /
BUN-LAYER arms (`SourceKind` has NO `Direct`); the BUN-LAYER §6 `extern "C"` block is
complete and name-exact; the §4.7/§4.8/§4.9/§4.11/§4.12 invented helpers are all declared;
all 15 constructible classes + the async iterator have the full JSCookie-shaped registration
statics, and `JSReadableStreamAsyncIterator` correctly has a Prototype and no Constructor.

---

### [CRITICAL] §3.1a's standalone Text sink cell class has no header, no forward decl, and no cached Structure

**What is missing/wrong.** BUN-LAYER-DESIGN §3.1a step 1 mandates a real internal GC cell:
"Build a fresh **standalone Text sink** … as **its own small internal cell/object, distinct
from `JSDirectStreamController`'s Text arm** … In C++: one shared **`BunTextAccumulator`**
value type owned by BOTH the standalone sink cell and `JSDirectStreamController`'s Text arm —
one implementation, two owners." §5.3 then hard-depends on it: `JSReadStreamIntoSinkOperation`'s
`m_sink` is erased and "`isNative == false` ⇒ the internal standalone Text sink of §3.1a"
(quoted verbatim in `JSReadStreamIntoSinkOperation.h:44-46`), and §5.3 step 5 calls
`sink.write(chunk)` / `sink.flush(true)` / `sink.end()` / `sink.close(e)` on it.
The header set contains **NO such class**: no header file, no forward declaration in
`StreamsForward.h:64-80`, no entry in `FOR_EACH_WEB_STREAMS_INTERNAL_STRUCTURE`
(`JSStreamsRuntime.h:258-270`), and no `BunTextAccumulator` type anywhere. Worse, the
accumulator members it is supposed to SHARE are declared as private inline fields of
`JSDirectStreamController` (`JSDirectStreamController.h:69-80`, whose own comment says
"shared with §3.1a's standalone sink") — so the "one implementation, two owners" contract
is structurally impossible against the frozen headers.

**Impact.** The `BunStreamConsumers.cpp` author (owner of `readableStreamIntoText`,
`WebStreamsInternals.h:445`) is blocked: they must invent a JSCell class + its Structure /
iso-subspace / `visitChildren` with no header to put it in and no way to reach
`JSDirectStreamController`'s private accumulator. The `WebStreamsExports.cpp` author is
also affected (`readableStreamIntoText` is the generic `toText` path behind
`ZigGlobalObject__readableStreamToText`).

**Mandated by.** BUN-LAYER-DESIGN.md §3.1a (lines 522-547, esp. 526-531) and §5.3
(lines 1027-1032). ARCHITECTURE §1.2 requires every internal cell class to have a file.

**Fix.** Add `src/jsc/bindings/webcore/streams/BunStandaloneTextSink.h` declaring

```cpp
// The shared Text accumulator (BUN-LAYER §3.1a: "one implementation, two owners").
struct BunTextAccumulator {
    WTF::StringBuilder rope; bool hasString {false}; bool hasBuffer {false};
    WTF::Vector<JSC::WriteBarrier<JSC::Unknown>> pieces;   // cellLocked
    double estimatedLength { 0 };
};
// The §3.1a standalone Text sink: the `isNative == false` m_sink of
// JSReadStreamIntoSinkOperation. Destructible (owns WTF containers).
class JSBunStandaloneTextSink final : public JSC::JSDestructibleObject {
public:
    static JSBunStandaloneTextSink* create(JSC::VM&, JSC::Structure*, JSC::JSPromise* result);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);
    // The §5.3 step-5 sink protocol (isNative == false: start/onClose wiring is skipped).
    JSC::JSValue write(JSC::JSGlobalObject*, JSC::JSValue chunk);
    JSC::JSValue flush(JSC::JSGlobalObject*, bool);
    void end(JSC::JSGlobalObject*);      // finishInternal -> withoutUTF8BOM -> resolve m_result
    void close(JSC::JSGlobalObject*, JSC::JSValue error);
    DECLARE_INFO; DECLARE_VISIT_CHILDREN;
    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM&);
    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    { if constexpr (mode == JSC::SubspaceAccess::Concurrently) return nullptr; return subspaceForImpl(vm); }
private:
    BunTextAccumulator m_accumulator;
    JSC::WriteBarrier<JSC::JSPromise> m_result;
};
```

forward-declare it in `StreamsForward.h`, add
`V(standaloneTextSinkStructure, JSBunStandaloneTextSink)` to
`FOR_EACH_WEB_STREAMS_INTERNAL_STRUCTURE`, and replace `JSDirectStreamController.h:69-80`'s
five inline Text members with one `BunTextAccumulator m_textAccumulator;`.

---

### [CRITICAL] The §3.3 one-shot `consumeDirectStreamToArrayBuffer` controller has no cell class and no bound-convention targets

**What is missing/wrong.** BUN-LAYER-DESIGN §3.3 mandates that
`readableStreamToArrayBufferDirect` (declared as `consumeDirectStreamToArrayBuffer`,
`WebStreamsInternals.h:455`) "does NOT build a persistent controller or a reader. It …
**hand-rolls a throwaway `{start,close,end,flush,write}` over a `Bun.ArrayBufferSink`**,
calls the user's `pull` **exactly once**", and — explicitly — "**It shares no state machine
with §4 — do not force it into `JSDirectStreamController`**." That throwaway object is the
`controller` argument handed to USER `pull(controller)`; its `write`/`end`/`close`/`flush`
are callables stored on an object user code holds, so per ARCHITECTURE §4.1 (the BINDING
"two callable mechanisms" rule, restated at `JSStreamsRuntime.h:8-33`) each MUST be a
`JSBoundFunction` over a **shared target in the CLOSED [bound-convention] list**. The list
(`JSStreamsRuntime.h:222-242`) contains ZERO targets for this path: the only direct-write
targets (`boundDirectWrite/Close/Flush/Error`) are owned by `JSDirectStreamController.cpp`
with `context = the JSDirectStreamController` (`JSStreamsRuntime.h:230-237`) — the exact
class §3.3 forbids using. There is also no cell class to root the `ArrayBufferSink` + the
capability promise + a `closed` flag across the pull (the only cell in scope, the reaction
context `InternalFieldTuple{stream, capabilityPromise}` at `JSStreamsRuntime.h:176-177`,
holds neither the sink nor the closed flag and is not the object handed to `pull`).

**Impact.** The `BunStreamConsumers.cpp` author is blocked twice over: they cannot allocate
a callable outside the closed lists ("A Phase-B author who needs a handler that is not
listed must STOP and report it", `JSStreamsRuntime.h:31-33`), and they have no cell/Structure
for the one-shot controller.

**Mandated by.** BUN-LAYER-DESIGN.md §3.3 (lines 609-620); ARCHITECTURE.md §4.1
(lines 396-418, "Phase-B authors may not add reaction sites or callables outside these two
mechanisms").

**Fix.** Add a `JSOneShotDirectSink` internal cell header (members:
`WriteBarrier<JSObject> m_arrayBufferSink`, `WriteBarrier<JSPromise> m_capabilityPromise`,
`WriteBarrier<JSReadableStream> m_stream`, `bool m_closed`, `bool m_asUint8Array`), an
entry in `FOR_EACH_WEB_STREAMS_INTERNAL_STRUCTURE`, and a new owner group in the
bound list:

```cpp
// owner: BunStreamConsumers.cpp — the §3.3 one-shot direct consumer's throwaway controller
// (its {write,end,close,flush} are OWN JSBoundFunctions over these; context = the
// JSOneShotDirectSink cell). §3.3 forbids reusing boundDirect* / JSDirectStreamController.
#define FOR_EACH_WEB_STREAMS_BOUND_HANDLER_TARGET_ONE_SHOT(V) \
    V(boundOneShotDirectWrite)                                \
    V(boundOneShotDirectClose)   /* `end` and `close` are two bound cells over this one */ \
    V(boundOneShotDirectFlush)
```

and append `FOR_EACH_WEB_STREAMS_BOUND_HANDLER_TARGET_ONE_SHOT(V)` to
`FOR_EACH_WEB_STREAMS_BOUND_HANDLER_TARGET`. (If the maintainer instead RESCINDS §3.3's
"do not force it into JSDirectStreamController", say so in PHASE-A-NOTES and change the
`onConsumeDirectToArrayBufferPull*` context annotation to the controller — but one of the
two must change before freeze.)

---

### [CRITICAL] No reaction handler exists for `readableStreamIntoArray`'s `readMany()` continuation loop

**What is missing/wrong.** `readableStreamIntoArray` is declared for `BunStreamConsumers.cpp`
at `WebStreamsInternals.h:447`. Its mandated body is an ASYNC LOOP: "`readableStreamIntoArray
(stream)` (RSI:2437-2452): `getReader()` → `readMany()` → append `value` until `done`, then
release. **`readMany`-batched**" (BUN-LAYER §3.1, `toArray` row), and BUN-LAYER §7.1 confirms
`readMany` "is used by `readStreamIntoSink` (§5.3), **`readableStreamIntoArray` (§3.1
`toArray`)**, and the async iterator". `readMany()` returns "synchronously **or as a
Promise**" (§7.1 header), so continuing the loop after an asynchronous `readMany` requires a
[reaction-convention] handler. `FOR_EACH_WEB_STREAMS_REACTION_HANDLER_BUN_CONSUMERS`
(`JSStreamsRuntime.h:178-189`) has NO entry for it: `onDirectConsumeLoopRead{Fulfilled,
Rejected}` are documented (line 174-175) as "the **§3.3** readableStreamTo{Text,Array}
**Direct** read loop" (a `reader.read()` loop feeding a direct sink — a different result
shape and a different accumulator), `onReadableStreamToArrayBufferFulfilled` reacts to
`readableStreamToArray`'s RESULT (the OUTER `result.then(toArrayBuffer)` at RS:207-213), and
`readStreamIntoSink`'s handlers belong to a different owner and cell. `readableStreamIntoArray`
is also the ONLY generic step-5 body for `Bun.readableStreamToArray` (which
`ZigGlobalObject__readableStreamToArray`, `toArrayBuffer`, `toBytes`, and `toBlob` all
route through) — the whole generic non-fast-path consumer set is blocked behind it.

**Mandated by.** BUN-LAYER-DESIGN.md §3.1 `toArray` row (lines 478-481), §7.1 (lines
1302-1304); ARCHITECTURE §4.1 closes the reaction list.

**Fix.** Add to `FOR_EACH_WEB_STREAMS_REACTION_HANDLER_BUN_CONSUMERS`
(`JSStreamsRuntime.h:189`), with the group comment extended accordingly:

```cpp
    V(onIntoArrayReadManyFulfilled)   /* §3.1 readableStreamIntoArray: append value,
                                         if !done re-call readMany; else release + resolve.
                                         context = InternalFieldTuple{reader, resultArray} */ \
    V(onIntoArrayReadManyRejected)    /* release the reader, reject the result promise */
```

---

### [MAJOR] readMany's Direct-controller branch (§7.1 step 3) has no assigned reaction handler

**What is missing/wrong.** BUN-LAYER-DESIGN §7.1 defines TWO distinct promise-reaction sites
inside `readMany()`:
- **step 3** (`ControllerKind::Direct` and not `Closed`, RSDR:63-68):
  `directController->onPull().then(({done,value}) => done ? {done:true, value: value?[value]:[],
  size:0} : {value:[value], size:1, done:false})` — also called out in the §4.7 dispatch table
  (line 927: "the 'direct controller not yet started' branch: `directController->onPull()
  .then(...)` (§7.1 step 3)").
- **step 7** (queue empty, readable): `p = controller.$pull(controller)` → `.then(onPullMany)`,
  where `onPullMany` "prepend[s] the resolved chunk to whatever the pull enqueued, normalize,
  pull-if-needed, resetQueue".

The header declares exactly ONE readMany handler and pins it to step 7:
`JSStreamsRuntime.h:165-167` — "owner: JSReadableStreamDefaultReader.cpp (**readMany step 7**).
context = the reader. `V(onReadManyPullFulfilled)`". The two sites map completely different
resolution values into completely different result shapes; the step-3 site is unassigned, and
a Phase-B author following the header's own "STOP and report" rule (`JSStreamsRuntime.h:31-33`)
cannot add one.

**Mandated by.** BUN-LAYER-DESIGN.md §7.1 step 3 (lines 1286-1289) and the §4.7 `readMany`
row (line 927); ARCHITECTURE §4.1.

**Fix.** Either add
`V(onReadManyDirectPullFulfilled)  /* §7.1 step 3: map the direct onPull() {done,value} into the readMany result; context = the reader */`
to `FOR_EACH_WEB_STREAMS_REACTION_HANDLER_READER`, **or** change line 166's annotation to
"(readMany steps 3 **and** 7; the handler branches on `reader->stream()->controllerKind()`)"
so the author knows one handler is intended to cover both. As frozen it covers neither
readable-and-defensible interpretation.

---

### [MAJOR] `m_instanceStructure` count: the headers say 10 constructors carry it, the ratified PHASE-A-NOTES says 8 — twice

**What is missing/wrong.** `JSTextEncoderStreamConstructor` (`JSTextEncoderStream.h:106`) and
`JSTextDecoderStreamConstructor` (`JSTextDecoderStream.h:109`) each carry `m_instanceStructure`
+ their own `subspaceForImpl` (correctly — both classes are `new`-able per BUN-LAYER §9.2 and
are listed "+P+C", not "throwing C", in PHASE-A-NOTES §1 lines 44-45). That makes **10**
constructors with the member, not 8. Two BINDING statements in PHASE-A-NOTES disagree with
the headers they describe:
- §1 "Phase-C obligations" (lines 52-55): "`DOMIsoSubspaces.h` / `DOMClientIsoSubspaces.h`
  entries for every `subspaceForImpl` above (18 instance classes + **8 constructible
  constructors**)".
- The §4.6 ruling (lines 253-257 / 302-304): "**ONLY the 8** user-constructible classes'
  constructors carry the cached `m_instanceStructure`".

A Phase-C author who follows the ratified "8" literally registers exactly 8 constructor
iso-subspaces; `JSTextEncoderStreamConstructor::subspaceForImpl` and
`JSTextDecoderStreamConstructor::subspaceForImpl` then have no definition (they cannot share
`JSDOMConstructorBase`'s subspace — the extra `WriteBarrier` changes the cell size that
`JSDOMConstructorBase.h`'s `static_assert(sizeof(CellType) == sizeof(JSDOMConstructorBase))`
enforces), and the build fails or the registration is wrong.

**Mandated by.** BUN-LAYER-DESIGN.md §9.2 (TE/TD are user-constructible); PHASE-A-NOTES.md
lines 52-55, 253-257, 302-304.

**Fix.** The headers are correct; correct the two counts in PHASE-A-NOTES.md before freeze:
"18 instance classes + **10** constructible constructors" and "ONLY the **10**
user-constructible classes (the 8 spec classes + `TextEncoderStream` + `TextDecoderStream`)".

---

### [MINOR] ARCHITECTURE says the two closed handler lists are declared in `WebStreamsInternals.h`; they are only in `JSStreamsRuntime.h`

**What is missing/wrong.** ARCHITECTURE §4.1's closing sentence (line 418):
"**`WebStreamsInternals.h` declares**, and `JSStreamsRuntime` owns, both closed handler
lists." The X-macros and every `JSC_DECLARE_HOST_FUNCTION(jsWebStreamsHandler_*)` live only
in `JSStreamsRuntime.h:53-250`; `WebStreamsInternals.h` neither declares nor includes them.
PHASE-A-NOTES §3.8 relocates the ENUMS to `StreamsForward.h` but says nothing about the
handler lists, so this is not one of the 11 ratified deviations.

**Impact.** Negligible in practice: every owner `.cpp` that defines a handler already needs
`JSStreamsRuntime.h` for the accessor. It contradicts the "one frozen ABI header" statement
only.

**Mandated by.** ARCHITECTURE.md §4.1 line 418.

**Fix.** Either add `#include "JSStreamsRuntime.h"` to `WebStreamsInternals.h`, or (better)
add a 12th entry to PHASE-A-NOTES §3 recording the deliberate relocation.

---

## Handler-list diff

### [reaction-convention] — my independently derived required set (48 spec + 25 Bun = 73) vs the header's 68

Legend: `[F]`=fulfillment, `[R]`=rejection, `[µ]`=queue-a-microtask job, `[RP]`=needs a real
result promise at the registration site. Context is what the handler must reach.

**Spec core (from `specs/digest/0[1-4]-*.md`)** — 40 sites, all PRESENT:

| digest site | need | context | header entry |
|---|---|---|---|
| 02:588 `ReadableStreamCancel` step 8 "reacting to sourceCancelPromise, fulfillment returns undefined" | F, RP | none | `onReturnUndefined` |
| 02:857/862 `SetUpReadableStreamDefaultController` startPromise | F+R | RSDefaultController | `onRSDefaultControllerStartFulfilled/Rejected` |
| 02:756/761 `ReadableStreamDefaultControllerCallPullIfNeeded` pullPromise | F+R | RSDefaultController | `onRSDefaultControllerPullFulfilled/Rejected` |
| 02:1336/1341 `SetUpReadableByteStreamController` startPromise | F+R | RSByteController | `onRSByteControllerStartFulfilled/Rejected` |
| 02:893/898 `ReadableByteStreamControllerCallPullIfNeeded` pullPromise | F+R | RSByteController | `onRSByteControllerPullFulfilled/Rejected` |
| 02:121 `ReadableStreamFromIterable` pullAlgorithm "reacting to nextPromise" | F, RP | the default controller (→`JSStreamFromIterableContext`) | `onFromIterablePullFulfilled` |
| 02:140 `ReadableStreamFromIterable` cancelAlgorithm "reacting to returnPromise" | F, RP | same | `onFromIterableCancelFulfilled` |
| 01:319-329 `ReadableStreamDefaultTee` pull chunkSteps "Queue a microtask" (02:~330) | µ | `JSStreamTeeState` | `onDefaultTeeReadChunkMicrotask` |
| 02:362 default tee "Upon rejection of reader.[[closedPromise]]" | R | `JSStreamTeeState` | `onDefaultTeeReaderClosedRejected` |
| 02:~440 byte tee `pullWithDefaultReader` chunkSteps "Queue a microtask" | µ | `JSStreamTeeState` | `onByteTeeReadChunkMicrotask` |
| 02:~490 byte tee `pullWithBYOBReader` chunkSteps "Queue a microtask" | µ | `JSStreamTeeState` | `onByteTeeReadIntoChunkMicrotask` |
| 02:383 byte tee `forwardReaderError` "Upon rejection of thisReader.[[closedPromise]]" | R | `InternalFieldTuple{teeState, thisReader}` | `onByteTeeReaderClosedRejected` |
| 02:235 pipeTo "shutdown with an action: Upon fulfillment of p" | F | pipe op | `onPipeShutdownActionFulfilled` |
| 02:236 pipeTo "shutdown with an action: Upon rejection of p" | R | pipe op | `onPipeShutdownActionRejected` |
| 02:232, 02:244 pipeTo "Wait until every chunk that has been read has been written" | F (per pending write) | pipe op | `onPipeWritesFinishedForShutdown` |
| 02:203-205 pipeTo "Errors must be propagated forward: if source.[[state]] becomes errored" (react to `reader.[[closedPromise]]`) | R | pipe op | `onPipeSourceClosedRejected` |
| 02:213-216 pipeTo "Closing must be propagated forward: if source.[[state]] becomes closed" | F | pipe op | `onPipeSourceClosedFulfilled` |
| 02:207-209 pipeTo "Errors must be propagated backward: if dest.[[state]] becomes errored" (react to `writer.[[closedPromise]]`) | R | pipe op | `onPipeDestClosedRejected` |
| 02:217-224 pipeTo "Closing must be propagated backward" | F | pipe op | `onPipeDestClosedFulfilled` |
| 02:184-187 pipeTo "Backpressure must be enforced" (wait for writer ready) | F | pipe op | `onPipeWriterReadyFulfilled` |
| ARCH §5.1 "the reference pipe reacts to EVERY [[writeRequests]] promise" | F+R (one handler for both) | pipe op | `onPipeWriteSettled` |
| 01:302-330 WebIDL async-iterator `next()` "react to object's ongoing promise" | F+R | the iterator | `onAsyncIteratorNextAfterOngoingSettled` |
| 01:333-343 WebIDL async-iterator `return()` after ongoing promise | F+R | the iterator | `onAsyncIteratorReturnAfterOngoingSettled` |
| 01:338-340 async-iterator return step 4.1 (`ReadableStreamReaderGenericCancel` result → `{value: arg, done: true}`) | F, RP | the iterator | `onAsyncIteratorCancelFulfilled` |
| 03:597/601 `SetUpWritableStreamDefaultController` startPromise | F+R | WSController | `onWSControllerStartFulfilled/Rejected` |
| 03:689/691 `WSDefaultControllerProcessClose` sinkClosePromise | F+R | WSController | `onWSSinkCloseFulfilled/Rejected` |
| 03:699/708 `WSDefaultControllerProcessWrite` sinkWritePromise | F+R | WSController | `onWSSinkWriteFulfilled/Rejected` |
| 03:398/401 `WritableStreamFinishErroring` reaction to the `[[AbortSteps]]` promise | F+R | the WritableStream | `onWSAbortStepsFulfilled/Rejected` |
| 04:287 `TransformStreamDefaultSinkWriteAlgorithm` "reacting to backpressureChangePromise" | F, RP | `InternalFieldTuple{transformStream, chunk}` | `onTSSinkWriteBackpressureChangeFulfilled` |
| 04:303 `TransformStreamDefaultSinkAbortAlgorithm` "React to cancelPromise" | F+R | TransformStream | `onTSSinkAbortCancelFulfilled/Rejected` |
| 04:322 `TransformStreamDefaultSinkCloseAlgorithm` "React to flushPromise" | F+R | TransformStream | `onTSSinkCloseFlushFulfilled/Rejected` |
| 04:343 `TransformStreamDefaultSourceCancelAlgorithm` "React to cancelPromise" | F+R | TransformStream | `onTSSourceCancelFulfilled/Rejected` |
| 04:266 `TransformStreamDefaultControllerPerformTransform` "reacting to transformPromise with rejection steps" | R, RP | TSController | `onTSPerformTransformRejected` |
| 04:640 `SetUpCrossRealmTransformWritable` writeAlgorithm "reacting to backpressurePromise" | F, RP | `JSCrossRealmTransformState` | `onCrossRealmWritableBackpressureFulfilled` |

Spec-core sites with NO reaction handler required (verified deliberately): every read
request / read-into request (chunk/close/error steps — `JSReadRequest`/`JSReadIntoRequest`
kinds, not reactions); `ReadableStreamCancel` step 5's BYOB drain; the default tee's
`cancelPromise` (resolved by adoption); `WritableStreamAbort` (stores the pending-abort
struct, no reaction); every "return a promise resolved with undefined"; the pipeTo abort
algorithm (a GC-visited `AbortAlgorithm`, not a reaction).

**Bun layer (from `specs/BUN-LAYER-DESIGN.md`)** — 25 required, **22 present, 3 MISSING**:

| BUN-LAYER site | need | header entry |
|---|---|---|
| §5.2 step 9 `readDirectStream` `promise.then(noop)` (line 1002-1004) | F, RP | `onReturnUndefined` |
| §2.4 step 5 `handle.pull()` promise (lines 373-378) | F+R | `onNativePullFulfilled/Rejected` |
| §2.4 steps 1/decode `queueMicrotask(callClose)` (lines 364, 389, 396) | µ | `onNativeSourceCallCloseMicrotask` |
| §5.3 step 2 `await many` (readMany promise) (lines 1043-1046) | F | `onReadStreamIntoSinkReadManyFulfilled` |
| §5.3 step 5 `await reader.read()` (line 1048) | F | `onReadStreamIntoSinkReadFulfilled` |
| §5.3 step 5 `await sink.flush(true)` (line 1051) | F | `onReadStreamIntoSinkFlushFulfilled` |
| §5.3 step 7 `catch(e)` for all of the above (lines 1065-1073) | R (shared) | `onReadStreamIntoSinkRejected` |
| §5.4 `resumableSinkDrain` loop `await reader.read()` (lines 1120-1122) | F+R | `onResumableSinkReadFulfilled/Rejected` |
| §5.4 `queueMicrotask(end(e))` (lines 1123, 1127) | µ | `onResumableSinkEndMicrotask` |
| §4.3 step 5 `onPullDirectStream` pull-promise rejection (lines 761-791) | R, RP (deliberately unhandled) | `onDirectPullRejected` |
| §3.2 buffered fast path `.catch(catchH)` (lines 578-579) | R, RP | `onBufferedFastPathRejected` |
| §3.2 buffered fast path `.finally(finallyH)` (line 580) | settled, RP | `onBufferedFastPathSettled` |
| §3.1 `toArrayBuffer` generic `result.then(toArrayBuffer)` (line 492) | F, RP | `onReadableStreamToArrayBufferFulfilled` |
| §3.1 `toBytes` generic (lines 496-500) | F, RP | `onReadableStreamToBytesFulfilled` |
| §3.1 `toJSON` generic `text.then(JSON.parse)` (line 502) | F, RP | `onReadableStreamToJSONFulfilled` |
| §3.1 `toBlob` generic `.then(a => new Blob(a))` (line 506) | F, RP | `onReadableStreamToBlobFulfilled` |
| §3.1 `toFormData` `.then(b => FormData.from(b, contentType))` (line 509) | F, RP | `onReadableStreamToFormDataFulfilled` |
| §3.3 `readableStreamTo{Text,Array}Direct` `await read()` loop (lines 597-608) | F+R | `onDirectConsumeLoopReadFulfilled/Rejected` |
| §3.3 `readableStreamToArrayBufferDirect` one-shot pull settlement (lines 614-620) | F+R | `onConsumeDirectToArrayBufferPullFulfilled/Rejected` |
| §7.1 step 7 `controller.$pull().then(onPullMany)` (lines 1297-1300) | F | `onReadManyPullFulfilled` |
| **§3.1 `readableStreamIntoArray` `readMany()` continuation loop (lines 478-481; §7.1 line 1303)** | **F+R** | **MISSING (2 handlers)** — see CRITICAL #3 |
| **§7.1 step 3 (Direct) `directController->onPull().then(mapper)` (lines 1286-1289; §4.7 line 927)** | **F** | **MISSING (1 handler)** — see MAJOR #4 |

**Reaction-convention verdict: 3 required handlers MISSING; 0 header entries are dead weight**
(every one of the 68 has a mandating site above).

### [bound-convention] — derived required set (~13-14) vs the header's 10

| BUN-LAYER site | header entry |
|---|---|
| §2.2 `handle.onClose` (lines 313-319, 337; §2.4 lines 419-425) | `boundOnNativeSourceClose` |
| §2.2 `handle.onDrain` (lines 313-319, 337) | `boundOnNativeSourceDrain` |
| §5.2 step 2's JSSink `onClose` (lines 968-976, 1013) | `boundReadDirectStreamOnClose` |
| §5.3 steps 2/4's JSSink `onClose` (lines 1043-1047, 1096-1099) | `boundReadStreamIntoSinkOnClose` |
| §5.4 `sink.setHandlers(boundDrain, …)` (lines 1136-1141) | `boundResumableSinkDrain` |
| §5.4 `sink.setHandlers(…, boundCancel)` (lines 1136-1141) | `boundResumableSinkCancel` |
| §4.2 `controller.write` (line 719) | `boundDirectWrite` |
| §4.2 `controller.end` + `controller.close` (lines 720-721: "two bound cells over one target") | `boundDirectClose` |
| §4.2 `controller.flush` (line 722) | `boundDirectFlush` |
| §4.2 `controller.error` (line 723) | `boundDirectError` |
| **§3.3 one-shot throwaway controller's `write`/`end`/`close`/`flush` (lines 611-616)** | **MISSING (~3 targets)** — see CRITICAL #2 |

**Bound-convention verdict: ~3 required targets MISSING; 0 header entries are dead weight.**

---

## Verdict

**NO — do not freeze as-is.** The 4 declaration gaps (CRITICAL #1-3, MAJOR #4) each hard-block
the `BunStreamConsumers.cpp` and/or `JSReadableStreamDefaultReader.cpp` Phase-B author against
a CLOSED list they are forbidden to extend; MAJOR #5's "8" count silently breaks Phase-C.
All five fixes are additive one-liners / doc corrections (plus one small new internal-cell
header) — after applying them and the two `PHASE-A-NOTES` count corrections, the set is
safe to freeze: the spec-core surface (150 ops, 73 slots, all enums, all 16 registration
shapes, and every one of the 40 spec-mandated reaction sites) verified complete.
