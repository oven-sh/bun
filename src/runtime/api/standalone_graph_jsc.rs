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
use bun_standalone_graph::{File, Graph, is_bun_standalone_file_path};

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
        let name = match bun_standalone_graph::Graph::get_ref() {
            Some(graph) => graph.display_name_of(file),
            None => file.display_name().into(),
        };
        if !name.is_empty() {
            let mut name = bstring::String::clone_utf8(&name);
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

fn is_view_of(store: &Store, file: &File) -> bool {
    let contents = file.utf8_contents();
    let Data::Bytes(bytes) = &store.data else {
        return false;
    };
    core::ptr::eq(bytes.slice(), contents)
}

/// Whether `blob` is an entire file that the build was asked to embed below the root of the executable. Such a file never changes.
pub(crate) fn is_asset(blob: &Blob) -> bool {
    let graph = Graph::get_ref().filter(|it| it.compiled_program.is_some());
    let (Some(graph), Some(store)) = (graph, blob.store()) else {
        return false;
    };
    let path = store
        .get_path()
        .filter(|it| is_bun_standalone_file_path(it));
    let is_whole = blob.offset.get() == 0 && blob.size.get() >= store.size();
    let file = path.and_then(|it| graph.find_data(it));
    is_whole
        && file.is_some_and(|it| is_view_of(store, it) && !graph.is_file_for_file_system_alone(it))
}

/// A fresh dupe of the template, owned by `global`'s VM.
pub(crate) fn file_blob(file: &File, global: &JSGlobalObject) -> Blob {
    // SAFETY: `template_blob` returns the pointer from `Blob::new`, never
    // freed for the process lifetime; only read here.
    let blob = unsafe { template_blob(file).cast::<Blob>().as_ref() }.dupe_with_content_type(true);
    blob.global_this.set(global);
    blob
}
