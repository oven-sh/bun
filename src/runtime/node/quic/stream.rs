use core::cell::Cell;
use core::ffi::{c_int, c_void};
use core::ptr::null_mut;
use std::collections::VecDeque;

use bun_jsc::bindgen::{self, JsHeap, JsLocal, JsPayload as _, JsScope, JsWrapper};
use bun_jsc::{
    ArrayBuffer, ErrorCode, JSGlobalObject, JSType, JSValue, JsCell, JsRef, JsResult, StringJsc,
    Strong,
};
use bun_lsquic_sys as lsquic;

use super::endpoint::alloc_exposed_array_buffer;
use super::ffi::lsquic_callback;
use super::session::{H3_INTERNAL_ERROR, QuicSession, SessionEvent};

const QUIC_STREAM_HEADERS_KIND_HINTS: u32 = 0;
const QUIC_STREAM_HEADERS_KIND_INITIAL: u32 = 1;
const QUIC_STREAM_HEADERS_KIND_TRAILING: u32 = 2;
const QUIC_STREAM_HEADERS_FLAGS_TERMINAL: u32 = 1;

/// Mirrors Node's `Stream::State` (see `node_quic_binding.rs` for the
/// `IDX_STATE_STREAM_*` offsets the JS layer reads).
#[repr(C)]
pub(crate) struct StreamState {
    pub(crate) id: i64,
    pub(crate) pending: u8,
    pub(crate) fin_sent: u8,
    pub(crate) fin_received: u8,
    pub(crate) read_ended: u8,
    pub(crate) write_ended: u8,
    pub reset: u8,
    pub(crate) reset_code: u64,
    pub(crate) has_outbound: u8,
    pub(crate) has_reader: u8,
    pub(crate) wants_block: u8,
    pub(crate) wants_headers: u8,
    pub(crate) wants_reset: u8,
    pub(crate) wants_trailers: u8,
    pub(crate) wants_stop_sending: u8,
    pub(crate) received_early_data: u8,
    pub(crate) write_desired_size: u32,
    pub(crate) high_water_mark: u32,
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

/// A stream with this many unread bytes stops raising its receive limit until JS has read half of them.
const INBOUND_HOLD_BYTES: usize = 256 * 1024;

/// Stream-id bit 1 selects the direction: 0 = bidirectional,
/// 1 = unidirectional (RFC 9000 §2.1).
const STREAM_ID_UNI_BIT: i64 = 0x2;

/// RFC 9218 §4.1 default Extensible HTTP Priority.
const DEFAULT_PRIORITY: (u8, bool) = (3, false);

const PULL_STATUS_EOS: f64 = 0.0;
const PULL_STATUS_DATA: f64 = 1.0;
const PULL_STATUS_BLOCKED: f64 = 2.0;
const PULL_STATUS_ERROR: f64 = -1.0;

/// Identifies a stream within its session. Keys are never reused, so unlike a pointer,
/// a stale key can't match a newer stream.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) struct Key(pub(super) u64);

#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub(super) enum PendingEnd {
    #[default]
    None,
    Fin,
    Trailers,
}

#[derive(Default)]
pub(super) struct Outbound {
    pub data: VecDeque<u8>,
    pub end: PendingEnd,
    pub started: bool,
}

impl Outbound {
    /// Drops the allocation too. `VecDeque::clear` would keep it until the stream is collected.
    fn free(&mut self) {
        self.data = VecDeque::new();
    }
    fn has_output(&self) -> bool {
        !self.data.is_empty() || self.end != PendingEnd::None
    }
}

#[derive(Default)]
pub(super) struct Inbound {
    pub chunks: VecDeque<Vec<u8>>,
    pub unread: usize,
    pub window_held: bool,
    pub ended: bool,
    pub errored: bool,
}

/// `#[repr(C)]` so `vtable` is at offset 0 — the C shim reads it via
/// `*(us_nq_vtable**)stream_ctx`. Without it Rust may reorder fields.
#[repr(C)]
pub(crate) struct QuicStream {
    /// MUST stay the first field — see `node_quic_shim.c`.
    vtable: *const lsquic::NqVtable,
    raw: Cell<*mut lsquic::lsquic_stream>,
    /// Owning session (raw pointer; the JS-side Strong keeps it alive).
    session: Cell<*mut QuicSession>,
    key: Key,
    session_js: JsCell<Option<Strong>>,
    this_value: JsCell<JsRef>,
    state: Cell<*mut StreamState>,
    stats: Cell<*mut u64>,
    pub(super) outbound: JsCell<Outbound>,
    inbound: JsCell<Inbound>,
    wakeup: JsCell<Option<Strong>>,
    peer_stop_sending_code: Cell<Option<u64>>,
    /// The codes of resetStream() and stopSending() calls made before the stream opened. bind_raw() applies them.
    reset_at_open: Cell<Option<u64>>,
    stop_sending_at_open: Cell<Option<u64>>,
    /// `open_stream` returned before lsquic opened the stream.
    was_pending: Cell<bool>,
    wrote_to_lsquic: Cell<bool>,
    headers_received: Cell<bool>,
    headers_sent: Cell<bool>,
    headers_refused: Cell<bool>,
    /// RFC 9218 (urgency, incremental).
    priority: Cell<(u8, bool)>,
    /// (nul-joined pairs, pair count, eos, frameless).
    pending_headers: JsCell<Vec<(Vec<u8>, c_int, bool, bool)>>,
    trailers_requested: Cell<bool>,
    blocked_reported: Cell<bool>,
    announce_suppressed: Cell<bool>,
    close_reported: Cell<bool>,
    unfinished_at_close: Cell<bool>,
    destroyed: Cell<bool>,
}

impl Drop for QuicStream {
    fn drop(&mut self) {
        if let Some(s) = self.ls() {
            // SAFETY: a non-null `raw` is live (see `ls()`).
            unsafe { s.set_ctx(null_mut()) };
        }
    }
}

impl QuicStream {
    pub(super) fn create(
        global: &JSGlobalObject,
        vtable: *const lsquic::NqVtable,
        session: *mut QuicSession,
        key: Key,
        session_handle: JSValue,
        raw: *mut lsquic::lsquic_stream,
    ) -> JsResult<(*mut QuicStream, JSValue)> {
        // `bind_raw` sets `raw` after the allocations below succeed.
        let stream = QuicStream {
            vtable,
            raw: Cell::new(null_mut()),
            session: Cell::new(session),
            key,
            session_js: JsCell::new(Some(Strong::create(session_handle, global))),
            this_value: JsCell::new(JsRef::empty()),
            state: Cell::new(null_mut()),
            stats: Cell::new(null_mut()),
            outbound: JsCell::new(Outbound::default()),
            inbound: JsCell::new(Inbound::default()),
            wakeup: JsCell::new(None),
            peer_stop_sending_code: Cell::new(None),
            reset_at_open: Cell::new(None),
            stop_sending_at_open: Cell::new(None),
            was_pending: Cell::new(false),
            wrote_to_lsquic: Cell::new(false),
            headers_received: Cell::new(false),
            headers_sent: Cell::new(false),
            headers_refused: Cell::new(false),
            priority: Cell::new(DEFAULT_PRIORITY),
            pending_headers: JsCell::new(Vec::new()),
            trailers_requested: Cell::new(false),
            blocked_reported: Cell::new(false),
            announce_suppressed: Cell::new(false),
            close_reported: Cell::new(false),
            unfinished_at_close: Cell::new(false),
            destroyed: Cell::new(false),
        };
        let this_value = stream.into_js_wrapper(global);
        let handle = this_value.to_js();
        let raw_ptr = this_value.payload_ptr().as_ptr();

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

        // SAFETY: the payload of `handle`.
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

    fn bind_raw(&self, raw: *mut lsquic::lsquic_stream) {
        self.raw.set(raw);
        // SAFETY: `raw` is the live stream lsquic just handed us.
        let s = unsafe { lsquic::Stream::from_raw(raw) }.expect("non-null stream");
        let id = s.id() as i64;
        self.with_state(|st| {
            st.id = id;
            st.pending = 0;
        });
        self.write_stat(IDX_STATS_OPENED_AT, super::now_ns());
        let pre_reset_code = s.error_code();
        if s.is_rejected() && self.peer_stop_sending_code.get().is_none() {
            self.peer_stop_sending_code.set(Some(pre_reset_code));
        }
        if s.reset_received() {
            self.mark_reset(pre_reset_code);
            if id & STREAM_ID_UNI_BIT == 0 {
                s.shutdown(0);
            } else {
                s.close();
            }
        }
        let uni = id & STREAM_ID_UNI_BIT != 0;
        let (urgency, incremental) = self.priority.get();
        if (urgency, incremental) != DEFAULT_PRIORITY {
            let _ = s.set_http_prio(urgency, incremental);
        }
        let want_write = self.send_pending_headers(s);
        // Not on HTTP/3, where either frame would get ahead of the stream's header blocks.
        if !self.session_ref().is_some_and(QuicSession::is_http) {
            if let Some(code) = self.stop_sending_at_open.take() {
                s.stop_sending(code);
            }
            if let Some(code) = self.reset_at_open.take() {
                s.reset(code);
            }
        }
        if uni {
            if self.is_receive_only() {
                self.with_state(|s| s.write_ended = 1);
                s.want_read(true);
            } else {
                self.inbound.with_mut(|i| i.ended = true);
                self.with_state(|s| s.read_ended = 1);
            }
        } else {
            s.want_read(true);
        }
        if want_write || self.outbound.get().started {
            self.request_write(s);
        }
    }

    /// The owning session, if still attached. The `session_js` Strong keeps
    /// the session's JS wrapper (and thus the `QuicSession` inside it) alive
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

    /// Sends one header block, or skips a `frameless` one. Returns true if the stream accepted it.
    fn put_header_block(
        &self,
        s: lsquic::Stream,
        bytes: &[u8],
        count: c_int,
        eos: bool,
        frameless: bool,
    ) -> bool {
        // lsquic resets a request stream whose FIN arrives before a header block, so skipping trailers needs one sent.
        if frameless
            && (!eos || self.headers_sent.get())
            && self.stream_id() & STREAM_ID_UNI_BIT == 0
            && self.with_state(|s| s.fin_sent == 0 && s.write_ended == 0)
        {
            return true;
        }
        let accepted = s.send_headers(bytes, count, eos) == 0;
        self.headers_refused.set(!accepted);
        if accepted {
            self.headers_sent.set(true);
        }
        accepted
    }

    /// lsquic can only queue a HEADERS frame behind sent data if the stream has flow-control credit for the frame's own header.
    fn must_wait_for_credit(&self, s: lsquic::Stream, frameless: bool) -> bool {
        !frameless && self.headers_sent.get() && s.write_avail() == 0
    }

    /// Sends the queued header blocks in order. Returns true if the stream needs a write event, to flush a block or to get credit for the next one.
    fn send_pending_headers(&self, s: lsquic::Stream) -> bool {
        let mut want_write = false;
        while let Some(&(_, _, _, frameless)) = self.pending_headers.get().first() {
            if self.must_wait_for_credit(s, frameless) {
                return true;
            }
            let (bytes, count, eos, _) = self.pending_headers.with_mut(|q| q.remove(0));
            self.wrote_to_lsquic.set(true);
            if self.put_header_block(s, &bytes, count, eos, frameless) {
                if eos {
                    self.with_state(|st| {
                        st.fin_sent = 1;
                        st.write_ended = 1;
                    });
                    s.shutdown(1);
                } else {
                    // lsquic only buffers the block, and the flush in drain_outbound needs a write event.
                    want_write = true;
                }
            } else {
                // sendHeaders() returned true when it queued this block, so `closed` reports the failure.
                self.fail_message(s);
            }
        }
        want_write
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
    pub(super) fn pre_reset_code(&self) -> Option<u64> {
        self.with_state(|s| (s.reset != 0).then_some(s.reset_code))
    }
    pub(super) fn peer_stop_sending_code(&self) -> Option<u64> {
        self.peer_stop_sending_code.get()
    }
    pub(super) fn mark_pending_if_unbound(&self) {
        if self.raw.get().is_null() {
            self.was_pending.set(true);
        }
    }
    pub(super) fn was_pending(&self) -> bool {
        self.was_pending.get()
    }
    pub(super) fn release_close_root(&self) {
        self.this_value.with_mut(|r| r.downgrade());
    }

    pub(super) fn mark_wrote_to_lsquic(&self) {
        self.wrote_to_lsquic.set(true);
    }

    pub(super) fn suppress_announce(&self) {
        self.announce_suppressed.set(true);
    }
    /// Closes the underlying lsquic stream without emitting anything the
    /// suppressed announce would have implied.
    pub(super) fn close_raw_silently(&self) {
        if let Some(s) = self.ls() {
            s.close();
        }
    }

    pub(super) fn is_announce_suppressed(&self) -> bool {
        self.announce_suppressed.get()
    }
    pub(super) fn has_undelivered_outbound(&self) -> bool {
        let out = self.outbound.get();
        if !out.data.is_empty()
            || out.end == PendingEnd::Fin
            || !self.pending_headers.get().is_empty()
        {
            return true;
        }
        self.ls().is_some_and(|s| s.has_unacked_data())
    }
    /// True until lsquic opens the stream.
    pub(super) fn is_pending(&self) -> bool {
        self.with_state(|s| s.pending != 0)
    }

    pub(super) fn stream_id(&self) -> i64 {
        self.with_state(|s| s.id)
    }

    /// Returns true for a unidirectional stream the peer opened. Bit 0 of the id is the initiator (RFC 9000 §2.1).
    fn is_receive_only(&self) -> bool {
        let id = self.stream_id();
        id >= 0
            && id & STREAM_ID_UNI_BIT != 0
            && self
                .session_ref()
                .is_some_and(|session| (id & 1 == 0) == session.is_server())
    }

    fn push_inbound(&self, data: &[u8], fin: bool) {
        if self.destroyed.get() {
            return;
        }
        self.inbound.with_mut(|inbound| {
            if !data.is_empty() {
                inbound.chunks.push_back(data.to_vec());
                inbound.unread += data.len();
            }
            if fin {
                inbound.ended = true;
            }
        });
        if !data.is_empty() {
            self.add_stat(IDX_STATS_BYTES_RECEIVED, data.len() as u64);
            self.write_stat(IDX_STATS_RECEIVED_AT, super::now_ns());
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

    /// `on_stream_read` drains lsquic, which returns the peer's credit. Holding the window ties the credit to what the application has read.
    fn update_window_hold(&self) {
        let changed = self.inbound.with_mut(|i| {
            let mark = if i.window_held {
                INBOUND_HOLD_BYTES / 2
            } else {
                INBOUND_HOLD_BYTES
            };
            let hold = i.unread >= mark;
            (core::mem::replace(&mut i.window_held, hold) != hold).then_some(hold)
        });
        let (Some(hold), Some(s)) = (changed, self.ls()) else {
            return;
        };
        s.hold_window(hold);
        if !hold {
            // Sends the MAX_STREAM_DATA that the release queued.
            if let Some(session) = self.session_ref() {
                session.schedule_process();
            }
        }
    }

    pub(super) fn take_wakeup(&self) -> Option<Strong> {
        self.wakeup.replace(None)
    }

    /// 0-RTT was rejected: Node destroys every stream opened during the
    /// early-data phase.
    pub(super) fn cancel_early_rejected(&self, code: u64) {
        self.mark_reset(code);
        self.discard_outbound();
        self.with_state(|st| st.write_ended = 1);
        if let Some(s) = self.ls() {
            // Node destroys it silently.
            s.shutdown_internal();
        }
    }

    pub(super) fn apply_peer_stop_sending(&self, code: u64) {
        // bit 1 of the id = uni per RFC 9000 §2.1
        let local_uni =
            self.stream_id() & STREAM_ID_UNI_BIT != 0 && self.with_state(|s| s.read_ended != 0);
        self.with_state(|s| {
            s.write_ended = 1;
            if local_uni && code != 0 && s.reset_code == 0 {
                s.reset_code = code;
            }
        });
        self.discard_outbound();
        // lsquic already queued its RESET_STREAM. Ending our write side lets the stream finish once that's acknowledged.
        if let Some(s) = self.ls() {
            if self.with_state(|st| st.read_ended != 0) {
                s.close();
            } else {
                s.shutdown(1);
            }
        }
    }

    /// Ends both directions of a stream whose HTTP/3 message is malformed (RFC 9114 §4.1.2).
    fn reset_malformed(&self) {
        const H3_MESSAGE_ERROR: u64 = 0x10e;
        if let Some(s) = self.ls() {
            // reset() ends the read side only if the peer has ended it, so STOP_SENDING stops the rest of the message.
            s.reset(H3_MESSAGE_ERROR);
            s.stop_sending(H3_MESSAGE_ERROR);
        }
        self.mark_reset(H3_MESSAGE_ERROR);
    }

    fn mark_reset(&self, code: u64) {
        if self.destroyed.get() {
            return;
        }
        self.inbound.with_mut(|inbound| {
            inbound.chunks.clear();
            inbound.unread = 0;
            inbound.errored = true;
            inbound.ended = true;
        });
        self.with_state(|s| {
            s.reset = 1;
            // First reset wins: lsquic re-resets rejected 0-RTT streams with
            // code 0 after cancel_early_rejected recorded the application
            // error node reports, which would erase it.
            if s.reset_code == 0 {
                s.reset_code = code;
            }
            s.read_ended = 1;
        });
    }

    /// Returns true if lsquic closed the stream before it finished on its own.
    pub(super) fn unfinished_at_close(&self) -> bool {
        self.unfinished_at_close.get()
    }
    pub(super) fn mark_close_reported(&self) -> bool {
        self.close_reported.replace(true)
    }
    fn mark_headers_received(&self) -> bool {
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
    pub(super) fn wants_stop_sending(&self) -> bool {
        self.with_state(|s| s.wants_stop_sending != 0)
    }
    fn note_write_blocked(&self) {
        if self.blocked_reported.replace(true) {
            return;
        }
        let session = self.session.get();
        if !session.is_null() {
            // SAFETY: the session outlives its streams.
            unsafe {
                (*session).push_event(SessionEvent::StreamBlocked { stream: self.key });
            }
        }
    }

    /// Drops everything that's still waiting to be sent. Every path that ends the write side calls this.
    fn discard_outbound(&self) {
        self.outbound.with_mut(|o| {
            o.free();
            o.end = PendingEnd::None;
        });
        // As in Node, a stream that isn't open yet still sends its queued header blocks when it opens.
        if !self.is_pending() {
            self.pending_headers.set(Vec::new());
        }
    }

    /// Resets an HTTP/3 stream whose message can't be sent.
    fn fail_message(&self, s: lsquic::Stream) {
        s.reset(H3_INTERNAL_ERROR);
        s.stop_sending(H3_INTERNAL_ERROR);
        self.mark_reset(H3_INTERNAL_ERROR);
        self.with_state(|st| st.write_ended = 1);
        self.discard_outbound();
    }

    fn drain_outbound(&self) {
        let Some(s) = self.ls() else { return };
        if self.headers_refused.get() && self.outbound.get().has_output() {
            // Neither a body nor a FIN can follow a header block that lsquic refused.
            self.fail_message(s);
            return;
        }
        // lsquic only buffers a block that it takes. The next write event flushes it and sends what waits behind it.
        if self.send_pending_headers(s) {
            return;
        }
        while !self.outbound.get().data.is_empty() {
            // lsquic copies what it accepts. Move the queue out of the cell so no borrow spans the call.
            let mut data = self.outbound.with_mut(|o| core::mem::take(&mut o.data));
            let offered = data.as_slices().0.len();
            let n = s.write(data.as_slices().0);
            data.drain(..usize::try_from(n).unwrap_or(0).min(offered));
            self.outbound.with_mut(|o| o.data = data);
            if n < 0 {
                // Not flow control, so no write event clears it. sendHeaders() re-arms a body that's waiting for its header block.
                s.want_write(false);
                break;
            }
            if n == 0 {
                self.note_write_blocked();
                break;
            }
            self.blocked_reported.set(false);
            self.wrote_to_lsquic.set(true);
            self.add_stat(IDX_STATS_BYTES_SENT, n as u64);
            if (n as usize) < offered {
                self.note_write_blocked();
                break;
            }
        }
        let (empty, end) = {
            let out = self.outbound.get();
            (out.data.is_empty(), out.end)
        };
        if empty {
            if end == PendingEnd::Fin {
                self.send_fin(s);
            } else if end == PendingEnd::Trailers && !self.trailers_requested.replace(true) {
                self.outbound.with_mut(Outbound::free);
                if let Some(session) = self.session_ref() {
                    session.push_event(SessionEvent::StreamWantsTrailers { stream: self.key });
                }
            }
            s.want_write(false);
        }
        s.flush();
        let pending = self.outbound.get().data.len() as u32;
        let (was_full, hwm) = self.with_state(|s| {
            let was_full = s.write_desired_size == 0 && s.has_outbound != 0;
            s.write_desired_size = s.high_water_mark.saturating_sub(pending);
            (was_full, s.high_water_mark)
        });
        if was_full && pending < hwm {
            if let Some(session) = self.session_ref() {
                session.push_event(SessionEvent::StreamDrain { stream: self.key });
            }
        }
    }

    fn send_fin(&self, s: lsquic::Stream) {
        s.shutdown(1);
        self.wrote_to_lsquic.set(true);
        self.discard_outbound();
        self.with_state(|s| s.fin_sent = 1);
        if self.stream_id() & STREAM_ID_UNI_BIT != 0 {
            s.shutdown(0);
        }
    }

    /// lsquic only gives a write event to a stream with flow-control credit, and a FIN needs none (RFC 9000 §4.1).
    fn request_write(&self, s: lsquic::Stream) {
        let bare_fin = {
            let out = self.outbound.get();
            out.end == PendingEnd::Fin && out.data.is_empty()
        };
        // HTTP/3 waits for the write event, because headers or trailers can still follow an ended body in the same turn.
        if bare_fin
            && self.with_state(|st| st.write_ended == 0)
            && !self.session_ref().is_some_and(QuicSession::is_http)
            && s.write_avail() == 0
        {
            self.send_fin(s);
        } else {
            s.want_write(true);
        }
    }

    fn kick_write(&self) {
        if let Some(s) = self.ls() {
            self.request_write(s);
        }
        if let Some(session) = self.session_ref() {
            session.schedule_process();
        }
    }

    pub(super) fn end_read_side(&self, global: &JSGlobalObject) {
        self.inbound.with_mut(|i| i.ended = true);
        self.with_state(|s| s.read_ended = 1);
        if let Some(wakeup) = self.take_wakeup() {
            let vm = global.bun_vm().as_mut();
            vm.event_loop_ref().run_callback(
                bun_event_loop::ContextId::NONE,
                wakeup.get(),
                global,
                JSValue::UNDEFINED,
                &[],
            );
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
            // The session's `streams` Vec is the only other holder; remove
            // it before downgrading so process_events can't iterate a freed
            // stream. SAFETY: as above.
            unsafe { (*session).remove_stream(self.key) };
        }
        self.outbound.with_mut(Outbound::free);
        self.pending_headers.set(Vec::new());
        // Received bytes stay readable, as in Node. Only a peer's reset discards them.
        self.inbound.with_mut(|i| i.ended = true);
        self.with_state(|s| s.read_ended = 1);
        if let Some(wakeup) = self.take_wakeup() {
            let vm = global.bun_vm().as_mut();
            vm.event_loop_ref().run_callback(
                bun_event_loop::ContextId::NONE,
                wakeup.get(),
                global,
                JSValue::UNDEFINED,
                &[],
            );
        }
        self.wakeup.set(None);
        self.session_js.set(None);
        self.this_value.with_mut(|r| r.downgrade());
    }

    /// Replaces `on_stream_close` after `QuicEndpoint::detach_for_finalize`.
    pub(super) unsafe extern "C" fn on_close_detached(
        ctx: *mut c_void,
        _s: *mut lsquic::lsquic_stream,
    ) {
        // SAFETY: `Drop` nulls the lsquic ctx, so a non-null ctx is live.
        // `session` may be freed, so only touch `raw`.
        if let Some(qs) = unsafe { super::ffi::ctx_ref::<QuicStream>(ctx) } {
            qs.raw.set(null_mut());
        }
    }

    pub(crate) fn get_reader<'a>(&self, this_value: JsWrapper<'a, Self>) -> JsWrapper<'a, Self> {
        self.with_state(|s| s.has_reader = 1);
        this_value
    }

    pub(crate) fn set_wakeup(&self, cx: &mut JsScope<'_>, callback: JsLocal<'_>) {
        let global = cx.global();
        let cb = callback.to_js();

        if cb.is_undefined_or_null() {
            self.wakeup.set(None);
        } else {
            self.wakeup.set(Some(Strong::create(cb, global)));
        }
    }

    pub(crate) fn pull(&self, cx: &mut JsScope<'_>, callback: JsLocal<'_>) -> JsResult<()> {
        let global = cx.global();
        let cb = callback.to_js();
        if !cb.is_callable() {
            return Ok(());
        }
        let (status, buffer) = self.inbound.with_mut(|inbound| {
            if inbound.errored {
                (PULL_STATUS_ERROR, None)
            } else if let Some(chunk) = inbound.chunks.pop_front() {
                inbound.unread -= chunk.len();
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
                self.update_window_hold();
                ArrayBuffer::create::<{ JSType::ArrayBuffer }>(global, &bytes)?
            }
            None => JSValue::UNDEFINED,
        };
        let vm = global.bun_vm().as_mut();
        vm.event_loop_ref().run_callback(
            bun_event_loop::ContextId::NONE,
            cb,
            global,
            JSValue::UNDEFINED,
            &[JSValue::js_number(status), buffer_js],
        );
        Ok(())
    }

    pub(crate) fn attach_source(&self, cx: &mut JsScope<'_>, source: JsLocal<'_>) -> JsResult<()> {
        let global = cx.global();
        // Node's `Stream::set_outbound` drops the source of a stream that isn't writable.
        if self.destroyed.get() || self.is_receive_only() {
            return Ok(());
        }
        let source = source.to_js();
        let body = if source.is_undefined_or_null() {
            None
        } else if let Some(buf) = source.as_array_buffer(global) {
            Some(buf)
        } else {
            return Err(global.throw(format_args!(
                "Unsupported QUIC stream body source (Blob and FileHandle sources are not implemented yet)"
            )));
        };
        self.outbound.with_mut(|o| {
            o.started = true;
            if let Some(body) = &body {
                o.data.extend(body.byte_slice());
            }
            o.end = PendingEnd::Fin;
        });
        self.with_state(|s| s.has_outbound = 1);
        self.kick_write();
        Ok(())
    }

    pub(crate) fn init_streaming_source<'a>(&self, heap: &JsHeap<'a>) -> bindgen::Result<'a, ()> {
        if self.destroyed.get() {
            return Ok(());
        }
        if self.is_receive_only() {
            return Err(heap.error_with_code(
                ErrorCode::INVALID_STATE,
                format_args!("Stream is not writable"),
            ));
        }
        self.outbound.with_mut(|o| o.started = true);
        self.with_state(|s| {
            s.has_outbound = 1;
            s.write_desired_size = s.high_water_mark;
        });
        Ok(())
    }

    pub(crate) fn write(&self, cx: &mut JsScope<'_>, batch: JsLocal<'_>) -> JsResult<JSValue> {
        let global = cx.global();
        if self.destroyed.get() {
            return Ok(JSValue::UNDEFINED);
        }
        let batch = batch.to_js();
        let mut queued: u64 = 0;
        let mut append = |bytes: &[u8]| {
            queued += bytes.len() as u64;
            self.outbound.with_mut(|o| o.data.extend(bytes));
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

    pub(crate) fn end_write(&self, _: &mut JsScope<'_>) {
        if self.destroyed.get() {
            return;
        }
        let wants_trailers = self.with_state(|s| s.wants_trailers != 0);
        self.outbound.with_mut(|o| {
            o.started = true;
            o.end = if wants_trailers {
                PendingEnd::Trailers
            } else {
                PendingEnd::Fin
            };
        });
        if let Some(session) = self.session_ref() {
            session.note_stream_write();
        }
        self.kick_write();
    }

    pub(crate) fn destroy(&self, cx: &mut JsScope<'_>, error: JsLocal<'_>) -> JsResult<()> {
        let global = cx.global();
        if self.destroyed.get() {
            return Ok(());
        }
        let arg = error.to_js();
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
                let deferred = self
                    .session_ref()
                    .is_some_and(|session| session.has_deferred_abort(s.raw()));
                if !deferred {
                    let send_ended = write_done || self.outbound.get().end != PendingEnd::None;
                    if code != 0 || !send_ended {
                        s.reset(code);
                    } else {
                        self.outbound.with_mut(|o| {
                            if o.end == PendingEnd::Trailers {
                                o.end = PendingEnd::None;
                            }
                        });
                        self.drain_outbound();
                        if self.outbound.get().data.is_empty()
                            && self.pending_headers.get().is_empty()
                        {
                            s.close();
                        } else {
                            s.reset(code);
                        }
                    }
                }
            }
        }
        let session = self.session.get();
        self.teardown(global);
        if !session.is_null() {
            // SAFETY: the session outlives its streams -- it stays registered
            // on the endpoint while any stream exists, so it cannot have been
            // finalized between teardown and here.
            unsafe { (*session).schedule_process() };
        }
        Ok(())
    }

    /// Returns false for a receive-only stream, which has nothing to reset.
    pub(crate) fn reset_stream(&self, _: &mut JsScope<'_>, code: JsLocal<'_>) -> bool {
        if self.destroyed.get() {
            return true;
        }
        if self.is_receive_only() {
            return false;
        }
        let code = error_code_arg(code.to_js());
        self.with_state(|s| {
            s.write_ended = 1;
            s.reset = 1;
            s.reset_code = code;
        });
        self.discard_outbound();
        match self.ls() {
            Some(s) => s.reset(code),
            None => self.reset_at_open.set(Some(code)),
        }
        self.kick_write();
        true
    }

    pub(crate) fn stop_sending(&self, _: &mut JsScope<'_>, code: JsLocal<'_>) {
        if self.destroyed.get() {
            return;
        }
        let code = error_code_arg(code.to_js());
        match self.ls() {
            Some(s) => s.stop_sending(code),
            None => self.stop_sending_at_open.set(Some(code)),
        }
        self.inbound.with_mut(|i| i.ended = true);
        self.with_state(|s| {
            s.read_ended = 1;
            // Mirrors Node treating the local stop as the close error.
            if s.reset_code == 0 {
                s.reset_code = code;
            }
        });
        self.kick_write();
    }

    /// Node parity for streams created and abandoned in one turn.
    pub(crate) fn abort_for_destroy(
        &self,
        _: &mut JsScope<'_>,
        stop_sending_code: JsLocal<'_>,
        reset_code: JsLocal<'_>,
    ) {
        if self.destroyed.get() {
            return;
        }
        let stop_sending_code = stop_sending_code.to_js();
        let reset_code = reset_code.to_js();
        let stop = (!stop_sending_code.is_empty_or_undefined_or_null())
            .then(|| error_code_arg(stop_sending_code));
        let reset =
            (!reset_code.is_empty_or_undefined_or_null()).then(|| error_code_arg(reset_code));
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
            self.discard_outbound();
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
    }

    pub(crate) fn set_priority(&self, cx: &mut JsScope<'_>, priority: JsLocal<'_>) -> JsResult<()> {
        let global = cx.global();
        let packed = priority.to_js().coerce_to_i32(global)? as u32;
        let (urgency, incremental) = ((packed >> 1) as u8, packed & 1 != 0);
        let previous = self.priority.replace((urgency, incremental));
        // Only an actual change goes on the wire: set_http_prio writes a
        // PRIORITY_UPDATE unconditionally where nghttp3 writes nothing, and a
        // node server answers one at its MAX_STREAMS edge with H3_ID_ERROR.
        if (urgency, incremental) != previous {
            if let Some(s) = self.ls() {
                let _ = s.set_http_prio(urgency, incremental);
            }
        }
        Ok(())
    }
    pub(crate) fn get_priority(&self) -> u32 {
        let (urgency, incremental) = self
            .ls()
            .and_then(|s| s.get_http_prio())
            .unwrap_or_else(|| self.priority.get());
        (u32::from(urgency) << 1) | u32::from(incremental)
    }
    pub(crate) fn send_headers(
        &self,
        cx: &mut JsScope<'_>,
        kind: JsLocal<'_>,
        headers: JsLocal<'_>,
        flags: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        if self.destroyed.get() {
            return Ok(JSValue::js_boolean(false));
        }
        let kind = kind.to_js();
        let headers = headers.to_js();
        let flags = flags.to_js();
        // `buildNgHeaderString` returns [nul-joined string, pair count]; the
        // count is what keeps the latin1 encode below unspliceable.
        let header_string = headers.get_index(global, 0)?;
        let header_count = headers.get_index(global, 1)?.coerce_to_i32(global)?;
        // Latin-1 on the wire, as node does (`StringBytes::Write(.., LATIN1)`).
        use crate::webcore::encoding::BunStringEncode as _;
        let bytes = bun_core::String::from_js(header_string, global)?
            .encode(crate::node::types::Encoding::Latin1);
        let kind = kind.coerce_to_i32(global)? as u32;
        let eos = kind == QUIC_STREAM_HEADERS_KIND_TRAILING
            || flags.coerce_to_i32(global)? & (QUIC_STREAM_HEADERS_FLAGS_TERMINAL as i32) != 0;
        // Node sends no HEADERS frame for hints or trailers without fields, and an ls-qpack peer closes the connection on one.
        let frameless = header_count == 0 && kind != QUIC_STREAM_HEADERS_KIND_INITIAL;
        let open = self.ls();
        let ready = open.filter(|&s| {
            self.pending_headers.get().is_empty() && !self.must_wait_for_credit(s, frameless)
        });
        let Some(s) = ready else {
            // Nothing can follow the end of the write side, whether it's sent or still queued.
            let ended = open.is_some() && self.with_state(|s| s.write_ended != 0);
            let queued = self.pending_headers.get();
            if ended || queued.last().is_some_and(|&(_, _, eos, _)| eos) {
                return Ok(JSValue::js_boolean(false));
            }
            self.pending_headers
                .with_mut(|q| q.push((bytes, header_count, eos, frameless)));
            self.with_state(|s| s.has_outbound = 1);
            if open.is_some() {
                self.note_write_blocked();
                self.kick_write();
            }
            return Ok(JSValue::js_boolean(true));
        };
        if self.put_header_block(s, &bytes, header_count, eos, frameless) {
            self.wrote_to_lsquic.set(true);
            self.with_state(|s| s.has_outbound = 1);
            if eos {
                self.with_state(|s| {
                    s.fin_sent = 1;
                    s.write_ended = 1;
                });
                s.shutdown(1);
                if let Some(session) = self.session_ref() {
                    session.schedule_process();
                }
            } else {
                self.kick_write();
            }
            Ok(JSValue::js_boolean(true))
        } else {
            if self.outbound.get().has_output() {
                self.kick_write();
            }
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
        return null_mut();
    }
    // SAFETY: as above.
    let session = unsafe { &*session_ptr };
    let id = stream.id();
    let is_local = (id & 1 == 0) != session.is_server();
    if is_local {
        if let Some(qs) = session.take_pending_local_stream(id & STREAM_ID_UNI_BIT as u64 != 0) {
            // SAFETY: pending streams are kept alive by their wrapper Strong.
            let pending = unsafe { &*qs };
            pending.bind_raw(s);
            session.push_event(SessionEvent::StreamReady {
                stream: pending.key,
                remote: false,
            });
            return qs.cast();
        }
        stream.shutdown_internal();
        return null_mut();
    }
    session.on_remote_stream(s).cast()
}

pub(super) unsafe extern "C" fn on_stream_read(ctx: *mut c_void, s: *mut lsquic::lsquic_stream) {
    // SAFETY: `s` is live for the duration of this lsquic callback.
    let Some(stream) = (unsafe { lsquic::Stream::from_raw(s) }) else {
        return;
    };
    if ctx.is_null() {
        let mut stack_buf = bun_core::vec::UninitBuf::<4096>::uninit();
        // SAFETY: lsquic only stores into the slice and the drained bytes are never read back.
        let buf = unsafe { stack_buf.as_bytes_mut() };
        while stream.read(buf) > 0 {}
        return;
    }
    // SAFETY: `ctx` is the live QuicStream we returned from on_new_stream.
    let qs = unsafe { &*ctx.cast::<QuicStream>() };
    // Returns false if a malformed header block reset the stream.
    let claim_header_sets = || -> bool {
        while let Some(hset) = stream.take_header_set() {
            let pairs = hset.pairs();
            let has_status = pairs
                .as_chunks::<2>()
                .0
                .iter()
                .find(|kv| kv[0] == b":status")
                .map(|kv| kv[1].len() == 3 && kv[1][0] == b'1');
            // A :status in a request is malformed: node's nghttp3 resets the
            // stream (RFC 9114 §4.1.2), and routing it to `oninfo` would leave
            // the request unanswered until the idle timeout.
            let peer_is_client = qs.session_ref().is_some_and(|s| s.is_server());
            if peer_is_client && has_status.is_some() {
                qs.reset_malformed();
                return false;
            }
            // 1xx interim responses are HINTS (RFC 9114 §4.1).
            let is_interim = has_status.unwrap_or(false);
            let kind = if is_interim {
                QUIC_STREAM_HEADERS_KIND_HINTS
            } else if qs.mark_headers_received() {
                QUIC_STREAM_HEADERS_KIND_INITIAL
            } else {
                QUIC_STREAM_HEADERS_KIND_TRAILING
            };
            if let Some(session) = qs.session_ref() {
                session.push_event(SessionEvent::StreamHeaders {
                    stream: qs.key,
                    pairs,
                    kind,
                });
            }
        }
        true
    };
    if stream.received_early_data() {
        qs.with_state(|s| s.received_early_data = 1);
    }
    let mut stack_buf = bun_core::vec::UninitBuf::<{ 16 * 1024 }>::uninit();
    // SAFETY: lsquic is the only writer of `buf`; each iteration reads back only `buf[..n]`.
    let buf = unsafe { stack_buf.as_bytes_mut() };
    let mut got_any = false;
    loop {
        // Until a header block is claimed, a read fails and sets no errno.
        if !claim_header_sets() {
            break;
        }
        let n = stream.read(buf);
        match n {
            n if n > 0 => {
                qs.push_inbound(&buf[..n as usize], false);
                got_any = true;
            }
            0 => {
                // lsquic returns 0 even if this read decoded one more header block.
                if !claim_header_sets() {
                    break;
                }
                qs.push_inbound(&[], true);
                stream.want_read(false);
                let write_done = qs.with_state(|s| s.fin_sent != 0 || s.write_ended != 0);
                if write_done {
                    stream.close();
                } else {
                    stream.shutdown(0);
                }
                got_any = true;
                break;
            }
            _ => {
                // lsquic resets a request above the id of a GOAWAY without on_reset,
                // and calls on_read on every tick until the stream is closed.
                if stream.reset_received() {
                    /// RFC 9114 §8.1: the server did no application processing.
                    const H3_REQUEST_REJECTED: u64 = 0x10b;
                    qs.mark_reset(H3_REQUEST_REJECTED);
                    stream.close();
                    if let Some(session) = qs.session_ref() {
                        session.push_event(SessionEvent::StreamReset {
                            stream: qs.key,
                            code: H3_REQUEST_REJECTED,
                        });
                    }
                    got_any = true;
                } else if bun_core::ffi::errno() == libc::EBADMSG
                    && qs
                        .session_ref()
                        .and_then(|session| session.conn())
                        .is_some_and(|conn| conn.status().0 != lsquic::LSCONN_ST_ERROR)
                {
                    // No frame error, which closes the connection: there's no header block where one belongs (RFC 9114 §4.1). lsquic calls on_read on every tick for this too.
                    qs.reset_malformed();
                }
                break;
            }
        }
    }
    if got_any {
        qs.update_window_hold();
        if let Some(session) = qs.session_ref() {
            session.push_event(SessionEvent::StreamWake { stream: qs.key });
        }
    }
}

lsquic_callback! {
    pub(super) fn on_stream_write(qs: &QuicStream, _s: *mut lsquic::lsquic_stream) {
        qs.drain_outbound();
    }

    pub(super) fn on_stream_close(qs: &QuicStream, _s: *mut lsquic::lsquic_stream) {
        qs.unfinished_at_close.set(qs.ls().is_some_and(|s| !s.is_finished()));
        // The lsquic_stream is freed immediately after this callback returns.
        qs.raw.set(null_mut());
        if let Some(session) = qs.session_ref() {
            session.push_event(SessionEvent::StreamClosed { stream: qs.key });
        }
    }

    pub(super) fn on_stream_reset(qs: &QuicStream, how: c_int, code: u64) {
        if how == 0 || how == 2 {
            qs.mark_reset(code);
            if let Some(s) = qs.ls() {
                // Node lets the application keep responding on a bidi stream.
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
                    stream: qs.key,
                    code,
                });
                session.push_event(SessionEvent::StreamWake { stream: qs.key });
            }
        }
        if how == 1 || how == 2 {
            // Node rejects only the STOP_SENDING caller's `closed`.
            qs.peer_stop_sending_code.set(Some(code));
            if let Some(session) = qs.session_ref() {
                // Node's `onstream` still observes a live writer.
                session.push_event(SessionEvent::StreamStopSending {
                    stream: qs.key,
                    code,
                });
                session.push_event(SessionEvent::StreamWake { stream: qs.key });
            } else {
                qs.apply_peer_stop_sending(code);
            }
        }
    }
}
