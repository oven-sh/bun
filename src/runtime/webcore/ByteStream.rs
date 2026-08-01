use core::cell::Cell;

use bun_collections::VecExt;
use bun_jsc::{self as jsc, JSGlobalObject, JSValue, JsCell};
use bun_sys::Error as SysError;

use crate::webcore::SinkHandle;
use crate::webcore::streams::{self, BufferAction};
use crate::webcore::{blob, readable_stream};

bun_output::declare_scope!(ByteStream, visible);

/// R-2 (`sharedThis`): every JS-reachable inherent method takes `&self` so a
/// re-entrant JS call (e.g. `pending.run()` → JS → `onPull`) cannot stack two
/// `&mut ByteStream`. Fields mutated on those paths are wrapped in `Cell`
/// (Copy scalars / raw ptrs) or [`JsCell`] (non-Copy).
///
/// The `SourceContext` trait still spells its callbacks `&mut self` (shared
/// across `ByteBlobLoader` / `FileReader`); the trait impl below auto-derefs
/// to the `&self` inherent bodies.
pub struct ByteStream {
    pub(crate) buffer: JsCell<Vec<u8>>,
    pub(crate) has_received_last_chunk: Cell<bool>,
    pub(crate) pending: JsCell<streams::Pending>,
    pub(crate) done: Cell<bool>,
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
            buffer: JsCell::new(Vec::new()),
            has_received_last_chunk: Cell::new(false),
            pending: JsCell::new(streams::Pending {
                result: streams::Result::Done,
                ..Default::default()
            }),
            done: Cell::new(false),
            sink: JsCell::new(SinkHandle::None),
            sink_paused: Cell::new(false),
            size_hint: Cell::new(0),
            buffer_action: JsCell::new(None),
        }
    }
}

/// ReadableStream source backed by a ByteStream.
pub type Source = readable_stream::NewSource<ByteStream>;

impl readable_stream::SourceContext for ByteStream {
    const NAME: &'static str = "Bytes";
    // setRefUnrefFn = null
    const SUPPORTS_REF: bool = false;
    crate::source_context_codegen!(js_BytesInternalReadableStreamSource);

    // R-2: trait sigs are fixed at `&mut self` (shared with the other
    // `SourceContext` impls); `&mut T` auto-derefs to `&T` so each body
    // forwards to the `&self` inherent method below.
    fn on_start(&mut self) -> streams::Start {
        Self::on_start(self)
    }
    fn on_pull(&mut self, buf: &mut [u8], view: JSValue) -> streams::Result {
        Self::on_pull(self, buf, view)
    }
    fn on_cancel(&mut self) {
        Self::on_cancel(self)
    }
    fn deinit_fn(&mut self) {
        Self::finalize(self)
    }
    fn drain_internal_buffer(&mut self) -> Vec<u8> {
        Self::drain(self)
    }
    fn memory_cost_fn(&self) -> usize {
        Self::memory_cost(self)
    }
    fn to_buffered_value(
        &mut self,
        global: &JSGlobalObject,
        action: streams::BufferActionTag,
    ) -> Option<bun_jsc::JsResult<JSValue>> {
        Some(Self::to_buffered_value(self, global, action))
    }
}

// SAFETY: `ByteStream` is always the `context` field of a `Source`
// (ReadableStream.NewSource); never constructed standalone. `parent` returns
// `*mut Source` (not `&mut`) — retained for the `finalize` (GC-teardown) path
// only; all host-fn-reachable callers use `parent_const`.
bun_core::impl_field_parent! { ByteStream => Source.context; pub fn parent_const; pub fn parent; }

impl ByteStream {
    /// Init-time reset. Runs before the JS
    /// wrapper exists, so `&mut self` is sound here (R-2 exemption).
    pub(crate) fn setup(&mut self) {
        // Called immediately after `ByteStream::default()` construction;
        // the old value owns nothing the new one
        // reuses, so dropping it is the intended reset.
        drop(core::mem::take(self));
    }

    fn on_start(&self) -> streams::Start {
        if self.has_received_last_chunk.get() && self.buffer.get().is_empty() {
            return streams::Start::Empty;
        }

        if self.has_received_last_chunk.get() {
            let buffer = self.buffer.replace(Vec::new());
            return streams::Start::OwnedAndDone(Vec::<u8>::move_from_list(buffer));
        }

        streams::Start::ReadyOwned
    }

    pub(crate) fn unpipe_without_deref(&self) {
        self.sink.set(SinkHandle::None);
        self.sink_paused.set(false);
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

        if !self.buffer.get().is_empty() {
            let buffered = self.buffer.replace(Vec::new());
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
                    self.sink.set(SinkHandle::None);
                    sink.end(Some(streams::StreamError::Error(e)));
                    return;
                }
                streams::Writable::Done => {
                    self.sink.set(SinkHandle::None);
                    sink.end(None);
                    return;
                }
                _ => {}
            }
        }

        self.signal_drained();

        if self.has_received_last_chunk.get() && self.sink.get().is_some() {
            self.sink.set(SinkHandle::None);
            sink.end(None);
        }
    }

    /// Sink closed early: detach and drive the NewSource cancel path.
    pub fn cancel_from_sink(&self, _err: Option<SysError>) {
        self.sink.set(SinkHandle::None);
        self.sink_paused.set(false);
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
    fn signal_drained(&self) {
        self.parent_const().producer.get().ready(None, None);
    }

    /// Called by native fast-paths after wiring `self.sink`. Restores
    /// producer-side backpressure if it was already dropped (BufferAll).
    pub fn signal_consumer_attached(&self) {
        self.parent_const().producer.get().start();
    }

    pub(crate) fn on_data(&self, stream: streams::Result) -> Result<(), bun_jsc::JsTerminated> {
        bun_jsc::mark_binding!();
        if self.done.get() {
            // The owned `Vec<u8>`/`Vec`
            // payload drops implicitly at the `return` below — no explicit `drop` needed.
            self.has_received_last_chunk.set(stream.is_done());

            bun_output::scoped_log!(ByteStream, "ByteStream.onData already done... do nothing");

            return Ok(());
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
                self.sink.set(SinkHandle::None);
                self.sink_paused.set(false);
                sink.end(Some(err));
                return Ok(());
            }

            if self.sink_paused.get() {
                bun_output::scoped_log!(ByteStream, "ByteStream.onData sink paused → buffer");
                self.append(stream);
                return Ok(());
            }

            let is_done = stream.is_done();
            match sink.write(&stream) {
                streams::Writable::Backpressure(_) => {
                    self.sink_paused.set(true);
                }
                streams::Writable::Err(e) => {
                    self.sink.set(SinkHandle::None);
                    self.sink_paused.set(false);
                    sink.end(Some(streams::StreamError::Error(e)));
                    return Ok(());
                }
                streams::Writable::Done => {
                    self.sink.set(SinkHandle::None);
                    self.sink_paused.set(false);
                    sink.end(None);
                    return Ok(());
                }
                _ => {
                    self.signal_drained();
                }
            }

            if is_done && !self.sink_paused.get() && self.sink.get().is_some() {
                self.sink.set(SinkHandle::None);
                sink.end(None);
            }
            return Ok(());
        }

        if self.buffer_action.get().is_some() {
            self.signal_drained();
            if let streams::Result::Err(err) = &stream {
                // Explicit post-reject cleanup; runs after `action.reject`
                // (`?` would skip it).
                bun_output::scoped_log!(ByteStream, "ByteStream.onData err  action.reject()");

                let global = self.parent_const().global_this();
                // R-2: move the action out of the cell *before* calling
                // `reject` (which resolves a JS promise and may re-enter).
                let mut action = self.buffer_action.replace(None).unwrap();
                let res = action.reject(global, err);

                self.buffer.with_mut(|b| {
                    b.clear();
                    b.shrink_to_fit();
                });
                self.pending.with_mut(|p| {
                    p.result.release();
                    p.result = streams::Result::Done;
                });
                self.buffer_action.set(None);

                return res;
            }

            if self.has_received_last_chunk.get() {
                // `defer { this.buffer_action = null; }` — handled by `replace(None)` below.
                let mut action = self.buffer_action.replace(None).unwrap();

                if self.buffer.get().capacity() == 0 && matches!(stream, streams::Result::Done) {
                    bun_output::scoped_log!(
                        ByteStream,
                        "ByteStream.onData done and action.fulfill()"
                    );

                    let mut blob = self.to_any_blob().unwrap();
                    return action.fulfill(self.parent_const().global_this(), &mut blob);
                }
                if self.buffer.get().capacity() == 0 {
                    if let streams::Result::OwnedAndDone(mut owned) = stream {
                        bun_output::scoped_log!(
                            ByteStream,
                            "ByteStream.onData owned_and_done and action.fulfill()"
                        );

                        // Move the owned Vec<u8> into `buffer`
                        // directly instead of round-tripping through `chunk` (which would borrow
                        // `stream`).
                        self.buffer.set(owned.move_to_list_managed());
                        let mut blob = self.to_any_blob().unwrap();
                        return action.fulfill(self.parent_const().global_this(), &mut blob);
                    }
                }

                bun_output::scoped_log!(
                    ByteStream,
                    "ByteStream.onData appendSlice and action.fulfill()"
                );

                self.buffer
                    .with_mut(|b| b.extend_from_slice(stream.slice()));
                // The owned `Vec<u8>`
                // payload of `stream` is freed by its Drop glue at the explicit `drop` below
                // (Temporary* variants are non-owning `RawSlice` and so are left alone).
                drop(stream);
                let mut blob = self.to_any_blob().unwrap();
                return action.fulfill(self.parent_const().global_this(), &mut blob);
            } else {
                self.buffer
                    .with_mut(|b| b.extend_from_slice(stream.slice()));
                // The owned `Vec<u8>` payload of
                // `stream` is freed by its Drop glue (Temporary* are non-owning `RawSlice`, left alone).
                drop(stream);
            }

            return Ok(());
        }

        if self.pending.get().state == streams::PendingState::Pending {
            debug_assert!(self.buffer.get().is_empty());

            let is_done = self.has_received_last_chunk.get();
            let result = match stream {
                streams::Result::Err(_) => {
                    self.done.set(true);
                    stream
                }
                streams::Result::Done => {
                    self.done.set(true);
                    streams::Result::Done
                }
                streams::Result::Owned(owned) | streams::Result::OwnedAndDone(owned) => {
                    if is_done {
                        self.done.set(true);
                        if owned.is_empty() {
                            streams::Result::Done
                        } else {
                            streams::Result::OwnedAndDone(owned)
                        }
                    } else {
                        streams::Result::Owned(owned)
                    }
                }
                streams::Result::Temporary(temp) | streams::Result::TemporaryAndDone(temp) => {
                    let owned = temp.slice().to_vec();
                    if is_done {
                        self.done.set(true);
                        if owned.is_empty() {
                            streams::Result::Done
                        } else {
                            streams::Result::OwnedAndDone(owned)
                        }
                    } else {
                        streams::Result::Owned(owned)
                    }
                }
                _ => unreachable!(),
            };

            self.pending.with_mut(|p| p.result = result);
            self.signal_drained();

            bun_output::scoped_log!(ByteStream, "ByteStream.onData pending.run()");

            // R-2: `Pending::run` resolves a JS promise (re-enters JS); the
            // `with_mut` borrow is `UnsafeCell`-backed so `noalias` is
            // suppressed on `&self`, which is the load-bearing fix vs the old
            // `&mut self` form.
            self.pending.with_mut(|p| p.run());

            return Ok(());
        }

        bun_output::scoped_log!(ByteStream, "ByteStream.onData no action just append");

        self.append(stream);
        Ok(())
    }

    fn append(&self, stream: streams::Result) {
        if self.buffer.get().capacity() == 0 {
            match stream {
                streams::Result::Owned(mut owned) | streams::Result::OwnedAndDone(mut owned) => {
                    // `move_to_list_managed` moves the buffer, no copy.
                    self.buffer.set(owned.move_to_list_managed());
                }
                streams::Result::TemporaryAndDone(temp) | streams::Result::Temporary(temp) => {
                    self.buffer.set(temp.slice().to_vec());
                }
                streams::Result::Err(err) => {
                    self.pending
                        .with_mut(|p| p.result = streams::Result::Err(err));
                }
                streams::Result::Done => {}
                _ => unreachable!(),
            }
            return;
        }

        match stream {
            streams::Result::TemporaryAndDone(temp) | streams::Result::Temporary(temp) => {
                self.buffer.with_mut(|b| b.extend_from_slice(temp.slice()));
            }
            streams::Result::OwnedAndDone(owned) | streams::Result::Owned(owned) => {
                self.buffer.with_mut(|b| b.extend_from_slice(owned.slice()));
                // `owned: Vec<u8>` drops here.
            }
            streams::Result::Err(err) => {
                if self.buffer_action.get().is_some() {
                    panic!("Expected buffer action to be null");
                }
                // Erroring a stream discards queued chunks; drop the buffered
                // bytes now instead of retaining them off-heap until GC.
                self.buffer.with_mut(|b| {
                    b.clear();
                    b.shrink_to_fit();
                });
                self.pending
                    .with_mut(|p| p.result = streams::Result::Err(err));
            }
            streams::Result::Done => {}
            // We don't support the rest of these yet
            _ => unreachable!(),
        }
    }

    fn on_pull(&self, _buffer: &mut [u8], _view: JSValue) -> streams::Result {
        bun_jsc::mark_binding!();
        debug_assert!(self.buffer_action.get().is_none());

        if !self.buffer.get().is_empty() {
            debug_assert!(self.pending.get().state != streams::PendingState::Pending);
            let owned = self.buffer.replace(Vec::new());

            self.signal_drained();

            if self.has_received_last_chunk.get() {
                self.done.set(true);
                return streams::Result::OwnedAndDone(owned);
            }

            return streams::Result::Owned(owned);
        }

        if self.has_received_last_chunk.get() {
            // Surface a stored terminal error (set by `append(Err)` when no
            // reader was waiting) instead of silently reporting `Done`.
            if matches!(self.pending.get().result, streams::Result::Err(_)) {
                return self
                    .pending
                    .with_mut(|p| core::mem::replace(&mut p.result, streams::Result::Done));
            }
            return streams::Result::Done;
        }

        // R-2: `JsCell::as_ptr` yields the stable `*mut Pending` that the
        // returned `streams::Result::Pending` raw-backref needs.
        streams::Result::Pending(self.pending.as_ptr())
    }

    fn on_cancel(&self) {
        bun_jsc::mark_binding!();
        if self.buffer.get().capacity() > 0 {
            self.buffer.with_mut(|b| {
                b.clear();
                b.shrink_to_fit();
            });
        }
        self.done.set(true);

        if self.pending.get().state == streams::PendingState::Pending {
            self.pending.with_mut(|p| {
                p.result.release();
                p.result = streams::Result::Done;
            });
            self.pending.with_mut(|p| p.run());
        }

        if let Some(mut action) = self.buffer_action.replace(None) {
            let global = self.parent_const().global_this();
            // TODO: properly propagate exception upwards
            let _ = action.reject(
                global,
                &streams::StreamError::AbortReason(jsc::CommonAbortReason::UserAbort),
            );
            self.buffer_action.set(None);
        }
    }

    fn memory_cost(&self) -> usize {
        // ReadableStreamSource covers @sizeOf(ByteStream)
        self.buffer.get().capacity()
    }

    /// NOTE: not `impl Drop` — `ByteStream` is the `context` payload of a `.classes.ts`
    /// `ReadableStreamSource`; teardown is driven by the GC finalizer via `Source::finalize`,
    /// which calls this. Per §JSC, `.classes.ts` payloads use `finalize`, not `deinit`/`Drop`.
    ///
    /// R-2: stays `&mut self` — this is the destructor path (called once from
    /// `SourceContext::deinit_fn(&mut self)` after the ref-count hits zero), so
    /// no JS re-entry can alias `self`; and `parent().deinit()` needs unique
    /// `Box` provenance.
    fn finalize(&mut self) {
        bun_jsc::mark_binding!();
        if self.buffer.get().capacity() > 0 {
            self.buffer.with_mut(|b| {
                b.clear();
                b.shrink_to_fit();
            });
        }

        if !self.done.get() {
            self.done.set(true);

            let is_promise = self.pending.with_mut(|p| {
                p.result.release();
                p.result = streams::Result::Done;
                p.state == streams::PendingState::Pending
                    && matches!(p.future, streams::PendingFuture::Promise { .. })
            });
            if is_promise {
                // We must never run JavaScript inside of a GC finalizer.
                self.pending.with_mut(|p| p.run_on_next_tick());
            } else {
                self.pending.with_mut(|p| p.run());
            }
        }
        if let Some(action) = self.buffer_action.replace(None) {
            // JSPromiseStrong implements Drop, so dropping the enum releases
            // each variant's JSPromiseStrong payload.
            drop(action);
        }
        // Enclosing `Box<NewSource<ByteStream>>` is freed by the caller
        // (`NewSource::decrement_count`) after this returns; freeing it here would
        // deallocate the storage backing `&mut self` (dangling UAF).
    }

    pub(crate) fn drain(&self) -> Vec<u8> {
        if !self.buffer.get().is_empty() {
            self.signal_drained();
            return Vec::<u8>::move_from_list(self.buffer.replace(Vec::new()));
        }
        Vec::<u8>::default()
    }

    /// Take a pre-attach `StreamResult::Err` stashed by [`Self::append`].
    pub fn take_pending_error(&self) -> Option<streams::StreamError> {
        self.pending.with_mut(|p| {
            if matches!(p.result, streams::Result::Err(_)) {
                match core::mem::replace(&mut p.result, streams::Result::Done) {
                    streams::Result::Err(e) => Some(e),
                    _ => None,
                }
            } else {
                None
            }
        })
    }

    pub(crate) fn to_any_blob(&self) -> Option<blob::Any> {
        if self.has_received_last_chunk.get() {
            let buffer = self.buffer.replace(Vec::new());
            self.done.set(true);
            self.pending.with_mut(|p| {
                p.result.release();
                p.result = streams::Result::Done;
            });
            self.parent_const().is_closed.set(true);
            return Some(blob::Any::InternalBlob(blob::Internal {
                bytes: buffer,
                was_string: false,
            }));
        }

        None
    }

    fn to_buffered_value(
        &self,
        global_this: &JSGlobalObject,
        action: streams::BufferActionTag,
    ) -> bun_jsc::JsResult<JSValue> {
        if self.buffer_action.get().is_some() {
            return Err(global_this.throw(format_args!("Cannot buffer value twice")));
        }

        if let streams::Result::Err(err) = &self.pending.get().result {
            let err_js = err.to_js(global_this);
            err_js.ensure_still_alive();
            self.pending.with_mut(|p| p.result = streams::Result::Done);
            self.done.set(true);
            self.buffer.with_mut(|b| {
                b.clear();
                b.shrink_to_fit();
            });
            return Ok(
                jsc::JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                    global_this,
                    err_js,
                ),
            );
        }

        if let Some(blob_) = self.to_any_blob() {
            let mut blob = blob_;
            return Ok(blob.to_promise(global_this, action)?);
        }

        self.signal_drained();
        self.buffer_action
            .set(Some(BufferAction::new(action, global_this)));

        Ok(self.buffer_action.get().as_ref().unwrap().value())
    }
}
