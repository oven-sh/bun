use std::sync::OnceLock;

use bun_collections::HashMap;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, UUID};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_str as strings;
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

// SAFETY: `Entry` is only ever accessed while holding `ObjectURLRegistry.map`'s
// mutex (see `Guarded` below), mirroring the Zig `bun.Mutex` + `*Entry` pattern
// where the registry is a process-wide singleton shared across threads. `Blob`
// contains raw pointers (`*const [u8]`, `*const JSGlobalObject`) which are
// `!Send` by default but are safe to move across threads under the lock — the
// underlying data is heap-owned/refcounted and the Zig original relies on the
// same invariant.
unsafe impl Send for Entry {}

impl Entry {
    pub fn init(blob: &Blob) -> Box<Entry> {
        Box::new(Entry {
            blob: blob.dupe_with_content_type(true),
        })
    }
    // Zig `deinit` only freed `blob` then `bun.destroy(this)` — both handled by
    // Drop of Box<Entry> and Blob's own Drop, so no explicit Drop impl needed.
}

impl ObjectURLRegistry {
    pub fn register(&self, vm: *mut VirtualMachine, blob: &Blob) -> UUID {
        // SAFETY: `vm` comes from `JSGlobalObject::bun_vm()` which returns a
        // live, non-null `*mut VirtualMachine` for the duration of the call
        // (Zig spec passes `*jsc.VirtualMachine`).
        let uuid = unsafe { &mut *vm }.rare_data().next_uuid();
        let entry = Entry::init(blob);

        self.map.lock().insert(uuid.bytes, entry);
        uuid
    }

    pub fn singleton() -> &'static ObjectURLRegistry {
        static REGISTRY: OnceLock<ObjectURLRegistry> = OnceLock::new();
        REGISTRY.get_or_init(ObjectURLRegistry::default)
    }

    fn get_duped_blob(&self, uuid: &UUID) -> Option<Blob> {
        let map = self.map.lock();
        map.get(&uuid.bytes).map(|e| e.blob.dupe_with_content_type(true))
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

// TODO(port): #[bun_jsc::host_fn] must emit the extern shim under the C name
// "Bun__createObjectURL" (Zig: `@export(&jsc.toJSHostFn(..), .{.name = ...})`).
#[bun_jsc::host_fn]
#[unsafe(export_name = "Bun__createObjectURL")]
pub fn bun_create_object_url(
    global_object: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let arguments = callframe.arguments_old::<1>();
    if arguments.len < 1 {
        return Err(global_object.throw_not_enough_arguments("createObjectURL", 1, arguments.len));
    }
    let Some(blob) = arguments.ptr[0].as_::<Blob>() else {
        return Err(global_object
            .throw_invalid_arguments(format_args!("createObjectURL expects a Blob object")));
    };
    let registry = ObjectURLRegistry::singleton();
    // SAFETY: `JSValue::as_::<Blob>()` returns a non-null `*mut Blob` backed by
    // the JS object's wrapped native cell, valid for the duration of this call.
    let uuid = registry.register(global_object.bun_vm(), unsafe { &*blob });
    let mut str = bun_str::String::create_format(format_args!("blob:{}", uuid));
    str.transfer_to_js(global_object)
}

// TODO(port): export shim under C name "Bun__revokeObjectURL".
#[bun_jsc::host_fn]
#[unsafe(export_name = "Bun__revokeObjectURL")]
pub fn bun_revoke_object_url(
    global_object: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let arguments = callframe.arguments_old::<1>();
    if arguments.len < 1 {
        return Err(global_object.throw_not_enough_arguments("revokeObjectURL", 1, arguments.len));
    }
    if !arguments.ptr[0].is_string() {
        return Err(global_object
            .throw_invalid_arguments(format_args!("revokeObjectURL expects a string")));
    }
    let str = arguments.ptr[0]
        .to_bun_string(global_object)
        .expect("unreachable");
    if !str.has_prefix_comptime(b"blob:") {
        return Ok(JSValue::UNDEFINED);
    }

    let slice = str.to_utf8_without_ref();
    // `defer slice.deinit()` / `defer str.deref()` → Drop

    let sliced = slice.slice();
    if sliced.len() < b"blob:".len() + UUID::STRING_LENGTH {
        return Ok(JSValue::UNDEFINED);
    }
    ObjectURLRegistry::singleton().revoke(&sliced[b"blob:".len()..]);
    Ok(JSValue::UNDEFINED)
}

// TODO(port): export shim under C name "jsFunctionResolveObjectURL".
#[bun_jsc::host_fn]
#[unsafe(export_name = "jsFunctionResolveObjectURL")]
pub fn js_function_resolve_object_url(
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
    let str = arguments.ptr[0].to_bun_string(global_object)?;
    // `defer str.deref()` → Drop

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

pub const SPECIFIER_LEN: usize = b"blob:".len() + UUID::STRING_LENGTH;

pub fn is_blob_url(url: &[u8]) -> bool {
    url.len() >= SPECIFIER_LEN && strings::strings::has_prefix_comptime(url, b"blob:")
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webcore/ObjectURLRegistry.zig (176 lines)
//   confidence: high
//   notes:      lock+map merged into Guarded<HashMap>; export names attached via #[unsafe(export_name)]
// ──────────────────────────────────────────────────────────────────────────
