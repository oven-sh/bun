use bun_bundler::options::Loader;
use crate::{
    self as jsc, ErrorableString, JSArray, JSGlobalObject, JSValue, JsError, JsResult, Strong,
    StringJsc, VirtualMachineRef as VirtualMachine,
};
use bun_string::{strings, String as BunString};

// `bun.schema.api.Loader` — bindgen-emitted enum from `src/api/schema.zig`.
// Mirrored as a transparent `u8` until `bun_api::schema` is reachable from
// this tier; only equality with `none` (= 0) is observed below.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub struct ApiLoader(pub u8);
impl ApiLoader {
    pub const NONE: Self = Self(0);
}

// Zig: `export const NodeModuleModule__findPath = jsc.host_fn.wrap3(findPath);`
// `wrap3` emits an `extern "C" fn(*JSGlobalObject, bun.String, ?*JSArray) -> JSValue` shim
// that forwards to `findPath` via `toJSHostCall`. The C++ caller (NodeModuleModule.cpp
// `jsFunctionFindPath`) does the CallFrame → (BunString, JSArray*) extraction itself and
// invokes this with the coerced args directly — there is no CallFrame here.
#[unsafe(no_mangle)]
pub extern "C" fn NodeModuleModule__findPath(
    global: *mut JSGlobalObject,
    request_bun_str: BunString,
    paths_maybe: *mut JSArray,
) -> JSValue {
    // SAFETY: C++ caller guarantees non-null global; paths_maybe is a nullable JSArray*.
    let global = unsafe { &*global };
    let paths_maybe: Option<&JSArray> = unsafe { paths_maybe.as_ref() };
    jsc::host_fn::to_js_host_call(global, find_path(global, request_bun_str, paths_maybe))
}

// https://github.com/nodejs/node/blob/40ef9d541ed79470977f90eb445c291b95ab75a0/lib/internal/modules/cjs/loader.js#L666
fn find_path(
    global: &JSGlobalObject,
    request_bun_str: BunString,
    paths_maybe: Option<&JSArray>,
) -> JsResult<JSValue> {
    // PERF(port): was stack-fallback (8192 bytes) — profile in Phase B
    let request_slice = request_bun_str.to_utf8();
    let request = request_slice.slice();

    let absolute_request = bun_paths::is_absolute(request);
    if !absolute_request && paths_maybe.is_none() {
        return Ok(JSValue::FALSE);
    }

    // for each path
    let mut found = if let Some(paths) = paths_maybe {
        'found: {
            let mut iter = paths.iterator(global)?;
            while let Some(path) = iter.next()? {
                let cur_path = BunString::from_js(path, global)?;
                // `defer cur_path.deref()` — handled by Drop on bun_string::String

                if let Some(found) = find_path_inner(&request_bun_str, &cur_path, global) {
                    break 'found Some(found);
                }
            }

            break 'found None;
        }
    } else {
        find_path_inner(&request_bun_str, &BunString::static_(b""), global)
    };

    if let Some(str) = found.as_mut() {
        return str.transfer_to_js(global);
    }

    Ok(JSValue::FALSE)
}

fn find_path_inner(
    request: &BunString,
    cur_path: &BunString,
    global: &JSGlobalObject,
) -> Option<BunString> {
    // SAFETY: zero-init is the documented `ErrorableString` "empty" state; the
    // callee fully overwrites it on both ok/err paths.
    let mut errorable: ErrorableString = unsafe { core::mem::zeroed() };
    // PORT NOTE: `bun_string::String::ref_()` only bumps the WTF refcount in
    // place; clone via `clone_utf8` of the borrowed bytes to pass by value.
    let request_dup = BunString::clone_utf8(request.to_utf8().slice());
    let cur_path_dup = BunString::clone_utf8(cur_path.to_utf8().slice());
    match VirtualMachine::resolve_maybe_needs_trailing_slash::<true>(
        &mut errorable,
        global,
        request_dup,
        cur_path_dup,
        None,
        false,
        true,
    ) {
        Ok(()) => {}
        Err(JsError::Thrown) => {
            // TODO sus — Zig clears the pending exception here.
            let _ = global.try_take_exception();
            return None;
        }
        Err(_) => return None,
    }
    errorable.unwrap().ok()
}

pub fn _stat(_path: &[u8]) -> i32 {
    // TODO(port): `bun_sys::exists_at_type` is gated in `lib_draft_b1.rs`.
    // Spec: 0 = file, 1 = directory, -1 = anything else.
    todo!("phase-d: NodeModuleModule::_stat — bun_sys::exists_at_type")
}

pub enum CustomLoader {
    Loader(Loader),
    Custom(Strong),
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    pub fn JSCommonJSExtensions__appendFunction(global: *mut JSGlobalObject, value: JSValue) -> u32;
    pub fn JSCommonJSExtensions__setFunction(global: *mut JSGlobalObject, index: u32, value: JSValue);
    /// Returns the index of the last value, which must have it's references updated to `index`
    pub fn JSCommonJSExtensions__swapRemove(global: *mut JSGlobalObject, index: u32) -> u32;
}

// Memory management is complicated because JSValues are stored in gc-visitable
// WriteBarriers in C++ but the hash map for extensions is in Zig for flexibility.
//
// PORT NOTE (phase-d): `vm.commonjs_custom_extensions` is currently typed as
// `StringArrayHashMap<()>` in the Phase-B `VirtualMachine` layout (see
// VirtualMachine.rs:259). The full body — which stores `CustomLoader` values
// and re-publishes `list.keys()` into `vm.transpiler.resolver.opts` — is
// blocked on that field becoming `StringArrayHashMap<CustomLoader>`. Until
// then the export forwards to a `todo!()` so the C++ symbol links.
fn on_require_extension_modify(
    _global: &JSGlobalObject,
    _str: &[u8],
    _loader: ApiLoader,
    _value: JSValue,
) {
    todo!("phase-d: NodeModuleModule onRequireExtensionModify — vm.commonjs_custom_extensions value type")
}

fn on_require_extension_modify_non_function(_global: &JSGlobalObject, _str: &[u8]) {
    todo!("phase-d: NodeModuleModule onRequireExtensionModifyNonFunction — vm.commonjs_custom_extensions value type")
}

pub fn find_longest_registered_extension<'a>(
    vm: &'a VirtualMachine,
    filename: &[u8],
) -> Option<&'a CustomLoader> {
    let basename = bun_paths::basename(filename);
    let mut next: usize = 0;
    while let Some(i) = strings::index_of_char_pos(basename, b'.', next) {
        next = i + 1;
        if i == 0 {
            continue;
        }
        let _ext = &basename[i..];
        // TODO(port): `vm.commonjs_custom_extensions.get(ext)` once value type lands.
        let _ = vm;
    }
    None
}

#[unsafe(no_mangle)]
pub extern "C" fn NodeModuleModule__onRequireExtensionModify(
    global: *mut JSGlobalObject,
    str: *const BunString,
    loader: ApiLoader,
    value: JSValue,
) {
    // PERF(port): was stack-fallback (8192 bytes) — profile in Phase B
    // SAFETY: C++ caller guarantees non-null global and str for the call's duration
    let global = unsafe { &*global };
    let str_slice = unsafe { &*str }.to_utf8();
    on_require_extension_modify(global, str_slice.slice(), loader, value);
}

#[unsafe(no_mangle)]
pub extern "C" fn NodeModuleModule__onRequireExtensionModifyNonFunction(
    global: *mut JSGlobalObject,
    str: *const BunString,
) {
    // PERF(port): was stack-fallback (8192 bytes) — profile in Phase B
    // SAFETY: C++ caller guarantees non-null global and str for the call's duration
    let global = unsafe { &*global };
    let str_slice = unsafe { &*str }.to_utf8();
    on_require_extension_modify_non_function(global, str_slice.slice());
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/NodeModuleModule.zig (196 lines)
//   confidence: low
//   todos:      8
//   notes:      onRequireExtensionModify bodies blocked on vm.commonjs_custom_extensions value-type port; _stat blocked on bun_sys::exists_at_type un-gating; ApiLoader mirrored locally
// ──────────────────────────────────────────────────────────────────────────
