# Bun Web Streams — Current C++ Surface

All paths relative to `src/jsc/bindings/webcore/` unless noted. Line numbers are from the current worktree.

## 1. Architecture today

### The one big fact
**Essentially all stream STATE lives in JS private fields written by the builtins in `src/js/builtins/*.ts`.** The C++ layer is (a) thin JSC cell classes whose prototypes are populated with *builtin-generated* functions (`...CodeGenerator(vm)` entries), and (b) a set of "impl"/glue objects (`WebCore::ReadableStream`, `InternalWritableStream`, `ReadableStreamSource/Sink`) whose only job is to *call back into* those builtins by private name. The C++ side owns almost no stream semantics.

### (a) `new ReadableStream(src)` from JS
- The global `ReadableStream` constructor is `JSReadableStreamDOMConstructor = JSDOMBuiltinConstructor<JSReadableStream>` (JSReadableStream.cpp:140). Its "body" is the JS builtin `readableStreamInitializeReadableStreamCodeGenerator` (JSReadableStream.cpp:159-162), i.e. `initializeReadableStream()` in `src/js/builtins/ReadableStream.ts`.
- Objects allocated:
  1. ONE `JSReadableStream` JSC cell (JSReadableStream.h:27). It is `JSDOMObject` (== `JSDOMWrapper<void>` — **no wrapped impl**, no refcounted C++ backing object). It carries exactly 3 native fields (JSReadableStream.h:85-88): `WriteBarrier<Unknown> m_nativePtr`, `int m_nativeType`, `bool m_disturbed` (+ `m_transferred`). Its own IsoSubspace (JSReadableStream.cpp:293).
  2. Whatever the builtin creates: a plain-object / builtin-constructed `ReadableStreamDefaultController` or `ReadableByteStreamController` (`JSReadableStreamDefaultController` is also a plain `JSDOMObject` with **zero native fields**, JSReadableStreamDefaultController.h:27) plus queue objects, promises, etc. — all plain JS.
  3. **Zero refcounted C++ impl objects and zero Strong handles** on this path. `WebCore::ReadableStream` (the DOMGuarded wrapper) is only materialized on demand by native callers (see below), never by the JS constructor.
- State written by the builtins onto the JSReadableStream via private names (`clientData->builtinNames().xxxPrivateName()` / `@`-names in the .ts):
  - `$state`, `$reader`, `$readableStreamController`, `$storedError`, `$underlyingSource`, `$start`, `$highWaterMark`, `$asyncContext`, `$queue`, `$started`, `$pullAgain`, `$pulling`, `$closeRequested`, `$strategy{HWM,SizeAlgorithm}`, `$controlledReadableStream`, `$ownerReadableStream`, `$readRequests`, `$closedPromiseCapability`, … (see `src/js/builtins/ReadableStreamInternals.ts`). These live as **ordinary own properties keyed by private symbols on the JS object**, not in C++.
  - THREE of the "private fields" are actually **DOMAttribute custom accessors on the prototype** backed by the C++ member fields (JSReadableStream.cpp:227-235): `$bunNativePtr` ↔ `m_nativePtr` (getter forces `-1` when transferred, :189-199), `$bunNativeType` ↔ `m_nativeType`, `$disturbed` ↔ `m_disturbed`. So `stream.$disturbed = true` from a builtin writes the C++ bool. `m_nativePtr` is GC-visited (JSReadableStream.cpp:303-311).
- Prototype surface (JSReadableStream.cpp:166-178, 236-239): builtin-generated `cancel/getReader/locked/pipeThrough/pipeTo/tee`, `@@asyncIterator`+`values` (builtin), plus **4 Bun-added native functions**: `blob/bytes/json/text` (each just calls a lazily-created JS builtin function cached on the global, e.g. `m_readableStreamToText`, ReadableStream.cpp:608-629).

### (b) Native-created stream
Two distinct native paths:
1. **Legacy WebCore path (nearly dead)**: `ReadableStream::create(global, RefPtr<ReadableStreamSource>&&[, nativePtr])` (ReadableStream.cpp:80-110) constructs a `JSReadableStreamSource` wrapper (a real `JSDOMWrapper<ReadableStreamSource>` holding a `Ref<>` to the C++ source, JSReadableStreamSource.h:29) and invokes the `@ReadableStream` private constructor with it. It then wraps the resulting `JSReadableStream` in a **`Ref<WebCore::ReadableStream>`** which is a `DOMGuarded<JSReadableStream>` (ReadableStream.h:39) — i.e. one refcounted C++ heap object holding a GC-guarded (Strong-equivalent) handle to the JS cell, registered on the global's guarded-object set. `nativePtr` is put as `$bunNativePtr` on the source stream (:101-102). **No caller of this overload exists outside these files (rg: 0 hits)** — this whole path is effectively dead in Bun.
2. **The real Bun path**: Rust `NewSource<C>` (`src/runtime/webcore/ReadableStream.rs:663`) → `to_js()` produces a `JS{Blob,File,Bytes}InternalReadableStreamSource` (a `.classes.ts`-generated ZigGeneratedClasses class, NOT one of the files audited here) → `ZigGlobalObject__createNativeReadableStream` (ReadableStream.cpp:510) calls the JS builtin behind `@createNativeReadableStream` which builds a JS `ReadableStream` whose `$bunNativePtr` is that source wrapper cell. `ReadableStreamTag__tagged` (ReadableStream.cpp:419) later downcasts `$bunNativePtr` (`JSBlobInternalReadableStreamSource` etc.) back to a raw `void*` + a tag so Rust can bypass the JS machinery entirely. **This is the path that must survive**; it does not touch `ReadableStreamSource`/`JSReadableStreamSource` at all.

### Object layout summary
| Class | Kind | Native fields | GC roots created |
|---|---|---|---|
| `JSReadableStream` | `JSDOMObject`, own IsoSubspace | m_nativePtr (WriteBarrier), m_nativeType, m_disturbed, m_transferred | 0 |
| `WebCore::ReadableStream` | RefCounted `DOMGuarded<JSReadableStream>` (ReadableStream.h:39) | the guarded handle | 1 guarded (Strong-like) handle per instance |
| `JSReadableStreamDefaultController`/`Reader`/`BYOBReader`/`BYOBRequest`/`ByteStreamController`/`TransformStream`/`TSDefaultController`/`{ByteLength,Count}QueuingStrategy`/`WritableStreamDefaultController`/`Writer` | plain `JSDOMObject`, JSDOMBuiltinConstructor, own IsoSubspace each | **none** | 0 |
| `JSWritableStream` | `JSDOMWrapper<WritableStream>` | `Ref<WritableStream>` | via visitAdditionalChildren |
| `WritableStream` | RefCounted, holds `Ref<InternalWritableStream>` (WritableStream.h:56) | — | — |
| `InternalWritableStream` | `DOMGuarded<JSObject>` around the *builtin-created* internal WritableStream plain object (InternalWritableStream.h:33) | guarded handle (`DoNotRegisterWithGlobalObjectTag`; kept alive by `JSWritableStream::visitAdditionalChildrenInGCThread`, JSWritableStream.cpp:295-302) | 1 |
| `JSReadableStreamSource` | `JSDOMWrapper<ReadableStreamSource>` + `WriteBarrier m_controller` (JSReadableStreamSource.h:51) | Ref\<impl\> | 0 (weak-owned wrapper cache) |

**WritableStream is a triple-object sandwich**: `JSWritableStream` (JS-visible cell) → `Ref<WritableStream>` (pure forwarding shell, WritableStream.h) → `Ref<InternalWritableStream>` (guarded handle to a *plain JS object* created by `@createInternalWritableStreamFromUnderlyingSink` in `WritableStreamInternals.ts`, InternalWritableStream.cpp:54-70). All the real writable state ($state, $writer, $controller, $writeRequests, …) lives on that inner plain JS object. So every `new WritableStream()` costs: 1 JSC cell + 2 C++ heap allocations + 1 guarded GC handle + 1 inner plain JS object, purely to bridge to JS code.

## 2. Exported/public symbol inventory (must-re-provide vs safe-to-drop)

Verified with a batched `rg` over `src/` + `packages/` excluding these files. "Rust FFI" = declared in `src/runtime/webcore/ReadableStream.rs:84-123`.

### ReadableStream.h / .cpp
| Symbol | Referenced outside these files? | Where / verdict |
|---|---|---|
| `ReadableStream::create(global, JSReadableStream&)` / `(global, RefPtr<Source>&&[, nativePtr])` | **NO** | safe to drop (the whole `WebCore::ReadableStream` guarded class has no external users) |
| `ReadableStream::isDisturbed/isLocked/cancel/tee/lock/pipeTo/readableStream` (member) | **NO** (only via the extern-C shims below) | drop; keep semantics |
| `JSReadableStreamWrapperConverter`, `toJS/toJSNewlyCreated(ReadableStream)` (ReadableStream.h:69-103) | **NO** | drop |
| `jsFunctionTransferToNativeReadableStream` (ReadableStream.cpp:281) | **YES** — installed on the global; called from `src/js/internal/streams/native-readable.ts` (via `$transferToNativeReadableStream`) | **must re-provide** |
| extern "C" `ReadableStream__tee` (:297) | **YES** — Rust FFI (ReadableStream.rs:88) | **must re-provide** |
| extern "C" `ReadableStream__cancel` (:345) | **YES** — ReadableStream.rs:112 | **must re-provide** |
| extern "C" `ReadableStream__cancelWithReason` (:373) | **YES** — ReadableStream.rs:113 | **must re-provide** |
| extern "C" `ReadableStream__detach` (:392) | **YES** — ReadableStream.rs:118 | **must re-provide** |
| extern "C" `ReadableStream__isDisturbed` (:406) / `__isLocked` (:412) | **YES** — ReadableStream.rs:101,105 | **must re-provide** |
| extern "C" `ReadableStreamTag__tagged` (:419) | **YES** — ReadableStream.rs:96 (also `FetchTasklet.rs`) | **must re-provide** — this is THE Rust↔stream bridge (returns the `Tag` enum + raw `NewSource` ptr from `$bunNativePtr`) |
| extern "C" `ZigGlobalObject__createNativeReadableStream` (:510) | **YES** — ReadableStream.rs:119 | **must re-provide** |
| extern "C" `ZigGlobalObject__readableStreamTo{ArrayBuffer,Bytes,Text,FormData,JSON,Blob}` (:565-698) | **YES** — bound as `Bun.readableStreamTo*` (packages/bun-types/bun.d.ts, `src/jsc/JSGlobalObject.rs`) and used by prototype `.text()/.json()/...` | **must re-provide** |
| `functionReadableStreamToArrayBuffer/Bytes` host fns (:701,715) | JSGlobalObject property table | must re-provide (as `Bun.readableStreamTo*`) |
| `ReadableStream__empty/__used/__errored` | **YES** — defined in `bindings.cpp` (not these files), bound in ReadableStream.rs:109-111 | out of scope but same contract |
| `ReadableStream__incrementCount` (declared JSReadableStream.cpp:49) | **NO** (never called; declaration only) | dead — delete |

### JSReadableStream.h/.cpp
- `JSReadableStream` class itself: referenced by `ZigGlobalObject.cpp`, `JS2Native.cpp`, `js_classes.ts`, `generate-jssink.ts`, `structuredClone`/serialization (grep `JSReadableStream` outside → yes). The `info()`/`dynamicDowncast<JSReadableStream>` brand check and the `m_nativePtr/m_nativeType/m_disturbed` fields + `$bunNativePtr/$bunNativeType/$disturbed` accessors are the load-bearing API. **Must re-provide equivalents.**
- `JSReadableStream::getConstructor`, `createPrototype`, `subspaceForImpl`: only used by the JSDOMGlobalObject constructor/prototype maps → replaced wholesale.

### ReadableStreamSource / JSReadableStreamSource
- No class outside these files derives from `ReadableStreamSource` (rg `: public ReadableStreamSource` → only `SimpleReadableStreamSource` inside ReadableStreamSource.h:72). External refs to the name are only registry entries: `generated_classes_list.rs`, `generate-classes.ts` (the *unrelated* `${X}InternalReadableStreamSource` naming), `DOMIsoSubspaces.h`/`DOMConstructors.h`, `JS2Native.cpp`. **The abstraction is DEAD — safe to drop entirely** (see §3).

### ReadableStreamSink / JSReadableStreamSink
- `ReadableStreamToSharedBufferSink`: **0 external refs**. `ReadableStream::pipeTo(sink)` (:144) is its only consumer and has 0 callers. **Whole file pair is dead — safe to drop.**

### WritableStream / InternalWritableStream / JSWritableStream
- `JSWritableStream` class: **YES** — `ZigGlobalObject.cpp` (constructor/structure registration, `toJSNewlyCreated<IDLInterface<WritableStream>>`), `generate-jssink.ts` header include. `WritableStream::create` is called from `JSWritableStreamDOMConstructor::construct` (JSWritableStream.cpp:98-120) only. `InternalWritableStream::fromObject` is referenced from `ZigGlobalObject.cpp` (used by TransformStream `.writable` bridging & fetch request-body). **The public `WritableStream` global must obviously be re-provided; the 3-layer C++ sandwich can be collapsed.**
- The JS side already implements everything: `createInternalWritableStreamFromUnderlyingSink`, `isWritableStreamLocked`, `acquireWritableStreamDefaultWriter`, `writableStream{Abort,Close}ForBindings` private names are the ONLY things InternalWritableStream calls (InternalWritableStream.cpp:57,86,106,119,136,152).

### The 10 "builtin-constructor-only" classes
`JSReadableStreamDefaultController`, `JSReadableStreamDefaultReader`, `JSReadableStreamBYOBReader`, `JSReadableStreamBYOBRequest`, `JSReadableByteStreamController`, `JSTransformStream`, `JSTransformStreamDefaultController`, `JSByteLengthQueuingStrategy`, `JSCountQueuingStrategy`, `JSWritableStreamDefaultController`, `JSWritableStreamDefaultWriter` — each is byte-for-byte the same generated shape: a `JSDOMObject` with no fields, a prototype whose entire method table is `...CodeGenerator` builtin references, and a `JSDOMBuiltinConstructor` whose body is the `initializeXxx` builtin. External refs: only `ZigGlobalObject.cpp` (global registration) + `js_classes.ts`. **All droppable once the same globals/prototypes exist elsewhere; the only value they add over a plain JS class is (a) the branded `info()` for `dynamicDowncast` (used by `JSReadableStreamSource::start`, itself dead) and (b) per-class IsoSubspaces.** Prototype tables to preserve (names + which are builtins): see JSReadableStreamDefaultReader.cpp:110-117 (`closed/read/readMany/cancel/releaseLock` — note the non-standard **`readMany`**), JSReadableStreamDefaultController.cpp:110-116 (+ a non-standard `$sink` slot pre-seeded on the prototype, :127), JSReadableStreamSource.cpp:106-110 (prototype pre-seeds `$bunNativePtr`/`$bunNativeType = 0` — a Bun addition), JSTransformStream.cpp:109-110, JSWritableStreamDefaultWriter.cpp:112-118, etc.

## 3. The `ReadableStreamSource` / `ReadableStreamSink` C++ abstractions

### ReadableStreamSource (ReadableStreamSource.h:37) — **effectively dead code**
- Contract: subclass overrides `setActive/setInactive/doStart/doPull/doCancel`. The base drives the WHATWG algorithms: `start(controller, promise)` stores a `DOMPromiseDeferred<void>` + a `ReadableStreamDefaultController` handle then calls `doStart()`; the subclass later calls `startFinished()/pullFinished()` to resolve the pending promise (ReadableStreamSource.cpp:32-67). Producers push via `controller().enqueue(JSValue)` / `.close()` / `.error()`, which each **look up a builtin by private name and call it** (`readableStreamDefaultControllerEnqueue/Close/Error` — ReadableStreamDefaultController.cpp:62-153). Backpressure = the start/pull promise: JS `pull()` calls into `JSReadableStreamSource::pull` (JSReadableStreamSourceCustom.cpp:53) which stores the DeferredPromise; the source resolves it when it has produced. No desiredSize plumbing at all.
- `ReadableStreamDefaultController` (the C++ one) is NOT a JSC object: it is a 1-pointer value type wrapping the `JSReadableStreamDefaultController*` (ReadableStreamDefaultController.h:42-57) with the comment "owner is responsible to keep it uncollected" — a raw unbarriered JSC pointer.
- Derivers: only `SimpleReadableStreamSource` (same header). **Zero users anywhere in src/ or packages/**. `JSReadableStreamSource` is only reachable via the equally-dead `ReadableStream::create(RefPtr<Source>)`. → **The entire pull-based native-source abstraction can be deleted with no replacement**; Bun's real native sources are the Rust `NewSource<C>` `.classes.ts` objects tagged through `$bunNativePtr`.

### ReadableStreamSink (ReadableStreamSink.h:38) — dead
Contract: `enqueue(BufferSource)/close()/error(String)`. One impl, `ReadableStreamToSharedBufferSink`, whose `pipeFrom(stream)` calls `stream.pipeTo(*this)` → `@readableStreamPipeToSink` builtin. **0 external users.** Delete.

### WritableStreamSink (WritableStreamSink.h:38) — dead
`write/close/error` + `SimpleWritableStreamSink`. Only consumed by `WritableStream::create(global, Ref<WritableStreamSink>&&)` (WritableStream.cpp:56) which itself has 0 external callers. Delete.

## 4. The generated JSSink layer (`src/codegen/generate-jssink.ts`) — INDEPENDENT, survives

Generates, for each of `ArrayBufferSink, FileSink, HTTPResponseSink, HTTPSResponseSink, H3ResponseSink, NetworkSink` (generate-jssink.ts:3-9):
- `JS${name}Constructor` (InternalFunction), `JS${name}` (JSDestructibleObject holding a raw `void* m_sinkPtr` into the Rust sink + `m_refCount` + `m_onDestroy`, :112-118), `JS${name}Prototype`,
- `JSReadable${name}Controller` (JSDestructibleObject: `void* m_sinkPtr`, `WriteBarrier m_onPull`, `WriteBarrier m_onClose`, `Weak<JSObject> m_weakReadableStream`, `uintptr_t m_onDestroy` — :170-175) + its prototype,
- extern "C" glue per sink: `${name}__memoryCost`, `${name}__controllerDetached`, `${name}__setDestroyCallback`, `${name}__getInternalFd`, `${name}__updateRef`, plus the shared `JSSink_isSink`, `Bun__onSinkDestroyed`, `createJSSinkPrototype/ControllerPrototype`.
- ONE shared host function `functionStartDirectStream` installed as the private global `$startDirectStream` (ZigGlobalObject.cpp:2940). It takes `(readableStream, onPull, onClose, asyncContext)` with `this` = a `JSReadable*Controller`, and calls `controller->start(...)` which stashes `m_weakReadableStream` (Weak!), `m_onPull`, `m_onClose` (generate-jssink.ts:298-343, 889-900).

**How `type:"direct"` connects**: In `ReadableStreamInternals.ts`, `assignToStream(stream, sink)` (:807) / `$readDirectStream` fetch the direct controller (which IS one of these JSReadable*Controller objects, created by native code and handed to JS as `underlyingSource`) and call `$startDirectStream.$call(sink, stream, underlyingSource.pull, close, stream.$asyncContext)` (:781, :1005, :1017). The controller's `close`/`end` host functions (`${controller}__close/__end`, generate-jssink.ts:437-527) call back into Rust via `${name}__controllerDetached`, then `detach()` fires `m_onClose(readableStream)`.

**Coupling to the ReadableStream builtins/wrappers**:
1. `functionStartDirectStream` receives the ReadableStream *as an opaque JSObject* and stores it in a `Weak<JSObject>` — it does **not** downcast to `JSReadableStream` and reads nothing from it. NOT coupled.
2. `generate-jssink.ts` `#include`s `JSReadableStream.h` (header emission) but only for the include; no use of the type in generated logic that I found beyond includes.
3. The real coupling is **in JS**: `ReadableStreamInternals.ts` treats `underlyingSource.$lazy / $bunNativePtr / type === "direct"` specially and drives the JSSink controller from there.

**Verdict: the JSSink layer is structurally INDEPENDENT of the C++ ReadableStream classes.** It couples only to (a) the private global function slot `$startDirectStream` and (b) the JS builtins' direct-stream protocol. A rewrite that keeps the JS builtins' direct-stream path (or reimplements it) keeps JSSink untouched. The only file-level dependency to fix is the `JSReadableStream.h` include in the generated header.

## 5. Costs (per stream, today)

- **JS-constructed ReadableStream**: 1 JSC cell in a dedicated IsoSubspace + the builtin-created controller cell + ~10-20 private-symbol own properties (structure transitions) on the stream/controller. 0 C++ heap allocs, 0 Strong handles. Cheap-ish; the cost is structure churn + megamorphic private-name lookups in the builtins, not C++.
- **Any native code touching a stream** goes through `invokeReadableStreamFunction` / `invokeConstructor`: a `globalObject.get(privateName)` (uncacheable property lookup on the global) + `JSC::call` + `MarkedArgumentBuffer` per operation (ReadableStream.cpp:112-127, ReadableStreamDefaultController.cpp:43-60, InternalWritableStream.cpp:35-52). `isLocked` from native is 2 `getDirect`s (:253-268); fine. But e.g. every native `controller.enqueue()` is a full dynamic JS call through a global lookup.
- **`WebCore::ReadableStream` (when created)**: 1 refcounted heap object + 1 DOMGuarded handle registered on the global (kept alive until deref). Created fresh on *every* `toWrapped` conversion (ReadableStream.h:70-81) — i.e. a heap alloc per IDL argument conversion. Dead path though.
- **WritableStream**: the triple sandwich described in §1 — 2 C++ heap allocs + 1 guarded GC handle + a JSC wrapper cell + an inner plain JS "internal stream" object, per instance, plus every operation (`locked`, `abort`, `close`, `getWriter`) is a private-name global lookup + JS call (InternalWritableStream.cpp). This is the highest fixed overhead of the layer.
- **JSSink direct streams**: 1 JSDestructibleObject controller cell (2 WriteBarriers + 1 Weak) + 1 sink cell holding a raw `void*` into Rust. Lean; keep.
- **Double-object wrapper+impl pattern**: real for `JSWritableStream`/`WritableStream`/`InternalWritableStream` and `JSReadableStreamSource`/`ReadableStreamSource`; NOT present for `JSReadableStream` (it's a single cell) or any controller/reader.

## INCOMPLETE — not read line-by-line
`JSReadableStreamBYOBReader.cpp/.h`, `JSReadableStreamBYOBRequest.*`, `JSReadableByteStreamController.*`, `JSTransformStream*.{h,cpp}`, `JSByteLengthQueuingStrategy.*`, `JSCountQueuingStrategy.*`, `JSWritableStreamDefaultController/Writer.{h,cpp}`, `JSWritableStreamSink.{h,cpp}`: I read one full representative of the identical generated template (JSReadableStreamDefaultReader.cpp, JSReadableStreamDefaultController.cpp) and grepped the rest for every prototype table, `initializeExecutable`, `WriteBarrier`, and `extern "C"` — they contain none beyond the pattern documented in §2. `generate-jssink.ts` was read via header + targeted line ranges (1-215, 290-345, 680-940 via grep), not every one of its 1287 lines; the middle (per-sink `close/end/flush/write` prototype method bodies) was not transcribed but does not touch ReadableStream internals beyond what §4 states.
