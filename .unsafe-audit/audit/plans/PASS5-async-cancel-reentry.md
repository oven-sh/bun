# Pass 5: Async Cancellation Re-entry Audit

**Scope:** `src/` of oven-sh/bun (Rust port at `*.rs`; `.zig` siblings are
historical reference only and not compiled).
**Methodology:** Codex-grade — claims are tied to specific file:line evidence
in the current tree; T1 findings require a concrete reachable call path.
**Trigger:** P4-H soundness archeology surfaced three recent maintainer
commits that all sealed the same UAF class. This pass searches the rest of
the source for sites with the same shape.

---

## 1. Bug Class Extracted from Maintainer Commits

### Commit `600448f739` (2026-04-14) — `ResumableSink.cancel` re-entry

**Bug.** `FetchTasklet.abortListener()` runs sink.cancel(); HTTP-thread
completion later runs `onProgressUpdate` → reject path → sink.cancel() **a
second time** because `this.sink` is only nulled in `clearSink`←`clearData`
←`deinit`. Cancel #2's `onEnd` invokes `FetchTasklet.writeEndRequest`'s
unconditional `defer this.deref()`, double-releasing the
`startRequestStream()` ref. Ref-count math: 3 → cancel#1: 2 →
derefFromThread: 1 → cancel#2: 0 → `deinit()`/`destroy()` runs **inside**
`onProgressUpdate`. The trailing `defer this.mutex.unlock()` +
`this.deref()` at FetchTasklet.zig:471-477 then writes to freed memory.

**Root cause.** `cancel()` already short-circuited on `status == .piped`
but relied on `#js_this.tryGet()` returning null to gate the JS-route
branch. `JSRef.downgrade()` (JSRef.zig:153-160) preserves the wrapper as
`.weak = <wrapper>`, and `tryGet()` (JSRef.zig:111) returns non-null for
any non-empty weak. So the second cancel re-entered.

**Fix.** Add `if (this.status == .done) return;` at the top of `cancel()`,
so `onEnd` fires at most once.

**Class signature.** *Idempotent-by-construction-but-not-actually*:
sentinel chosen for cancel-idempotency does not survive the path that
re-enters cancel; need a coarser sentinel (here, `status == .done`).

### Commit `9bac2c2709` (2026-05-09) — h2 `setStreamPriority` / `sendTrailers` re-entry

**Bug.** `setStreamPriority` and `sendTrailers` materialize a `*Stream`
(or `&mut Stream`), then call `options.get(globalObject, "weight"/...)` /
`item.toJSString()` / `sensitive_arg.getTruthyPropertyValue()` on a
user-supplied object. Each of those invokes a JS getter / Proxy trap /
Symbol.toPrimitive. A user getter calling `AbortController.abort()` on
the stream's signal triggers `SignalRef.abortListener` **inline** →
`abortStream` → `removeStreamByID` → `bun.destroy(stream)`. Subsequent
`stream.*` reads land on freed heap.

**Fix.** Mirror the `sendData`/`flushQueue`/`handleDataFrame` pattern:
re-resolve `this.streams.get(stream_id)` after the last user-JS-eligible
call (`options.get(...)` or header-iteration loops) and bail out
returning the stream_id (or `-1`) if the stream is gone.

**Class signature.** *Mid-callback dealloc via user property accessor*:
holding a raw `*T` (or `&mut T`) across a JS callback that the user
controls; that callback can synchronously free the same `T` via an
AbortSignal or session.destroy() path.

### Commit `702defa89d` (2026-05-09) — h2 `emitErrorToAllStreams` / `emitAbortToAllStreams` / `request` re-entry

**Bug A** (mirror of b6fe0bc887): both `emit*ToAllStreams` set state =
CLOSED, then call `freeResources` while the stream is **still in
`this.streams`**. `freeResources` → `cleanQueue` synchronously dispatches
queued DATA write callbacks. A user callback that calls
`session.destroy()` reaches the `ClientHttp2Session` guard with `#parser`
still set (it's nulled only after the outer emit\*ToAllStreams returns),
re-enters emit\*ToAllStreams, whose leading `removeAllClosedStreams()`
finds this already-CLOSED-in-map stream and `bun.destroy()`s it. Returning
to the outer `freeResources` then reads `this.signal` on freed heap.

**Bug B**: `request()` is the third operation in the
options-getter family (alongside setStreamPriority / sendTrailers). For
payload methods (POST/PUT/etc.), `http2.ts` passes the user's raw
options object directly to native, so any of the
`options.get(paddingStrategy|waitForTrailers|exclusive|parent|weight|
signal)` calls can invoke a getter that calls `session.destroy()` →
`emitErrorToAllStreams` → `bun.destroy(stream)`. The AbortSignal vector
specifically doesn't apply here because `signal` is the LAST getter.

**Fix.** (A) Detach the stream from the map BEFORE `freeResources`, then
dispatch, then `destroyDetachedStream` — exposed via two new helpers
`detachStreamFromMap` / `destroyDetachedStream`. (B) Re-resolve `stream`
from the map after every `options.get(...)` in `request()`.

**Class signature.** Same as 9bac2c2709 plus: *destroy-mid-iteration when
the still-in-map entry is reachable from a re-entrant sweep*.

---

## 2. Unified Bug Class — "CANCEL Re-entry"

Two distinct mechanisms produce the same family:

| Vector | Trigger | Sync path | Freeing call |
|---|---|---|---|
| `AbortSignal.abort()` | user getter / Proxy trap fired during native code | `WebCore::AbortSignal::signalAbort()` walks listeners inline | C callback → Rust `abort_listener` → `abort_stream` |
| `session.destroy()` / `parser.emitErrorToAllStreams()` | user write-callback or getter | `clean_queue` dispatches queued write callbacks; or JS sync host-fn call | sweep marks `state = CLOSED` then `removeAllClosedStreams` runs |
| `socket.close()` (uSockets) | inline state machine for non-detached sockets | `us_socket_close` invokes user `on_close` in same stack | `handle_close(&mut self)` re-derives `&mut Self` from userdata |

Common precondition: a native function holds a **raw pointer with `&mut`
or `Unique` retag** to some object O, then calls a function that can
synchronously invoke user code; the user code reaches a path that
re-materializes a second `&mut` to the same O (or frees O, then the
outer reads it).

Two flavors:
* **CANCEL-T1**: concrete reachable path that produces aliasing `&mut`
  retags OR uses freed heap (UB observable; the maintainer fix removed
  exactly this).
* **CANCEL-T2**: same shape but no reachable producer-of-second-borrow
  (purely formal / latent UB).

---

## 3. Methodology Note: Rust Port vs Zig Bug Class

The Rust rewrite (`23427dbc12`, 2026-05-14) landed **5 days after** the
later two h2 fixes (2026-05-09) and **a month after** the
ResumableSink fix (2026-04-14). The Rust port absorbed the
ResumableSink fix (verified — see § 5). It **did not** absorb the two
h2 fixes. This pass found:

1. The h2 fixes are missing from the Rust port.
2. The destroy-mid-iteration vector partially disarms itself in Rust
   because the Rust port has **no `removeStreamByID` / `bun.destroy(stream)`
   path** — streams are removed only at `deinit()` (line 7559). The
   observable UAF symptom of the Zig commits cannot trigger; but the
   borrow-stack UB they fixed (aliasing `&mut`) remains.
3. The same options-getter pattern in `set_stream_priority`,
   `send_trailers`, `request` produces aliasing `&mut Stream` via the
   AbortSignal vector — which the Rust port DOES propagate
   synchronously (`abort_listener` → `abort_stream` mutates the stream).

---

## 4. Findings

Each finding cites file:line in the Rust port (not the legacy `.zig`).

### Finding 1 — `H2FrameParser::set_stream_priority` — **CANCEL-T1**

**File.** `src/runtime/api/bun/h2_frame_parser.rs:5387`

**Shape.**
```rust
let Some(stream_ptr) = this.streams.get().get(&stream_id).copied() else { ... };
// SAFETY: stream_ptr is a *mut Stream stored in self.streams ...
let stream = unsafe { &mut *stream_ptr };               // (a) outer &mut Stream retag
if !stream.can_send_data() && !stream.can_receive_data() { return Ok(JSValue::FALSE); }
if !options.is_object() { return Err(...); }
let mut weight = stream.weight;
let mut exclusive = stream.exclusive;
let mut parent_id = stream.stream_dependency;
let mut silent = false;
if let Some(js_weight) = options.get(global_object, "weight")? {  // (b) user JS getter
    ...
}
if let Some(js_parent) = options.get(global_object, "parent")? { ... }
if let Some(js_exclusive) = options.get(global_object, "exclusive")? { ... }
if let Some(js_silent) = options.get(global_object, "silent")? { ... }
if parent_id == stream.id { ... }                       // (c) read through outer
stream.stream_dependency = parent_id;                   // (d) write through outer
stream.exclusive = exclusive;
stream.weight = weight;
```

**T1 proof path.**
1. User JS: `parser.setStreamPriority(streamId, { weight: { get() { ac.abort(); return 100 } } })`
   where `ac.signal` was previously attached to the stream via `request({ signal: ac.signal })`.
2. Native enters `set_stream_priority` (line 5387). Materializes outer
   `&mut Stream` at (a) (line 5412).
3. `options.get(global_object, "weight")?` at (b) (line 5426) invokes the
   getter.
4. The getter calls `ac.abort()`. WebKit's `AbortSignal::signalAbort()`
   walks registered listeners **inline** in the same stack frame.
5. The Rust C-trampoline at `src/jsc/AbortSignal.rs:86` is invoked,
   reaches `SignalRef::abort_listener` at
   `src/runtime/api/bun/h2_frame_parser.rs:1479`.
6. abort_listener materializes the **inner `&mut Stream`** at line 1491:
   `let stream = unsafe { &mut *stream };` — same `*mut Stream` as the
   outer at (a) when this is the stream the user passed to
   setStreamPriority.
7. `parser.abort_stream(stream, wrapped)` at line 1494 writes
   `stream.state = StreamState::CLOSED`, `stream.rst_code = ...`,
   `stream.free_resources::<false>(self)` (sets `stream.signal = None`).
8. abort_listener returns; control returns through the getter through
   options.get back to `set_stream_priority` at line 5426.
9. Lines 5461 (read `stream.id`), 5472-5474 (write
   `stream.stream_dependency`, `stream.exclusive`, `stream.weight`)
   execute through the **outer** `&mut Stream` retag.

**UB classification.** Aliasing `&mut` retags to the same allocation. The
inner retag (step 6) invalidates the outer retag's `Unique` permission
under Tree Borrows / Stacked Borrows. The writes at step 9 are therefore
UB. Observable consequence: weight/exclusive/parent are written into a
stream the abort path just marked CLOSED with freed signal; the peer
already received nothing because `set_stream_priority` had not yet
issued the priority frame, but the local state is inconsistent (CLOSED
state + user-supplied priority fields + null signal).

**Why the Zig sibling has the fix and the Rust port does not.** Commit
9bac2c2709 added a `stream = this.streams.get(stream_id) orelse return
.false;` re-resolve immediately AFTER the options block in
`setStreamPriority`, plus before `parent_id == stream.id`. The Rust port
was branched before that fix landed and was never updated.

**Suggested remediation.** Either
(i) re-resolve `stream` from `this.streams.get()` after each
`options.get(...)` and after the options block (matching the Zig fix), or
(ii) restructure to keep the `&mut Stream` borrow narrow: read
weight/parent/exclusive/silent into locals BEFORE materializing
`&mut Stream`, then re-resolve and apply writes in a single
`&mut`-narrow scope. (ii) is preferred for borrow-stack hygiene.

---

### Finding 2 — `H2FrameParser::send_trailers` — **CANCEL-T1**

**File.** `src/runtime/api/bun/h2_frame_parser.rs:5826`

**Shape.**
```rust
let Some(stream_ptr) = this.streams.get().get(&stream_id).copied() else { ... };
let stream = unsafe { &mut *stream_ptr };               // (a) outer &mut Stream retag
let mut iter = bun_jsc::JSPropertyIterator::init(global_object, headers_obj, ...);
let mut single_value_headers = ...;
while let Some(header_name) = iter.next()? {            // (b) iter.next can fire Proxy/getter
    ...
    let value_str = match item.to_js_string(global_object) { ... };  // (c) Symbol.toPrimitive
    let never_index = match sensitive_arg.get_truthy(global_object, validated_name)? {
                          Some(_) => true,
                          None => sensitive_arg.get_truthy(global_object, name)?.is_some()
                      };                                // (d) getTruthy → property accessor
    ...
}
// After loop:
if encoded_size <= actual_max_frame_size {
    let mut frame = FrameHeader { ..., stream_identifier: stream.id, ... };  // (e)
    ...
}
let identifier = stream.get_identifier();               // (f)
if stream.state == StreamState::HALF_CLOSED_REMOTE {     // (g)
    stream.state = StreamState::CLOSED;                  // (h)
    stream.free_resources::<false>(this);                // (i)
} else { stream.state = StreamState::HALF_CLOSED_LOCAL; }
this.dispatch_with_extra(JSH2FrameParser::Gc::onStreamEnd, identifier, ...);
```

**T1 proof path.**
1. User JS: send trailers with a value that has `Symbol.toPrimitive` or
   stash a Proxy as one of the header values; on the toPrimitive call,
   call `ac.abort()` on the stream's previously attached AbortSignal.
2. Native enters `send_trailers` (line 5826). Materializes outer
   `&mut Stream` at (a) (line 5855).
3. The header iteration loop at (b) (line 5888) → (c)
   `item.to_js_string(global_object)` at line 6001 → invokes the user's
   `Symbol.toPrimitive` getter inline.
4. Getter calls `ac.abort()`. Same chain as Finding 1, steps 4-7. Inner
   `&mut Stream` retag aliases outer.
5. Loop continues; or loop exits and code reaches (e)-(i), reading and
   writing `stream.*` through the now-invalidated outer borrow.

**UB classification.** Aliasing `&mut` retags. Observable consequence:
trailer frame is written to a stream marked CLOSED with freed signal;
the trailing `stream.state = ...` and `stream.free_resources(this)` at
(h)/(i) overwrite the abort_stream-set state and double-call
`free_resources` (which IS idempotent — `signal.take()` is a no-op the
second time, `clean_queue` walks an empty queue — so no double-free of
heap, but the borrow-stack UB stands).

The `sensitive_arg.get_truthy(...)` at (d) is a second vector for the
same UB (property access on a user-controlled object).

**Suggested remediation.** Same as Finding 1: re-resolve before stream.*
access, or narrow the borrow to read-only locals before invoking JS.

---

### Finding 3 — `H2FrameParser::request` (options block) — **CANCEL-T1**

**File.** `src/runtime/api/bun/h2_frame_parser.rs:6478`

**Shape (excerpted).**
```rust
let Some(stream_ptr) = this.handle_received_stream_id(stream_id) else { ... };
let stream = unsafe { &mut *stream_ptr };               // (a) outer &mut Stream retag
...
if args_list.len > 4 && !args_list.ptr[4].is_empty_or_undefined_or_null() {
    let options = args_list.ptr[4];
    if !options.is_object() {
        stream.state = StreamState::CLOSED;             // (b) write through outer
        stream.rst_code = ErrorCode::INTERNAL_ERROR.0;
        this.dispatch_with_extra(JSH2FrameParser::Gc::onStreamError, ..., ...);
        return Ok(JSValue::js_number(stream_id as f64));
    }
    if let Some(padding_js) = options.get(global_object, "paddingStrategy")? {  // (c) user getter
        if padding_js.is_number() { stream.padding_strategy = ...; }            // (d) write
    }
    if let Some(trailes_js) = options.get(global_object, "waitForTrailers")? {  // (c)
        if trailes_js.is_boolean() {
            wait_for_trailers = trailes_js.as_boolean();
            stream.wait_for_trailers = wait_for_trailers;                       // (d)
        }
    }
    ... // (silent, endStream, exclusive, parent, weight) — each repeats the pattern
    if let Some(signal_arg) = options.get(global_object, "signal")? {           // last getter
        if let Some(signal_ptr) = AbortSignal::from_js(signal_arg) {
            let signal_ = unsafe { &mut *signal_ptr };
            if signal_.aborted() {
                stream.state = StreamState::IDLE;
                let wrapped = Bun__wrapAbortError(global_object, signal_.abort_reason());
                this.abort_stream(stream, wrapped);                             // (e)
                return Ok(JSValue::js_number(stream_id as f64));
            }
            stream.attach_signal(this, signal_);                                // (f)
        } else { return Err(...); }
    }
}
// too much memory being use
if this.get_session_memory_usage() > this.max_session_memory.get() as usize {
    stream.state = StreamState::CLOSED;                  // (g)
    ...
}
```

**T1 proof path.**
* **AbortSignal vector:** unlike the Zig commit's note, this DOES apply
  to the Rust port if the user has a *previously created* AbortController
  whose signal was attached to a different stream in the same session.
  Getter on `options.padding_strategy` calls `ac.abort()` on a signal
  attached to ANOTHER stream X in this same session → abort_listener
  → abort_stream(X). X is a different `*mut Stream` than the current
  one, so no aliasing on this stream — **but** the outer borrow on the
  CURRENT stream is still live across re-entry. If the user's
  abort-listener callback then calls a host_fn on this current stream
  (`session.write(currentStreamId, ...)` or another option-getter
  family method on the same stream), we get aliasing `&mut Stream`. The
  proof is constructible but requires a chain of two abort
  reflections — graded T1-borderline, T2 conservative.

* **session.destroy() vector:** any of the options.get calls' user
  getters can call `parser.emitErrorToAllStreams(NGHTTP2_NO_ERROR)` (from
  inside an `addEventListener("error", () => session.destroy())` style
  handler, where the getter triggers a chain that reaches `session.destroy`).
  `parser.emit_error_to_all_streams` (line 6435) iterates **including
  the current stream**, materializes a fresh `&mut Stream` to it at
  line 6451, writes `stream.state = StreamState::CLOSED`,
  `stream.rst_code = ...`, calls `stream.free_resources::<false>(this)`.
  Returns to options.get, returns to `request`'s next line (d) which
  writes `stream.padding_strategy = ...` through the **outer** retag.

**UB classification.** Aliasing `&mut Stream` retags on the same
allocation. Observable consequence: the partially-CLOSED stream is
further mutated (priority/weight/signal-attach), then `request` falls
through to write its HEADERS frame for a CLOSED stream — peer
protocol violation. The `attach_signal(this, signal_)` at (f) attaches
to a stream whose signal slot was just freed by emit_error_to_all_streams;
attach_signal will install a new SignalRef pointer over the dropped
slot, which is allocator-soundness-OK (it's a fresh `BackRef`), but
correctness-wise the stream's `state` was just reset to IDLE then
CLOSED then this code returns the stream_id as if all is well.

**Same fix.** Commit `702defa89d` ports verbatim — re-resolve `stream`
from `this.streams.get(stream_id)` after each `options.get(...)` and
after the options block, bail returning stream_id if the stream is gone.

**Note on the in-Rust safety.** Because the Rust port has no
`removeStreamByID`, the `*mut Stream` is **never freed mid-execution**
— so this is "borrow-stack UB without memory-safety UAF" rather than
"freed-heap UAF". The downgrade from Zig-T1-UAF to Rust-T1-borrow-UB
is real, but T1 it remains.

---

### Finding 4 — `H2FrameParser::emit_abort_to_all_streams` — **CANCEL-T2**

**File.** `src/runtime/api/bun/h2_frame_parser.rs:6396`

**Shape.**
```rust
let mut it = StreamResumableIterator::init(this);
while let Some(stream_ptr) = it.next() {
    let stream = unsafe { &mut *stream_ptr };           // (a) outer per-iter &mut
    ...
    if stream.state != StreamState::CLOSED {
        let old_state = stream.state;
        stream.state = StreamState::CLOSED;             // (b) write
        stream.rst_code = ErrorCode::CANCEL.0;
        let identifier = stream.get_identifier();       // (c) read, value copied
        identifier.ensure_still_alive();
        stream.free_resources::<false>(this);           // (d) → clean_queue → user JS callbacks
        this.dispatch_with_2_extra(JSH2FrameParser::Gc::onAborted, identifier, ..., ...);
    }
}
```

**Analysis.** `stream.free_resources::<false>(this)` at (d) calls
`clean_queue::<false>` (line 2078) which dispatches each queued DATA
frame's write callback to JS via `client.dispatch_write_callback`
(line 2097). A user write callback CAN synchronously call
`session.destroy()` → which calls `parser.emitErrorToAllStreams(code)`
on JS side → which lands in `emit_error_to_all_streams` (line 6435)
re-entrantly. That re-entrant sweep visits the same `stream_ptr` and
materializes a second `&mut Stream` at line 6451.

**Why T2 not T1.** The inner re-entry's `if stream.state != StreamState::CLOSED`
guard at line 6452 will see the state set to CLOSED at (b) by the outer
and skip the body. So no second `free_resources` or state-mutation —
the inner just iterates and returns. The outer then resumes at the
`dispatch_with_2_extra(...)` line. The aliasing `&mut Stream` retag
exists at line 6451 (inner) while the outer (line 6407) is still in
scope, which is borrow-stack UB; but **no observable misbehavior** —
the inner reads `state` (fine through aliased `&mut`), the outer reads
nothing further from `stream` after free_resources returns.

This is the exact scenario the Zig fix prevented (commit 702defa89d), but
the observable UAF symptom is gated by the Rust port not having
`removeAllClosedStreams` / `bun.destroy(stream)`. T2 only because the
borrow-stack UB is latent.

**Suggested remediation.** Apply commit 702defa89d's pattern — detach
the stream from `self.streams` BEFORE `free_resources`, dispatch the
callbacks, then destroy. This eliminates both the UB and prevents the
inner sweep from finding the stream. Even without an explicit
`bun.destroy`, the pattern is worth porting for borrow-stack hygiene.

---

### Finding 5 — `H2FrameParser::emit_error_to_all_streams` — **CANCEL-T2**

**File.** `src/runtime/api/bun/h2_frame_parser.rs:6435`

Identical analysis to Finding 4, mirror function. Same borrow-stack UB
without observable symptom; same remediation. T2.

---

### Finding 6 — `H2FrameParser::send_data` defer-block — **CANCEL-T2**

**File.** `src/runtime/api/bun/h2_frame_parser.rs:5561`

**Shape (final block, line 5702-5724).**
```rust
if !enqueued {
    self.dispatch_write_callback(callback);            // user JS write callback
    if close {
        if stream.wait_for_trailers { ... }
        else {
            let identifier = stream.get_identifier();
            identifier.ensure_still_alive();
            if stream.state == StreamState::HALF_CLOSED_REMOTE {
                stream.state = StreamState::CLOSED;
                stream.free_resources::<false>(self);
            } else { stream.state = StreamState::HALF_CLOSED_LOCAL; }
            self.dispatch_with_extra(JSH2FrameParser::Gc::onStreamEnd, identifier, ...);
        }
    }
}
self.deref();
```

**Analysis.** `send_data` takes `stream: &mut Stream` as a parameter
(line 5561). After `self.dispatch_write_callback(callback)` (user JS,
which can call `session.destroy()` → `emit_error_to_all_streams`),
`stream.state`, `stream.get_identifier()`, etc. are read/written.

The user callback can reach `emit_error_to_all_streams` which
materializes a second `&mut Stream` aliasing send_data's parameter.
Same borrow-stack UB shape as Findings 4/5.

**Why T2.** Just like the emit*ToAllStreams findings, the lack of
mid-execution destroy in the Rust port keeps the memory live. The
field reads after dispatch are a single `stream.wait_for_trailers` and
`stream.state` check followed by a state write — the inner re-entry's
`emit_error_to_all_streams` may have already set state to CLOSED, so
the outer's `stream.state == HALF_CLOSED_REMOTE` branch becomes false
and it falls into `stream.state = HALF_CLOSED_LOCAL` overwriting CLOSED
back to HALF_CLOSED_LOCAL. **This is observable**: the stream is left
in an inconsistent state vs the queue-of-pending-frames.

Borderline T1/T2; classifying T2 only because the inconsistency does
not directly UAF or escape Bun's process boundary, and a downstream
consumer would treat it as a HALF_CLOSED_LOCAL stream with no pending
frames (silent inconsistency, no panic).

**Suggested remediation.** Re-resolve `stream` from
`self.streams.get(stream_id)` after `dispatch_write_callback`; bail if
gone (matches sendData fix Zig already did).

---

### Finding 7 — `H2FrameParser::request` header-encode error path — **CANCEL-T2**

**File.** `src/runtime/api/bun/h2_frame_parser.rs:6677`

**Shape.** Inside the header iteration loop at line 6539, when
`encode_header_into_list` fails with a non-OOM error (line 6668), the
code calls `this.handle_received_stream_id(stream_id)` (line 6673) to
re-resolve the stream:

```rust
let Some(stream) = this.handle_received_stream_id(stream_id) else {
    return Ok(JSValue::js_number(-1.0));
};
let stream = unsafe { &mut *stream };
stream.state = StreamState::CLOSED;
...
```

**Analysis.** This branch *does* re-resolve — good. But the
header-iteration loop ABOVE this (lines 6539-6770) calls
`item.to_js_string(global_object)` (line 6632) and
`sensitive_arg.get_truthy(global_object, ...)` (line 6649, 6651, 6058,
6060) — both of which can invoke user JS. **No re-resolve is performed
in the happy path** before the post-loop `handle_received_stream_id`
at line 6773. The post-loop re-resolve at line 6773 IS present (gives
fresh `stream_ptr`), so the post-loop body is safe.

**Why T2 (not negative).** Within the loop body, the user-controlled
JS calls cannot reach the current stream's `&mut Stream` retag because
the loop body doesn't materialize one — it only uses `stream_id` and
operates on `encoded_headers`. So this loop is **actually safe**.
Demote to **negative** finding.

**Verdict.** Negative. The header loop is structured to take
`&mut Stream` only inside the error branch, which re-resolves.

---

### Finding 8 — `websocket_client::WebSocketClient::cancel` — **CANCEL-T1**

**File.** `src/http_jsc/websocket_client.rs:223`

**Shape.**
```rust
pub extern "C" fn cancel(this_ptr: *mut Self) {
    let _guard = unsafe { bun_ptr::ScopedRef::new(this_ptr) };
    let this = unsafe { &mut *this_ptr };               // (a) outer &mut Self
    let had_tunnel = this.proxy_tunnel.is_some();
    this.clear_data();
    if SSL { this.tcp.close(uws::CloseKind::Normal); }  // (b) sync invokes handle_close
    else   { this.tcp.close(uws::CloseKind::Failure); }
    if had_tunnel { this.dispatch_abrupt_close(ErrorCode::Ended); }
}
```

**T1 proof path.**
1. `this.tcp.close(...)` (line 240/242) → `us_socket_close` synchronously
   dispatches `handle_close` from the socket's userdata callback in the
   same stack frame for failed/abrupt closes (uSockets semantics for
   non-detached sockets).
2. uSockets vtable resolves to `handle_close(&mut self, ...)` at
   `src/http_jsc/websocket_client.rs:329`, which materializes a
   **second `&mut Self`** from the same userdata pointer (same
   allocation as `this_ptr`).
3. `handle_close` calls `self.clear_data()` (line 332),
   `self.tcp.detach()` (line 333), `self.dispatch_abrupt_close(...)`
   (line 335), `Self::deref(self)` (line 340) — all writes through
   the inner `&mut Self`.
4. handle_close returns; control returns to `cancel`'s line 252-253:
   `if had_tunnel { this.dispatch_abrupt_close(ErrorCode::Ended); }`
   uses the outer `&mut Self` retag.

**UB classification.** Aliasing `&mut Self` retags. Observable
consequence: `dispatch_abrupt_close` runs **twice** (once from
handle_close, once from cancel's tunnel branch) — the C++ event
dispatch is idempotent only by accident; in any case the borrow-stack
UB is concrete.

**Why this is T1 vs the WebSocketUpgradeClient sibling being a
negative.** `WebSocketUpgradeClient::cancel` at
`src/http_jsc/websocket_client/WebSocketUpgradeClient.rs:605` is the
**explicit fix** for this exact bug, with extensive comments:
> "`tcp.close()` synchronously dispatches `handle_close` from the
> socket userdata pointer, which would alias a `&mut self` argument"

It takes `*mut Self`, uses `ThisPtr` to avoid materializing `&mut Self`,
and reads `this.tcp` out as a copy before close. **This pattern was not
applied to the sibling at websocket_client.rs:223.**

**Suggested remediation.** Port the WebSocketUpgradeClient::cancel
pattern: take `*mut Self`, use `ThisPtr`, copy `tcp` out before the
close, no `&mut self` across the close.

---

### Finding 9 — `FetchTasklet::abort_listener` ↔ `ResumableSink::cancel` — **CANCEL-T2**

**File.** `src/runtime/webcore/fetch/FetchTasklet.rs:1818`

**Shape.**
```rust
pub fn abort_listener(&mut self, reason: JSValue) {     // (a) outer &mut self
    let this = self;
    reason.ensure_still_alive();
    this.abort_reason.set(&this.global_this, reason);
    this.abort_task();
    if let Some(sink) = this.sink_mut() {
        sink.cancel(reason);                            // (b) ResumableSink::cancel
        return;
    }
    ...
}
```

**Analysis.** `sink.cancel(reason)` (`ResumableSink.rs:407`) calls
`Self::on_end(self.context, Some(reason))` at line 431. `on_end`
(`ResumableSink.rs:138`) does
`unsafe { (*ctx).write_request_data(bytes) }` — for FetchTasklet, this
materializes `&mut FetchTasklet` from `self.context` (the same heap
allocation as `&mut self` in `abort_listener`).

**Why T2 not T1.** The Rust port's `ResumableSink::cancel` (line 407)
now has the `if self.status == Status::Done { return; }` guard at
line 411 (port of 600448f739). The first cancel sets `self.status =
Status::Done` at line 420 and calls `on_end` only ONCE per cancel.
Inside on_end → `write_end_request` runs `FetchTasklet::deref(this_ptr)`
once. The aliasing inner-`&mut FetchTasklet` is short-lived (one
`write_end_request` call), and is technically aliased with the outer
abort_listener's `&mut self` — but the outer doesn't access `self`
after `sink.cancel(reason)` returns (the `return;` at line 1826 exits).
So the borrow-stack UB has **zero observable window**. T2 only because
the aliasing during `write_end_request`'s body coexists with the
outer's frame; in practice both write through `&mut`, and write_end_request
returns before abort_listener does. NLL deems it safe; SB deems it UB.

**Verdict.** T2 / latent. The maintainers' fix (600448f739) eliminated
the observable double-cancel; the borrow-stack aliasing during the
single cancel remains, but neither writer touches the same field
through both borrows.

---

### Finding 10 — `ReadableStreamSource::cancel` — **NEGATIVE**

**File.** `src/runtime/webcore/ReadableStream.rs:874`

```rust
pub fn cancel(&mut self) {
    if self.cancelled { return; }                       // idempotency guard
    self.cancelled = true;
    self.context.on_cancel();                           // user callback
    if let Some(handler) = self.cancel_handler.take() {
        handler(self.cancel_ctx.get());
    }
}
```

`on_cancel` and `handler` may re-enter. The idempotency guard at line
875 prevents recursive cancel from doing work; `cancel_handler.take()`
prevents the handler from running twice. The `self.cancelled = true`
write happens before any user callback, so a re-entrant cancel
short-circuits.

**Borrow-stack:** `self.context.on_cancel()` and `handler(...)` could
synchronously re-enter `cancel(&mut self)` via this same allocation,
creating aliasing `&mut Self`. But the only access after them is
`self.cancel_handler.take()` (line 880) which is a `Cell::take` —
interior mutable, sound under aliased `&Self` or even after a `&mut`
expires. And after the inner cancel returns having short-circuited,
the outer continues. NLL-wise the borrows are well-scoped; SB-wise
this is a soft borrow-stack issue similar to Finding 9.

Considering the explicit idempotency guard and the limited
post-callback work, **negative**.

---

### Finding 11 — `NetworkSink::abort` — **NEGATIVE**

**File.** `src/runtime/webcore/streams.rs:2276`

```rust
pub fn abort(&mut self) {
    self.ended = true;
    self.done = true;
    self.signal.close(None);                            // vtable dispatch
    self.cancel = true;
    self.finalize();
}
```

`self.signal.close(None)` invokes a vtable function on a signal handler
that the NetworkSink's owner registered. For S3UploadStreamWrapper
(the only concrete NetworkSink<Context>), the handler is the
ReadableStreamSource which receives the close. That handler operates
on a different allocation than `self` (a separate Box). So no
aliasing on this NetworkSink. **Negative.**

`self.finalize()` is a `&mut self` call; takes ownership of internal
state through Drop. Safe.

---

### Finding 12 — `HTTPServerWritable::abort` — **NEGATIVE**

**File.** `src/runtime/webcore/streams.rs:1864`

```rust
pub fn abort(&mut self) {
    self.done = true;
    self.res = None;
    self.unregister_auto_flusher();
    self.aborted = true;
    self.signal.close(None);
    let _ = self.flush_promise();
    self.finalize();
}
```

Same shape as Finding 11; signal handler is on a separate allocation.
`flush_promise()` resolves a stored JSPromiseStrong which queues a JS
microtask but does not invoke user JS synchronously. **Negative.**

---

### Finding 13 — `H3ClientStream::abort` — **CANCEL-T2**

**File.** `src/http/h3_client/Stream.rs:93`

```rust
pub fn abort(&mut self) {
    if let Some(qs) = self.qstream_mut() {
        qs.close();
    }
}
```

`qs.close()` is lsquic's `lsquic_stream_close`. lsquic synchronously
walks the stream's close handlers, which can reach back into Bun's
h3 client callback layer. Whether those callbacks re-materialize
`&mut Stream` for the same `*mut Stream` is non-trivial to trace
without deep h3 callback knowledge. Demote to **T2** without a concrete
proof path; flag for follow-up.

---

### Finding 14 — `Timeout::cancel` / `WTFTimer::cancel` / `TimerObjectInternals::cancel` — **NEGATIVE**

**Files.**
- `src/jsc/AbortSignal.rs:350` (Timeout::cancel — `&mut Timeout`,
  pure heap-node unlink, no callbacks)
- `src/runtime/timer/WTFTimer.rs:194` (`pub unsafe fn cancel(this: *mut Self)` —
  explicitly takes `*mut Self`, uses `ThisPtr`, comments document
  re-entry shape; CANONICAL SAFE PATTERN)
- `src/runtime/timer/timer_object_internals.rs:1000` (`fn cancel(&self,
  vm: *mut VirtualMachine)` — `&self` not `&mut self`; `self.deref()`
  in trailing position, no UB risk under SB for `&self`)

All three are safe. WTFTimer is the canonical pattern.

---

### Finding 15 — `NodeHTTPResponse::abort` — **NEGATIVE**

**File.** `src/runtime/server/NodeHTTPResponse.rs:1159`

Takes `&self`. Has `if self.is_done()` idempotency guard at line 1160.
`raw_response.end_without_body(true)` at line 1177 may dispatch the
HTTP response end callback, but `&self` is non-aliasing under SB,
and the trailing `on_request_complete()` is the only post-call use.
**Negative.**

---

### Finding 16 — `FSWatcher::on_abort` / `emit_abort` — **NEGATIVE**

**File.** `src/runtime/node/node_fs_watcher.rs:716, 790`

`emit_abort` takes `&self` and uses `Cell` for the `closed` flag. The
trait sig `on_abort(&mut self, reason)` exists at line 719 only to
satisfy `AbortListener`; the body reborrows as `&self` and calls
`emit_abort`. Comments at lines 783-789 explicitly document:
> "If the listener re-enters JS, which can call `watcher.close()` on
> this same object via the wrapper's `m_ptr` — setting `closed = true`
> and `detach()`-ing. `Cell::get()` after the callback observes that
> write because `UnsafeCell` suppresses `noalias` on `&Self`; the
> trailing `self.close()` then no-ops as in Zig."

**Negative.** Canonical safe pattern for re-entrant abort.

---

### Finding 17 — `DevServer::DeferredRequest::abort` — **NEGATIVE**

**File.** `src/runtime/bake/DevServer.rs:3047`

`saved.ctx.set_signal_aborted(...)` may fire JS abort listeners on the
ServerRequestContext's signal. Those listeners are user-controlled JS;
they could in theory reach this DeferredRequest, but DeferredRequest
is fully internal to DevServer with no JS-exposed surface. No path
from JS back to `&mut DeferredRequest`. **Negative.**

---

### Finding 18 — `Resolver::cancel` (DNS / c-ares) — **NEGATIVE**

**File.** `src/runtime/dns_jsc/dns.rs:5839`

```rust
pub fn cancel(&self, global_this: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    let channel = self.get_channel_or_error(global_this)?;
    c_ares::ares_cancel(unsafe { &mut *channel });
    Ok(JSValue::UNDEFINED)
}
```

`ares_cancel` synchronously fires all pending callbacks with
`ARES_ECANCELLED`. Each callback dispatches a JSC promise rejection.
But this Resolver's `cancel` takes `&self`; pending query state lives
inside the c-ares channel which is exclusive to this Resolver's
channel handle. The `&mut *channel` re-borrow is fine — c-ares state
is exclusive to this caller during the call. **Negative.**

---

### Finding 19 — `Subprocess::kill` — **NEGATIVE**

**File.** `src/runtime/api/bun/subprocess.rs:702`

Sends a Unix signal via `Process::kill(sig)`. No synchronous user
callbacks. `&self`. **Negative.**

---

### Finding 20 — `filter_run::FilterRun::abort` / `multi_run::MultiRun::abort` — **NEGATIVE**

**Files.**
- `src/runtime/cli/filter_run.rs:590`
- `src/runtime/cli/multi_run.rs:500`

Both iterate handles and call `proc.kill(SIGINT)`. Signal sending is
async at the OS level. **Negative.**

---

### Finding 21 — `ManagedTask::cancel` — **NEGATIVE**

**File.** `src/event_loop/ManagedTask.rs:36`

Replaces the callback with `noop`. No user code invoked. **Negative.**

---

### Finding 22 — `NapiAsyncWork::cancel` — **NEGATIVE**

**File.** `src/runtime/napi/napi_body.rs:1919`

Atomic CAS only. **Negative.**

---

### Finding 23 — `PendingConnect::cancel` (QUIC) — **NEGATIVE**

**File.** `src/uws_sys/quic/PendingConnect.rs:35`

Trivial FFI wrapper around `us_quic_pending_connect_cancel`. The C
side is responsible for not re-entering Rust synchronously during
cancel. **Negative.**

---

### Finding 24 — `LibUVReq::cancel` — **NEGATIVE**

**File.** `src/libuv_sys/libuv.rs:836`

`uv_cancel` is the libuv request cancellation primitive; the callback
(if any) is delivered later via the libuv event loop, not
synchronously. **Negative.**

---

### Finding 25 — `WebSocketUpgradeClient::cancel` — **NEGATIVE (canonical safe pattern)**

**File.** `src/http_jsc/websocket_client/WebSocketUpgradeClient.rs:605`

```rust
pub unsafe fn cancel(this: *mut Self) {
    let this = unsafe { ThisPtr::new(this) };
    unsafe { (*this.as_ptr()).clear_data() };
    let _guard = this.ref_guard();
    if unsafe { (*this.as_ptr()).outgoing_websocket.take().is_some() } {
        unsafe { Self::deref(this.as_ptr()) };
    }
    let tcp = this.tcp;
    if SSL { tcp.close(uws::CloseCode::Normal); }
    else   { tcp.close(uws::CloseCode::Failure); }
}
```

**The canonical pattern.** Takes `*mut Self`, uses `ThisPtr` (per-Deref
fresh `&self`), copies `tcp` out by value, ref_guard for liveness across
the close. No `&mut Self` materialized across the close. This is the
shape `websocket_client.rs:223` should mirror (see Finding 8).

---

### Finding 26 — `H2FrameParser::sendData`, `H2FrameParser::flushQueue`, `H2FrameParser::handleDataFrame` (Zig already had pattern) — **WORTHY OF EXPLICIT PORT**

The Zig commit 9bac2c2709's "Fix mirrors the
sendData/flushQueue/handleDataFrame pattern" reference indicates these
functions in Zig were already structured to re-resolve `stream` after
user JS calls. The Rust port's analog (`send_data` line 5561,
`handle_data_frame` line 4421-ish, flush_queue) should be audited for
the same re-resolve pattern.

`send_data` (line 5561) takes `stream: &mut Stream` as a parameter
*from the caller*. The caller (e.g., `write_stream` at line 6160) has
already materialized `&mut Stream` from a `*mut Stream` it got from
`self.streams.get()`. The user JS write callback dispatched at
`dispatch_write_callback` (line 5704) can reach
`emit_error_to_all_streams` re-entrantly — see Finding 6.

Remediation: `send_data` should accept `stream_id: u32` and re-resolve
the stream pointer internally before each `stream.*` access that
spans `dispatch_write_callback`. Same applies to whatever the Rust
port's analog of `flushQueue` / `handleDataFrame` is.

---

## 5. Audit of Already-Fixed Sites in the Rust Port

### `ResumableSink::cancel` — FIXED in Rust port

**File.** `src/runtime/webcore/ResumableSink.rs:407`

```rust
pub fn cancel(&mut self, reason: JSValue) {
    // onEnd must fire at most once. After the first cancel(), js_this is downgraded
    // to .weak (which still resolves via tryGet), so this guard is the only thing
    // preventing a second cancel() from re-invoking onEnd.
    if self.status == Status::Done { return; }
    ...
}
```

Matches Zig commit 600448f739 verbatim. **Verified absorbed.**

### h2 `setStreamPriority` / `sendTrailers` / `request` re-resolve — NOT FIXED in Rust port

Commits 9bac2c2709 and 702defa89d landed 2026-05-09; Rust port merged
2026-05-14 from a branch developed before the fixes. **Findings 1-7
report the gap.**

---

## 6. Pattern Catalog — Safe Async-Cancel Re-entry Shape

What the maintainers got RIGHT, distilled from the codebase:

### Pattern A: `*mut Self` + `ThisPtr` for cancellation FFI callbacks

```rust
pub unsafe fn cancel(this: *mut Self) {
    let this = unsafe { ThisPtr::new(this) };
    // Each `*this` deref produces a fresh, short-lived `&Self`.
    let _guard = this.ref_guard();   // keep allocation alive across re-entry
    let copied = this.field;          // copy out anything you'll use post-callback
    callback_that_may_reenter(copied);
    // No `&mut Self` ever materialized; no aliasing retag possible.
}
```

**Used by:** `WebSocketUpgradeClient::cancel`, `WTFTimer::cancel`.

### Pattern B: `&self` + interior mutability + idempotency flag

```rust
pub fn emit_abort(&self, err: JSValue) {
    if self.closed.get() { return; }                    // Cell-backed flag
    self.pending_activity_count.fetch_add(1, ...);
    // ... user callback ...
    // re-entrant emit_abort sees closed and returns
}
```

**Used by:** `FSWatcher::emit_abort` (and explicit comment documents
the re-entry).

### Pattern C: Coarse idempotency sentinel + early return at function head

```rust
pub fn cancel(&mut self, reason: JSValue) {
    if self.status == Status::Done { return; }
    // ... actual work that sets status to Done ...
}
```

**Used by:** `ResumableSink::cancel` (post-fix). Critically: the
sentinel chosen must survive every state transition the re-entry
might cause. The original Zig bug used `tryGet()` returning null as
the sentinel, which didn't survive `JSRef.downgrade()`. The fix uses
`status == .done` which is set unconditionally before any callback.

### Pattern D: Re-resolve from authoritative map after every user JS call

```rust
let Some(stream) = this.streams.get().get(&stream_id).copied() else { return; };
// ... operate on stream until a user-JS call ...
let value = options.get(global, "key")?;
let Some(stream) = this.streams.get().get(&stream_id).copied() else { return; };
// ... operate on freshly-resolved stream ...
```

**Used by:** Zig h2 `sendData`, `flushQueue`, `handleDataFrame`. The
fix in 9bac2c2709 and 702defa89d extended this pattern to
`setStreamPriority`, `sendTrailers`, and `request`. **The Rust port
should adopt this universally for h2 host methods.**

### Pattern E: Detach-before-dispatch

```rust
// BEFORE: stream is still in self.streams; freeResources fires user callbacks;
//        re-entrant sweep finds stream and frees it; outer reads on freed heap.
// AFTER:
this.detach_stream_from_map(stream_id);    // unlink first
stream.free_resources::<false>(this);      // safe to dispatch
this.destroy_detached_stream(stream);      // free last
```

**Used by:** Zig h2 commit b6fe0bc887 (`endStream`/`abortStream`) and
702defa89d (`emitAbortToAllStreams`/`emitErrorToAllStreams`). The Rust
port has neither the helper nor the call-site uses; in Rust the
observable UAF is gated by streams not being explicitly destroyed
mid-execution, but the borrow-stack UB persists (Findings 4-6).

---

## 7. Cross-Reference: Findings vs Already-Fixed Sites

| Site | Zig fix commit | Rust port has fix? | Pass-5 finding |
|---|---|---|---|
| ResumableSink::cancel | 600448f739 (apr-14) | ✅ YES (line 411) | Verified absorbed |
| h2 setStreamPriority | 9bac2c2709 (may-09) | ❌ NO | **Finding 1 (T1)** |
| h2 sendTrailers | 9bac2c2709 (may-09) | ❌ NO | **Finding 2 (T1)** |
| h2 request options block | 702defa89d (may-09) | ❌ NO | **Finding 3 (T1)** |
| h2 emitAbortToAllStreams | 702defa89d (may-09) | ❌ NO | Finding 4 (T2) |
| h2 emitErrorToAllStreams | 702defa89d (may-09) | ❌ NO | Finding 5 (T2) |
| h2 endStream/abortStream | b6fe0bc887 (may-09) | ❌ NO | implicit (see Finding 4-5 analysis) |
| WebSocketClient::cancel | (sibling fix WSUpgradeClient.cancel) | ❌ NO | **Finding 8 (T1)** |

**Three of the five Rust-port T1 findings (1, 2, 3, 8) trace directly
to maintainer fixes that landed BEFORE the Rust port shipped but were
not absorbed.** The Rust port's h2 module appears to have branched from
the Zig tree before the late-stage h2 hardening sprint of 2026-05-09.

---

## 8. Summary

**T1 count:** 4 (Findings 1, 2, 3, 8).

**Dominant pattern:** *Outer `&mut T` retag held across user JS getter,
inner code path re-derives `&mut T` for the same allocation.* Three of
the four T1s (h2 host methods) are direct mirrors of the
maintainer-fixed bugs in Zig commits 9bac2c2709 and 702defa89d that did
not propagate to the Rust port. The fourth (Finding 8,
websocket_client.rs:223) is the unfixed sibling of an explicitly fixed
peer file in the same module.

**T2 count:** 5 (Findings 4, 5, 6, 9, 13). All borrow-stack UB without
observable misbehavior in the current Rust port, primarily because the
Rust port lacks mid-execution destroy paths the Zig version had.
Worth porting for hygiene even if memory-safety is currently intact.

**Negatives:** Findings 7, 10, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21,
22, 23, 24, 25. 16 sites verified sound, including five canonical
safe-pattern exemplars (WebSocketUpgradeClient::cancel,
WTFTimer::cancel, FSWatcher::emit_abort, ResumableSink::cancel
post-fix, NodeHTTPResponse::abort).

**Did this audit find NEW sites beyond the 3 cited commits?**

Yes. Finding 8 (`websocket_client.rs:223` — WebSocketClient::cancel)
is a NEW site: the sibling file `WebSocketUpgradeClient.rs:605` was
fixed explicitly with `ThisPtr`-pattern comments, but the
`websocket_client.rs` peer was not. This is not a port miss from the
three cited commits; it's a pre-existing inconsistency in the Rust
port that this audit surfaced.

Findings 4, 5, 6 also point at sites the cited Zig commits do not
*directly* cover in the Rust port — emit*ToAllStreams's borrow-stack
UB is latent in Rust because the Rust port doesn't free streams
mid-execution, but the borrow-stack issue persists independent of the
Zig commit's UAF concern, and is worth porting the detach-before-
dispatch pattern.

**Recommended actions (prioritized):**

1. **(T1, h2)** Port commits 9bac2c2709 and 702defa89d to
   `h2_frame_parser.rs`: add `stream = this.streams.get(stream_id)`
   re-resolves after each `options.get(...)` in `set_stream_priority`,
   `send_trailers`, and `request`. Bail returning the stream_id
   sentinel if gone.
2. **(T1, websocket)** Restructure `websocket_client.rs:223
   WebSocketClient::cancel` to take `*mut Self` and use the
   `ThisPtr`/`ScopedRef` pattern from
   `WebSocketUpgradeClient::cancel`. Copy `tcp` out before close.
3. **(T2, h2)** Implement `detach_stream_from_map` /
   `destroy_detached_stream` helpers in the Rust port and apply to
   `emit_abort_to_all_streams` / `emit_error_to_all_streams` /
   `end_stream` / `abort_stream`. Eliminates the borrow-stack UB
   even though no UAF symptom is reachable yet.
4. **(T2, h2)** `send_data` should accept `stream_id: u32` and
   re-resolve internally; the current shape of taking
   `stream: &mut Stream` from a caller that's still holding the
   `&mut` outer retag is fragile.
5. **(audit)** Add a CI check that detects the pattern: `unsafe {
   &mut *X };` followed by `options.get(...)?` followed by any
   `X.field = ...` write. The Rust port's h2 module has multiple of
   these; the static check would have flagged Findings 1-3 and the
   re-introduced versions if any get unfixed.

---

*End of Pass 5 audit.*
