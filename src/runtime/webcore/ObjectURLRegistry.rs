use std::sync::OnceLock;

use bun_collections::HashMap;
use bun_core::strings;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, StringJsc as _, UUID};
use bun_threading::Guarded;

use crate::webcore::Blob;
use crate::webcore::BlobExt as _;

// The map is wrapped in a `Guarded` (mutex + value).
//
// Key is `[u8; 16]` (the UUID bytes) rather than `UUID` directly because
// upstream `bun_jsc::UUID` does not yet derive `Hash + Eq`; using the raw
// byte array avoids touching the upstream crate.
pub struct ObjectURLRegistry {
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
pub struct Entry {
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
        Some(unsafe { &*blob }.to_js(global_object))
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

#[bun_jsc::host_fn(export = "Bun__createObjectURL")]
fn bun_create_object_url(
    global_object: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let [blob_arg] = callframe.arguments_as_array::<1>();
    if callframe.arguments_count() < 1 {
        return Err(global_object.throw_not_enough_arguments(
            "createObjectURL",
            1,
            callframe.arguments_count() as usize,
        ));
    }
    let Some(blob) = blob_arg.as_class_ref::<Blob>() else {
        return Err(global_object
            .throw_invalid_arguments(format_args!("createObjectURL expects a Blob object")));
    };
    let registry = ObjectURLRegistry::singleton();
    // SAFETY: `bun_vm_ptr()` returns the live VM pointer for `global_object`.
    let uuid = registry.register(unsafe { &mut *global_object.bun_vm_ptr() }, blob);
    bun_core::String::create_format(format_args!("blob:{}", uuid)).into_js(global_object)
}

#[bun_jsc::host_fn(export = "Bun__revokeObjectURL")]
fn bun_revoke_object_url(
    global_object: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let [url_arg] = callframe.arguments_as_array::<1>();
    if callframe.arguments_count() < 1 {
        return Err(global_object.throw_not_enough_arguments(
            "revokeObjectURL",
            1,
            callframe.arguments_count() as usize,
        ));
    }
    if !url_arg.is_string() {
        return Err(
            global_object.throw_invalid_arguments(format_args!("revokeObjectURL expects a string"))
        );
    }
    // `is_string()` is `is_string_like()` and admits `StringObject`, so
    // `to_bun_string` can still observe a user `toString` that throws.
    let str = url_arg.to_bun_string(global_object)?;
    if !str.starts_with_ascii(b"blob:") {
        return Ok(JSValue::UNDEFINED);
    }

    let slice = str.to_utf8();
    let sliced = slice.slice();
    if sliced.len() < b"blob:".len() + UUID::STRING_LENGTH {
        return Ok(JSValue::UNDEFINED);
    }
    ObjectURLRegistry::singleton().revoke(&sliced[b"blob:".len()..]);
    Ok(JSValue::UNDEFINED)
}

#[bun_jsc::host_fn(export = "jsFunctionResolveObjectURL")]
fn js_function_resolve_object_url(
    global_object: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let [url_arg] = callframe.arguments_as_array::<1>();

    // Errors are ignored.
    // Not thrown.
    // https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/lib/internal/blob.js#L441
    if callframe.arguments_count() < 1 {
        return Ok(JSValue::UNDEFINED);
    }
    let str = url_arg.to_bun_string(global_object)?;

    if !str.starts_with_ascii(b"blob:") || str.length() < SPECIFIER_LEN {
        return Ok(JSValue::UNDEFINED);
    }

    let slice = str.to_utf8();
    let sliced = slice.slice();

    let registry = ObjectURLRegistry::singleton();
    let blob = registry.resolve_and_dupe_to_js(&sliced[b"blob:".len()..], global_object);
    Ok(blob.unwrap_or(JSValue::UNDEFINED))
}

const SPECIFIER_LEN: usize = b"blob:".len() + UUID::STRING_LENGTH;

pub(crate) fn is_blob_url(url: &[u8]) -> bool {
    url.len() >= SPECIFIER_LEN && strings::has_prefix_comptime(url, b"blob:")
}
