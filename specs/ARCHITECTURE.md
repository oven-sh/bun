# Web Streams C++ Rewrite — Architecture (v2)

Status: **v2** — v1 plus the merged fixes from three independent analyses that all ran BEFORE
any code was written: `specs/ARCH-SELF-REVIEW.md` (author), `specs/ARCH-REVIEW.md` (adversarial
reviewer; verified its JSC-API claims against the vendored fork source, not from memory), and
the 10 discrepancies in `specs/OP-SIGNATURES.md`. All three independently found the same core
defects, which is the confidence signal that let v2 freeze the answers.

FROZEN once Phase A (headers) is applied. `.cpp` writers must not deviate from this document or
from the frozen headers. A `.cpp` writer that believes a decision here is wrong must STOP and
report — never improvise.

All former `TBD(...)` markers are RESOLVED (see Appendix A for the scope decisions). The last
input Phase A waits on is `specs/BUN-LAYER-DESIGN.md` (+ its adversarial review), which is the
Bun-native counterpart of this document. Phase A does not freeze without it.

---

## 0. Goal

Replace Bun's Web Streams (~6,100 lines of JS builtins in `src/js/builtins/*.ts` + ~5,800 lines
of DOM-wrapper C++ in `src/jsc/bindings/webcore/*Stream*`) with a from-scratch, spec-complete,
pure-C++ implementation:

- **Zero JS builtins.** `ReadableStream*.ts`, `WritableStream*.ts`, `TransformStream*.ts`,
  `ReadableByteStream*.ts`, `StreamInternals.ts`, `ByteLengthQueuingStrategy.ts`,
  `CountQueuingStrategy.ts` are deleted.
- **Zero DOM-wrapper indirection.** The refcounted "impl" objects (`ReadableStream.{h,cpp}`,
  `WritableStream.{h,cpp}`, `InternalWritableStream.{h,cpp}`, `ReadableStreamDefaultController.{h,cpp}`,
  `ReadableStreamSource/Sink.{h,cpp}`) are deleted. `JSReadableStream` IS the ReadableStream —
  one GC cell, no wrapped impl, no `RefCounted`, no `toWrapped`.
- Spec-compliant per the WHATWG Streams Standard as transcribed VERBATIM in
  `specs/digest/0[1-4]-*.md` — the ONLY spec source for implementers. Do not consult external
  sources; do not consult the OLD implementation (it deviates from spec in places).
- Preserves 100% of Bun's extensions (`type:"direct"`, lazy native sources, `type:"bytes"` with
  native byte sources, the JSSink family, `Bun.readableStreamTo*` fast paths) and every
  consumer in `specs/CONSUMERS.md`.

### Baseline to beat (see `specs/BASELINE.md`; measured, not estimated)

| construct | today: JS objects / heap bytes | v2 target |
|---|---|---|
| `new ReadableStream({start,pull,cancel})` | 17 / 964 B | **2 cells** (stream + controller) |
| `new WritableStream({write})` | 30 / 1313 B | **2 cells** |
| `new TransformStream()` | 61 / 2816 B | **7 cells** + 2 spec-required promises |
| per chunk through `pipeTo` | ~2 promises + 2 `{value,done}` objects + read overhead | **1 promise** (the spec-mandated write request; see §5.1) |

The 6–19 `Function`s and up to 9 `JSLexicalEnvironment`s per stream today are the JS builtins
materializing the spec's algorithm closures. They do not exist in this design (§4, §4.1).
The per-chunk claim is deliberately honest: the write-request promise is spec-shaped and the
reference pipe *must* react to each one (§5.1), so we do not eliminate it in this project.

---

## 1. Naming & file layout

New directory: `src/jsc/bindings/webcore/streams/` (self-contained subsystem).
The public classes follow the house `JSFoo` / `JSFooPrototype` / `JSFooConstructor` C++-class
convention: **one `JSFoo.h` + one `JSFoo.cpp` per public class, containing all three C++
classes**. Do NOT split Prototype/Constructor into separate files.

### 1.1 Public classes (each = `JSFoo.{h,cpp}`)

| # | Class | ctor callable from JS? | destructible? (owns a `Deque`) |
|---|---|---|---|
| 1 | `JSReadableStream` | yes | no |
| 2 | `JSReadableStreamDefaultReader` | yes | **yes** (`[[readRequests]]`) |
| 3 | `JSReadableStreamBYOBReader` | yes | **yes** (`[[readIntoRequests]]`) |
| 4 | `JSReadableStreamDefaultController` | no (throws) | **yes** (`[[queue]]`) |
| 5 | `JSReadableByteStreamController` | no (throws) | **yes** (byte `[[queue]]` + `[[pendingPullIntos]]`) |
| 6 | `JSReadableStreamBYOBRequest` | no (throws) | no |
| 7 | `JSWritableStream` | yes | **yes** (`[[writeRequests]]`) |
| 8 | `JSWritableStreamDefaultWriter` | yes | no |
| 9 | `JSWritableStreamDefaultController` | no (throws) | **yes** (`[[queue]]`) |
| 10 | `JSTransformStream` | yes | no |
| 11 | `JSTransformStreamDefaultController` | no (throws) | no |
| 12 | `JSByteLengthQueuingStrategy` | yes | no |
| 13 | `JSCountQueuingStrategy` | yes | no |
| 14 | `JSReadableStreamAsyncIterator` | no ctor; has a prototype (`%ReadableStreamAsyncIteratorPrototype%` with `next`/`return`) | no |

"ctor not callable" classes still get a `JSFooConstructor` installed on globalThis (so
`instanceof` and `.prototype` work); its `construct` throws
`TypeError: Illegal constructor`. Class 14 has NO globalThis constructor at all; its prototype
is created internally and its instances are returned by `values()`/`[Symbol.asyncIterator]()`.
Its members: `WriteBarrier<JSReadableStreamDefaultReader> m_reader`,
`WriteBarrier<JSPromise> m_ongoingPromise`, `bool m_preventCancel`, `bool m_isFinished`; plus
the get-next / return chaining algorithms from digest 01.

Both readers derive from a shared, **non-polymorphic** internal base
`JSReadableStreamReaderBase : JSC::JSNonFinalObject` (`JSReadableStreamReaderBase.h`) holding
the `ReadableStreamGenericReader` mixin slots (`m_stream`, `m_closedPromise`) plus a
`bool m_isBYOB` (or a distinct `JSType`). The three `ReadableStreamReaderGeneric*` abstract ops
take `JSReadableStreamReaderBase*`. No C++ `virtual` (see §5).

### 1.2 Internal (non-exposed) cell classes

| file | contents |
|---|---|
| `JSReadRequest.{h,cpp}` | `JSReadRequest` and `JSReadIntoRequest`: single concrete, **non-polymorphic** cells with a kind tag (§5) |
| `JSPullIntoDescriptor.{h,cpp}` | the pull-into descriptor GC cell (§3.4) |
| `JSStreamPipeToOperation.{h,cpp}` | the PipeTo state machine (§6.1) |
| `JSStreamTeeState.{h,cpp}` | tee shared state for the default AND byte tee (§6.2) |
| `JSCrossRealmTransformState.{h,cpp}` | postMessage-transfer endpoint state (§6.3) |
| `JSStreamAlgorithmContexts.{h,cpp}` | the small `FromIterable` iterator-record cell; nothing else (2-value reaction contexts use JSC's `InternalFieldTuple`, §4.1) |
| `JSStreamsRuntime.{h,cpp}` | the per-global cell holding the ~20 shared native reaction `JSFunction`s (§4.1) + any other per-global streams state. Reached via ONE `LazyProperty` on the global object; do NOT add per-function fields to `ZigGlobalObject`. |
| `JSReadableStreamReaderBase.h` | header-only shared reader base (above) |

### 1.3 Shared non-class files

| file | contents |
|---|---|
| `WebStreamsInternals.h` | **THE frozen ABI**: forward decls of all classes; every cross-file abstract-op declaration (from `specs/OP-SIGNATURES.md`, reconciled to v2); the enums (§4) and shared structs. **No definitions.** |
| `StreamQueue.h` | header-only: the value-with-size / byte-chunk queue types (§3.3) |
| `ReadableStreamOperations.cpp` | stream-level RS ops: `readableStreamPipeTo`, `readableStreamTee`/`DefaultTee`/`ByteStreamTee` (bodies delegate to the pipe/tee cells), `readableStreamFromIterable`, `createReadableStream`, `createReadableByteStream`, `initializeReadableStream`, `acquireReadableStream{Default,BYOB}Reader`, `readableStreamCancel/Close/Error/AddReadRequest/AddReadIntoRequest/FulfillReadRequest/FulfillReadIntoRequest/GetNumRead(Into)Requests/HasDefault(BYOB)Reader`, `isReadableStreamLocked`, the three `readableStreamReaderGeneric*` ops, and `setUpReadableStreamDefaultController*` / `setUpReadableByteStreamController*` (`SetUpXxx` ops with no owning class file live here) |
| `WritableStreamOperations.cpp` | ALL `WritableStreamXxx` + `SetUpWritableStreamDefaultController*` + `AcquireWritableStreamDefaultWriter` + `CreateWritableStream` + `InitializeWritableStream` + the full erroring/in-flight state machine |
| `TransformStreamOperations.cpp` | ALL `TransformStreamXxx` ops incl. `InitializeTransformStream` and the default-sink/default-source algorithms |
| `CrossRealmTransform.{h,cpp}` | `SetUpCrossRealmTransformReadable/Writable`, `PackAndPostMessage(HandlingError)`, `CrossRealmTransformSendError`, and the transfer / transfer-RECEIVING steps for all 3 transferable classes (§6.3) |
| `BunStreamConsumers.cpp` | BUN-LAYER-DESIGN §3: the `readableStreamTo*` set, `tryUseReadableStreamBufferedFastPath`, the `*Direct` consumers, `withoutUTF8BOM`, `ReadableStream.prototype.{text,json,bytes,blob}`. (Added by PHASE-A-NOTES ruling §4.5.) |
| `WebStreamsMisc.cpp` | `TransferArrayBuffer`, `CanTransferArrayBuffer`, `CloneAsUint8Array`, `StructuredClone`, `CanCopyDataBlockBytes`, `IsNonNegativeNumber`, `ExtractHighWaterMark`, `ExtractSizeAlgorithm`, the sanctioned catch helper (§7.1a), promise helpers |
| *(Bun layer — its own designed & reviewed module set)* | The `Native` source kind, the `type:"direct"` stream mode + `JSDirectStreamController`, the JSSink glue (`assignToStream`/`readDirectStream`/`readStreamIntoSink`/ResumableSink), the `readableStreamTo*` fast paths, and `WebStreamsExports.cpp` (the entire `extern "C"` + Rust FFI surface). File list, class list, and every signature: **`specs/BUN-LAYER-DESIGN.md`** — designed and adversarially reviewed exactly like the spec core, BEFORE the headers freeze. |

### 1.4 Ownership rule for abstract ops (makes the parallel write conflict-free)

A spec abstract op named `FooBarBaz(...)` is *implemented* in the `.cpp` of the class named by
its **longest class-name prefix** (`ReadableByteStreamControllerRespondInternal` →
`JSReadableByteStreamController.cpp`; `WritableStreamDefaultWriterEnsureReadyPromiseRejected` →
`JSWritableStreamDefaultWriter.cpp`; `TransformStreamDefaultControllerEnqueue` →
`JSTransformStreamDefaultController.cpp`). Ops with no controller/reader/writer class prefix
(`ReadableStreamXxx`, `WritableStreamXxx`, `TransformStreamXxx`, `SetUpXxx`, `Create*`,
`Acquire*`, `Initialize*`) go in the corresponding `*Operations.cpp`, EXCEPT ops that §1.3
assigns to a named file by table (the table entry wins). **Every op is *declared* exactly once,
in `WebStreamsInternals.h`.** `specs/OP-SIGNATURES.md` is the row-by-row application of this
rule; Phase A copies it (after reconciling to v2's §4/§5).

---

## 2. Registration (reuse Bun's existing generic plumbing)

Bun already registers these classes through a fully generic, class-agnostic path. **Reuse it;
do not invent a new one.** Keep, per public class:

- its `DOMConstructorID` entry (`webcore/DOMConstructors.h`) — the constructor object lives in
  `DOMConstructors::m_array[id]` on the global, GC-visited generically.
- its lazy `PropertyCallback` entry in `src/jsc/bindings/ZigGlobalObject.lut.txt` and the
  `WEBCORE_GENERATED_CONSTRUCTOR_GETTER(Name)` instantiation in `ZigGlobalObject.cpp`.
- its instance `Structure`, cached via `getDOMStructure<JSFoo>()` →
  `JSFoo::createStructure(vm, global, JSFoo::createPrototype(vm, global))`.

The ONLY registration-shape change: `JSFooConstructor` becomes a real `JSC::InternalFunction`
subclass (today it is `JSDOMBuiltinConstructor<JSFoo>`, which dispatches to a JS builtin).
Each constructor caches its target instance `Structure` in a member
`WriteBarrier<Structure> m_instanceStructure`, set in `finishCreation` from
`getDOMStructure<JSFoo>()`, so `construct` does zero hashmap lookups.

Internal (non-user) allocation of stream objects from C++ (`TransformStream` building its two
inner streams, `tee()`, `Response.body`, transfer-receiving) uses `getDOMStructure<JSFoo>()`
directly — never the constructor.

Every class needs a `subspaceFor<>` iso subspace (destructible classes get the destructible
form). **RESOLVED:** the template to copy is `JSCookie` (`src/jsc/bindings/webcore/JSCookie.{h,cpp}`)
— hand-written, `WriteBarrier` instance state, the `DOMConstructorID` constructor path, a
cached prototype structure, a real `visitChildrenImpl`, and the canonical `subspaceForImpl`
shape. Full registration checklist + edit points: `specs/PLUMBING.md`.

**Build integration is ONE line.** There is no CMake source list: `scripts/glob-sources.ts`
globs `src/jsc/bindings/webcore/*.cpp` NON-recursively, so the new `webcore/streams/`
directory needs exactly one added glob line there. Deleting the `src/js/builtins/*.ts` stream
files needs no list edits (`bundle-functions.ts` scans the directory).

---

## 3. Object layout: internal slots → C++ members

Rule zero: **state lives in C++ members, never in JS properties.** No private-name properties,
no `getDirect`, no per-instance internal-field indirection. Reading `[[state]]` is a member load.

For each internal-slot table in `specs/digest/*`, apply:

### 3.1 Scalar slots → plain C++ members. Zero GC cost.
- state machines → scoped `enum class : uint8_t`
  (`ReadableStreamState { Readable, Closed, Errored }`,
  `WritableStreamState { Writable, Erroring, Errored, Closed }`).
- booleans (`[[disturbed]]`, `[[pullAgain]]`, `[[pulling]]`, `[[started]]`,
  `[[closeRequested]]`, `[[backpressure]]`, ...) → `bool`, packed next to the enum.
- numbers: `[[queueTotalSize]]`, `[[strategyHWM]]` → `double` (spec type; `[[queueTotalSize]]`
  accumulates arbitrary user-returned sizes — NEVER an integer). `[[autoAllocateChunkSize]]` →
  `uint64_t` after the spec's `[EnforceRange] unsigned long long` conversion.
  `[[bytesFilled]]`/offsets → `size_t`.
- "slot is *undefined*" vs "slot holds the JS value `undefined`" are DIFFERENT: model optional
  scalars with a sentinel/`std::optional`, and gate `[[storedError]]` reads on `[[state]]`
  (an errored stream's stored error can legitimately BE `undefined`).

### 3.2 JS-value slots → `WriteBarrier<T>` members + `visitChildrenImpl`
`[[storedError]]` → `WriteBarrier<Unknown>`. Back-pointers (`[[reader]]`, `[[stream]]`,
`[[readable]]`, `[[writable]]`, `[[writer]]`) → `WriteBarrier<JSFoo>` of the exact class.
**ONE mandatory exception: `JSReadableStream::m_controller` is the ERASED
`WriteBarrier<JSC::JSObject>` plus a `ControllerKind : uint8_t { None, Default, Byte, Direct,
NativeSink }` tag member** — because a readable stream's controller slot can hold a
`JSDirectStreamController` or (native-sink path) a generated `JSReadable*Controller` JSSink
cell, neither of which is a spec controller class. Every read of the controller dispatches on
the tag; every switch over `ControllerKind` is total. (`JSWritableStream::m_controller` and
`JSTransformStream::m_controller` stay exact-typed; only the readable side is polymorphic.)
See `specs/BUN-LAYER-DESIGN.md` §1/§4.7. Every promise slot the spec keeps (`[[closedPromise]]`, `[[readyPromise]]`,
`[[backpressureChangePromise]]`, `[[inFlightWriteRequest]]`, `[[inFlightCloseRequest]]`,
`[[closeRequest]]`, `[[abortRequest]]`'s promise, ...) → `WriteBarrier<JSPromise>`.
**Every** WriteBarrier member appears in `visitChildrenImpl` (`DEFINE_VISIT_CHILDREN`); a
container of barriers is visited under `cellLock()` (§3.3). This is the #1 reviewer check.
`[[closedPromise]]` on readers/writers is spec-required at construction and is NOT lazy.
`WritableStreamDefaultController` additionally holds its spec `[[abortController]]`
(`WriteBarrier<>` to Bun's AbortController wrapper) and exposes `[[signal]]` from it.

### 3.3 The queues (`StreamQueue.h`)
```cpp
struct ValueWithSize  { JSC::WriteBarrier<JSC::Unknown>       value;  double size; };
struct ByteQueueEntry { JSC::WriteBarrier<JSC::JSArrayBuffer> buffer; size_t byteOffset; size_t byteLength; };
```
Backing container: `WTF::Deque<Entry, 4>` as a member. Mutations AND the `visitChildren`
iteration both hold `WTF::Locker locker { cell->cellLock() }` — the concurrent-marking-safety
pattern already blessed in-tree (`src/jsc/bindings/WriteBarrierList.h`). The spec ops
`EnqueueValueWithSize` / `DequeueValue` / `PeekQueueValue` / `ResetQueue` are inline methods on
a `StreamQueue<Entry>` helper owning `{deque, totalSize}`. A `WTF::Deque` member ⇒ the owning
class is destructible (§1.1 column).
`[[readRequests]]` / `[[readIntoRequests]]` → `WTF::Deque<WriteBarrier<JSReadRequest>>` /
`<JSReadIntoRequest>` under the same discipline.
**`[[writeRequests]]` is a deque of *promises*, not of request cells**:
`WTF::Deque<WriteBarrier<JSPromise>>` — see §5.1. Do not invent a `JSWriteRequest`.
**Never hold a pointer/reference to a deque entry across ANY call that can run user JS** (§7.2).
Re-fetch `first()` after such a call.

### 3.4 Pull-into descriptors are GC cells: `JSPullIntoDescriptor`
The most reentrancy-hazardous objects in the spec: user code, from inside
`byobRequest.respond(n)` / `respondWithNewView(v)` / `enqueue()`, can mutate
`[[pendingPullIntos]]` while an outer op iterates it. A plain struct in a Vector makes every
such path a use-after-free. `JSPullIntoDescriptor` is a small non-destructible cell with exactly
the digest's fields: `WriteBarrier<JSArrayBuffer> buffer; size_t bufferByteLength, byteOffset,
byteLength, bytesFilled, minimumFill; uint8_t elementSize; ViewConstructorKind viewConstructor;
ReaderType readerType /* Default | Byob | None */;`. `[[pendingPullIntos]]` is a
`WTF::Deque<WriteBarrier<JSPullIntoDescriptor>>` under cellLock. Holding a
`JSPullIntoDescriptor*` across user JS is then never a UAF — but the code must still
**re-validate that it is still relevant** afterward, exactly where the spec's asserts say to.

---

## 4. Algorithms: a kind tag + a context cell — no per-stream closures

The spec's `[[startAlgorithm]]/[[pullAlgorithm]]/[[cancelAlgorithm]]` (RS),
`[[writeAlgorithm]]/[[closeAlgorithm]]/[[abortAlgorithm]]` (WS controller),
`[[transformAlgorithm]]/[[flushAlgorithm]]/[[cancelAlgorithm]]` (TS controller) are bound
function objects in JS engines. In JS builtins that costs a `JSFunction` +
`JSLexicalEnvironment` per algorithm per stream — the bulk of today's 17–61 objects.

**We store none of them.** Each controller stores:

```cpp
// ReadableStream{Default,Byte}Controller:
enum class SourceKind : uint8_t {
    JavaScript,   // new ReadableStream({...}) — user underlyingSource
    Nothing,      // new ReadableStream() with no source, or an already-drained stream
    Transform,    // the readable half of a TransformStream (default source pull/cancel algs)
    TeeBranch,    // a default-tee branch
    ByteTeeBranch,// a ReadableByteStreamTee branch (a DIFFERENT algorithm from TeeBranch)
    FromIterable, // ReadableStream.from(asyncIterable)
    CrossRealm,   // the receiving end of a postMessage transfer (out of scope; see §6.3)
    Native,       // Bun: a lazily-materialized native source, pulled into a DEFAULT controller
};
// There is deliberately NO `Direct` arm. `type:"direct"` is a mode of the STREAM, not a
// controller kind: a direct stream has NO spec controller at construction, and when it
// materializes for JS consumption its "controller" is a distinct `JSDirectStreamController`
// cell that is not a ReadableStreamDefaultController at all. See specs/BUN-LAYER-DESIGN.md.
// WritableStreamDefaultController:
enum class SinkKind : uint8_t { JavaScript, Nothing, Transform, CrossRealm, /* Bun: TBD(bun-ext) */ };
// TransformStreamDefaultController:
enum class TransformerKind : uint8_t {
    JavaScript,   // new TransformStream({...}) — user transformer
    Identity,     // new TransformStream() with no transformer
    TextEncoder,  // TextEncoderStream  (native transform/flush; context = the JSTextEncoderStream)
    TextDecoder,  // TextDecoderStream  (native transform/flush; context = the JSTextDecoderStream)
};
// CompressionStream / DecompressionStream do NOT get an arm: verified — they never touch
// TransformStream internals (they are node:zlib Duplex adapters over the PUBLIC constructors)
// and are unaffected by this rewrite. Their .ts builtins survive unchanged.
```
For internal (non-user) TransformStream creation the parallel of `createReadableStream` is:
```cpp
JSTransformStream* createTransformStream(JSGlobalObject*, TransformerKind, JSC::JSCell* algorithmContext,
    double writableHighWaterMark = 1, JSC::JSObject* writableSizeAlgorithm = nullptr,
    double readableHighWaterMark = 0, JSC::JSObject* readableSizeAlgorithm = nullptr);
```

Controller members for the algorithm machinery — this is the **complete** list:
```cpp
SourceKind m_sourceKind;                                  // (SinkKind / TransformerKind resp.)
JSC::WriteBarrier<JSC::Unknown>  m_underlyingSource;      // JavaScript kind: the user object (call `this`)
JSC::WriteBarrier<JSC::JSObject> m_pullMethod;            // JavaScript kind: null ⇒ trivial algorithm
JSC::WriteBarrier<JSC::JSObject> m_cancelMethod;          //   (write/close/abort; transform/flush/cancel)
JSC::WriteBarrier<JSC::JSCell>   m_algorithmContext;      // NON-JavaScript kinds ONLY (below); else null
JSC::WriteBarrier<JSC::JSObject> m_strategySizeAlgorithm; // null ⇒ default size () => 1
```
`m_algorithmContext` per kind — this is the fix for the "closures capture variables" problem:
- `Transform` → the `JSTransformStream*`
- `TeeBranch` / `ByteTeeBranch` → the `JSStreamTeeState*` (branch index is a separate `uint8_t`)
- `FromIterable` → a `JSStreamFromIterableContext*` (`{iterator, nextMethod}` WriteBarriers)
- `CrossRealm` → the `JSCrossRealmTransformState*`
- `Direct` / `Native` → `TBD(bun-ext)`
All algorithms become member functions whose body is `switch (m_sourceKind)`; the `JavaScript`
arm is `JSC::call(g, m_pullMethod.get(), callData, m_underlyingSource.get(), argsWithController)`
and the other arms are native code reading `m_algorithmContext`. Zero per-stream functions.

**Internal creation signature** (this is what makes every internal caller expressible — the
default tee ×2, byte tee ×2, from-iterable, cross-realm, transform ×2):
```cpp
JSReadableStream* createReadableStream(JSGlobalObject*, SourceKind, JSC::JSCell* algorithmContext,
                                       JSC::JSValue startResult, double highWaterMark,
                                       JSC::JSObject* sizeAlgorithm /* nullable */);
JSReadableStream* createReadableByteStream(JSGlobalObject*, SourceKind, JSC::JSCell* algorithmContext);
JSWritableStream* createWritableStream(JSGlobalObject*, SinkKind, JSC::JSCell* algorithmContext,
                                       JSC::JSValue startResult, double highWaterMark,
                                       JSC::JSObject* sizeAlgorithm /* nullable */);
```
`startResult` is the value "the start algorithm returns" — for the transform's two inner
streams it is the pre-existing, still-pending `startPromise` (digest 04); for tee /
from-iterable / cross-realm it is `undefined`. The corresponding `setUp*Controller` performs
the spec's "react to a promise resolved with startResult" using §4.1. For the JS-constructor
path, the `SetUp…FromUnderlyingSource` op computes `startResult` by invoking the user's `start`
method (with `controller` as the argument, at exactly the spec's step) and then follows the
same code. **The start method/result is never stored** — the adversarial review verified that
no `SetUp*` op re-invokes start, so there is no `m_startMethod` member. This is the ONLY
representation of "start algorithm".

**WebIDL dictionary conversion is observable and must be exact.** The constructors convert the
underlying source/sink/transformer (`UnderlyingSource` / `UnderlyingSink` / `Transformer`) and
the `QueuingStrategy` as WebIDL dictionaries: members are read in **alphabetical member order**
(for `UnderlyingSource`: `autoAllocateChunkSize`, `cancel`, `pull`, `start`, `type`), each read
is a real `[[Get]]` that fires user getters exactly once, a present-and-not-`undefined` member
that is not callable throws `TypeError` **during conversion** (before any other constructor
step), and an unknown `type` string throws `TypeError` via the `ReadableStreamType` enum
conversion. Hand-written `getIfPropertyExists` calls in a different order are a spec violation
with WPT coverage. The converted method values are captured ONCE, here; later mutation of
`underlyingSource.pull` is never observed. A member that converted to `undefined` ⇒ the trivial
algorithm (returns `promiseResolvedWith(undefined)`), represented by a **null method member**.
The strategy `size` function's callability is validated by `ExtractSizeAlgorithm` at
construction; its call `this` is `undefined`.

### 4.1 THE promise-reaction mechanism (the linchpin — one mechanism, no alternatives)

Beyond the stored `[[xxxAlgorithm]]` slots, the spec has ~20 sites of the form
*"Upon fulfillment of promise P (often a USER promise), do X with `controller`/`pipeOp`/…"*.
Each needs a native handler **plus a GC-visited edge to the captured cell**. Two tempting
implementations are BANNED:
- a per-reaction bound `JSFunction`/arrow (a closure — the thing we are eliminating);
- `JSC::JSNativeStdFunction::create` with a C++ lambda capturing a `JSFoo*` — **its captures
  are NOT GC-visited**; a raw pointer capture is a use-after-free and a `Strong` capture is
  banned. `JSNativeStdFunction` with any capture is FORBIDDEN in this subsystem.

The sanctioned mechanism (verified against the fork source,
`JavaScriptCore/runtime/JSPromise.{h,cpp}` + `JSMicrotask.cpp:1490`, `USE(BUN_JSC_ADDITIONS)`):

```cpp
promise->performPromiseThenWithContext(vm, globalObject,
    onFulfilled /* a SHARED per-global native JSFunction */,
    onRejected  /* likewise; either may be jsUndefined() for the built-in no-op */,
    resultPromiseOrJSUndefined,   // jsUndefined() ⇒ fire-and-forget, NO result promise allocated
    contextCell);                 // any JSValue; stored ON the JSPromiseReaction ⇒ GC-visited
```
When the reaction fires, the handler is called as `handler(resolutionValue, contextCell)`
(`this` = undefined). Facts that follow from the implementation, all load-bearing:
1. The **~20 handler functions are shared, stateless, per-global native `JSFunction`s** created
   once on the `JSStreamsRuntime` cell (§1.2). A handler's entire body is
   `auto* c = jsDynamicCast<JSXxx*>(callFrame->uncheckedArgument(1)); c->onSomething(global, callFrame->argument(0));`.
   **Per stream: 0 functions. Per reaction: 0 allocations** beyond the `JSPromiseReaction`
   JSC allocates for any `.then()` anyway.
2. **AsyncContext propagation is done by the primitive** (it snapshots/restores
   `m_asyncContextData` around the handler). The old builtins' entire hand-rolled
   `$asyncContext` machinery is deleted with nothing to replace it.
3. Registering a reaction on a promise `markAsHandled()`s it. That is what we want on user
   promises we adopt (pull()'s result, sink write()'s result): no spurious unhandledRejection.
4. Contexts needing TWO cells (transform-sink-write: `{transformStream, chunk}`; byte-tee's
   `forwardReaderError`: `{teeState, thisReader}`) use JSC's existing 2-field
   `InternalFieldTuple::create(vm, global->internalFieldTupleStructure())`. **No bespoke pair
   classes.**
5. A reaction registered with `resultPromiseOrJSUndefined == jsUndefined()` that returns with a
   **pending exception escapes as an uncaught error at the microtask level**. Therefore every
   native reaction handler in this subsystem is a *boundary*: it must convert any internal
   failure into the spec action (error the stream / reject the tracked promise) and never
   return with a pending exception. Reviewers verify this per handler.
6. "React to a promise resolved with X" where X is a **non-thenable we constructed** (the
   common `startResult === undefined` case) must still defer to a microtask (observably) but
   needs **no promise at all**: queue one native microtask directly
   (`globalObject->queueMicrotask(...)` with the context). This is why
   `new ReadableStream({start(){},pull(){},cancel(){}})` really is **2 cells** — start's
   "promise" is elided when start returns a non-thenable. When start/pull/write return a real
   promise/thenable, we react to *their* promise; we do not wrap it in another.

**Bound callables (Bun layer only) — the SECOND and LAST sanctioned callable form.** Where a
callable must be *stored on and later invoked by an object we do not control* (the Rust
native-source handle's `onClose`/`onDrain`, the JSSink controller's `start(onPull, onClose)`,
the ResumableSink's `setHandlers`), a per-reaction closure is still banned; the ONE sanctioned
form is `JSC::JSBoundFunction::create(vm, global, sharedHandler, jsUndefined(),
ArgList{contextCell}, ...)` binding a **shared, stateless, per-global native `JSFunction` owned
by `JSStreamsRuntime`** to exactly one context cell. Verified against
`runtime/JSBoundFunction.h`: `m_boundThis` and the (≤3 embedded) `m_boundArgs` are
`WriteBarrier<Unknown>` and are appended by `JSBoundFunction::visitChildrenImpl`, so the
context is GC-reachable from whatever roots the callable — this is why it satisfies the intent
of the `JSNativeStdFunction` ban (nothing lives outside the GC's view). Cost: one 96-byte cell
in JSC's existing `boundFunctionSpace`; it is already used from Bun's bindings
(`JSCommonJSModule.cpp:129`). **Convention trap:** `boundFunctionCall` PREPENDS the bound
args, so a bound-callable handler receives `(contextCell, ...callArgs)` — the OPPOSITE order
from `performPromiseThenWithContext`'s `(resolutionValue, contextCell)`. The two handler
families are DISJOINT closed lists on `JSStreamsRuntime`; a handler belongs to exactly one and
must never be shared between them. Every other callable in the subsystem is a shared reaction
handler; anything else (a fresh `JSFunction` per stream, any capturing `JSNativeStdFunction`)
stays FORBIDDEN.

`WebStreamsInternals.h` declares, and `JSStreamsRuntime` owns, both closed handler lists.
Phase-B authors may not add reaction sites or callables outside these two mechanisms.

---

## 5. Read requests: a kind-tagged cell, NEVER a C++ vtable

`ReadableStreamAddReadRequest(stream, readRequest)` takes a *read request* (chunk / close /
error steps). The public `reader.read()` needs a `JSPromise`; the internal high-volume
consumers do not.

**A C++ `virtual` on any JSCell subclass is FORBIDDEN — it is memory corruption, not style.**
A JSCell must have the cell header at offset 0 of the GC allocation; the first `virtual`
member on a class whose bases are non-polymorphic places the vptr at offset 0 and shifts the
JSCell subobject to +8, so every `WriteBarrier`, `cellLock()`, and mark-bit computation is off
by one atom. (Verified: zero JSCell subclasses in the vendored JSC use C++ virtuals; there is
no `static_assert` to catch it — it compiles and corrupts the heap.) The same device as §4:

```cpp
enum class ReadRequestKind : uint8_t { Promise, PipeTo, DefaultTee, ByteTee, AsyncIterator,
                                       /* Bun fast paths: ToText, ToBytes, ...  TBD(bun-ext) */ };
class JSReadRequest final : public JSC::JSNonFinalObject {   // ONE concrete class, no subclasses
    ReadRequestKind m_kind;
    JSC::WriteBarrier<JSC::Unknown> m_context;  // Promise: the JSPromise. Others: the owning cell.
public:
    void chunkSteps(JSGlobalObject*, JSValue chunk);  // switch (m_kind)
    void closeSteps(JSGlobalObject*);
    void errorSteps(JSGlobalObject*, JSValue error);
};
```
`JSReadIntoRequest` is the parallel single concrete class for BYOB
(`chunkSteps(view) / closeSteps(view) / errorSteps(e)`). One `ClassInfo` and one iso subspace
each. `Promise`-kind is the ONLY kind that allocates a `JSPromise` + a `{value, done}` result
object; `pipeTo` / `tee` / `for await` / `Bun.readableStreamTo*` allocate neither.

### 5.1 The writable side stays spec-shaped (the "O(1) promises" claim was WRONG)
`WritableStreamAddWriteRequest` creates **one fresh `JSPromise` per chunk** by spec, and the
reference pipe **reacts to every one of them** so that an erroring destination rejecting the
queued writes does not fire N unhandled rejections. An "optimized" pipe reacting only to
`currentWrite` would be a *bug*, not a speedup. Therefore: `[[writeRequests]]` is a
`Deque<WriteBarrier<JSPromise>>`, `writer.write()` allocates one promise, and the honest
per-piped-chunk cost is **1 promise** (down from ~2 promises + 2 result objects + read-side
overhead). Do NOT invent a `JSWriteRequest`; a promise-free write path is a possible future
optimization only after a separate observability analysis, and is out of scope here.

---

## 6. PipeTo, Tee, and CrossRealm are internal GC cells with EXPLICIT rooting

### 6.1 `JSStreamPipeToOperation`
One cell per `pipeTo`/`pipeThrough` holding the operation's entire state (reader, writer,
`m_signal`, `currentWrite` promise, `shuttingDown` flag, the pending-abort action, the promise
it returns) — no closures, one `visitChildren`. Its methods are the spec's "shutdown",
"shutdown with an action", "finalize", and the forward/backward error/close propagation checks.

**Liveness (this is a proof, not a hope — v1's version was refuted with a concrete trace):**
The returned promise roots NOTHING (a promise holds its consumers' reactions, not its
producer), so it is not part of the argument. Instead:
- `JSStreamPipeToOperation` holds `WriteBarrier` edges to its reader and writer, AND
- the acquired **reader** and **writer** each hold a
  `WriteBarrier<JSStreamPipeToOperation> m_pipeOperation` back-edge, set when the pipe
  acquires them and **cleared in "finalize"** (both edges visited).
Now: either stream end externally reachable ⇒ its reader/writer ⇒ the pipe op ⇒ the other end.
Neither end externally reachable ⇒ no effect of the pipe is observable ⇒ collecting it is
correct. **Zero `Strong` handles.** Without the back-edges the destination half is an unrooted
cycle the moment the pipe idles awaiting a write, and JSC collects it mid-pipe (the refuted v1
design).
**The AbortSignal listener MUST be GC-visited.** Bun's `AbortSignal` has BOTH a non-visited
`m_algorithms` list (`addAlgorithm(Function<void(JSValue)>&&)` — capturing a raw
`JSStreamPipeToOperation*` there is a user-triggerable use-after-free once the pipe would
otherwise be dead) AND a visited abort-algorithms path. The pipe MUST register through a
**GC-visited** registration whose context is the pipe cell, and MUST remove it in "finalize"
on every terminal path (a never-aborted long-lived signal must not root a completed pipe —
that is a leak, and removal is a spec step, not an optimization).
**RESOLVED — the required API already exists, no new plumbing:**
`WebCore::addAbortAlgorithmToSignal` / `removeAbortAlgorithmFromSignal` (`AbortSignal.h:82-83`)
with the algorithm list GC-visited by `AbortSignal::visitAbortAlgorithms`
(`AbortSignal.cpp:364-373`, wired via `JSAbortSignalCustom.cpp:84`). The pipe registers a
small `AbortAlgorithm` subclass whose `handleEvent` calls the pipe op and whose GC visit hook
appends the pipe cell. Do NOT use `AbortSignal::addAlgorithm` (the non-visited `m_algorithms`
list) anywhere in this subsystem — that is the UAF.

### 6.2 `JSStreamTeeState`
One cell per `tee()` shared by both branch controllers (`SourceKind::TeeBranch` /
`ByteTeeBranch` + `m_algorithmContext` → the state + a branch index). Members — the
"load-bearing two" were missing from v1:
`WriteBarrier<JSReadableStream> m_stream /* the ORIGINAL stream: every cancel needs it */`,
`WriteBarrier<JSCell> m_reader /* MUTABLE: the byte tee releases and re-acquires readers of
either kind repeatedly */`, `m_branch1`, `m_branch2`, `m_cancelPromise`, `m_reason1`,
`m_reason2`, and the `reading` / `readAgain(ForBranch1/2)` / `canceled1` / `canceled2` bools.
`ReadableByteStreamTee` is a substantially different algorithm from the default tee (it must
handle a BYOB reader appearing on either branch, mid-flight reader swapping, and per-
registration `forwardReaderError(thisReader)` identity checks whose reaction context is an
`InternalFieldTuple{teeState, thisReader}`). Implement it separately and completely from
digest 02; do not "share" it with the default tee.

### 6.3 `JSCrossRealmTransformState` + transfer
Cross-realm streams (`postMessage(stream, [stream])` / `structuredClone(stream,
{transfer:[stream]})`) are driven entirely by a `MessagePort` `message` handler that must call
`enqueue`/`close`/`error` on a controller in the receiving realm. One cell per endpoint:
`WriteBarrier<> m_port`, `WriteBarrier<JSPromise> m_backpressurePromise` (**mutable** — the
writable side's message handler reassigns it), and a back-pointer to the controller. The
port's `message`/`messageerror` handlers are registered through the port's **GC-visited**
listener machinery with the state cell as the context; a raw-pointer native listener is the
same UAF class as §6.1's. The transfer steps AND the transfer-RECEIVING steps (which run
during deserialization in the destination realm) for all three transferable classes are
declared in `CrossRealmTransform.h` and are part of `WebStreamsExports.cpp`'s surface.
**Scope gate — RESOLVED: transferable streams are OUT OF SCOPE for this PR.** Bun does not
support `postMessage(stream,[stream])` / `structuredClone(stream,{transfer:[...]})` today —
verified: `SerializedScriptValue.cpp` contains zero references to any stream class and its
transferable loop accepts only ArrayBuffers/MessagePorts (+ a few DOM types). §6.3 is
therefore NET-NEW functionality and ships as a follow-up PR. The `CrossRealm` enum arms and
this section stay in the frozen headers (the design is complete and its op signatures exist
so nothing has to be re-frozen later); `CrossRealmTransform.cpp` may be a stub whose entry
points `ASSERT_NOT_REACHED()` / throw, and no `SerializedScriptValue` edit happens in this PR.

---

## 7. Exception safety & reentrancy — non-negotiable

Reviewers reject any function violating these. `BUN_JSC_validateExceptionChecks=1` must be clean.

**7.1** Every function taking a `JSGlobalObject*` declares `auto scope =
DECLARE_THROW_SCOPE(vm)` (or is a provably-non-throwing leaf and says so in one comment).
After EVERY call that can allocate, run user JS, or is a spec `?` op:
`RETURN_IF_EXCEPTION(scope, ...)`. Throwing tail calls use `RELEASE_AND_RETURN(scope, ...)`.
A spec `!` is an assertion about *spec* abrupt completions, not about C++ OOM — allocating
calls still need the check.

**7.1a — the ONLY sanctioned catch.** The spec phrase *"interpreting X as a completion
record"* / *"If X is an abrupt completion, …"* is the ONE place an exception may be caught and
consumed. It occurs in exactly these families (each with a comment citing this rule):
the strategy `size()` call (`ReadableStreamDefaultControllerEnqueue`,
`WritableStreamDefaultControllerGetChunkSize` — note one re-throws the value and one swallows
it and returns 1: follow the digest, not intuition); `TransformStreamDefaultControllerEnqueue`
(catches, errors the writable, then throws a DIFFERENT value); the byte controller's
`%ArrayBuffer%` construct in `[[PullSteps]]` (routes to the read request's error steps);
`ReadableStreamFromIterable`'s iterator calls (convert to a rejected promise);
`ReadableByteStreamControllerEnqueueClonedChunkToQueue`; every `startAlgorithm` invocation.
Pattern — never any other shape, never elsewhere. NOTE: this fork does NOT export
`JSC::CatchScope`/`DECLARE_CATCH_SCOPE`; the real, in-tree-verified API (used by
`ZigGlobalObject.cpp` and the fork's own microtask runner) is
`JSC::TopExceptionScope` from `<JavaScriptCore/TopExceptionScope.h>`:
```cpp
auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
JSValue r = <the call>;
if (JSC::Exception* ex = catchScope.exception()) {
    JSValue thrown = ex->value();
    if (!catchScope.clearExceptionExceptTermination()) [[unlikely]]
        return /* a VM termination is never caught: propagate/abort the op */;
    <the digest's recovery path, using `thrown`>;
}
```
Prefer the ONE shared helper `takeAbruptCompletion(global, catchScope)` declared in
`WebStreamsInternals.h` over hand-rolling this. A bare `clearException()` is forbidden;
`clearExceptionExceptTermination()` is what makes forced VM termination uncatchable, which
it must be.

**7.2** These run arbitrary user JS synchronously — after any of them, re-load all cached
state from members, re-fetch queue heads, and re-validate `[[state]]`; and NEVER hold a raw
pointer into a deque across them:
- `JSC::call` of any user function (pull/write/size/transform/start/cancel/flush/abort/…)
- any property `[[Get]]` on a user object (only legal during the §4 dictionary conversion)
- **resolving ANY promise with a value that is (or contains) a user object** — JSC's promise
  resolution reads `.then` synchronously (a getter / Proxy trap). This includes resolving a
  read()'s promise with a user CHUNK, and `promiseResolvedWith(x)` for any user `x`.
- **signaling abort on any `AbortController` / firing any event** — `WritableStreamAbort`
  step 2 runs the user's `abort` listeners synchronously; the spec's own note says so, and it
  is the only prose reentrancy re-check in the whole spec. Do not miss it.
- invoking any read-request / read-into-request steps (their `Promise` kind resolves with a
  user chunk ⇒ previous bullet; other kinds run arbitrary internal machinery)
- `structuredClone` / `PackAndPostMessage` / MessagePort message delivery / detaching an
  ArrayBuffer that could be observed by user code
The spec is *already written* to be reentrancy-safe **iff you re-read state at exactly the
points it re-reads state**. Do not hoist a `[[state]]` check above a user call the spec puts
it after; do not cache `queue.first()` across one.

**7.3** Never call a user method by property-getting it at call time except during the §4
dictionary conversion. Everywhere else, algorithms were captured at set-up.

**7.4** Settling one of OUR promises with a value **we constructed** (undefined, `true`, a
fresh Error) is NOT a user-JS point — its reactions run as microtasks. Settling it with a
**user value** IS (see §7.2). This distinction is the whole rule; v1's blanket exemption was
wrong. **One further caveat (HEADER-REVIEW-3):** even a value WE constructed can be a
user-JS point if the *resolve* path performs the ES `PromiseResolve` thenable lookup on it —
a plain `{value, done}` result object's `.then` lookup reaches a user-patched
`Object.prototype.then` getter, which WPT's `patched-global.any.js` tests for. So: where the
digest says "**resolve** promise with X", the thenable lookup (and thus this hazard) is
spec-mandated and MUST happen; where the value is a fresh plain object and the digest's
semantics permit it, prefer `JSC::JSPromise::fulfill...` (which performs NO thenable lookup)
only when the digest's own step is a fulfill, never as an "optimization" of a resolve. When
in doubt, treat resolving with any object as `userJS: yes` and re-validate after it.

**7.5** Rejecting a promise nobody has `.then`'d fires unhandledRejection. The spec marks
specific promises as handled ("Set promise.[[PromiseIsHandled]] to true") — the writer's stale
`[[readyPromise]]`/`[[closedPromise]]`, the pipe's internals, tee's `cancelPromise`,
`pipeThrough`'s returned promise. Use `promise->markAsHandled(...)` at exactly the digest's
points; §4.1's mechanism marks-as-handled the promises we *react to*, which covers most of the
rest. Missing one = spurious `unhandledRejection` events; adding an extra one = swallowed
errors. Reviewers grep the digests for "IsHandled" and diff.

**7.6** **No `JSC::Strong`, no `protect()`, no `gcProtect`, no `ensureStillAlive` anywhere in
this subsystem.** With §6.1's back-edges the reachability argument is complete for pure-JS
streams; NATIVE producers root their controller from the native side (outside these files).
The single, pre-authorized exception if (and only if) implementation shows a hole §6.1 does
not cover: `JSStreamPipeToOperation` / `JSCrossRealmTransformState` may hold ONE
self-keepalive `Strong`, armed at creation and provably released on every terminal path — and
it must come with a comment naming the exact object-graph hole it plugs. Nothing else, ever.
Every capturing `JSNativeStdFunction` is banned (§4.1).

`JSC::Weak<T>` is NOT `Strong` (it roots nothing) and is permitted at EXACTLY ONE site: the
native source adapter's controller back-edge (`specs/BUN-LAYER-DESIGN.md` §2.2), where it
does the same job the current implementation's `WeakRef` does — preventing Rust's *external*
Strong root on the native handle from transitively pinning the entire abandoned JS consumer
graph (stream, controller, queue, up to a 2 MiB pending buffer) for the lifetime of a
long-lived `updateRef(true)`'d source. Every read of it null-checks (null ⇒ the JS consumer
is gone ⇒ drop the data). A `Weak` anywhere else needs the same standard of proof this one
has, in a comment, before a reviewer will accept it.

**7.7** Numbers crossing from JS (`size()` returns, `desiredSize`, `respond(n)`,
`autoAllocateChunkSize`, `highWaterMark`): validate exactly as the digest does
(`IsNonNegativeNumber`, `RangeError`/`TypeError` on the exact inputs it names) BEFORE any
cast; compare as `double`; narrow only after the range check. `respond(0)` is legal only in
the close path — take it from the digest, not intuition. A byte stream given a size strategy
is a `RangeError` at construction.

---

## 8. Error objects & messages

Match the exception **class** exactly (`TypeError` vs `RangeError` — the spec distinguishes).
Messages are ours: name what failed and the violated constraint, repo voice (see
`.claude/docs/landing-prs.md` → Errors). `JSC::throwTypeError(global, scope, "..."_s)` for
thrown ones. For states the spec represents as "a TypeError" *value* stored/forwarded rather
than thrown (e.g. `ReadableStreamDefaultReaderRelease` erroring pending reads "with a
TypeError"), create it with `createTypeError(global, "..."_s)` and store it — do not throw it.

---

## 9. Phasing (the workflow contract)

- **Phase A — headers.** One agent writes ALL `.h` files + `WebStreamsInternals.h` from THIS
  document + `specs/BUN-LAYER-DESIGN.md` + the four digests + `specs/OP-SIGNATURES.md`
  (reconciled to v2) + `specs/CONSUMERS.md` + `specs/PLUMBING.md`. 3 adversarial
  reviewers, disjoint lenses: (1) *spec completeness* — every internal slot & every abstract
  op present with a correct signature; (2) *GC safety* — every WriteBarrier visited, every
  barrier container cellLocked, destructibility right, iso subspaces declared, no `virtual`
  on any cell, no capturing `JSNativeStdFunction`, no `Strong`; (3) *exception/reentrancy* —
  every op's userJS? annotation is right (seed from `OP-SIGNATURES.md`) and every §7.1a catch
  site is one of the enumerated families. Fixes applied. **Headers then FROZEN.**
- **Phase B — bodies.** One agent per `.cpp`, in parallel, against frozen headers + the digest
  section defining its ops. It includes only frozen headers, edits no header and no other
  `.cpp`, and STOPS and reports if it needs a signature change. 2 adversarial reviewers per
  file (lenses: spec-step fidelity vs the digest; §7 discipline). Apply fixes.
- **Phase C — integrate.** ONE agent (the only one allowed to run the build) deletes the old
  implementation, wires CMake/registration, compiles, writes every compile error verbatim to
  `specs/compile-errors/roundN.txt`. Fix agents (fresh context, one per erroring file, still
  no-build) consume that. Loop until clean.
- **Phase D — tests.** (1) The `specs/TEST-SURFACE.md` 12-file smoke set. (2) **Vendor the
  WPT streams suite** (Appendix A) — this is the spec-compliance acceptance test and the only
  thing that makes "spec compliant" a checked claim. (3) The full ~142-file blast radius.
  Every failure is fixed by root cause; a test is never weakened, skipped, or deleted to get
  green (CLAUDE.md rules apply in full).

Agents in Phases A/B and in Phase C's fix step are **banned from**: `git`, `cargo`, `bun bd`,
`bun run build`, `cmake`, `ninja`, any network access, and reading/writing anything outside
`src/jsc/bindings/webcore/streams/` + `specs/`. Enforce this in every prompt.

---

## Appendix A — scope decisions (all former TBDs are RESOLVED)

**In scope (in addition to §0's core):**
- The complete Bun-native layer per `specs/BUN-LAYER-DESIGN.md` (the `Native` source kind,
  the `type:"direct"` stream mode + `JSDirectStreamController`, JSSink glue, `readableStreamTo*`
  fast paths, and the full `extern "C"` surface Rust binds — those symbol names and the
  `ReadableStreamTag` numeric values are FROZEN by `assert_ffi_discr!` on the Rust side).
- `TextEncoderStream` and `TextDecoderStream` — JS builtins layered on exactly two
  TransformStream internals being deleted (`CreateTransformStream`,
  `TransformStreamDefaultControllerEnqueue`), so they come along to C++: each is one native
  `TransformerKind` arm (feasibility + the exact transform/flush algorithms confirmed in
  `specs/BUN-LAYER-DESIGN.md` §9.2). **`CompressionStream` / `DecompressionStream` are NOT
  affected and need NO work** — verified: they never touch TransformStream internals (they are
  `node:zlib` Duplex adapters over the PUBLIC constructors). An earlier draft of this document
  wrongly included them; corrected.
- **Vendoring the WPT streams test suite.** There is NO streams WPT in this repo today
  (verified), so nothing enforces spec compliance before or after the rewrite. The repo
  already has the pattern (`test/js/third_party/wpt-h2/`: vendored `.any.js` + a
  `testharness` shim + `RESULTS.md`). A verbatim spec transcription is worth little if
  nothing checks the result against it. Phase D vendors `streams/{readable-streams,
  readable-byte-streams,writable-streams,transform-streams,piping,queuing-strategies}`.
- `$createFIFO` (a general-purpose FIFO in `StreamInternals.ts` used by NON-stream builtins)
  MOVES to a surviving internal module; it is not deleted.

**Out of scope (follow-ups, not this PR):**
- §6.3 cross-realm transfer (transferable streams do not exist in Bun today).
- Any promise-free `[[writeRequests]]` optimization (§5.1 — rejected on correctness grounds).

## Appendix B — what changed from v1 and why (do not re-litigate)
- §5: `virtual` on JSCell ⇒ replaced by a kind tag on ONE concrete cell (ARCH-REVIEW C1:
  memory corruption).
- §4: added the `Transform`/`ByteTeeBranch` source arms, the full `SinkKind`/`TransformerKind`
  enums, `m_algorithmContext`, and the internal `createReadableStream(..., startResult, ...)`
  signature (C2, S1, S3, OP-SIG #1/#2).
- §4.1: NEW — the single closure-free, GC-visited promise-reaction mechanism (C3). This is the
  linchpin; it is verified against the fork source, not assumed.
- §6.1: the liveness argument was FALSE; replaced by the reader/writer→pipeOp `WriteBarrier`
  back-edges, and the AbortSignal registration must be GC-visited + removed (C4, S4, S5).
- §6.3: cross-realm got a real design + a scope gate (C5).
- §6.2: TeeState gained its two load-bearing members, `m_stream` and the mutable `m_reader` (M6).
- §1: class #14 (async iterator) and the shared reader base added (M7, S2, OP-SIG #8).
- §5.1: the "O(1) promises" claim was wrong AND the "optimization" would be a bug; retracted (M8).
- §7.1a: NEW — the one sanctioned, termination-safe catch pattern + its exact site list (M9, OP-SIG #7).
- §7.2/§7.4: the user-JS list gained signal-abort / read-request steps / thenable resolution;
  §7.4's blanket exemption corrected (M10).
- §3.3: `[[writeRequests]]` element type stated explicitly (minor).
