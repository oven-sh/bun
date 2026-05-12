//! JSC bridges for `StandaloneModuleGraph.File`. The graph itself stays in
//! `standalone_graph/` (used by the bundler with no JS in the loop); only the
//! `Blob` accessor that needs a `&JSGlobalObject` lives here.

use core::ptr::NonNull;
use core::sync::atomic::AtomicU32;

use bun_core::{self as bstring, PathString, strings};
use bun_http::MimeType;
use bun_jsc::JSGlobalObject;

// PORT NOTE: `StandaloneModuleGraph` is the inner *module* (so
// `StandaloneModuleGraph::BASE_PUBLIC_PATH_WITH_DEFAULT_SUFFIX` resolves);
// `File` is re-exported at the crate root.
use crate::webcore::Blob;
use crate::webcore::blob::SizeType;
use crate::webcore::blob::store::{Bytes, Data, Store, StoreRef};
use bun_standalone_graph::{File, StandaloneModuleGraph};

/// Extension trait wiring JSC-dependent methods onto `standalone_graph::File`.
pub trait FileJsc {
    fn file_blob(&mut self, global: &JSGlobalObject) -> &mut Blob;
}

impl FileJsc for File {
    fn file_blob(&mut self, global: &JSGlobalObject) -> &mut Blob {
        if self.cached_blob.is_none() {
            // Spec: `Store.init(@constCast(this.contents), bun.default_allocator)`.
            // `contents` is a `'static` slice into the embedded executable
            // section — borrow it directly (no copy) and hand it to a `Bytes`
            // store with the default allocator. The leaked extra `ref_()` below
            // pins the refcount ≥ 1 forever, so `Store::deref` never runs and
            // the (otherwise UB) free of a static slice is unreachable.
            let contents = self.contents.as_bytes();
            // SAFETY: `contents` is `'static` and never freed (see above);
            // `@constCast` mirrors Zig — Blob consumers only read via
            // `shared_view()`.
            let bytes = unsafe {
                Bytes::from_raw_parts(
                    contents.as_ptr().cast_mut(),
                    contents.len() as SizeType,
                    contents.len() as SizeType,
                    bun_alloc::basic::C_ALLOCATOR,
                )
            };
            // PORT NOTE: cannot use `..Default::default()` — `Store: Drop`
            // forbids partial moves out of the temporary default.
            let store = StoreRef::from(Store::new(Store {
                data: Data::Bytes(bytes),
                mime_type: MimeType::NONE,
                ref_count: bun_ptr::ThreadSafeRefCount::init(),
                is_all_ascii: None,
            }));
            // make it never free
            store.ref_();

            // Hold the raw pointer so we can keep mutating the store after
            // `init_with_store` consumes the `StoreRef` (Zig freely aliases the
            // `*Store` across both). The store outlives this fn (leaked above).
            let store_ptr = store.as_ptr();

            let mut b = Blob::init_with_store(store, global);

            if let Some(mime) = MimeType::by_extension_no_default(strings::trim_leading_char(
                bun_paths::extension(self.name),
                b'.',
            )) {
                // SAFETY: `store_ptr` is the sole live mutable view; held ref
                // guarantees liveness for the process lifetime.
                let store = unsafe { &mut *store_ptr };
                store.mime_type = mime;
                b.content_type
                    .set(std::ptr::from_ref::<[u8]>(store.mime_type.value.as_ref()));
                b.content_type_was_set.set(true);
                b.content_type_allocated.set(false);
            }

            // The real name goes here:
            // SAFETY: see above; `data` is `Bytes` by construction.
            if let Data::Bytes(bytes) = unsafe { &mut (*store_ptr).data } {
                bytes.stored_name = PathString::init(self.name);
            }

            // The pretty name goes here:
            let prefix = StandaloneModuleGraph::BASE_PUBLIC_PATH_WITH_DEFAULT_SUFFIX.as_bytes();
            if self.name.starts_with(prefix) {
                b.name
                    .set(bstring::String::clone_utf8(&self.name[prefix.len()..]));
            } else if !self.name.is_empty() {
                b.name.set(bstring::String::clone_utf8(self.name));
            }

            // Zig: `Blob{...}.new()` — heap-promote and stash the raw pointer.
            // The standalone graph (and thus this Blob) lives for the process.
            // `cached_blob` is typed against the lower crate's opaque `Blob`
            // newtype (it cannot name `webcore::Blob` without a dep cycle), so
            // erase via `.cast()` here and back below.
            self.cached_blob = Some(
                NonNull::new(Blob::new(b))
                    .expect("Blob::new returned null")
                    .cast(),
            );
        }

        // SAFETY: populated above; pointer originates from `Blob::new` and is
        // never freed for the graph's lifetime (store is intentionally leaked
        // via `.ref_()`). Cast restores the real `webcore::Blob` type.
        unsafe { self.cached_blob.unwrap().cast::<Blob>().as_mut() }
    }
}

// ported from: src/runtime/api/standalone_graph_jsc.zig
