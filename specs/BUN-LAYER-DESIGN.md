# Bun-Specific Layer — Design (v2)

> **v2 = v1 + the merged fixes from `specs/BUN-LAYER-REVIEW-{GC,FIDELITY}.md`. Do not consult v1.**
> Statements tagged `[reproduced]` were empirically reproduced on the real Bun binary by the
> fidelity reviewer; they are the highest-confidence facts in this document and must not be
> second-guessed by an implementer. See the `## Changed in v2` appendix for the finding-by-finding
> delta and the short list of deliberate behavior changes v2 ships.

Companion to `specs/ARCHITECTURE.md` (v2). This document designs everything that is *Bun's*,
not the WHATWG spec's: the `Direct` stream mode, the lazy native source, the JSSink coupling,
the `Bun.readableStreamTo*` fast paths, the extern-"C" Rust contract, and the non-spec public
API. It resolves every `TBD(bun-ext)` and `TBD(consumers)` in ARCHITECTURE Appendix A.

**Rules inherited unconditionally from ARCHITECTURE:** §4.1 (the single
`performPromiseThenWithContext` reaction mechanism; no capturing `JSNativeStdFunction`),
§4.1's second sanctioned form (the `JSBoundFunction` blessing, incl. the argument-order
trap — §2.2), §5 (no C++ `virtual` on any JSCell), §7 (exception/reentrancy discipline),
§7.6 (no `Strong`, no `protect`; ONE narrow `JSC::Weak` allowance, used at exactly the one
site §7.6 names — §2.2). State lives in C++ members, never JS properties. Nothing here
relaxes those.

Ground truth: `specs/BUN-EXTENSIONS.md` (BE), `specs/CPP-SURFACE.md` (CS),
`specs/CONSUMERS.md` (CO), `specs/PLUMBING.md` (PL), plus the cited source lines (all
verified against the current tree; where BE/CS/CO is corrected, that is called out inline).

Abbreviations: `RSI` = `src/js/builtins/ReadableStreamInternals.ts`,
`RS` = `src/js/builtins/ReadableStream.ts`, `GJS` = `src/codegen/generate-jssink.ts`.

---

## 1. `JSReadableStream` — the Bun-mode members

Today the "Bun mode" is spread across 4 C++ fields + 4 private-property slots (CS §1a;
BE §1.1, §2.1). The C++ replacement adds these members to `JSReadableStream` **in addition**
to ARCHITECTURE §3's spec slots:

```cpp
// ---- Bun extension state on JSReadableStream ----

// Replaces the `$start` thunk (RS:82, RS:93-98). No stored closure: the mode
// tells materializeIfNeeded() exactly what to do.
enum class BunStreamMode : uint8_t {
    Default,       // an ordinary spec stream (controller may still be null: "Nothing")
    DirectPending, // type:"direct", not yet consumed  (⇔ old `$underlyingSource != null`)
    NativePending, // $lazy native stream, not yet consumed (⇔ old `$start` = lazyLoadStream thunk)
};
BunStreamMode m_bunMode { BunStreamMode::Default };

// Widened controller slot (§4 below). ARCHITECTURE §3.2 names this as its ONE mandatory
// exception to the exact-typed back-pointer rule: `JSReadableStream::m_controller` is the
// ERASED `WriteBarrier<JSObject>` + a `ControllerKind` tag, because a stream's controller
// can be a spec controller, a JSDirectStreamController, or (native-sink path A) an opaque
// generated JSReadable*Controller cell. §4.7 is the EXHAUSTIVE dispatch table; a raw
// jsCast/static_cast on this slot is BANNED, and every switch over the kind is TOTAL.
enum class ControllerKind : uint8_t { None, Default, Byte, Direct, NativeSink };
ControllerKind m_controllerKind { ControllerKind::None };
JSC::WriteBarrier<JSC::JSObject> m_controller;   // visited

// `$bunNativePtr` (CS §1a, JSReadableStream.h:85-88). Holds one of:
//   - empty          → not a native stream
//   - a JSCell       → the JS{Blob,File,Bytes}InternalReadableStreamSource handle from Rust
//   - jsNumber(-1)   → detached (ReadableStream__detach, ReadableStream.cpp:392-404)
JSC::WriteBarrier<JSC::Unknown> m_nativePtr;     // visited
int32_t m_nativeType { 0 };                      // `$bunNativeType`; write-only today, keep for ABI
bool    m_transferred { false };                 // set by jsFunctionTransferToNativeReadableStream

// `$underlyingSource` on the STREAM (RS:80). Non-null ⇔ "type:direct AND not yet consumed"
// (BE §1.5). Every consumer nulls it on first consumption. Redundant with
// m_bunMode == DirectPending — kept anyway because readDirectStream needs the object.
JSC::WriteBarrier<JSC::JSObject> m_directUnderlyingSource;   // visited

// `$highWaterMark` on the STREAM. Distinct from the controller's strategy HWM.
//
// WRITERS — ALL FOUR constructor arms of `initializeReadableStream` write it, not just
// the direct/lazy ones (fidelity review MAJOR #5):
//   - RS:65  (the eager-`pull` arm)          ← strategy.highWaterMark
//   - RS:81  (the `type:"direct"` arm)       ← strategy.highWaterMark
//   - RS:84-91 (the `$lazy` native arm)      ← autoAllocateChunkSize || strategy.highWaterMark
//   - RS:101 (the plain spec arm)            ← strategy.highWaterMark
// So EVERY ReadableStream carries the strategy HWM in this stream-level slot, and
// readStreamIntoSink hands it to the native HTTP/file sink for ORDINARY spec streams too
// (`Bun.serve` responding with `new Response(new ReadableStream({pull}, {highWaterMark: 65536}))`
// starts the HTTP sink with 65536 today). A port that only populates this in the
// DirectPending/NativePending arms is wrong.
//
// CONSUMERS + the EXACT per-consumer normalization of the raw JS value (each site applies a
// different coercion; do not unify them):
//   - readStreamIntoSink        (RSI:989):  `hwm || 0`             → unset/NaN/0 ⇒ 0
//   - assignStreamIntoResumableSink (RSI:941): `hwm || 0`          → same
//   - readDirectStream          (RSI:776-779): `!hwm || hwm < 64 ? 64 : hwm`  (min-64 clamp;
//                                note this relationally compares even a non-number raw value)
//   - ArrayBufferSink initial capacity (RSI:1608-1611): passed only if
//                                `hwm && typeof hwm === "number"` — see §4.1.
// NaN = "unset" (the slot was `undefined`); never confuse with 0.
double m_bunHighWaterMark { std::numeric_limits<double>::quiet_NaN() };

// autoAllocateChunkSize from $createNativeReadableStream (RS:84,93-98). 0 = unset
// (⇒ 256 KiB default at materialization, RSI:2373-2376).
uint64_t m_autoAllocateChunkSize { 0 };

// `$asyncContext` snapshot at construction (RS:52). §8.
JSC::WriteBarrier<JSC::Unknown> m_asyncContext;  // visited
```

`m_nativePtr`, `m_controller`, `m_directUnderlyingSource`, `m_asyncContext` all appear in
`visitChildrenImpl`. `m_reader` (ARCHITECTURE §3.2) is widened the same way: today a "locked
by native/direct, no real reader" state is a bare `{}` sentinel object (BE §1.5;
RSI:783, 1257, 2482). Replace the sentinel with an explicit bit:

```cpp
bool m_lockedWithoutReader { false };   // replaces `$reader = {}`
```

### 1.1 The ONE materialization entry point

```cpp
// Runs the lazy-start thunk if any. Idempotent. MUST be the first thing every
// consumer does. Can run user JS (direct pull setup / native handle.start()).
void JSReadableStream::materializeIfNeeded(JSC::JSGlobalObject*);   // userJS? YES
```

Body:
- `Default` → return.
- `DirectPending` → `setUpDirectStreamController(global, this, DirectSinkKind::ArrayBuffer,
  m_bunHighWaterMark)` (§4); set `m_bunMode = Default`.
  This is `RSI:204-206` → `$initializeArrayBufferStream`.
- `NativePending` → `materializeNativeSource(global, this)` (§2); set `m_bunMode = Default`.
  This is `RS:93-98` → `$lazyLoadStream` + `$createReadableStreamController`.

**Callers (exhaustive — every site that ran `$start` or read `$underlyingSource` today):**

| consumer | old site | note |
|---|---|---|
| `getReader()` (default mode only) | `RS:396-400` | `getReader({mode:"byob"})` does **NOT** materialize (RS:405-406 does not run `$start`). Preserve: a BYOB reader on a lazy native stream never touches the native fast path (BE §4). |
| `readMany()` internal (`AcquireReadableStreamDefaultReader`) | `RSI:109-116` | |
| `tee()` / `ReadableStream__tee` | `RSI:547-551` | force-materializes then does the ordinary default tee |
| `values()` / `[Symbol.asyncIterator]()` | via `getReader()` | |
| `pipeTo` / `pipeThrough` | via `acquireReadableStreamDefaultReader` (RSI:276) | |
| `readableStreamCancel` | `RSI:1769-1770` | **does NOT materialize**: an unmaterialized stream has `controller === null` → resolve immediately. Keep. |
| `Bun.readableStreamTo*` | §3 | the `*Direct` branch runs its OWN direct-flavor materialization BEFORE this; `materializeIfNeeded` is only reached on the generic path |
| `$assignToStream` (native sink) | `RSI:807-823` | `DirectPending` → `readDirectStream` (a DIFFERENT materialization); else `readStreamIntoSink` |
| `Response.body` / any `.body` getter | (native) | the getter returns the stream; consumption goes through the paths above — no extra call needed |

`readMany` (§7) additionally handles the "direct controller not yet started" case
(`ReadableStreamDefaultReader.ts:63-68`) via the `Direct` `ControllerKind`.

### 1.2 The `-1` detached sentinel & `locked`

```cpp
// The value the OLD JS `$bunNativePtr` DOMAttribute getter returned
// (JSReadableStream.cpp:189-199): jsNumber(-1) once transferred, else m_nativePtr.
JSC::JSValue nativePtrForJS() const {
    if (m_transferred) return JSC::jsNumber(-1);
    return m_nativePtr.get();   // may be empty
}
bool nativeHandleDetached() const {
    return m_transferred || (m_nativePtr.get().isInt32() && m_nativePtr.get().asInt32() == -1);
}
```

`isReadableStreamLocked(stream)` (RSI:1719-1728):

```cpp
bool isReadableStreamLocked(JSReadableStream* s) {
    return s->m_reader || s->m_lockedWithoutReader || s->nativeHandleDetached();
}
```

This is used by the public `locked` getter, every `Bun.readableStreamTo*`, `getReader`,
`pipeTo/Through`, `tee`, and `ReadableStream__isLocked`.

> **Behavioral note (unification, deliberate):** today `ReadableStream__isLocked`'s C++ path
> (`ReadableStream.cpp:253-268`) reads `nativePtr()` RAW and therefore does NOT treat a
> `transferToNativeReadableStream`'d stream as locked, while the JS path (RSI:1726) does.
> The two callers see different answers today. This design uses the JS answer everywhere
> (transferred ⇒ locked). **DECIDED (was Open Question 1).** The fidelity reviewer
> independently verified the divergence is real and agrees with unifying on the JS answer.
> It is a deliberate, user-invisible-in-practice delta and is recorded in "Changed in v2".
> Preserved hedge (the reviewer's, applied): `ReadableStream__isLocked`'s Rust callers
> (`ReadableStream.rs:265` → body-consumption guards) **must be audited before the header is
> frozen**, since a `Readable.fromWeb`'d body would newly report locked to Rust. That audit
> is an implementation-phase gate, not an open design question.

`nativeHandleDetached()` also gates: `materializeNativeSource` (returns early on `-1`,
RSI:2364-2365) and `tryUseReadableStreamBufferedFastPath` (a detached handle is not a cell →
skipped).

It does **NOT** gate `readableStreamReaderGenericRelease`'s `updateRef(false)` — the OLD
claim here was inverted (fidelity review MINOR). Source (RSI:1943-1945):
`if (stream.$bunNativePtr) { controller.$underlyingSource.$resume(false) }`. The
`$bunNativePtr` getter returns `jsNumber(-1)` when detached/transferred, which is **truthy**,
so the branch runs for the detached state too. And it fires `$resume` on whatever the
controller's `$underlyingSource` is — including the empty/drained fast-path object literal
(RSI:2391-2409), which has no `$resume`. The faithful C++ gate is therefore:
**"the stream's `m_nativePtr` slot is non-empty (ANY value, including the `-1` sentinel)
AND the controller's `SourceKind` is `Native`"** (the second half is what keeps the
object-literal fast-path case from crashing today). Then call the adapter's
`handle.updateRef(false)`. See §2.4.

`ReadableStream__detach` writes `m_nativePtr = jsNumber(-1)`, `m_nativeType = 0`,
`m_disturbed = true` (ReadableStream.cpp:392-404).
`jsFunctionTransferToNativeReadableStream` writes ONLY `m_transferred = true; m_disturbed = true`
— the underlying handle cell stays reachable through `m_nativePtr` on purpose:
`native-readable.ts:53` steals it BEFORE calling the transfer fn. Both must keep both shapes.

---

## 2. `SourceKind::Native` — the materialized native pull source

BE §2.3, RSI:2144-2360. ARCHITECTURE §4 is right: `Native` is a `SourceKind` on a **spec
DEFAULT controller** (never a byte controller — the v1.1.44 decision, RSI:2132-2143).
`Direct` is NOT a `SourceKind`; it is a stream **mode** (§1) that materializes into
`JSDirectStreamController` (§4), a separate controller kind. **ARCHITECTURE §4's
`SourceKind::Direct` arm should be DELETED from the enum**; nothing ever uses it.

### 2.1 The native handle's JS API (contract with the Rust `.classes.ts` sources)

The handle (`m_nativePtr`) is a `JS{Blob,File,Bytes}InternalReadableStreamSource` generated
class. Its surface, exactly as `NativeReadableStreamSource` uses it (RSI:2159-2160, 2310,
2318, 2347-2356, 2378):

| member | signature | semantics |
|---|---|---|
| `start(n)` | `(autoAllocateChunkSize: number) -> TypedArray \| number` | **TypedArray** ⇒ the entire content is already buffered; treat `chunkSize = 0` and use the returned buffer as the drain value (RSI:2380-2382). **number** ⇒ the source's preferred chunk size; a subsequent `drain()` returns any already-buffered bytes (RSI:2384-2386). |
| `pull(view, closer)` | `(view: Uint8Array, closer: JSArray) -> number \| TypedArray \| boolean \| Promise<same>` | fills `view`. **number** = bytes written into `view`. **TypedArray** = a native over-read (more than `view` held) — enqueue it directly. **boolean** = close now. **Promise** = async; decode the settled value the same way. Native may write `closer[0] = true` synchronously to signal EOF (issue #29787). |
| `drain()` | `() -> TypedArray \| undefined` | already-buffered bytes |
| `cancel(reason)` | `(reason) -> void` | |
| `updateRef(b)` | `(bool) -> void` | ref/unref the event loop |
| `onClose = fn` / `onDrain = fn` | property assignment | native calls these (`onDrain(chunk)`) |

None of this changes: the Rust classes are outside the rewrite.

### 2.2 `JSNativeStreamSourceAdapter` — the C++ port of `NativeReadableStreamSource`

The per-instance state RSI:2144-2360 keeps (`$data`, `#closer`, `#hasResized`,
`autoAllocateChunkSize`, `#closed`, `#controller`) becomes a small internal GC cell that is
the controller's `m_algorithmContext` for `SourceKind::Native`:

```cpp
// src/jsc/bindings/webcore/streams/BunStreamSource.h
// DESTRUCTIBLE: it owns a JSC::Weak (a non-trivially-destructible member), so this is a
// JSC::JSDestructibleObject with its own iso subspace, not a JSNonFinalObject.
class JSNativeStreamSourceAdapter final : public JSC::JSDestructibleObject {
    JSC::WriteBarrier<JSC::JSObject> m_handle;      // the native source cell (2.1)
    // The back-edge to the JS consumer side is WEAK — see below and ARCHITECTURE §7.6.
    JSC::Weak<JSReadableStreamDefaultController> m_controller;
    JSC::WriteBarrier<JSC::JSObject> m_pendingView; // `$data`: the unfilled tail Uint8Array
    JSC::WriteBarrier<JSC::JSObject> m_closer;      // a length-1 JSArray, per instance (#29787)
    size_t   m_chunkSize;                            // adaptive; see 2.4
    bool     m_hasResized { false };
    bool     m_closed    { false };
    DECLARE_VISIT_CHILDREN;   // the 3 WriteBarriers. m_controller is a Weak: NOT visited.
};
```

The controller's `m_algorithmContext` is the adapter. The adapter's back-edge to the
controller, `m_controller`, is a **`JSC::Weak<JSReadableStreamDefaultController>`** — this is
the ONE sanctioned `JSC::Weak` in the subsystem (ARCHITECTURE §7.6's Weak paragraph names
exactly this site and states the standard of proof). It does the same job the current
implementation's `WeakRef` does (RSI:2154, 2180, 2207-2216, where `#controller` is a
`WeakRef` and `#onClose` explicitly nulls it).

**Why it must be weak, not strong (GC review MAJOR #2):** the handle is externally rooted by
Rust. `ReadableStream.rs:681-689` + `increment_count` (`:945-956`): the handle wrapper's
`JsRef` is upgraded to Strong while a native I/O ref is held, and stays Strong for the whole
lifetime of an `updateRef(true)`'d long-lived source (a socket, stdin). With a STRONG
back-edge the graph
`Rust Strong → handle → handle.onDrain (bound fn) → boundArgs[0] = adapter →
adapter.m_controller → controller → stream → reader → readRequests → queued chunks`
(plus `m_pendingView`, up to the 2 MiB adaptive buffer) is pinned for as long as native holds
its root. Case (a) of the finding — a consumer that abandons the stream mid-read (drops the
reader, breaks out of `for await`, never cancels) on a long-lived `updateRef(true)`'d handle —
has **no terminal path**: `callClose`/`cancelAlgorithm`/`#onClose` never run, so
"sever on close" alone can never fix it. Today the whole consumer graph collects; a strong
back-edge would leak it forever. The `Weak` is therefore load-bearing, not an optimization.

**Every read of `m_controller` null-checks it.** `m_controller.get()` returning null means
the JS consumer side has been collected ⇒ the correct action is exactly today's: drop the
data / no-op (`#onDrain` RSI:2163-2168 silently drops the chunk; `#onClose` RSI:2207-2216
skips `callClose`). No path may assume the controller is alive.

**When `m_controller` is assigned (fidelity review MAJOR #9):** NOT eagerly at
`materializeNativeSource` time. The source wires `#controller` at exactly two points
(RSI:2154, 2180, 2302-2304): (a) inside `start`, and only when a `drainValue` exists;
(b) otherwise on the **first pull**. Preserve both points exactly. Consequence (today's
behavior, preserved): a native source whose Rust side pushes a chunk via `onDrain` before JS
ever calls `reader.read()` **loses that chunk**, and an early native `onClose` is a pure
flag-flip — because the back-edge is not yet set. Do not "fix" this by wiring eagerly; that
is a behavior change.

**Terminal-path severing (the OTHER half of GC MAJOR #2 — BOTH halves are required):**
even with the Weak back-edge, the `handle → onClose/onDrain boundfn → adapter` edge keeps the
adapter (and its `m_pendingView`) alive under a lingering Rust Strong after a clean close.
On EVERY terminal path — (1) `callClose` (§2.4), (2) the Native `cancelAlgorithm` (§2.4),
(3) the native-initiated `#onClose` (§2.4) — perform, as numbered steps:
  1. set `handle.onClose = undefined` and `handle.onDrain = undefined` (the handle's cached
     callback slots; exactly what Rust's `on_close_callback_set_cached(..., UNDEFINED)` path
     already does),
  2. `m_handle.clear()`,
  3. `m_pendingView.clear()`.
Steps 1-3 are restated at each of the three sites in §2.4.

**Who owns keeping the native handle alive:** THREE visited edges — the stream's
`m_nativePtr` (needed pre-materialization by `tryUseReadableStreamBufferedFastPath`,
`ReadableStreamTag__tagged`, and `native-readable.ts`), the adapter's `m_handle` (needed
post-materialization even after `readDirectStream`-style consumers null the stream's slot),
plus Rust's own `increment_count`/guarded refs on the `NewSource` wrapper (unchanged,
outside this design). Do NOT reuse the stream's `m_nativePtr` as the adapter's handle slot:
`ReadableStream__detach` overwrites `m_nativePtr` with `-1` while a materialized adapter
must keep pulling.

**The `onClose`/`onDrain` registration** (`handle.onClose = …`, RSI:2159-2160): the value
stored must be a callable that reaches the adapter and is GC-visited from the handle. Use a
`JSC::JSBoundFunction` binding a **shared per-global native `JSFunction` on `JSStreamsRuntime`
using the BOUND-CALLABLE convention** (ARCHITECTURE §4.1's second sanctioned form) with
`boundArgs = [adapterCell]`. `JSBoundFunction` visits its bound this/args — this satisfies
§4.1's ban on capturing `JSNativeStdFunction` (nothing is captured outside the GC's view).
Two `JSBoundFunction`s per *native* stream is acceptable; native streams are the heavyweight
case and this replaces two `.bind()` closures today.

> **The two handler families (GC review MINOR — this rule applies document-wide).**
> `JSStreamsRuntime` owns TWO **disjoint closed handler lists**:
>
> - **[reaction-convention]** — handlers registered through `performPromiseThenWithContext`.
>   `boundFunctionCall` is not involved; the handler receives
>   **`(resolutionValue, contextCell)`** — context at `argument(1)`.
> - **[bound-convention]** — handlers wrapped in a `JSC::JSBoundFunction` and stored on / invoked
>   by an object we do not control. `boundFunctionCall` **PREPENDS** the bound args, so the
>   handler receives **`(contextCell, ...callArgs)`** — context at `argument(0)`.
>
> The same function object CANNOT serve both (the argument positions are opposite: a §4.1
> reaction handler reused as a bound target would `jsDynamicCast` the *payload* as the context
> → null → a silent no-op that drops chunks / never closes). A handler belongs to exactly one
> list. Every named handler in this document is annotated with its family; a handler name never
> appears under both tags.
>
> `onNativeSourceClose` and `onNativeSourceDrain` (this section) are **[bound-convention]**.

### 2.3 `materializeNativeSource(global, stream)` — the port of `lazyLoadStream` (RSI:2362-2413)

1. `handle = stream->m_nativePtr.get()`; if `nativeHandleDetached()` → return (no controller).
2. `stream->m_disturbed = true` (RSI:2371).
3. `n = stream->m_autoAllocateChunkSize ? … : 256*1024` (RSI:2373-2376).
4. `r = call(handle.start, handle, [n])`  — RETURN_IF_EXCEPTION.
   - `r` is a TypedArray → `chunkSize = 0`, `drainValue = r`.
   - else → `chunkSize = r` (as a number), `drainValue = call(handle.drain, handle, [])`.
5. **Empty fast path** (`chunkSize == 0`, RSI:2389-2410): create a default controller with
   `SourceKind::Nothing` whose start step enqueues `drainValue` (if `byteLength > 0`) then
   closes. No adapter, no native pull loop, zero further native round-trips.
6. Else: create the adapter with `m_chunkSize = max(chunkSize, n)`, wire
   `handle.onClose/onDrain` (2.2), stash `drainValue` for the start step, and create a
   default controller with `SourceKind::Native`, `m_algorithmContext = adapter`,
   `highWaterMark = 1`, no size algorithm (RSI:207-218's `type === undefined` arm).
   The Native `startAlgorithm` enqueues `drainValue` if present (RSI:2151-2157) — this
   replaces the mutable `this.start = …; this.start = undefined` dance.

### 2.4 The Native `pullAlgorithm` (the `switch(m_sourceKind)` arm)

Port RSI:2290-2341 exactly. **Every `m_controller.get()` in this section null-checks
(§2.2): null ⇒ the JS consumer is gone ⇒ drop the data / no-op.** The pull algorithm itself
runs *from* the controller, so its `m_controller` is live for the pull's synchronous span,
but the async reactions and the native-initiated `onClose`/`onDrain` must re-check.

1. If `m_closed || !m_handle` → clear state, `queueMicrotask(callClose)` (RSI:2293-2300),
   return resolved-with-undefined.
2. `m_closer->putDirectIndex(0, jsBoolean(false))`.
3. If `m_pendingView`: `d = handle.drain()`; if truthy → `decodeResult(d, m_pendingView, …)`,
   return (RSI:2309-2315).
4. `view = getInternalBuffer(m_chunkSize)` — reuse `m_pendingView` if its BACKING BUFFER is
   ≥ `m_chunkSize`, else allocate a fresh `Uint8Array(m_chunkSize)` (RSI:2219-2236; the
   `chunk.buffer.byteLength` check — not `chunk.length` — is a load-bearing regression fix;
   preserve verbatim, the comment explains a Windows commit-charge blowup).
5. `result = handle.pull(view, m_closer)`.
   - Promise → `performPromiseThenWithContext(vm, g, onNativePullFulfilled,
     onNativePullRejected, jsUndefined(), adapter)` — `onNativePullFulfilled` and
     `onNativePullRejected` are **[reaction-convention]** handlers; on fulfill decode; on
     reject `controller.error(err)` + close (RSI:2319-2334). **The controller pullAlgorithm
     returns a promise the spec machinery reacts to** — react to `result` itself (no wrapper
     promise; ARCHITECTURE §4.1 fact 6).
   - else decode synchronously.

**Pull-result decoding.** The `closer[0]` (EOF) flag is **read once, up front, and passed
INTO the handlers as `isClosed`** — there is no "after all: check `m_closer[0]`" step
(fidelity review MINOR; RSI:2274-2288). `#adjustHighWaterMark` runs only `if (!isClosed)`
(RSI:2276, 2282). Decode by result type:
- `number n` → `handleNumberResult(n, view, isClosed)` (RSI:2251-2272):
  - `if (!isClosed) adjustChunkSize(n)`.
  - if `n > 0` enqueue `view.subarray(0, n)`.
  - **if `isClosed`**: schedule `queueMicrotask(callClose)` and set `m_pendingView = null` —
    the unfilled tail is **dropped, not stored** (RSI:2266-2269).
  - else: store the tail `view.subarray(n)` into `m_pendingView` (or clear it if the view
    filled exactly).
- TypedArray → `handleViewResult(r, view, isClosed)` (RSI:2238-2249):
  `if (!isClosed) adjustChunkSize(r.byteLength)`; enqueue `r` directly; if `isClosed`,
  schedule `callClose` and `m_pendingView = null`; else `m_pendingView = view` unchanged.
- `boolean`: `queueMicrotask(callClose)`.
- anything else: throw `ERR_INVALID_STATE("Internal error: invalid result from pull. …")`.

**Invariant:** a closed (`isClosed == true`) result always yields `m_pendingView == null` and
never bumps the chunk size.

**Adaptive chunk sizing** (RSI:2172-2178): the first time a pull result's byte count `>=`
`m_chunkSize`, set `m_chunkSize = min(m_chunkSize * 2, 2 MiB)` and `m_hasResized = true`.
Exactly once. Default 256 KiB → 2 MiB cap.

**The THREE terminal paths.** Each ends with the same numbered severing sequence (§2.2, the
second half of GC MAJOR #2). "Sever" below means, in order:
(1) `handle.onClose = undefined`, `handle.onDrain = undefined`;
(2) `m_handle.clear()`;
(3) `m_pendingView.clear()`.

- **`callClose`** (RSI:2114-2130):
  1. `c = m_controller.get()`; if `c` is non-null and can close-or-enqueue → `c->close()`;
     swallow-and-`reportError` any throw. (Null `c` ⇒ the consumer is gone ⇒ skip.)
  2. Sever (1)-(3).
- **The Native `cancelAlgorithm`** (RSI:2343-2351):
  1. `handle.updateRef(false)`; `handle.cancel(reason)`.
  2. Sever (1)-(3).
  3. Return resolved-undefined.
- **The native-initiated `#onClose`** (RSI:2207-2217) — the [bound-convention]
  `onNativeSourceClose(adapterCell)` handler:
  1. `m_closed = true`.
  2. If `m_controller.get()` is non-null → run `callClose`'s close step. Else this is a pure
     flag-flip (today's behavior: RSI:2207-2216 skips `callClose` when the WeakRef is dead
     or unset — see §2.2's "when `m_controller` is assigned").
  3. Sever (1)-(3).

**`updateRef(false)` on reader release**: in `readableStreamReaderGenericRelease`, the gate
is **"`stream->m_nativePtr` slot is non-empty — ANY value, INCLUDING the `-1` detached
sentinel — AND the stream's controller has `SourceKind::Native`"**. (See §1.2: today's
truthiness check on `$bunNativePtr` runs for the detached state too, and the second
condition is what keeps the object-literal fast-path from crashing.) Then call the adapter's
`handle.updateRef(false)`. Today this is the `$resume(false)` prototype hack (RSI:2354-2357);
it becomes a direct member call. `releaseLock()` is NOT a terminal path for the adapter and
does NOT sever.

### 2.5 `$lazyStreamPrototypeMap` — **DIES**

RSI:2366-2369 memoizes a JS class per native-handle prototype purely so the `.bind()`-heavy
`NativeReadableStreamSource` class body is compiled once per source kind. In C++ the adapter
is one fixed cell class; there is nothing to memoize. Delete: the `JSMap`
`m_lazyReadableStreamPrototypeMap` on `ZigGlobalObject` (`ZigGlobalObject.h:275`,
`readableStreamNativeMap()`), the `$lazyStreamPrototypeMap` custom getter
(`ZigGlobalObject.cpp:3023`), and the `lazyStreamPrototypeMap` `BunBuiltinNames.h` entry
(PL §2 :130). CO §B.1's entry is satisfied by deletion, not replacement.

The three `JS2Native.cpp:13-15` `$lazy(id)` loaders
(`{ByteBlob,FileReader,ByteStream}__JSReadableStreamSource__load`) are Rust-implemented and
were part of the OLD `$lazyStreamPrototypeMap` bootstrap; verify they still have a caller
after the .ts deletion and delete if not (they load a *prototype object*, which nothing
native-side needs anymore).

---

## 3. `Bun.readableStreamTo*`, the buffered fast path, and the prototype methods

All 7 `Bun.readableStreamTo*` become **native host functions** (they are `$linkTimeConstant`
builtins today, RS:110-344; the `BunObject.cpp:989-995` LUT entries change from `JSBuiltin`
to native). The six `ZigGlobalObject__readableStreamTo*` externs (§6) call them directly
(no more `m_readableStreamTo*` cached-JSFunction fields on `ZigGlobalObject`,
CO §B.1 `ZigGlobalObject.h:488-493` — delete).

### 3.1 Exact check ORDER per function (this is behavior, from RS:110-344)

For `readableStreamToText / toArray / toArrayBuffer / toBytes(stream)`:
1. `jsDynamicCast<JSReadableStream*>` → else throw `ERR_INVALID_ARG_TYPE` **synchronously**.
2. `if (stream->m_bunMode == DirectPending)` → the `*Direct` path (§3.3).
   **BEFORE the locked check** (an unmaterialized direct stream is never locked, but the
   ordering is observable if a future state made both true).
3. `if (isReadableStreamLocked(stream))` → `Promise.reject(ERR_INVALID_STATE)`.
4. (`toText`, `toArrayBuffer`, `toBytes` only) `tryUseReadableStreamBufferedFastPath(stream, m)`
   → if it returned a value, return it.
5. The generic path — **specified per function below. "Generic path" is never left bare.**

**The generic (step-5) path, per function** (fidelity review CRITICAL #3's audit):

- `toArray` (RS:110-129): steps 1, 2 (Direct → `readableStreamToArrayDirect`, §3.3), 3.
  **No buffered fast path.** Generic = `readableStreamIntoArray(stream)` (RSI:2437-2452):
  `getReader()` → `readMany()` → append `value` until `done`, then release. `readMany`-batched.
- `toText` (RS:121-138): 1, 2 (Direct → `readableStreamToTextDirect`, §3.3), 3,
  fast-path`("text")`. Generic = **`readableStreamIntoText(stream)` — §3.1a.** This path
  strips a leading UTF-8 BOM; the Direct path does NOT. See §3.1a's asymmetry note.
- `toArrayBuffer(stream)` (RS:140-215): 1, 2 (Direct → `readableStreamToArrayBufferDirect(stream,
  us, /*asUint8Array*/ false)`), 3, fast-path`("arrayBuffer")`. Generic:
  `result = Bun.readableStreamToArray(stream)`, then convert the chunk array via `toArrayBuffer`
  (RS:157-206): 0 chunks → `new ArrayBuffer(0)`; 1 chunk → the chunk's own buffer if it exactly
  spans it, else a `buffer.slice(off, off+len)`, or `TextEncoder().encode()` for a string;
  N chunks → `Bun.concatArrayBuffers(result, false)` unless any chunk is a string, in which
  case an `ArrayBufferSink` accumulates them. **Preserve the peek**: if `result` is an
  already-**fulfilled** promise, `$peekPromiseSettledValue` it and return
  `$createFulfilledPromise(converted)` (collapses one microtask); a pending OR rejected
  `result` goes through `result.then(toArrayBuffer)` (RS:207-213) so a rejection propagates.
- `toBytes(stream)` (RS:218-289): identical shape to `toArrayBuffer` with
  `readableStreamToArrayBufferDirect(stream, us, /*asUint8Array*/ true)` for the Direct arm,
  fast-path`("bytes")`, and the `toBytes` converter (RS:238-283: 1 `Uint8Array` chunk is
  returned as-is; `Bun.concatArrayBuffers(result, true)` for the all-binary N-chunk case).
- `toJSON` (RS:314-333): steps 1, 3, `tryUseReadableStreamBufferedFastPath("json")`. Generic:
  `text = Bun.readableStreamToText(stream)`, then `JSON.parse`. The synchronous inspection at
  RS:323 is **`Bun.peek(text)`, NOT `Bun.peek.status`** — it cannot distinguish a fulfilled
  from a rejected promise, so the port must **only take the synchronous `JSON.parse` branch
  when `text` is FULFILLED** (peek returns the promise itself when pending; a rejected `text`
  must fall through to `text.then(JSON.parse)`). Unreachable-in-practice today (a
  synchronously-settled `text` is always fulfilled) but the port must not accidentally feed a
  rejection *reason* to `JSON.parse`. **No Direct branch.**
- `toBlob` (RS:336-344): 1, 3, fast-path`("blob")`. Generic:
  `Promise.resolve(Bun.readableStreamToArray(stream)).then(a => new Blob(a))`.
  **No Direct branch.**
- `toFormData(stream, contentType)` (RS:302-311): 1, 3,
  `Bun.readableStreamToBlob(stream).then(b => FormData.from(b, contentType))`.
  **No Direct branch, no fast path.**

`toArrayBuffer` / `toBytes` may return a **non-Promise** synchronously per the type
declaration (RS:141, 222), but in practice both always return a promise (the peeked case
returns `$createFulfilledPromise(...)`).

### 3.1a `readableStreamIntoText` — the GENERIC `toText` path (fidelity review CRITICAL #3)

RSI:2462-2472. This function is a required, separately-specified component; v1 omitted it
entirely. It is a **standalone Text accumulator, NOT a `JSDirectStreamController`** — it has
no controller of any kind:

1. Build a fresh **standalone Text sink** — the `createTextStream` accumulator
   (RSI:1399-1514) as its own small internal cell/object, distinct from
   `JSDirectStreamController`'s Text arm even though the accumulation logic is shared code.
   (In C++: one shared `BunTextAccumulator` value type owned by BOTH the standalone sink cell
   and `JSDirectStreamController`'s Text arm — one implementation, two owners.)
2. `promise = readStreamIntoSink(g, stream, textSink, /*isNative*/ false)` (§5.3). §5.3's op
   cell therefore **must accept this internal JS-less "sink" as well as the native JSSink** —
   its `m_sink` slot is an erased `WriteBarrier<JSObject>` and its `isNative` flag selects
   which protocol (the JSSink `start(onPull,onClose)` registration is skipped for
   `isNative == false`).
3. On the sink's `end()`, the result string is passed through **`withoutUTF8BOM`**
   (RSI:2454-2460): if the string's first code unit is U+FEFF, drop it. This is the ONLY
   place the leading BOM is stripped on the generic path.

**The BOM asymmetry — preserved DELIBERATELY, two different behaviors** `[reproduced]`:

- The **DIRECT** Text sink (`readableStreamToTextDirect`, §3.3) does **NOT** strip the BOM.
  `createTextStream.finishInternal` (RSI:1463-1501) strips a leading U+FEFF ONLY on the
  pure-string rope path; the buffer-only / mixed paths decode with
  `new TextDecoder("utf-8", { ignoreBOM: true })` — the BOM is **kept**. The direct path
  never runs `withoutUTF8BOM`.
- The **GENERIC** path (this section) DOES strip it, via the extra `withoutUTF8BOM` step.

```js
// [reproduced] on the real binary:
const bom = c => c.write(new TextEncoder().encode("﻿abc"));
await Bun.readableStreamToText(new ReadableStream({type:"direct", pull(c){bom(c); c.end();}}));
// => "﻿abc"   (BOM PRESERVED)
await Bun.readableStreamToText(new ReadableStream({pull(c){c.enqueue(new TextEncoder().encode("﻿abc")); c.close();}}));
// => "abc"          (BOM STRIPPED)
```

The asymmetry is preserved deliberately: unifying it either way is a user-visible behavior
change and out of scope for a parity rewrite. §3.3 and §4.5 must NOT claim the direct Text
sink BOM-strips.

### 3.2 `tryUseReadableStreamBufferedFastPath(stream, method)` (RSI:1240-1269; BE §2.4)

Precondition: `method ∈ {"text","arrayBuffer","bytes","json","blob"}`.

```
ptr = stream->nativePtrForJS()
if (!ptr.isCell()) return empty              // not native / detached / transferred
if (stream->m_disturbed) return empty
m = ptr[method]                              // a real [[Get]] on the handle object
if (!isCallable(m)) return empty             // feature-detect
promise = call(m, ptr, [])                   // MAY THROW: propagate, do NOT set disturbed
stream->m_disturbed = true
stream->m_bunMode = Default                  // "clear the lazy load function", RSI:1256
stream->m_lockedWithoutReader = true         // RSI:1257
if (Bun.peek.status(promise) == fulfilled) {
    stream->m_lockedWithoutReader = false
    readableStreamCloseIfPossible(stream)
    return promise
}
return promise.catch(catchH).finally(finallyH)   // §4.1 mechanism, context = stream
   // catchH = onBufferedFastPathRejected   [reaction-convention]
   //          unlock, readableStreamCancel(stream, e), rethrow  (RSI:1271-1275)
   // finallyH = onBufferedFastPathSettled  [reaction-convention]
   //          unlock, readableStreamCloseIfPossible(stream)     (RSI:1277-1280)
```

Note "if it throws, let it throw without setting $disturbed" (RSI:1252) — the disturbed flag
is set only AFTER the native call returns.

### 3.3 The `*Direct` conversion paths — **3 sink flavors, ONE controller class**

BE §1.4. The three direct materializers (`initializeArrayBufferStream` RSI:1603-1636,
`initializeTextStream` RSI:1516-1541, `initializeArrayStream` RSI:1543-1601) are
byte-for-byte the same `_pendingRead/_deferClose/_deferFlush` state machine; **only the sink
differs**. They unify into ONE `JSDirectStreamController` (§4) with a sink-kind tag:

```cpp
enum class DirectSinkKind : uint8_t { ArrayBuffer, Text, Array };
```

- `readableStreamToTextDirect` (RSI:2556-2574): materialize with `DirectSinkKind::Text`
  (the rope+array accumulator, RSI:1399-1514), take a default reader, `await read()` until
  `done` or the stream leaves `Readable`, release, return the close-capability promise —
  which the Text sink's `end()` fulfilled with the concatenated string. **NOT BOM-stripped**
  `[reproduced]`: `finishInternal` (RSI:1463-1501) strips a leading U+FEFF ONLY on the
  pure-string rope path; the buffer-only / mixed paths decode with
  `new TextDecoder("utf-8", { ignoreBOM: true })`, so a BOM in a binary chunk is KEPT.
  The BOM strip belongs ONLY to the generic path's `withoutUTF8BOM` (§3.1a); the direct path
  never runs it. See §3.1a's asymmetry note.
- `readableStreamToArrayDirect` (RSI:2576-2598): same, `DirectSinkKind::Array` (chunks
  pushed into a `JSArray`), result = the array.
- `readableStreamToArrayBufferDirect(stream, asUint8Array)` (RSI:2474-2554): **this one is
  genuinely different and must stay separate** — it does NOT build a persistent controller
  or a reader. It nulls the direct slot, marks locked, hand-rolls a throwaway
  `{start,close,end,flush,write}` over a `Bun.ArrayBufferSink`, calls the user's `pull`
  **exactly once**, and:
  - if `pull` threw → error the stream, reject;
  - if `pull` returned a non-promise → immediately close the stream and return the
    capability promise (a synchronous producer resolves in one microtask, zero readers);
  - if a promise → close/error the stream when it settles.
  Port as a dedicated native fn `consumeDirectStreamToArrayBuffer(g, stream, asUint8Array)`.
  It shares no state machine with §4 — do not force it into `JSDirectStreamController`.

So: **3 flavors are the minimal faithful set** (Text and Array become two arms of one class;
ArrayBuffer's *streaming* form is a third arm used by `getReader()`; the *one-shot*
`toArrayBuffer/toBytes` conversion is a separate 60-line function). The prompt's "can they
unify?" — Text/Array/ArrayBuffer(streaming) do; the one-shot does not.

### 3.4 `ReadableStream.prototype.{text,json,bytes,blob}`

Already C++ (`JSReadableStream.cpp:168-177`) — today thin wrappers over the cached
`m_readableStreamTo*` JSFunctions. They become one-line calls to the native implementations
in §3.1. `blob → readableStreamToBlob`, `bytes → readableStreamToBytes`,
`json → readableStreamToJSON`, `text → readableStreamToText`. Same brand check
(`ERR_INVALID_THIS` rejection). No `arrayBuffer()` prototype method exists today; do not add one.

---

## 4. `type:"direct"` for JS consumption: `JSDirectStreamController`

BE §1.2(B), RSI:1615-1631 / 1154-1397. The plain-object direct controller becomes a real
`JSC::JSDestructibleObject` (it owns WTF containers for the Text/Array sinks).

### 4.1 Members

```cpp
class JSDirectStreamController final : public JSC::JSDestructibleObject {
    JSC::WriteBarrier<JSReadableStream> m_stream;        // $controlledReadableStream
    JSC::WriteBarrier<JSC::JSObject>    m_underlyingSource; // the USER object; re-[[Get]] `pull`/`close` each use
    JSC::WriteBarrier<JSC::JSPromise>   m_pendingRead;   // _pendingRead
    JSC::WriteBarrier<JSC::Unknown>     m_deferCloseReason; // _deferCloseReason
    int8_t  m_deferClose { 0 };   // -1 = pull in progress (reentrancy guard), 0 = idle, 1 = close deferred
    int8_t  m_deferFlush { 0 };   // -1 = pull in progress,                    0 = idle, 1 = flush deferred
    bool    m_closed { false };   // replaces the "swap all methods to a throwing stub" trick
    DirectSinkKind m_sinkKind;
    // The sink:
    JSC::WriteBarrier<JSC::JSObject> m_arrayBufferSink;   // ArrayBuffer kind: a real Bun.ArrayBufferSink
    // Text kind (createTextStream, RSI:1399-1514):
    WTF::StringBuilder m_rope; bool m_hasString {false}; bool m_hasBuffer {false};
    WTF::Vector<JSC::WriteBarrier<JSC::Unknown>> m_pieces;   // strings + views, cellLocked
    double m_estimatedLength { 0 };
    // Array kind:
    JSC::WriteBarrier<JSC::JSArray> m_array;
    // Both Text/Array kinds have a closing capability:
    JSC::WriteBarrier<JSC::JSPromise> m_closingPromise;
    bool m_calledDone { false };
    DECLARE_VISIT_CHILDREN;  // cellLock around m_pieces
};
```

`m_stream->m_controllerKind == ControllerKind::Direct` when this is installed.
Setup (`setUpDirectStreamController`) does what all three `initialize*Stream` do
(RSI:1537-1539, 1597-1599, 1633-1635): install the controller, **null
`m_directUnderlyingSource`** and set `m_bunMode = Default` on the stream. The
`m_arrayBufferSink` is started with `{stream:true, asUint8Array:true, highWaterMark}` where
`highWaterMark` is included **iff `hwm && typeof hwm === "number"`** (RSI:1608-1611) — NOT
"a finite number" (fidelity review MINOR). `Infinity` and negatives PASS this predicate;
`0`, `NaN`, and any non-number do not. This is only the sink's initial buffer size, not spec
backpressure (BE §1.2).

> **How the raw strategy HWM is stored.** The three consumer sites (§1's list) each apply a
> DIFFERENT predicate to the raw JS value. To represent them exactly:
> `m_bunHighWaterMark` is `ToNumber(raw)` computed once at construction, plus one bit
> `bool m_bunHighWaterMarkIsNumber = (typeof raw === "number")`. Predicates:
> - here (`ArrayBufferSink`): include iff `m_bunHighWaterMarkIsNumber && m_bunHighWaterMark != 0
>   && !isnan(m_bunHighWaterMark)` (`Infinity` passes).
> - `readStreamIntoSink` / `assignStreamIntoResumableSink`: `isnan ? 0 : hwm` (the `|| 0`).
> - `readDirectStream`: `!(hwm) || hwm < 64 ? 64 : hwm` on the double.
>
> **Accepted, negligible delta:** a NON-number strategy `highWaterMark` (a numeric string, an
> object with `valueOf`) is now `ToNumber`'d once at construction instead of being relationally
> compared raw at each consumer (RSI:776-779 relationally compares even a string today). No
> plausible user passes one. Recorded in "Changed in v2".

### 4.2 The surface the user's `pull(controller)` sees — 5 detachable OWN-property bound methods

Today (RSI:1519-1535 / 1543-1595 / 1615-1631) the controller handed to `pull` is a plain
object with **own properties**; every method is pre-bound (`sink.write.bind(sink)`) or a
closure, so it works with `this === undefined`. `[reproduced]`:

```js
new ReadableStream({type:"direct", pull(c){ const {write} = c; write("hello"); c.end(); }})
```

works today. A brand-checking `JSDirectStreamController.prototype.write` host fn would throw
`ERR_INVALID_THIS` on that detached call — a real break (fidelity review MAJOR #7).

**Design (fidelity MAJOR #7, applied as ruled):** the FIVE public methods — `write`, `end`,
`close`, `flush`, `error` — are **per-controller OWN properties**, each a `JSC::JSBoundFunction`
(ARCHITECTURE §4.1's **[bound-convention]** — `(contextCell, ...callArgs)`, context at
`argument(0)`) over a **shared `JSStreamsRuntime` handler** with the controller cell as the
bound context. This preserves **detachability** (`const {write} = controller; write(x)` — the
bound context carries the controller, no `this` needed) and **identity stability**
(`c.write === c.write`). Cost: five `JSBoundFunction` cells, allocated ONLY on the
JS-consumption path of a direct stream (never for spec streams, never for the one-shot
`toArrayBuffer/toBytes` direct path §3.3, never for the native-sink path §5).

| own property | shared handler (all **[bound-convention]**) | behavior |
|---|---|---|
| `write(chunk)` | `onDirectWrite(ctl, chunk)` | ArrayBuffer kind: `ArrayBufferSink.write`. Text kind: rope/array append; returns the length (RSI:1411-1441). Array kind: `array.push(chunk)`; returns `chunk.byteLength \|\| chunk.length`. |
| `end()` | `onCloseDirectStream(ctl, reason?)` | §4.5 |
| `close(reason?)` | `onCloseDirectStream(ctl, reason?)` | the SAME shared handler as `end`; `end` and `close` are two bound cells over one target, exactly as today's two properties alias one function |
| `flush()` | `onFlushDirectStream(ctl)` | §4.4 |
| `error(e)` | `onHandleDirectStreamError(ctl, e)` | §4.6 |

No `enqueue`, no `desiredSize`, no `byobRequest` (BE §1.2, deliberate).

**`.sink` — DECIDED (was Open Question 3).** Today `$sink` is a PRIVATE-symbol property on a
plain object (RSI:1523/1583/1619); user code sees `controller.sink === undefined` for ALL
three flavors. v1's proposed default (expose `.sink` for the ArrayBuffer kind) would be a
NET-NEW public property, not preservation — the fidelity reviewer's source-backed answer
wins. **There is NO public `.sink` on `JSDirectStreamController`.** The ArrayBufferSink is
the private C++ member `m_arrayBufferSink` only.

**The `_`-prefixed internals — a deliberate, negligible-risk delta.** `_pendingRead`,
`_deferClose`, `_deferFlush`, `_deferCloseReason`, `_handleError` are today ordinary
enumerable underscore-named own properties on the plain object. In v2 they become the C++
members of §4.1 and are **NOT observable properties**. Consequences: `Object.keys(controller)`
and `Object.hasOwn(controller, "_pendingRead")` change. Nobody reads a `_`-prefixed internal
off a duck-typed controller; recorded in "Changed in v2".

**Closed error behavior:** today an errored/closed direct controller REASSIGNS all 5 own
properties to one shared function `$onReadableStreamDirectControllerClosed`
(RSI:1128, 1320) — so post-close `c.write === c.close` becomes `true` — which throws
`TypeError: ReadableStreamDirectController is now closed` (RSI:1236-1238). In C++: set
`m_closed = true`; every shared handler's first line is
`if (ctl->m_closed) throwTypeError(g, scope, "ReadableStreamDirectController is now closed"_s)`.
Same exception class and message, byte-for-byte. The five own properties are NOT reassigned,
so **post-close method identity is preserved** (an improvement over today's identity flip);
`c.write === c.close` stays `false` after close. Recorded as an accepted delta in
"Changed in v2".

### 4.3 `onPullDirectStream` (RSI:1154-1227) — the READ pump

The default reader's `read()` on a `ControllerKind::Direct` stream dispatches here (see 4.7).

1. If `!m_stream || m_stream->m_state != Readable` → return `undefined` (RSI:1156).
2. **Re-entrancy guard**: if `m_deferClose == -1` → return `undefined` (RSI:1161-1163).
   (The caller handles a non-promise return — the readMany direct branch does.)
3. `m_deferClose = m_deferFlush = -1`.
4. Restore `m_stream->m_asyncContext` around step 5 (§8).
5. `result = call(m_underlyingSource[[Get]]"pull", m_underlyingSource, [controller])`.
   - **the return value is NOT awaited**. If it is a Promise, register the rejection
     reaction **WITH a real result promise** (fidelity CRITICAL #4, applied as ruled):

     ```cpp
     JSPromise* resultPromise = JSC::JSPromise::create(vm, g->promiseStructure()); // fresh; NOT markAsHandled'd
     performPromiseThenWithContext(vm, g,
         /*onFulfilled*/ jsUndefined(),
         /*onRejected */ onDirectPullRejected,   // [reaction-convention]
         /*result     */ resultPromise,
         /*context    */ controllerCell);
     ```

     `onDirectPullRejected(e, ctl)` **[reaction-convention]** is the port of
     `$handleDirectStreamErrorReject` (RSI:1149-1152): it runs `handleDirectStreamError(e)`
     (§4.6) and then **returns abruptly / rejects `resultPromise` with `e`** — reproducing
     today's `.catch(h)` where `h` ends `return Promise.$reject(e)`.

     **Why the result promise is REQUIRED — the old claim was empirically FALSE
     `[reproduced]`.** The `.catch(...)` promise today rejects and nothing ever handles it,
     so it IS observed by the unhandled-rejection machinery. `[reproduced]`:

     ```js
     const s = new ReadableStream({type:"direct", pull(c){ return Promise.reject(new Error("boom")) }});
     s.getReader().read().catch(() => {});   // the read rejection IS handled
     ```

     Today `process.on("unhandledRejection")` fires with `boom` anyway, and with no handler
     the process **exits 1**. A rejection-only reaction with no result promise would silently
     change that to exit 0. So: `resultPromise` is a real, fresh `JSPromise`, is NOT marked
     as handled, and is not stored anywhere (its whole job is to reject unhandled). Cost:
     **ONE extra promise, allocated ONLY on the direct-pull path when `pull` returns a
     promise** — not per reaction anywhere else in the subsystem.
   - if `pull` THREW synchronously: `handleDirectStreamError(e)` and return a promise
     rejected with `e` (RSI:1192-1193). (The `finally` still runs — see 6.)
   - Comment to keep (RSI:1176-1179): *"Direct streams allow pull to be called multiple
     times, unlike the spec. Backpressure is handled by the destination, not by the
     underlying source."*
6. `finally`: `dc = m_deferClose; df = m_deferFlush; m_deferClose = m_deferFlush = 0`; pop
   the async context (RSI:1194-1201).
6a. **Post-user-call re-validation (ARCHITECTURE §7.2; GC review MAJOR #4).** Step 5 ran
   user JS. `controller.error(e)` is a public method (§4.2) and is NOT deferred by the
   `m_deferClose = -1` guard (only `close`/`flush` are) — a `pull` that calls
   `controller.error(e)` and returns normally leaves the stream `Errored` with
   `m_pendingRead` rejected-and-cleared (§4.6). So BEFORE step 7, **re-load and re-validate**:
   if `!m_stream || m_stream->m_state != Readable`, do NOT call
   `readableStreamAddReadRequest` (its spec precondition — `Assert: [[state]] is "readable"`
   — no longer holds; violating it is a debug ASSERT and, in release, a permanently
   unsettleable read request). Instead: return `m_pendingRead` if the error path armed one,
   else a promise rejected (Errored) / resolved-done (Closed) per the observed state. Only if
   the stream is still `Readable` fall through to step 7.
7. `if (!m_pendingRead) m_pendingRead = promiseToReturn = newPromise();
   else promiseToReturn = readableStreamAddReadRequest(m_stream)` (RSI:1206-1210).
   Read requests use the **spec** deque with `ReadRequestKind::Promise`; no new kind.
8. **Deferred-close replay** (RSI:1214-1219): if `dc == 1`, take `m_deferCloseReason`,
   run `onCloseDirectStream(reason)`, return `promiseToReturn`.
9. **Deferred-flush replay** (RSI:1222-1224): if `df == 1`, run `onFlushDirectStream()`.
10. return `promiseToReturn`.

Steps 8-9 running AFTER `pull` returns is the whole point: `close()`/`flush()` called
*synchronously inside* `pull` are deferred and replayed here.

### 4.4 `onFlushDirectStream` (RSI:1369-1397)

**BRANCH ORDER IS LOAD-BEARING (fidelity review CRITICAL #1).** The `m_deferFlush == -1`
check is the **LAST** `else if`, not the first — the source order, exactly:

1. `!m_stream` or no sink → return (RSI:1371-1372).
2. `reader` is missing or is not a real default reader → return, **with NO defer**
   (RSI:1374-1377 — this guard exists and must be kept).
3. Else if there is a `m_pendingRead` (RSI:1381-1388): `flushed = sink.flush()`; if
   `flushed.byteLength`, fulfill the pending read with `{value: flushed, done: false}` and
   pop the next read request into `m_pendingRead`.
4. Else if the reader has queued read requests (RSI:1389-1393):
   `readableStreamFulfillReadRequest(stream, sink.flush(), false)` if non-empty.
5. **Else if** `m_deferFlush == -1` (inside pull) → `m_deferFlush = 1` (RSI:1394-1395).

Consequence: `flush()` called *synchronously inside `pull`* while a previous `read()` is
already pending is **NOT deferred** — it flushes the sink at that instant (branch 3) and
fulfills the pending read with only the bytes written *before* the `flush()` call.
`[reproduced]`:

```js
let n = 0;
const s = new ReadableStream({ type: "direct", pull(c) {
  if (++n === 1) return;           // read #1 leaves a pending read
  c.write("A"); c.flush(); c.write("B");
}});
const r = s.getReader();
r.read().then(v => console.log(new TextDecoder().decode(v.value)));
r.read();
```

Today prints `A`. An implementation that checks `m_deferFlush == -1` FIRST would defer the
flush past `pull`'s return and print `AB`. Print `A`.

`sink.flush()`: ArrayBuffer kind → `ArrayBufferSink.flush()` (a Uint8Array or undefined).
Text/Array kinds → returns `0` (RSI:1443-1445, 1561-1563); i.e. flush is a no-op there.

### 4.5 `onCloseDirectStream(reason)` (RSI:1282-1355) — `end()` and `close(reason)`

1. If `!m_stream || state != Readable` return.
2. If `m_deferClose != 0` (i.e. `-1`, inside pull): `m_deferClose = 1;
   m_deferCloseReason = reason`; return (RSI:1286-1290).
3. If no sink → return. Set `stream->m_state = Closing`.
4. **`underlyingSource.close(reason)`** — the Bun-only lifecycle callback (RSI:1296-1302).
   `[[Get]] "close"`; if callable, call it with `this = underlyingSource`, arg `reason`.
   Errors **swallowed**. NOT WHATWG.
5. `flushed = sink.end()` — ArrayBuffer kind: `ArrayBufferSink.end()` (the final buffered
   Uint8Array). Text kind: the concatenated string + fulfill `m_closingPromise` with it
   (RSI:1447-1501). **The Text `end()` BOM-strips ONLY in the all-string (pure rope) case;
   the buffer-only and mixed cases decode with `TextDecoder("utf-8", {ignoreBOM: true})` —
   the BOM is kept** `[reproduced]` (fidelity CRITICAL #3; see §3.1a — the leading-BOM strip
   belongs ONLY to the generic path's `withoutUTF8BOM`). Array kind: the array + fulfill
   `m_closingPromise` (RSI:1565-1570). If `end()` throws: reject `m_pendingRead` with the
   error if pending, else rethrow (RSI:1308-1318).
6. `m_closed = true` (replaces today's own-property method swap — §4.2's closed-error
   behavior).
7. **Final-chunk-on-close delivery** (RSI:1322-1345): if the reader is a real default reader
   and `m_pendingRead` is pending and `flushed.byteLength > 0` → fulfill `m_pendingRead`
   with `{value: flushed, done: false}` then `readableStreamCloseIfPossible`. Else if
   `flushed.byteLength > 0` and the reader has queued read requests → fulfill the first with
   the chunk, then close. **Else if `flushed.byteLength > 0` and nobody is reading**
   (RSI:1342-1345): set state back to `Readable` and arm a one-shot "the NEXT read()
   delivers `flushed` then closes" (`$onCloseDirectStreamFinalPull`, RSI:1357-1367) — in
   C++: `WriteBarrier<Unknown> m_finalChunk` + a `bool m_finalChunkArmed` that
   `onPullDirectStream` step 1 checks FIRST. This is how the last chunk is not lost.
8. Else (nothing flushed): fulfill any `m_pendingRead` with `{done:true}` and
   `readableStreamCloseIfPossible(stream)` (RSI:1347-1354).

### 4.6 `handleDirectStreamError(e)` (RSI:1118-1147)

Close the sink (`sink.close(e)`, errors swallowed), `m_closed = true`, call
`underlyingSource.close(e)` (swallowed), **reject AND CLEAR `m_pendingRead`** with `e`
(RSI:1141 explicitly does `controller._pendingRead = undefined` — the slot must not be left
holding a settled promise, or §4.3 step 6a/7 mis-keys off it; GC review MAJOR #4),
`readableStreamError(stream, e)`.

The rejection reaction registered in §4.3 step 5, `onDirectPullRejected` (the port of
`$handleDirectStreamErrorReject`, RSI:1149-1152), calls THIS function and then re-rejects its
**result promise** with `e`. That result promise is real and unhandled by design — §4.3
step 5 states why in full (`[reproduced]`: today's `.catch(...)` promise rejects unhandled
and fires `unhandledRejection` / flips the exit code). This is fidelity-preserving, not an
optimization opportunity.

### 4.7 The `[[controller]]` slot dispatch — the EXHAUSTIVE `ControllerKind` table

`m_controller` (§1) + `m_controllerKind`. ARCHITECTURE §3.2's carve-out: this is the ONE
back-pointer that is the ERASED `WriteBarrier<JSC::JSObject>` + a kind tag; everything else
stays exact-typed.

**RULE (GC review CRITICAL #1): a raw `jsCast<>` / `static_cast<>` / `jsDynamicCast<>`
on `stream->m_controller` is BANNED, everywhere.** Every access goes through ONE inline
helper, `switchOnControllerKind(stream, ...)` (or an explicit
`switch (stream->m_controllerKind)`), and **every switch is TOTAL** — all five arms, no
`default:` that silently reinterprets. A `JSDirectStreamController` (a `JSDestructibleObject`
owning a `WTF::StringBuilder` + a `Vector<WriteBarrier>`) or a generated
`JSReadable*Controller` JSSink cell reinterpreted as a spec controller and having its `Deque`
members walked is heap corruption.

This table is EXHAUSTIVE over every spec op / call site that touches
`stream->m_controller`. Phase-B authors implement `ReadableStreamOperations.cpp` from
ARCHITECTURE + the digests; **this table overrides both wherever a non-`Default`/`Byte`
kind is possible.**

| op / call site | `None` | `Default` | `Byte` | `Direct` | `NativeSink` |
|---|---|---|---|---|---|
| **`[[PullSteps]]`** — `ReadableStreamDefaultReaderRead` (RSI:1885-1897) | can't happen after `materializeIfNeeded` (§1.1 runs at `getReader()`); a stream that stays `None` has no controller and `read()` on it goes through the ordinary "no controller ⇒ pending read request" spec path | spec `[[PullSteps]]` | spec `[[PullSteps]]` | `stream->m_disturbed = true`; `Closed` → fulfilled `{done:true}` (RSI:1890); `Errored` → rejected with `storedError` (RSI:1891); else → `directController->onPull(g)` (§4.3, RSI:1894-1896) | **not reachable**: `assignToStream`/`readDirectStream` set `m_lockedWithoutReader = true` (RSI:783), so no `ReadableStreamDefaultReader` can be acquired ⇒ no `read()`. Arm body: debug-assert-not-reached + reject with an internal `ERR_INVALID_STATE`. (This assert claim is scoped to the READ dispatch ONLY — see the cancel row.) |
| **`readMany()`** (§7.1, RSDR:63-70) | `Closed` → sync `{done:true, value:[], size:0}` | spec queue drain | spec queue drain (entries normalized to `Uint8Array` views) | the "direct controller not yet started" branch: `directController->onPull().then(...)` (§7.1 step 3) | not reachable (locked-without-reader; the reader brand check throws first). Arm: same debug-assert + `ERR_INVALID_STATE` as the read row. |
| **`[[CancelSteps]]`** — the internal `readableStreamCancel(stream, reason)` (RSI:1748-1778). The shared prefix runs for ALL kinds: `disturbed = true`; `Closed` → resolve; `Errored` → reject(`storedError`); `readableStreamClose(stream)`; fulfill pending BYOB read-into requests `{done:true}` | `controller === null` → **resolve immediately** (RSI:1769-1770). An unmaterialized stream is `None` (`materializeIfNeeded` is NOT run by cancel, §1.1) | spec `cancelAlgorithm` (`controller.$cancel(controller, reason).then(noop)`) | spec `cancelAlgorithm` | `Promise.resolve(directController->close(reason))` (RSI:1775-1776 — the direct controller has no `$cancel`; cancel falls through to `close(reason)` = `onCloseDirectStream`, §4.5) | **REACHABLE, DEFINED — see below.** `Promise.resolve(sinkController->close(reason))` (RSI:1775-1776): the generated `${name}Controller__close` host fn (`generate-jssink.ts:438-467`) → native close + `detach()` → `readDirectStreamOnClose` (§5.2) → `underlyingSource.cancel(reason)`, stream → `Errored(reason)` |
| **`[[ReleaseSteps]]`** — `readableStreamReaderGenericRelease` (`reader.releaseLock()`; digest 02:684) | no controller ⇒ no-op | spec `[[ReleaseSteps]]` (default: no-op per spec) | spec `[[ReleaseSteps]]` (byte: clear `[[pendingPullIntos]]` head's reader) | **no-op arm — but it must be WRITTEN** (GC CRITICAL #1's own requirement). The design's §3.3 (`readableStreamToTextDirect` releases its reader) and user JS (`s.getReader(); r.read(); r.releaseLock()`) reach here with `Direct` installed. | **no-op arm — written.** (Also runs the §2.4 `updateRef(false)` gate, which is keyed on `SourceKind`, not `ControllerKind`.) |
| **close / error paths** — `readableStreamClose`, `readableStreamError`, `readableStreamCloseIfPossible` | no controller: state transition only | spec | spec | the direct controller keys off `m_closed` / `m_stream->m_state`; no spec-controller queue to clear. Arm: no-op beyond the stream-level transition. | no controller-side action from the spec close/error path; the JSSink's teardown is driven by `detach()`/`onClose`. Arm: no-op. |
| **`desiredSize`** — `controller.desiredSize`, `readableStreamDefaultControllerShouldCallPull` | n/a (no controller object) | spec | spec | `JSDirectStreamController` has **no `desiredSize`** (§4.2: "No `enqueue`, no `desiredSize`, no `byobRequest`"). Internal callers never reach it (the direct controller is not on the spec pull loop). Arm: assert-not-reached in the internal helper; the public getter does not exist on this class. | same: not a spec controller; internal spec ops never reach it. Arm: assert-not-reached. |
| **`getReader({mode:"byob"})` brand check** — "is `[[controller]]` a `ReadableByteStreamController`?" | throws `TypeError` (no byte controller) — and RS:405-406 does NOT materialize, so a `NativePending` stream is still `None` here (§1.1) | throws `TypeError` | acquires the BYOB reader | throws `TypeError` (a direct controller is never a byte controller) | throws `TypeError` |

**`readableStreamCancel` on `NativeSink` IS reachable from Rust (fidelity review
CRITICAL #2).** The `{}`-sentinel guard exists **only** in `ReadableStream__cancel`
(ReadableStream.cpp:345-368). **`ReadableStream__cancelWithReason`
(ReadableStream.cpp:373-390) has NO sentinel guard** (§6.2), and Rust calls it —
`FetchTasklet.rs:2100` via `ReadableStream::cancel_with_reason`, e.g. on a
fetch-request-body abort. For a `type:"direct"` body that `assignToStream` handed to a
native sink, `readDirectStream` (RSI:775) has set the stream's controller slot to the
generated `JSReadable*Controller` cell (`ControllerKind::NativeSink`), and
`readableStreamCancel` runs the arm above. Observable today: aborting
`fetch(url, {body: new ReadableStream({type:"direct", pull(c){…}, cancel(r){…}}),
method:"POST", duplex:"half"})` fires the user's `cancel(reason)` and transitions the stream
to `Errored` with `reason`. **That is the `NativeSink` cancel arm's body.** v1's
"unreachable, assert" is wrong and is deleted for cancel; the `{}`-sentinel guard is a
property of ONE extern (`ReadableStream__cancel`, §6.2), not of the internal op.

---

## 5. The native-sink path (path A)

BE §1.2(A), CS §4, CO §E. Four builtins become native C++ free functions in
`BunStreamSource.cpp`; two of them are non-trivial async state machines and get internal
cells (same device as ARCHITECTURE §6.1's `JSStreamPipeToOperation`).

### 5.1 `assignToStream(global, stream, jsSinkController) -> JSValue` (RSI:807-823)

```
materialize NOTHING. If stream->m_bunMode == DirectPending:
    return readDirectStream(g, stream, sink, stream->m_directUnderlyingSource.get())
return readStreamIntoSink(g, stream, sink, /*isNative*/ true)   // a JSPromise
```

### 5.2 `readDirectStream(global, stream, sinkController, underlyingSource)` (RSI:756-804)

1. `stream->m_directUnderlyingSource.clear(); stream->m_bunMode = Default` (RSI:757-758).
2. Allocate a `JSDirectSinkCloseState` cell: `{WriteBarrier<JSObject> m_underlyingSource,
   WriteBarrier<JSPromise> m_closePromise (initially null)}` — the port of the
   `{underlyingSource, closePromiseCapability}` bound `this` (RSI:762-763).
   **Cell spec (GC review MINOR #6):** base class `JSC::JSNonFinalObject`,
   `DECLARE_VISIT_CHILDREN` visiting BOTH barriers, its own iso subspace, NON-destructible
   (no WTF-container members). An unvisited `m_closePromise` here would be a premature
   collection of the very promise step 9 hands to Rust as the operation's result.
   `close` = a `JSBoundFunction`(shared `readDirectStreamOnClose` handler
   **[bound-convention]** — receives `(stateCell, streamOrUndefined, reason)`, context at
   `argument(0)`; §5.6 row 4), boundArgs `[thatCell]`.
3. `pull = underlyingSource[[Get]]"pull"`.
   - `!pull` → **invoke the onClose handler with `stream = undefined`** and return
     `undefined` (RSI:765-768).
   - Not callable → invoke the onClose handler with `stream = undefined`, THEN
     `throwTypeError("pull is not a function")` (RSI:770-774; close FIRST, then throw).

   **These early `close()` calls carry NO stream (fidelity review MINOR).** RSI:763-774:
   `close` is `$readDirectStreamOnClose.bind(state)` invoked with **zero arguments**, so
   `stream` is `undefined` inside the handler and the entire state-mutation block
   (RSI:737-747) is skipped — only the `underlyingSource.cancel(undefined)` half runs. The
   stream stays `Readable` and its controller slot is never assigned. A port that passes the
   real stream here would wrongly transition it to `Closed`.
4. `stream->m_controller = sinkController; m_controllerKind = NativeSink` (RSI:775 —
   **the native JSSink controller IS the controller**).
5. `sink.start({highWaterMark: !hwm || hwm < 64 ? 64 : hwm})` (RSI:776-779).
6. `sinkController->start(g, stream, wrap(pull), wrap(close))` — the C++ member
   `JSReadable*Controller::start` (GJS:889-900) unchanged. `wrap(x)` =
   `stream->m_asyncContext ? AsyncContextFrame::create(g, x, stream->m_asyncContext) : x`
   — this hoists GJS:307-317's wrapping out of the now-deleted `functionStartDirectStream`
   host fn (§5.6 coupling 2). §8.
7. `stream->m_lockedWithoutReader = true` (RSI:783).
8. `maybePromise = call(pull, undefined, [sinkController])` — `this` is undefined here
   (unlike the JS-consumption path). **synchronous, once** (RSI:785).
9. Return-value contract (RSI:787-803):
   - `maybePromise` is a Promise → return `promise.then(noop)` (i.e. adopt it, discard the
     value). Do this with `performPromiseThenWithContext(vm, g, sharedNoop /*[reaction-convention]*/,
     jsUndefined(), resultPromise, jsUndefined())` — here a result promise IS required
     (Rust awaits it).
   - else if `stream->m_state == Readable` (pull returned synchronously WITHOUT closing):
     `state->m_closePromise = JSPromise::create(...)`; return it. **This promise resolves
     only when the sink's `onClose` later fires — i.e. when the user calls
     `controller.end()`.** This is the `renderToReadableStream` "keep the controller, write
     more later, `end()` when Suspense settles" contract (RSI:795-803). NON-NEGOTIABLE.
   - else (pull synchronously closed): return `undefined`.

`readDirectStreamOnClose(stateCell, stream, reason)` — **[bound-convention]**, context =
the state cell at `argument(0)` (RSI:719-754):
call `underlyingSource.cancel(reason)` (errors swallowed, result `markAsHandled`); THEN,
**only if `stream` is not `undefined`** (see step 3): null the
stream's controller & reader/lock; set `m_state = Errored` + `m_storedError = reason` if
`reason` is truthy, else `Closed`; resolve `m_closePromise` if armed. The native
`JSReadable*Controller::detach()` (GJS:702-731) is what invokes it, with args
`(readableStreamOrUndefined, reason)`.

### 5.3 `readStreamIntoSink(global, stream, sink, isNative) -> JSPromise` (RSI:987-1116)

An async pump. Becomes an internal cell `JSReadStreamIntoSinkOperation :
JSC::JSNonFinalObject { m_stream, m_reader, m_sink, m_result(JSPromise), bool m_didThrow,
bool m_didClose, bool m_started }` driven by §4.1 **[reaction-convention]** reactions.

**Cell spec (GC review MINOR #6):** base class `JSC::JSNonFinalObject`,
`DECLARE_VISIT_CHILDREN` visiting ALL FOUR barriers (`m_stream`, `m_reader`, `m_sink`,
`m_result`), its own iso subspace, NON-destructible (no WTF-container members). `m_sink` is
an erased `WriteBarrier<JSObject>`: `isNative == true` ⇒ a JSSink controller;
`isNative == false` ⇒ the internal standalone Text sink of §3.1a (which has no
`start(onPull,onClose)` registration — step 2/4's `onSinkClose` wiring is skipped).

**Rooting proof (GC review MAJOR #3 — required; "rooted by whichever reaction is pending"
is NOT an argument, per ARCHITECTURE §6.1).** In step 5's backpressure window
(`wrote < 0 → await sink.flush(true)`) there is NO pending read request, so the only path to
the op cell (and to `m_result`, the promise Rust's `Signal` protocol is waiting on) would be
`pendingFlushPromise → reaction → opCell` — whose retention is a property of the native
sink's internals this design does not control. Apply ARCHITECTURE §6.1's own device: the
acquired reader carries a visited **`WriteBarrier<JSC::JSCell> m_pipeOperation`** back-edge
(the SAME member the pipe uses — one op per reader by construction; do not add a second
field). It is SET in step 1 when the reader is acquired and CLEARED in step 8's release path.
Then `Rust Strong → stream → m_reader → m_pipeOperation (opCell) → m_sink / m_result` holds
through every await with no assumptions about native promise retention.

Its steps, in order — **the
backpressure protocol here is the contract renderToReadableStream / Bun.serve depend on**:

1. `reader = stream.getReader()` (this runs `materializeIfNeeded`);
   `reader->m_pipeOperation = opCell` (the §6.1 back-edge, above).
   `many = reader.readMany()`.
2. If `many` is a Promise (RSI:1000-1010): FIRST — because time may pass and the sink may
   abort meanwhile (issue #6758) — if `isNative`, register `onSinkClose` on the sink
   (`sinkController->start(g, stream, /*onPull*/ undefined, boundOnSinkClose)`), then
   `sink.start({highWaterMark})`. Then await `many`.
3. `many.done` → `m_didClose = true; return sink.end()`.
4. If not started yet (sync readMany): register onSinkClose + `sink.start({highWaterMark})`.
5. For each chunk in `many.value`, then in a `while(true) { {value,done} = await
   reader.read() }` loop (RSI:1021-1064):
   ```
   wrote = sink.write(chunk)
   if (wrote < 0)            await sink.flush(true);  if (m_didClose) stop
   else if (isPromise(wrote))  markAsHandled(wrote)   // INTENTIONALLY NOT AWAITED
   ```
   - `wrote < 0` = HTTP sink backpressure (the socket is backed up); `sink.flush(true)`
     returns the pending-flush promise; the sink's close path resolves the same promise, so
     the `m_didClose` re-check after the await is required.
   - a Promise `wrote` = FileSink on Windows (every write is async); awaiting it would
     serialize every chunk behind a uv round-trip, so it is deliberately NOT awaited, only
     marked handled (the sink rejects it if the destination dies, and that already cancels
     the stream). Comments RSI:1021-1038 explain both; keep them.
6. `done` → `m_didClose = true; sink.end()`.
7. `catch(e)` (RSI:1065-1085): `m_didThrow = true`; **CLEAR the op's `m_reader` reference
   FIRST** (RSI:1068 does `reader = undefined` before anything else — so step 8's
   release is skipped); then call the **PUBLIC `ReadableStream.prototype.cancel(e)`
   semantics**. Because the stream is still locked by the (now-orphaned) reader, that public
   `cancel` returns `Promise.reject(ERR_INVALID_STATE)` (RS:386) — i.e. it is a guaranteed
   no-op whose only job is to be `markAsHandled`'d; **the source's `cancelAlgorithm` is
   intentionally NOT invoked**. If the sink is not closed, `sink.close(e)` — if THAT throws
   too (`j`), reject with `new AggregateError([e, j])`. Reject `m_result` with `e`.
8. `finally` (RSI:1086-1115): `reader.releaseLock()` (errors swallowed) — **conditional on
   the op's reader reference being non-null, i.e. on `!m_didThrow`**; clear
   `reader->m_pipeOperation`; null the stream's controller/direct slot; if
   `!m_didThrow && state ∉ {Closed, Errored}` → `readableStreamCloseIfPossible(stream)`.

> **The error path intentionally does NOT release the reader (fidelity review MAJOR #6;
> maintainer ruling).** After a write/read throw, today the stream is left `locked === true`
> forever, un-cancelled, with an orphaned reader — because step 7 cleared the local `reader`
> before the `finally`'s `if (reader)` guard. This *looks* like a bug (a lock leak). It is
> today's behavior and this is a parity rewrite: **the reader is intentionally NOT released
> on the error path; today's behavior. Changing this is a separate PR.** Do NOT add a
> `finally` that unconditionally releases, and do NOT route "cancel" through the internal
> `readableStreamCancel` (which would newly fire the user's `cancelAlgorithm`).

`readStreamIntoSinkOnClose(opCell, stream, reason)` (RSI:980-985) — **[bound-convention]**
(it is the `boundOnSinkClose` handed to `sinkController->start`; context = the op cell at
`argument(0)`): if `!m_didThrow && !m_didClose && state != Closed` →
`readableStreamCancel(stream, reason)`; `m_didClose = true`.

### 5.4 `assignStreamIntoResumableSink(global, stream, sink)` (RSI:939-975) — the ResumableSink protocol

State cell `JSResumableSinkPumpOperation { m_stream, m_sink, m_reader, m_error(WB<Unknown>),
bool m_reading, bool m_closed }`.
**Cell spec (GC review MINOR #6):** base class `JSC::JSNonFinalObject`,
`DECLARE_VISIT_CHILDREN` visiting all four barriers (`m_stream`, `m_sink`, `m_reader`,
`m_error`), its own iso subspace, NON-destructible (no WTF-container members).

**Rooting (GC review MAJOR #3 — same device as §5.3):** between `drain()` calls the pump is
idle and reachable only through the `JSBoundFunction`s stored on the native ResumableSink
wrapper, whose rooting is Rust-side and outside this design. The acquired reader's visited
`WriteBarrier<JSC::JSCell> m_pipeOperation` back-edge is SET at setup (when `m_reader` is
acquired) and CLEARED in `resumableSinkReleaseReader`. Then
`Rust Strong → stream → reader → opCell → sink` holds through every await.

Protocol (BE §6, RSI:825-975): the native ResumableSink
exposes `start({highWaterMark})`, `setHandlers(drain, cancel)`, `write(chunk) -> bool`
(**false = backpressure**), `end(err?)`.

- setup: `sink.start({highWaterMark})` (ALWAYS, even if getReader throws — RSI:955-958);
  `m_reader = stream.getReader()`; `m_reader->m_pipeOperation = opCell`;
  `sink.setHandlers(boundDrain, boundCancel)`; `drain()`.
  Any throw → `m_error = e; m_closed = true; queueMicrotask(end(e))` (RSI:969-974).
- `resumableSinkDrain` (RSI:882-923): guard `m_error || m_closed || m_reading`; loop
  `await reader.read()`, `sink.write(value)` — `false` breaks the loop (native re-enters
  `drain` when the backpressure releases); `done` → `sink.end()` + release. On throw:
  `stream.cancel(e)` (handled) and `queueMicrotask(end(e))`.
- `resumableSinkCancel(_, reason)` (RSI:928-937): native invokes it as
  `(undefined, reason)` — the FIRST slot is unused; the reason is the SECOND argument.
  Preserve arity. `readableStreamCancel(stream, reason)` if not already errored/closed;
  release.
- `resumableSinkEnd` / `resumableSinkReleaseReader` (RSI:834-876): `sink.end(err?)`,
  `reader.releaseLock()`, **clear `reader->m_pipeOperation`**, null the controller slots,
  `readableStreamCloseIfPossible` if clean, drop every reference so the cycle collects.

`boundDrain` / `boundCancel` are `JSBoundFunction`s (**[bound-convention]**: they receive
`(opCell, ...callArgs)` — so `resumableSinkDrain(opCell)` and
`resumableSinkCancel(opCell, unused, reason)` with the reason at `argument(2)`) over shared
`JSStreamsRuntime` handlers + the op cell — they cross into Rust (stored on the native
ResumableSink), so they must be GC-visited callables. This is ARCHITECTURE §4.1's second
sanctioned form. Neither handler is ever registered as a promise reaction.

### 5.5 `$startDirectStream`

Today a generated host fn on the JSSink controllers, exposed as a private GLOBAL
(GJS:291-348; installed at `ZigGlobalObject.cpp:2935-2940`) so JS could reach it. Its ONLY
callers were `readDirectStream` (RSI:781) and `readStreamIntoSink` (RSI:1005,1017) — both
now C++, which call `sinkController->start(g, stream, onPull, onClose)` directly.
**`functionStartDirectStream` and the `startDirectStreamPrivateName()` global are DELETED.**
The per-controller C++ member `JSReadable*Controller::start()` (GJS:889-900) survives
unchanged.

### 5.6 `generate-jssink.ts` — the EXHAUSTIVE coupling list (CO §E)

| # | GJS site | coupling | repointing |
|---|---|---|---|
| 1 | `:279` `#include "JSReadableStream.h"` | header path of a deleted file | change to `#include "streams/JSReadableStream.h"` (PL §4: `streams/` is on the include path only if added; else the relative form). |
| 2 | `:291-348` `functionStartDirectStream` + `ZigGlobalObject.cpp:2940` `startDirectStreamPrivateName()` install; `:304` `"Expected ReadableStream"` throw | callable only from the deleted `$startDirectStream` builtin call sites | **DELETE** the host fn, its LUT/global registration, and the `startDirectStream` `BunBuiltinNames.h` entry. Its `AsyncContextFrame::create` wrapping (`:307-317`) moves into `readDirectStream` / `readStreamIntoSink` (§5.2 step 6, §5.3 step 2). |
| 3 | `:1023` `globalObject->assignToStream(stream, controller)` inside `${name}__assignToStream` | `Zig::GlobalObject::assignToStream` (`ZigGlobalObject.cpp:2865-2884`) fetches and calls the `readableStreamInternalsAssignToStream` builtin via `m_assignToStream` | keep the **method name and signature**; replace its body with a direct call to §5.1's native `Bun::assignToStream`. Delete the `m_assignToStream` `WriteBarrier<JSFunction>` field. Zero generated-code change. |
| 4 | `:174, 704-731, 890, 1062` `Weak<JSObject> m_weakReadableStream` set from `start()`, read by `detach()` / `${name}__onClose` and passed as the FIRST arg to `m_onClose(readableStream, reason)` | opaque `JSObject*`; never downcast to `JSReadableStream` (CS §4 point 1) | **NO CHANGE.** Our new `JSReadableStream` is a `JSObject`. The onClose callable we install (§5.2 step 2 / §5.3) is a **[bound-convention]** `JSBoundFunction`: the JSSink CALLS it with `(readableStreamOrUndefined, reason)` and the shared target therefore RECEIVES `(contextCell, readableStreamOrUndefined, reason)` — the context is `argument(0)`, never the sink's arg. |
| 5 | `:455-480, 502-527, 466, 513` — `close`/`end` host fns + comments: "detach() … transitions the direct ReadableStream to closed/errored and calls underlyingSource.cancel()" | the onClose callable's SEMANTICS | satisfied by §5.2's `readDirectStreamOnClose` port (it is the thing being described). Prose only; no symbol coupling. |

**Everything else in the JSSink layer survives UNCHANGED**: the 6 `JS${name}` /
`JS${name}Constructor` / `JSReadable${name}Controller` classes, their prototypes,
`createJSSinkPrototype` / `createJSSinkControllerPrototype` / `createJSSinkControllerStructure`
(`ZigGlobalObject.cpp:2385-2601`), `JSSink_isSink`, `Bun__onSinkDestroyed`, `detach()`,
the entire Rust-facing extern set `${name}__{fromJS,createObject,setDestroyCallback,
assignToStream,onClose,onReady,detachPtr,close,endWithSink,updateRef,memoryCost,finalize,
controllerDetached,getInternalFd}` (GJS:1075-1273; `headers.h:465-581`;
`Sink.rs::decl_js_sink_externs!`), the `#[repr(C)] Signal` struct, and the `StartTag`
protocol (`streams.rs:76-88`). CS §4's verdict — "structurally INDEPENDENT" — holds.

---

## 6. The extern-"C" / Rust contract — `WebStreamsExports.cpp`

Every symbol below keeps its **exact name and signature**. CO §C.1-C.4, CS §2.

### 6.1 `ReadableStreamTag__tagged` — THE tag protocol

```cpp
extern "C" int32_t ReadableStreamTag__tagged(Zig::GlobalObject*,
    JSC::EncodedJSValue* possibleReadableStream /*in-out*/, void** ptr /*out*/);
```
Discriminants (FROZEN — `ReadableStream.rs:483-514` `assert_ffi_discr!` fails the Rust
build otherwise): `Invalid=-1, JavaScript=0, Blob=1, File=2, Direct=3, Bytes=4`.

Exact algorithm on the NEW representation (from `ReadableStream.cpp:419-508`):
- input is not an object → `*ptr = nullptr`; return `-1`.
- object is NOT a `JSReadableStream`:
  - it is a non-host async-generator function, OR it has a callable `@@asyncIterator`
    property ([[Get]], can throw → `-1`) → build a stream from it via the native
    `readableStreamFromAsyncIterator` (§9-adjacent; it constructs a **DirectPending**
    stream, RSI:2054), **write the NEW stream back through `*possibleReadableStream`**,
    `*ptr = nullptr`, return `0`. This is the ONLY case that writes the out-param.
  - else → `*ptr = nullptr`; return `-1`.
- it IS a `JSReadableStream`: read `m_nativePtr` **raw** (NOT `nativePtrForJS()` — a
  transferred stream still tags, ReadableStream.cpp:482-484).
  - not a cell (empty / `-1`) → `*ptr = nullptr`; return `0`.
  - `JSBlobInternalReadableStreamSource` → `*ptr = casted->wrapped()`; return `1`.
  - `JSFileInternalReadableStreamSource` → `2`.
  - `JSBytesInternalReadableStreamSource` → `4`.
  - any other cell → return `0`.

**`Direct = 3` is NEVER RETURNED.** The current C++ has no path producing 3, and Rust's
`from_js` maps 3 to `None` (`ReadableStream.rs:280-301`). A direct stream tags as `0`
(JavaScript). Keep the value in the enum (frozen ABI), keep never emitting it. Do NOT
"helpfully" start returning 3 for `m_bunMode == DirectPending` — that would break every
Rust caller.

**DECIDED (was Open Question 2): keep the value frozen and never emit it.** The fidelity
reviewer independently verified both halves (`ReadableStreamTag__tagged` never emits 3;
`ReadableStream.rs:298` maps it to `None`; `assert_ffi_discr!` at `:511` freezes the values)
and agrees with this default. Zero-risk; deleting the arm from both sides is a lockstep
follow-up if anyone cares.

### 6.2 The `ReadableStream__*` set

| symbol | signature | semantics (source of truth) |
|---|---|---|
| `ReadableStream__tee` | `(EncodedJSValue stream, Zig::GlobalObject*, EncodedJSValue* out1, EncodedJSValue* out2) -> bool` | brand check (false if not a stream); `readableStreamTee(stream, /*shouldClone*/ **true**)` (§7); write the two branches; propagate a thrown TypeError-when-locked (ReadableStream.cpp:297-343). |
| `ReadableStream__isDisturbed` | `(EncodedJSValue, Zig::GlobalObject*) -> bool` | `stream->m_disturbed` (false for a non-stream). |
| `ReadableStream__isLocked` | `(EncodedJSValue, Zig::GlobalObject*) -> bool` | §1.2's `isReadableStreamLocked` (false for a non-stream). |
| `ReadableStream__cancel` | `(EncodedJSValue, Zig::GlobalObject*) -> void` | if the reader slot does not hold a REAL reader (with an owner back-pointer) → no-op (direct/native `{}` sentinel guard, ReadableStream.cpp:345-364). Else `readableStreamCancel(stream, AbortError DOMException)`. Result markAsHandled. |
| `ReadableStream__cancelWithReason` | `(EncodedJSValue, Zig::GlobalObject*, EncodedJSValue reason) -> void` | `readableStreamCancel(stream, reason)` verbatim; result markAsHandled. **No** sentinel guard (ReadableStream.cpp:373-390). |
| `ReadableStream__detach` | `(EncodedJSValue, Zig::GlobalObject*) -> void` | `m_nativePtr = jsNumber(-1); m_nativeType = 0; m_disturbed = true` (ReadableStream.cpp:392-404). |
| `ReadableStream__empty` | `(Zig::GlobalObject*) -> EncodedJSValue` | RS:347-353: a fresh default stream with a no-op pull, ALREADY CLOSED. Currently in `bindings.cpp:3171+` (CO §B.2); moves to `WebStreamsExports.cpp`. |
| `ReadableStream__used` | `(Zig::GlobalObject*) -> EncodedJSValue` | RS:356-362: a fresh default stream with a reader already acquired (locked, undisturbed). |
| `ReadableStream__errored` | `(Zig::GlobalObject*, EncodedJSValue reason) -> EncodedJSValue` | RS:365-371: a fresh stream, `readableStreamError(s, reason)`. |
| `ZigGlobalObject__createNativeReadableStream` | `(Zig::GlobalObject*, EncodedJSValue nativePtr) -> EncodedJSValue` | ReadableStream.cpp:510-525 / RS:374-381: allocate a `JSReadableStream` with `m_bunMode = NativePending`, `m_nativePtr = nativePtr`, `m_autoAllocateChunkSize` unset (RS:376-380 passes no chunk size), `m_disturbed = false`. Nothing native runs (BE §2.1). |
| `ZigGlobalObject__readableStreamTo{ArrayBuffer,Bytes,Text,JSON,Blob}` | `(Zig::GlobalObject*, EncodedJSValue stream) -> EncodedJSValue` | direct calls to §3.1. `ToArrayBuffer`/`ToBytes` today validate the result is a JSPromise and throw `"Expected promise"` otherwise (ReadableStream.cpp:546-562, 588-604); since §3.1 always returns a promise the validation is dead — drop it. |
| `ZigGlobalObject__readableStreamToFormData` | `(Zig::GlobalObject*, EncodedJSValue stream, EncodedJSValue contentType) -> EncodedJSValue` | note the extra `contentType` arg (ReadableStream.cpp:631-651). |

Also keep the non-extern host fn:
```cpp
JSC_DECLARE_HOST_FUNCTION(jsFunctionTransferToNativeReadableStream);
// body: dynamicDowncast<JSReadableStream>(arg0)->m_transferred = true; ->m_disturbed = true
```
Its ONE caller is `src/js/internal/streams/native-readable.ts:9` via
`$newCppFunction("ReadableStream.cpp", "jsFunctionTransferToNativeReadableStream", 1)` —
the **file name in that string must be updated** to the new `.cpp` (or the symbol
re-declared in a file named `ReadableStream.cpp`). CS §2 is right that this is load-bearing;
its "called via `$transferToNativeReadableStream`" is stale (no private name; it is
`$newCppFunction`).

`Bun__assignStreamIntoResumableSink(JSGlobalObject*, EncodedJSValue stream,
EncodedJSValue sink) -> EncodedJSValue` (`ZigGlobalObject.cpp:2836-2840`; caller
`ResumableSink.rs:248,649`): re-implement as a direct call to §5.4. Its return value is
`undefined` (the builtin returns nothing); keep the encoded-undefined.

`GlobalObject::assignToStream(JSValue, JSValue) -> EncodedJSValue` — §5.6 row 3. Its return
value (undefined | Promise) is what `${name}__assignToStream` hands Rust and drives the
`Signal` protocol; §5.1/5.2 preserve it exactly.

`ReadableStream__incrementCount(void*, i32)` (JSReadableStream.cpp:49) is a Rust EXPORT
that C++ merely declares and never calls (CS §2: "dead — delete"). Delete the declaration.

### 6.3 Brand checks

`$inheritsReadableStream/WritableStream/TransformStream` (CO §A.1) are NOT builtins: the
codegen rewrites `$inheritsFoo(x)` to the generic intrinsic `$inherits(id, x)` keyed on
`js_classes.ts` (`replacements.ts:35-41`). They work off the C++ `ClassInfo` and survive
automatically as long as the new classes keep their `js_classes.ts` entries. No design work.

---

## 7. Bun public API not in the spec

### 7.1 `ReadableStreamDefaultReader.prototype.readMany()` — EXACT contract

`ReadableStreamDefaultReader.ts:44-170`. Public, Bun-only. Return type:
`{value: unknown[], size: number, done: boolean}` — **note the `size` field** (the queue's
total size, `queue.size`), which the async iterator ignores but `readStreamIntoSink` does not.
Returned **synchronously or as a Promise**:

1. Not a default reader → throw a **plain `TypeError`** with the EXACT message
   `"ReadableStreamDefaultReader.readMany() should not be called directly"` and
   **no `.code`** (RSDR:46-47). NOT `ERR_INVALID_THIS` — this is a public, documented Bun
   API and the class/`code`/message are all observable `[reproduced]`
   (`ReadableStreamDefaultReader.prototype.readMany.call({})` today: `TypeError`,
   `code === undefined`, that exact string).
   No owner stream → throw `ERR_INVALID_STATE_TypeError("The reader is not attached to a
   stream")` (RSDR:49).
2. `stream->m_disturbed = true`. `state == Errored` → **THROW `storedError`
   SYNCHRONOUSLY** (:54-56 — not a rejection).
3. `ControllerKind::Direct` and not `Closed` (:63-68): `directController->onPull().then(
   ({done,value}) => done ? {done:true, value: value?[value]:[], size:0}
                          : {value:[value], size:1, done:false})`.
   ("This is a ReadableStream direct controller … not started yet.")
4. No controller and `Closed` → `{done:true, value:[], size:0}` synchronously (:69-70).
5. Queue non-empty (:79-118): drain the ENTIRE queue into a fresh array synchronously
   (byte controller entries are normalized to `Uint8Array` views of `{buffer, byteOffset,
   byteLength}` structs; default controller entries are `.value`), then if not closed:
   close-if-requested else `callPullIfNeeded` (both controller kinds), `resetQueue`. Return
   `{value, size, done:false}`.
6. Queue empty and `Closed` → `{value:[], size:0, done:true}` (:160-162).
7. Queue empty, readable: `p = controller.$pull(controller)` (spec:
   `readableStreamDefaultControllerPull` / the byte pull) → if a promise,
   `.then(onPullMany)`; else `onPullMany(p)`. `onPullMany(:120-158)`: prepend the resolved
   chunk to whatever the pull enqueued, normalize, pull-if-needed, resetQueue.

In C++ this is a `readMany()` host fn on the reader prototype + one internal free function.
It is used by `readStreamIntoSink` (§5.3), `readableStreamIntoArray` (§3.1 `toArray`), and
the async iterator (§7.3). **Keep it public.**

### 7.2 `tee(shouldClone)` — structured-clone-per-branch

`readableStreamTee(stream, shouldClone)` (RSI:543-597). The internal tee takes a Bun-only
`shouldClone` bool (BE §6). `ReadableStream.prototype.tee()` passes `false` (RS:505);
`ReadableStream__tee` (from Rust, for `Response.clone()`) passes **`true`**
(ReadableStream.cpp:331). When `shouldClone && !canceled2`, branch2's chunk is
`$structuredCloneForStream(value)` (RSI:630-641; a clone failure errors BOTH branches and
cancels the source). `structuredCloneForStream` is already a native host fn
(`StructuredClone.cpp:73`, installed at `ZigGlobalObject.cpp:2954`) — call it directly.
`shouldClone` becomes a `bool m_shouldClone` on `JSStreamTeeState` (ARCHITECTURE §6.2), used
by the default-tee `chunkSteps` only. The byte tee (net-new spec behavior) never clones.
`readableStreamTee` ALSO runs `materializeIfNeeded` first (RSI:547-551) — BEFORE acquiring
the reader.

Bun's tee has an EXTRA non-spec behavior: the source reader's `closedPromise` rejection
errors BOTH branch controllers (RSI:582-591). ARCHITECTURE's spec tee already does that via
the reader-closed reaction; no extra work.

### 7.3 `values(options)` / `[Symbol.asyncIterator]()` — **DECIDED: the spec-native iterator** (was Open Question 5)

Today: a lazily-installed JS async **generator** batched via `readMany()` + `yield* value`
(RSI:2600-2644), with `preventCancel` and a `finally` that releases the lock and cancels the
stream unless `preventCancel || isLocked`.

**Recommendation: use ARCHITECTURE's class-14 `JSReadableStreamAsyncIterator`** (the
spec `%ReadableStreamAsyncIteratorPrototype%`) and **drop the readMany-batched generator**.
`readMany()` stays public (§7.1). Rationale:
- The batching is invisible through `for await` (each chunk is yielded individually either
  way); the only user-observable win is fewer microtask ticks.
- The spec iterator is what class 14 already IS; a second bespoke iterator would violate
  ARCHITECTURE §1.
- `preventCancel` is a spec `values(options)` option; parity for free.

**DECISION (Open Question 5 — resolved).** The fidelity reviewer independently verified the
mechanics and **agrees with the recommendation**: use the spec-native class-14 iterator, keep
`readMany()` public, gated on TEST-SURFACE. This is a **deliberate behavior delta** and is
recorded in "Changed in v2". The complete list of what changes (the fidelity review expanded
v1's under-count):

- `Symbol.asyncIterator()[Symbol.toStringTag]` / the returned object's identity changes
  (today it IS an async generator object).
- `values` / `Symbol.asyncIterator` are **lazily self-replacing properties** today
  (RS:515-526) — the property identity (before vs after the first access) is observable.
- Error/cancel *ordering*: today's `finally` cancels through the **PUBLIC**
  `stream.cancel(deferredError)` AFTER `releaseLock()` (RSI:2624-2632) — so it is a no-op on
  any stream something else re-locked in between. The spec's return steps do
  `readableStreamReaderGenericCancel` THEN `Release`. A test asserting the intermediate
  `locked` value during teardown could flip.
- `readMany`-batching makes `disturbed` timing / the source's pull cadence differ: a source
  that enqueues N chunks synchronously delivered them in one `readMany` tick; the spec
  iterator takes N ticks. Not observable in value order.

**Pre-designed fallback (required by the reviewer — not deferred):** if TEST-SURFACE or a
real consumer depends on any of the above, the batched generator is reinstated as
`readMany`-driven state **on the SAME class-14 `JSReadableStreamAsyncIterator` cell**: add a
`Deque<JSC::WriteBarrier<JSC::Unknown>> m_batch` (visited under `cellLock()`) plus a
`bool m_preventCancel`; the iterator's `next()` drains `m_batch` before calling
`reader.readMany()` again, and its return steps replicate today's release-then-public-cancel
order. No second iterator class either way; only the class-14 cell's `next()`/`return()`
bodies differ. Flipping between the two is a one-site change and does not touch any frozen
header.

### 7.4 `pipeTo` on a byte-source stream — Bun-only rejection (fidelity review residue)

`readableStreamPipeToWritableStream` has a Bun-only guard the spec does not have
(RSI:264-265): if the source's controller is a byte controller, it returns
`Promise.$reject("Piping to a readable bytestream is not supported")` — note: the rejection
**reason is a bare STRING**, not an `Error`. This is not in ARCHITECTURE. The spec-core
`pipeTo` (ARCHITECTURE §6.1's `JSStreamPipeToOperation`) must keep this guard, verbatim
reason value, as its FIRST step. If a later PR makes the spec pipeTo actually support byte
sources, that is a behavior change needing its own callout; it is out of scope here.

---

## 8. AsyncContext — the one rule

ARCHITECTURE §4.1 fact 2: `performPromiseThenWithContext` snapshots and restores
`m_asyncContextData` around every reaction handler. That covers everything *reactive*.
What it does NOT cover is Bun's **construction-time snapshot restored around DIRECT
synchronous user calls**.

**Ground truth (verified; BE §7's citation `RSI:130-179` is WRONG — it points at the
CANCEL-only wrapper).** The snapshot cell is `stream.$asyncContext`, written ONCE at
construction (RS:52). It is restored around exactly THREE things, and NOTHING else:

1. The direct-mode user `pull(controller)` in `onPullDirectStream`
   (RSI:1170-1201). — §4.3 step 4.
2. The spec `cancelAlgorithm` for a JS underlying source
   (`readableStreamDefaultControllerCancelAlgorithmWithAsyncContext`, RSI:129-141;
   installed at RSI:162-180 iff a snapshot exists). NOT the pull algorithm, NOT start,
   NOT `size`, NOT any WritableStream/TransformStream callback (grep-verified: no
   `asyncContext` anywhere in `WritableStreamInternals.ts` / `TransformStreamInternals.ts`).
3. The native JSSink `onPull`/`onClose` callables, via `AsyncContextFrame::create(g, fn,
   asyncContext)` (GJS:307-317; RSI:781, 1005, 1017). — §5.2 step 6 / §5.3 step 2.

**The rule.** `JSReadableStream::m_asyncContext` (a `WriteBarrier<Unknown>`) is written from
`AsyncContextFrame::getCurrent(global)` in `finishCreation` and never mutated. A single RAII
helper:

```cpp
// Restores stream->m_asyncContext around user JS; pops on destruction.
// A no-op when m_asyncContext is empty/undefined.
struct BunAsyncContextScope { BunAsyncContextScope(JSGlobalObject*, JSReadableStream*); ~…; };
```

is placed around **the entire `run*Algorithm` body — the user call PLUS every reaction it
registers** — at exactly the three sites above:
`JSDirectStreamController::onPull` (the `pull` call AND its `.catch` registration),
the `SourceKind::JavaScript` `cancelAlgorithm` arm, and — implicitly, via
`AsyncContextFrame` on the stored callable — the JSSink onPull/onClose. "Reaction
registration under the restored context" is what makes any promise chain the user starts
inside `pull`/`cancel` inherit the construction-time ALS store; that is the airtight part.

**Do NOT extend the restore to the spec `pullAlgorithm` / `startAlgorithm` / `size`.** That
is not the current behavior; doing so silently changes what `AsyncLocalStorage.getStore()`
returns inside a `pull()` triggered by `reader.read()` from a different ALS scope (today:
the reader's scope; "improved": the constructor's).

**DECIDED (was Open Question 4): preserve exactly; do NOT extend.** The fidelity reviewer
independently verified the restore points (the direct `pull` at RSI:1170-1201; the JS
`cancelAlgorithm` at RSI:129-141, installed at RSI:172-179; nothing else) and agrees. Any
extension is a behavior change belonging in its own PR.

---

## 9. TextEncoderStream / TextDecoderStream / CompressionStream / DecompressionStream

### 9.1 CompressionStream / DecompressionStream — **NO WORK. NOT a `TransformerKind` arm.**

**Correction to the plan and to CO §B.2's "INCOMPLETE" note.** They do NOT touch
TransformStream internals at all. `initializeCompressionStream` / `…Decompression…`
(`CompressionStream.ts:1-21`, `DecompressionStream.ts:1-21`) build a `node:zlib` Duplex and
wrap it with `newBufferSourceTransformPairFromDuplex` from
`src/js/internal/webstreams_adapters.ts:867-877`, which uses ONLY the public
`new ReadableStream` / `new WritableStream` constructors. Their only private slots are their
own `$readable`/`$writable`. They stay as JS builtins, untouched. Making them a
`TransformerKind` arm would be a rewrite of zlib streaming for no reason.

### 9.2 TextEncoderStream / TextDecoderStream — **YES, a `TransformerKind` arm each. Feasible.**

Both are ~50-line builtins layered on exactly TWO TransformStream internals
(CO §A.1; verified `TextEncoderStream.ts:26-60`, `TextDecoderStream.ts:26-77`):
- `$createTransformStream(startAlgorithm, transformAlgorithm, flushAlgorithm)` = the spec
  abstract op **`CreateTransformStream`** (`TransformStreamInternals.ts:37-79`), with
  `writableHWM = 1`, `readableHWM = 0`, both size algorithms `() => 1`, and a
  start algorithm that is `Promise.resolve()`.
- `$transformStreamDefaultControllerEnqueue(controller, chunk)` = the spec op
  **`TransformStreamDefaultControllerEnqueue`**.

Both are in ARCHITECTURE's spec core already. Two prerequisites the Bun layer adds to the
frozen headers:

1. **The internal creation signature.** ARCHITECTURE §4 gives `createReadableStream(...)` /
   `createWritableStream(...)`; the parallel is required here:
   ```cpp
   JSTransformStream* createTransformStream(JSGlobalObject*, TransformerKind,
       JSC::JSCell* algorithmContext,
       double writableHWM = 1, JSC::JSObject* writableSize = nullptr,
       double readableHWM = 0, JSC::JSObject* readableSize = nullptr);
   ```
   The transformer's start step for these kinds is trivial (resolved-undefined) — §4.1
   fact 6: no promise is allocated.

2. **Two enum arms + their context cells:**
   ```cpp
   enum class TransformerKind : uint8_t { JavaScript, Identity, TextEncoder, TextDecoder };
   ```
   - `TextEncoder`: `m_algorithmContext` → the `JSTextEncoderStream` cell (a new
     hand-written C++ class replacing `TextEncoderStream.ts`). It holds
     `WriteBarrier<JSTransformStream> m_transform` and a `TextEncoderStreamEncoder`
     (already an existing native class — `BunBuiltinNames.h:35`; it owns the lone-surrogate
     buffering).
     - `transformAlgorithm(chunk)`: `buf = encoder.encode(ToString(chunk))`; on throw →
       rejected promise (`TextEncoderStream.ts:32-36`); if `buf.length`,
       `transformStreamDefaultControllerEnqueue(readableController, buf)`. Return
       resolved-undefined.
     - `flushAlgorithm()`: `buf = encoder.flush()`; enqueue if non-empty
       (`TextEncoderStream.ts:44-53`).
     - **No cancelAlgorithm** (identical to today).
   - `TextDecoder`: context → the `JSTextDecoderStream` cell holding `m_transform` +
     a `WebCore::TextDecoder` (`{fatal, ignoreBOM}` from the options,
     `TextDecoderStream.ts:67-74`) + the `encoding/fatal/ignoreBOM` getters' backing state.
     - `transformAlgorithm(chunk)`: `decoder.decode(chunk, {stream:true})`; throw → rejected
       promise; enqueue if the string is non-empty (`TextDecoderStream.ts:33-47`).
     - `flushAlgorithm()`: `decoder.decode(undefined, {stream:false})`; same
       (`TextDecoderStream.ts:48-62`).

   **Other internals they touch:** NONE beyond the two above. The `readable`/`writable`/
   `encoding`/`fatal`/`ignoreBOM` getters are member reads. The private slots
   `textEncoderStreamTransform/Encoder`, `textDecoderStreamTransform/Decoder` in
   `BunBuiltinNames.h` become C++ members and are pruned.

Both classes become real `JSFoo/Prototype/Constructor` triples per ARCHITECTURE §1/§2
(they already have `ZigGlobalObject.lut.txt` entries — CO §B.1 :81/83). Their `.ts` files
are deleted.

---

## 10. Everything that must MOVE, not die

Consumers OUTSIDE the deleted files that reach a stream-`.ts` symbol (CO §A.1). Grep-verified.

| symbol | defined in (deleted) | outside consumers | new home |
|---|---|---|---|
| `$createFIFO()` | `StreamInternals.ts:88` | `builtins/CommonJS.ts:192`, `node/fs.promises.ts:69` | The `Dequeue` class already lives in `src/js/internal/fifo.ts` (survives untouched). Move the 4-line `createFIFO` wrapper into a NEW tiny `src/js/builtins/FIFO.ts`. Keep the `createFIFO` private name. |
| `$markPromiseAsHandled(p)` | `StreamInternals.ts:29-32` | `internal/sql/query.ts` (grep-verified) — plus all the new C++ | JS: move to a surviving builtin file (`PromiseHelpers.ts` or the new `FIFO.ts`). C++: use `JSPromise::markAsHandled` directly. |
| `$structuredCloneForStream` | (NOT a builtin — a native host fn, `StructuredClone.cpp:73`) | tee | survives; called directly from C++. |
| `$transformStreamDefaultControllerEnqueue` | `TransformStreamInternals.ts` | `TextEncoderStream.ts:40,50`, `TextDecoderStream.ts:44,59` | its only consumers are ALSO deleted (§9.2). Nothing to move. |
| `$getInternalWritableStream` / `$createWritableStreamFromInternal` / `$isWritableStream` | WritableStreamInternals + `ZigGlobalObject.cpp:2959-2960` | ONLY deleted files (`RS:419,486`, `TransformStreamInternals.ts:130`) | **DIE.** The public/internal WritableStream split is gone (ARCHITECTURE §0). Delete the two host fns, `InternalWritableStream.{h,cpp}`, `WritableStream.{h,cpp}`, and the `internalWritable` name. Grep for other `InternalWritableStream::fromObject` callers in `ZigGlobalObject.cpp` (CO §B.1) before deleting — CO flags fetch upload paths. |
| `$inheritsCompressionStream/DecompressionStream/…` | generic `$inherits(id, …)` | (De)CompressionStream.ts | automatic; see §6.3. |
| the `createFulfilledPromise`/`promiseInvokeOrNoop*`/`shieldingPromiseResolve`/queue helpers in `StreamInternals.ts` | | grep: ZERO users outside the deleted set | **DIE.** |
| `newBufferSourceTransformPairFromDuplex` & all of `webstreams_adapters.ts` | NOT deleted | Compression/Decompression, node:stream toWeb/fromWeb | untouched; it uses only the public constructors + `$inherits*` + `stream.$bunNativePtr`. The `$bunNativePtr` read (`webstreams_adapters.ts:40`, `native-readable.ts:53`) is the ONE remaining "private property" read on the stream from surviving JS — keep the `$bunNativePtr` `DOMAttribute` custom getter/setter pair (returning `nativePtrForJS()`) on the new prototype exactly as today (`JSReadableStream.cpp:227-235`). Same for `$disturbed`. `$bunNativeType` has readers in `tty.ts` per CO §A.2 — keep all three accessors. |

`BunBuiltinNames.h` names to PRUNE vs KEEP: apply PL §2's rule mechanically after the
above. At minimum the following STAY because non-deleted code references them:
`bunNativePtr`, `bunNativeType`, `disturbed`, `createFIFO`, `structuredCloneForStream`,
`createNativeReadableStream`/`createEmptyReadableStream`/`createErroredReadableStream`/
`createUsedReadableStream` (only if kept as private names rather than direct C++ calls —
recommend: delete the private names, make them C++-internal), `underlyingSink`
(ProcessObjectInternals.ts:108, CO §A.2 — unrelated to us). `assignToStream`,
`startDirectStream`, `getInternalWritableStream`, `createWritableStreamFromInternal`,
`lazyStreamPrototypeMap`, `internalWritable`, and every spec-slot name (`state`, `queue`,
`readRequests`, …) that no surviving builtin uses: DELETE (PL §2's grep gate).

---

## Decisions (formerly "Open questions for the maintainer") — ALL FIVE DECIDED

There are **no open questions**. Each of v1's five was independently answered by the
fidelity review with source/empirical evidence; where the reviewer agreed with v1's default
it stands, and where the reviewer disagreed with evidence the reviewer's answer wins. The
decisions are recorded inline where they apply; this list is a summary.

1. **`ReadableStream__isLocked` unification → UNIFY on the JS answer (transferred ⇒ locked
   everywhere).** Reviewer agrees. Deliberate delta. Detail + the required Rust-caller audit
   gate: §1.2.
2. **`Tag::Direct = 3` → keep the value frozen, keep never emitting it.** Reviewer agrees.
   Detail: §6.1.
3. **`controller.sink` → NO public `.sink` at all** (the fidelity reviewer's source-backed
   answer OVERRIDES v1's default, which would have introduced a net-new public property).
   Detail: §4.2.
4. **Async-context scope of the spec `pull()` → preserve exactly; do NOT extend.** Reviewer
   agrees. Detail: §8.
5. **The async iterator → the spec-native class-14 iterator, `readMany()` stays public**,
   gated on TEST-SURFACE with the fallback pre-designed on the same cell. Reviewer agrees.
   Deliberate delta. Detail: §7.3.

**Deferred to Phase D:** nothing. No design question in this document remains open.

## What I did not verify

- The **Rust-side native `.text()/.arrayBuffer()/.bytes()/.json()/.blob()` methods on the
  handle** that `tryUseReadableStreamBufferedFastPath` feature-detects (BE §2.4 flags this
  too, and the earlier `Body.Value` readAll fast path in `Response.rs`/`Blob.rs`). I designed
  the C++ CALLER faithfully; I did not verify which of the 3 `NewSource` classes actually
  expose which methods.
- `ReadableByteStreamInternals.ts` in depth (BE §4's caveat). The byte controller is treated
  as pure spec here except for the noted "native sources use the DEFAULT controller since
  v1.1.44" fact, which I did verify.
- `InternalWritableStream.cpp` / the writable-side `fromObject` callers in
  `ZigGlobalObject.cpp` beyond the two host fns (BE §5's caveat). §10's "delete" row for
  `$getInternalWritableStream` needs a final grep of `ZigGlobalObject.cpp` for
  `InternalWritableStream::fromObject` before the header is frozen.
- `src/js/internal/webstreams_adapters.ts`'s BYOB / `desiredSize` usage in
  `Readable.toWeb` (CO §A.3). Public-API only, so it should be spec-core's problem, but I
  did not read it line-by-line.
- Exhaustive per-call-site audit of `Body.rs` / `Blob.rs` / `RequestContext.rs` /
  `streams.rs` (CO's own INCOMPLETE §C). All funnel through the §6 extern surface, which I
  did verify against `ReadableStream.rs` line-by-line.
- The `$lazy(id)` `*__JSReadableStreamSource__load` loaders' liveness after the rewrite
  (§2.5, last paragraph) — flagged as a check, not asserted.

---

## Changed in v2

Every finding from `specs/BUN-LAYER-REVIEW-GC.md` and `specs/BUN-LAYER-REVIEW-FIDELITY.md`
was applied. One bullet per finding: **ID + severity → what changed.**

### From `BUN-LAYER-REVIEW-GC.md` (1 CRITICAL, 3 MAJOR, 2 MINOR — all applied)

- **GC CRITICAL #1** — non-total `ControllerKind` dispatch: §4.7 is now an EXHAUSTIVE table
  over every spec op touching `stream->m_controller` (`[[PullSteps]]`, `readMany`,
  `[[CancelSteps]]`, `[[ReleaseSteps]]`, close/error, `desiredSize`, the BYOB-getReader
  brand check) with an explicit arm for all five kinds in each row; raw
  `jsCast`/`static_cast` on `m_controller` is BANNED in favor of one inline
  `switch(m_controllerKind)` helper; the `[[ReleaseSteps]]`-on-`Direct`/`NativeSink` no-op
  arms are written. (Merged with FIDELITY CRITICAL #2 — see below.)
- **GC MAJOR #2** — handle→controller edge pins the consumer graph: applied with the
  maintainer's ruling, which goes FURTHER than the review's own proposed fix (severing on
  terminal paths alone cannot fix the abandoned-consumer + `updateRef(true)` case, which has
  no terminal path). BOTH: (i) §2.2's `m_controller` is now `JSC::Weak<>` (the ONE
  §7.6-sanctioned Weak; every read null-checks; the adapter becomes a
  `JSDestructibleObject`), AND (ii) `handle.onClose`/`onDrain`/`m_handle`/`m_pendingView`
  are cleared as numbered steps on all three terminal paths (§2.4).
- **GC MAJOR #3** — pump cells not provably rooted across the backpressure `await`: §5.3
  and §5.4 now use ARCHITECTURE §6.1's own device — the acquired reader's visited
  `WriteBarrier<JSCell> m_pipeOperation` back-edge, set at acquire, cleared on release.
- **GC MAJOR #4** — §4.3 skipped ARCHITECTURE §7.2's post-user-call re-validation: new
  step 6a re-loads `m_stream`/`[[state]]` after the user `pull` and never calls
  `readableStreamAddReadRequest` on a non-`Readable` stream; §4.6 now rejects **and clears**
  `m_pendingRead` (matching RSI:1141).
- **GC MINOR #5** — `JSBoundFunction` prepends bound args, opposite of
  `performPromiseThenWithContext`: §2.2 defines the two DISJOINT handler families
  (**[reaction-convention]** `(resolutionValue, contextCell)` vs **[bound-convention]**
  `(contextCell, ...callArgs)`); every named handler in the document is annotated with its
  family and none appears in both.
- **GC MINOR #6** — three cells lacked their GC contract: `JSDirectSinkCloseState` (§5.2),
  `JSReadStreamIntoSinkOperation` (§5.3), and `JSResumableSinkPumpOperation` (§5.4) each now
  state base class (`JSC::JSNonFinalObject`), `DECLARE_VISIT_CHILDREN` over every barrier,
  an iso subspace, and non-destructibility.

### From `BUN-LAYER-REVIEW-FIDELITY.md` (4 CRITICAL, 5 MAJOR, 4 MINOR — all applied)

- **FIDELITY CRITICAL #1** `[reproduced]` — `onFlushDirectStream` branch order was
  inverted: §4.4 restated in exact source order; the `m_deferFlush == -1` check is the LAST
  `else if`, and the missing "no real default reader → return, no defer" guard is added.
- **FIDELITY CRITICAL #2** `[reproduced-from-source]` — `readableStreamCancel` on a
  `NativeSink`-controlled stream IS reachable from Rust (`ReadableStream__cancelWithReason`
  has no sentinel guard): v1's "unreachable, assert" is DELETED for cancel; the `NativeSink`
  cancel arm's body is today's defined behavior
  (`Promise.resolve(sinkController->close(reason))` → native close + `detach()` →
  `readDirectStreamOnClose` → `underlyingSource.cancel(reason)`). Folded into the §4.7
  table with GC CRITICAL #1.
- **FIDELITY CRITICAL #3** `[reproduced]` — the generic `toText` path had no home and the
  BOM claim was wrong: new §3.1a specifies `readableStreamIntoText` (standalone Text sink +
  `readStreamIntoSink(isNative:false)` + `withoutUTF8BOM`); v1's "the direct Text sink
  BOM-strips" is corrected — the DIRECT sink does NOT strip the BOM, the GENERIC path DOES;
  the asymmetry is preserved deliberately; and §3.1's generic (step-5) path is specified for
  EVERY `readableStreamTo*`, none left as the bare word "Generic path".
- **FIDELITY CRITICAL #4** `[reproduced]` — dropping the `.catch` result promise removed a
  real `unhandledRejection` and flipped the exit code: applied with the maintainer's ruling.
  §4.3 step 5 registers the rejection reaction WITH a real, fresh, NOT-marked-as-handled
  `JSPromise` result that the handler rejects — one extra promise, allocated ONLY on the
  direct-pull path. v1's false "the old `.catch` return value was never observed" sentence
  is deleted from §4.6.
- **FIDELITY MAJOR #5** — `m_bunHighWaterMark`'s writer list was incomplete: §1 now names
  ALL FOUR `initializeReadableStream` constructor arms as writers (it is set for ordinary
  spec streams too, and `readStreamIntoSink` hands it to the HTTP sink for them) and records
  the exact per-consumer normalization (`|| 0`, min-64 clamp, the `typeof === "number"`
  predicate).
- **FIDELITY MAJOR #6** — `readStreamIntoSink`'s error path never releases the reader
  today; v1's `finally` silently fixed it: applied with the maintainer's ruling. §5.3
  step 7 clears the op's reader reference FIRST (so step 8 skips `releaseLock`), the
  "cancel" is the PUBLIC always-rejecting `.cancel` (markAsHandled, `cancelAlgorithm`
  intentionally NOT invoked), and a comment states: the reader is intentionally NOT released
  on the error path; today's behavior; changing this is a separate PR.
- **FIDELITY MAJOR #7** `[reproduced]` — the direct controller's methods are detachable own
  properties today: applied with the maintainer's ruling. §4.2's five public methods
  (`write`/`end`/`close`/`flush`/`error`) are per-controller OWN `JSBoundFunction`s
  ([bound-convention]) over shared `JSStreamsRuntime` handlers with the controller as
  context — detachability and identity preserved; five cells, only on the JS-consumption
  direct path.
- **FIDELITY MAJOR #8** `[reproduced]` — `readMany`'s brand-check error: §7.1 now keeps the
  exact plain `TypeError` with message
  `"ReadableStreamDefaultReader.readMany() should not be called directly"` and no `.code`
  (not `ERR_INVALID_THIS`).
- **FIDELITY MAJOR #9** — the adapter's `m_controller` assignment point was unspecified:
  §2.2 now specifies the source's exact two wiring points (inside `start` when a
  `drainValue` exists, else the first pull) and that `onDrain`/`onClose` tolerate an unset
  back-edge (an early native `onDrain` chunk is LOST today — preserved, not "fixed").
- **FIDELITY MINOR (closer[0] decoding)** — §2.4's decoding restated as the source has it:
  `isClosed` is read once and passed INTO the handlers; `adjustChunkSize` only when
  `!isClosed`; a closed result always yields `m_pendingView = null` (the tail is dropped).
- **FIDELITY MINOR (`readDirectStream` early close)** — §5.2 step 3 now says the early
  `close()` calls are invoked with `stream = undefined`, so only the
  `underlyingSource.cancel` half runs and the stream stays `Readable`.
- **FIDELITY MINOR (`$resume(false)` gate polarity)** — §1.2 / §2.4: the gate is
  "`m_nativePtr` slot non-empty (ANY value, including the `-1` sentinel) AND
  `SourceKind::Native`", not `nativeHandleDetached()` (which is INVERTED — the detached
  branch runs today).
- **FIDELITY MINOR (HWM predicate)** — §4.1: the ArrayBufferSink HWM predicate is
  `hwm && typeof hwm === "number"` (Infinity and negatives PASS), not "a finite number";
  the storage is `ToNumber` at construction + a `typeof`-was-number bit, with the exact
  predicate stated at each of the three consumer sites.
- **FIDELITY residue (both items)** — §7.4 adds `readableStreamPipeToWritableStream`'s
  Bun-only byte-source rejection (a bare-string reason); §3.1's `toJSON` records that
  RS:323 is `Bun.peek`, not `Bun.peek.status`, so the port only takes the synchronous
  branch when the text promise is FULFILLED.
- **The 5 Open Questions** — all five DECIDED (see the "Decisions" section). Where the
  fidelity reviewer agreed with v1's default it stands; on OQ3 (`controller.sink`) the
  reviewer's source-backed disagreement wins (no public `.sink`).

### Deliberate behavior deltas v2 ships (for the eventual PR description)

These are the ONLY intentional user-observable changes; everything else in this document is
parity. Each needs a test / a callout in the PR body.

1. **The direct controller's `_`-prefixed internals are gone from the object** (R3 /
   FIDELITY MAJOR #7): `_pendingRead`, `_deferClose`, `_deferFlush`, `_deferCloseReason`,
   `_handleError` become C++ members and are NOT observable properties.
   `Object.keys(controller)` / `Object.hasOwn(controller, "_pendingRead")` change.
   Negligible risk: nobody reads a `_`-prefixed internal off a duck-typed controller.
2. **Post-close direct-controller method identity** (§4.2): today close REASSIGNS the five
   own properties to one shared throwing function (`c.write === c.close` becomes `true`
   after close); v2 keeps the five bound cells stable and throws from an `m_closed` guard
   with the identical `TypeError` message. Identity after close changes; the throw does not.
3. **`isLocked` unification** (Open Question 1): `ReadableStream__isLocked`'s C++ path now
   agrees with the JS `locked` getter — a `transferToNativeReadableStream`'d stream reports
   locked to Rust too. (Requires the §1.2 Rust-caller audit before freeze.)
4. **The spec-native async iterator** (Open Question 5 / §7.3): iterator object identity,
   the lazily-self-replacing `values`/`Symbol.asyncIterator` property identity, and the
   release/cancel ordering in the return steps change. Fallback pre-designed on the same
   cell if TEST-SURFACE objects.
5. **Non-number strategy `highWaterMark` values** (§4.1): `ToNumber`'d once at construction
   instead of being relationally compared raw at each consumer. No plausible input is
   affected.
6. **NO change** ships for: the direct-pull `unhandledRejection` (v2 preserves it — the
   result promise is real), the `readStreamIntoSink` error-path lock leak (v2 preserves it),
   the direct-vs-generic `toText` BOM asymmetry (v2 preserves both), and the early-`onDrain`
   chunk loss on a not-yet-read native source (v2 preserves it). v1 would have silently
   changed all four.
