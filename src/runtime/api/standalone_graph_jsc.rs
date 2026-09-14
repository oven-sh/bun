//! JSC bridges for `StandaloneModuleGraph.File`. The graph itself stays in
//! `standalone_graph/` (used by the bundler with no JS in the loop); only the
//! `Blob` accessor that needs a `&JSGlobalObject` lives here.

use core::ptr::NonNull;

use bun_core::{self as bstring, strings};
use bun_http::MimeType;
use bun_jsc::JSGlobalObject;
use bun_ptr::RefPtr;

use crate::webcore::Blob;
use crate::webcore::blob::SizeType;
use crate::webcore::blob::store::{Bytes, Data, IsAllAscii, Store};
use bun_standalone_graph::File;

/// The process-wide template of an embedded file's `Blob`: store, content
/// type and a shared `name`. `global_this` is null; `file_blob` stamps it per VM.
fn template_blob(file: &File) -> NonNull<bun_standalone_graph::StandaloneModuleGraph::Blob> {
    *file.cached_blob.get_or_init(|| {
        // `contents` is a `'static` slice into the embedded executable
        // section — borrow it directly (no copy) and hand it to a `Bytes`
        // store with the default allocator. The leaked extra `ref_()` below
        // pins the refcount ≥ 1 forever, so `Store::deref` never runs and
        // the (otherwise UB) free of a static slice is unreachable.
        let contents = file.utf8_contents();
        // SAFETY: `contents` is `'static` and never freed (see above);
        // the const-cast is sound because Blob consumers only read via
        // `shared_view()`.
        let mut bytes = unsafe {
            Bytes::from_raw_parts(
                contents.as_ptr().cast_mut(),
                contents.len() as SizeType,
                contents.len() as SizeType,
                bun_alloc::basic::C_ALLOCATOR,
            )
        };
        bytes.stored_name = file.name.to_vec().into_boxed_slice();
        let mut store = Store {
            data: Data::Bytes(bytes),
            mime_type: MimeType::NONE,
            ref_count: bun_ptr::ThreadSafeRefCount::init(),
            is_all_ascii: IsAllAscii::default(),
        };
        let blob = Blob::default();
        if let Some(mime) = MimeType::by_extension_no_default(strings::trim_leading_char(
            bun_paths::extension(file.name),
            b'.',
        )) {
            blob.content_type
                .set(crate::webcore::blob::BlobContentType::from_mime(&mime));
            blob.content_type_was_set.set(true);
            store.mime_type = mime;
        }
        let store = RefPtr::new(store);
        // make it never free
        let _ = store.clone().into_raw();
        blob.size.set(store.size());
        blob.store.set(Some(store));
        let name = file.display_name();
        if !name.is_empty() {
            let mut name = bstring::String::clone_utf8(name);
            name.make_thread_shareable();
            blob.name.set(name);
        }
        // `cached_blob` is typed against the lower crate's opaque `Blob`
        // (it cannot name `webcore::Blob` without a dep cycle).
        NonNull::new(Blob::new(blob))
            .expect("Blob::new returned null")
            .cast()
    })
}

/// A fresh dupe of the template, owned by `global`'s VM.
pub(crate) fn file_blob(file: &File, global: &JSGlobalObject) -> Blob {
    // SAFETY: `template_blob` returns the pointer from `Blob::new`, never
    // freed for the process lifetime; only read here.
    let blob = unsafe { template_blob(file).cast::<Blob>().as_ref() }.dupe_with_content_type(true);
    blob.global_this.set(global);
    blob
}
