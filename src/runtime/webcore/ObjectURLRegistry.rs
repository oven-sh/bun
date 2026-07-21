use std::sync::OnceLock;

use bun_collections::HashMap;
use bun_core::strings;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    CallFrame, JSGlobalObject, JSValue, JsError, JsResult, Local, Scope, StringJsc as _, UUID,
};
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

pub struct Entry {
    blob: Blob,
}

// `Entry` is auto-`Send`: its sole field is `Blob`, which already asserts
// `Send + Sync` (see `webcore_types::Blob`). No `unsafe impl` needed.
const _: fn() = || {
    fn assert_send<T: Send>() {}
    assert_send::<Entry>();
};

impl Entry {
    pub fn init(blob: &Blob) -> Box<Entry> {
        Box::new(Entry {
            blob: blob.dupe_with_content_type(true),
        })
    }
}

impl Drop for Entry {
    fn drop(&mut self) {
        self.blob.deinit();
        // The allocation itself is freed by the `Box<Entry>` drop.
    }
}

impl ObjectURLRegistry {
    pub fn register(&self, vm: &mut VirtualMachine, blob: &Blob) -> UUID {
        let uuid = vm.rare_data().next_uuid();
        let entry = Entry::init(blob);

        self.map.lock().insert(uuid.bytes, entry);
        uuid
    }

    pub fn singleton() -> &'static ObjectURLRegistry {
        static REGISTRY: OnceLock<ObjectURLRegistry> = OnceLock::new();
        REGISTRY.get_or_init(ObjectURLRegistry::default)
    }

    pub fn resolve_and_dupe(&self, pathname: &[u8]) -> Option<Blob> {
        let uuid = uuid_from_pathname(pathname)?;
        let map = self.map.lock();
        map.get(&uuid.bytes)
            .map(|e| e.blob.dupe_with_content_type(true))
    }

    pub fn resolve_and_dupe_to_js(
        &self,
        pathname: &[u8],
        global_object: &JSGlobalObject,
    ) -> Option<JSValue> {
        let blob = Blob::new(self.resolve_and_dupe(pathname)?);
        // SAFETY: `Blob::new` returns a freshly-boxed heap pointer.
        Some(unsafe { (*blob).to_js(global_object) })
    }

    pub fn revoke(&self, pathname: &[u8]) {
        let Some(uuid) = uuid_from_pathname(pathname) else {
            return;
        };
        // Box<Entry> dropped here
        let _ = self.map.lock().remove(&uuid.bytes);
    }

    pub fn has(&self, pathname: &[u8]) -> bool {
        let Some(uuid) = uuid_from_pathname(pathname) else {
            return false;
        };
        self.map.lock().contains_key(&uuid.bytes)
    }
}

fn uuid_from_pathname(pathname: &[u8]) -> Option<UUID> {
    UUID::parse(pathname).ok()
}

#[bun_jsc::host_fn(export = "Bun__createObjectURL", scoped)]
pub(crate) fn bun_create_object_url<'s>(
    scope: &mut Scope<'s>,
    callframe: &CallFrame,
) -> JsResult<Local<'s>> {
    let global_object = scope.unscoped_global();
    let arguments = callframe.scoped_arguments::<1>(scope);
    if arguments.len < 1 {
        return Err(scope.throw_not_enough_arguments("createObjectURL", 1, arguments.len));
    }
    let Some(blob) = arguments.ptr[0].as_class_ref::<Blob>() else {
        return Err(
            scope.throw_invalid_arguments(format_args!("createObjectURL expects a Blob object"))
        );
    };
    let registry = ObjectURLRegistry::singleton();
    // SAFETY: `bun_vm_ptr()` returns the live VM pointer for `global_object`.
    let uuid = registry.register(unsafe { &mut *global_object.bun_vm_ptr() }, blob);
    let mut str = bun_core::String::create_format(format_args!("blob:{}", uuid));
    let v = str.transfer_to_js(global_object)?;
    Ok(scope.local(v))
}

#[bun_jsc::host_fn(export = "Bun__revokeObjectURL", scoped)]
pub(crate) fn bun_revoke_object_url<'s>(
    scope: &mut Scope<'s>,
    callframe: &CallFrame,
) -> JsResult<Local<'s>> {
    let arguments = callframe.scoped_arguments::<1>(scope);
    if arguments.len < 1 {
        return Err(scope.throw_not_enough_arguments("revokeObjectURL", 1, arguments.len));
    }
    if !arguments.ptr[0].is_string() {
        return Err(scope.throw_invalid_arguments(format_args!("revokeObjectURL expects a string")));
    }
    // `to_bun_string` returns a +1 ref; `bun_core::String` is `Copy` (no Drop),
    // so wrap in `OwnedString` for scope-exit `deref()`.
    let str =
        bun_core::OwnedString::new(arguments.ptr[0].to_bun_string(scope).expect("unreachable"));
    if !str.has_prefix_comptime(b"blob:") {
        return Ok(scope.undefined());
    }

    let slice = str.to_utf8_without_ref();
    // released by ZigStringSlice Drop

    let sliced = slice.slice();
    if sliced.len() < b"blob:".len() + UUID::STRING_LENGTH {
        return Ok(scope.undefined());
    }
    ObjectURLRegistry::singleton().revoke(&sliced[b"blob:".len()..]);
    Ok(scope.undefined())
}

#[bun_jsc::host_fn(export = "jsFunctionResolveObjectURL", scoped)]
pub(crate) fn js_function_resolve_object_url<'s>(
    scope: &mut Scope<'s>,
    callframe: &CallFrame,
) -> JsResult<Local<'s>> {
    let arguments = callframe.scoped_arguments::<1>(scope);

    // Errors are ignored.
    // Not thrown.
    // https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/lib/internal/blob.js#L441
    if arguments.len < 1 {
        return Ok(scope.undefined());
    }
    // `to_bun_string` returns a +1 ref; wrap in `OwnedString` so every exit
    // path (exception, non-blob prefix, success) releases it.
    let str = bun_core::OwnedString::new(arguments.ptr[0].to_bun_string(scope)?);

    if scope.has_exception() {
        // Was `Ok(JSValue::ZERO)` with the exception pending — same ABI result.
        return Err(JsError::Thrown);
    }

    if !str.has_prefix_comptime(b"blob:") || str.length() < SPECIFIER_LEN {
        return Ok(scope.undefined());
    }

    let slice = str.to_utf8_without_ref();
    let sliced = slice.slice();

    let registry = ObjectURLRegistry::singleton();
    let blob = registry.resolve_and_dupe_to_js(&sliced[b"blob:".len()..], scope.unscoped_global());
    Ok(match blob {
        Some(v) => scope.local(v),
        None => scope.undefined(),
    })
}

pub(crate) const SPECIFIER_LEN: usize = b"blob:".len() + UUID::STRING_LENGTH;

pub(crate) fn is_blob_url(url: &[u8]) -> bool {
    url.len() >= SPECIFIER_LEN && strings::has_prefix_comptime(url, b"blob:")
}
