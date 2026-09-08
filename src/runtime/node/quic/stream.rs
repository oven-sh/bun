use core::cell::Cell;
use core::ffi::c_int;
use std::collections::VecDeque;

use bun_jsc::{
    AliasedStruct, ArrayBuffer, CallFrame, JSGlobalObject, JSType, JSValue, JsCell, JsRef,
    JsResult, StringJsc, Strong,
};
use bun_lsquic_sys as lsquic;
use bun_ptr::{BackRef, RefPtr, Root, ThisPtr};

use super::endpoint::expose_state_buffers;
use super::session::{QuicSession, SessionEvent};

const QUIC_STREAM_HEADERS_KIND_HINTS: u32 = 0;
const QUIC_STREAM_HEADERS_KIND_INITIAL: u32 = 1;
const QUIC_STREAM_HEADERS_KIND_TRAILING: u32 = 2;
const QUIC_STREAM_HEADERS_FLAGS_TERMINAL: u32 = 1;

bun_jsc::aliased_struct! {
    /// Mirrors Node's `Stream::State` (see `node_quic_binding.rs` for the
    /// `IDX_STATE_STREAM_*` offsets the JS layer reads).
    pub struct StreamState {
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
type StreamStats = [Cell<u64>; STREAM_STATS_FIELDS.len()];

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

/// Identifies a stream in its session's lists.
pub(super) type Key = u32;

fn next_key() -> Key {
    static NEXT: core::sync::atomic::AtomicU32 = core::sync::atomic::AtomicU32::new(1);
    NEXT.fetch_add(1, core::sync::atomic::Ordering::Relaxed)
}

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
    pub chunks: VecDeque<Vec<u8>>,
    pub ended: bool,
    pub errored: bool,
}

#[bun_jsc::JsClass(no_constructor)]
#[derive(bun_ptr::CellRefCounted)]
pub struct QuicStream {
    ref_count: Cell<u32>,
    self_ref: Cell<BackRef<QuicStream, Root>>,
    key: Key,
    /// The attached lsquic stream; its context holds a ref on this object
    /// until `on_close` or `teardown` releases it.
    ls: Cell<Option<lsquic::Stream>>,
    /// The owning session; released in `teardown`.
    session: JsCell<Option<RefPtr<QuicSession>>>,
    session_js: JsCell<Option<Strong>>,
    this_value: JsCell<JsRef>,
    state: AliasedStruct<StreamState>,
    stats: AliasedStruct<StreamStats>,
    pub(super) outbound: JsCell<Outbound>,
    inbound: JsCell<Inbound>,
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
    /// Returns one ref for the caller alongside the JS handle (which owns
    /// another, released by finalize).
    pub(super) fn create(
        global: &JSGlobalObject,
        session: ThisPtr<QuicSession>,
        session_handle: JSValue,
        raw: Option<lsquic::Stream>,
    ) -> JsResult<(RefPtr<QuicStream>, JSValue)> {
        let created = RefPtr::new(QuicStream {
            ref_count: Cell::new(1),
            self_ref: Cell::new(BackRef::dangling()),
            key: next_key(),
            ls: Cell::new(None),
            session: JsCell::new(Some(RefPtr::from_this(session))),
            session_js: JsCell::new(Some(Strong::create(session_handle, global))),
            this_value: JsCell::new(JsRef::empty()),
            state: AliasedStruct::zeroed(),
            stats: AliasedStruct::zeroed(),
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
        });
        created.self_ref.set(BackRef::from(created.this_ptr()));
        let stream = created.clone();
        let handle = Self::to_js_nonnull(created.as_non_null(), global);
        let _ = RefPtr::into_raw(created);

        expose_state_buffers(global, handle, &stream.state, &stream.stats)?;
        stream.this_value.with_mut(|r| r.set_strong(handle, global));
        let now = super::now_ns();
        stream.write_stat(IDX_STATS_CREATED_AT, now);
        stream.state.id.set(-1);
        stream.state.pending.set(1);
        stream.state.high_water_mark.set(DEFAULT_HIGH_WATER_MARK);
        if let Some(raw) = raw {
            stream.bind_raw(raw);
        }
        Ok((stream, handle))
    }

    pub(super) fn key(&self) -> Key {
        self.key
    }
    fn this_ptr(&self) -> ThisPtr<QuicStream> {
        self.self_ref.get().this_ptr()
    }

    pub(super) fn bind_raw(&self, s: lsquic::Stream) {
        self.ls.set(Some(s));
        let id = s.id() as i64;
        self.state.id.set(id);
        self.state.pending.set(0);
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
                self.state.fin_sent.set(1);
                self.state.write_ended.set(1);
                s.shutdown(1);
            }
        }
        if uni {
            let is_server = self.session_ref().is_some_and(|s| s.is_server());
            let local = (id & 1 == 0) != is_server;
            if local {
                self.inbound.with_mut(|i| i.ended = true);
                self.state.read_ended.set(1);
            } else {
                self.state.write_ended.set(1);
                s.want_read(true);
            }
        } else {
            s.want_read(true);
        }
        if self.outbound.get().started {
            s.want_write(true);
        }
    }

    /// The owning session while attached (until `teardown`); the ref this
    /// stream holds keeps it live.
    fn session_ref(&self) -> Option<ThisPtr<QuicSession>> {
        self.session.get().as_ref().map(RefPtr::this_ptr)
    }
    fn ls(&self) -> Option<lsquic::Stream> {
        self.ls.get()
    }

    fn write_stat(&self, idx: usize, value: u64) {
        if let Some(slot) = self.stats.get(idx) {
            slot.set(value);
        }
    }
    fn read_stat(&self, idx: usize) -> u64 {
        self.stats.get(idx).map_or(0, Cell::get)
    }
    fn add_stat(&self, idx: usize, delta: u64) {
        if let Some(slot) = self.stats.get(idx) {
            slot.set(slot.get().wrapping_add(delta));
        }
    }

    pub(super) fn handle(&self) -> JSValue {
        self.this_value.get().get()
    }
    pub(super) fn pre_reset_code(&self) -> Option<u64> {
        (self.state.reset.get() != 0).then(|| self.state.reset_code.get())
    }
    pub(super) fn release_close_root(&self) {
        self.this_value.with_mut(|r| r.downgrade());
    }

    pub(super) fn mark_wrote_to_lsquic(&self) {
        self.wrote_to_lsquic.set(true);
    }
    pub(super) fn set_has_outbound(&self) {
        self.state.has_outbound.set(1);
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
        if !out.data.is_empty() || out.end == PendingEnd::Fin {
            return true;
        }
        self.ls().is_some_and(|s| s.has_unacked_data())
    }

    pub(super) fn stream_id(&self) -> i64 {
        self.state.id.get()
    }

    fn push_inbound(&self, data: &[u8], fin: bool) {
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
            self.state.fin_received.set(1);
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
            o.end = PendingEnd::None;
        });
        self.state.write_ended.set(1);
        if let Some(s) = self.ls() {
            // Node destroys it silently.
            s.shutdown_internal();
        }
    }

    pub(super) fn apply_peer_stop_sending(&self, code: u64) {
        // bit 1 of the id = uni per RFC 9000 §2.1
        let local_uni =
            self.stream_id() & STREAM_ID_UNI_BIT != 0 && self.state.read_ended.get() != 0;
        self.state.write_ended.set(1);
        if local_uni && code != 0 && self.state.reset_code.get() == 0 {
            self.state.reset_code.set(code);
        }
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
        self.state.reset.set(1);
        // First reset wins: lsquic re-resets rejected 0-RTT streams with
        // code 0 after cancel_early_rejected recorded the application
        // error node reports, which would erase it.
        if self.state.reset_code.get() == 0 {
            self.state.reset_code.set(code);
        }
        self.state.read_ended.set(1);
    }

    pub(super) fn mark_close_reported(&self) -> bool {
        self.close_reported.replace(true)
    }
    fn mark_headers_received(&self) -> bool {
        !self.headers_received.replace(true)
    }
    pub(super) fn wants_headers(&self) -> bool {
        self.state.wants_headers.get() != 0
    }
    pub(super) fn wants_reset(&self) -> bool {
        self.state.wants_reset.get() != 0
    }
    pub(super) fn wants_block(&self) -> bool {
        self.state.wants_block.get() != 0
    }
    fn note_write_blocked(&self) {
        if self.blocked_reported.replace(true) {
            return;
        }
        if let Some(session) = self.session_ref() {
            session.push_event(SessionEvent::StreamBlocked { stream: self.key });
        }
    }

    fn write_done(&self) -> bool {
        self.state.fin_sent.get() != 0 || self.state.write_ended.get() != 0
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
        let (empty, end) = {
            let out = self.outbound.get();
            (out.data.is_empty(), out.end)
        };
        if empty {
            if end == PendingEnd::Fin {
                s.shutdown(1);
                self.wrote_to_lsquic.set(true);
                self.outbound.with_mut(|o| o.end = PendingEnd::None);
                self.state.fin_sent.set(1);
                if self.stream_id() & STREAM_ID_UNI_BIT != 0 {
                    s.shutdown(0);
                }
            } else if end == PendingEnd::Trailers && !self.trailers_requested.replace(true) {
                if let Some(session) = self.session_ref() {
                    session.push_event(SessionEvent::StreamWantsTrailers { stream: self.key });
                }
            }
            s.want_write(false);
        }
        s.flush();
        let pending = self.outbound.get().data.len() as u32;
        let was_full =
            self.state.write_desired_size.get() == 0 && self.state.has_outbound.get() != 0;
        let hwm = self.state.high_water_mark.get();
        self.state
            .write_desired_size
            .set(hwm.saturating_sub(pending));
        if was_full && pending < hwm {
            if let Some(session) = self.session_ref() {
                session.push_event(SessionEvent::StreamDrain { stream: self.key });
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
        self.state.read_ended.set(1);
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
        let _keep = RefPtr::from_this(self.this_ptr());
        self.write_stat(IDX_STATS_DESTROYED_AT, super::now_ns());
        // Detach lsquic's stream context before dropping the wrapper Strong:
        // lsquic's `on_close` (and `on_reset`) can fire after this, and the
        // shim skips a stream with no context.
        if let Some(s) = self.ls.take() {
            drop(s.take_ctx::<QuicStream>());
        }
        if let Some(session) = self.session.replace(None) {
            // The session's `streams` list is the only other holder; leave it
            // before downgrading so process_events cannot reach this stream.
            session.remove_stream(self.key);
        }
        self.outbound.with_mut(|o| o.data.clear());
        self.inbound.with_mut(|i| {
            i.chunks.clear();
            i.ended = true;
        });
        self.state.read_ended.set(1);
        if let Some(wakeup) = self.take_wakeup() {
            let vm = global.bun_vm().as_mut();
            vm.event_loop_ref()
                .run_callback(wakeup.get(), global, JSValue::UNDEFINED, &[]);
        }
        self.wakeup.set(None);
        self.session_js.set(None);
        self.this_value.with_mut(|r| r.downgrade());
    }

    pub(crate) fn finalize(&self) {
        self.this_value.with_mut(JsRef::finalize);
    }

    pub(crate) fn get_reader(&self, _g: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        self.state.has_reader.set(1);
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
            o.end = PendingEnd::Fin;
        });
        self.state.has_outbound.set(1);
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
        self.state.has_outbound.set(1);
        self.state
            .write_desired_size
            .set(self.state.high_water_mark.get());
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
        self.state
            .write_desired_size
            .set(self.state.high_water_mark.get().saturating_sub(pending));
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
        let wants_trailers = self.state.wants_trailers.get() != 0;
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
        let write_done = self.write_done();
        if !cascading {
            if let Some(s) = self.ls() {
                let deferred = self
                    .session_ref()
                    .is_some_and(|session| session.has_deferred_abort(s));
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
                        if self.outbound.get().data.is_empty() {
                            s.close();
                        } else {
                            s.reset(code);
                        }
                    }
                }
            }
        }
        // The session stays registered on the endpoint while any stream
        // exists; hold it across the teardown that drops this stream's ref.
        let session = self.session_ref();
        let _keep_session = session.map(RefPtr::from_this);
        self.teardown(global);
        if let Some(session) = session {
            session.schedule_process();
        }
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn reset_stream(&self, _g: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        if self.destroyed.get() {
            return Ok(JSValue::UNDEFINED);
        }
        let code = error_code_arg(frame.arguments_as_array::<1>()[0]);
        self.state.write_ended.set(1);
        self.state.reset.set(1);
        self.state.reset_code.set(code);
        self.outbound.with_mut(|o| {
            o.data.clear();
            o.end = PendingEnd::None;
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
        self.state.read_ended.set(1);
        // Mirrors Node treating the local stop as the close error.
        if self.state.reset_code.get() == 0 {
            self.state.reset_code.set(code);
        }
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
            self.state.read_ended.set(1);
            if self.state.reset_code.get() == 0 {
                self.state.reset_code.set(code);
            }
        }
        if let Some(code) = reset {
            self.state.write_ended.set(1);
            self.state.reset.set(1);
            self.state.reset_code.set(code);
            self.outbound.with_mut(|o| {
                o.data.clear();
                o.end = PendingEnd::None;
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
                session.defer_stream_abort(s, reset, stop);
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
            self.state.has_outbound.set(1);
            return Ok(JSValue::js_boolean(true));
        };
        let rv = s.send_headers(&bytes, header_count, eos);
        if rv == 0 {
            self.wrote_to_lsquic.set(true);
            self.state.has_outbound.set(1);
            if eos {
                self.state.fin_sent.set(1);
                self.state.write_ended.set(1);
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

impl lsquic::NqStream for QuicStream {
    fn on_read(&self, stream: lsquic::Stream) {
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
            let peer_is_client = self.session_ref().is_some_and(|s| s.is_server());
            if peer_is_client && has_status.is_some() {
                if let Some(s) = self.ls() {
                    // reset() only ends the read side when the peer already
                    // FIN'd/RST'd, so STOP_SENDING is what stops a malformed
                    // request streaming a body into a stream nothing will answer.
                    s.reset(H3_MESSAGE_ERROR);
                    s.stop_sending(H3_MESSAGE_ERROR);
                }
                self.mark_reset(H3_MESSAGE_ERROR);
                return;
            }
            // 1xx interim responses are HINTS (RFC 9114 §4.1).
            let is_interim = has_status.unwrap_or(false);
            let kind = if is_interim {
                QUIC_STREAM_HEADERS_KIND_HINTS
            } else if self.mark_headers_received() {
                QUIC_STREAM_HEADERS_KIND_INITIAL
            } else {
                QUIC_STREAM_HEADERS_KIND_TRAILING
            };
            if let Some(session) = self.session_ref() {
                session.push_event(SessionEvent::StreamHeaders {
                    stream: self.key,
                    pairs,
                    kind,
                });
            }
        }
        if stream.received_early_data() {
            self.state.received_early_data.set(1);
        }
        let mut buf = [core::mem::MaybeUninit::<u8>::uninit(); 16 * 1024];
        let mut got_any = false;
        loop {
            match stream.read_uninit(&mut buf) {
                lsquic::StreamRead::Data(data) => {
                    self.push_inbound(data, false);
                    got_any = true;
                }
                lsquic::StreamRead::Eof => {
                    self.push_inbound(&[], true);
                    stream.want_read(false);
                    if self.write_done() {
                        stream.close();
                    } else {
                        stream.shutdown(0);
                    }
                    got_any = true;
                    break;
                }
                lsquic::StreamRead::WouldBlock => break,
            }
        }
        if got_any {
            if let Some(session) = self.session_ref() {
                session.push_event(SessionEvent::StreamWake { stream: self.key });
            }
        }
    }

    fn on_write(&self, _stream: lsquic::Stream) {
        self.drain_outbound();
    }

    fn on_close(&self, stream: lsquic::Stream) {
        // The lsquic_stream is freed immediately after this callback returns.
        self.ls.set(None);
        if let Some(session) = self.session_ref() {
            session.forget_deferred_abort(stream);
            session.push_event(SessionEvent::StreamClosed { stream: self.key });
        }
    }

    fn on_reset(&self, how: c_int, code: u64) {
        if how == 0 || how == 2 {
            self.mark_reset(code);
            if let Some(s) = self.ls() {
                // Node lets the application keep responding on a bidi stream.
                let write_open = self.stream_id() & STREAM_ID_UNI_BIT == 0 && !self.write_done();
                if write_open && how == 0 {
                    s.shutdown(0);
                } else {
                    s.close();
                }
            }
            if let Some(session) = self.session_ref() {
                session.push_event(SessionEvent::StreamReset {
                    stream: self.key,
                    code,
                });
                session.push_event(SessionEvent::StreamWake { stream: self.key });
            }
        }
        if how == 1 || how == 2 {
            // Node rejects only the STOP_SENDING caller's `closed`.
            self.peer_stop_sending_code.set(Some(code));
            if let Some(session) = self.session_ref() {
                // Node's `onstream` still observes a live writer.
                session.push_event(SessionEvent::StreamStopSending {
                    stream: self.key,
                    code,
                });
                session.push_event(SessionEvent::StreamWake { stream: self.key });
            } else {
                self.apply_peer_stop_sending(code);
            }
        }
    }
}
