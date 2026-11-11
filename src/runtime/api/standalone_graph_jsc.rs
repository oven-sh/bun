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
use crate::webcore::blob::store::{Bytes, Data, IsAllAscii, Store, StoreExt as _};
use crate::webcore::node_types::{PathLike, PathOrFileDescriptor};
use bun_standalone_graph::{
    File, Graph, find_written_file, is_bun_standalone_file_path, normalize_source_path,
};

/// The process-wide template of an embedded file's `Blob`: store, content
/// type and a shared `name`. `global_this` is null; `file_blob` stamps it per VM.
fn template_blob(file: &File) -> NonNull<bun_standalone_graph::StandaloneModuleGraph::Blob> {
    *file.cached_blob.get_or_init(|| {
        let mut store = immortal_store(file, file.name);
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
        let store = keep_forever(store);
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

/// Only for `keep_forever`.
fn immortal_store(file: &File, name: &[u8]) -> Store {
    // `contents` is a `'static` slice into the embedded executable
    // section — borrow it directly (no copy) and hand it to a `Bytes`
    // store with the default allocator. `keep_forever` pins the refcount
    // ≥ 1, so `Store::deref` never runs and the (otherwise UB) free of a
    // static slice is unreachable.
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
    bytes.stored_name = name.into();
    Store {
        data: Data::Bytes(bytes),
        mime_type: MimeType::NONE,
        ref_count: bun_ptr::ThreadSafeRefCount::init(),
        is_all_ascii: IsAllAscii::default(),
    }
}

fn keep_forever(store: Store) -> RefPtr<Store> {
    let store = RefPtr::new(store);
    let _ = store.clone().into_raw();
    store
}

fn is_view_of(store: &Store, file: &File) -> bool {
    let contents = file.utf8_contents();
    let Data::Bytes(bytes) = &store.data else {
        return false;
    };
    core::ptr::eq(bytes.slice(), contents)
}

type Stores = bun_threading::Guarded<Vec<RefPtr<Store>>>;

/// The stores of the files that a program has asked for by their source paths, in the order of these paths.
static STORES_AT_SOURCE_PATHS: Stores = Stores::new(Vec::new());
/// Those of their slices.
static STORES_OF_SLICES: Stores = Stores::new(Vec::new());

/// A path has several if the program has renamed a file inside the executable.
fn stores_at<'a>(
    stores: &'a [RefPtr<Store>],
    path: &'a [u8],
) -> impl Iterator<Item = &'a RefPtr<Store>> {
    let start = stores.partition_point(|it| it.get_path() < Some(path));
    let stores = stores[start..].iter();
    stores.take_while(move |it| it.get_path() == Some(path))
}

fn store_at_source_path(stores: &Stores, file: &File, path: &[u8]) -> RefPtr<Store> {
    let mut stores = stores.lock();
    if let Some(store) = stores_at(&stores, path).find(|it| is_view_of(it, file)) {
        return store.clone();
    }
    let store = keep_forever(immortal_store(file, path));
    let place = stores.partition_point(|it| it.get_path() < Some(path));
    stores.insert(place, store.clone());
    store
}

/// The source path that `blob`, a file of the executable, was asked for by.
pub(crate) fn find_source_path(blob: &Blob) -> Option<&[u8]> {
    let (path, _) = find_followed_path(blob)?;
    (!is_bun_standalone_file_path(path)).then_some(path)
}

/// The same, or the path under the root of the executable of a file that the program may write.
fn find_followed_path(blob: &Blob) -> Option<(&[u8], &'static Stores)> {
    let store = blob.store()?;
    let path = store.get_path()?;
    if !matches!(store.data, Data::Bytes(_)) {
        return None;
    }
    let is_in = |stores: &&'static Stores| {
        let stores = stores.lock();
        stores_at(&stores, path).any(|it| core::ptr::eq(it.as_ptr(), store.as_ptr()))
    };
    let stores = [&STORES_AT_SOURCE_PATHS, &STORES_OF_SLICES];
    stores.into_iter().find(is_in).map(|it| (path, it))
}

/// Whether what `blob` holds is known when it is read: the program may write its file.
pub(crate) fn is_followed(blob: &Blob) -> bool {
    bun_jsc::webcore_types::FOLLOW_SOURCE_PATH.get().is_some() && find_followed_path(blob).is_some()
}

/// Whether `blob` is a whole file of that kind.
pub(crate) fn is_followed_file(blob: &Blob) -> bool {
    let found = find_followed_path(blob);
    found.is_some_and(|(_, stores)| core::ptr::eq(stores, &STORES_AT_SOURCE_PATHS))
}

/// Where the file is that `blob` is a slice of, if that is followed.
pub(crate) fn find_file_of_slice(blob: &Blob) -> Option<RefPtr<Store>> {
    let (path, stores) = find_followed_path(blob)?;
    core::ptr::eq(stores, &STORES_OF_SLICES).then(|| file_store(path))
}

/// The store of a slice of `blob`, if that is followed.
pub(crate) fn find_store_of_slice(blob: &Blob) -> Option<RefPtr<Store>> {
    let (path, _) = find_followed_path(blob)?;
    let file = Graph::get_ref()?.find_data(path)?;
    Some(store_at_source_path(&STORES_OF_SLICES, file, path))
}

/// The store that a clone of a file of the executable was cloned from.
pub(crate) fn find_store_of_clone(path: &[u8], bytes: &[u8]) -> Option<RefPtr<Store>> {
    let stores = STORES_AT_SOURCE_PATHS.lock();
    stores_at(&stores, path)
        .find(|it| it.shared_view() == bytes)
        .cloned()
}

fn file_store(path: &[u8]) -> RefPtr<Store> {
    let path = PathOrFileDescriptor::Path(PathLike::owned(path.to_vec()));
    bun_core::handle_oom(Store::init_file(path, None))
}

/// Whether `blob` is a file of the executable, and `path` leads to it.
pub(crate) fn is_source_path_of(blob: &Blob, path: &[u8]) -> bool {
    let source_path = find_source_path(blob);
    source_path.is_some_and(|it| normalize_source_path(path).is_some_and(|path| *path == *it))
}

/// A blob of the file on the disk.
pub(crate) fn blob_on_disk(path: &[u8], global: &JSGlobalObject) -> Blob {
    Blob::init_with_store(file_store(path), global)
}

fn follow_source_path(blob: &Blob) {
    let (Some(graph), Some((path, stores))) = (Graph::get_ref(), find_followed_path(blob)) else {
        return;
    };
    let Some(store) = blob.store() else {
        return;
    };
    let file = graph.find_data(path);
    if file.is_some_and(|file| is_view_of(store, file)) {
        return;
    }
    let is_whole = core::ptr::eq(stores, &STORES_AT_SOURCE_PATHS);
    let store = match file {
        Some(file) => store_at_source_path(stores, file, path),
        None => file_store(find_written_file(path).as_deref().unwrap_or(path)),
    };
    if is_whole {
        blob.size.set(store.size());
    }
    blob.charset.set(strings::AsciiStatus::Unknown);
    blob.store.set(Some(store));
}

/// As `file_blob`, for a file that was asked for by `path`, which may be a source path.
pub(crate) fn file_blob_at(file: &File, path: &[u8], global: &JSGlobalObject) -> Blob {
    let blob = file_blob(file, global);
    let may_be_written = || {
        let graph = Graph::get_ref().filter(|it| it.compiled_program.is_some());
        graph.is_some_and(|it| it.is_file_for_file_system_alone(file))
    };
    let followed = normalize_source_path(path)
        .filter(|it| !is_bun_standalone_file_path(it) || may_be_written());
    if let Some(followed) = followed {
        bun_jsc::webcore_types::FOLLOW_SOURCE_PATH.get_or_init(|| follow_source_path);
        let store = store_at_source_path(&STORES_AT_SOURCE_PATHS, file, &followed);
        blob.store.set(Some(store));
        if !is_bun_standalone_file_path(&followed) {
            blob.name.set(bstring::String::clone_utf8(path));
        }
    }
    blob
}

/// A fresh dupe of the template, owned by `global`'s VM.
pub(crate) fn file_blob(file: &File, global: &JSGlobalObject) -> Blob {
    // SAFETY: `template_blob` returns the pointer from `Blob::new`, never
    // freed for the process lifetime; only read here.
    let blob = unsafe { template_blob(file).cast::<Blob>().as_ref() }.dupe_with_content_type(true);
    blob.global_this.set(global);
    blob
}
