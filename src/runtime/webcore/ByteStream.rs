use core::cell::Cell;
use core::mem::offset_of;

use bun_collections::VecExt;
use bun_core::Output;
use bun_jsc::strong::Optional as StrongOptional;
use bun_jsc::{self as jsc, JSGlobalObject, JSValue, JsCell};

use crate::webcore::Pipe;
use crate::webcore::streams::{self, BufferAction, IntoArray};
use crate::webcore::{blob, readable_stream};

bun_output::declare_scope!(ByteStream, visible);

/// R-2 (`sharedThis`): every JS-reachable inherent method takes `&self` so a
/// re-entrant JS call (e.g. `pending.run()` → JS → `onPull`) cannot stack two
/// `&mut ByteStream`. Fields mutated on those paths are wrapped in `Cell`
/// (Copy scalars / raw ptrs) or [`JsCell`] (non-Copy). `high_water_mark` /
/// `size_hint` are written only at init time (before the JS wrapper exists)
/// and stay bare.
///
/// The `SourceContext` trait still spells its callbacks `&mut self` (shared
/// across `ByteBlobLoader` / `FileReader`); the trait impl below auto-derefs
/// to the `&self` inherent bodies.
pub struct ByteStream {
    pub buffer: JsCell<Vec<u8>>,
    pub has_received_last_chunk: Cell<bool>,
    pub pending: JsCell<streams::Pending>,
    pub done: Cell<bool>,
    /// Borrowed view into a JS `Uint8Array` passed from `on_pull`; kept alive by `pending_value`.
    // TODO(port): lifetime — raw fat slice ptr because the backing store is JS-heap-owned and
    // rooted via `pending_value: Strong`. Never freed by Rust.
    pub pending_buffer: Cell<*mut [u8]>,
    pub pending_value: JsCell<StrongOptional>, // jsc.Strong.Optional
    pub offset: Cell<usize>,
    pub high_water_mark: blob::SizeType,
    pub pipe: JsCell<Pipe>,
    pub size_hint: Cell<blob::SizeType>,
    pub buffer_action: JsCell<Option<BufferAction>>,
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
            pending_buffer: Cell::new(Self::empty_pending_buffer()),
            pending_value: JsCell::new(StrongOptional::empty()),
            offset: Cell::new(0),
            high_water_mark: 0,
            pipe: JsCell::new(Pipe::default()),
            size_hint: Cell::new(0),
            buffer_action: JsCell::new(None),
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
    #[inline]
    const fn empty_pending_buffer() -> *mut [u8] {
        core::ptr::slice_from_raw_parts_mut(core::ptr::NonNull::<u8>::dangling().as_ptr(), 0)
    }

    /// Init-time reset (Zig: write into `undefined`). Runs before the JS
    /// wrapper exists, so `&mut self` is sound here (R-2 exemption).
    pub fn setup(&mut self) {
        // Called immediately after `ByteStream::default()` construction (Zig
        // wrote into `undefined`); the old value owns nothing the new one
        // reuses, so dropping it is the intended reset.
        drop(core::mem::take(self));
    }

    pub fn on_start(&self) -> streams::Start {
        if self.has_received_last_chunk.get() && self.buffer.get().is_empty() {
            return streams::Start::Empty;
        }

        if self.has_received_last_chunk.get() {
            let buffer = self.buffer.replace(Vec::new());
            return streams::Start::OwnedAndDone(Vec::<u8>::move_from_list(buffer));
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

    pub fn value(&self) -> JSValue {
        self.pending_value.with_mut(|pv| {
            let Some(result) = pv.get() else {
                return JSValue::ZERO;
            };
            pv.clear_without_deallocation();
            result
        })
    }

    pub fn is_cancelled(&self) -> bool {
        self.parent_const().cancelled
    }

    pub fn unpipe_without_deref(&self) {
        self.pipe.with_mut(|p| {
            p.ctx = None;
            p.on_pipe = None;
        });
    }

    pub fn on_data(&self, stream: streams::Result) -> Result<(), bun_jsc::JsTerminated> {
        // TODO(port): narrow error set — Zig `bun.JSTerminated!void`
        bun_jsc::mark_binding!();
        if self.done.get() {
            // PORT NOTE: Zig frees `stream.owned.slice()` / `stream.owned_and_done.slice()` here
            // via `allocator.free` when the variant is owned. In Rust the owned `Vec<u8>`/`Vec`
            // payload drops implicitly at the `return` below — no explicit `drop` needed.
            self.has_received_last_chunk.set(stream.is_done());

            bun_output::scoped_log!(ByteStream, "ByteStream.onData already done... do nothing");

            return Ok(());
        }

        debug_assert!(
            !self.has_received_last_chunk.get() || matches!(stream, streams::Result::Err(_))
        );
        self.has_received_last_chunk.set(stream.is_done());

        // R-2: snapshot `pipe` (two `Option<Copy>` fields) — `on_pipe` re-enters
        // its handler, which may call back into `ByteStream` (e.g. `drain`); no
        // `JsCell` borrow may be live across that call.
        let (pipe_ctx, pipe_fn) = {
            let p = self.pipe.get();
            (p.ctx, p.on_pipe)
        };
        if let Some(ctx) = pipe_ctx {
            // TODO(port): `Pipe.onPipe` signature — Zig passes `(ctx, stream, allocator)`.
            (pipe_fn.unwrap())(ctx, stream);
            return Ok(());
        }

        if self.buffer_action.get().is_some() {
            if let streams::Result::Err(err) = &stream {
                // PORT NOTE: Zig `defer { ... }` block — runs after `action.reject`. Reordered
                // here as explicit post-reject cleanup since `?` would skip it.
                bun_output::scoped_log!(ByteStream, "ByteStream.onData err  action.reject()");

                let global = self.parent_const().global_this();
                // R-2: move the action out of the cell *before* calling
                // `reject` (which resolves a JS promise and may re-enter).
                let mut action = self.buffer_action.replace(None).unwrap();
                let res = action.reject(global, err.clone());

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

                        // Zig: `std.array_list.Managed(u8).fromOwnedSlice(bun.default_allocator, @constCast(chunk))`
                        // PORT NOTE: reshaped for borrowck — move the owned Vec<u8> into `buffer`
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
                // Zig `defer { if owned* allocator.free(stream.slice()) }` — owned `Vec<u8>`
                // payload of `stream` is freed by its Drop glue at the explicit `drop` below
                // (Temporary* variants are non-owning `RawSlice` and so are left alone, matching Zig).
                drop(stream);
                let mut blob = self.to_any_blob().unwrap();
                return action.fulfill(self.parent_const().global_this(), &mut blob);
            } else {
                self.buffer
                    .with_mut(|b| b.extend_from_slice(stream.slice()));
                // Zig: `if owned* allocator.free(stream.slice())` — owned `Vec<u8>` payload of
                // `stream` is freed by its Drop glue (Temporary* are non-owning `RawSlice`, left alone).
                drop(stream);
            }

            return Ok(());
        }

        let chunk = stream.slice();

        if self.pending.get().state == streams::PendingState::Pending {
            debug_assert!(self.buffer.get().is_empty());
            // SAFETY: pending_buffer is either dangling+len=0 or points into a live JS
            // Uint8Array rooted by `pending_value`.
            let pending_buf = unsafe { &mut *self.pending_buffer.get() };
            let to_copy_len = chunk.len().min(pending_buf.len());
            let pending_buffer_len = pending_buf.len();
            debug_assert!(pending_buf.as_ptr() != chunk.as_ptr());
            pending_buf[..to_copy_len].copy_from_slice(&chunk[..to_copy_len]);
            self.pending_buffer.set(Self::empty_pending_buffer());

            let is_really_done =
                self.has_received_last_chunk.get() && to_copy_len <= pending_buffer_len;

            if is_really_done {
                self.done.set(true);

                if to_copy_len == 0 {
                    if let streams::Result::Err(err) = &stream {
                        self.pending
                            .with_mut(|p| p.result = streams::Result::Err(err.clone()));
                    } else {
                        self.pending.with_mut(|p| p.result = streams::Result::Done);
                    }
                } else {
                    let v = self.value();
                    self.pending.with_mut(|p| {
                        p.result = streams::Result::IntoArrayAndDone(IntoArray {
                            value: v,
                            len: to_copy_len as blob::SizeType, // @truncate
                        });
                    });
                }
            } else {
                let v = self.value();
                self.pending.with_mut(|p| {
                    p.result = streams::Result::IntoArray(IntoArray {
                        value: v,
                        len: to_copy_len as blob::SizeType, // @truncate
                    });
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

            // R-2: `Pending::run` resolves a JS promise (re-enters JS); the
            // `with_mut` borrow is `UnsafeCell`-backed so `noalias` is
            // suppressed on `&self`, which is the load-bearing fix vs the old
            // `&mut self` form.
            self.pending.with_mut(|p| p.run());

            return Ok(());
        }

        bun_output::scoped_log!(ByteStream, "ByteStream.onData no action just append");

        self.append(stream, 0)
            .unwrap_or_else(|_| panic!("Out of memory while copying request body"));
        Ok(())
    }

    pub fn append(
        &self,
        stream: streams::Result,
        offset: usize,
        // PORT NOTE: Zig `base_address: []const u8` + `allocator` params dropped — `base_address`
        // was only used for `allocator.free(@constCast(base_address))`, which is the Drop of the
        // owned `stream` payload in Rust.
    ) -> Result<(), bun_alloc::AllocError> {
        if self.buffer.get().capacity() == 0 {
            match stream {
                streams::Result::Owned(mut owned) | streams::Result::OwnedAndDone(mut owned) => {
                    // Zig: `owned.moveToListManaged(allocator)` — moves the buffer, no copy.
                    self.buffer.set(owned.move_to_list_managed());
                    self.offset.set(self.offset.get() + offset);
                }
                streams::Result::TemporaryAndDone(temp) | streams::Result::Temporary(temp) => {
                    let chunk = &temp.slice()[offset..];
                    let mut buf = Vec::with_capacity(chunk.len());
                    // PERF(port): was appendSliceAssumeCapacity — profile in Phase B
                    buf.extend_from_slice(chunk);
                    self.buffer.set(buf);
                }
                streams::Result::Err(err) => {
                    self.pending
                        .with_mut(|p| p.result = streams::Result::Err(err));
                }
                streams::Result::Done => {}
                _ => unreachable!(),
            }
            return Ok(());
        }

        match stream {
            streams::Result::TemporaryAndDone(temp) | streams::Result::Temporary(temp) => {
                self.buffer
                    .with_mut(|b| b.extend_from_slice(&temp.slice()[offset..]));
            }
            streams::Result::OwnedAndDone(owned) | streams::Result::Owned(owned) => {
                self.buffer
                    .with_mut(|b| b.extend_from_slice(&owned.slice()[offset..]));
                // Zig: `allocator.free(@constCast(base_address))` — `owned: Vec<u8>` drops here.
            }
            streams::Result::Err(err) => {
                if self.buffer_action.get().is_some() {
                    panic!("Expected buffer action to be null");
                }
                self.pending
                    .with_mut(|p| p.result = streams::Result::Err(err));
            }
            streams::Result::Done => {}
            // We don't support the rest of these yet
            _ => unreachable!(),
        }

        Ok(())
    }

    pub fn set_value(&self, view: JSValue) {
        bun_jsc::mark_binding!();
        let global = self.parent_const().global_this();
        self.pending_value.with_mut(|pv| pv.set(global, view));
    }

    pub fn on_pull(&self, buffer: &mut [u8], view: JSValue) -> streams::Result {
        bun_jsc::mark_binding!();
        debug_assert!(!buffer.is_empty());
        debug_assert!(self.buffer_action.get().is_none());

        if !self.buffer.get().is_empty() {
            debug_assert!(self.value().is_empty()); // == .zero
            // R-2: confine the `&mut Vec<u8>` to a `with_mut` so no `JsCell`
            // borrow escapes the copy. The result tuple drives the rest.
            let (to_write, remaining_in_buffer_len) = self.buffer.with_mut(|b| {
                let to_write = (b.len() - self.offset.get()).min(buffer.len());
                let remaining_in_buffer_len = to_write; // length of `this.buffer.items[this.offset..][0..to_write]`

                buffer[..to_write].copy_from_slice(&b[self.offset.get()..][..to_write]);

                if self.offset.get() + to_write == b.len() {
                    self.offset.set(0);
                    b.clear();
                } else {
                    self.offset.set(self.offset.get() + to_write);
                }
                (to_write, remaining_in_buffer_len)
            });

            if self.has_received_last_chunk.get() && remaining_in_buffer_len == 0 {
                self.buffer.with_mut(|b| {
                    b.clear();
                    b.shrink_to_fit();
                });
                self.done.set(true);

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

        if self.has_received_last_chunk.get() {
            return streams::Result::Done;
        }

        // TODO(port): lifetime — storing a raw borrow of a JS-owned buffer; rooted by `set_value`.
        self.pending_buffer.set(std::ptr::from_mut::<[u8]>(buffer));
        self.set_value(view);

        // R-2: `JsCell::as_ptr` yields the stable `*mut Pending` that the
        // returned `streams::Result::Pending` raw-backref needs.
        streams::Result::Pending(self.pending.as_ptr())
        // TODO(port): `streams::Result::Pending` carries `*streams.Result.Pending` in Zig (raw
        // backref). Phase B: decide on `NonNull<streams::Pending>` vs index.
    }

    pub fn on_cancel(&self) {
        bun_jsc::mark_binding!();
        let view = self.value();
        if self.buffer.get().capacity() > 0 {
            self.buffer.with_mut(|b| {
                b.clear();
                b.shrink_to_fit();
            });
        }
        self.done.set(true);
        self.pending_value.with_mut(|pv| pv.deinit());

        if !view.is_empty() {
            self.pending_buffer.set(Self::empty_pending_buffer());
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
                streams::StreamError::AbortReason(jsc::CommonAbortReason::UserAbort),
            );
            self.buffer_action.set(None);
        }
    }

    pub fn memory_cost(&self) -> usize {
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
    pub fn finalize(&mut self) {
        bun_jsc::mark_binding!();
        if self.buffer.get().capacity() > 0 {
            self.buffer.with_mut(|b| {
                b.clear();
                b.shrink_to_fit();
            });
        }

        self.pending_value.with_mut(|pv| pv.deinit());
        if !self.done.get() {
            self.done.set(true);

            self.pending_buffer.set(Self::empty_pending_buffer());
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
            // PORT NOTE: Zig `action.deinit()` only deinits the JSPromiseStrong payload of each
            // variant; JSPromiseStrong implements Drop, so dropping the enum is equivalent.
            drop(action);
        }
        // Enclosing `Box<NewSource<ByteStream>>` is freed by the caller
        // (`NewSource::decrement_count`) after this returns; freeing it here would
        // deallocate the storage backing `&mut self` (dangling UAF).
    }

    pub fn drain(&self) -> Vec<u8> {
        if !self.buffer.get().is_empty() {
            return Vec::<u8>::move_from_list(self.buffer.replace(Vec::new()));
        }
        Vec::<u8>::default()
    }

    pub fn to_any_blob(&self) -> Option<blob::Any> {
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

    pub fn to_buffered_value(
        &self,
        global_this: &JSGlobalObject,
        action: streams::BufferActionTag,
    ) -> bun_jsc::JsResult<JSValue> {
        if self.buffer_action.get().is_some() {
            return Err(global_this.throw(format_args!("Cannot buffer value twice")));
        }

        if let streams::Result::Err(err) = &self.pending.get().result {
            let (err_js, _) = err.to_js_weak(global_this);
            self.pending.with_mut(|p| p.result.release());
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

        self.buffer_action
            .set(Some(BufferAction::new(action, global_this)));

        Ok(self.buffer_action.get().as_ref().unwrap().value())
    }
}

// ported from: src/runtime/webcore/ByteStream.zig
