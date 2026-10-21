use bun_collections::VecExt;
use bun_jsc::{JSGlobalObject, JSValue, JsResult};
use bun_ptr::RefPtr;

use crate::webcore::blob::store::StoreExt as _;
use crate::webcore::blob::{self, Blob, BlobExt as _, Store};
use crate::webcore::readable_stream;
use crate::webcore::streams;

pub struct ByteBlobLoader {
    pub offset: blob::SizeType,
    // LIFETIMES.tsv: SHARED — ref() on setup, deref() in clearData
    pub(crate) store: Option<RefPtr<Store>>,
    pub(crate) chunk_size: blob::SizeType,
    pub(crate) remain: blob::SizeType,
    pub(crate) done: bool,

    /// https://github.com/oven-sh/bun/issues/14988
    /// Necessary for converting a ByteBlobLoader from a Blob -> back into a Blob
    /// Especially for DOMFormData, where the specific content-type might've been serialized into the data.
    pub(crate) content_type: blob::BlobContentType,
}

impl Default for ByteBlobLoader {
    fn default() -> Self {
        Self {
            offset: 0,
            store: None,
            chunk_size: 1024 * 1024 * 2,
            remain: 1024 * 1024 * 2,
            done: false,
            content_type: blob::BlobContentType::default(),
        }
    }
}

// A generic `ReadableStreamSource<Ctx>` where `Ctx` impls `SourceContext`.
pub(crate) type Source = readable_stream::NewSource<ByteBlobLoader>;

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
        Self::on_cancel(self);
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
        cx: &bun_jsc::JsThread<'_>,
        action: streams::BufferActionTag,
    ) -> Option<JsResult<JSValue>> {
        Some(Self::to_buffered_value(self, cx, action))
    }
}

bun_core::impl_field_parent! { ByteBlobLoader => Source.context; fn parent; }

impl ByteBlobLoader {
    pub(crate) fn setup(&mut self, blob: &Blob, user_chunk_size: blob::SizeType) {
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
            content_type,
        };
    }

    pub(crate) fn on_start(&mut self) -> streams::Start {
        // `streams::BlobSizeType` and `blob::SizeType` are both u64 in the Rust port.
        streams::Start::ChunkSize(self.chunk_size)
    }

    /// The bytes `drain` and `on_pull` have yet to hand over.
    fn remaining(&self) -> &[u8] {
        let Some(store) = &self.store else {
            return &[];
        };
        let view = store.shared_view();
        let view = &view[(self.offset as usize).min(view.len())..];
        &view[..view.len().min(self.remain as usize)]
    }

    pub(crate) fn on_pull(&mut self, buffer: &mut [u8], array: JSValue) -> streams::Result {
        array.ensure_still_alive();
        let _keep = bun_jsc::EnsureStillAlive(array);
        if self.store.is_none() || self.done {
            return streams::Result::Done;
        }

        let rest = self.remaining();
        let take = buffer.len().min(rest.len());
        if take == 0 {
            self.clear_data();
            self.done = true;
            return streams::Result::Done;
        }
        debug_assert!(buffer.as_ptr() != rest.as_ptr());
        buffer[..take].copy_from_slice(&rest[..take]);

        let copied = blob::SizeType::try_from(take).expect("int cast");
        self.remain = self.remain.saturating_sub(copied);
        self.offset = self.offset.saturating_add(copied);
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

    pub(crate) fn to_any_blob(&mut self, global: &JSGlobalObject) -> Option<blob::Any> {
        // Take ownership via detach_store() up front.
        let store = self.detach_store()?;
        if self.offset == 0 && self.remain == store.size() && self.content_type.is_empty() {
            // SAFETY: `RefPtr<Store>` deref is `&Store`; `to_any_blob` needs `&mut` to move bytes out.
            // We hold the only outstanding ref (just detached) so exclusive access is sound.
            if let Some(blob) = unsafe { (*store.as_ptr()).to_any_blob() } {
                drop(store);
                return Some(blob);
            }
        }

        let blob = Blob::init_with_store(store, global);
        blob.offset.set(self.offset);
        blob.size.set(self.remain);

        // Make sure to preserve the content-type.
        // https://github.com/oven-sh/bun/issues/14988
        if !self.content_type.is_empty() {
            let ct = core::mem::take(&mut self.content_type);
            blob.content_type_was_set.set(!ct.is_empty());
            blob.content_type.set(ct);
        }

        self.parent().is_closed.set(true);
        Some(blob::Any::Blob(blob))
    }

    pub(crate) fn detach_store(&mut self) -> Option<RefPtr<Store>> {
        if let Some(store) = self.store.take() {
            self.done = true;
            return Some(store);
        }
        None
    }

    pub(crate) fn on_cancel(&mut self) {
        self.clear_data();
    }

    // Kept as inherent method (not `Drop`) — invoked via `SourceContext::deinit_fn`.
    // Only side-effect teardown lives here; the enclosing `Box<Source>` is freed by
    // the caller (`NewSource::decrement_count`) *after* this returns. Freeing the
    // parent here would deallocate the storage backing `&mut self` (dangling UAF).
    pub(crate) fn deinit(&mut self) {
        self.clear_data();
    }

    fn clear_data(&mut self) {
        self.content_type = blob::BlobContentType::default();

        if let Some(store) = self.store.take() {
            drop(store); // store.deref()
        }
    }

    pub(crate) fn drain(&mut self) -> Vec<u8> {
        let rest = self.remaining();

        // A single owning copy (avoids a `ManuallyDrop` borrow dance).
        let cloned = Vec::<u8>::from_slice(&rest[..rest.len().min(16384)]);
        self.offset = self.offset.saturating_add(cloned.len() as blob::SizeType);
        self.remain = self.remain.saturating_sub(cloned.len() as blob::SizeType);

        cloned
    }

    pub(crate) fn to_buffered_value(
        &mut self,
        cx: &bun_jsc::JsThread<'_>,
        action: streams::BufferActionTag,
    ) -> JsResult<JSValue> {
        if let Some(mut blob) = self.to_any_blob(cx.global()) {
            let result = blob.to_promise(cx, action);
            blob.detach();
            return result;
        }

        // globalThis.ERR(.BODY_ALREADY_USED, "...", .{}).reject()
        Ok(cx
            .global()
            .err(
                bun_jsc::ErrorCode::BODY_ALREADY_USED,
                format_args!("Body already used"),
            )
            .reject())
    }

    pub(crate) fn memory_cost(&self) -> usize {
        // ReadableStreamSource covers @sizeOf(FileReader)
        if let Some(store) = &self.store {
            return store.memory_cost();
        }
        0
    }
}

/// What the stream has left, for its reader to size the buffer it pulls into.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__ByteBlobLoader__remaining(source: &Source) -> usize {
    source.context.remaining().len()
}
