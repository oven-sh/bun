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

const QUIC_STREAM_HEADERS_KIND_HINTS: u32 = 0;
const QUIC_STREAM_HEADERS_KIND_INITIAL: u32 = 1;
const QUIC_STREAM_HEADERS_KIND_TRAILING: u32 = 2;
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

/// RFC 9218 §4.1 default Extensible HTTP Priority.
const DEFAULT_PRIORITY: (u8, bool) = (3, false);

const PULL_STATUS_EOS: f64 = 0.0;
const PULL_STATUS_DATA: f64 = 1.0;
const PULL_STATUS_BLOCKED: f64 = 2.0;
const PULL_STATUS_ERROR: f64 = -1.0;

#[derive(Default)]
pub(super) struct Outbound {
    pub data: VecDeque<u8>,
    pub fin_pending: bool,
    pub trailers_pending: bool,
    pub started: bool,
}

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
    raw: Cell<*mut lsquic::lsquic_stream>,
    /// Owning session (raw pointer; the JS-side Strong keeps it alive).
    session: Cell<*mut QuicSession>,
    session_js: JsCell<Option<Strong>>,
    this_value: JsCell<JsRef>,
    state: Cell<*mut StreamState>,
    stats: Cell<*mut u64>,
    pub(super) outbound: JsCell<Outbound>,
    pub(super) inbound: JsCell<Inbound>,
    wakeup: JsCell<Option<Strong>>,
    peer_stop_sending_code: Cell<Option<u64>>,
    wrote_to_lsquic: Cell<bool>,
    headers_received: Cell<bool>,
    /// RFC 9218 (urgency, incremental).
    priority: Cell<(u8, bool)>,
    pending_headers: JsCell<Vec<(Vec<u8>, c_int, bool)>>,
    trailers_requested: Cell<bool>,
    blocked_reported: Cell<bool>,
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
        // Bit 0 of the id is the initiator (RFC 9000 §2.1).
        let uni = id & STREAM_ID_UNI_BIT != 0;
        let (urgency, incremental) = self.priority.get();
        if (urgency, incremental) != DEFAULT_PRIORITY {
            let _ = s.set_http_prio(urgency, incremental);
        }
        for (bytes, count, eos) in self.pending_headers.with_mut(core::mem::take) {
            self.wrote_to_lsquic.set(true);
            if s.send_headers(&bytes, count, eos) == 0 && eos {
                self.with_state(|st| {
                    st.fin_sent = 1;
                    st.write_ended = 1;
                });
                s.shutdown(1);
            }
        }
        if uni {
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
    pub(super) fn pre_reset_code(&self) -> Option<u64> {
        self.with_state(|s| (s.reset != 0).then_some(s.reset_code))
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
        if !out.data.is_empty() || out.fin_pending {
            return true;
        }
        self.ls().is_some_and(|s| s.has_unacked_data())
    }

    pub(super) fn stream_id(&self) -> i64 {
        self.with_state(|s| s.id)
    }

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

    pub(super) fn take_wakeup(&self) -> Option<Strong> {
        self.wakeup.replace(None)
    }

    /// 0-RTT was rejected: Node destroys every stream opened during the
    /// early-data phase.
    pub(super) fn cancel_early_rejected(&self, code: u64) {
        self.mark_reset(code);
        self.outbound.with_mut(|o| {
            o.data.clear();
            o.fin_pending = false;
            o.trailers_pending = false;
        });
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
            // First reset wins: lsquic re-resets rejected 0-RTT streams with
            // code 0 after cancel_early_rejected recorded the application
            // error node reports, which would erase it.
            if s.reset_code == 0 {
                s.reset_code = code;
            }
            s.read_ended = 1;
        });
    }

    pub(super) fn mark_close_reported(&self) -> bool {
        self.close_reported.replace(true)
    }
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
        let pending = self.outbound.get().data.len() as u32;
        let (was_full, hwm) = self.with_state(|s| {
            let was_full = s.write_desired_size == 0 && s.has_outbound != 0;
            s.write_desired_size = s.high_water_mark.saturating_sub(pending);
            (was_full, s.high_water_mark)
        });
        if was_full && pending < hwm {
            if let Some(session) = self.session_ref() {
                session.push_event(SessionEvent::StreamDrain {
                    stream: core::ptr::from_ref(self).cast_mut(),
                });
            }
        }
    }

    fn kick_write(&self) {
        if let Some(s) = self.ls() {
            s.want_write(true);
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
            // The session's `streams` Vec is the only other holder; remove
            // it before downgrading so process_events can't iterate a freed
            // stream. SAFETY: as above.
            unsafe { (*session).remove_stream(core::ptr::from_ref(self).cast_mut()) };
        }
        self.outbound.with_mut(|o| o.data.clear());
        self.inbound.with_mut(|i| {
            i.chunks.clear();
            i.ended = true;
        });
        self.with_state(|s| s.read_ended = 1);
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
                let deferred = self
                    .session_ref()
                    .is_some_and(|session| session.has_deferred_abort(s.raw()));
                if !deferred {
                    let send_ended = write_done || {
                        let out = self.outbound.get();
                        out.fin_pending || out.trailers_pending
                    };
                    if code != 0 || !send_ended {
                        s.reset(code);
                    } else {
                        self.outbound.with_mut(|o| o.trailers_pending = false);
                        self.drain_outbound();
                        if self.outbound.get().data.is_empty() {
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
        self.outbound.with_mut(|o| {
            o.data.clear();
            o.fin_pending = false;
            o.trailers_pending = false;
        });
        if let Some(s) = self.ls() {
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
            // Mirrors Node treating the local stop as the close error.
            if s.reset_code == 0 {
                s.reset_code = code;
            }
        });
        self.kick_write();
        Ok(JSValue::UNDEFINED)
    }

    /// Node parity for streams created and abandoned in one turn.
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
        let previous = self.priority.replace((urgency, incremental));
        // Only an actual change goes on the wire: set_http_prio writes a
        // PRIORITY_UPDATE unconditionally where nghttp3 writes nothing, and a
        // node server answers one at its MAX_STREAMS edge with H3_ID_ERROR.
        if (urgency, incremental) != previous {
            if let Some(s) = self.ls() {
                let _ = s.set_http_prio(urgency, incremental);
            }
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
        // `buildNgHeaderString` returns [nul-joined string, pair count]; the
        // count is what keeps the latin1 encode below unspliceable.
        let header_string = header_tuple.get_index(global, 0)?;
        let header_count = header_tuple.get_index(global, 1)?.coerce_to_i32(global)?;
        // Latin-1 on the wire, as node does (`StringBytes::Write(.., LATIN1)`).
        use crate::webcore::encoding::BunStringEncode as _;
        let bytes = bun_core::String::from_js(header_string, global)?
            .encode(crate::node::types::Encoding::Latin1);
        let is_trailing =
            kind_arg.coerce_to_i32(global)? as u32 == QUIC_STREAM_HEADERS_KIND_TRAILING;
        let eos = is_trailing
            || flags.coerce_to_i32(global)? & (QUIC_STREAM_HEADERS_FLAGS_TERMINAL as i32) != 0;
        let Some(s) = self.ls() else {
            self.pending_headers
                .with_mut(|q| q.push((bytes, header_count, eos)));
            self.with_state(|s| s.has_outbound = 1);
            return Ok(JSValue::js_boolean(true));
        };
        let rv = s.send_headers(&bytes, header_count, eos);
        if rv == 0 {
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
            unsafe { (*qs).bind_raw(s) };
            session.push_event(SessionEvent::StreamReady {
                stream: qs,
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
        let mut buf = [0u8; 4096];
        while stream.read(&mut buf) > 0 {}
        return;
    }
    // SAFETY: `ctx` is the live QuicStream we returned from on_new_stream.
    let qs = unsafe { &*ctx.cast::<QuicStream>() };
    if let Some(hset) = stream.take_header_set() {
        let pairs = hset.pairs();
        /// RFC 9114 §8.1 H3_MESSAGE_ERROR — malformed message (a request
        /// carrying :status). Matches lsquic's `HEC_MESSAGE_ERROR`
        /// (lsquic_hq.h:82); 0x105 is H3_FRAME_UNEXPECTED, a different code.
        const H3_MESSAGE_ERROR: u64 = 0x10e;
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
            if let Some(s) = qs.ls() {
                // reset() only ends the read side when the peer already
                // FIN'd/RST'd, so STOP_SENDING is what stops a malformed
                // request streaming a body into a stream nothing will answer.
                s.reset(H3_MESSAGE_ERROR);
                s.stop_sending(H3_MESSAGE_ERROR);
            }
            qs.mark_reset(H3_MESSAGE_ERROR);
            return;
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
                    stream: ctx.cast(),
                    code,
                });
                session.push_event(SessionEvent::StreamWake { stream: ctx.cast() });
            }
        }
        if how == 1 || how == 2 {
            // Node rejects only the STOP_SENDING caller's `closed`.
            qs.peer_stop_sending_code.set(Some(code));
            if let Some(session) = qs.session_ref() {
                // Node's `onstream` still observes a live writer.
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
