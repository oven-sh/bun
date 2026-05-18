use core::mem::offset_of;

use bun_collections::VecExt;
use bun_jsc::{JSGlobalObject, JSValue, JsResult};

use crate::webcore::blob::store::StoreExt as _;
use crate::webcore::blob::{self, Blob, BlobExt as _, StoreRef};
use crate::webcore::readable_stream;
use crate::webcore::streams;

pub struct ByteBlobLoader {
    pub offset: blob::SizeType,
    // LIFETIMES.tsv: SHARED — ref() on setup, deref() in clearData
    pub store: Option<StoreRef>,
    pub chunk_size: blob::SizeType,
    pub remain: blob::SizeType,
    pub done: bool,
    pub pulled: bool,

    /// https://github.com/oven-sh/bun/issues/14988
    /// Necessary for converting a ByteBlobLoader from a Blob -> back into a Blob
    /// Especially for DOMFormData, where the specific content-type might've been serialized into the data.
    // TODO(port): Zig stored either an owned dupe or a borrowed slice from `blob` gated by
    // `content_type_allocated`. Collapsed to always-owned `Box<[u8]>`; the flag is kept for
    // structural parity (transferred to Blob in to_any_blob).
    pub content_type: Box<[u8]>,
    pub content_type_allocated: bool,
}

impl Default for ByteBlobLoader {
    fn default() -> Self {
        Self {
            offset: 0,
            store: None,
            chunk_size: 1024 * 1024 * 2,
            remain: 1024 * 1024 * 2,
            done: false,
            pulled: false,
            content_type: Box::default(),
            content_type_allocated: false,
        }
    }
}

pub const TAG: readable_stream::Tag = readable_stream::Tag::Blob;

// Zig `NewSource(@This(), "Blob", onStart, onPull, onCancel, deinit, null, drain,
// memoryCost, toBufferedValue)` is a comptime type-returning fn that wires callbacks. In Rust
// this becomes a generic `ReadableStreamSource<Ctx>` where `Ctx` impls `SourceContext`.
pub type Source = readable_stream::NewSource<ByteBlobLoader>;

impl readable_stream::SourceContext for ByteBlobLoader {
    const NAME: &'static str = "Blob";
    // setRefUnrefFn = null
    const SUPPORTS_REF: bool = false;
    crate::source_context_codegen!(js_BlobInternalReadableStreamSource);

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
        Self::deinit(self)
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
    ) -> Option<JsResult<JSValue>> {
        Some(Self::to_buffered_value(self, global, action))
    }
}

bun_core::impl_field_parent! { ByteBlobLoader => Source.context; pub fn parent_const; pub fn parent; }

impl ByteBlobLoader {
    pub fn setup(&mut self, blob: &Blob, user_chunk_size: blob::SizeType) {
        // TODO(port): in-place init — `self` is a pre-allocated slot inside `Source`
        let store = blob.store.get().as_ref().unwrap().clone();
        // PORT NOTE: Zig did `var blobe = blob.*; blobe.resolveSize();` — `Blob` is not
        // `Clone` in Rust, so use the non-mutating `resolved_size()` helper instead.
        let (offset, size) = blob.resolved_size();
        let (content_type, content_type_allocated) = 'brk: {
            if blob.content_type_was_set.get() {
                let ct = blob.content_type_slice();
                if blob.content_type_allocated.get() {
                    break 'brk (Box::<[u8]>::from(ct), true);
                }
                // TODO(port): Zig borrowed `blob.content_type` here without copying; we dupe.
                break 'brk (Box::<[u8]>::from(ct), false);
            }
            (Box::default(), false)
        };
        *self = ByteBlobLoader {
            offset,
            store: Some(store),
            chunk_size: (if user_chunk_size > 0 {
                user_chunk_size.min(size)
            } else {
                size
            })
            .min(1024 * 1024 * 2),
            remain: size,
            done: false,
            pulled: false,
            content_type,
            content_type_allocated,
        };
    }

    pub fn on_start(&mut self) -> streams::Start {
        // `streams::BlobSizeType` and `blob::SizeType` are both u64 in the Rust port.
        streams::Start::ChunkSize(self.chunk_size)
    }

    pub fn on_pull(&mut self, buffer: &mut [u8], array: JSValue) -> streams::Result {
        array.ensure_still_alive();
        let _keep = bun_jsc::EnsureStillAlive(array);
        self.pulled = true;
        let Some(store) = self.store.clone() else {
            return streams::Result::Done;
        };
        if self.done {
            return streams::Result::Done;
        }

        let temporary = store.shared_view();
        let temporary = &temporary[(self.offset as usize).min(temporary.len())..];

        let take = buffer.len().min(temporary.len().min(self.remain as usize));
        let temporary = &temporary[..take];
        if temporary.is_empty() {
            self.clear_data();
            self.done = true;
            return streams::Result::Done;
        }

        let copied = blob::SizeType::try_from(temporary.len()).expect("int cast");

        self.remain = self.remain.saturating_sub(copied);
        self.offset = self.offset.saturating_add(copied);
        debug_assert!(buffer.as_ptr() != temporary.as_ptr());
        buffer[..temporary.len()].copy_from_slice(temporary);
        if self.remain == 0 {
            return streams::Result::IntoArrayAndDone(streams::IntoArray {
                value: array,
                len: copied,
            });
        }

        streams::Result::IntoArray(streams::IntoArray {
            value: array,
            len: copied,
        })
    }

    pub fn to_any_blob(&mut self, global: &JSGlobalObject) -> Option<blob::Any> {
        // PORT NOTE: reshaped for borrowck — Zig captured `store` then called detachStore();
        // here we take ownership via detach_store() up front.
        let store = self.detach_store()?;
        if self.offset == 0 && self.remain == store.size() && self.content_type.is_empty() {
            // SAFETY: `StoreRef` deref is `&Store`; `to_any_blob` needs `&mut` to move bytes out.
            // We hold the only outstanding ref (just detached) so exclusive access is sound.
            if let Some(blob) = unsafe { (*store.as_ptr()).to_any_blob() } {
                drop(store); // defer store.deref()
                return Some(blob);
            }
        }

        let mut blob = Blob::init_with_store(store, global);
        blob.offset.set(self.offset);
        blob.size.set(self.remain);

        // Make sure to preserve the content-type.
        // https://github.com/oven-sh/bun/issues/14988
        if !self.content_type.is_empty() {
            let ct = core::mem::take(&mut self.content_type);
            blob.content_type_was_set.set(!ct.is_empty());
            blob.content_type
                .set(bun_core::heap::into_raw(ct).cast_const());
            blob.content_type_allocated.set(self.content_type_allocated);
            self.content_type_allocated = false;
        }

        self.parent_const().is_closed.set(true);
        Some(blob::Any::Blob(blob))
    }

    pub fn detach_store(&mut self) -> Option<StoreRef> {
        if let Some(store) = self.store.take() {
            self.done = true;
            return Some(store);
        }
        None
    }

    pub fn on_cancel(&mut self) {
        self.clear_data();
    }

    // Kept as inherent method (not `Drop`) — invoked via `SourceContext::deinit_fn`.
    // Only side-effect teardown lives here; the enclosing `Box<Source>` is freed by
    // the caller (`NewSource::decrement_count`) *after* this returns. Freeing the
    // parent here would deallocate the storage backing `&mut self` (dangling UAF).
    pub fn deinit(&mut self) {
        self.clear_data();
    }

    fn clear_data(&mut self) {
        if self.content_type_allocated {
            self.content_type = Box::default();
            self.content_type_allocated = false;
        }

        if let Some(store) = self.store.take() {
            drop(store); // store.deref()
        }
    }

    pub fn drain(&mut self) -> Vec<u8> {
        let Some(store) = self.store.clone() else {
            return Vec::new();
        };
        let temporary = store.shared_view();
        let temporary = &temporary[self.offset as usize..];
        let take = 16384usize.min(temporary.len().min(self.remain as usize));
        let temporary = &temporary[..take];

        // Zig: `Vec<u8>.fromBorrowedSliceDangerous(temporary).clone(allocator)` — collapse to a
        // single owning copy (avoids the `ManuallyDrop` borrow dance).
        let cloned = Vec::<u8>::from_slice(temporary);
        self.offset = self.offset.saturating_add(cloned.len() as blob::SizeType);
        self.remain = self.remain.saturating_sub(cloned.len() as blob::SizeType);

        cloned
    }

    pub fn to_buffered_value(
        &mut self,
        global: &JSGlobalObject,
        action: streams::BufferActionTag,
    ) -> JsResult<JSValue> {
        if let Some(mut blob) = self.to_any_blob(global) {
            return Ok(blob.to_promise(global, action)?);
        }

        // globalThis.ERR(.BODY_ALREADY_USED, "...", .{}).reject()
        Ok(global
            .err(
                bun_jsc::ErrorCode::BODY_ALREADY_USED,
                format_args!("Body already used"),
            )
            .reject())
    }

    pub fn memory_cost(&self) -> usize {
        // ReadableStreamSource covers @sizeOf(FileReader)
        if let Some(store) = &self.store {
            return store.memory_cost();
        }
        0
    }
}

// ported from: src/runtime/webcore/ByteBlobLoader.zig
