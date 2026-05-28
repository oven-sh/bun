use std::sync::OnceLock;

use bun_collections::HashMap;
use bun_core::strings;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, StringJsc as _, UUID};
use bun_threading::Guarded;

use crate::webcore::Blob;
use crate::webcore::BlobExt as _;

// PORT NOTE: reshaped for borrowck — Zig had separate `lock: bun.Mutex` and
// `map: AutoHashMap` fields with manual lock()/unlock() around every access.
// In Rust the map is wrapped in a `Guarded` (mutex + value).
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
            blob: dupe_for_cross_thread(blob),
        })
    }
}

/// Build a copy of `blob` that shares no mutable state with it (or with any
/// other thread's blobs): the backing store is replaced with a
/// `Store::deep_dupe` snapshot, a non-heap-owned `content_type` is copied so
/// it cannot outlive the source store, and the `name` string is migrated to a
/// thread-safe (isolated) impl. Used for both directions of the registry
/// boundary — storing a registered blob and resolving one back out — so the
/// registry's own `Entry` blob is only ever touched under the registry mutex
/// and resolved blobs are private to the resolving thread.
fn dupe_for_cross_thread(blob: &Blob) -> Blob {
    let copy = dupe_without_store_snapshot(blob);
    snapshot_store(&copy);
    copy
}

fn dupe_without_store_snapshot(blob: &Blob) -> Blob {
    let copy = blob.dupe_with_content_type(true);
    if !copy.content_type_allocated.get() {
        let content_type = copy.content_type_slice();
        if !content_type.is_empty() {
            let owned = content_type.to_vec().into_boxed_slice();
            copy.content_type
                .set(bun_core::heap::into_raw(owned).cast_const());
            copy.content_type_allocated.set(true);
        }
    }
    let mut name = blob.name.get().dupe_ref();
    name.to_thread_safe();
    copy.name.set(name);
    copy
}

fn snapshot_store(copy: &Blob) {
    if let Some(store) = copy.take_store() {
        copy.store.set(Some(store.deep_dupe()));
    }
}

impl Drop for Entry {
    fn drop(&mut self) {
        // Zig `Entry.deinit`: `this.blob.deinit(); bun.destroy(this);`.
        self.blob.deinit();
        // `bun.destroy(this)` ↔ `Box<Entry>` drop.
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
        let copy = {
            let map = self.map.lock();
            dupe_without_store_snapshot(&map.get(&uuid.bytes)?.blob)
        };
        snapshot_store(&copy);
        Some(copy)
    }

    pub fn resolve_and_dupe_to_js(
        &self,
        pathname: &[u8],
        global_object: &JSGlobalObject,
    ) -> Option<JSValue> {
        let resolved = self.resolve_and_dupe(pathname)?;
        resolved.global_this.set(std::ptr::from_ref(global_object));
        let blob = Blob::new(resolved);
        // SAFETY: `Blob::new` returns a freshly-boxed heap pointer.
        Some(unsafe { (*blob).to_js(global_object) })
    }

    pub fn revoke(&self, pathname: &[u8]) {
        let Some(uuid) = uuid_from_pathname(pathname) else {
            return;
        };
        // Box<Entry> dropped here (was `entry.value.deinit()` in Zig)
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

#[bun_jsc::host_fn(export = "Bun__createObjectURL")]
pub(crate) fn bun_create_object_url(
    global_object: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let arguments = callframe.arguments_old::<1>();
    if arguments.len < 1 {
        return Err(global_object.throw_not_enough_arguments("createObjectURL", 1, arguments.len));
    }
    let Some(blob) = arguments.ptr[0].as_class_ref::<Blob>() else {
        return Err(global_object
            .throw_invalid_arguments(format_args!("createObjectURL expects a Blob object")));
    };
    let registry = ObjectURLRegistry::singleton();
    // SAFETY: `bun_vm_ptr()` returns the live VM pointer for `global_object`.
    let uuid = registry.register(unsafe { &mut *global_object.bun_vm_ptr() }, blob);
    let mut str = bun_core::String::create_format(format_args!("blob:{}", uuid));
    str.transfer_to_js(global_object)
}

#[bun_jsc::host_fn(export = "Bun__revokeObjectURL")]
pub(crate) fn bun_revoke_object_url(
    global_object: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let arguments = callframe.arguments_old::<1>();
    if arguments.len < 1 {
        return Err(global_object.throw_not_enough_arguments("revokeObjectURL", 1, arguments.len));
    }
    if !arguments.ptr[0].is_string() {
        return Err(
            global_object.throw_invalid_arguments(format_args!("revokeObjectURL expects a string"))
        );
    }
    // `to_bun_string` returns a +1 ref; `bun_core::String` is `Copy` (no Drop),
    // so wrap in `OwnedString` for scope-exit `deref()` — Zig's `defer str.deref()`.
    let str = bun_core::OwnedString::new(
        arguments.ptr[0]
            .to_bun_string(global_object)
            .expect("unreachable"),
    );
    if !str.has_prefix_comptime(b"blob:") {
        return Ok(JSValue::UNDEFINED);
    }

    let slice = str.to_utf8_without_ref();
    // `defer slice.deinit()` → ZigStringSlice Drop

    let sliced = slice.slice();
    if sliced.len() < b"blob:".len() + UUID::STRING_LENGTH {
        return Ok(JSValue::UNDEFINED);
    }
    ObjectURLRegistry::singleton().revoke(&sliced[b"blob:".len()..]);
    Ok(JSValue::UNDEFINED)
}

#[bun_jsc::host_fn(export = "jsFunctionResolveObjectURL")]
pub(crate) fn js_function_resolve_object_url(
    global_object: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let arguments = callframe.arguments_old::<1>();

    // Errors are ignored.
    // Not thrown.
    // https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/lib/internal/blob.js#L441
    if arguments.len < 1 {
        return Ok(JSValue::UNDEFINED);
    }
    // `to_bun_string` returns a +1 ref; wrap in `OwnedString` so every exit
    // path (exception, non-blob prefix, success) releases it — Zig's
    // `defer str.deref()`.
    let str = bun_core::OwnedString::new(arguments.ptr[0].to_bun_string(global_object)?);

    if global_object.has_exception() {
        return Ok(JSValue::ZERO);
    }

    if !str.has_prefix_comptime(b"blob:") || str.length() < SPECIFIER_LEN {
        return Ok(JSValue::UNDEFINED);
    }

    let slice = str.to_utf8_without_ref();
    let sliced = slice.slice();

    let registry = ObjectURLRegistry::singleton();
    let blob = registry.resolve_and_dupe_to_js(&sliced[b"blob:".len()..], global_object);
    Ok(blob.unwrap_or(JSValue::UNDEFINED))
}

pub(crate) const SPECIFIER_LEN: usize = b"blob:".len() + UUID::STRING_LENGTH;

pub(crate) fn is_blob_url(url: &[u8]) -> bool {
    url.len() >= SPECIFIER_LEN && strings::has_prefix_comptime(url, b"blob:")
}

// ported from: src/runtime/webcore/ObjectURLRegistry.zig
