use core::cell::Cell;
use core::ffi::c_int;
use core::mem::{MaybeUninit, offset_of};
use core::sync::atomic::Ordering::Relaxed;
use core::sync::atomic::{AtomicI64, AtomicU8, AtomicU32, AtomicU64};
use std::collections::VecDeque;

use bun_jsc::bindgen::{JsLocal, JsPayload as _, JsScope, JsWrapper, StrongWrapper};
use bun_jsc::{ArrayBuffer, JSGlobalObject, JSType, JSValue, JsResult, StringJsc, Strong};
use bun_lsquic_sys as lsquic;
use bun_ptr::{CellExt as _, VecCellExt as _, VecDequeCellExt as _};

use super::aliased_struct::{AliasedStruct, all_atomic_struct, put_state_and_stats};
use super::engine::StrongCtx;
use super::roots::{Key, StrongWrapperCell};
use super::session::{H3_INTERNAL_ERROR, QuicSession, SessionEvent};

const QUIC_STREAM_HEADERS_KIND_HINTS: u32 = 0;
const QUIC_STREAM_HEADERS_KIND_INITIAL: u32 = 1;
const QUIC_STREAM_HEADERS_KIND_TRAILING: u32 = 2;
const QUIC_STREAM_HEADERS_FLAGS_TERMINAL: u32 = 1;

all_atomic_struct! {
    /// Mirrors Node's `Stream::State` (see `node_quic_binding.rs` for the
    /// `IDX_STATE_STREAM_*` offsets the JS layer reads).
    #[derive(Default)]
    pub(crate) struct StreamState {
        pub(crate) id: AtomicI64,
        pub(crate) pending: AtomicU8,
        pub(crate) fin_sent: AtomicU8,
        pub(crate) fin_received: AtomicU8,
        pub(crate) read_ended: AtomicU8,
        pub(crate) write_ended: AtomicU8,
        pub reset: AtomicU8,
        _pad0: [AtomicU8; 2],
        pub(crate) reset_code: AtomicU64,
        pub(crate) has_outbound: AtomicU8,
        pub(crate) has_reader: AtomicU8,
        pub(crate) wants_block: AtomicU8,
        pub(crate) wants_headers: AtomicU8,
        pub(crate) wants_reset: AtomicU8,
        pub(crate) wants_trailers: AtomicU8,
        pub(crate) received_early_data: AtomicU8,
        _pad1: AtomicU8,
        pub(crate) write_desired_size: AtomicU32,
        pub(crate) high_water_mark: AtomicU32,
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

all_atomic_struct! {
    struct StateAndStats {
        state: StreamState,
        stats: [AtomicU64; STREAM_STATS_FIELDS.len()],
    }
}

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

#[derive(Clone, Copy, Default, PartialEq, Eq)]
enum PendingEnd {
    #[default]
    None,
    Fin,
    Trailers,
}

#[derive(Default)]
struct Outbound {
    data: Cell<VecDeque<u8>>,
    end: Cell<PendingEnd>,
    started: Cell<bool>,
}

impl Outbound {
    fn extend_from_slice(&self, bytes: &[u8]) {
        self.data.with_taken(|data| data.extend(bytes));
    }
    fn len(&self) -> usize {
        self.data.len()
    }
    fn is_empty(&self) -> bool {
        self.len() == 0
    }
    fn discard(&self) {
        self.data.with_taken(VecDeque::clear);
        self.end.set(PendingEnd::None);
    }
}

#[derive(Default)]
struct Inbound {
    chunks: Cell<VecDeque<Vec<u8>>>,
    ended: Cell<bool>,
    errored: Cell<bool>,
}

pub(crate) struct QuicStream {
    /// Null while pending or closed.
    pub(super) raw: lsquic::BoundStream,
    /// Empty after `teardown` or `release_session`.
    session: StrongWrapperCell<QuicSession>,
    key: Key,
    state_and_stats: AliasedStruct<StateAndStats>,
    outbound: Outbound,
    inbound: Inbound,
    wakeup: Cell<Option<Strong>>,
    peer_stop_sending_code: Cell<Option<u64>>,
    wrote_to_lsquic: Cell<bool>,
    headers_received: Cell<bool>,
    /// RFC 9218 (urgency, incremental).
    priority: Cell<(u8, bool)>,
    pending_headers: Cell<Vec<(Vec<u8>, c_int, bool)>>,
    trailers_requested: Cell<bool>,
    blocked_reported: Cell<bool>,
    announce_suppressed: Cell<bool>,
    close_reported: Cell<bool>,
    destroyed: Cell<bool>,
}

impl QuicStream {
    pub(super) fn create(
        global: &JSGlobalObject,
        session: StrongWrapper<QuicSession>,
        key: Key,
    ) -> JsResult<StrongCtx<QuicStream>> {
        let stream = QuicStream {
            raw: lsquic::BoundStream::default(),
            session: StrongWrapperCell::new(Some(session)),
            key,
            state_and_stats: AliasedStruct::new(StateAndStats {
                state: StreamState::default(),
                stats: [const { AtomicU64::new(0) }; _],
            }),
            outbound: Outbound::default(),
            inbound: Inbound::default(),
            wakeup: Cell::new(None),
            peer_stop_sending_code: Cell::new(None),
            wrote_to_lsquic: Cell::new(false),
            headers_received: Cell::new(false),
            priority: Cell::new(DEFAULT_PRIORITY),
            pending_headers: Cell::new(Vec::new()),
            trailers_requested: Cell::new(false),
            blocked_reported: Cell::new(false),
            announce_suppressed: Cell::new(false),
            close_reported: Cell::new(false),
            destroyed: Cell::new(false),
        };
        stream.write_stat(IDX_STATS_CREATED_AT, super::now_ns());
        stream.state().id.store(-1, Relaxed);
        stream.state().pending.store(1, Relaxed);
        stream
            .state()
            .high_water_mark
            .store(DEFAULT_HIGH_WATER_MARK, Relaxed);
        let buffer = stream.state_and_stats.to_array_buffer(global)?;
        let this_value = stream.into_js_wrapper(global);
        let handle = this_value.to_js();
        let stats_byte_offset = offset_of!(StateAndStats, stats);
        put_state_and_stats(global, handle, buffer, buffer, stats_byte_offset);
        Ok(StrongCtx::new(StrongWrapper::new(this_value, global)))
    }

    /// Call after `raw` is bound.
    pub(super) fn on_opened(&self, is_server: bool) {
        let s = &self.raw;
        let Some(id) = s.id() else { return };
        let id = id as i64;
        self.state().id.store(id, Relaxed);
        self.state().pending.store(0, Relaxed);
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
            s.set_http_prio(urgency, incremental);
        }
        // lsquic_stream_send_headers only buffers the block; the flush in
        // drain_outbound needs a write event, which nothing else requests
        // unless the JS side already started the writer.
        let mut want_write = false;
        for (bytes, count, eos) in self.pending_headers.take() {
            self.wrote_to_lsquic.set(true);
            if s.send_headers(&bytes, count, eos) {
                if eos {
                    self.state().fin_sent.store(1, Relaxed);
                    self.state().write_ended.store(1, Relaxed);
                    s.shutdown(1);
                } else {
                    want_write = true;
                }
            } else {
                // sendHeaders() returned true when it queued this block, so
                // `closed` is what reports the failure.
                s.reset(H3_INTERNAL_ERROR);
                s.stop_sending(H3_INTERNAL_ERROR);
                self.mark_reset(H3_INTERNAL_ERROR);
                self.state().write_ended.store(1, Relaxed);
                self.outbound.discard();
                break;
            }
        }
        if uni {
            let local = (id & 1 == 0) != is_server;
            if local {
                self.inbound.ended.set(true);
                self.state().read_ended.store(1, Relaxed);
            } else {
                self.state().write_ended.store(1, Relaxed);
                s.want_read(true);
            }
        } else {
            s.want_read(true);
        }
        if want_write || self.outbound.started.get() {
            s.want_write(true);
        }
    }

    fn push_event(&self, event: SessionEvent) {
        self.session.with(|session| session.push_event(event));
    }

    fn state(&self) -> &StreamState {
        &self.state_and_stats.state
    }
    fn write_stat(&self, idx: usize, value: u64) {
        self.state_and_stats.stats[idx].store(value, Relaxed);
    }
    fn read_stat(&self, idx: usize) -> u64 {
        self.state_and_stats.stats[idx].load(Relaxed)
    }
    fn add_stat(&self, idx: usize, delta: u64) {
        self.write_stat(idx, self.read_stat(idx).wrapping_add(delta));
    }

    pub(super) fn pre_reset_code(&self) -> Option<u64> {
        (self.state().reset.load(Relaxed) != 0).then(|| self.state().reset_code.load(Relaxed))
    }
    pub(super) fn release_session(&self) {
        self.session.take();
    }

    pub(super) fn mark_wrote_to_lsquic(&self) {
        self.wrote_to_lsquic.set(true);
    }

    pub(super) fn suppress_announce(&self) {
        self.announce_suppressed.set(true);
    }

    pub(super) fn is_announce_suppressed(&self) -> bool {
        self.announce_suppressed.get()
    }
    pub(super) fn has_undelivered_outbound(&self) -> bool {
        !self.outbound.is_empty()
            || self.outbound.end.get() == PendingEnd::Fin
            || self.raw.has_unacked_data()
    }
    /// True until lsquic opens the stream.
    pub(super) fn is_pending(&self) -> bool {
        self.state().pending.load(Relaxed) != 0
    }

    pub(super) fn stream_id(&self) -> i64 {
        self.state().id.load(Relaxed)
    }

    fn is_write_done(&self) -> bool {
        self.state().fin_sent.load(Relaxed) != 0 || self.state().write_ended.load(Relaxed) != 0
    }

    fn push_inbound(&self, data: &[u8], fin: bool) {
        if self.destroyed.get() {
            return;
        }
        if !data.is_empty() {
            self.inbound.chunks.push_back(data.to_vec());
            self.add_stat(IDX_STATS_BYTES_RECEIVED, data.len() as u64);
            self.write_stat(IDX_STATS_RECEIVED_AT, super::now_ns());
            self.add_stat(IDX_STATS_BYTES_ACCUMULATED, data.len() as u64);
            let acc = self.read_stat(IDX_STATS_BYTES_ACCUMULATED);
            self.write_stat(
                IDX_STATS_MAX_BYTES_ACCUMULATED,
                self.read_stat(IDX_STATS_MAX_BYTES_ACCUMULATED).max(acc),
            );
        }
        if fin {
            self.inbound.ended.set(true);
            self.state().fin_received.store(1, Relaxed);
        }
    }

    pub(super) fn take_wakeup(&self) -> Option<Strong> {
        self.wakeup.replace(None)
    }

    /// 0-RTT was rejected: Node destroys every stream opened during the
    /// early-data phase.
    pub(super) fn cancel_early_rejected(&self, code: u64) {
        self.mark_reset(code);
        self.outbound.discard();
        self.state().write_ended.store(1, Relaxed);
        // Node destroys it silently.
        self.raw.shutdown_internal();
    }

    pub(super) fn apply_peer_stop_sending(&self, code: u64) {
        // bit 1 of the id = uni per RFC 9000 §2.1
        let local_uni =
            self.stream_id() & STREAM_ID_UNI_BIT != 0 && self.state().read_ended.load(Relaxed) != 0;
        self.state().write_ended.store(1, Relaxed);
        if local_uni && code != 0 && self.state().reset_code.load(Relaxed) == 0 {
            self.state().reset_code.store(code, Relaxed);
        }
    }

    fn mark_reset(&self, code: u64) {
        if self.destroyed.get() {
            return;
        }
        self.inbound.chunks.with_taken(VecDeque::clear);
        self.inbound.errored.set(true);
        self.inbound.ended.set(true);
        self.state().reset.store(1, Relaxed);
        // First reset wins: lsquic re-resets rejected 0-RTT streams with
        // code 0 after cancel_early_rejected recorded the application
        // error node reports, which would erase it.
        if self.state().reset_code.load(Relaxed) == 0 {
            self.state().reset_code.store(code, Relaxed);
        }
        self.state().read_ended.store(1, Relaxed);
    }

    pub(super) fn is_destroyed(&self) -> bool {
        self.destroyed.get()
    }
    pub(super) fn mark_close_reported(&self) -> bool {
        self.close_reported.replace(true)
    }
    fn mark_headers_received(&self) -> bool {
        !self.headers_received.replace(true)
    }
    pub(super) fn wants_headers(&self) -> bool {
        self.state().wants_headers.load(Relaxed) != 0
    }
    pub(super) fn wants_reset(&self) -> bool {
        self.state().wants_reset.load(Relaxed) != 0
    }
    pub(super) fn wants_block(&self) -> bool {
        self.state().wants_block.load(Relaxed) != 0
    }
    fn note_write_blocked(&self) {
        if self.blocked_reported.replace(true) {
            return;
        }
        self.push_event(SessionEvent::StreamBlocked { stream: self.key });
    }

    fn drain_outbound(&self) {
        let s = &self.raw;
        let pending = self.outbound.data.with_taken(|data| {
            while !data.is_empty() {
                let (slice, _) = data.as_slices();
                let contig = slice.len();
                let n = s.write(slice);
                if n == 0 {
                    self.note_write_blocked();
                    break;
                }
                self.blocked_reported.set(false);
                self.wrote_to_lsquic.set(true);
                data.drain(..n.min(contig));
                self.add_stat(IDX_STATS_BYTES_SENT, n as u64);
                if n < contig {
                    self.note_write_blocked();
                    break;
                }
            }
            data.len()
        });
        if pending == 0 {
            let end = self.outbound.end.get();
            if end == PendingEnd::Fin {
                s.shutdown(1);
                self.wrote_to_lsquic.set(true);
                self.outbound.end.set(PendingEnd::None);
                self.state().fin_sent.store(1, Relaxed);
                if self.stream_id() & STREAM_ID_UNI_BIT != 0 {
                    s.shutdown(0);
                }
            } else if end == PendingEnd::Trailers && !self.trailers_requested.replace(true) {
                self.push_event(SessionEvent::StreamWantsTrailers { stream: self.key });
            }
            s.want_write(false);
        }
        s.flush();
        let pending = pending as u32;
        let was_full = self.state().write_desired_size.load(Relaxed) == 0
            && self.state().has_outbound.load(Relaxed) != 0;
        let hwm = self.state().high_water_mark.load(Relaxed);
        self.state()
            .write_desired_size
            .store(hwm.saturating_sub(pending), Relaxed);
        if was_full && pending < hwm {
            self.push_event(SessionEvent::StreamDrain { stream: self.key });
        }
    }

    fn kick_write(&self) {
        self.raw.want_write(true);
        self.session.with(|session| session.schedule_process());
    }

    pub(super) fn end_read_side(&self, global: &JSGlobalObject) {
        self.inbound.ended.set(true);
        self.state().read_ended.store(1, Relaxed);
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

    /// Returns the session that owned this stream.
    pub(super) fn teardown(&self, global: &JSGlobalObject) -> Option<StrongWrapper<QuicSession>> {
        if self.destroyed.replace(true) {
            return None;
        }
        self.write_stat(IDX_STATS_DESTROYED_AT, super::now_ns());
        let session = self.session.take();
        if let Some(session) = &session {
            session.try_with(|session| session.remove_stream(self.key));
        }
        self.outbound.data.with_taken(VecDeque::clear);
        self.inbound.chunks.with_taken(VecDeque::clear);
        self.inbound.ended.set(true);
        self.state().read_ended.store(1, Relaxed);
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
        session
    }

    pub(crate) fn get_reader<'a>(&self, this_value: JsWrapper<'a, Self>) -> JsWrapper<'a, Self> {
        self.state().has_reader.store(1, Relaxed);
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
        let (status, buffer) = if self.inbound.errored.get() {
            (PULL_STATUS_ERROR, None)
        } else if let Some(chunk) = self.inbound.chunks.pop_front() {
            (PULL_STATUS_DATA, Some(chunk))
        } else if self.inbound.ended.get() {
            (PULL_STATUS_EOS, None)
        } else {
            (PULL_STATUS_BLOCKED, None)
        };
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
        if self.destroyed.get() {
            return Ok(());
        }
        let source = source.to_js();
        if source.is_undefined_or_null() {
            self.set_body(&[]);
        } else if let Some(buf) = source.as_array_buffer(global) {
            self.set_body(buf.byte_slice());
        } else {
            return Err(global.throw(format_args!(
                "Unsupported QUIC stream body source (Blob and FileHandle sources are not implemented yet)"
            )));
        }
        self.kick_write();
        Ok(())
    }

    pub(super) fn set_body(&self, bytes: &[u8]) {
        self.outbound.started.set(true);
        self.outbound.extend_from_slice(bytes);
        self.outbound.end.set(PendingEnd::Fin);
        self.state().has_outbound.store(1, Relaxed);
    }

    pub(crate) fn init_streaming_source(&self) {
        if self.destroyed.get() {
            return;
        }
        self.outbound.started.set(true);
        self.state().has_outbound.store(1, Relaxed);
        self.state()
            .write_desired_size
            .store(self.state().high_water_mark.load(Relaxed), Relaxed);
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
            self.outbound.extend_from_slice(bytes);
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
        let pending = self.outbound.len() as u32;
        self.state().write_desired_size.store(
            self.state()
                .high_water_mark
                .load(Relaxed)
                .saturating_sub(pending),
            Relaxed,
        );
        self.session.with(|session| session.note_stream_write());
        self.kick_write();
        Ok(JSValue::js_number(queued as f64))
    }

    pub(crate) fn end_write(&self, _: &mut JsScope<'_>) {
        if self.destroyed.get() {
            return;
        }
        self.outbound.started.set(true);
        self.outbound
            .end
            .set(if self.state().wants_trailers.load(Relaxed) != 0 {
                PendingEnd::Trailers
            } else {
                PendingEnd::Fin
            });
        self.session.with(|session| session.note_stream_write());
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
        // A getter on `code` can destroy this stream.
        if !cascading && !self.raw.is_null() && !self.destroyed.get() {
            let deferred = self
                .session
                .with(|session| session.has_deferred_abort(self.key));
            if deferred != Some(true) {
                let send_ended =
                    self.is_write_done() || self.outbound.end.get() != PendingEnd::None;
                if code != 0 || !send_ended {
                    self.raw.reset(code);
                } else {
                    if self.outbound.end.get() == PendingEnd::Trailers {
                        self.outbound.end.set(PendingEnd::None);
                    }
                    self.drain_outbound();
                    if self.outbound.is_empty() {
                        self.raw.close();
                    } else {
                        self.raw.reset(code);
                    }
                }
            }
        }
        if let Some(session) = self.teardown(global) {
            session.try_with(|session| session.schedule_process());
        }
        Ok(())
    }

    pub(crate) fn reset_stream(&self, _: &mut JsScope<'_>, code: JsLocal<'_>) {
        if self.destroyed.get() {
            return;
        }
        let code = error_code_arg(code.to_js());
        self.mark_local_reset(code);
        self.raw.reset(code);
        self.kick_write();
    }

    fn mark_local_reset(&self, code: u64) {
        self.state().write_ended.store(1, Relaxed);
        self.state().reset.store(1, Relaxed);
        self.state().reset_code.store(code, Relaxed);
        self.outbound.discard();
    }

    pub(crate) fn stop_sending(&self, _: &mut JsScope<'_>, code: JsLocal<'_>) {
        if self.destroyed.get() {
            return;
        }
        let code = error_code_arg(code.to_js());
        self.raw.stop_sending(code);
        self.mark_local_stop(code);
        self.kick_write();
    }

    fn mark_local_stop(&self, code: u64) {
        self.inbound.ended.set(true);
        self.state().read_ended.store(1, Relaxed);
        // Mirrors Node treating the local stop as the close error.
        if self.state().reset_code.load(Relaxed) == 0 {
            self.state().reset_code.store(code, Relaxed);
        }
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
            self.mark_local_stop(code);
        }
        if let Some(code) = reset {
            self.mark_local_reset(code);
        }
        if self.wrote_to_lsquic.get() {
            if let Some(code) = stop {
                self.raw.stop_sending(code);
            }
            if let Some(code) = reset {
                self.raw.reset(code);
            }
        } else if !self.raw.is_null() {
            self.session.with(|session| {
                session.defer_stream_abort(self.key, reset, stop);
                session.schedule_process();
            });
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
            self.raw.set_http_prio(urgency, incremental);
        }
        Ok(())
    }
    pub(crate) fn get_priority(&self) -> u32 {
        let (urgency, incremental) = self
            .raw
            .get_http_prio()
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
        let is_trailing = kind.coerce_to_i32(global)? as u32 == QUIC_STREAM_HEADERS_KIND_TRAILING;
        let eos = is_trailing
            || flags.coerce_to_i32(global)? & (QUIC_STREAM_HEADERS_FLAGS_TERMINAL as i32) != 0;
        let s = &self.raw;
        if s.is_null() {
            self.pending_headers.push((bytes, header_count, eos));
            self.state().has_outbound.store(1, Relaxed);
            return Ok(JSValue::js_boolean(true));
        }
        if s.send_headers(&bytes, header_count, eos) {
            self.wrote_to_lsquic.set(true);
            self.state().has_outbound.store(1, Relaxed);
            if eos {
                self.state().fin_sent.store(1, Relaxed);
                self.state().write_ended.store(1, Relaxed);
                s.shutdown(1);
                self.session.with(|session| session.schedule_process());
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

/// A destroyed stream still gets lsquic's callbacks while its abort is deferred.
impl QuicStream {
    /// Returns false if a malformed header block reset the stream.
    fn claim_header_sets(&self) -> bool {
        while let Some(hset) = self.raw.take_header_set() {
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
            let peer_is_client = self.session.with(|s| s.is_server()) == Some(true);
            if peer_is_client && has_status.is_some() {
                // reset() only ends the read side when the peer already
                // FIN'd/RST'd, so STOP_SENDING is what stops a malformed
                // request streaming a body into a stream nothing will answer.
                self.raw.reset(H3_MESSAGE_ERROR);
                self.raw.stop_sending(H3_MESSAGE_ERROR);
                self.mark_reset(H3_MESSAGE_ERROR);
                return false;
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
            self.push_event(SessionEvent::StreamHeaders {
                stream: self.key,
                pairs,
                kind,
            });
        }
        true
    }

    pub(super) fn on_stream_read(&self) {
        if self.destroyed.get() || !self.claim_header_sets() {
            return;
        }
        let stream = &self.raw;
        if stream.received_early_data() {
            self.state().received_early_data.store(1, Relaxed);
        }
        let mut buf = [const { MaybeUninit::uninit() }; 16 * 1024];
        let mut got_any = false;
        loop {
            match stream.read(&mut buf) {
                Some([]) => {
                    // lsquic returns 0 even if this read decoded one more header block.
                    if !self.claim_header_sets() {
                        break;
                    }
                    self.push_inbound(&[], true);
                    stream.want_read(false);
                    if self.is_write_done() {
                        stream.close();
                    } else {
                        stream.shutdown(0);
                    }
                    got_any = true;
                    break;
                }
                Some(data) => {
                    self.push_inbound(data, false);
                    got_any = true;
                }
                None => {
                    // lsquic resets a request above the id of a GOAWAY without on_reset,
                    // and calls on_read on every tick until the stream is closed.
                    if stream.reset_received() {
                        /// RFC 9114 §8.1: the server did no application processing.
                        const H3_REQUEST_REJECTED: u64 = 0x10b;
                        self.mark_reset(H3_REQUEST_REJECTED);
                        stream.close();
                        self.push_event(SessionEvent::StreamReset {
                            stream: self.key,
                            code: H3_REQUEST_REJECTED,
                        });
                        got_any = true;
                    }
                    break;
                }
            }
        }
        if got_any {
            self.push_event(SessionEvent::StreamWake { stream: self.key });
        }
    }

    pub(super) fn on_stream_write(&self) {
        if !self.destroyed.get() {
            self.drain_outbound();
        }
    }

    pub(super) fn on_stream_close(&self) {
        self.push_event(SessionEvent::StreamClosed { stream: self.key });
    }

    pub(super) fn on_stream_reset(&self, how: c_int) {
        if self.destroyed.get() {
            return;
        }
        let code = self.raw.error_code();
        if how == 0 || how == 2 {
            self.mark_reset(code);
            // Node lets the application keep responding on a bidi stream.
            let write_open = self.stream_id() & STREAM_ID_UNI_BIT == 0 && !self.is_write_done();
            if write_open && how == 0 {
                self.raw.shutdown(0);
            } else {
                self.raw.close();
            }
            self.push_event(SessionEvent::StreamReset {
                stream: self.key,
                code,
            });
            self.push_event(SessionEvent::StreamWake { stream: self.key });
        }
        if how == 1 || how == 2 {
            // Node rejects only the STOP_SENDING caller's `closed`.
            self.peer_stop_sending_code.set(Some(code));
            // Node's `onstream` still observes a live writer.
            self.push_event(SessionEvent::StreamStopSending {
                stream: self.key,
                code,
            });
            self.push_event(SessionEvent::StreamWake { stream: self.key });
        }
    }
}
