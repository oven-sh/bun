//! `QuicStream` native handle (lsquic-backed).
//!
//! Data path: JS `write()`/`endWrite()` append to `outbound`, then arm
//! lsquic's `wantwrite`; the `on_write` callback drains `outbound` into
//! `lsquic_stream_write` and shuts the write side when FIN is pending and
//! the queue is empty. `on_read` drains lsquic into `inbound` and queues a
//! reader wakeup; the JS reader's `pull(cb)` pops one chunk per call. Never
//! call JS from inside an lsquic callback — events are queued on the owning
//! session and dispatched after `process_conns` returns.

use core::cell::Cell;
use core::ffi::{c_int, c_void};
use core::ptr::null_mut;
use std::collections::VecDeque;

use bun_jsc::{
    ArrayBuffer, CallFrame, JSGlobalObject, JSType, JSValue, JsCell, JsRef, JsResult, StringJsc,
    Strong,
};
use bun_lsquic_sys as lsquic;

use super::endpoint::alloc_exposed_array_buffer;
use super::ffi::lsquic_callback;
use super::session::{QuicSession, SessionEvent};

/// `QUIC_STREAM_HEADERS_KIND_*` (must match `node_quic_binding.rs`).
const QUIC_STREAM_HEADERS_KIND_HINTS: u32 = 0;
const QUIC_STREAM_HEADERS_KIND_INITIAL: u32 = 1;
const QUIC_STREAM_HEADERS_KIND_TRAILING: u32 = 2;
/// `QUIC_STREAM_HEADERS_FLAGS_TERMINAL`.
const QUIC_STREAM_HEADERS_FLAGS_TERMINAL: u32 = 1;

/// Mirrors Node's `Stream::State` (see `node_quic_binding.rs` for the
/// `IDX_STATE_STREAM_*` offsets the JS layer reads).
#[repr(C)]
pub struct StreamState {
    pub id: i64,
    pub pending: u8,
    pub fin_sent: u8,
    pub fin_received: u8,
    pub read_ended: u8,
    pub write_ended: u8,
    pub reset: u8,
    pub reset_code: u64,
    pub has_outbound: u8,
    pub has_reader: u8,
    pub wants_block: u8,
    pub wants_headers: u8,
    pub wants_reset: u8,
    pub wants_trailers: u8,
    pub received_early_data: u8,
    pub write_desired_size: u32,
    pub high_water_mark: u32,
}

pub(crate) const STREAM_STATS_FIELDS: &[&str] = &[
    "CREATED_AT",
    "OPENED_AT",
    "RECEIVED_AT",
    "ACKED_AT",
    "DESTROYED_AT",
    "BYTES_RECEIVED",
    "BYTES_SENT",
    "MAX_OFFSET",
    "MAX_OFFSET_ACK",
    "MAX_OFFSET_RECV",
    "FINAL_SIZE",
    "BYTES_ACCUMULATED",
    "MAX_BYTES_ACCUMULATED",
];

const IDX_STATS_CREATED_AT: usize = 0;
const IDX_STATS_OPENED_AT: usize = 1;
const IDX_STATS_RECEIVED_AT: usize = 2;
const IDX_STATS_DESTROYED_AT: usize = 4;
const IDX_STATS_BYTES_RECEIVED: usize = 5;
const IDX_STATS_BYTES_SENT: usize = 6;
const IDX_STATS_BYTES_ACCUMULATED: usize = 11;
const IDX_STATS_MAX_BYTES_ACCUMULATED: usize = 12;

const DEFAULT_HIGH_WATER_MARK: u32 = 16 * 1024;

/// Stream-id bit 1 selects the direction: 0 = bidirectional,
/// 1 = unidirectional (RFC 9000 §2.1).
const STREAM_ID_UNI_BIT: i64 = 0x2;

/// RFC 9218 §4.1 default Extensible HTTP Priority: urgency 3,
/// non-incremental.
const DEFAULT_PRIORITY: (u8, bool) = (3, false);

/// `pull(cb)` status values (must match `src/js/internal/quic/state.ts`).
const PULL_STATUS_EOS: f64 = 0.0;
const PULL_STATUS_DATA: f64 = 1.0;
const PULL_STATUS_BLOCKED: f64 = 2.0;
const PULL_STATUS_ERROR: f64 = -1.0;

/// Bytes the JS writer queued, waiting for lsquic's `on_write`.
#[derive(Default)]
pub(super) struct Outbound {
    pub data: VecDeque<u8>,
    pub fin_pending: bool,
    /// Body finished but FIN deferred until JS sends trailers; once the queue
    /// drains, fire `onStreamTrailers`.
    pub trailers_pending: bool,
    pub started: bool,
}

/// Bytes received from the peer, waiting for the JS reader.
#[derive(Default)]
pub(super) struct Inbound {
    pub chunks: VecDeque<Vec<u8>>,
    pub ended: bool,
    pub errored: bool,
}

/// `#[repr(C)]` so `vtable` is at offset 0 — the C shim reads it via
/// `*(us_nq_vtable**)stream_ctx`. Without it Rust may reorder fields.
#[repr(C)]
pub struct QuicStream {
    /// MUST stay the first field — see `node_quic_shim.c`.
    vtable: *const lsquic::NqVtable,
    /// The lsquic stream this wraps; null while pending or after close.
    raw: Cell<*mut lsquic::lsquic_stream>,
    /// Owning session (raw pointer; the JS-side Strong keeps it alive).
    session: Cell<*mut QuicSession>,
    session_js: JsCell<Option<Strong>>,
    this_value: JsCell<JsRef>,
    state: Cell<*mut StreamState>,
    stats: Cell<*mut u64>,
    pub(super) outbound: JsCell<Outbound>,
    pub(super) inbound: JsCell<Inbound>,
    /// One-shot reader wakeup registered via `setWakeup`.
    wakeup: JsCell<Option<Strong>>,
    /// Error code from a STOP_SENDING the peer sent us.
    peer_stop_sending_code: Cell<Option<u64>>,
    /// Anything (data, FIN, headers) was handed to lsquic — the stream has
    /// wire presence and local aborts must be sent immediately rather than
    /// deferred (see `QuicSession::defer_stream_abort`).
    wrote_to_lsquic: Cell<bool>,
    /// HTTP/3 only: at least one header block has been delivered to JS;
    /// subsequent blocks are reported as `KIND_TRAILING`.
    headers_received: Cell<bool>,
    /// RFC 9218 (urgency, incremental) — cached so getPriority round-trips
    /// before lsquic binds the stream.
    priority: Cell<(u8, bool)>,
    /// Header blocks queued on a pending stream (`sendHeaders` before lsquic
    /// bound it); flushed in `bind_raw`. `(wire bytes, eos)`.
    pending_headers: JsCell<Vec<(Vec<u8>, bool)>>,
    /// `onStreamTrailers` has been queued (so `endWrite()` defers FIN once).
    trailers_requested: Cell<bool>,
    /// `StreamBlocked` fired for the current blocked episode.
    blocked_reported: Cell<bool>,
    /// Remote stream never surfaced to JS (arrived already-reset with its
    /// session's close in the same batch); all its events are dropped.
    announce_suppressed: Cell<bool>,
    close_reported: Cell<bool>,
    destroyed: Cell<bool>,
}

impl QuicStream {
    pub(super) fn create(
        global: &JSGlobalObject,
        vtable: *const lsquic::NqVtable,
        session: *mut QuicSession,
        session_handle: JSValue,
        raw: *mut lsquic::lsquic_stream,
    ) -> JsResult<(*mut QuicStream, JSValue)> {
        let stream = QuicStream {
            vtable,
            raw: Cell::new(raw),
            session: Cell::new(session),
            session_js: JsCell::new(Some(Strong::create(session_handle, global))),
            this_value: JsCell::new(JsRef::empty()),
            state: Cell::new(null_mut()),
            stats: Cell::new(null_mut()),
            outbound: JsCell::new(Outbound::default()),
            inbound: JsCell::new(Inbound::default()),
            wakeup: JsCell::new(None),
            peer_stop_sending_code: Cell::new(None),
            wrote_to_lsquic: Cell::new(false),
            headers_received: Cell::new(false),
            priority: Cell::new(DEFAULT_PRIORITY),
            pending_headers: JsCell::new(Vec::new()),
            trailers_requested: Cell::new(false),
            blocked_reported: Cell::new(false),
            announce_suppressed: Cell::new(false),
            close_reported: Cell::new(false),
            destroyed: Cell::new(false),
        };
        let raw_ptr = bun_core::heap::into_raw(Box::new(stream));
        let handle = crate::generated_classes::js_QuicStream::to_js(raw_ptr, global);

        let state_ptr = alloc_exposed_array_buffer(
            global,
            handle,
            b"state",
            core::mem::size_of::<StreamState>(),
        )?;
        let stats_ptr = alloc_exposed_array_buffer(
            global,
            handle,
            b"stats",
            STREAM_STATS_FIELDS.len() * core::mem::size_of::<u64>(),
        )?;
        handle.put(global, b"stateByteOffset", JSValue::js_number(0.0));
        handle.put(global, b"statsByteOffset", JSValue::js_number(0.0));

        // SAFETY: `raw_ptr` was just created and is uniquely owned.
        let this = unsafe { &*raw_ptr };
        #[expect(
            clippy::cast_ptr_alignment,
            reason = "both are the base of a fresh JSC ArrayBuffer (byteOffset 0); JSC allocates its backing store through Gigacage/fastMalloc, which is at least 16-byte aligned"
        )]
        {
            this.state.set(state_ptr.cast::<StreamState>());
            this.stats.set(stats_ptr.cast::<u64>());
        }
        this.this_value.with_mut(|r| r.set_strong(handle, global));
        let _ = this.vtable;
        let now = super::now_ns();
        this.write_stat(IDX_STATS_CREATED_AT, now);
        this.with_state(|s| {
            s.id = -1;
            s.pending = 1;
            s.high_water_mark = DEFAULT_HIGH_WATER_MARK;
        });
        if !raw.is_null() {
            this.bind_raw(raw);
        }
        Ok((raw_ptr, handle))
    }

    /// Attach the lsquic stream once `on_new_stream` fires (either at create
    /// time for remote streams, or later for locally-initiated ones).
    pub(super) fn bind_raw(&self, raw: *mut lsquic::lsquic_stream) {
        self.raw.set(raw);
        // SAFETY: `raw` is the live stream lsquic just handed us.
        let s = unsafe { lsquic::Stream::from_raw(raw) }.expect("non-null stream");
        let id = s.id() as i64;
        self.with_state(|st| {
            st.id = id;
            st.pending = 0;
        });
        self.write_stat(IDX_STATS_OPENED_AT, super::now_ns());
        // When RST/STOP_SENDING arrives before any data, lsquic processes
        // rst_in/stop_sending_in before on_new_stream sets the ctx, so
        // on_reset is called with NULL ctx and skipped. Recover the recorded
        // code here.
        let pre_reset_code = s.error_code();
        // STOP_SENDING processed before on_new_stream set the ctx is only
        // recorded in lsquic's flags — mirror it so `is_ghost` sees it.
        if s.is_rejected() && self.peer_stop_sending_code.get().is_none() {
            self.peer_stop_sending_code.set(Some(pre_reset_code));
        }
        if s.reset_received() {
            self.mark_reset(pre_reset_code);
            if id & STREAM_ID_UNI_BIT == 0 {
                // Reset before data on a bidi stream: only the read side is
                // dead — the application can still respond (e.g. `setBody`
                // from `onreset`), and the stream closes when that side
                // finishes.
                s.shutdown(0);
            } else {
                s.close();
            }
            // The StreamReset event is queued by the caller AFTER
            // StreamReady so the JS layer's onstream has a chance to set
            // `onreset` (wants_reset) first.
        }
        // Bit 0 of the id is the initiator (RFC 9000 §2.1).
        let uni = id & STREAM_ID_UNI_BIT != 0;
        // Apply any priority JS set while the stream was pending.
        let (urgency, incremental) = self.priority.get();
        if (urgency, incremental) != DEFAULT_PRIORITY {
            let _ = s.set_http_prio(urgency, incremental);
        }
        // Flush header blocks queued while the stream was pending
        // (`sendHeaders` before the handshake finished).
        for (bytes, eos) in self.pending_headers.with_mut(core::mem::take) {
            self.wrote_to_lsquic.set(true);
            if s.send_headers(&bytes, eos) == 0 && eos {
                self.with_state(|st| {
                    st.fin_sent = 1;
                    st.write_ended = 1;
                });
                // See send_headers: lsquic ignores `eos` for IETF QUIC.
                s.shutdown(1);
            }
        }
        if uni {
            // A locally-opened uni stream has no readable side; a peer-opened
            // one has no writable side (for us). Which side we are is bit 0
            // vs the session's role.
            let session = self.session.get();
            // SAFETY: the session outlives its streams.
            let is_server = !session.is_null() && unsafe { (*session).is_server() };
            let local = (id & 1 == 0) != is_server;
            if local {
                self.inbound.with_mut(|i| i.ended = true);
                self.with_state(|s| s.read_ended = 1);
            } else {
                self.with_state(|s| s.write_ended = 1);
                s.want_read(true);
            }
        } else {
            s.want_read(true);
        }
        if self.outbound.get().started {
            s.want_write(true);
        }
    }

    /// The owning session, if still attached. The `session_js` Strong keeps
    /// the session's JS wrapper (and thus the boxed `QuicSession`) alive
    /// while this stream holds the back-pointer; `teardown()` nulls the
    /// pointer before that Strong is dropped, so a non-null pointer is
    /// always dereferenceable on the JS thread.
    fn session_ref(&self) -> Option<&QuicSession> {
        let p = self.session.get();
        // SAFETY: see doc comment.
        (!p.is_null()).then(|| unsafe { &*p })
    }
    fn ls(&self) -> Option<lsquic::Stream> {
        // SAFETY: `raw` is either null (pending/closed) or the live stream
        // lsquic gave us; lsquic frees it only after `on_close` returns,
        // where we null it first.
        unsafe { lsquic::Stream::from_raw(self.raw.get()) }
    }

    fn state_mut(&self) -> *mut StreamState {
        self.state.get()
    }
    /// Run `f` against the shared state buffer. The buffer is a JSC
    /// ArrayBuffer owned by the JS wrapper: it is allocated in `create()`
    /// before any other method can run, outlives `self` (the wrapper keeps
    /// both alive), and is only touched from the JS thread — so the single
    /// raw access below is in-bounds and unaliased.
    pub(super) fn with_state<R>(&self, f: impl FnOnce(&mut StreamState) -> R) -> R {
        // SAFETY: see doc comment.
        unsafe { f(&mut *self.state_mut()) }
    }
    fn write_stat(&self, idx: usize, value: u64) {
        let stats = self.stats.get();
        if !stats.is_null() && idx < STREAM_STATS_FIELDS.len() {
            // SAFETY: `stats` is a live `[u64; N]` view; ArrayBuffer storage
            // only guarantees byte alignment.
            unsafe { stats.add(idx).write_unaligned(value) };
        }
    }
    fn read_stat(&self, idx: usize) -> u64 {
        let stats = self.stats.get();
        if !stats.is_null() && idx < STREAM_STATS_FIELDS.len() {
            // SAFETY: as in write_stat.
            unsafe { stats.add(idx).read_unaligned() }
        } else {
            0
        }
    }
    fn add_stat(&self, idx: usize, delta: u64) {
        let stats = self.stats.get();
        if !stats.is_null() && idx < STREAM_STATS_FIELDS.len() {
            // SAFETY: as above.
            unsafe {
                stats
                    .add(idx)
                    .write_unaligned(stats.add(idx).read_unaligned().wrapping_add(delta))
            };
        }
    }

    pub(super) fn handle(&self) -> JSValue {
        self.this_value.get().get()
    }
    /// `state.reset_code` if `state.reset` was set in `bind_raw` (i.e. the
    /// stream was already reset before lsquic surfaced it).
    pub(super) fn pre_reset_code(&self) -> Option<u64> {
        self.with_state(|s| (s.reset != 0).then_some(s.reset_code))
    }
    /// A remote-initiated stream has wire presence the moment lsquic creates
    /// it — the peer's frame is what created it.
    pub(super) fn mark_wrote_to_lsquic(&self) {
        self.wrote_to_lsquic.set(true);
    }

    /// Mark this remote stream as never-surfaced: it arrived already-reset
    /// while its session's close was queued in the same dispatch batch, so
    /// Node never announces it (`onstream` must not fire) and its
    /// subsequent reset/close events are dropped. Wired into the session's
    /// StreamReady dispatch (see session.rs).
    pub(super) fn suppress_announce(&self) {
        self.announce_suppressed.set(true);
    }
    pub(super) fn is_announce_suppressed(&self) -> bool {
        self.announce_suppressed.get()
    }
    /// Whether this stream still has outbound bytes lsquic hasn't fully
    /// delivered: queued in our buffer, FIN pending, or sent-but-unacked.
    /// Used to defer a graceful session close until responses land.
    pub(super) fn has_undelivered_outbound(&self) -> bool {
        let out = self.outbound.get();
        if !out.data.is_empty() || out.fin_pending {
            return true;
        }
        self.ls().is_some_and(|s| s.has_unacked_data())
    }

    pub(super) fn stream_id(&self) -> i64 {
        self.with_state(|s| s.id)
    }

    /// Append peer data (and/or FIN) for the JS reader.
    pub(super) fn push_inbound(&self, data: &[u8], fin: bool) {
        if self.destroyed.get() {
            return;
        }
        self.inbound.with_mut(|inbound| {
            if !data.is_empty() {
                inbound.chunks.push_back(data.to_vec());
            }
            if fin {
                inbound.ended = true;
            }
        });
        if !data.is_empty() {
            self.add_stat(IDX_STATS_BYTES_RECEIVED, data.len() as u64);
            self.write_stat(IDX_STATS_RECEIVED_AT, super::now_ns());
            // Track how much inbound data is buffered awaiting the reader.
            let acc = self.read_stat(IDX_STATS_BYTES_ACCUMULATED) + data.len() as u64;
            self.write_stat(IDX_STATS_BYTES_ACCUMULATED, acc);
            self.write_stat(
                IDX_STATS_MAX_BYTES_ACCUMULATED,
                self.read_stat(IDX_STATS_MAX_BYTES_ACCUMULATED).max(acc),
            );
        }
        if fin {
            self.with_state(|s| s.fin_received = 1);
        }
    }

    /// Take the registered reader wakeup (one-shot per registration).
    pub(super) fn take_wakeup(&self) -> Option<Strong> {
        self.wakeup.replace(None)
    }

    /// 0-RTT was rejected: Node destroys every stream opened during the
    /// early-data phase — cancel ours with an application error so its
    /// `closed` promise rejects, and reset it on the wire so the peer
    /// drops the replayed data.
    pub(super) fn cancel_early_rejected(&self, code: u64) {
        self.mark_reset(code);
        self.outbound.with_mut(|o| {
            o.data.clear();
            o.fin_pending = false;
            o.trailers_pending = false;
        });
        self.with_state(|st| st.write_ended = 1);
        if let Some(s) = self.ls() {
            // The 0-RTT data the peer never accepted has no wire presence
            // in 1-RTT terms: finish the stream without frames so the
            // server never learns of it (ngtcp2's rewind leaves the stream
            // never-manifested; Node destroys it silently).
            s.shutdown_internal();
        }
    }

    /// Apply the state effects of a peer STOP_SENDING (deferred to event
    /// dispatch so a same-batch announce still sees a live writer).
    pub(super) fn apply_peer_stop_sending(&self, code: u64) {
        // A locally-initiated UNI stream has no other direction: peer
        // STOP_SENDING kills the whole stream, so `closed` rejects with
        // the code (bit 1 of the id = uni per RFC 9000 §2.1; read_ended
        // is pre-set for the initiator, distinguishing it from the
        // peer-opened side).
        let local_uni =
            self.stream_id() & STREAM_ID_UNI_BIT != 0 && self.with_state(|s| s.read_ended != 0);
        self.with_state(|s| {
            s.write_ended = 1;
            if local_uni && code != 0 && s.reset_code == 0 {
                s.reset_code = code;
            }
        });
    }

    pub(super) fn mark_reset(&self, code: u64) {
        if self.destroyed.get() {
            return;
        }
        self.inbound.with_mut(|inbound| {
            inbound.chunks.clear();
            inbound.errored = true;
            inbound.ended = true;
        });
        self.with_state(|s| {
            s.reset = 1;
            s.reset_code = code;
            s.read_ended = 1;
        });
    }

    pub(super) fn mark_close_reported(&self) -> bool {
        self.close_reported.replace(true)
    }
    /// Marks the first header block as received and returns whether this WAS
    /// the first one (so the caller can pick `KIND_INITIAL` vs `_TRAILING`).
    pub(super) fn mark_headers_received(&self) -> bool {
        !self.headers_received.replace(true)
    }
    pub(super) fn wants_headers(&self) -> bool {
        self.with_state(|s| s.wants_headers != 0)
    }
    pub(super) fn wants_reset(&self) -> bool {
        self.with_state(|s| s.wants_reset != 0)
    }
    pub(super) fn wants_block(&self) -> bool {
        self.with_state(|s| s.wants_block != 0)
    }
    /// Fire `StreamBlocked` once per blocked episode (cleared on progress).
    fn note_write_blocked(&self) {
        if self.blocked_reported.replace(true) {
            return;
        }
        let session = self.session.get();
        if !session.is_null() {
            // SAFETY: the session outlives its streams.
            unsafe {
                (*session).push_event(SessionEvent::StreamBlocked {
                    stream: core::ptr::from_ref(self).cast_mut(),
                });
            }
        }
    }

    /// `on_write` driver: push as much of `outbound` into lsquic as it will
    /// take; FIN once drained and `fin_pending`.
    fn drain_outbound(&self) {
        let Some(s) = self.ls() else { return };
        loop {
            let (slice, contig): (Vec<u8>, usize) = {
                let out = self.outbound.get();
                if out.data.is_empty() {
                    break;
                }
                let (a, _) = out.data.as_slices();
                (a.to_vec(), a.len())
            };
            let n = s.write(&slice);
            if n <= 0 {
                self.note_write_blocked();
                break;
            }
            self.blocked_reported.set(false);
            self.wrote_to_lsquic.set(true);
            let n = n as usize;
            self.outbound.with_mut(|out| {
                out.data.drain(..n.min(contig));
            });
            self.add_stat(IDX_STATS_BYTES_SENT, n as u64);
            if n < slice.len() {
                self.note_write_blocked();
                break;
            }
        }
        let (empty, fin) = {
            let out = self.outbound.get();
            (out.data.is_empty(), out.fin_pending)
        };
        if empty {
            if fin {
                s.shutdown(1);
                self.wrote_to_lsquic.set(true);
                self.outbound.with_mut(|o| o.fin_pending = false);
                self.with_state(|s| s.fin_sent = 1);
                // For a locally-opened uni stream there is no read side; mark
                // it done now so lsquic schedules on_close once the FIN is
                // acked. (stream_shutdown_read is patched to not queue
                // STOP_SENDING for outgoing-uni.)
                if self.stream_id() & STREAM_ID_UNI_BIT != 0 {
                    s.shutdown(0);
                }
            } else if self.outbound.get().trailers_pending && !self.trailers_requested.replace(true)
            {
                if let Some(session) = self.session_ref() {
                    session.push_event(SessionEvent::StreamWantsTrailers {
                        stream: core::ptr::from_ref(self).cast_mut(),
                    });
                }
            }
            s.want_write(false);
        }
        s.flush();
        // Backpressure window for the JS writer.
        let pending = self.outbound.get().data.len() as u32;
        let (was_full, hwm) = self.with_state(|s| {
            let was_full = s.write_desired_size == 0 && s.has_outbound != 0;
            s.write_desired_size = s.high_water_mark.saturating_sub(pending);
            (was_full, s.high_water_mark)
        });
        // Fire onStreamDrain when we transition from no-capacity to capacity.
        if was_full && pending < hwm {
            if let Some(session) = self.session_ref() {
                session.push_event(SessionEvent::StreamDrain {
                    stream: core::ptr::from_ref(self).cast_mut(),
                });
            }
        }
    }

    /// Arm lsquic's write callback and drive the engine after queueing data.
    fn kick_write(&self) {
        if let Some(s) = self.ls() {
            s.want_write(true);
        }
        if let Some(session) = self.session_ref() {
            session.schedule_process();
        }
    }

    /// End the readable side without a FIN (the stream died with the conn):
    /// a blocked `for await` re-pulls on the wakeup and gets EOS instead of
    /// waiting forever.
    pub(super) fn end_read_side(&self, global: &JSGlobalObject) {
        self.inbound.with_mut(|i| i.ended = true);
        self.with_state(|s| s.read_ended = 1);
        if let Some(wakeup) = self.take_wakeup() {
            let vm = global.bun_vm().as_mut();
            vm.event_loop_ref()
                .run_callback(wakeup.get(), global, JSValue::UNDEFINED, &[]);
        }
    }

    pub(super) fn teardown(&self, global: &JSGlobalObject) {
        if self.destroyed.replace(true) {
            return;
        }
        self.write_stat(IDX_STATS_DESTROYED_AT, super::now_ns());
        // Clear lsquic's stream-ctx before dropping the wrapper Strong:
        // lsquic's `on_close` (and `on_reset`) can fire after this object is
        // GC'd; the shim skips when ctx is null.
        if let Some(s) = self.ls() {
            // SAFETY: null is always a valid stream ctx; the shim skips on null.
            unsafe { s.set_ctx(null_mut()) };
        }
        self.raw.set(null_mut());
        // SAFETY: streams are kept alive by their wrapper Strong; the
        // session is alive (session_js Strong still held below).
        let session = self.session.replace(null_mut());
        if !session.is_null() {
            // The session's `streams` Vec is the only other holder of this
            // raw pointer; remove it before downgrading so process_events
            // can't iterate a freed stream.
            // SAFETY: as above.
            unsafe { (*session).remove_stream(core::ptr::from_ref(self).cast_mut()) };
        }
        self.outbound.with_mut(|o| o.data.clear());
        // End the read side so a blocked iterator's re-pull returns EOS…
        self.inbound.with_mut(|i| {
            i.chunks.clear();
            i.ended = true;
        });
        self.with_state(|s| s.read_ended = 1);
        // …and fire any parked reader wakeup — dropping it silently leaves
        // `for await` blocked forever when the stream dies without FIN.
        if let Some(wakeup) = self.take_wakeup() {
            let vm = global.bun_vm().as_mut();
            vm.event_loop_ref()
                .run_callback(wakeup.get(), global, JSValue::UNDEFINED, &[]);
        }
        self.wakeup.set(None);
        self.session_js.set(None);
        self.this_value.with_mut(|r| r.downgrade());
    }

    #[expect(
        clippy::boxed_local,
        reason = "codegen's host_fn_finalize calls this as `|b| QuicStream::finalize(b)` and requires `self: Box<Self>`"
    )]
    pub(crate) fn finalize(self: Box<Self>) {}

    // ── JS-facing surface ────────────────────────────────────────────────

    pub(crate) fn get_reader(&self, _g: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        self.with_state(|s| s.has_reader = 1);
        Ok(frame.this())
    }

    pub(crate) fn set_wakeup(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let cb = frame.arguments_as_array::<1>()[0];

        if cb.is_empty_or_undefined_or_null() {
            self.wakeup.set(None);
        } else {
            self.wakeup.set(Some(Strong::create(cb, global)));
        }
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn pull(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let cb = frame.arguments_as_array::<1>()[0];
        if !cb.is_callable() {
            return Ok(JSValue::UNDEFINED);
        }
        let (status, buffer) = self.inbound.with_mut(|inbound| {
            if inbound.errored {
                (PULL_STATUS_ERROR, None)
            } else if let Some(chunk) = inbound.chunks.pop_front() {
                (PULL_STATUS_DATA, Some(chunk))
            } else if inbound.ended {
                (PULL_STATUS_EOS, None)
            } else {
                (PULL_STATUS_BLOCKED, None)
            }
        });
        let buffer_js = match buffer {
            Some(bytes) => {
                self.write_stat(
                    IDX_STATS_BYTES_ACCUMULATED,
                    self.read_stat(IDX_STATS_BYTES_ACCUMULATED)
                        .saturating_sub(bytes.len() as u64),
                );
                ArrayBuffer::create::<{ JSType::ArrayBuffer }>(global, &bytes)?
            }
            None => JSValue::UNDEFINED,
        };
        let vm = global.bun_vm().as_mut();
        vm.event_loop_ref().run_callback(
            cb,
            global,
            JSValue::UNDEFINED,
            &[JSValue::js_number(status), buffer_js],
        );
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn attach_source(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        if self.destroyed.get() {
            return Ok(JSValue::UNDEFINED);
        }
        let source = frame.arguments_as_array::<1>()[0];
        let bytes = if source.is_empty_or_undefined_or_null() {
            Vec::new()
        } else if let Some(buf) = source.as_array_buffer(global) {
            buf.byte_slice().to_vec()
        } else {
            return Err(global.throw(format_args!(
                "Unsupported QUIC stream body source (Blob and FileHandle sources are not implemented yet)"
            )));
        };
        self.outbound.with_mut(|o| {
            o.started = true;
            o.data.extend(bytes.iter().copied());
            o.fin_pending = true;
        });
        self.with_state(|s| s.has_outbound = 1);
        self.kick_write();
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn init_streaming_source(
        &self,
        _g: &JSGlobalObject,
        _f: &CallFrame,
    ) -> JsResult<JSValue> {
        if self.destroyed.get() {
            return Ok(JSValue::UNDEFINED);
        }
        self.outbound.with_mut(|o| o.started = true);
        self.with_state(|s| {
            s.has_outbound = 1;
            s.write_desired_size = s.high_water_mark;
        });
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn write(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        if self.destroyed.get() {
            return Ok(JSValue::UNDEFINED);
        }
        let batch = frame.arguments_as_array::<1>()[0];
        let mut queued: u64 = 0;
        let mut append = |bytes: &[u8]| {
            queued += bytes.len() as u64;
            self.outbound
                .with_mut(|o| o.data.extend(bytes.iter().copied()));
        };
        if batch.is_array() {
            let len = batch.get_length(global)?;
            for i in 0..len {
                let chunk = batch.get_index(global, i as u32)?;
                if let Some(buf) = chunk.as_array_buffer(global) {
                    append(buf.byte_slice());
                }
            }
        } else if let Some(buf) = batch.as_array_buffer(global) {
            append(buf.byte_slice());
        }
        let pending = self.outbound.get().data.len() as u32;
        self.with_state(|s| s.write_desired_size = s.high_water_mark.saturating_sub(pending));
        if let Some(session) = self.session_ref() {
            session.note_stream_write();
        }
        self.kick_write();
        Ok(JSValue::js_number(queued as f64))
    }

    pub(crate) fn end_write(&self, _g: &JSGlobalObject, _f: &CallFrame) -> JsResult<JSValue> {
        if self.destroyed.get() {
            return Ok(JSValue::UNDEFINED);
        }
        let wants_trailers = self.with_state(|s| s.wants_trailers != 0);
        self.outbound.with_mut(|o| {
            o.started = true;
            // FIN is deferred until JS sends trailers; `drain_outbound` fires
            // `onStreamTrailers` once the body queue drains.
            if wants_trailers {
                o.trailers_pending = true;
            } else {
                o.fin_pending = true;
            }
        });
        if let Some(session) = self.session_ref() {
            session.note_stream_write();
        }
        self.kick_write();
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn destroy(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        if self.destroyed.get() {
            return Ok(JSValue::UNDEFINED);
        }
        // The JS layer passes either a bare code (BigInt/number), a
        // `{type, code, reason}` options object, or `true` — the cascade
        // marker from a session-level destroy: skip all wire actions (the
        // session teardown that follows frees the lsquic streams, and a
        // reset here would make the otherwise-silent destroy ack-eliciting).
        let arg = frame.arguments_as_array::<1>()[0];
        let cascading = arg.is_boolean() && arg.to_boolean();
        let code = if arg.is_object() {
            arg.get(global, "code")?.map(error_code_arg).unwrap_or(0)
        } else if arg.is_boolean() {
            0
        } else {
            error_code_arg(arg)
        };
        let write_done = self.with_state(|s| s.fin_sent != 0 || s.write_ended != 0);
        if !cascading {
            if let Some(s) = self.ls() {
                // A deferred abort owns this stream's wire fate now — the
                // flush at the next process tick resets or silently
                // finishes it.
                let deferred = self
                    .session_ref()
                    .is_some_and(|session| session.has_deferred_abort(s.raw()));
                if !deferred {
                    // Under `onwanttrailers`, `end_write` records
                    // `trailers_pending` instead of `fin_pending`; both mean
                    // the app ended the send side.
                    let send_ended = write_done || {
                        let out = self.outbound.get();
                        out.fin_pending || out.trailers_pending
                    };
                    if code != 0 || !send_ended {
                        s.reset(code);
                    } else {
                        // Flush and close: a RESET_STREAM retracts the
                        // committed response (lsquic elides a reset stream's
                        // frames from packets it has not sent yet).
                        self.outbound.with_mut(|o| o.trailers_pending = false);
                        self.drain_outbound();
                        if self.outbound.get().data.is_empty() {
                            s.close();
                        } else {
                            // lsquic would not take the whole body (flow
                            // control); a clean FIN would truncate it.
                            s.reset(code);
                        }
                    }
                }
            }
        }
        // teardown() clears `session`; capture it first.
        let session = self.session.get();
        self.teardown(global);
        if !session.is_null() {
            // SAFETY: the session outlives its streams (session_js Strong was
            // dropped only just now in teardown; the session is registered on
            // the endpoint while any stream existed, so it has not been
            // finalized between those two lines).
            unsafe { (*session).schedule_process() };
        }
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn reset_stream(&self, _g: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        if self.destroyed.get() {
            return Ok(JSValue::UNDEFINED);
        }
        let code = error_code_arg(frame.arguments_as_array::<1>()[0]);
        self.with_state(|s| {
            s.write_ended = 1;
            s.reset = 1;
            s.reset_code = code;
        });
        // RESET_STREAM discards pending data by definition; a stale queue
        // would keep `has_undelivered_outbound()` true forever and deadlock
        // the session's graceful close.
        self.outbound.with_mut(|o| {
            o.data.clear();
            o.fin_pending = false;
            o.trailers_pending = false;
        });
        if let Some(s) = self.ls() {
            // `Stream::reset` (lsquic_stream_force_reset_ext) sends
            // RESET_STREAM(code); the read side stays open so the peer can
            // still send (and on_close fires once both sides are done).
            s.reset(code);
        }
        self.kick_write();
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn stop_sending(&self, _g: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        if self.destroyed.get() {
            return Ok(JSValue::UNDEFINED);
        }
        let code = error_code_arg(frame.arguments_as_array::<1>()[0]);
        if let Some(s) = self.ls() {
            s.stop_sending(code);
        }
        self.inbound.with_mut(|i| i.ended = true);
        self.with_state(|s| {
            s.read_ended = 1;
            // Record the requested code so onStreamClose surfaces it. The
            // peer is asked to RESET_STREAM with this code, but if they
            // already FIN'd they may not — this mirrors Node treating the
            // local stop as the close error regardless.
            if s.reset_code == 0 {
                s.reset_code = code;
            }
        });
        self.kick_write();
        Ok(JSValue::UNDEFINED)
    }

    /// The destroy-path wire abort: STOP_SENDING and/or RESET_STREAM per the
    /// JS-side gating. For a stream that never reached lsquic the frames are
    /// deferred to the next process tick — and dropped if other stream data
    /// is written first (Node parity for streams created and abandoned in
    /// one turn). State bookkeeping happens immediately either way.
    pub(crate) fn abort_for_destroy(
        &self,
        _g: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        if self.destroyed.get() {
            return Ok(JSValue::UNDEFINED);
        }
        let [stop_arg, reset_arg] = frame.arguments_as_array::<2>();
        let stop = (!stop_arg.is_empty_or_undefined_or_null()).then(|| error_code_arg(stop_arg));
        let reset = (!reset_arg.is_empty_or_undefined_or_null()).then(|| error_code_arg(reset_arg));
        if let Some(code) = stop {
            self.inbound.with_mut(|i| i.ended = true);
            self.with_state(|s| {
                s.read_ended = 1;
                if s.reset_code == 0 {
                    s.reset_code = code;
                }
            });
        }
        if let Some(code) = reset {
            self.with_state(|s| {
                s.write_ended = 1;
                s.reset = 1;
                s.reset_code = code;
            });
            self.outbound.with_mut(|o| {
                o.data.clear();
                o.fin_pending = false;
                o.trailers_pending = false;
            });
        }
        if let Some(s) = self.ls() {
            if self.wrote_to_lsquic.get() {
                if let Some(code) = stop {
                    s.stop_sending(code);
                }
                if let Some(code) = reset {
                    s.reset(code);
                }
            } else if let Some(session) = self.session_ref() {
                session.defer_stream_abort(s.raw(), reset, stop);
                session.schedule_process();
            }
        }
        self.kick_write();
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn set_priority(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let packed = frame.arguments_as_array::<1>()[0].coerce_to_i32(global)? as u32;
        let (urgency, incremental) = ((packed >> 1) as u8, packed & 1 != 0);
        // Record locally so getPriority round-trips even before lsquic binds
        // the stream (or for non-HTTP engines where set_http_prio fails).
        self.priority.set((urgency, incremental));
        if let Some(s) = self.ls() {
            let _ = s.set_http_prio(urgency, incremental);
        }
        Ok(JSValue::UNDEFINED)
    }
    pub(crate) fn get_priority(&self, _g: &JSGlobalObject, _f: &CallFrame) -> JsResult<JSValue> {
        let (urgency, incremental) = self
            .ls()
            .and_then(|s| s.get_http_prio())
            .unwrap_or_else(|| self.priority.get());
        Ok(JSValue::js_number(f64::from(
            (u32::from(urgency) << 1) | u32::from(incremental),
        )))
    }
    pub(crate) fn send_headers(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        if self.destroyed.get() {
            return Ok(JSValue::js_boolean(false));
        }
        let [kind_arg, header_tuple, flags] = frame.arguments_as_array::<3>();
        // The JS layer passes `buildNgHeaderString`'s `[string, count]` return
        // verbatim — read the NUL-delimited triplet string from index 0.
        let header_string = if header_tuple.is_string() {
            header_tuple
        } else {
            header_tuple.get_index(global, 0)?
        };
        // Latin-1 on the wire, as node does (`StringBytes::Write(.., LATIN1)`):
        // h3 header octets need not be valid UTF-8, and this must be the exact
        // inverse of the latin1 decode in `session.rs`'s `StreamHeaders`.
        use crate::webcore::encoding::BunStringEncode as _;
        let bytes = bun_core::String::from_js(header_string, global)?
            .encode(crate::node::types::Encoding::Latin1);
        // TRAILING headers are always terminal (the JS layer passes
        // `kHeadersFlagsNone` for them).
        let is_trailing =
            kind_arg.coerce_to_i32(global).unwrap_or(0) as u32 == QUIC_STREAM_HEADERS_KIND_TRAILING;
        let eos = is_trailing
            || flags.coerce_to_i32(global)? & (QUIC_STREAM_HEADERS_FLAGS_TERMINAL as i32) != 0;
        let Some(s) = self.ls() else {
            // Pending stream (created before the handshake finished):
            // queue the block; `bind_raw` flushes it once lsquic hands us
            // the stream.
            self.pending_headers.with_mut(|q| q.push((bytes, eos)));
            self.with_state(|s| s.has_outbound = 1);
            return Ok(JSValue::js_boolean(true));
        };
        let rv = s.send_headers(&bytes, eos);
        if rv == 0 {
            // A HEADERS frame is wire presence: `abort_for_destroy` must reset
            // on the stream itself rather than defer, exactly as `bind_raw`
            // marks the pending-header flush.
            self.wrote_to_lsquic.set(true);
            // Headers must precede body writes; mark outbound as started so
            // bind_raw / drain_outbound know FIN follows the body, not the
            // header frame.
            self.with_state(|s| s.has_outbound = 1);
            if eos {
                self.with_state(|s| {
                    s.fin_sent = 1;
                    s.write_ended = 1;
                });
                // lsquic_stream_send_headers ignores `eos` for IETF QUIC
                // (only gQUIC honors it), so FIN the write side ourselves.
                // shutdown(1) flushes the buffered HEADERS frame; don't run
                // drain_outbound after (its s.flush() would assert with
                // nothing buffered and FIN_SENT).
                s.shutdown(1);
                if let Some(session) = self.session_ref() {
                    session.schedule_process();
                }
            } else {
                self.kick_write();
            }
            Ok(JSValue::js_boolean(true))
        } else {
            Ok(JSValue::js_boolean(false))
        }
    }
}

fn error_code_arg(value: JSValue) -> u64 {
    if value.is_number() {
        value.as_number().max(0.0) as u64
    } else if value.is_big_int() {
        value.to_uint64_no_truncate()
    } else {
        0
    }
}

// ── lsquic callback targets (see node_quic_shim.c thunks) ────────────────

/// `lsquic_stream_if::on_new_stream`. lsquic may pass `s == NULL` as a
/// "going away" signal; ignore that. Otherwise look up the owning session via
/// the conn-ctx and either bind a pending locally-opened stream (next in
/// FIFO) or queue a new remote stream for `onStreamCreated`.
pub(super) unsafe extern "C" fn on_new_stream(
    _owner: *mut c_void,
    s: *mut lsquic::lsquic_stream,
) -> *mut c_void {
    // SAFETY: `s` is the stream lsquic just created, live for this callback.
    let Some(stream) = (unsafe { lsquic::Stream::from_raw(s) }) else {
        return null_mut();
    };
    // SAFETY: lsquic guarantees the stream's conn is live for this callback.
    let conn = unsafe { lsquic::lsquic_stream_conn(s) };
    if conn.is_null() {
        return null_mut();
    }
    // SAFETY: the conn-ctx is the QuicSession (set at connect/on_new_conn).
    let session_ptr = unsafe { lsquic::lsquic_conn_get_ctx(conn) }.cast::<QuicSession>();
    if session_ptr.is_null() {
        // Crypto streams during the mini-conn phase land here with no
        // session bound yet; let lsquic manage them.
        return null_mut();
    }
    // SAFETY: as above.
    let session = unsafe { &*session_ptr };
    let id = stream.id();
    // Bit 0 of the stream ID is the initiator (0=client, 1=server). The
    // session knows which side it is.
    let is_local = (id & 1 == 0) != session.is_server();
    if is_local {
        if let Some(qs) = session.take_pending_local_stream() {
            // SAFETY: pending streams are kept alive by their wrapper Strong.
            unsafe { (*qs).bind_raw(s) };
            session.push_event(SessionEvent::StreamReady {
                stream: qs,
                remote: false,
            });
            return qs.cast();
        }
        // openStream queued one, but the JS wrapper was destroyed while the
        // stream was still pending. Nothing was ever sent, so force-finish
        // both sides without wire frames — the peer must not learn a stream
        // was opened and then discarded.
        stream.shutdown_internal();
        return null_mut();
    }
    // Remote-initiated: the session creates and announces it.
    session.on_remote_stream(s).cast()
}

pub(super) unsafe extern "C" fn on_stream_read(ctx: *mut c_void, s: *mut lsquic::lsquic_stream) {
    // SAFETY: `s` is live for the duration of this lsquic callback.
    let Some(stream) = (unsafe { lsquic::Stream::from_raw(s) }) else {
        return;
    };
    if ctx.is_null() {
        // No QuicStream bound (crypto stream); just drain so lsquic stops
        // calling us.
        let mut buf = [0u8; 4096];
        while stream.read(&mut buf) > 0 {}
        return;
    }
    // SAFETY: `ctx` is the live QuicStream we returned from on_new_stream.
    let qs = unsafe { &*ctx.cast::<QuicStream>() };
    // HTTP/3 mode: lsquic blocks body reads until the application claims the
    // decoded header set. Take it (ownership transfers to us) and surface as
    // `onStreamHeaders` BEFORE any body chunks. lsquic delivers each block
    // (informational / initial / trailing) via a separate hset; for now treat
    // every block after the first as trailing.
    if let Some(hset) = stream.take_header_set() {
        let pairs = hset.pairs();
        // 1xx interim responses are HINTS (RFC 9114 §4.1); they don't count
        // toward the INITIAL/TRAILING progression.
        let is_interim = pairs
            .chunks_exact(2)
            .find(|kv| kv[0] == b":status")
            .map(|kv| kv[1].len() == 3 && kv[1][0] == b'1')
            .unwrap_or(false);
        let kind = if is_interim {
            QUIC_STREAM_HEADERS_KIND_HINTS
        } else if qs.mark_headers_received() {
            QUIC_STREAM_HEADERS_KIND_INITIAL
        } else {
            QUIC_STREAM_HEADERS_KIND_TRAILING
        };
        if let Some(session) = qs.session_ref() {
            session.push_event(SessionEvent::StreamHeaders {
                stream: ctx.cast(),
                pairs,
                kind,
            });
        }
    }
    if stream.received_early_data() {
        qs.with_state(|s| s.received_early_data = 1);
    }
    let mut buf = [0u8; 16 * 1024];
    let mut got_any = false;
    loop {
        let n = stream.read(&mut buf);
        match n {
            n if n > 0 => {
                qs.push_inbound(&buf[..n as usize], false);
                got_any = true;
            }
            0 => {
                qs.push_inbound(&[], true);
                stream.want_read(false);
                // Reading FIN ends the readable side. For a peer-opened uni
                // stream there is no writable side, but lsquic only schedules
                // on_close once both U_READ_DONE and U_WRITE_DONE are set, so
                // close() (which marks both) instead of shutdown(0). For bidi
                // streams whose write side isn't done yet, shutdown(0) is
                // enough — close() would also FIN the write side prematurely.
                let write_done = qs.with_state(|s| s.fin_sent != 0 || s.write_ended != 0);
                if write_done {
                    stream.close();
                } else {
                    stream.shutdown(0);
                }
                got_any = true;
                break;
            }
            _ => break,
        }
    }
    if got_any {
        if let Some(session) = qs.session_ref() {
            session.push_event(SessionEvent::StreamWake { stream: ctx.cast() });
        }
    }
}

lsquic_callback! {
    pub(super) fn on_stream_write(qs: &QuicStream, _s: *mut lsquic::lsquic_stream) {
        qs.drain_outbound();
    }

    pub(super) fn on_stream_close(
        ctx: *mut c_void as qs: &QuicStream,
        _s: *mut lsquic::lsquic_stream,
    ) {
        // The lsquic_stream is freed immediately after this callback returns.
        qs.raw.set(null_mut());
        if let Some(session) = qs.session_ref() {
            session.push_event(SessionEvent::StreamClosed { stream: ctx.cast() });
        }
    }

    pub(super) fn on_stream_reset(ctx: *mut c_void as qs: &QuicStream, how: c_int, code: u64) {
        // `how`: 0=read side reset (RST_STREAM), 1=write side stopped
        // (STOP_SENDING). lsquic doesn't pass the error code here.
        if how == 0 || how == 2 {
            qs.mark_reset(code);
            if let Some(s) = qs.ls() {
                // A peer RESET terminates only the read direction: on a bidi
                // stream whose write side is still open, Node lets the
                // application keep responding (e.g. `setBody` from `onreset`).
                // Close outright only when nothing more can be written — then
                // lsquic schedules on_close and `closed` settles.
                let write_open = qs.stream_id() & STREAM_ID_UNI_BIT == 0
                    && qs.with_state(|st| st.fin_sent == 0 && st.write_ended == 0);
                if write_open && how == 0 {
                    s.shutdown(0);
                } else {
                    s.close();
                }
            }
            if let Some(session) = qs.session_ref() {
                session.push_event(SessionEvent::StreamReset {
                    stream: ctx.cast(),
                    code,
                });
                session.push_event(SessionEvent::StreamWake { stream: ctx.cast() });
            }
        }
        if how == 1 || how == 2 {
            // STOP_SENDING(code) from the peer: the write side is done (lsquic
            // already responds with RESET_STREAM echoing the code), so the JS
            // writer errors — but on a BIDI stream the RECEIVER's `closed`
            // resolves cleanly (Node rejects only the STOP_SENDING *caller*'s
            // `closed`, which `stop_sending()` records on its own state).
            qs.peer_stop_sending_code.set(Some(code));
            if let Some(session) = qs.session_ref() {
                // The `writeEnded` flip is applied at dispatch, not here: when
                // the announce and the STOP_SENDING arrive in one batch, Node's
                // `onstream` still observes a live writer (desiredSize is a
                // number) and the flag flips only after the reset callback.
                session.push_event(SessionEvent::StreamStopSending {
                    stream: ctx.cast(),
                    code,
                });
                session.push_event(SessionEvent::StreamWake { stream: ctx.cast() });
            } else {
                qs.apply_peer_stop_sending(code);
            }
        }
    }
}
