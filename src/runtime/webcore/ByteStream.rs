use core::mem::offset_of;

use bun_collections::VecExt;
use bun_core::Output;
use bun_jsc::strong::Optional as StrongOptional;
use bun_jsc::{self as jsc, JSGlobalObject, JSPromiseStrong, JSValue};

use crate::webcore::streams::{self, BufferAction, IntoArray};
use crate::webcore::Pipe;
use crate::webcore::{blob, readable_stream};


bun_output::declare_scope!(ByteStream, visible);

pub struct ByteStream {
    pub buffer: Vec<u8>,
    pub has_received_last_chunk: bool,
    pub pending: streams::Pending,
    pub done: bool,
    /// Borrowed view into a JS `Uint8Array` passed from `on_pull`; kept alive by `pending_value`.
    // TODO(port): lifetime — raw fat slice ptr because the backing store is JS-heap-owned and
    // rooted via `pending_value: Strong`. Never freed by Rust.
    pub pending_buffer: *mut [u8],
    pub pending_value: StrongOptional, // jsc.Strong.Optional
    pub offset: usize,
    pub high_water_mark: blob::SizeType,
    pub pipe: Pipe,
    pub size_hint: blob::SizeType,
    pub buffer_action: Option<BufferAction>,
}

impl Default for ByteStream {
    fn default() -> Self {
        Self {
            buffer: Vec::new(),
            has_received_last_chunk: false,
            pending: streams::Pending { result: streams::Result::Done, ..Default::default() },
            done: false,
            pending_buffer: core::ptr::slice_from_raw_parts_mut(core::ptr::NonNull::<u8>::dangling().as_ptr(), 0),
            pending_value: StrongOptional::empty(),
            offset: 0,
            high_water_mark: 0,
            pipe: Pipe::default(),
            size_hint: 0,
            buffer_action: None,
        }
    }
}

/// `webcore.ReadableStream.NewSource(@This(), "Bytes", onStart, onPull, onCancel, deinit, null, drain, memoryCost, toBufferedValue)`
// TODO(port): `NewSource` is a Zig comptime type-generator that wires callbacks into a
// `.classes.ts` wrapper. In Rust this becomes `ReadableStream::Source<ByteStream>` where
// `ByteStream: ReadableStreamSourceContext` (trait with `on_start`/`on_pull`/... methods).
pub type Source = readable_stream::NewSource<ByteStream>;

pub const TAG: readable_stream::Tag = readable_stream::Tag::Bytes;

impl readable_stream::SourceContext for ByteStream {
    const NAME: &'static str = "Bytes";
    // setRefUnrefFn = null
    const SUPPORTS_REF: bool = false;
    crate::source_context_codegen!(
        BytesInternalReadableStreamSource__create,
        BytesInternalReadableStreamSourcePrototype__pendingPromiseSetCachedValue,
        BytesInternalReadableStreamSourcePrototype__onDrainCallbackSetCachedValue,
        BytesInternalReadableStreamSourcePrototype__onDrainCallbackGetCachedValue
    );

    fn on_start(&mut self) -> streams::Start { Self::on_start(self) }
    fn on_pull(&mut self, buf: &mut [u8], view: JSValue) -> streams::Result {
        Self::on_pull(self, buf, view)
    }
    fn on_cancel(&mut self) { Self::on_cancel(self) }
    fn deinit_fn(&mut self) { Self::finalize(self) }
    fn drain_internal_buffer(&mut self) -> Vec<u8> { Self::drain(self) }
    fn memory_cost_fn(&self) -> usize { Self::memory_cost(self) }
    fn to_buffered_value(
        &mut self,
        global: &JSGlobalObject,
        action: streams::BufferActionTag,
    ) -> Option<bun_jsc::JsResult<JSValue>> {
        Some(Self::to_buffered_value(self, global, action))
    }
}

impl ByteStream {
    #[inline]
    fn empty_pending_buffer() -> *mut [u8] {
        core::ptr::slice_from_raw_parts_mut(core::ptr::NonNull::<u8>::dangling().as_ptr(), 0)
    }

    pub fn setup(&mut self) {
        // Called immediately after `ByteStream::default()` construction (Zig
        // wrote into `undefined`); the old value owns nothing the new one
        // reuses, so dropping it is the intended reset.
        drop(core::mem::take(self));
    }

    pub fn on_start(&mut self) -> streams::Start {
        if self.has_received_last_chunk && self.buffer.is_empty() {
            return streams::Start::Empty;
        }

        if self.has_received_last_chunk {
            let buffer = core::mem::take(&mut self.buffer);
            return streams::Start::OwnedAndDone(Vec::<u8>::move_from_list(buffer));
        }

        if self.high_water_mark == 0 {
            return streams::Start::Ready;
        }

        // For HTTP, the maximum streaming response body size will be 512 KB.
        // #define LIBUS_RECV_BUFFER_LENGTH 524288
        // For HTTPS, the size is probably quite a bit lower like 64 KB due to TLS transmission.
        // We add 1 extra page size so that if there's a little bit of excess buffered data, we avoid extra allocations.
        let page_size: blob::SizeType = blob::SizeType::try_from(bun_sys::page_size()).expect("int cast");
        streams::Start::ChunkSize((512 * 1024 + page_size).min(self.high_water_mark.max(page_size)))
    }

    pub fn value(&mut self) -> JSValue {
        let Some(result) = self.pending_value.get() else {
            return JSValue::ZERO;
        };
        self.pending_value.clear_without_deallocation();
        result
    }

    pub fn is_cancelled(&self) -> bool {
        self.parent_const().cancelled
    }

    pub fn unpipe_without_deref(&mut self) {
        self.pipe.ctx = None;
        self.pipe.on_pipe = None;
    }

    pub fn on_data(&mut self, stream: streams::Result) -> Result<(), bun_jsc::JsTerminated> {
        // TODO(port): narrow error set — Zig `bun.JSTerminated!void`
        bun_jsc::mark_binding!();
        if self.done {
            // PORT NOTE: Zig frees `stream.owned.slice()` / `stream.owned_and_done.slice()` here
            // via `allocator.free` when the variant is owned. In Rust the owned `Vec<u8>`/`Vec`
            // payload drops implicitly at the `return` below — no explicit `drop` needed.
            self.has_received_last_chunk = stream.is_done();

            bun_output::scoped_log!(ByteStream, "ByteStream.onData already done... do nothing");

            return Ok(());
        }

        debug_assert!(!self.has_received_last_chunk || matches!(stream, streams::Result::Err(_)));
        self.has_received_last_chunk = stream.is_done();

        if let Some(ctx) = self.pipe.ctx {
            // TODO(port): `Pipe.onPipe` signature — Zig passes `(ctx, stream, allocator)`.
            (self.pipe.on_pipe.unwrap())(ctx, stream);
            return Ok(());
        }

        if let Some(action) = self.buffer_action.as_mut() {
            if let streams::Result::Err(err) = &stream {
                // PORT NOTE: Zig `defer { ... }` block — runs after `action.reject`. Reordered
                // here as explicit post-reject cleanup since `?` would skip it.
                bun_output::scoped_log!(ByteStream, "ByteStream.onData err  action.reject()");

                let global = self.parent().global_this;
                // PORT NOTE: reshaped for borrowck — re-borrow action via Option::take so we
                // can mutate other fields afterwards.
                let mut action = self.buffer_action.take().unwrap();
                let res = action.reject(global, err.clone());

                self.buffer.clear();
                self.buffer.shrink_to_fit();
                self.pending.result.release();
                self.pending.result = streams::Result::Done;
                self.buffer_action = None;

                return res;
            }

            if self.has_received_last_chunk {
                // `defer { this.buffer_action = null; }` — handled by `take()` below.
                let mut action = self.buffer_action.take().unwrap();

                if self.buffer.capacity() == 0 && matches!(stream, streams::Result::Done) {
                    bun_output::scoped_log!(ByteStream, "ByteStream.onData done and action.fulfill()");

                    let mut blob = self.to_any_blob().unwrap();
                    return action.fulfill(self.parent().global_this, &mut blob);
                }
                if self.buffer.capacity() == 0 {
                    if let streams::Result::OwnedAndDone(mut owned) = stream {
                        bun_output::scoped_log!(ByteStream, "ByteStream.onData owned_and_done and action.fulfill()");

                        // Zig: `std.array_list.Managed(u8).fromOwnedSlice(bun.default_allocator, @constCast(chunk))`
                        // PORT NOTE: reshaped for borrowck — move the owned Vec<u8> into `buffer`
                        // directly instead of round-tripping through `chunk` (which would borrow
                        // `stream`).
                        self.buffer = owned.move_to_list_managed();
                        let mut blob = self.to_any_blob().unwrap();
                        return action.fulfill(self.parent().global_this, &mut blob);
                    }
                }

                bun_output::scoped_log!(ByteStream, "ByteStream.onData appendSlice and action.fulfill()");

                self.buffer.extend_from_slice(stream.slice());
                // Zig `defer { if owned* allocator.free(stream.slice()) }` — owned `Vec<u8>`
                // payload of `stream` is freed by its Drop glue at the explicit `drop` below
                // (Temporary* variants are `ManuallyDrop` and so are left alone, matching Zig).
                drop(stream);
                let mut blob = self.to_any_blob().unwrap();
                return action.fulfill(self.parent().global_this, &mut blob);
            } else {
                self.buffer.extend_from_slice(stream.slice());
                // Zig: `if owned* allocator.free(stream.slice())` — owned `Vec<u8>` payload of
                // `stream` is freed by its Drop glue (Temporary* are `ManuallyDrop`, left alone).
                drop(stream);
            }

            return Ok(());
        }

        let chunk = stream.slice();

        if self.pending.state == streams::PendingState::Pending {
            debug_assert!(self.buffer.is_empty());
            // SAFETY: pending_buffer is either dangling+len=0 or points into a live JS
            // Uint8Array rooted by `pending_value`.
            let pending_buf = unsafe { &mut *self.pending_buffer };
            let to_copy_len = chunk.len().min(pending_buf.len());
            let pending_buffer_len = pending_buf.len();
            debug_assert!(pending_buf.as_ptr() != chunk.as_ptr());
            pending_buf[..to_copy_len].copy_from_slice(&chunk[..to_copy_len]);
            self.pending_buffer = Self::empty_pending_buffer();

            let is_really_done = self.has_received_last_chunk && to_copy_len <= pending_buffer_len;

            if is_really_done {
                self.done = true;

                if to_copy_len == 0 {
                    if let streams::Result::Err(err) = &stream {
                        self.pending.result = streams::Result::Err(err.clone());
                    } else {
                        self.pending.result = streams::Result::Done;
                    }
                } else {
                    self.pending.result = streams::Result::IntoArrayAndDone(IntoArray {
                        value: self.value(),
                        len: to_copy_len as blob::SizeType, // @truncate
                    });
                }
            } else {
                self.pending.result = streams::Result::IntoArray(IntoArray {
                    value: self.value(),
                    len: to_copy_len as blob::SizeType, // @truncate
                });
            }

            let remaining = &chunk[to_copy_len..];
            if !remaining.is_empty() && !chunk.is_empty() {
                // PORT NOTE: `chunk` borrows `stream`; passing both requires re-slicing inside
                // `append`. Zig passes `base_address = chunk` for the free path.
                self.append(stream, to_copy_len)
                    .unwrap_or_else(|_| panic!("Out of memory while copying request body"));
            }

            bun_output::scoped_log!(ByteStream, "ByteStream.onData pending.run()");

            self.pending.run();

            return Ok(());
        }

        bun_output::scoped_log!(ByteStream, "ByteStream.onData no action just append");

        self.append(stream, 0)
            .unwrap_or_else(|_| panic!("Out of memory while copying request body"));
        Ok(())
    }

    pub fn append(
        &mut self,
        stream: streams::Result,
        offset: usize,
        // PORT NOTE: Zig `base_address: []const u8` + `allocator` params dropped — `base_address`
        // was only used for `allocator.free(@constCast(base_address))`, which is the Drop of the
        // owned `stream` payload in Rust.
    ) -> Result<(), bun_alloc::AllocError> {
        if self.buffer.capacity() == 0 {
            match stream {
                streams::Result::Owned(mut owned) | streams::Result::OwnedAndDone(mut owned) => {
                    // Zig: `owned.moveToListManaged(allocator)` — moves the buffer, no copy.
                    self.buffer = owned.move_to_list_managed();
                    self.offset += offset;
                }
                streams::Result::TemporaryAndDone(temp) | streams::Result::Temporary(temp) => {
                    let chunk = &temp.slice()[offset..];
                    self.buffer = Vec::with_capacity(chunk.len());
                    // PERF(port): was appendSliceAssumeCapacity — profile in Phase B
                    self.buffer.extend_from_slice(chunk);
                }
                streams::Result::Err(err) => {
                    self.pending.result = streams::Result::Err(err);
                }
                streams::Result::Done => {}
                _ => unreachable!(),
            }
            return Ok(());
        }

        match stream {
            streams::Result::TemporaryAndDone(temp) | streams::Result::Temporary(temp) => {
                self.buffer.extend_from_slice(&temp.slice()[offset..]);
            }
            streams::Result::OwnedAndDone(owned) | streams::Result::Owned(owned) => {
                self.buffer.extend_from_slice(&owned.slice()[offset..]);
                // Zig: `allocator.free(@constCast(base_address))` — `owned: Vec<u8>` drops here.
            }
            streams::Result::Err(err) => {
                if self.buffer_action.is_some() {
                    panic!("Expected buffer action to be null");
                }
                self.pending.result = streams::Result::Err(err);
            }
            streams::Result::Done => {}
            // We don't support the rest of these yet
            _ => unreachable!(),
        }

        Ok(())
    }

    pub fn set_value(&mut self, view: JSValue) {
        bun_jsc::mark_binding!();
        // SAFETY: `global_this` is a JSC_BORROW raw pointer stored from a live
        // `&JSGlobalObject`; valid for the lifetime of the JS VM thread.
        let global = unsafe { &*self.parent().global_this };
        self.pending_value.set(global, view);
    }

    pub fn parent(&mut self) -> &mut Source {
        // SAFETY: `self` is always the `context` field of a `Source` (ReadableStream.NewSource);
        // ByteStream is never constructed standalone.
        unsafe {
            &mut *std::ptr::from_mut::<Self>(self).cast::<u8>()
                .sub(offset_of!(Source, context))
                .cast::<Source>()
        }
    }

    fn parent_const(&self) -> &Source {
        // SAFETY: same invariant as `parent` — `self` is the `context` field of a `Source`.
        unsafe {
            &*std::ptr::from_ref::<Self>(self).cast::<u8>()
                .sub(offset_of!(Source, context))
                .cast::<Source>()
        }
    }

    pub fn on_pull(&mut self, buffer: &mut [u8], view: JSValue) -> streams::Result {
        bun_jsc::mark_binding!();
        debug_assert!(!buffer.is_empty());
        debug_assert!(self.buffer_action.is_none());

        if !self.buffer.is_empty() {
            debug_assert!(self.value().is_empty()); // == .zero
            let to_write = (self.buffer.len() - self.offset).min(buffer.len());
            let remaining_in_buffer_len = to_write; // length of `this.buffer.items[this.offset..][0..to_write]`

            buffer[..to_write].copy_from_slice(&self.buffer[self.offset..][..to_write]);

            if self.offset + to_write == self.buffer.len() {
                self.offset = 0;
                self.buffer.clear();
            } else {
                self.offset += to_write;
            }

            if self.has_received_last_chunk && remaining_in_buffer_len == 0 {
                self.buffer.clear();
                self.buffer.shrink_to_fit();
                self.done = true;

                return streams::Result::IntoArrayAndDone(IntoArray {
                    value: view,
                    len: to_write as blob::SizeType, // @truncate
                });
            }

            return streams::Result::IntoArray(IntoArray {
                value: view,
                len: to_write as blob::SizeType, // @truncate
            });
        }

        if self.has_received_last_chunk {
            return streams::Result::Done;
        }

        // TODO(port): lifetime — storing a raw borrow of a JS-owned buffer; rooted by `set_value`.
        self.pending_buffer = std::ptr::from_mut::<[u8]>(buffer);
        self.set_value(view);

        streams::Result::Pending(&raw mut self.pending)
        // TODO(port): `streams::Result::Pending` carries `*streams.Result.Pending` in Zig (raw
        // backref). Phase B: decide on `NonNull<streams::Pending>` vs index.
    }

    pub fn on_cancel(&mut self) {
        bun_jsc::mark_binding!();
        let view = self.value();
        if self.buffer.capacity() > 0 {
            self.buffer.clear();
            self.buffer.shrink_to_fit();
        }
        self.done = true;
        self.pending_value.deinit();

        if !view.is_empty() {
            self.pending_buffer = Self::empty_pending_buffer();
            self.pending.result.release();
            self.pending.result = streams::Result::Done;
            self.pending.run();
        }

        if let Some(mut action) = self.buffer_action.take() {
            let global = self.parent().global_this;
            // TODO: properly propagate exception upwards
            let _ = action.reject(global, streams::StreamError::AbortReason(jsc::CommonAbortReason::UserAbort));
            self.buffer_action = None;
        }
    }

    pub fn memory_cost(&self) -> usize {
        // ReadableStreamSource covers @sizeOf(ByteStream)
        self.buffer.capacity()
    }

    /// NOTE: not `impl Drop` — `ByteStream` is the `context` payload of a `.classes.ts`
    /// `ReadableStreamSource`; teardown is driven by the GC finalizer via `Source::finalize`,
    /// which calls this. Per §JSC, `.classes.ts` payloads use `finalize`, not `deinit`/`Drop`.
    pub fn finalize(&mut self) {
        bun_jsc::mark_binding!();
        if self.buffer.capacity() > 0 {
            self.buffer.clear();
            self.buffer.shrink_to_fit();
        }

        self.pending_value.deinit();
        if !self.done {
            self.done = true;

            self.pending_buffer = Self::empty_pending_buffer();
            self.pending.result.release();
            self.pending.result = streams::Result::Done;
            if self.pending.state == streams::PendingState::Pending
                && matches!(self.pending.future, streams::PendingFuture::Promise { .. })
            {
                // We must never run JavaScript inside of a GC finalizer.
                self.pending.run_on_next_tick();
            } else {
                self.pending.run();
            }
        }
        if let Some(action) = self.buffer_action.take() {
            // PORT NOTE: Zig `action.deinit()` only deinits the JSPromiseStrong payload of each
            // variant; JSPromiseStrong implements Drop, so dropping the enum is equivalent.
            drop(action);
        }
        // SAFETY: `self` is the `context` field of a heap-allocated `NewSource<ByteStream>`
        // (via `Source::new` → `Box::new`); this is the GC-finalizer teardown path.
        unsafe { self.parent().deinit() };
    }

    pub fn drain(&mut self) -> Vec<u8> {
        if !self.buffer.is_empty() {
            return Vec::<u8>::move_from_list(core::mem::take(&mut self.buffer));
        }
        Vec::<u8>::default()
    }

    pub fn to_any_blob(&mut self) -> Option<blob::Any> {
        if self.has_received_last_chunk {
            let buffer = core::mem::take(&mut self.buffer);
            self.done = true;
            self.pending.result.release();
            self.pending.result = streams::Result::Done;
            self.parent().is_closed = true;
            return Some(blob::Any::InternalBlob(blob::Internal {
                bytes: buffer,
                was_string: false,
            }));
        }

        None
    }

    pub fn to_buffered_value(
        &mut self,
        global_this: &JSGlobalObject,
        action: streams::BufferActionTag,
    ) -> bun_jsc::JsResult<JSValue> {
        if self.buffer_action.is_some() {
            return Err(global_this.throw(format_args!("Cannot buffer value twice")));
        }

        if let streams::Result::Err(err) = &self.pending.result {
            let (err_js, _) = err.to_js_weak(global_this);
            self.pending.result.release();
            self.done = true;
            self.buffer.clear();
            self.buffer.shrink_to_fit();
            return Ok(jsc::JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                global_this,
                err_js,
            ));
        }

        if let Some(blob_) = self.to_any_blob() {
            let mut blob = blob_;
            return Ok(blob.to_promise(global_this, action)?);
        }

        self.buffer_action = Some(match action {
            streams::BufferActionTag::Blob => BufferAction::Blob(JSPromiseStrong::init(global_this)),
            streams::BufferActionTag::Bytes => BufferAction::Bytes(JSPromiseStrong::init(global_this)),
            streams::BufferActionTag::ArrayBuffer => BufferAction::ArrayBuffer(JSPromiseStrong::init(global_this)),
            streams::BufferActionTag::Json => BufferAction::Json(JSPromiseStrong::init(global_this)),
            streams::BufferActionTag::Text => BufferAction::Text(JSPromiseStrong::init(global_this)),
        });

        Ok(self.buffer_action.as_ref().unwrap().value())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webcore/ByteStream.zig (460 lines)
//   confidence: high
//   todos:      4
//   notes:      streams::Result ownership semantics reshaped (allocator.free → Drop); pending_buffer kept as raw *mut [u8] rooted by Strong; Source/NewSource wired via SourceContext trait
// ──────────────────────────────────────────────────────────────────────────
