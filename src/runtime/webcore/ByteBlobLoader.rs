use core::cell::Cell;

use bun_collections::VecExt;
use bun_jsc::{JSGlobalObject, JSValue, JsCell, JsResult};
use bun_ptr::RefPtr;

use crate::webcore::blob::store::StoreExt as _;
use crate::webcore::blob::{self, Blob, BlobExt as _, Store};
use crate::webcore::readable_stream;
use crate::webcore::streams;

pub struct ByteBlobLoader {
    pub offset: Cell<blob::SizeType>,
    // LIFETIMES.tsv: SHARED — ref() on setup, deref() in clearData
    pub(crate) store: JsCell<Option<RefPtr<Store>>>,
    pub(crate) chunk_size: blob::SizeType,
    pub(crate) remain: Cell<blob::SizeType>,
    pub(crate) done: Cell<bool>,

    /// https://github.com/oven-sh/bun/issues/14988
    /// Necessary for converting a ByteBlobLoader from a Blob -> back into a Blob
    /// Especially for DOMFormData, where the specific content-type might've been serialized into the data.
    pub(crate) content_type: JsCell<blob::BlobContentType>,
}

impl Default for ByteBlobLoader {
    fn default() -> Self {
        Self {
            offset: Cell::new(0),
            store: JsCell::new(None),
            chunk_size: 1024 * 1024 * 2,
            remain: Cell::new(1024 * 1024 * 2),
            done: Cell::new(false),
            content_type: JsCell::new(blob::BlobContentType::default()),
        }
    }
}

// A generic `ReadableStreamSource<Ctx>` where `Ctx` impls `SourceContext`.
pub(crate) type Source = readable_stream::NewSource<ByteBlobLoader>;

impl readable_stream::SourceContext for ByteBlobLoader {
    crate::source_context_codegen!(js_BlobInternalReadableStreamSource);

    fn on_start(&self) -> streams::Start {
        // `streams::BlobSizeType` and `blob::SizeType` are both u64 in the Rust port.
        streams::Start::ChunkSize(self.chunk_size)
    }

    fn on_pull(&self, buffer: &mut [u8], array: JSValue) -> streams::Result {
        array.ensure_still_alive();
        let _keep = bun_jsc::EnsureStillAlive(array);
        if self.store.get().is_none() || self.done.get() {
            return streams::Result::Done;
        }

        let rest = self.remaining();
        let take = buffer.len().min(rest.len());
        if take == 0 {
            self.clear_data();
            self.done.set(true);
            return streams::Result::Done;
        }
        debug_assert!(buffer.as_ptr() != rest.as_ptr());
        buffer[..take].copy_from_slice(&rest[..take]);

        let copied = blob::SizeType::try_from(take).expect("int cast");
        self.remain.set(self.remain.get().saturating_sub(copied));
        self.offset.set(self.offset.get().saturating_add(copied));
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

    fn on_cancel(&self) {
        self.clear_data();
    }

    fn deinit_fn(&self) {
        self.clear_data();
    }

    fn drain_internal_buffer(&self) -> Vec<u8> {
        let rest = self.remaining();

        // A single owning copy (avoids a `ManuallyDrop` borrow dance).
        let cloned = Vec::<u8>::from_slice(&rest[..rest.len().min(16384)]);
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

    fn memory_cost_fn(&self) -> usize {
        // ReadableStreamSource covers @sizeOf(FileReader)
        if let Some(store) = self.store.get() {
            return store.memory_cost();
        }
        0
    }

    fn to_buffered_value(
        &self,
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
}

bun_core::impl_field_parent! { ByteBlobLoader => Source.context; fn shared parent; }

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
            offset: Cell::new(offset),
            store: JsCell::new(Some(store)),
            chunk_size: (if user_chunk_size > 0 {
                user_chunk_size.min(size)
            } else {
                size
            })
            .min(1024 * 1024 * 2),
            remain: Cell::new(size),
            done: Cell::new(false),
            content_type: JsCell::new(content_type),
        };
    }

    /// The bytes `drain_internal_buffer` and `on_pull` have yet to hand over.
    fn remaining(&self) -> &[u8] {
        let Some(store) = self.store.get() else {
            return &[];
        };
        let view = store.shared_view();
        let view = &view[(self.offset.get() as usize).min(view.len())..];
        &view[..view.len().min(self.remain.get() as usize)]
    }

    pub(crate) fn to_any_blob(&self, global: &JSGlobalObject) -> Option<blob::Any> {
        // Take ownership via detach_store() up front.
        let store = self.detach_store()?;
        if self.offset.get() == 0
            && self.remain.get() == store.size()
            && self.content_type.get().is_empty()
        {
            // SAFETY: `RefPtr<Store>` deref is `&Store`; `to_any_blob` needs `&mut` to move bytes out.
            // We hold the only outstanding ref (just detached) so exclusive access is sound.
            if let Some(blob) = unsafe { (*store.as_ptr()).to_any_blob() } {
                drop(store);
                return Some(blob);
            }
        }

        let blob = Blob::init_with_store(store, global);
        blob.offset.set(self.offset.get());
        blob.size.set(self.remain.get());

        // Make sure to preserve the content-type.
        // https://github.com/oven-sh/bun/issues/14988
        if !self.content_type.get().is_empty() {
            let ct = self.content_type.take();
            blob.content_type_was_set.set(!ct.is_empty());
            blob.content_type.set(ct);
        }

        self.parent().is_closed.set(true);
        Some(blob::Any::Blob(blob))
    }

    pub(crate) fn detach_store(&self) -> Option<RefPtr<Store>> {
        if let Some(store) = self.store.take() {
            self.done.set(true);
            return Some(store);
        }
        None
    }

    fn clear_data(&self) {
        self.content_type.set(blob::BlobContentType::default());

        if let Some(store) = self.store.take() {
            drop(store); // store.deref()
        }
    }
}

/// What the stream has left, for its reader to size the buffer it pulls into.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__ByteBlobLoader__remaining(source: &Source) -> usize {
    source.context.remaining().len()
}
