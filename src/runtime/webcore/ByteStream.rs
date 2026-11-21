use core::cell::Cell;
use std::collections::TryReserveError;

use bun_collections::VecExt;
use bun_jsc::bindgen::{JsLocal, JsScope};
use bun_jsc::strong::Optional as StrongOptional;
use bun_jsc::{self as jsc, JSValue, JsCell};
use bun_ptr::{OptionCellExt as _, RefPtr};
use bun_sys::Error as SysError;

use crate::webcore::streams::{self, BufferAction, IntoArray};
use crate::webcore::{DrainResult, SinkHandle, blob, readable_stream};

bun_output::declare_scope!(ByteStream, visible);

/// Every JS-reachable inherent method takes `&self` so a
/// re-entrant JS call (e.g. `pending.run()` → JS → `onPull`) cannot stack two
/// `&mut ByteStream`. Fields mutated on those paths are wrapped in `Cell` or [`JsCell`]. `high_water_mark` /
/// `size_hint` are written only at init time (before the JS wrapper exists)
/// and stay bare.
pub struct ByteStream {
    pub(crate) buffered: Buffered,
    pub(crate) has_received_last_chunk: Cell<bool>,
    pub(crate) pending: streams::Pending,
    /// The producer's error, stored by [`Self::append`] until a reader takes it.
    pending_error: Cell<Option<streams::StreamError>>,
    pub(crate) done: Cell<bool>,
    pub(crate) pending_value: JsCell<StrongOptional>, // jsc.Strong.Optional
    pub(crate) high_water_mark: blob::SizeType,
    /// Native sink this stream is piped into; `on_data` dispatches and honors `Writable`.
    pub(crate) sink: JsCell<SinkHandle>,
    /// Set on `Writable::Backpressure` (buffer instead of write); cleared by [`Self::resume`].
    pub(crate) sink_paused: Cell<bool>,
    pub(crate) size_hint: Cell<blob::SizeType>,
    pub(crate) buffer_action: JsCell<Option<BufferAction>>,
}

impl Default for ByteStream {
    fn default() -> Self {
        Self {
            buffered: Buffered::default(),
            has_received_last_chunk: Cell::new(false),
            pending: streams::Pending::default(),
            pending_error: Cell::new(None),
            done: Cell::new(false),
            pending_value: JsCell::new(StrongOptional::empty()),
            high_water_mark: 0,
            sink: JsCell::new(SinkHandle::None),
            sink_paused: Cell::new(false),
            size_hint: Cell::new(0),
            buffer_action: JsCell::new(None),
        }
    }
}

/// Bytes a producer delivered. A consumer already took `bytes[..consumed]`.
#[derive(Default)]
pub(crate) struct Buffered {
    bytes: JsCell<Vec<u8>>,
    consumed: Cell<usize>,
}

impl Buffered {
    /// Bytes delivered that no consumer has taken yet.
    #[inline]
    pub(crate) fn len(&self) -> usize {
        self.bytes.get().len() - self.consumed.get()
    }

    #[inline]
    pub(crate) fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Bytes the buffer holds, the taken prefix included. The HTMLRewriter paces its input by this.
    #[inline]
    pub(crate) fn held_len(&self) -> usize {
        self.bytes.get().len()
    }

    /// Heap the buffer holds, including an already-taken prefix.
    #[inline]
    fn capacity(&self) -> usize {
        self.bytes.get().capacity()
    }

    /// Adopt `bytes`, of which a consumer already took the first `consumed`.
    fn adopt(&self, bytes: Vec<u8>, consumed: usize) {
        debug_assert!(consumed <= bytes.len());
        self.bytes.set(bytes);
        self.consumed.set(consumed);
    }

    /// Take the untaken bytes out. The buffer keeps no allocation.
    fn take(&self) -> Vec<u8> {
        let consumed = self.consumed.replace(0);
        let mut bytes = self.bytes.replace(Vec::new());
        if consumed > 0 {
            bytes.drain(..consumed);
        }
        bytes
    }

    fn extend(&self, chunk: &[u8]) {
        self.bytes.with_mut(|b| b.extend_from_slice(chunk));
    }

    fn try_extend(&self, chunk: &[u8]) -> Result<(), TryReserveError> {
        self.bytes.with_mut(|b| b.try_reserve(chunk.len()))?;
        self.extend(chunk);
        Ok(())
    }

    /// Drop every buffered byte and release the allocation.
    fn clear(&self) {
        self.consumed.set(0);
        if self.capacity() > 0 {
            self.bytes.with_mut(|b| {
                b.clear();
                b.shrink_to_fit();
            });
        }
    }

    /// Copy up to `dest.len()` untaken bytes into `dest`. Returns how many it copied.
    fn copy_out(&self, dest: &mut [u8]) -> usize {
        self.bytes.with_mut(|b| {
            let consumed = self.consumed.get();
            let to_write = (b.len() - consumed).min(dest.len());
            dest[..to_write].copy_from_slice(&b[consumed..][..to_write]);
            if consumed + to_write == b.len() {
                self.consumed.set(0);
                b.clear();
            } else {
                self.consumed.set(consumed + to_write);
            }
            to_write
        })
    }
}

/// ReadableStream source backed by a ByteStream.
pub(crate) type Source = readable_stream::NewSource<ByteStream>;

/// A network body producer's (fetch, S3) hold on the stream it feeds: a counted ref on the stream's
/// `Source`, so delivery and unhooking go through memory the producer keeps alive rather than the
/// JS wrapper (which the VM's last sweep destroys in no particular order), plus the parked bit of
/// the receive backpressure. It roots the wrapper only for a native sink or a whole-body read.
#[derive(Default)]
pub(crate) struct ProducerHold {
    source: JsCell<Option<RefPtr<Source>>>,
    parked: Cell<bool>,
}

/// The JS-thread half of `BODY_HIGH_WATER_MARK`, decided from the stream's buffer after a
/// delivery. The HTTP thread does the other half on its hop buffer.
pub(crate) enum AfterDelivery {
    /// Under the mark, or a whole-body consumer (`readableStreamTo*`) is collecting: keep going.
    Resume,
    /// At the mark with a back-pressured sink: it resumes the producer when it drains.
    Pause,
    /// At the mark and nothing reads: pause, release the loop.
    Park,
}

impl ProducerHold {
    /// Take the producer ref on the stream's source (JS thread).
    ///
    /// # Safety
    /// `bytes` is the live ByteStream of a stream the caller holds.
    pub(crate) unsafe fn hold(&self, bytes: *mut ByteStream) {
        self.release();
        // SAFETY: fn contract.
        let source = unsafe {
            let source = Source::from_context_ptr(bytes);
            // Before the ref, so `increment_count` only roots a wrapper that stays rooted.
            Self::sync_root(&*source);
            RefPtr::init_ref(source)
        };
        self.source.set(Some(source));
    }

    fn sync_wrapper_root(&self) {
        if let Some(source) = self.source.get() {
            Self::sync_root(source);
        }
    }

    fn sync_root(source: &Source) {
        let bytes = &source.context;
        if bytes.sink.get().is_some() || bytes.buffer_action.get().is_some() {
            source.root_wrapper();
        } else {
            source.unroot_wrapper();
        }
    }

    pub(crate) fn is_held(&self) -> bool {
        self.source.get().is_some()
    }

    /// The held stream, pinned for the guard's life: a consumer inside `on_data` can cancel the
    /// producer (which drops the hold), and the wrapper is not always rooted.
    pub(crate) fn bytes(&self) -> Option<PinnedBytes> {
        self.source.get().clone().map(PinnedBytes)
    }

    /// Stop being the producer. The source stays pinned by the returned guard, so the caller can
    /// still deliver a terminal chunk. Touches no JS cell.
    pub(crate) fn take(&self) -> Option<PinnedBytes> {
        let source = self.source.take()?;
        self.parked.set(false);
        source.producer.set(streams::SourceHandle::None);
        source.wrapper_unrooted.set(false);
        Some(PinnedBytes(source))
    }

    /// `take` and drop. Touches no JS cell (safe inside a GC sweep).
    pub(crate) fn release(&self) {
        drop(self.take());
    }

    pub(crate) fn after_delivery(&self, bytes: &ByteStream) -> AfterDelivery {
        self.sync_wrapper_root();
        if bytes.buffered_len() < bun_http::signals::BODY_HIGH_WATER_MARK
            || bytes.buffer_action.get().is_some()
        {
            AfterDelivery::Resume
        } else if bytes.sink.get().is_some() {
            AfterDelivery::Pause
        } else {
            AfterDelivery::Park
        }
    }

    /// Returns whether this call parked (the caller then releases its loop ref).
    pub(crate) fn park(&self) -> bool {
        !self.parked.replace(true)
    }

    /// A consumer attached or took bytes; returns whether this unparked (re-take the loop ref).
    pub(crate) fn unpark(&self) -> bool {
        self.sync_wrapper_root();
        self.parked.replace(false)
    }
}

impl Drop for ProducerHold {
    fn drop(&mut self) {
        self.release();
    }
}

/// A counted ref on a stream's `Source` for the guard's life; derefs to its ByteStream.
pub(crate) struct PinnedBytes(RefPtr<Source>);

impl core::ops::Deref for PinnedBytes {
    type Target = ByteStream;
    fn deref(&self) -> &ByteStream {
        &self.0.context
    }
}

impl readable_stream::SourceContext for ByteStream {
    crate::source_context_codegen!(js_BytesInternalReadableStreamSource);

    fn on_start(&self) -> streams::Start {
        if self.has_received_last_chunk.get() {
            // `Empty` would close the stream without the pull that returns the stored error.
            if self.has_pending_error() {
                return streams::Start::Ready;
            }
            if self.buffered.is_empty() {
                return streams::Start::Empty;
            }
            return streams::Start::OwnedAndDone(self.buffered.take());
        }

        if self.high_water_mark == 0 {
            return streams::Start::Ready;
        }

        // For HTTP, the maximum streaming response body size will be 512 KB.
        // #define LIBUS_RECV_BUFFER_LENGTH 524288
        // For HTTPS, the size is probably quite a bit lower like 64 KB due to TLS transmission.
        // We add 1 extra page size so that if there's a little bit of excess buffered data, we avoid extra allocations.
        let page_size: blob::SizeType =
            blob::SizeType::try_from(bun_sys::page_size()).expect("int cast");
        streams::Start::ChunkSize((512 * 1024 + page_size).min(self.high_water_mark.max(page_size)))
    }

    fn on_pull(&self, buffer: &mut [u8], view: JSValue) -> streams::Result<'_> {
        bun_jsc::mark_binding!();
        debug_assert!(!buffer.is_empty());
        debug_assert!(self.buffer_action.get().is_none());

        if !self.buffered.is_empty() {
            debug_assert!(self.value().is_empty()); // == .zero
            let to_write = self.buffered.copy_out(buffer);
            // Both sides are non-empty, so the copy moved at least one byte.
            debug_assert!(to_write > 0);

            if self.buffered.is_empty() {
                self.signal_drained();
            }

            return streams::Result::IntoArray(IntoArray {
                value: view,
                len: to_write as blob::SizeType, // @truncate
            });
        }

        if self.has_received_last_chunk.get() {
            // Surface a stored terminal error (set by `append(Err)` when no
            // reader was waiting) instead of silently reporting `Done`.
            return self
                .take_pending_error()
                .map_or(streams::Result::Done, streams::Result::Err);
        }

        self.set_value(view);
        streams::Result::Pending(&self.pending)
    }

    fn on_cancel(&self) {
        Self::on_cancel(self)
    }

    fn deinit_fn(&self) {
        bun_jsc::mark_binding!();
        if !self.done.get() {
            self.done.set(true);
            // We must never run JavaScript inside of a GC finalizer.
            self.pending.close_on_next_tick();
        }
    }

    fn wrapper_finalized(&self) {
        self.parent_const().producer.get().consumer_collected();
    }

    fn drain_internal_buffer(&self) -> Vec<u8> {
        Self::drain(self)
    }

    fn memory_cost_fn(&self) -> usize {
        // ReadableStreamSource covers @sizeOf(ByteStream)
        self.buffered.capacity()
    }

    fn to_buffered_value(
        &self,
        cx: &bun_jsc::JsThread<'_>,
        action: streams::BufferActionTag,
    ) -> bun_jsc::JsResult<JSValue> {
        if self.buffer_action.get().is_some() {
            return Err(cx.global().throw(format_args!("Cannot buffer value twice")));
        }

        if let Some(err) = self.take_pending_error() {
            let err_js = err.to_js(cx.global());
            err_js.ensure_still_alive();
            self.done.set(true);
            self.buffered.clear();
            return Ok(jsc::JSPromise::rejected_promise(cx.global(), err_js).to_js());
        }

        if let Some(blob_) = self.to_any_blob() {
            let mut blob = blob_;
            return blob.to_promise(cx, action);
        }

        self.buffer_action.set(Some(BufferAction::new(action, cx)));
        let promise = self.buffer_action.get().as_ref().unwrap().value();
        // Signal after the action is installed so a backpressure-gated
        // producer observes it; a synchronous producer may fulfil it inline.
        self.signal_drained();
        Ok(promise)
    }
}

// SAFETY: `ByteStream` is always the `context` field of a `Source`
// (ReadableStream.NewSource); never constructed standalone. Everything it
// touches on the `Source` is a `Cell`, so the `&Source` arm suffices.
bun_core::impl_field_parent! { ByteStream => Source.context; pub fn shared parent_const; }

impl ByteStream {
    pub(crate) fn from_drain_result(drain_result: DrainResult) -> Self {
        let mut this = Self::default();
        match drain_result {
            DrainResult::EstimatedSize(estimated_size) => {
                this.high_water_mark = estimated_size as blob::SizeType;
                this.size_hint.set(estimated_size as blob::SizeType);
            }
            DrainResult::Owned { list, size_hint } => {
                this.buffered.adopt(list, 0);
                this.size_hint.set(size_hint as blob::SizeType);
            }
            DrainResult::Aborted => {}
        }
        this
    }

    fn value(&self) -> JSValue {
        self.pending_value.with_mut(|pv| {
            let Some(result) = pv.get() else {
                return JSValue::ZERO;
            };
            pv.clear_without_deallocation();
            result
        })
    }

    /// Drop the native sink and end the stream locked to it: errored with the producer's `err`, else closed.
    pub(crate) fn detach_sink(&self, err: Option<&streams::StreamError>) {
        self.sink_paused.set(false);
        if self.sink.replace(SinkHandle::None).is_some() {
            self.parent_const().end_locked_stream(err);
        }
    }

    pub(crate) fn unpipe_without_deref(&self) {
        self.detach_sink(None);
    }

    /// The sink is gone before the stream ended (its peer went away). The stream stays
    /// locked to it, so nobody else can read the rest: close the producer too.
    pub(crate) fn detach_finished_sink(&self) {
        if self.has_received_last_chunk.get() {
            self.unpipe_without_deref();
        } else {
            self.cancel_from_sink(None);
        }
    }

    /// Bytes delivered that no consumer has taken yet.
    #[inline]
    pub fn buffered_len(&self) -> usize {
        self.buffered.len()
    }

    /// Sink's drain ack: unpause, push buffered bytes, end if last chunk already arrived.
    pub fn resume(&self) {
        if !self.sink_paused.get() {
            return;
        }
        self.sink_paused.set(false);

        let sink = *self.sink.get();
        if sink.is_none() {
            return;
        }

        if !self.buffered.is_empty() {
            let buffered = self.buffered.take();
            let result = if self.has_received_last_chunk.get() {
                streams::Result::OwnedAndDone(buffered)
            } else {
                streams::Result::Owned(buffered)
            };
            match sink.write(&result) {
                streams::Writable::Backpressure(_) => {
                    self.sink_paused.set(true);
                    return;
                }
                streams::Writable::Err(e) => {
                    self.detach_sink(None);
                    sink.end(Some(streams::StreamError::Error(e)));
                    return;
                }
                streams::Writable::Done => {
                    self.detach_sink(None);
                    sink.end(None);
                    return;
                }
                _ => {}
            }
        }

        self.signal_drained();

        // A synchronous producer (RewriterPipe) may have pushed its remaining
        // output through `on_data` just now. If one of those writes hit
        // backpressure, the chunks after it (and the end) were buffered; the
        // sink's next drain ack comes back here and delivers them. Ending now
        // would drop them.
        if self.sink_paused.get() {
            return;
        }

        if self.has_received_last_chunk.get() && self.sink.get().is_some() {
            self.detach_sink(None);
            sink.end(None);
        }
    }

    /// Sink closed early: detach and drive the NewSource cancel path.
    pub fn cancel_from_sink(&self, _err: Option<SysError>) {
        self.detach_sink(None);
        if self.done.get() {
            return;
        }
        self.has_received_last_chunk.set(true);
        self.on_cancel();
        let source = self.parent_const();
        let mut p = source.producer.replace(streams::SourceHandle::None);
        p.close(None);
    }

    #[inline]
    pub(crate) fn signal_drained(&self) {
        self.parent_const().producer.get().ready(None, None);
    }

    /// Take the untaken bytes. The caller calls [`Self::signal_drained`] after it writes them.
    pub(crate) fn take_buffer(&self) -> Vec<u8> {
        self.buffered.take()
    }

    /// Called by native fast-paths after wiring `self.sink`: a consumer now
    /// waits for bytes, so a parked producer resumes.
    pub fn signal_consumer_attached(&self) {
        self.parent_const().producer.get().start();
    }

    pub(crate) fn on_data(&self, mut stream: streams::Result<'_>) {
        bun_jsc::mark_binding!();
        if self.done.get() {
            // The owned `Vec<u8>`/`Vec`
            // payload drops implicitly at the `return` below — no explicit `drop` needed.
            self.has_received_last_chunk.set(stream.is_done());

            bun_output::scoped_log!(ByteStream, "ByteStream.onData already done... do nothing");

            return;
        }

        debug_assert!(
            !self.has_received_last_chunk.get() || matches!(stream, streams::Result::Err(_))
        );
        self.has_received_last_chunk.set(stream.is_done());

        // Snapshot `sink` (Copy): write/end may re-enter ByteStream; no JsCell borrow across that.
        let sink = *self.sink.get();
        if sink.is_some() {
            // Upstream error must reach the sink even while back-pressured.
            if let streams::Result::Err(err) = stream {
                self.detach_sink(Some(&err));
                sink.end(Some(err));
                return;
            }

            if self.sink_paused.get() {
                bun_output::scoped_log!(ByteStream, "ByteStream.onData sink paused → buffer");
                self.append(stream, 0)
                    .unwrap_or_else(|_| panic!("Out of memory while copying request body"));
                return;
            }

            let is_done = stream.is_done();
            match sink.write(&stream) {
                streams::Writable::Backpressure(_) => {
                    self.sink_paused.set(true);
                }
                streams::Writable::Err(e) => {
                    self.detach_sink(None);
                    sink.end(Some(streams::StreamError::Error(e)));
                    return;
                }
                streams::Writable::Done => {
                    self.detach_sink(None);
                    sink.end(None);
                    return;
                }
                _ => {
                    self.signal_drained();
                }
            }

            if is_done && !self.sink_paused.get() && self.sink.get().is_some() {
                self.detach_sink(None);
                sink.end(None);
            }
            return;
        }

        if self.buffer_action.get().is_some() {
            if let streams::Result::Err(err) = &stream {
                // Explicit post-reject cleanup; runs after `action.reject`
                // (`?` would skip it).
                bun_output::scoped_log!(ByteStream, "ByteStream.onData err  action.reject()");

                let global = self.parent_const().global_this();
                // R-2: move the action out of the cell *before* `signal_drained`
                // and `reject`; both can re-enter and consume the slot.
                let mut action = self.buffer_action.replace(None).unwrap();
                self.signal_drained();
                action.reject(global, err);

                self.buffered.clear();
                self.pending_error.set(None);
                self.buffer_action.set(None);

                return;
            }

            // R-2: the drain signal can re-enter and consume `buffer_action`,
            // so the paths below re-take it with `let`-`else`.
            self.signal_drained();

            if self.has_received_last_chunk.get() {
                // `defer { this.buffer_action = null; }` — handled by `replace(None)` below.
                let Some(mut action) = self.buffer_action.replace(None) else {
                    // Consumed re-entrantly during `signal_drained`.
                    return;
                };

                if self.buffered.capacity() == 0 && matches!(stream, streams::Result::Done) {
                    bun_output::scoped_log!(
                        ByteStream,
                        "ByteStream.onData done and action.fulfill()"
                    );

                    let mut blob = self.to_any_blob().unwrap();
                    action.fulfill(self.parent_const().global_this(), &mut blob);
                    return;
                }
                if self.buffered.capacity() == 0 {
                    if let streams::Result::OwnedAndDone(owned) = stream {
                        bun_output::scoped_log!(
                            ByteStream,
                            "ByteStream.onData owned_and_done and action.fulfill()"
                        );

                        // Move the owned Vec<u8> into the buffer
                        // directly instead of round-tripping through `chunk` (which would borrow
                        // `stream`).
                        self.buffered.adopt(owned, 0);
                        let mut blob = self.to_any_blob().unwrap();
                        action.fulfill(self.parent_const().global_this(), &mut blob);
                        return;
                    }
                }

                bun_output::scoped_log!(
                    ByteStream,
                    "ByteStream.onData appendSlice and action.fulfill()"
                );

                if self.buffered.try_extend(stream.slice()).is_err() {
                    return self.reject_out_of_memory(action);
                }
                drop(stream);
                let mut blob = self.to_any_blob().unwrap();
                action.fulfill(self.parent_const().global_this(), &mut blob);
            } else if self.buffered.try_extend(stream.slice()).is_err()
                && let Some(action) = self.buffer_action.replace(None)
            {
                self.reject_out_of_memory(action);
            }

            return;
        }

        let chunk = stream.slice();

        if self.pending.is_pending() {
            debug_assert!(self.buffered.is_empty());
            // JS can detach the buffer between the pull and now, which gives an empty slice.
            let global = self.parent_const().global_this();
            let mut pending_view = self
                .pending_value
                .get()
                .get()
                .and_then(|view| view.as_array_buffer(global))
                .unwrap_or_default();
            let pending_buf = pending_view.slice_mut();
            let to_copy_len = chunk.len().min(pending_buf.len());
            let pending_buffer_len = pending_buf.len();
            debug_assert!(pending_buf.as_ptr() != chunk.as_ptr());
            pending_buf[..to_copy_len].copy_from_slice(&chunk[..to_copy_len]);
            let has_remaining = chunk.len() > to_copy_len;

            let is_really_done =
                self.has_received_last_chunk.get() && to_copy_len <= pending_buffer_len;

            let into_array = || IntoArray {
                value: self.value(),
                len: to_copy_len as blob::SizeType, // @truncate
            };
            let result = if is_really_done {
                self.done.set(true);

                if to_copy_len > 0 {
                    streams::Result::IntoArrayAndDone(into_array())
                } else if matches!(stream, streams::Result::Err(_)) {
                    core::mem::replace(&mut stream, streams::Result::Done)
                } else {
                    streams::Result::Done
                }
            } else {
                streams::Result::IntoArray(into_array())
            };

            if has_remaining {
                self.append(stream, to_copy_len)
                    .unwrap_or_else(|_| panic!("Out of memory while copying request body"));
            } else {
                // Only resume the producer when the whole chunk fit the pull
                // view. When the tail spilled into `buffer` the next `on_pull`
                // signals once it drains, so resuming now would let another
                // producer chunk land with no reader to take it (it would go
                // straight to `append` below), inflating `buffer` and the
                // producer's own staging buffer by an extra recv each cycle.
                self.signal_drained();
            }

            bun_output::scoped_log!(ByteStream, "ByteStream.onData pending.run()");

            self.pending.run(result);

            return;
        }

        bun_output::scoped_log!(ByteStream, "ByteStream.onData no action just append");

        self.append(stream, 0)
            .unwrap_or_else(|_| panic!("Out of memory while copying request body"));
    }

    fn reject_out_of_memory(&self, mut action: BufferAction) {
        self.cancel_from_sink(None);
        let global = self.parent_const().global_this();
        let error = StrongOptional::create(global.create_out_of_memory_error(), global);
        action.reject(global, &streams::StreamError::JSValue(error));
    }

    /// Buffer `stream`, whose first `offset` bytes a pending pull already took.
    fn append(
        &self,
        stream: streams::Result<'_>,
        offset: usize,
    ) -> Result<(), bun_alloc::AllocError> {
        if self.buffered.capacity() == 0 {
            match stream {
                streams::Result::Owned(owned) | streams::Result::OwnedAndDone(owned) => {
                    self.buffered.adopt(owned, offset);
                }
                streams::Result::TemporaryAndDone(temp) | streams::Result::Temporary(temp) => {
                    self.buffered.adopt(temp[offset..].to_vec(), 0);
                }
                streams::Result::Err(err) => self.pending_error.set(Some(err)),
                streams::Result::Done => {}
                _ => unreachable!(),
            }
            return Ok(());
        }

        match stream {
            streams::Result::TemporaryAndDone(temp) | streams::Result::Temporary(temp) => {
                self.buffered.extend(&temp[offset..]);
            }
            streams::Result::OwnedAndDone(owned) | streams::Result::Owned(owned) => {
                self.buffered.extend(&owned.slice()[offset..]);
                // `owned: Vec<u8>` drops here.
            }
            streams::Result::Err(err) => {
                if self.buffer_action.get().is_some() {
                    panic!("Expected buffer action to be null");
                }
                // Erroring a stream discards queued chunks; drop the buffered
                // bytes now instead of retaining them off-heap until GC.
                self.buffered.clear();
                self.pending_error.set(Some(err));
            }
            streams::Result::Done => {}
            // We don't support the rest of these yet
            _ => unreachable!(),
        }

        Ok(())
    }

    fn set_value(&self, view: JSValue) {
        bun_jsc::mark_binding!();
        let global = self.parent_const().global_this();
        self.pending_value.with_mut(|pv| pv.set(global, view));
    }

    /// The JS stream was errored with `reason`. A native reader that waits now fails with it.
    pub(crate) fn error_native_consumer(&self, reason: JSValue) {
        let waiting = self.sink.get().is_some()
            || self.buffer_action.get().is_some()
            || self.pending.is_pending();
        self.on_data(streams::Result::Err(if waiting {
            let global = self.parent_const().global_this();
            streams::StreamError::JSValue(StrongOptional::create(reason, global))
        } else {
            // Kept for a reader that already holds this source and pulls later. A stored `reason` would be a GC root.
            streams::StreamError::AbortReason(jsc::CommonAbortReason::UserAbort)
        }));
    }

    pub(crate) fn on_cancel(&self) {
        bun_jsc::mark_binding!();
        let view = self.value();
        self.buffered.clear();
        self.done.set(true);
        self.pending_value.set(Default::default());
        // A native sink wired to this stream must fail, not later see an EOF and commit what it
        // has (an S3 upload would complete with a truncated object).
        let sink = *self.sink.get();
        if sink.is_some() {
            self.detach_sink(None);
            sink.end(Some(streams::StreamError::AbortReason(
                jsc::CommonAbortReason::UserAbort,
            )));
        }

        if !view.is_empty() {
            self.pending_error.set(None);
            self.pending.run(streams::Result::Done);
        }

        if let Some(mut action) = self.buffer_action.replace(None) {
            let global = self.parent_const().global_this();
            action.reject(
                global,
                &streams::StreamError::AbortReason(jsc::CommonAbortReason::UserAbort),
            );
            self.buffer_action.set(None);
        }
    }

    pub(crate) fn drain(&self) -> Vec<u8> {
        let drained = self.take_buffer();
        if !drained.is_empty() {
            // After taking, as in `on_pull`: the producer decides whether to
            // resume from `buffer.len()`, and anything it emits inline queues
            // behind these bytes for the next pull.
            self.signal_drained();
        }
        drained
    }

    /// The producer failed before anything attached and [`Self::append`] stored its error.
    pub(crate) fn has_pending_error(&self) -> bool {
        self.pending_error.is_some()
    }

    /// Take the error stored by [`Self::append`].
    pub fn take_pending_error(&self) -> Option<streams::StreamError> {
        self.pending_error.take()
    }

    /// End the attached sink with the stored producer error. Returns false if none is stored.
    pub(crate) fn end_sink_with_pending_error(&self) -> bool {
        let sink = *self.sink.get();
        debug_assert!(sink.is_some());
        let Some(err) = self.take_pending_error() else {
            return false;
        };
        self.detach_sink(Some(&err));
        sink.end(Some(err));
        true
    }

    pub(crate) fn to_any_blob(&self) -> Option<blob::Any> {
        if self.has_received_last_chunk.get() && !self.has_pending_error() {
            let buffer = self.buffered.take();
            self.done.set(true);
            self.parent_const().is_closed.set(true);
            return Some(blob::Any::InternalBlob(blob::Internal {
                bytes: buffer,
                was_string: false,
            }));
        }

        None
    }
}

/// `bun:internal-for-testing`: swap the stream's producer for
/// [`streams::SourceHandle::TestingCancelOnDrain`], whose drain signal
/// re-enters `on_cancel` and consumes the pending buffer action.
pub(crate) fn cancel_on_drain(cx: &mut JsScope<'_>, stream: JsLocal<'_>) -> bun_jsc::JsResult<()> {
    let global = cx.global();
    let stream = readable_stream::ReadableStream::from_js(stream.to_js(), global)?;
    let Some(bytes) = stream.and_then(|s| s.ptr.bytes()) else {
        return Err(global.throw(format_args!("expected a ByteStream-backed ReadableStream")));
    };
    bytes
        .parent_const()
        .producer
        .set(streams::SourceHandle::TestingCancelOnDrain(bytes));
    Ok(())
}
