use core::cell::Cell;

use bun_collections::VecExt;
use bun_jsc::{JSGlobalObject, JSValue, JsCell, JsResult};

use crate::webcore::blob::store::StoreExt as _;
use crate::webcore::blob::{self, Blob, BlobExt as _, StoreRef};
use crate::webcore::readable_stream;
use crate::webcore::streams;

/// R-2: reached through a shared `BackRef` from `readable_stream::Source::blob()`,
/// so every field mutated on a JS-reachable path is `Cell` (Copy scalars) or
/// [`JsCell`] (non-Copy) instead of requiring `&mut self`.
pub struct ByteBlobLoader {
    pub offset: Cell<blob::SizeType>,
    // LIFETIMES.tsv: SHARED — ref() on setup, deref() in clearData
    pub store: JsCell<Option<StoreRef>>,
    pub chunk_size: Cell<blob::SizeType>,
    pub remain: Cell<blob::SizeType>,
    pub done: Cell<bool>,
    pub pulled: Cell<bool>,

    /// https://github.com/oven-sh/bun/issues/14988
    /// Necessary for converting a ByteBlobLoader from a Blob -> back into a Blob
    /// Especially for DOMFormData, where the specific content-type might've been serialized into the data.
    pub content_type: JsCell<blob::BlobContentType>,
}

impl Default for ByteBlobLoader {
    fn default() -> Self {
        Self {
            offset: Cell::new(0),
            store: JsCell::new(None),
            chunk_size: Cell::new(1024 * 1024 * 2),
            remain: Cell::new(1024 * 1024 * 2),
            done: Cell::new(false),
            pulled: Cell::new(false),
            content_type: JsCell::new(blob::BlobContentType::default()),
        }
    }
}

// A generic `ReadableStreamSource<Ctx>` where `Ctx` impls `SourceContext`.
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
        // In-place init — `self` is a pre-allocated slot inside `Source`.
        let store = blob.store.get().as_ref().unwrap().clone();
        // `Blob` is not `Clone`, so use the non-mutating `resolved_size()` helper.
        let (offset, size) = blob.resolved_size();
        let content_type = if blob.content_type_was_set.get() {
            blob.content_type.get().clone()
        } else {
            blob::BlobContentType::default()
        };
        *self = ByteBlobLoader {
            offset: Cell::new(offset),
            store: JsCell::new(Some(store)),
            chunk_size: Cell::new(
                (if user_chunk_size > 0 {
                    user_chunk_size.min(size)
                } else {
                    size
                })
                .min(1024 * 1024 * 2),
            ),
            remain: Cell::new(size),
            done: Cell::new(false),
            pulled: Cell::new(false),
            content_type: JsCell::new(content_type),
        };
    }

    pub fn on_start(&mut self) -> streams::Start {
        // `streams::BlobSizeType` and `blob::SizeType` are both u64 in the Rust port.
        streams::Start::ChunkSize(self.chunk_size.get())
    }

    pub fn on_pull(&mut self, buffer: &mut [u8], array: JSValue) -> streams::Result {
        array.ensure_still_alive();
        let _keep = bun_jsc::EnsureStillAlive(array);
        self.pulled.set(true);
        let Some(store) = self.store.get().clone() else {
            return streams::Result::Done;
        };
        if self.done.get() {
            return streams::Result::Done;
        }

        let temporary = store.shared_view();
        let temporary = &temporary[(self.offset.get() as usize).min(temporary.len())..];

        let take = buffer
            .len()
            .min(temporary.len().min(self.remain.get() as usize));
        let temporary = &temporary[..take];
        if temporary.is_empty() {
            self.clear_data();
            self.done.set(true);
            return streams::Result::Done;
        }

        let copied = blob::SizeType::try_from(temporary.len()).expect("int cast");

        self.remain.set(self.remain.get().saturating_sub(copied));
        self.offset.set(self.offset.get().saturating_add(copied));
        debug_assert!(buffer.as_ptr() != temporary.as_ptr());
        buffer[..temporary.len()].copy_from_slice(temporary);
        if self.remain.get() == 0 {
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

    pub fn to_any_blob(&self, global: &JSGlobalObject) -> Option<blob::Any> {
        // Take ownership via detach_store() up front.
        let store = self.detach_store()?;
        if self.offset.get() == 0
            && self.remain.get() == store.size()
            && self.content_type.get().is_empty()
        {
            // SAFETY: `StoreRef` deref is `&Store`; `to_any_blob` needs `&mut` to move bytes out.
            // We hold the only outstanding ref (just detached) so exclusive access is sound.
            if let Some(blob) = unsafe { (*store.as_ptr()).to_any_blob() } {
                drop(store); // defer store.deref()
                return Some(blob);
            }
        }

        let blob = Blob::init_with_store(store, global);
        blob.offset.set(self.offset.get());
        blob.size.set(self.remain.get());

        // Make sure to preserve the content-type.
        // https://github.com/oven-sh/bun/issues/14988
        if !self.content_type.get().is_empty() {
            let ct = self.content_type.replace(blob::BlobContentType::default());
            blob.content_type_was_set.set(!ct.is_empty());
            blob.content_type.set(ct);
        }

        self.parent_const().is_closed.set(true);
        Some(blob::Any::Blob(blob))
    }

    pub fn detach_store(&self) -> Option<StoreRef> {
        if let Some(store) = self.store.replace(None) {
            self.done.set(true);
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

    fn clear_data(&self) {
        self.content_type.set(blob::BlobContentType::default());

        if let Some(store) = self.store.replace(None) {
            drop(store); // store.deref()
        }
    }

    pub fn drain(&mut self) -> Vec<u8> {
        let Some(store) = self.store.get().clone() else {
            return Vec::new();
        };
        let temporary = store.shared_view();
        let temporary = &temporary[self.offset.get() as usize..];
        let take = 16384usize.min(temporary.len().min(self.remain.get() as usize));
        let temporary = &temporary[..take];

        // A single owning copy (avoids a `ManuallyDrop` borrow dance).
        let cloned = Vec::<u8>::from_slice(temporary);
        self.offset.set(
            self.offset
                .get()
                .saturating_add(cloned.len() as blob::SizeType),
        );
        self.remain.set(
            self.remain
                .get()
                .saturating_sub(cloned.len() as blob::SizeType),
        );

        cloned
    }

    pub fn to_buffered_value(
        &mut self,
        global: &JSGlobalObject,
        action: streams::BufferActionTag,
    ) -> JsResult<JSValue> {
        if let Some(mut blob) = self.to_any_blob(global) {
            let result = blob.to_promise(global, action);
            blob.detach();
            return Ok(result?);
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
        if let Some(store) = self.store.get() {
            return store.memory_cost();
        }
        0
    }
}
