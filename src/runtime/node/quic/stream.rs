use core::cell::Cell;
use core::ffi::c_int;
use core::ptr::null_mut;
use std::collections::VecDeque;

use bun_jsc::bindgen::{JsLocal, JsPayload as _, JsScope, JsWrapper};
use bun_jsc::{
    ArrayBuffer, JSGlobalObject, JSType, JSValue, JsCell, JsRef, JsResult, StringJsc, Strong,
};
use bun_quic::http3::{Header, Indexing, Priority};
use bun_quic::{Connection, Direction, StreamEvent, StreamId, http3_code};

use super::endpoint::alloc_exposed_array_buffer;
use super::session::{QuicSession, SessionEvent};

pub(super) const QUIC_STREAM_HEADERS_KIND_HINTS: u32 = 0;
pub(super) const QUIC_STREAM_HEADERS_KIND_INITIAL: u32 = 1;
pub(super) const QUIC_STREAM_HEADERS_KIND_TRAILING: u32 = 2;
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
const MAX_JOINED_LEN: usize = 2048;

/// Stream-id bit 1 selects the direction: 0 = bidirectional,
/// 1 = unidirectional (RFC 9000 §2.1).
const STREAM_ID_UNI_BIT: i64 = 0x2;

const MAX_URGENCY: u32 = 7;
const MAX_HEADERS: c_int = 128;

const PULL_STATUS_EOS: f64 = 0.0;
const PULL_STATUS_DATA: f64 = 1.0;
const PULL_STATUS_BLOCKED: f64 = 2.0;
const PULL_STATUS_ERROR: f64 = -1.0;

/// Identifies a stream within its session. Keys are never reused, so unlike a pointer,
/// a stale key can't match a newer stream.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
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

#[derive(Default)]
pub(super) struct Inbound {
    /// The short ones are joined.
    pub chunks: VecDeque<Vec<u8>>,
    pub ended: bool,
    pub errored: bool,
    /// Something is missing before the end.
    pub truncated: bool,
    /// What arrives is dropped.
    pub abandoned: bool,
    pub is_being_read: bool,
}

struct PendingHeaders {
    joined: Vec<u8>,
    count: c_int,
    is_trailing: bool,
    is_last: bool,
}

pub(crate) struct QuicStream {
    /// `None` while pending or closed.
    id: Cell<Option<StreamId>>,
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
    /// The peer has opened it, and it can be answered.
    is_request: Cell<bool>,
    is_reset_empty: Cell<bool>,
    /// For when it is not pending any more.
    pending_reset: Cell<Option<u64>>,
    pending_stop: Cell<Option<u64>>,
    awaits_reader: Cell<bool>,
    priority: Cell<Priority>,
    pending_headers: JsCell<VecDeque<PendingHeaders>>,
    trailers_requested: Cell<bool>,
    blocked_reported: Cell<bool>,
    announce_suppressed: Cell<bool>,
    close_reported: Cell<bool>,
    destroyed: Cell<bool>,
}

impl QuicStream {
    pub(super) fn create<'a>(
        global: &JSGlobalObject,
        session: &'a QuicSession,
        key: Key,
        session_handle: JSValue,
    ) -> JsResult<(&'a QuicStream, JSValue)> {
        let stream = QuicStream {
            id: Cell::new(None),
            session: Cell::new(core::ptr::from_ref(session).cast_mut()),
            key,
            session_js: JsCell::new(Some(Strong::create(session_handle, global))),
            this_value: JsCell::new(JsRef::empty()),
            state: Cell::new(null_mut()),
            stats: Cell::new(null_mut()),
            outbound: JsCell::new(Outbound::default()),
            inbound: JsCell::new(Inbound::default()),
            wakeup: JsCell::new(None),
            is_request: Cell::new(false),
            is_reset_empty: Cell::new(false),
            pending_reset: Cell::new(None),
            pending_stop: Cell::new(None),
            awaits_reader: Cell::new(false),
            priority: Cell::default(),
            pending_headers: JsCell::new(VecDeque::new()),
            trailers_requested: Cell::new(false),
            blocked_reported: Cell::new(false),
            announce_suppressed: Cell::new(false),
            close_reported: Cell::new(false),
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

        // SAFETY: the payload of `handle`, which this frame holds. The strong ref set below roots
        // it until `teardown` or `release_close_root`; after that the frame that has the reference
        // holds it. Only `&` is formed to the payload before the sweeper drops it.
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
        let now = super::now_ns();
        this.write_stat(IDX_STATS_CREATED_AT, now);
        this.with_state(|s| {
            s.id = -1;
            s.pending = 1;
            s.high_water_mark = DEFAULT_HIGH_WATER_MARK;
        });
        Ok((this, handle))
    }

    pub(super) fn bind(&self, id: StreamId, is_local: bool) {
        self.id.set(Some(id));
        self.with_state(|st| {
            st.id = id.0 as i64;
            st.pending = 0;
        });
        self.write_stat(IDX_STATS_OPENED_AT, super::now_ns());
        let context = core::ptr::from_ref(self).cast_mut().cast();
        self.update(|conn, id| {
            conn.set_stream_context(id, context);
            if is_local {
                conn.set_priority(id, self.priority.get());
            }
        });
        self.write_pending_headers();
        self.abort(self.pending_stop.get(), self.pending_reset.get());
        match (id.direction(), is_local) {
            (Direction::Bidirectional, _) => self.is_request.set(!is_local),
            (Direction::Unidirectional, true) => {
                self.inbound.with_mut(|i| i.ended = true);
                self.with_state(|s| s.read_ended = 1);
            }
            (Direction::Unidirectional, false) => self.with_state(|s| s.write_ended = 1),
        }
        if self.outbound.get().started {
            self.want_write();
        }
    }

    pub(super) fn abort(&self, stop: Option<u64>, reset: Option<u64>) {
        self.update(|conn, id| {
            stop.inspect(|&code| conn.stop(id, code));
            reset.inspect(|&code| conn.reset(id, code));
        });
    }

    fn write_pending_headers(&self) {
        let has_body = !self.outbound.get().data.is_empty();
        while let Some(headers) =
            (self.pending_headers).with_mut(|q| q.pop_front_if(|it| !(it.is_trailing && has_body)))
        {
            if !self.write_headers(&headers) {
                // sendHeaders() returned true when it queued this block, so
                // `closed` is what reports the failure.
                let code = http3_code::INTERNAL_ERROR;
                self.abort(Some(code), Some(code));
                self.mark_reset(code);
                self.end_write_side();
            }
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
    fn get<T>(&self, f: impl FnOnce(&Connection, StreamId) -> Option<T>) -> Option<T> {
        let id = self.id.get()?;
        self.session_ref()?.get(|conn| f(conn, id))?
    }
    fn update<T>(&self, f: impl FnOnce(&mut Connection, StreamId) -> T) -> Option<T> {
        let id = self.id.get()?;
        self.session_ref()?.update(|conn| f(conn, id))
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
    pub(super) fn is_reset(&self) -> bool {
        self.with_state(|s| s.reset != 0)
    }
    pub(super) fn has_received(&self) -> bool {
        self.read_stat(IDX_STATS_BYTES_RECEIVED) > 0
    }
    /// The peer gave up on both halves before it used them.
    pub(super) fn arrived_spent(&self) -> bool {
        self.id.get().is_none() && self.is_request.get() && self.is_reset_empty.get()
    }
    pub(super) fn release_close_root(&self) {
        self.this_value.with_mut(|r| r.downgrade());
    }

    pub(super) fn suppress_announce(&self) {
        self.announce_suppressed.set(true);
    }

    pub(super) fn is_announce_suppressed(&self) -> bool {
        self.announce_suppressed.get()
    }
    pub(super) fn has_undelivered_outbound(&self) -> bool {
        let out = self.outbound.get();
        if !out.data.is_empty() || out.end == PendingEnd::Fin {
            return true;
        }
        (self.get(Connection::stream_info)).is_some_and(|it| it.has_unacked_data)
    }
    pub(super) fn is_pending(&self) -> bool {
        self.with_state(|s| s.pending != 0)
    }

    pub(super) fn stream_id(&self) -> i64 {
        self.with_state(|s| s.id)
    }

    fn push_inbound(&self, data: Vec<u8>, fin: bool) {
        let len = data.len() as u64;
        self.inbound.with_mut(|inbound| {
            match inbound.chunks.back_mut() {
                _ if inbound.abandoned => {}
                Some(last) if last.len() + data.len() <= MAX_JOINED_LEN => last.extend(data),
                _ if data.is_empty() => {}
                _ => inbound.chunks.push_back(data),
            }
            inbound.ended |= fin;
        });
        if len > 0 {
            self.add_stat(IDX_STATS_BYTES_RECEIVED, len);
            self.write_stat(IDX_STATS_RECEIVED_AT, super::now_ns());
            let acc = self.read_stat(IDX_STATS_BYTES_ACCUMULATED) + len;
            self.write_stat(IDX_STATS_BYTES_ACCUMULATED, acc);
            self.write_stat(
                IDX_STATS_MAX_BYTES_ACCUMULATED,
                self.read_stat(IDX_STATS_MAX_BYTES_ACCUMULATED).max(acc),
            );
        }
        if fin {
            self.with_state(|s| s.fin_received = 1);
        }
        self.release_unclaimed();
    }

    /// A request that has been answered may never be read, which must not hold up the peer for good.
    fn release_unclaimed(&self) {
        if self.inbound.get().abandoned {
            self.drop_inbound();
            self.update(|conn, id| conn.consume(id, usize::MAX));
        } else if !self.awaits_reader.get()
            && self.holds_up_peer()
            && let Some(session) = self.session_ref()
        {
            session.await_readers();
        }
    }

    fn holds_up_peer(&self) -> bool {
        self.is_request.get()
            && !self.inbound.get().ended
            && self.with_state(|s| s.has_reader == 0 && (s.fin_sent != 0 || s.write_ended != 0))
            && (self.get(Connection::stream_info)).is_some_and(|it| it.is_short_of_credit)
    }

    /// Returns whether it starts to.
    pub(super) fn await_reader(&self) -> bool {
        self.holds_up_peer() && !self.awaits_reader.replace(true)
    }

    pub(super) fn stop_if_unclaimed(&self, code: u64) {
        self.awaits_reader.set(false);
        if self.holds_up_peer() {
            self.drop_inbound();
            self.inbound.with_mut(|i| i.ended = true);
            self.update(|conn, id| conn.stop(id, code));
        }
    }

    fn drop_inbound(&self) {
        self.inbound.with_mut(|i| {
            i.truncated |= !i.ended || !i.chunks.is_empty();
            i.chunks = VecDeque::new();
            i.abandoned = true;
        });
        self.write_stat(IDX_STATS_BYTES_ACCUMULATED, 0);
    }

    /// Like in Node, there is nothing to read from a stream that is destroyed, but a reader has to learn of the loss.
    fn destroy_inbound(&self) {
        self.drop_inbound();
        self.inbound.with_mut(|i| {
            i.truncated &= i.is_being_read;
            i.ended = true;
        });
    }

    pub(super) fn take_wakeup(&self) -> Option<Strong> {
        self.wakeup.replace(None)
    }

    /// 0-RTT was rejected: Node destroys every stream opened during the
    /// early-data phase.
    pub(super) fn cancel_early_rejected(&self, code: u64) {
        self.mark_reset(code);
        self.end_write_side();
    }

    /// Nothing more is written, so nobody has to wait for room.
    fn end_write_side(&self) {
        self.discard_outbound();
        self.pending_headers.with_mut(VecDeque::clear);
        let was_full = self.with_state(|s| {
            s.write_ended = 1;
            core::mem::replace(&mut s.write_desired_size, s.high_water_mark) == 0
                && s.has_outbound != 0
        });
        if was_full {
            self.push_event(SessionEvent::StreamDrain { stream: self.key });
        }
        self.release_unclaimed();
    }

    fn discard_outbound(&self) {
        self.outbound.with_mut(|o| {
            o.data = VecDeque::new();
            o.end = PendingEnd::None;
        });
    }

    pub(super) fn apply_peer_stop_sending(&self, code: u64) {
        // bit 1 of the id = uni per RFC 9000 §2.1
        let local_uni =
            self.stream_id() & STREAM_ID_UNI_BIT != 0 && self.with_state(|s| s.read_ended != 0);
        self.end_write_side();
        self.with_state(|s| {
            if local_uni && code != 0 && s.reset_code == 0 {
                s.reset_code = code;
            }
        });
    }

    fn mark_reset(&self, code: u64) {
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
            if s.reset_code == 0 {
                s.reset_code = code;
            }
            s.read_ended = 1;
        });
    }

    pub(super) fn mark_close_reported(&self) -> bool {
        self.close_reported.replace(true)
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
    fn note_write_blocked(&self) {
        if self.blocked_reported.replace(true) {
            return;
        }
        self.push_event(SessionEvent::StreamBlocked { stream: self.key });
    }

    fn push_event(&self, event: SessionEvent) {
        if let Some(session) = self.session_ref() {
            session.push_event(event);
        }
    }

    pub(super) fn drain_outbound(&self) {
        loop {
            let (front, _) = self.outbound.get().data.as_slices();
            if front.is_empty() {
                break;
            }
            let Some(n) = self.update(|conn, id| conn.write(id, front)).flatten() else {
                return;
            };
            let is_short = n < front.len();
            if n > 0 {
                self.blocked_reported.set(false);
                self.outbound.with_mut(|out| drop(out.data.drain(..n)));
                self.add_stat(IDX_STATS_BYTES_SENT, n as u64);
            }
            if is_short {
                self.note_write_blocked();
                break;
            }
        }
        self.write_pending_headers();
        let (empty, end) = {
            let out = self.outbound.get();
            (out.data.is_empty(), out.end)
        };
        if empty && end == PendingEnd::Fin {
            self.update(Connection::finish);
            self.discard_outbound();
            self.with_state(|s| s.fin_sent = 1);
            self.release_unclaimed();
        } else if empty && end == PendingEnd::Trailers && !self.trailers_requested.replace(true) {
            self.push_event(SessionEvent::StreamWantsTrailers { stream: self.key });
        }
        let pending = self.queued_len();
        let (was_full, hwm) = self.with_state(|s| {
            let was_full = s.write_desired_size == 0 && s.has_outbound != 0;
            s.write_desired_size = s.high_water_mark.saturating_sub(pending);
            (was_full, s.high_water_mark)
        });
        if was_full && pending < hwm {
            self.update(|conn, id| conn.await_data(id, true));
            self.push_event(SessionEvent::StreamDrain { stream: self.key });
        }
    }

    pub(super) fn on_drain_delivered(&self) {
        self.update(|conn, id| conn.await_data(id, false));
    }

    fn queued_len(&self) -> u32 {
        (self.outbound.get().data.len().try_into()).unwrap_or(u32::MAX)
    }

    fn want_write(&self) {
        let out = self.outbound.get();
        if !out.data.is_empty() {
            self.update(Connection::want_write);
        } else if out.end != PendingEnd::None && self.id.get().is_some() {
            self.push_event(SessionEvent::StreamEnd { stream: self.key });
        }
    }

    fn kick_write(&self) {
        self.want_write();
        if let Some(session) = self.session_ref() {
            session.schedule_process();
        }
    }

    pub(super) fn end_read_side(&self, global: &JSGlobalObject) {
        self.inbound.with_mut(|i| i.ended = true);
        self.with_state(|s| s.read_ended = 1);
        if let Some(wakeup) = self.take_wakeup() {
            let vm = global.bun_vm();
            vm.event_loop().run_callback(
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
        // Events can come after this object has been collected.
        self.update(|conn, id| conn.set_stream_context(id, null_mut()));
        self.id.set(None);
        // SAFETY: streams are kept alive by their wrapper Strong; the
        // session is alive (session_js Strong still held below).
        let session = self.session.replace(null_mut());
        if !session.is_null() {
            // The session's `streams` Vec is the only other holder; remove
            // it before downgrading so process_events can't iterate a freed
            // stream. SAFETY: as above.
            unsafe { (*session).remove_stream(self.key) };
        }
        self.discard_outbound();
        self.destroy_inbound();
        self.with_state(|s| s.read_ended = 1);
        if let Some(wakeup) = self.take_wakeup() {
            let vm = global.bun_vm();
            vm.event_loop().run_callback(
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

    pub(crate) fn get_reader<'a>(&self, this_value: JsWrapper<'a, Self>) -> JsWrapper<'a, Self> {
        self.with_state(|s| s.has_reader = 1);
        this_value
    }

    pub(crate) fn set_wakeup(&self, cx: &mut JsScope<'_>, callback: JsLocal<'_>) {
        let global = cx.global();
        let cb = callback.to_js();

        if cb.is_undefined_or_null() {
            // There is only ever one reader.
            self.wakeup.set(None);
            self.drop_inbound();
            self.release_unclaimed();
            if let Some(session) = self.session_ref() {
                session.mark_pending();
            }
        } else {
            self.wakeup.set(Some(Strong::create(cb, global)));
            self.inbound.with_mut(|i| i.is_being_read = true);
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
                (PULL_STATUS_DATA, Some(chunk))
            } else if inbound.ended && inbound.truncated {
                (PULL_STATUS_ERROR, None)
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
                if self.id.get().is_some()
                    && let Some(session) = self.session_ref()
                {
                    self.update(|conn, id| conn.consume(id, bytes.len()));
                    session.mark_pending();
                }
                ArrayBuffer::create::<{ JSType::ArrayBuffer }>(global, &bytes)?
            }
            None => JSValue::UNDEFINED,
        };
        let vm = global.bun_vm();
        vm.event_loop().run_callback(
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
        if self.destroyed.get() || self.with_state(|s| s.write_ended != 0) {
            return Ok(());
        }
        let source = source.to_js();
        let bytes = if source.is_undefined_or_null() {
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
            match o.data.is_empty() {
                true => o.data = bytes.into(),
                false => o.data.extend(bytes),
            }
            o.end = PendingEnd::Fin;
        });
        self.with_state(|s| s.has_outbound = 1);
        self.kick_write();
        Ok(())
    }

    pub(crate) fn init_streaming_source(&self) {
        if self.destroyed.get() {
            return;
        }
        self.outbound.with_mut(|o| o.started = true);
        self.with_state(|s| {
            s.has_outbound = 1;
            s.write_desired_size = s.high_water_mark;
        });
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
        let pending = self.queued_len();
        self.with_state(|s| s.write_desired_size = s.high_water_mark.saturating_sub(pending));
        self.kick_write();
        Ok(JSValue::js_number(queued as f64))
    }

    pub(crate) fn end_write(&self, _: &mut JsScope<'_>) {
        if self.destroyed.get() || self.with_state(|s| s.write_ended != 0) {
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
        if !cascading && self.id.get().is_some() {
            let send_ended = write_done || self.outbound.get().end != PendingEnd::None;
            if code == 0 && send_ended {
                self.outbound.with_mut(|o| {
                    if o.end == PendingEnd::Trailers {
                        o.end = PendingEnd::None;
                    }
                });
                self.drain_outbound();
            }
            if code == 0 && send_ended && self.outbound.get().data.is_empty() {
                self.update(|conn, id| {
                    conn.finish(id);
                    conn.stop(id, http3_code::NO_ERROR);
                });
            } else {
                self.update(|conn, id| conn.reset(id, code));
            }
        }
        let (session, _root) = (self.session_ref(), self.session_js.replace(None));
        self.teardown(global);
        if let Some(session) = session {
            session.schedule_process();
        }
        Ok(())
    }

    pub(crate) fn reset_stream(&self, _: &mut JsScope<'_>, code: JsLocal<'_>) {
        if self.destroyed.get() {
            return;
        }
        let code = error_code_arg(code.to_js());
        self.with_state(|s| {
            s.reset = 1;
            s.reset_code = code;
        });
        self.end_write_side();
        self.pending_reset.set(Some(code));
        self.update(|conn, id| conn.reset(id, code));
        self.kick_write();
    }

    pub(crate) fn stop_sending(&self, _: &mut JsScope<'_>, code: JsLocal<'_>) {
        if self.destroyed.get() {
            return;
        }
        let code = error_code_arg(code.to_js());
        self.pending_stop.set(Some(code));
        self.update(|conn, id| conn.stop(id, code));
        self.inbound.with_mut(|i| i.ended = true);
        self.with_state(|s| {
            s.read_ended = 1;
            // Mirrors Node treating the local stop as the close error.
            if s.reset_code == 0 {
                s.reset_code = code;
            }
        });
        self.push_event(SessionEvent::StreamWake { stream: self.key });
        self.kick_write();
    }

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
            self.destroy_inbound();
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
            self.pending_headers.with_mut(VecDeque::clear);
        }
        self.abort(stop, reset);
        self.kick_write();
    }

    pub(crate) fn set_priority(&self, cx: &mut JsScope<'_>, priority: JsLocal<'_>) -> JsResult<()> {
        let packed = priority.to_js().coerce_to_i32(cx.global())? as u32;
        let priority = Priority {
            urgency: (packed >> 1).min(MAX_URGENCY) as u8,
            is_incremental: packed & 1 != 0,
        };
        self.priority.set(priority);
        self.update(|conn, id| conn.set_priority(id, priority));
        if let Some(session) = self.session_ref() {
            session.mark_pending();
        }
        Ok(())
    }
    pub(crate) fn get_priority(&self) -> u32 {
        let priority = (self.get(Connection::priority)).unwrap_or_else(|| self.priority.get());
        (u32::from(priority.urgency) << 1) | u32::from(priority.is_incremental)
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
        let joined = bun_core::String::from_js(header_string, global)?
            .encode(crate::node::types::Encoding::Latin1);
        let is_trailing = kind.coerce_to_i32(global)? as u32 == QUIC_STREAM_HEADERS_KIND_TRAILING;
        let headers = PendingHeaders {
            joined,
            count: header_count,
            is_trailing,
            is_last: is_trailing
                || flags.coerce_to_i32(global)? & (QUIC_STREAM_HEADERS_FLAGS_TERMINAL as i32) != 0,
        };
        if self.id.get().is_none() || is_trailing && !self.outbound.get().data.is_empty() {
            self.pending_headers.with_mut(|q| q.push_back(headers));
            self.with_state(|s| s.has_outbound = 1);
            return Ok(JSValue::js_boolean(true));
        }
        let is_sent = self.write_headers(&headers);
        if is_sent {
            self.with_state(|s| s.has_outbound = 1);
            self.kick_write();
        }
        Ok(JSValue::js_boolean(is_sent))
    }

    fn write_headers(&self, headers: &PendingHeaders) -> bool {
        let (Some(id), Some(session)) = (self.id.get(), self.session_ref()) else {
            return false;
        };
        let fields = split_headers(&headers.joined, headers.count);
        if !fields.is_some_and(|it| session.send_headers(id, &it)) {
            return false;
        }
        if headers.is_last {
            self.with_state(|s| s.fin_sent = 1);
            self.update(Connection::finish);
            self.end_write_side();
        }
        true
    }

    pub(super) fn on_event(&self, session: &QuicSession, event: StreamEvent) {
        let stream = self.key;
        match event {
            StreamEvent::Opened => {}
            StreamEvent::Headers(fields) => {
                self.note_early_data(session);
                session.push_event(SessionEvent::StreamHeaders { stream, fields });
            }
            StreamEvent::Data { data, is_last } => {
                self.note_early_data(session);
                self.push_inbound(data, is_last);
                session.push_event(SessionEvent::StreamWake { stream });
            }
            StreamEvent::Writable => self.drain_outbound(),
            StreamEvent::Reset(code) => {
                let info = self.get(Connection::stream_info);
                self.is_reset_empty.set(info.is_some_and(|it| it.is_empty));
                self.mark_reset(code);
                session.push_event(SessionEvent::StreamReset { stream, code });
                session.push_event(SessionEvent::StreamWake { stream });
            }
            StreamEvent::Stopped(code) => {
                // Node's `onstream` still observes a live writer.
                session.push_event(SessionEvent::StreamStopSending { stream, code });
                session.push_event(SessionEvent::StreamWake { stream });
            }
            StreamEvent::Closed => {
                self.inbound.with_mut(|it| it.truncated |= !it.ended);
                self.id.set(None);
                session.push_event(SessionEvent::StreamClosed { stream });
            }
        }
    }

    fn note_early_data(&self, session: &QuicSession) {
        if session.accepts_early_data()
            && (self.get(Connection::stream_info)).is_some_and(|it| it.has_early_data)
        {
            self.with_state(|s| s.received_early_data = 1);
        }
    }
}

/// Each field is a name, NUL, a value, NUL and a byte of flags. `count` is authoritative: the Latin-1 encoding
/// turns some code points into NUL, which would splice extra fields out of a value.
fn split_headers(mut joined: &[u8], count: c_int) -> Option<Vec<Header<'_>>> {
    const NEVER_INDEX: u8 = 1;
    (0..=MAX_HEADERS).contains(&count).then_some(())?;
    let headers = (0..count).map(|_| {
        let (name, rest) = bun_core::strings::split_once_char(joined, 0)?;
        let (value, rest) = bun_core::strings::split_once_char(rest, 0)?;
        joined = rest;
        Some(Header {
            name,
            value,
            static_index: None,
            indexing: match joined.split_off_first() {
                Some(flags) if flags & NEVER_INDEX != 0 => Indexing::Never,
                _ => Indexing::Allowed,
            },
        })
    });
    let headers: Option<Vec<_>> = headers.collect();
    headers.filter(|_| joined.is_empty())
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
