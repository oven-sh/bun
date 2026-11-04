use std::sync::OnceLock;

use bun_collections::HashMap;
use bun_core::strings;
use bun_jsc::bindgen::JsScope;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSGlobalObject, JSValue, UUID};
use bun_threading::Guarded;

use crate::generated_bindgen::blob::BlobOrBuildArtifact;
use crate::webcore::Blob;
use crate::webcore::BlobExt as _;

// The map is wrapped in a `Guarded` (mutex + value).
//
// Key is `[u8; 16]` (the UUID bytes) rather than `UUID` directly because
// upstream `bun_jsc::UUID` does not yet derive `Hash + Eq`; using the raw
// byte array avoids touching the upstream crate.
pub(crate) struct ObjectURLRegistry {
    map: Guarded<HashMap<[u8; 16], Box<Entry>>>,
}

impl Default for ObjectURLRegistry {
    fn default() -> Self {
        Self {
            map: Guarded::init(HashMap::default()),
        }
    }
}

/// Holds no VM-affine state: `blob.global_this` is null and `blob.name` is a
/// shared impl (pre-hashed, never atomized in place), so dupes may clone it
/// into any VM.
pub(crate) struct Entry {
    blob: Blob,
}

const _: fn() = || {
    fn assert_send<T: Send>() {}
    assert_send::<Entry>();
};

impl Entry {
    pub(crate) fn init(blob: &Blob) -> Box<Entry> {
        let blob = blob.dupe_with_content_type(true);
        blob.global_this.set(core::ptr::null());
        blob.name.with_mut(|name| name.make_thread_shareable());
        Box::new(Entry { blob })
    }
}

impl Drop for Entry {
    fn drop(&mut self) {
        self.blob.deinit();
        // The allocation itself is freed by the `Box<Entry>` drop.
    }
}

impl ObjectURLRegistry {
    pub(crate) fn register(&self, vm: &mut VirtualMachine, blob: &Blob) -> UUID {
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
        let entry = map.get(&uuid.bytes)?;
        let blob = entry.blob.dupe_with_content_type(true);
        blob.global_this.set(global_object);
        Some(blob)
    }

    pub(crate) fn resolve_and_dupe_to_js(
        &self,
        pathname: &[u8],
        global_object: &JSGlobalObject,
    ) -> Option<JSValue> {
        let blob = Blob::new(self.resolve_and_dupe(pathname, global_object)?);
        // SAFETY: `Blob::new` returns a freshly-boxed heap pointer.
        Some(unsafe { (*blob).to_js(global_object) })
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
    let uuid = registry.register(VirtualMachine::get().as_mut(), object.blob());
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
