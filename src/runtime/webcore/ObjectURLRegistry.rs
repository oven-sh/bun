use std::sync::OnceLock;

use bun_collections::HashMap;
use bun_core::UUID; // TODO(port): verify crate for bun.UUID
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, VirtualMachine};
use bun_str as strings;
use bun_threading::Mutex;

use crate::webcore::Blob;

// PORT NOTE: reshaped for borrowck — Zig had separate `lock: bun.Mutex` and
// `map: AutoHashMap` fields with manual lock()/unlock() around every access.
// In Rust the map is wrapped directly in the Mutex.
pub struct ObjectURLRegistry {
    map: Mutex<HashMap<UUID, Box<Entry>>>,
}

impl Default for ObjectURLRegistry {
    fn default() -> Self {
        Self {
            map: Mutex::new(HashMap::default()),
        }
    }
}

pub struct Entry {
    blob: Blob,
}

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
    pub fn register(&self, vm: &VirtualMachine, blob: &Blob) -> UUID {
        let uuid = vm.rare_data().next_uuid();
        let entry = Entry::init(blob);

        let mut map = self.map.lock();
        map.insert(uuid, entry);
        uuid
    }

    pub fn singleton() -> &'static ObjectURLRegistry {
        static REGISTRY: OnceLock<ObjectURLRegistry> = OnceLock::new();
        REGISTRY.get_or_init(ObjectURLRegistry::default)
    }

    fn get_duped_blob(&self, uuid: &UUID) -> Option<Blob> {
        let map = self.map.lock();
        let entry = map.get(uuid)?;
        Some(entry.blob.dupe_with_content_type(true))
    }

    pub fn resolve_and_dupe(&self, pathname: &[u8]) -> Option<Blob> {
        let uuid = uuid_from_pathname(pathname)?;
        let map = self.map.lock();
        let entry = map.get(&uuid)?;
        Some(entry.blob.dupe_with_content_type(true))
    }

    pub fn resolve_and_dupe_to_js(
        &self,
        pathname: &[u8],
        global_object: &JSGlobalObject,
    ) -> Option<JSValue> {
        let blob = Blob::new(self.resolve_and_dupe(pathname)?);
        Some(blob.to_js(global_object))
    }

    pub fn revoke(&self, pathname: &[u8]) {
        let Some(uuid) = uuid_from_pathname(pathname) else {
            return;
        };
        let mut map = self.map.lock();
        let _ = map.remove(&uuid);
        // Box<Entry> dropped here (was `entry.value.deinit()` in Zig)
    }

    pub fn has(&self, pathname: &[u8]) -> bool {
        let Some(uuid) = uuid_from_pathname(pathname) else {
            return false;
        };
        let map = self.map.lock();
        map.contains_key(&uuid)
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
        return global_object.throw_not_enough_arguments("createObjectURL", 1, arguments.len);
    }
    let Some(blob) = arguments.ptr[0].as_::<Blob>() else {
        return global_object
            .throw_invalid_arguments(format_args!("createObjectURL expects a Blob object"));
    };
    let registry = ObjectURLRegistry::singleton();
    let uuid = registry.register(global_object.bun_vm(), blob);
    let str = bun_str::String::create_format(format_args!("blob:{}", uuid));
    Ok(str.transfer_to_js(global_object))
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
        return global_object.throw_not_enough_arguments("revokeObjectURL", 1, arguments.len);
    }
    if !arguments.ptr[0].is_string() {
        return global_object
            .throw_invalid_arguments(format_args!("revokeObjectURL expects a string"));
    }
    let str = arguments.ptr[0]
        .to_bun_string(global_object)
        .expect("unreachable");
    if !str.has_prefix(b"blob:") {
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

    if !str.has_prefix(b"blob:") || str.length() < SPECIFIER_LEN {
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
    url.len() >= SPECIFIER_LEN && strings::strings::has_prefix(url, b"blob:")
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webcore/ObjectURLRegistry.zig (176 lines)
//   confidence: medium
//   todos:      4
//   notes:      lock+map merged into Mutex<HashMap>; host_fn export names need macro support; verify bun_core::UUID crate path
// ──────────────────────────────────────────────────────────────────────────
