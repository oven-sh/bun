//! JSC bridges for `StandaloneModuleGraph.File`. The graph itself stays in
//! `standalone_graph/` (used by the bundler with no JS in the loop); only the
//! `Blob` accessor that needs a `&JSGlobalObject` lives here.

use std::sync::OnceLock;

use bun_core::{self as bstring, strings};
use bun_http::MimeType;
use bun_jsc::JSGlobalObject;
use bun_ptr::RefPtr;

use crate::webcore::Blob;
use crate::webcore::blob::BlobContentType;
use crate::webcore::blob::store::{Bytes, Data, Store};
use bun_standalone_graph::{File, Graph, is_bun_standalone_file_path};

/// What the `Blob`s of an embedded file share across VMs.
struct BlobTemplate {
    store: RefPtr<Store>,
    name: bstring::String,
}

fn blob_template(file: &'static File) -> &'static BlobTemplate {
    /// By index in `Graph::files`.
    static TEMPLATES: OnceLock<Box<[OnceLock<BlobTemplate>]>> = OnceLock::new();
    let graph = Graph::get_ref().expect("an embedded file has a graph");
    let files = graph.files.values();
    let templates = TEMPLATES.get_or_init(|| files.iter().map(|_| OnceLock::new()).collect());
    let index = files.element_offset(file).expect("a file of the graph");
    templates[index].get_or_init(|| {
        let mut bytes = Bytes::init_static(file.utf8_contents());
        bytes.stored_name = file.name.to_vec().into_boxed_slice();
        let extension = strings::trim_leading_char(bun_paths::extension(file.name), b'.');
        let mime = MimeType::by_extension_no_default(extension).unwrap_or(MimeType::NONE);
        let store = RefPtr::new(Store::new(Data::Bytes(bytes), mime));
        let display_name = graph.display_name_of(file);
        let mut name = bstring::String::DEAD;
        if !display_name.is_empty() {
            name = bstring::String::clone_utf8(&display_name);
            name.make_thread_shareable();
        }
        BlobTemplate { store, name }
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

/// A new `Blob` of `file`, owned by `global`'s VM.
pub(crate) fn file_blob(file: &'static File, global: &JSGlobalObject) -> Blob {
    let template = blob_template(file);
    let content_type = BlobContentType::from_mime(&template.store.mime_type);
    let blob = Blob::init_with_store(template.store.clone(), global);
    blob.content_type_was_set.set(!content_type.is_empty());
    blob.content_type.set(content_type);
    blob.name.set(template.name.clone());
    blob
}
