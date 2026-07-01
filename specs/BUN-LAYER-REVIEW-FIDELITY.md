# BUN-LAYER-DESIGN.md — Adversarial Fidelity Review

Scope: behavioral fidelity ONLY. Every finding below was checked against the current source
(`RSI` = `src/js/builtins/ReadableStreamInternals.ts`, `RS` = `src/js/builtins/ReadableStream.ts`,
`RSDR` = `src/js/builtins/ReadableStreamDefaultReader.ts`). Findings marked **[verified at runtime]**
were reproduced against the current Bun binary on this machine.

---

### [SEVERITY: CRITICAL] §4.4 inverts `onFlushDirectStream`'s branch order — a pending read gets a DIFFERENT chunk

- **Design claim** (§4.4): "If `m_deferFlush == -1` (inside pull) → `m_deferFlush = 1`; return
  (RSI:1394-1395). Else if there is a `m_pendingRead`: `flushed = sink.flush()`; … Else if the
  reader has queued read requests: …"
- **Source evidence**: `RSI:1369-1397`. The branch order is the REVERSE. The function first
  early-returns when there is no real default reader (`RSI:1374-1377` — a guard the design drops
  entirely), then handles the `_pendingRead` branch (`RSI:1381-1388`), then the `readRequests`
  branch, and only as the LAST `else if` (`RSI:1394-1395`) checks `_deferFlush === -1`. So
  `flush()` called *synchronously inside `pull`* while a previous `read()` is already pending is
  NOT deferred today — it flushes the sink at that instant and fulfills the pending read with only
  the bytes written *before* the `flush()` call.
- **Observable difference** **[verified at runtime]**:
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
  Today prints `A` (flush ran inside `pull`, before `"B"` was written). Under the design,
  `m_deferFlush == -1` wins → the flush replays *after* `pull` returns → `sink.flush()` yields
  `AB` → prints `AB`.
- **Proposed fix**: §4.4 must be restated in source order: (1) no stream / no sink → return;
  (2) `reader` missing or not a real default reader → return (no defer!); (3) `m_pendingRead`
  branch; (4) `readRequests` branch; (5) **last**: `else if (m_deferFlush == -1) m_deferFlush = 1`.

### [SEVERITY: CRITICAL] `readableStreamCancel` on a `NativeSink`-controlled stream is reachable and has defined behavior; the design gives it no arm

- **Design claim** (§4.7): "`readableStreamCancel` (RSI:1748-1779): `ControllerKind::None` →
  resolve immediately …; `Direct` → …; spec kinds → the spec `cancelAlgorithm`." and
  "`readableStreamCancel` on a `ControllerKind::NativeSink` stream is unreachable from Rust:
  `ReadableStream__cancel` … explicitly bails when `m_reader` holds the `{}` sentinel".
- **Source evidence**: the sentinel guard exists only in `ReadableStream__cancel`
  (`ReadableStream.cpp:345-368`). The design itself documents (§6.2) that
  `ReadableStream__cancelWithReason` (`ReadableStream.cpp:373-390`) has "**No** sentinel guard" —
  and Rust calls it (`FetchTasklet.rs:2100` via `ReadableStream::cancel_with_reason`, e.g. on
  fetch-request-body abort). It runs `readableStreamCancel(stream, reason)` directly. For a
  `type:"direct"` body that `assignToStream` handed to a native sink, `readDirectStream`
  (RSI:775) has set `$readableStreamController` = the generated `JSReadable*Controller` cell.
  `readableStreamCancel` RSI:1772-1776 then does: `controller.$cancel` (absent on the sink
  controller) → `controller.close` → the **generated `${controller}__close` host fn**
  (`generate-jssink.ts:438-467`, installed on the controller prototype at `:1252`), which does the
  native close + `detach()` → `readDirectStreamOnClose` → `underlyingSource.cancel(reason)`.
- **Observable difference**: abort a `fetch(url, { body: new ReadableStream({type:"direct",
  pull(c){…}, cancel(r){…}}), method:"POST", duplex:"half" })`. Today the user's `cancel(reason)`
  fires and the stream transitions to Errored with `reason`. Under the design there is no
  `NativeSink` arm in the cancel dispatch (and §4.7 says to *assert* unreachability) — either an
  assertion failure or the spec `cancelAlgorithm` applied to a non-spec controller.
- **Proposed fix**: add an explicit `ControllerKind::NativeSink` arm to the internal
  `readableStreamCancel`: mark disturbed, close the stream, then call the sink controller's
  `close(reason)` (exactly RSI:1775-1776's `Promise.$resolve(controller.close(reason))`).
  Restrict the "unreachable, assert" claim to the *read* dispatch only.

### [SEVERITY: CRITICAL] The generic `Bun.readableStreamToText` path (`readableStreamIntoText`) has no home, and the design mis-states the direct path's BOM handling

- **Design claim** (§3.1): the non-direct, non-fast-path `toText` case is just "5. Generic path".
  (§3.3): the Text sink's `end()` yields "the concatenated, **BOM-stripped** string —
  RSI:1467-1500". (§4.1) absorbs `createTextStream`'s state into `JSDirectStreamController`
  members (`m_rope`, `m_pieces`, …).
- **Source evidence**: the generic `toText` is `readableStreamIntoText` (RSI:2462-2472). It
  instantiates the `createTextStream` sink as a **standalone plain-object sink with no controller
  of any kind**, pumps it via `readStreamIntoSink(stream, textSink, /*isNative*/ false)`, and then
  applies `withoutUTF8BOM` (RSI:2454-2460) to the final string. Neither `readableStreamIntoText`
  nor `withoutUTF8BOM` is mentioned anywhere in the design; there is nothing left to hand
  `readStreamIntoSink` once the Text sink is a set of `JSDirectStreamController` members. And the
  BOM claim is wrong: `createTextStream.finishInternal` (RSI:1463-1501) strips a leading U+FEFF
  ONLY on the pure-string rope path; the buffer-only path decodes with
  `new TextDecoder("utf-8", { ignoreBOM: true })` — i.e. the BOM is **kept**. Only the *generic*
  path's extra `withoutUTF8BOM` step strips it.
- **Observable difference** **[verified at runtime]**:
  ```js
  const bom = c => c.write(new TextEncoder().encode("﻿abc"));
  await Bun.readableStreamToText(new ReadableStream({type:"direct", pull(c){bom(c); c.end();}}));
  // today: "﻿abc"   (BOM PRESERVED — the direct path never runs withoutUTF8BOM)
  await Bun.readableStreamToText(new ReadableStream({pull(c){c.enqueue(new TextEncoder().encode("﻿abc")); c.close();}}));
  // today: "abc"          (BOM STRIPPED)
  ```
  A design implementing "the Text sink's `end()` BOM-strips" flips the first result to `"abc"`;
  a design with no `readableStreamIntoText` at all has no generic `toText` behavior to implement.
- **Proposed fix**: (a) add §3.1a describing `readableStreamIntoText` explicitly: a
  standalone Text accumulator object/cell (distinct from `JSDirectStreamController`) +
  `readStreamIntoSink(isNative=false)` + a final `withoutUTF8BOM` on the result — and note that
  §5.3's op cell must accept this internal JS-less "sink" as well as the native JSSink.
  (b) Correct §3.3/§4.5: `end()` BOM-strips only in the all-string case; the byte and mixed cases
  decode with `ignoreBOM:true`; the leading-BOM strip belongs ONLY to the generic path.

### [SEVERITY: CRITICAL] Dropping the direct-pull `.catch` result promise removes a real `unhandledRejection` (and an exit-code change)

- **Design claim** (§4.6): "since we register with no result promise the re-throw is dropped;
  that is behavior-preserving (the old `.catch` return value was never observed)". (§4.3 step 5:
  "attach ONLY a rejection reaction … No result promise.")
- **Source evidence**: RSI:1185-1191 does `result.catch(controller._handleError)` where
  `_handleError` = `handleDirectStreamErrorReject`, which `return Promise.$reject(e)`
  (RSI:1149-1152). The promise produced by `.catch(...)` therefore rejects and nothing ever
  handles it → it IS observed, by the unhandled-rejection machinery.
- **Observable difference** **[verified at runtime]**:
  ```js
  const s = new ReadableStream({type:"direct", pull(c){ return Promise.reject(new Error("boom")) }});
  s.getReader().read().catch(() => {});   // the read rejection IS handled
  ```
  Today: `process.on("unhandledRejection")` fires with `boom` anyway, and with no handler the
  process **exits 1**. Under the design (rejection-only reaction, no result promise) it exits 0.
- **Proposed fix**: don't claim equivalence. Either (a) keep fidelity: create the result promise
  and let the handler reject it (one extra `JSPromise` per rejected direct pull), or (b) call the
  suppression out as a deliberate, user-visible behavior fix in the PR (an errored direct stream
  no longer double-reports), with a test updated in the same PR.

---

### [SEVERITY: MAJOR] `m_bunHighWaterMark`'s writer list is incomplete — every constructor arm writes the stream-level `$highWaterMark`, and `readStreamIntoSink` consumes it for ORDINARY streams

- **Design claim** (§1): "`$highWaterMark` on the STREAM (**RS:81, RS:84-91**). … Consumers:
  readDirectStream …, the ArrayBufferSink initial capacity …, readStreamIntoSink /
  assignStreamIntoResumableSink `sink.start({highWaterMark})` (RSI:989, RSI:941)."
- **Source evidence**: RS:65 (the eager `pull` arm) and RS:101 (the plain arm) ALSO write
  `$putByIdDirectPrivate(this, "highWaterMark", strategy.highWaterMark)`. So EVERY
  `ReadableStream` carries the strategy HWM in the stream-level slot, and
  `readStreamIntoSink` (RSI:989 `$getByIdDirectPrivate(stream,"highWaterMark") || 0`) hands it to
  the native HTTP/file sink for *ordinary spec streams*, not just direct/lazy ones. (Note also the
  `|| 0` coercion, which the design does not record; `m_bunHighWaterMark`'s "NaN = unset" must
  become `0` at these two call sites, and 64 in `readDirectStream`.)
- **Observable difference**:
  `Bun.serve({fetch: () => new Response(new ReadableStream({ pull(c){…} }, { highWaterMark: 65536 }))})`
  — today the HTTP response sink is started with `highWaterMark: 65536` (controls when `write`
  reports backpressure / how output is chunked on the wire). A C++ port that only populates
  `m_bunHighWaterMark` in the `DirectPending`/`NativePending` constructor arms starts the sink
  with `0`.
- **Proposed fix**: §1's comment must say `m_bunHighWaterMark` is written by ALL FOUR constructor
  arms of `initializeReadableStream` (RS:65, RS:81, RS:90, RS:101 — for the lazy arm it is
  `autoAllocateChunkSize || strategy.highWaterMark`), and record the per-consumer normalization
  (`|| 0` at RSI:989/941; `!hwm || hwm < 64 ? 64 : hwm` at RSI:776-779;
  `hwm && typeof hwm === "number"` at RSI:1608-1611).

### [SEVERITY: MAJOR] `readStreamIntoSink`'s error path never releases the reader today; the design's finally does

- **Design claim** (§5.3): "7. `catch(e)`: `m_didThrow = true`; `stream.cancel(e)` (result
  markAsHandled); … Reject the result with `e`. 8. `finally`: `reader.releaseLock()` (errors
  swallowed); …"
- **Source evidence**: RSI:1068-1074 — the catch does `reader = undefined` BEFORE `stream.cancel(e)`.
  Consequences: (a) the `finally` (RSI:1087) is `if (reader)` — false, so **`releaseLock()` never
  runs on the error path**; (b) `stream.cancel(e)` is the PUBLIC `ReadableStream.prototype.cancel`,
  which sees the stream still locked by that reader and returns
  `Promise.reject(ERR_INVALID_STATE)` (RS:386) — i.e. the "cancel" is a guaranteed no-op that only
  exists to be `markAsHandled`. The stream stays locked, un-cancelled, with an orphaned reader.
- **Observable difference**: `new Response(rs)` served where `sink.write()` throws (or the byte
  loop throws): today `rs.locked === true` forever afterwards and `rs`'s `cancelAlgorithm` never
  runs; under the design's steps 7–8 the lock is released (`rs.locked === false`) and — if
  "`stream.cancel(e)`" is implemented as the internal `readableStreamCancel` rather than the
  always-rejecting public method — the user's `cancel(e)` fires.
- **Proposed fix**: step 7 must say "clear the op's reader reference (so step 8 skips
  `releaseLock`) and call the PUBLIC `.cancel` semantics (which rejects because the stream is
  locked); the rejection is markAsHandled and the source's cancelAlgorithm is intentionally NOT
  invoked." Step 8's `releaseLock` is conditional on `!m_didThrow`.

### [SEVERITY: MAJOR] The direct controller's `write` is detachable today; a prototype host fn is not — and the whole own-property surface changes

- **Design claim** (§4.2): the direct controller becomes a real class; `write(chunk)`'s "old
  value" is `sink.write.bind(sink)`; §4.2's table presents the 5 methods + `.sink` as the surface.
- **Source evidence**: RSI:1519-1535 / 1543-1595 / 1615-1631 — the controller handed to the user's
  `pull` is a **plain object with own properties**. `write` is pre-bound (ArrayBuffer flavor) or a
  closure over the sink's captured state (Text/Array flavors), so it works with `this === undefined`.
  `_pendingRead`, `_deferClose`, `_deferFlush`, `_deferCloseReason`, `_handleError` are ordinary
  enumerable underscore-named own properties. On close, RSI:1320 REASSIGNS the 5 own props to one
  shared function (so `c.write === c.close` becomes `true`).
- **Observable difference** **[verified at runtime]**:
  ```js
  new ReadableStream({type:"direct", pull(c){ const {write} = c; write("hello"); c.end(); }})
  ```
  works today (prints "hello" through `readableStreamToText`). A brand-checking
  `JSDirectStreamController.prototype.write` host fn throws `ERR_INVALID_THIS` for the detached
  call. Likewise `Object.keys(controller)`, `Object.hasOwn(controller,"write")`, and
  post-close method identity all change.
- **Proposed fix**: state this explicitly as an accepted compat break (with the `Object.keys` /
  detached-`write` deltas listed for TEST-SURFACE), or keep `write` as a bound per-instance own
  function. Do not present §4.2 as behavior-preserving without this caveat.

### [SEVERITY: MAJOR] `readMany()`'s brand-check error is a plain `TypeError` with a specific message, not `ERR_INVALID_THIS`

- **Design claim** (§7.1 step 1): "Not a default reader → throw `ERR_INVALID_THIS`."
- **Source evidence**: RSDR:46-47 —
  `throw new TypeError("ReadableStreamDefaultReader.readMany() should not be called directly");`
  — no `.code`.
- **Observable difference** **[verified at runtime]**:
  `ReadableStreamDefaultReader.prototype.readMany.call({})` → today
  `TypeError` / `code === undefined` / message
  `"ReadableStreamDefaultReader.readMany() should not be called directly"`. The design produces
  `code === "ERR_INVALID_THIS"` with a different message on a public, documented Bun API.
- **Proposed fix**: keep the exact `TypeError` text (or explicitly call the message change out).

### [SEVERITY: MAJOR] Native adapter: the design never says WHEN `m_controller` is assigned; assigning it at materialization changes `onDrain`/`onClose` before the first pull

- **Design claim** (§2.2): the adapter holds
  `WriteBarrier<JSReadableStreamDefaultController> m_controller; // back-edge` and "replaces the
  old `WeakRef`". §2.3 never states when it is written.
- **Source evidence**: RSI:2154, 2180, 2302-2304 — `#controller` (a `WeakRef`) is set ONLY inside
  `start` (and only when a `drainValue` exists) or on the **first `#pull`**. `#onDrain`
  (RSI:2163-2168) does `this.#controller?.deref?.()` and **silently drops the chunk** when it is
  unset (native `onDrain` fired before any `read()`) or already collected; `#onClose`
  (RSI:2207-2216) likewise skips `callClose` entirely.
- **Observable difference**: a native source (start returned a numeric chunk size, `drain()`
  returned `undefined`) whose Rust side pushes a chunk via `onDrain` before JS ever calls
  `reader.read()`: today the chunk is lost / the close is a pure flag-flip; a C++ adapter whose
  `m_controller` is wired at `materializeNativeSource` time enqueues it.
- **Proposed fix**: specify the assignment point. For fidelity, assign `m_controller` exactly
  where the source does (first pull, or the drain-value start step), and keep `onDrain`/`onClose`
  tolerant of an unset back-edge. If the design intends the (arguably better) eager wiring, say so
  as a deliberate change.

---

### [SEVERITY: MINOR] §2.4's pull-result decoding restructures `closer[0]` (EOF) handling in three small but stated-as-exact ways

- **Design claim** (§2.4): "`number n`: `adjustChunkSize(n)`; if `n > 0` enqueue …; **store the
  tail** … into `m_pendingView` … **After all: if `m_closer[0]` was set to true (EOF),
  `queueMicrotask(callClose)`**."
- **Source evidence**: RSI:2274-2288 — there is no "after all" step; `isClosed` (= `closer[0]`) is
  passed INTO the handlers. `#adjustHighWaterMark` runs only `if (!isClosed)` (RSI:2276, 2282);
  `#handleNumberResult` with `isClosed` enqueues the filled prefix, schedules `callClose`, and
  **returns `undefined`** — the unfilled tail is dropped, not stored (RSI:2266-2269).
- **Observable difference**: none I could construct for a well-behaved native source (the stream
  is closing either way); but the design presents this section as an exact port and a `.cpp`
  author following it produces different `$data`/`m_pendingView` state and an extra chunk-size
  bump on the final read.
- **Proposed fix**: restate as the source has it: decode = `handleNumber/handleView(result, view,
  isClosed, controller)`; `adjustChunkSize` only when `!isClosed`; a closed result always yields
  `m_pendingView = null`.

### [SEVERITY: MINOR] `readDirectStream`'s early `close()` calls carry NO stream — they must not close the stream

- **Design claim** (§5.2 step 3): "`!pull` → `close()` and return `undefined` … Not callable →
  `close()` then `throwTypeError(…)`", where §5.2's `readDirectStreamOnClose(stream, reason)`
  "null[s] the stream's controller & reader/lock; set[s] `m_state` = … `Closed`".
- **Source evidence**: RSI:763-774 — `close` is `$readDirectStreamOnClose.bind(state)` invoked
  with **zero arguments**, so `stream` is `undefined` inside the handler and the entire
  state-mutation block (RSI:737-747) is skipped. Only `underlyingSource.cancel(undefined)` runs.
  The stream stays `Readable` (and its controller slot was never assigned).
- **Observable difference**: `assignToStream(directStreamWithNoPull, sink)` — today the stream's
  `state` stays `$streamReadable` afterwards; a port that passes the real stream to the shared
  handler transitions it to Closed.
- **Proposed fix**: §5.2 step 3 must say "invoke the onClose handler with `stream = undefined`
  (only the `underlyingSource.cancel` half runs)".

### [SEVERITY: MINOR] The `$resume(false)`-on-release gate is the OPPOSITE of what §1.2 says, and is not scoped to "the Native adapter"

- **Design claim** (§1.2): "`nativeHandleDetached()` also gates … `readableStreamReaderGenericRelease`'s
  `updateRef(false)` (RSI:1943-1945)." (§2.4): "if `stream->m_nativePtr` holds a cell (not
  detached), find the controller's **Native adapter** and call `handle.updateRef(false)`."
- **Source evidence**: RSI:1943-1945 —
  `if (stream.$bunNativePtr) { controller.$underlyingSource.$resume(false) }`. The `$bunNativePtr`
  getter returns `jsNumber(-1)` when detached/transferred, which is **truthy**, so the branch runs
  for the detached state too (opposite polarity). And it calls `$resume` on whatever the
  controller's `underlyingSource` is — including the empty/drained fast-path object literal
  (RSI:2391-2409), which has no `$resume` at all — not on "the Native adapter".
- **Observable difference**: `releaseLock()` on a reader acquired before `ReadableStream__detach`
  ran: today `handle.updateRef(false)` still fires (the event loop is unref'd); under the design
  it is skipped. (Narrow, but the design's stated gate is provably inverted.)
- **Proposed fix**: gate on "`m_nativePtr` slot is non-empty (any value, including `-1`)" AND
  "the controller's source kind is `Native`" (which is what makes the source's version never crash
  on the object-literal case in practice); drop the `nativeHandleDetached()` claim from §1.2.

### [SEVERITY: MINOR] `initializeArrayBufferStream`'s HWM predicate is `truthy && typeof === "number"`, not "a finite number"

- **Design claim** (§4.1): the ArrayBufferSink is started with `highWaterMark` "if it is a finite
  number".
- **Source evidence**: RSI:1608-1611 — `highWaterMark && typeof highWaterMark === "number"`.
  `Infinity` and negatives pass; `0`, `NaN`, and any non-number (including numeric strings) do not.
- **Observable difference**: `new ReadableStream({type:"direct", pull(c){…}}, {highWaterMark: Infinity}).getReader()`
  — today `sink.start({highWaterMark: Infinity, …})` reaches the native ArrayBufferSink; under
  "finite" it is omitted. More generally, `m_bunHighWaterMark: double` cannot represent the
  `typeof`-sensitive checks the three consumer sites apply to the raw JS value today
  (`readDirectStream`'s `!hwm || hwm < 64` even relationally compares a string).
- **Proposed fix**: state the exact predicate per consumer, and specify where/how the raw
  strategy value is coerced to the `double` (recommend: store `ToNumber` at construction and
  document the `Infinity` delta as accepted, or keep a `JSValue` slot).

---

## Not covered anywhere (angle E residue, non-exhaustive)

- `readableStreamIntoText` / `withoutUTF8BOM` (see CRITICAL #3).
- `readableStreamPipeToWritableStream`'s Bun-only rejection of byte sources
  (RSI:264-265, `Promise.$reject("Piping to a readable bytestream is not supported")` — a bare
  string reason). Not in this design nor named in ARCHITECTURE; if the spec-core pipeTo starts
  supporting byte sources that is a behavior change needing a callout.
- `readableStreamToJSON`'s `Bun.peek(text)` (RS:323) is `peek`, not `peek.status` — it cannot
  distinguish a fulfilled from a rejected `text` promise. Unreachable-in-practice today (a
  synchronously-settled `text` is always fulfilled), but §3.1 should say "peek only when
  fulfilled" so the port doesn't accidentally feed a rejection reason to `JSON.parse`.

## Verdict

The design is unusually well-grounded — most of its line citations check out, including the two
BUN-EXTENSIONS corrections it claims — but it is NOT yet faithful enough for a `.cpp` author to
reproduce current behavior: two of the four CRITICALs are empirically-confirmed value/exit-code
divergences (the flush-inside-pull ordering, the direct-pull unhandled rejection), one is a hard
coverage hole in the single most-used Bun conversion (`readableStreamToText` on an ordinary
stream), and one is a reachable-from-Rust cancel path the design explicitly declares unreachable.
Fix those four plus MAJOR #5 (sink `highWaterMark` for ordinary streams) before any code is
written; the rest are wording-level corrections.

## Design's 5 open questions

1. **`ReadableStream__isLocked` unification.** Verified: `ReadableStream::isLocked`
   (`ReadableStream.cpp:253-268`) uses the RAW `nativePtr()` (misses `transferred`) while
   `$isReadableStreamLocked` (RSI:1719-1728) uses the getter (`-1` when transferred). The
   divergence is real. **Agree with the design's default** (unify on the JS answer) — but the
   design's own hedge is right: `ReadableStream__isLocked`'s Rust callers
   (`ReadableStream.rs:265` → body-consumption guards) must be audited before freezing, since a
   `Readable.fromWeb`'d body would newly report locked to Rust.
2. **`Tag::Direct = 3`.** Verified: `ReadableStreamTag__tagged` never emits 3, and
   `ReadableStream.rs:298` maps it to `None` (`assert_ffi_discr!` at `:511` freezes the values).
   **Agree with the default**: keep frozen, never emit.
3. **`controller.sink`.** Verified: `$sink` on the direct controller is a PRIVATE-symbol property
   on a plain object (RSI:1523/1583/1619); user code sees `controller.sink === undefined` for ALL
   three flavors today. **Disagree with the design's default** ("expose `.sink` for the
   ArrayBuffer kind") — that is a net-new public property, not preservation. Recommend: no public
   `sink` at all; if a getter must exist for internal parity keep it `undefined`.
4. **Async-context scope of the spec `pull()`.** Verified: the construction snapshot is restored
   only around the direct `pull` (RSI:1170-1201) and around the JS `cancelAlgorithm`
   (RSI:129-141, installed at RSI:172-179); the spec pull/start/size get nothing. **Agree with the
   default**: preserve exactly; do not extend.
5. **The async iterator.** The switch to the spec class-14 iterator is a real behavior change the
   design under-lists: besides identity and cancel ORDER, note (a) `values` / `Symbol.asyncIterator`
   are lazily self-replacing properties today (RS:515-526) — property identity is observable;
   (b) the current `finally` cancels through the PUBLIC `stream.cancel(deferredError)` AFTER
   `releaseLock` (RSI:2624-2632), so it is a no-op on any stream something else re-locked in
   between; (c) `readMany`-batching makes `disturbed`/pull cadence differ. **Agree with the
   recommendation**, but only gated on TEST-SURFACE as the design itself says; the fallback
   (batched state on the class-14 cell) should be pre-designed, not deferred.
