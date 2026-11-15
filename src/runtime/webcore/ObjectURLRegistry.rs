use core::cell::Cell;
use std::sync::OnceLock;

use bun_collections::HashMap;
use bun_core::strings;
use bun_jsc::bindgen::JsScope;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSGlobalObject, JSValue, JsCell, UUID};
use bun_ptr::{RefCount, RefPtr};
use bun_threading::Guarded;

use crate::generated_bindgen::blob::BlobOrBuildArtifact;
use crate::webcore::Blob;
use crate::webcore::BlobExt as _;
use crate::webcore::blob::{BlobContentType, SizeType, Store};

// The map is wrapped in a `Guarded` (mutex + value).
//
// Key is `[u8; 16]` (the UUID bytes) rather than `UUID` directly because
// upstream `bun_jsc::UUID` does not yet derive `Hash + Eq`; using the raw
// byte array avoids touching the upstream crate.
#[derive(Default)]
pub(crate) struct ObjectURLRegistry {
    map: Guarded<HashMap<[u8; 16], Box<Entry>>>,
}

/// The fields of a [`Blob`] that do not belong to a VM.
pub(crate) struct Entry {
    reported_estimated_size: usize,
    size: SizeType,
    offset: SizeType,
    store: Option<RefPtr<Store>>,
    content_type: BlobContentType,
    content_type_was_set: bool,
    charset: strings::AsciiStatus,
    is_jsdom_file: bool,
    last_modified: f64,
    /// A shared impl (pre-hashed, never atomized in place), so any VM may clone it.
    name: bun_core::String,
}

impl Entry {
    pub(crate) fn init(blob: &Blob) -> Box<Entry> {
        let Blob {
            reported_estimated_size,
            size,
            offset,
            store,
            content_type,
            content_type_was_set,
            charset,
            is_jsdom_file,
            ref_count: _,
            global_this: _,
            last_modified,
            name,
        } = blob;
        let mut name = name.get().clone();
        name.make_thread_shareable();
        Box::new(Entry {
            reported_estimated_size: reported_estimated_size.get(),
            size: size.get(),
            offset: offset.get(),
            store: store.clone(),
            content_type: content_type.get().clone(),
            content_type_was_set: content_type_was_set.get(),
            charset: charset.get(),
            is_jsdom_file: is_jsdom_file.get(),
            last_modified: last_modified.get(),
            name,
        })
    }

    fn to_blob(&self, global_object: &JSGlobalObject) -> Blob {
        Blob {
            reported_estimated_size: Cell::new(self.reported_estimated_size),
            size: Cell::new(self.size),
            offset: Cell::new(self.offset),
            store: self.store.clone(),
            content_type: JsCell::new(self.content_type.clone()),
            content_type_was_set: Cell::new(self.content_type_was_set),
            charset: Cell::new(self.charset),
            is_jsdom_file: Cell::new(self.is_jsdom_file),
            ref_count: RefCount::init(),
            global_this: Cell::new(global_object),
            last_modified: Cell::new(self.last_modified),
            name: JsCell::new(self.name.clone()),
        }
    }
}

impl ObjectURLRegistry {
    pub(crate) fn register(&self, vm: &VirtualMachine, blob: &Blob) -> UUID {
        let uuid = vm.rare_data().next_uuid();
        let entry = Entry::init(blob);

        self.map.lock().insert(uuid.bytes, entry);
        uuid
    }

    pub(crate) fn singleton() -> &'static ObjectURLRegistry {
        static REGISTRY: OnceLock<ObjectURLRegistry> = OnceLock::new();
        REGISTRY.get_or_init(ObjectURLRegistry::default)
    }

    pub(crate) fn resolve_and_dupe(
        &self,
        pathname: &[u8],
        global_object: &JSGlobalObject,
    ) -> Option<Blob> {
        let uuid = uuid_from_pathname(pathname)?;
        let map = self.map.lock();
        Some(map.get(&uuid.bytes)?.to_blob(global_object))
    }

    pub(crate) fn resolve_and_dupe_to_js(
        &self,
        pathname: &[u8],
        global_object: &JSGlobalObject,
    ) -> Option<JSValue> {
        Some(
            self.resolve_and_dupe(pathname, global_object)?
                .into_js(global_object),
        )
    }

    pub(crate) fn revoke(&self, pathname: &[u8]) {
        let Some(uuid) = uuid_from_pathname(pathname) else {
            return;
        };
        // Box<Entry> dropped here
        let _ = self.map.lock().remove(&uuid.bytes);
    }

    pub(crate) fn has(&self, pathname: &[u8]) -> bool {
        let Some(uuid) = uuid_from_pathname(pathname) else {
            return false;
        };
        self.map.lock().contains_key(&uuid.bytes)
    }
}

fn uuid_from_pathname(pathname: &[u8]) -> Option<UUID> {
    UUID::parse(pathname).ok()
}

pub(crate) fn create_object_url(object: BlobOrBuildArtifact<'_>) -> bun_core::String {
    let registry = ObjectURLRegistry::singleton();
    let uuid = registry.register(VirtualMachine::get(), object.blob());
    bun_core::String::create_format(format_args!("blob:{}", uuid))
}

pub(crate) fn revoke_object_url(url: &bun_core::String) {
    if !url.starts_with_ascii(b"blob:") {
        return;
    }

    let slice = url.to_utf8();
    let sliced = slice.slice();
    if sliced.len() < b"blob:".len() + UUID::STRING_LENGTH {
        return;
    }
    ObjectURLRegistry::singleton().revoke(&sliced[b"blob:".len()..]);
}

pub(crate) fn resolve_object_url(cx: &mut JsScope<'_>, url: &bun_core::String) -> Option<JSValue> {
    // Errors are ignored.
    // Not thrown.
    // https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/lib/internal/blob.js#L441
    if !url.starts_with_ascii(b"blob:") || url.length() < SPECIFIER_LEN {
        return None;
    }

    let slice = url.to_utf8();
    let sliced = slice.slice();

    let registry = ObjectURLRegistry::singleton();
    registry.resolve_and_dupe_to_js(&sliced[b"blob:".len()..], cx.global())
}

const SPECIFIER_LEN: usize = b"blob:".len() + UUID::STRING_LENGTH;

pub(crate) fn is_blob_url(url: &[u8]) -> bool {
    url.len() >= SPECIFIER_LEN && strings::has_prefix_comptime(url, b"blob:")
}
