# Web Streams Rewrite — CONSUMER MAP

Every call site OUTSIDE the to-be-deleted files that reaches into the current Web Streams
implementation. Paths are relative to the repo root
(`/root/bun/.claude/worktrees/bridge-cse_01V63gchYpD4NmSJpEWfYGqT`). Produced under a hard time
budget; sections explicitly marked INCOMPLETE were not exhaustively searched.

To-be-deleted set (for reference): `src/js/builtins/{ReadableStream*,WritableStream*,TransformStream*,ReadableByteStream*,StreamInternals,ByteLengthQueuingStrategy,CountQueuingStrategy}.ts` and `src/jsc/bindings/webcore/{JSReadableStream*,ReadableStream*,JSWritableStream*,WritableStream*,InternalWritableStream*,JSTransformStream*,JSReadableByteStreamController*,JSByteLengthQueuingStrategy*,JSCountQueuingStrategy*}.{cpp,h}`.

---

## A) JS-side consumers in `src/js/` (non-deleted builtins & node modules)

### A.1 Private-intrinsic call sites (link-time `@name` builtins — break at codegen if removed)

| file:line | identifier | needs |
|---|---|---|
| `src/js/node/stream.consumers.ts:5,12,18,28,42` | `$inheritsReadableStream(stream)` | brand check ("is this (or subclass of) a ReadableStream") for arrayBuffer/blob/bytes/text/json consumers; falls through to `Bun.readableStreamTo*` |
| `src/js/internal/streams/utils.ts:78,82,86` | `$inheritsReadableStream`, `$inheritsWritableStream`, `$inheritsTransformStream` | brand checks used by `isReadableStream/isWritableStream/isTransformStream` (node:stream internal duck-typing) |
| `src/js/internal/webstreams_adapters.ts:342,585,682,685` | `$inheritsWritableStream`, `$inheritsReadableStream` | node:stream `toWeb`/`fromWeb` argument validation |
| `src/js/builtins/TransformStreamInternals.ts:130` (deleted file, listed for symmetry) + `src/js/builtins/ReadableStream.ts:419,486` | `$getInternalWritableStream(writable)` | pipeTo/pipeThrough fetch the C++ `InternalWritableStream` behind a JS `WritableStream`. New impl must provide an equivalent internal-handle accessor (or make it unnecessary). |
| `src/js/builtins/TextEncoderStream.ts:40,50` | `$transformStreamDefaultControllerEnqueue(controller, buffer)` | TextEncoderStream is NOT in the delete set but is written directly against TransformStream internals (private controller-enqueue). |
| `src/js/builtins/TextDecoderStream.ts:44,59` | `$transformStreamDefaultControllerEnqueue(controller, buffer)` | same as above for TextDecoderStream |
| `src/js/builtins/CommonJS.ts:192` | `$createFIFO()` | generic FIFO helper currently defined in `StreamInternals.ts`; used outside streams — must survive (move it, don't delete). |
| `src/js/node/fs.promises.ts:69` | `$createFIFO()` | same — FIFO used by fs.promises readdir/opendir queueing |

### A.2 `$bunNativePtr` / `$bunNativeType` slot protocol (native source handle stored on the JS stream object)

Set by the current `ReadableStreamInternals`/`$createNativeReadableStream` path; read by:

| file:line | identifier | needs |
|---|---|---|
| `src/js/internal/streams/native-readable.ts:29,53,64,97,124,231,241,249` | `stream.$bunNativePtr` | node:stream Readable wrapper over a *native* ReadableStream (Bun.file().stream(), stdin, sockets). Needs: get/steal the native source pointer, `.start()`, `.pull()`, `.cancel()`, `.updateRef()`, `.drain()` on it. |
| `src/js/internal/webstreams_adapters.ts:40` | `stream.$bunNativePtr` | `newStreamReadableFromReadableStream` fast path — detects native-backed web streams and takes the native path instead of the generic reader loop |
| `src/js/builtins/ProcessObjectInternals.ts:121` | `native.$bunNativePtr` | process.stdin: obtain the native tty/file source from the underlying stream |
| `src/js/node/tty.ts:34,43,68` | `this.$bunNativePtr` | ReadStream/tty raw-mode + ref/unref on the native source handle |
| `src/js/builtins.d.ts:97,360,361,544` | `$bunNativePtr`, `$bunNativeType` | type declarations for the slot protocol |
| `src/js/builtins/ProcessObjectInternals.ts:108-110` | `underlyingSink` (kWriteStreamFastPath) | process.stdout/stderr fast path pairs a node Writable with a native FileSink `underlyingSink` |

### A.3 Constructor / public-API usage that assumes current semantics (lower risk, but audit)

| file | usage |
|---|---|
| `src/js/internal/webstreams_adapters.ts:236,284,509-533,650-671` | `new ReadableStream(...)`, `new WritableStream(...)` — node:stream `Readable.toWeb`, `Writable.toWeb`, `Duplex.toWeb/fromWeb`; relies on `type: "bytes"` byte streams, BYOB, `desiredSize`, controller `enqueue/close/error` |
| `src/js/node/_http_server.ts:2677` | `new ReadableStream({...})` for request bodies |
| `src/js/node/stream.web.ts` | re-exports globalThis stream classes as `node:stream/web` |
| `src/js/node/net.ts`, `src/js/thirdparty/node-fetch.ts`, `src/js/thirdparty/undici.js`, `src/js/internal/streams/{add-abort-signal,compose,duplexify,end-of-stream,pipeline,readable,writable}.ts`, `src/js/builtins/WasmStreaming.ts` | reference `ReadableStream`/`WritableStream`/`TransformStream` by public name; must keep working with the new globals (webIDL brand, `getReader({mode:"byob"})`, `pipeTo`, `tee`, `locked`, async iteration). |
| `src/js/builtins.d.ts:63-110, 352-500, 543-565, 806-810` | declares the whole private surface (`$assignToStream`, `$assignStreamIntoResumableSink`, `$startDirectStream`, `$createEmptyReadableStream`, `$createErroredReadableStream`, `$createNativeReadableStream`, `$createWritableStreamFromInternal`, `$getInternalWritableStream`, `$lazyStreamPrototypeMap`, `$readableStreamController`, `$controlledReadableStream`, `$ownerReadableStream`, `$associatedReadableByteStreamController`, `$underlyingSource`, `$underlyingSink`, …). Must be updated in lockstep. |
| `src/js/CLAUDE.md:35-38`, `src/js/README.md:79` | docs referencing `underlyingSource` / `readableStreamToJSON` (doc-only) |

### INCOMPLETE — not searched (A)
- `src/js/node/stream.ts` itself (the huge node:stream port) beyond the files above.
- `src/js/builtins/WasmStreaming.ts` internals (reads a Response body ReadableStream).
- shell / S3 JS-side helpers (S3 stream plumbing appears to be Rust-side, but not confirmed here).

---

## B) C++ consumers under `src/jsc/` (outside the deleted files)

### B.1 `ZigGlobalObject.h` / `ZigGlobalObject.cpp` — the registration hub (largest single consumer)

- `src/jsc/bindings/ZigGlobalObject.cpp:92,95,123-129,138-139,146-148` — `#include` of `JSByteLengthQueuingStrategy.h`, `JSCountQueuingStrategy.h`, `JSReadableByteStreamController.h`, `JSReadableStream.h`, `JSReadableStreamBYOBReader.h`, `JSReadableStreamBYOBRequest.h`, `JSReadableStreamDefaultController.h`, `JSReadableStreamDefaultReader.h`, `JSSink.h`, `JSTransformStream.h`, `JSTransformStreamDefaultController.h`, `JSWritableStream.h`, `JSWritableStreamDefaultController.h`, `JSWritableStreamDefaultWriter.h`. All break on delete.
- `ZigGlobalObject.h:275` — `readableStreamNativeMap()` returning `m_lazyReadableStreamPrototypeMap` (a `JSMap*`); visited in `ZigGlobalObject.cpp:1162` (GC visitChildren / structure init). Used by the JS builtins' `$lazyStreamPrototypeMap` (lazy native prototype cache keyed by source type).
- `ZigGlobalObject.h:363` + `ZigGlobalObject.cpp:2865-2871` — `GlobalObject::assignToStream(JSValue stream, JSValue controller)`: looks up/caches `m_assignToStream` (`ZigGlobalObject.h:486`, a WriteBarrier<JSFunction> holding the `readableStreamInternalsAssignToStream` builtin) and calls it. **Rust sinks depend on this.**
- `ZigGlobalObject.h:488-493` — cached `WriteBarrier<JSFunction>` for `m_readableStreamToArrayBuffer/Bytes/Blob/JSON/Text/FormData` (the `Bun.readableStreamTo*` builtins, lazily fetched from the Bun object).
- `ZigGlobalObject.h:884-888` — `extern "C" ZigGlobalObject__readableStreamToText/ArrayBuffer/Bytes/JSON/Blob(FormData)` declarations (implemented in the to-be-deleted `webcore/ReadableStream.cpp:565-678`). **Called from Rust** (see C).
- `ZigGlobalObject.cpp:1178,1181,1204,1214,1215` — `WEBCORE_GENERATED_CONSTRUCTOR_GETTER(ByteLengthQueuingStrategy/CountQueuingStrategy/ReadableByteStreamController/TransformStream/TransformStreamDefaultController)`; plus `:3024-3026` private-name custom getters for `TransformStream`, `TransformStreamDefaultController`, `ReadableByteStreamController`.
- `ZigGlobalObject.cpp:1665-1666,1715-1733,2959-2960` — host functions `getInternalWritableStream` / `createWritableStreamFromInternal` installed under the private names `getInternalWritableStream` / `createWritableStreamFromInternal`; downcast to `JSWritableStream` and call `InternalWritableStream::fromObject`. Used by the ReadableStream pipeTo/pipeThrough builtins and by fetch upload paths.
- `ZigGlobalObject.cpp:2385-2409, 2533-2601` — lazily-initialized JSSink controller prototypes/structures for `SinkID::{ArrayBufferSink,FileSink,HTTPResponseSink,HTTPSResponseSink,NetworkSink,H3ResponseSink}` via `createJSSinkPrototype` / `createJSSinkControllerPrototype` / `createJSSinkControllerStructure` from generated `JSSink.h/.cpp` (section E). These structures back `$startDirectStream` / direct (type:"direct") streams.
- `ZigGlobalObject.cpp:2836` — `extern "C" Bun__assignStreamIntoResumableSink(global, stream, sink)`: fetches the `readableStreamInternalsAssignStreamIntoResumableSink` builtin and calls it. **Called from Rust `ResumableSink.rs`.**
- `ZigGlobalObject.cpp:2940` — installs `builtinNames.startDirectStreamPrivateName()` (`$startDirectStream`) as a global private function.
- `ZigGlobalObject.cpp:2983-2986` — installs `$createEmptyReadableStream`, `$createUsedReadableStream`, `$createNativeReadableStream` (builtin code generators from `ReadableStream.ts`).
- `ZigGlobalObject.cpp:3023` — installs the `$lazyStreamPrototypeMap` custom getter (`functionLazyLoadStreamPrototypeMap_getter`).
- `src/jsc/bindings/ZigGlobalObject.lut.txt:74-79,84-85,91-93` — global constructor entries for `ReadableByteStreamController, ReadableStream, ReadableStreamBYOBReader, ReadableStreamBYOBRequest, ReadableStreamDefaultController, ReadableStreamDefaultReader, TransformStream, TransformStreamDefaultController, WritableStream, WritableStreamDefaultController, WritableStreamDefaultWriter` (also `CompressionStream:51`, `DecompressionStream:55`, `TextEncoderStream:83`, `TextDecoderStream:81` — these stay but are built on TransformStream/generic-transform internals).

### B.2 Other C++ files

| file:line | identifier | needs |
|---|---|---|
| `src/jsc/bindings/bindings.cpp:3171-3199` | `ReadableStream__empty`, `ReadableStream__used`, `ReadableStream__errored` (ZIG_EXPORT/extern C) — call `builtinNames().createEmptyReadableStreamPrivateName()` / `createUsedReadableStreamPrivateName()` builtins (bindings.cpp:3176,3187). | Rust asks C++ for a fresh empty / already-used / pre-errored ReadableStream (used for empty bodies, consumed bodies). |
| `src/jsc/bindings/BunObject.cpp:989-995` | `readableStreamToArray/ArrayBuffer/Bytes/Blob/FormData/JSON/Text` registered as `JSBuiltin` on the `Bun` object (LUT). | The `Bun.readableStreamTo*` public API is currently implemented as ReadableStream.ts builtins. New impl must provide these 7 functions. |
| `src/jsc/bindings/JS2Native.cpp:13-15` | `ByteBlob__JSReadableStreamSource__load`, `FileReader__JSReadableStreamSource__load`, `ByteStream__JSReadableStreamSource__load` (extern "C", **implemented in Rust**) | `$lazy(id)` handlers that hand the JS side a native "readable stream source" prototype/loader for the three native source kinds (blob-backed, file-backed, byte/socket-backed). This is how `$lazyStreamPrototypeMap` / `$createNativeReadableStream` bind to native sources. |
| `src/jsc/bindings/webcore/DOMConstructors.h:189-206` | enum entries `ByteLengthQueuingStrategy, CountQueuingStrategy, ReadableByteStreamController, ReadableStream*, ReadableStreamSink, ReadableStreamSource, TransformStream, TransformStreamDefaultController, WritableStream*, WritableStreamSink` | constructor-index table used by `WEBCORE_GENERATED_CONSTRUCTOR_GETTER` |
| `src/jsc/bindings/webcore/DOMIsoSubspaces.h:27-29,259-276` and `DOMClientIsoSubspaces.h:27-29,277-294` | `m_subspaceForJSSink{,Constructor,Controller}`, `m_subspaceFor{ByteLengthQueuingStrategy,CountQueuingStrategy,ReadableByteStreamController,ReadableStream…,ReadableStreamSink,ReadableStreamSource,TransformStream…,WritableStream…,WritableStreamSink}` | iso-subspace slots consumed by generated `subspaceFor<>` in the deleted classes AND by generated JSSink.cpp |
| `src/jsc/bindings/webcore/JSDOMGuardedObject.cpp:54` | comment referencing TransformStream→WritableStream guarded-object cycle; the guarded-object root set (`m_guardedObjects`) is how `InternalWritableStream`/`ReadableStreamSource` keep wrappers alive today | new impl must define its own GC-rooting story |
| `src/jsc/bindings/webcore/JSDOMBindingInternalsBuiltins.h`, `JSDOMIterator.cpp`, `JSDOMPromise.cpp` | matched on generic private-name / builtin plumbing used by the stream builtins (`@Promise` helpers, `markPromiseAsHandled`, etc.) | shared infrastructure, keep |
| `src/js/builtins/BunBuiltinNames.h` (see D) | the private-name macro table | |
| `src/jsc/STREAMS.md` | prose doc of the current design | rewrite |
| `src/jsc/bindings/headers.h:465-581` | `ArrayBufferSink__assignToStream`, `HTTPSResponseSink__assignToStream`, `HTTPResponseSink__assignToStream`, `FileSink__assignToStream` (x2), `NetworkSink__assignToStream`, `H3ResponseSink__assignToStream` — extern decls of the **Rust-implemented, jssink-generated** per-sink entry points that C++ (generated `JSSink.cpp`) forwards into. | Direct-stream attach path. |
| Files matched only on `PrivateName()` / generic names — `BunProcess.cpp`, `BundlerMetafile.cpp`, `JSBundlerPlugin.cpp`, `JSCommonJSModule.cpp`, `JSEnvironmentVariableMap.cpp`, `JSStringDecoder.cpp`, `NodeDirent.cpp`, `NodeVM*.cpp`, `napi.cpp`, `NodeModuleModule.cpp` | no stream-specific dependency found in the targeted grep | likely false positives of the broad pattern; re-verify |

### INCOMPLETE — not searched (B)
- `src/jsc/bindings/webcore/{JSReadableStreamSink,JSWritableStreamSink,JSReadableStreamSource*,ReadableStreamSink,ReadableStreamSource}.{h,cpp}` — these are stream infrastructure NOT in the stated delete list but almost certainly dead-or-replaced with it (JSReadableStreamSource exposes `onClose`/`start`/`pull` to the Rust `ReadableStream.rs` native sources; `JSReadableStream.cpp:49` declares `extern "C" void ReadableStream__incrementCount(void*, int32_t)` which is **implemented in Rust** for source refcounting).
- SerializedScriptValue / structuredClone transfer of ReadableStream/WritableStream/TransformStream (grep for `structuredCloneForStream` name exists in BunBuiltinNames; the transfer path was not traced).
- CompressionStream / DecompressionStream / TextEncoderStream / TextDecoderStream `.ts` + `JS*.cpp` — they wrap TransformStream/GenericTransformStream and will need re-basing.
- `WasmStreaming` C++ side.

---

## C) Rust consumers (`src/**/*.rs`)

### C.1 `src/runtime/webcore/ReadableStream.rs` — the Rust `ReadableStream` handle (primary consumer)

Extern "C" it CALLS (all currently defined in the to-be-deleted `webcore/ReadableStream.cpp`, except where noted):

| Rust line | symbol | expects |
|---|---|---|
| 88 | `ReadableStream__tee(stream, global, &out1, &out2) -> bool` | tee into two streams |
| 101 | `ReadableStream__isDisturbed(stream, global) -> bool` | disturbed flag |
| 105 | `ReadableStream__isLocked(stream, global) -> bool` | locked flag |
| 109-111 | `ReadableStream__empty(global)`, `ReadableStream__used(global)`, `ReadableStream__errored(global, reason)` (defined in `bindings.cpp:3171+`, which call the `$createEmptyReadableStream` / `$createUsedReadableStream` builtins) | construct empty / used / errored streams |
| 112-118 | `ReadableStream__cancel(stream, global)`, `ReadableStream__cancelWithReason(stream, global, reason)`, `ReadableStream__detach(stream, global)` | cancel / detach native source from a stream |
| 119 | `ZigGlobalObject__createNativeReadableStream(global, nativePtr) -> JSValue` | wrap a Rust native source pointer into a JS ReadableStream (calls the `$createNativeReadableStream` builtin) |
| (via `Tag`) | `ReadableStreamTag__tagged(global, &streamValue, &ptr) -> i32` (`webcore/ReadableStream.cpp:419`) | **THE STREAM-TAG PROTOCOL**: classifies a JS ReadableStream and returns its native source pointer. Enum `Tag` (`ReadableStream.rs:483`, `assert_ffi_discr!` at :507): `Invalid=-1, JavaScript=0, Blob=1, File=2, Direct=3, Bytes=4`. `from_js` (:281-306) dispatches on it (Blob/File/Bytes carry a `*mut` native source; Direct means a direct sink stream). Any new impl MUST preserve or replace this discriminant contract. |
| 918 | comment: `JSReadableStreamSource.onClose` invoked via `close_handler` | native sources register JS-visible onClose/onDrain callbacks on the ReadableStreamSource wrapper |
| 1317,1325 | `streams::BufferActionTag::{Blob,Bytes,…}` | buffered-consume actions (`.blob()`, `.bytes()`, `.arrayBuffer()`, `.json()`, `.text()`) |

Rust also **EXPORTS** (consumed by C++): `ByteBlob__JSReadableStreamSource__load`, `FileReader__JSReadableStreamSource__load`, `ByteStream__JSReadableStreamSource__load` (see JS2Native.cpp:13-15) and `ReadableStream__incrementCount` (declared in `JSReadableStream.cpp:49`).

### C.2 `src/jsc/JSGlobalObject.rs:1156-1180, 1682-1699`

Safe wrappers calling `ZigGlobalObject__readableStreamToArrayBuffer/Bytes/Text/JSON/Blob/FormData(global, streamValue[, contentType])`. Used everywhere a body must be buffered (fetch/Response/Request `.text()/.json()/…`, S3, shell, `Bun.readableStreamTo*` native fast paths). The new C++ must export these six symbols with identical signatures (returning a JSPromise-encoded value).

### C.3 `src/runtime/webcore/Sink.rs` + `src/runtime/generated_jssink.rs` — direct streams / sinks

- `Sink.rs:478-583,1041` — `decl_js_sink_externs!` declares, per sink ABI name, the C++-side symbols `${Name}__{fromJS,createObject,setDestroyCallback,assignToStream,onClose,onReady,detachPtr}` generated by `generate-jssink.ts` into `JSSink.cpp`. `assignToStream` is documented (:583) as `${abi}__assignToStream` — the direct-stream attach path: C++ `JSSink.cpp` in turn calls `globalObject->assignToStream(...)` → the `$assignToStream` builtin in `ReadableStreamInternals.ts`.
- `streams.rs:1150-1215` — `HTTPServerWritableJSSink<SSL,HTTP3>` dispatches to `HTTPResponseSink/HTTPSResponseSink/H3ResponseSink` extern sets (`assign_to_stream`, `on_close`, `on_ready`, `detach_ptr`, …).
- `streams.rs:76-88` — `StartTag` enum `{Empty,Err,ChunkSize,ArrayBufferSink,FileSink,HTTPSResponseSink,HTTPResponseSink,H3ResponseSink,NetworkSink,Ready,OwnedAndDone,Done}` — the return protocol of the JS `start(controller)` call on a direct-stream underlying source; parsed from JS in `Start::from_js` (`streams.rs:112+`). Consumed at `Blob.rs:1980`, `FileSink.rs:1171`, and `streams.rs:141,209`.
- `streams.rs:902` — comment: `#[repr(C)]` `Signal` is written by C++ `*Sink__assignToStream` in `JSSink.cpp` (shared C-layout struct crossing FFI).
- `streams.rs:2484` — `BufferActionTag` (Blob/Bytes/…) used by `Blob.rs:6614-6634`, `ReadableStream.rs:1317,1325`.

### C.4 `src/runtime/webcore/ResumableSink.rs:248,649`

Calls `Bun__assignStreamIntoResumableSink(global, jsStream, sink)` (C++ `ZigGlobalObject.cpp:2836`) → invokes the `$assignStreamIntoResumableSink` builtin from `ReadableStreamInternals.ts`. Used by upload paths (fetch request bodies, S3 multipart) to pump a JS ReadableStream into a native resumable sink; `FetchTasklet.rs:863` documents that it kicks off `await reader.read()`.

### C.5 Other Rust files that hold/produce `webcore::ReadableStream` values (from `rg -l JSSink|ReadableStream`)

`src/runtime/webcore/{streams.rs, Body.rs, Blob.rs, ArrayBufferSink.rs, FileSink.rs, FileReader.rs (TAG = Tag::File at :95), ResumableSink.rs, Sink.rs, s3/client.rs}`, `src/runtime/webcore.rs`, `src/runtime/server/RequestContext.rs` (`:2031,2050,2091-2094` — assignToStream ordering with `res.end`), `src/runtime/api/bun/subprocess.rs`, `src/runtime/api/bun/subprocess/Writable.rs`, `src/runtime/lib.rs`, `src/runtime/build.rs` (runs generate-jssink), `src/runtime/generated_jssink.rs` (generated), `src/jsc/JSGlobalObject.rs`, `src/io/posix_event_loop.rs:230-234` (PollTag::FileSink). All of these consume the Rust `ReadableStream`/sink abstractions, not the JS internals directly — they break only if the extern-C surface in C.1-C.4 changes.

### INCOMPLETE — not searched (C)
- Exhaustive per-call-site listing inside `Body.rs` / `Blob.rs` / `RequestContext.rs` / `s3/` / `shell/` of every `ReadableStream::from_js` / `Tag::` dispatch (dozens of sites; all funnel through `ReadableStream.rs`).
- `src/runtime/webcore/streams.rs` full extern inventory (the file is ~2.5k lines).

---

## D) Codegen & registration

- `src/js/builtins/BunBuiltinNames.h` — the private-name macro table. Stream-related entries (all become `builtinNames().<x>PrivateName()` in C++ and `$x` in TS): class names `ReadableByteStreamController, ReadableStream, ReadableStreamBYOBReader, ReadableStreamBYOBRequest, ReadableStreamDefaultController, ReadableStreamDefaultReader, TextEncoderStreamEncoder, TransformStream, TransformStreamDefaultController, WritableStream, WritableStreamDefaultController, WritableStreamDefaultWriter` (lines 28-40); functions/slots `assignToStream(45), associatedReadableByteStreamController(46), closeRequest(65), closeRequested(66), controlledReadableStream(71), controller(72), createEmptyReadableStream(74), createErroredReadableStream(75), createNativeReadableStream(78), createUsedReadableStream(80), createWritableStreamFromInternal(81), disturbed(88), getInternalWritableStream(110), highWaterMark(113), inFlightCloseRequest(120), inFlightWriteRequest(121), internalWritable(125), lazyStreamPrototypeMap(130), ownerReadableStream(150), pendingPullIntos(158), pull(163), pullAgain(164), pullAlgorithm(165), pulling(166), queue(167), readable(171), readableStreamController(172), reader(173), sink(188), startDirectStream(193), strategy(199), strategyHWM(200), strategySizeAlgorithm(201), stream(202), structuredCloneForStream(203), textDecoderStreamDecoder(206), textDecoderStreamTransform(207), textEncoderStreamEncoder(208), textEncoderStreamTransform(209), transformAlgorithm(212), underlyingByteSource(213), underlyingSink(214), underlyingSource(215), writable(220), writeRequests(223), writer(224)`. Any name whose only users are the deleted files can be dropped; the rest (esp. `assignToStream`, `startDirectStream`, `createNativeReadableStream`, `createEmptyReadableStream`, `createUsedReadableStream`, `getInternalWritableStream`, `lazyStreamPrototypeMap`, `underlyingSource`, `underlyingSink`, `structuredCloneForStream`, `bunNativePtr`) are consumed elsewhere.
- `src/codegen/replacements.ts:68-82` — `globalsToPrefix`/class-name replacement list containing `ReadableByteStreamController, ReadableStream, ReadableStreamBYOBReader, ReadableStreamBYOBRequest, ReadableStreamDefaultController, ReadableStreamDefaultReader, TransformStream, TransformStreamDefaultController, WritableStream, WritableStreamDefaultController, WritableStreamDefaultWriter` — the bundler rewrites bare `ReadableStream` in builtins to the `$`-private lookup. Removing the builtins changes what these must resolve to.
- `src/codegen/bundle-functions.ts` — bundles every `src/js/builtins/*.ts`; deleting the stream `.ts` files removes their generated `*Builtins.h/.cpp` and every `readableStreamInternals*CodeGenerator(vm)` symbol referenced from `ZigGlobalObject.cpp` (`:2983-2986`, `:2871`, etc.) and `bindings.cpp`.
- `src/jsc/bindings/webcore/DOMConstructors.h:189-206`, `DOMIsoSubspaces.h`, `DOMClientIsoSubspaces.h` — see B.2.
- `src/jsc/bindings/js_classes.ts`, `src/jsc/generated_classes_list.rs` — matched the class-name grep; the generated-class registry that must drop/replace the stream entries.
- `src/jsc/bindings/ZigGlobalObject.lut.txt` — see B.1.
- CMake source lists: **INCOMPLETE — not searched**: no `cmake/` hit from repo root in the time budget; the C++ source list that names `webcore/JSReadableStream.cpp` etc. (likely `cmake/targets/BuildBun.cmake` or a generated glob) was not located.

---

## E) `src/codegen/generate-jssink.ts`

Generator for the **direct-stream sink** glue. Inputs: the hard-coded sink class list (`ArrayBufferSink, FileSink, HTTPResponseSink, HTTPSResponseSink, NetworkSink, H3ResponseSink`). Outputs (build dir): `JSSink.h`, `JSSink.cpp`, `JSSink.lut.txt`/`JSSink.lut.h`, and `generated_jssink.rs` (checked in at `src/runtime/generated_jssink.rs`).

Key couplings to the current stream implementation:
- `generate-jssink.ts:279` — generated `JSSink.cpp` does `#include "JSReadableStream.h"` (a deleted header).
- `:304` — throws `"Expected ReadableStream"` after a `jsDynamicCast<JSReadableStream*>`-style check in `${Name}__assignToStream`.
- `:174,704,712,890,1062` — each sink controller holds `JSC::Weak<JSObject> m_weakReadableStream` (the owning ReadableStream), set in `assignToStream`, cleared on close/detach — this is how a direct stream's controller keeps/loses its stream.
- `:466,513` — comments: closing/erroring transitions the owning ReadableStream and calls `underlyingSource.cancel()`.
- `:206` — `extern "C" bool JSSink_isSink(JSGlobalObject*, EncodedJSValue)`.
- `:215-217` — `createJSSinkPrototype`, `createJSSinkControllerPrototype`, `createJSSinkControllerStructure` (consumed by `ZigGlobalObject.cpp:2385-2601`).
- `:1075-1273` — emits the Rust `extern "C"` thunks (`${Name}__{fromJS,createObject,setDestroyCallback,assignToStream,onClose,onReady,detachPtr,close,endWithSink,updateRef,memoryCost,finalize,controllerDetached,getInternalFd}`) that pair with `src/runtime/webcore/Sink.rs::decl_js_sink_externs!` and `src/jsc/bindings/headers.h:465-581`.

The `assignToStream` flow (must be preserved end-to-end): Rust sink → `${Name}__assignToStream` (generated C++) → `GlobalObject::assignToStream` (`ZigGlobalObject.cpp:2865`) → JS builtin `$assignToStream` (`ReadableStreamInternals.ts`, deleted) → `$startDirectStream` on the stream → controller handed back to Rust via the out-param `void** jsvalue_ptr` and the shared `#[repr(C)] Signal` (`streams.rs:902`).

---

## Summary of required exports

The new pure-C++ implementation MUST provide equivalents for all of the following, or every listed consumer must be rewritten in the same change.

### 1. JS-visible private intrinsics (link-time `@`-names consumed by NON-deleted `src/js/` code)
- `$inheritsReadableStream(v)`, `$inheritsWritableStream(v)`, `$inheritsTransformStream(v)` — brand checks (stream.consumers, internal/streams/utils, webstreams_adapters).
- `$getInternalWritableStream(writable)` and `$createWritableStreamFromInternal(internal[, sizeAlgorithm])` — global private host functions (installed at `ZigGlobalObject.cpp:2959-2960`).
- `$transformStreamDefaultControllerEnqueue(controller, chunk)` — used by TextEncoderStream.ts / TextDecoderStream.ts.
- `$createFIFO()` — generic queue helper (CommonJS.ts, fs.promises.ts); NOT stream-specific — relocate out of StreamInternals before deleting.
- The `$bunNativePtr` (and `$bunNativeType`) own-property protocol on native-backed ReadableStream objects — read by native-readable.ts, webstreams_adapters.ts, ProcessObjectInternals.ts, tty.ts. Includes the native handle contract: `.start()`, `.pull(view)`, `.cancel(reason)`, `.updateRef(bool)`, `.drain()`, `onClose`, `onDrain`.
- `Bun.readableStreamToArray/ArrayBuffer/Bytes/Blob/Text/JSON/FormData` (BunObject LUT, `BunObject.cpp:989-995`).
- Public globals with correct brands & LUT entries: `ReadableStream, ReadableStreamDefaultReader, ReadableStreamBYOBReader, ReadableStreamBYOBRequest, ReadableStreamDefaultController, ReadableByteStreamController, WritableStream, WritableStreamDefaultController, WritableStreamDefaultWriter, TransformStream, TransformStreamDefaultController, ByteLengthQueuingStrategy, CountQueuingStrategy` (+ keep `CompressionStream/DecompressionStream/TextEncoderStream/TextDecoderStream` working on top).

### 2. C++ symbols / global-object hooks
- `Zig::GlobalObject::assignToStream(stream, controller)` and the `$assignToStream` / `$startDirectStream` machinery (direct streams).
- `Bun__assignStreamIntoResumableSink(global, stream, sink)`.
- `getInternalWritableStream` / `createWritableStreamFromInternal` host functions + `InternalWritableStream` equivalent.
- `createJSSinkPrototype` / `createJSSinkControllerPrototype` / `createJSSinkControllerStructure` + `JSSink_isSink` (or replace generate-jssink entirely).
- `readableStreamNativeMap()` (`m_lazyReadableStreamPrototypeMap` JSMap) and the `$lazyStreamPrototypeMap` getter, or a replacement for the lazy native-source prototype cache.
- `WEBCORE_GENERATED_CONSTRUCTOR_GETTER` + `DOMConstructors.h` slots + iso-subspaces for every retained class.
- GC rooting story replacing the guarded-object / `JSC::Weak m_weakReadableStream` patterns.

### 3. Rust-facing `extern "C"` entry points (must keep exact names & signatures, or update `ReadableStream.rs`/`Sink.rs`/`JSGlobalObject.rs` in lockstep)
- `ReadableStreamTag__tagged(global, &stream, &ptr) -> i32` with discriminants `{Invalid=-1, JavaScript=0, Blob=1, File=2, Direct=3, Bytes=4}` (`assert_ffi_discr!` in `ReadableStream.rs:507` will fail the build otherwise).
- `ReadableStream__tee`, `ReadableStream__isDisturbed`, `ReadableStream__isLocked`, `ReadableStream__cancel`, `ReadableStream__cancelWithReason`, `ReadableStream__detach`, `ReadableStream__empty`, `ReadableStream__used`, `ReadableStream__errored`.
- `ZigGlobalObject__createNativeReadableStream(global, nativePtr)`.
- `ZigGlobalObject__readableStreamToArrayBuffer/Bytes/Text/JSON/Blob/FormData`.
- Per-sink `${Name}__{fromJS,createObject,setDestroyCallback,assignToStream,onClose,onReady,detachPtr,...}` for `ArrayBufferSink, FileSink, HTTPResponseSink, HTTPSResponseSink, NetworkSink, H3ResponseSink` (C++→Rust direction generated by generate-jssink; the C++ half is what changes).
- Rust→C++ callbacks that C++ currently declares: `ByteBlob__JSReadableStreamSource__load`, `FileReader__JSReadableStreamSource__load`, `ByteStream__JSReadableStreamSource__load` (JS2Native `$lazy` ids), `ReadableStream__incrementCount(void*, i32)`.
- The `#[repr(C)]` `Signal` struct written by `*Sink__assignToStream` (`streams.rs:902`) and the `StartTag` return protocol of direct-stream `start()` (`streams.rs:76`).

### 4. Global-object private names / structures
- Every `BunBuiltinNames.h` stream entry still referenced from surviving code (see D) — at minimum: `assignToStream, startDirectStream, createEmptyReadableStream, createErroredReadableStream, createUsedReadableStream, createNativeReadableStream, createWritableStreamFromInternal, getInternalWritableStream, lazyStreamPrototypeMap, bunNativePtr/bunNativeType, underlyingSource, underlyingSink, structuredCloneForStream`, plus the class private names installed as custom getters at `ZigGlobalObject.cpp:3024-3026`.
- `ZigGlobalObject.h:486-493` WriteBarrier fields (`m_assignToStream`, `m_readableStreamTo*`) and their visitChildren entries.
- `ZigGlobalObject.lut.txt` global constructor entries listed in B.1.

## INCOMPLETE — not searched
- CMake/build source lists naming the deleted `.cpp` files.
- `src/js/node/stream.ts` main file; WasmStreaming (.ts and C++); CompressionStream/TextEncoderStream/TextDecoderStream C++ (`JSTextEncoderStream.cpp` etc.); structuredClone/postMessage transfer of streams (SerializedScriptValue).
- Full per-line inventory of `streams.rs`, `Body.rs`, `Blob.rs`, `RequestContext.rs`, `s3/`, `shell/` Rust call sites (all funnel through the extern-C surface in section 3).
- Tests/docs (`docs/`, `test/`) were out of scope.
