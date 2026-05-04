use core::mem::offset_of;
use std::sync::Arc;

use bun_collections::BabyList;
use bun_jsc::{JSGlobalObject, JSValue, JsResult};

use crate::webcore::blob::{self, Blob};
use crate::webcore::blob::Store as BlobStore;
use crate::webcore::readable_stream::{self, ReadableStreamSource};
use crate::webcore::streams;

pub struct ByteBlobLoader {
    pub offset: blob::SizeType,
    // LIFETIMES.tsv: SHARED — ref() on setup, deref() in clearData
    pub store: Option<Arc<BlobStore>>,
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

// TODO(port): Zig `NewSource(@This(), "Blob", onStart, onPull, onCancel, deinit, null, drain,
// memoryCost, toBufferedValue)` is a comptime type-returning fn that wires callbacks. In Rust
// this becomes a generic `ReadableStreamSource<Ctx>` where `Ctx` impls a trait providing these
// methods. Phase B: define that trait and `impl ReadableStreamSourceContext for ByteBlobLoader`.
pub type Source = ReadableStreamSource<ByteBlobLoader>;

impl ByteBlobLoader {
    pub fn parent(&mut self) -> &mut Source {
        // SAFETY: self is the `context` field embedded inside a `Source`; callers only invoke
        // this on a `ByteBlobLoader` that was constructed as `Source.context`.
        unsafe {
            &mut *(self as *mut Self as *mut u8)
                .sub(offset_of!(Source, context))
                .cast::<Source>()
        }
    }

    pub fn setup(&mut self, blob: &Blob, user_chunk_size: blob::SizeType) {
        // TODO(port): in-place init — `self` is a pre-allocated slot inside `Source`
        let store = Arc::clone(blob.store.as_ref().unwrap());
        let mut blobe = blob.clone();
        blobe.resolve_size();
        let (content_type, content_type_allocated) = 'brk: {
            if blob.content_type_was_set {
                if blob.content_type_allocated {
                    break 'brk (Box::<[u8]>::from(&*blob.content_type), true);
                }
                // TODO(port): Zig borrowed `blob.content_type` here without copying; we dupe.
                break 'brk (Box::<[u8]>::from(&*blob.content_type), false);
            }
            (Box::default(), false)
        };
        *self = ByteBlobLoader {
            offset: blobe.offset,
            store: Some(store),
            chunk_size: (if user_chunk_size > 0 {
                user_chunk_size.min(blobe.size)
            } else {
                blobe.size
            })
            .min(1024 * 1024 * 2),
            remain: blobe.size,
            done: false,
            pulled: false,
            content_type,
            content_type_allocated,
        };
    }

    pub fn on_start(&mut self) -> streams::Start {
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

        let take = buffer
            .len()
            .min(temporary.len().min(self.remain as usize));
        let temporary = &temporary[..take];
        if temporary.is_empty() {
            self.clear_data();
            self.done = true;
            return streams::Result::Done;
        }

        let copied = blob::SizeType::try_from(temporary.len()).unwrap();

        self.remain = self.remain.saturating_sub(copied);
        self.offset = self.offset.saturating_add(copied);
        debug_assert!(buffer.as_ptr() != temporary.as_ptr());
        buffer[..temporary.len()].copy_from_slice(temporary);
        if self.remain == 0 {
            return streams::Result::IntoArrayAndDone { value: array, len: copied };
        }

        streams::Result::IntoArray { value: array, len: copied }
    }

    pub fn to_any_blob(&mut self, global: &JSGlobalObject) -> Option<blob::Any> {
        // PORT NOTE: reshaped for borrowck — Zig captured `store` then called detachStore();
        // here we take ownership via detach_store() up front.
        let store = self.detach_store()?;
        if self.offset == 0 && self.remain == store.size() && self.content_type.is_empty() {
            if let Some(blob) = store.to_any_blob() {
                drop(store); // defer store.deref()
                return Some(blob);
            }
        }

        let mut blob = Blob::init_with_store(store, global);
        blob.offset = self.offset;
        blob.size = self.remain;

        // Make sure to preserve the content-type.
        // https://github.com/oven-sh/bun/issues/14988
        if !self.content_type.is_empty() {
            blob.content_type = core::mem::take(&mut self.content_type);
            blob.content_type_was_set = !blob.content_type.is_empty();
            blob.content_type_allocated = self.content_type_allocated;
            self.content_type_allocated = false;
        }

        self.parent().is_closed = true;
        Some(blob::Any::Blob(blob))
    }

    pub fn detach_store(&mut self) -> Option<Arc<BlobStore>> {
        if let Some(store) = self.store.take() {
            self.done = true;
            return Some(store);
        }
        None
    }

    pub fn on_cancel(&mut self) {
        self.clear_data();
    }

    // TODO(port): kept as inherent method (not `Drop`) — this is passed as a callback to
    // `NewSource(...)` and calls `self.parent().deinit()` which destroys the enclosing Source
    // allocation. Converting to `Drop` would double-free the parent.
    pub fn deinit(&mut self) {
        self.clear_data();
        self.parent().deinit();
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

    pub fn drain(&mut self) -> BabyList<u8> {
        let Some(store) = self.store.clone() else {
            return BabyList::default();
        };
        let temporary = store.shared_view();
        let temporary = &temporary[self.offset as usize..];
        let take = 16384usize.min(temporary.len().min(self.remain as usize));
        let temporary = &temporary[..take];

        let byte_list = BabyList::<u8>::from_borrowed_slice_dangerous(temporary);
        let cloned = byte_list.clone_owned();
        self.offset = self.offset.saturating_add(blob::SizeType::from(cloned.len));
        self.remain = self.remain.saturating_sub(blob::SizeType::from(cloned.len));

        cloned
    }

    pub fn to_buffered_value(
        &mut self,
        global: &JSGlobalObject,
        action: streams::BufferActionTag,
    ) -> JsResult<JSValue> {
        if let Some(mut blob) = self.to_any_blob(global) {
            return blob.to_promise(global, action);
        }

        // TODO(port): globalThis.ERR(.BODY_ALREADY_USED, "...", .{}).reject()
        global
            .err(bun_jsc::ErrorCode::BODY_ALREADY_USED, "Body already used")
            .reject()
    }

    pub fn memory_cost(&self) -> usize {
        // ReadableStreamSource covers @sizeOf(FileReader)
        if let Some(store) = &self.store {
            return store.memory_cost();
        }
        0
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webcore/ByteBlobLoader.zig (202 lines)
//   confidence: medium
//   todos:      6
//   notes:      Source/NewSource callback wiring needs trait; content_type borrowed-vs-owned collapsed to Box; deinit kept as method (parent owns self)
// ──────────────────────────────────────────────────────────────────────────
