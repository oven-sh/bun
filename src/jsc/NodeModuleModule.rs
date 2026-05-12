use crate::{
    self as jsc, ErrorableString, JSArray, JSGlobalObject, JSValue, JsError, JsResult, StringJsc,
    Strong, VirtualMachineRef as VirtualMachine,
};
use bun_ast::Loader;
use bun_bundler::options::DEFAULT_LOADERS;
use bun_core::{OwnedString, String as BunString, strings};
use bun_options_types::LoaderExt as _;
use bun_options_types::schema::api;

// `bun.schema.api.Loader` — bindgen-emitted enum from `src/options_types/schema.zig`.
// Mirrored as a transparent `u8` because the schema enum is *open* in Zig
// (`enum(u8) { …, _ }`) and the FFI caller may hand us discriminants outside
// the closed Rust `api::Loader` set; transmuting an unknown tag would be UB.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub struct ApiLoader(pub u8);
impl ApiLoader {
    /// schema.zig:326 — `_none = 254`.
    pub const NONE: Self = Self(api::Loader::_none as u8);

    /// Reconstruct the closed schema enum. Only valid when `self != NONE` is
    /// already established and the C++ caller honoured the `BunLoaderType`
    /// contract (headers-handwritten.h keeps the discriminants in sync).
    fn to_schema(self) -> api::Loader {
        debug_assert_ne!(self, Self::NONE);
        // C++ caller passes a valid `BunLoaderType` discriminant per
        // headers-handwritten.h; `from_raw` maps unknowns to `_none`.
        api::Loader::from_raw(self.0)
    }
}

// Zig: `export const NodeModuleModule__findPath = jsc.host_fn.wrap3(findPath);`
// `wrap3` emits an `extern "C" fn(*JSGlobalObject, bun.String, ?*JSArray) -> JSValue` shim
// that forwards to `findPath` via `toJSHostCall`. The C++ caller (NodeModuleModule.cpp
// `jsFunctionFindPath`) does the CallFrame → (BunString, JSArray*) extraction itself and
// invokes this with the coerced args directly — there is no CallFrame here.
#[unsafe(no_mangle)]
pub extern "C" fn NodeModuleModule__findPath(
    global: &JSGlobalObject,
    request_bun_str: BunString,
    paths_maybe: *mut JSArray,
) -> JSValue {
    // `JSArray` is an `opaque_ffi!` ZST handle; `opaque_ref` is the centralised
    // non-null-ZST deref proof. Nullable per the C++ caller contract.
    let paths_maybe: Option<&JSArray> =
        (!paths_maybe.is_null()).then(|| JSArray::opaque_ref(paths_maybe));
    jsc::host_fn::to_js_host_call(global, || find_path(global, request_bun_str, paths_maybe))
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
                // Zig: `defer cur_path.deref()` — `OwnedString` releases the +1 from `fromJS`.
                let cur_path = OwnedString::new(BunString::from_js(path, global)?);

                if let Some(found) = find_path_inner(request_bun_str, cur_path.get(), global) {
                    break 'found Some(found);
                }
            }

            break 'found None;
        }
    } else {
        find_path_inner(request_bun_str, BunString::static_(b""), global)
    };

    if let Some(str) = found.as_mut() {
        return str.transfer_to_js(global);
    }

    Ok(JSValue::FALSE)
}

fn find_path_inner(
    request: BunString,
    cur_path: BunString,
    global: &JSGlobalObject,
) -> Option<BunString> {
    // SAFETY: zero-init is the documented `ErrorableString` "empty" state; the
    // callee fully overwrites it on both ok/err paths.
    let mut errorable: ErrorableString = unsafe { bun_core::ffi::zeroed_unchecked() };
    // `bun_core::String` is `Copy` — passing by value here mirrors Zig's
    // by-value struct copy with no refcount change.
    match VirtualMachine::resolve_maybe_needs_trailing_slash::<true>(
        &mut errorable,
        global,
        request,
        cur_path,
        None,
        false,
        true,
    ) {
        Ok(()) => {}
        Err(JsError::Thrown) => {
            // TODO sus — Zig clears the pending exception here.
            global.clear_exception();
            return None;
        }
        Err(_) => return None,
    }
    errorable.unwrap().ok()
}

pub fn _stat(path: &[u8]) -> i32 {
    // PERF(port): Zig passed the slice straight through; `exists_at_type`
    // takes a `&ZStr`, so we copy into a NUL-terminated heap buffer here.
    let zpath = bun_core::ZBox::from_bytes(path);
    match bun_sys::exists_at_type(bun_sys::Fd::cwd(), &zpath) {
        Ok(bun_sys::ExistsAtType::File) => 0, // Returns 0 for files.
        Ok(bun_sys::ExistsAtType::Directory) => 1, // Returns 1 for directories.
        Err(_) => -1, // Returns a negative integer for any other kind of strings.
    }
}

pub enum CustomLoader {
    Loader(Loader),
    Custom(Strong),
}

impl Default for CustomLoader {
    /// Placeholder for `StringArrayHashMap::get_or_put` — overwritten
    /// immediately when `!found_existing`.
    fn default() -> Self {
        CustomLoader::Loader(Loader::default())
    }
}

// TODO(port): move to jsc_sys
//
// `JSGlobalObject` is an opaque `UnsafeCell`-backed ZST handle; remaining
// params are by-value `JSValue`/scalars → `safe fn`.
unsafe extern "C" {
    pub safe fn JSCommonJSExtensions__appendFunction(
        global: &JSGlobalObject,
        value: JSValue,
    ) -> u32;
    pub safe fn JSCommonJSExtensions__setFunction(
        global: &JSGlobalObject,
        index: u32,
        value: JSValue,
    );
    /// Returns the index of the last value, which must have it's references updated to `index`
    pub safe fn JSCommonJSExtensions__swapRemove(global: &JSGlobalObject, index: u32) -> u32;
}

// Memory management is complicated because JSValues are stored in gc-visitable
// WriteBarriers in C++ but the hash map for extensions is in Zig for flexibility.
fn on_require_extension_modify(
    global: &JSGlobalObject,
    str: &[u8],
    loader: ApiLoader,
    value: JSValue,
) -> Result<(), bun_alloc::AllocError> {
    // global; we are on the JS thread so a `&mut` view is sound for this scope.
    let vm = global.bun_vm().as_mut();
    let is_built_in = DEFAULT_LOADERS.get(str).is_some();

    let gop = vm.commonjs_custom_extensions.get_or_put(str)?;
    if !gop.found_existing {
        // `gop.key_ptr` already owns a duped `Box<[u8]>` (StringArrayHashMap
        // boxes the key on insert), so the Zig `dupe` is implicit.
        if is_built_in {
            vm.has_mutated_built_in_extensions += 1;
        }

        *gop.value_ptr = if loader != ApiLoader::NONE {
            CustomLoader::Loader(Loader::from_api(loader.to_schema()))
        } else {
            CustomLoader::Custom(Strong::create(value, global))
        };
    } else if loader != ApiLoader::NONE {
        // Replacing with a built-in loader: drop any held Strong via assignment.
        *gop.value_ptr = CustomLoader::Loader(Loader::from_api(loader.to_schema()));
    } else {
        match gop.value_ptr {
            CustomLoader::Loader(_) => {
                *gop.value_ptr = CustomLoader::Custom(Strong::create(value, global));
            }
            CustomLoader::Custom(strong) => strong.set(global, value),
        }
    }

    // Zig `defer vm.transpiler.resolver.opts.extra_cjs_extensions = list.keys()`.
    // PERF(port): Zig aliased the map's key storage directly; the resolver's
    // `extra_cjs_extensions` is owned `Box<[Box<[u8]>]>` here, so we clone.
    vm.transpiler.resolver.opts.extra_cjs_extensions = vm
        .commonjs_custom_extensions
        .keys()
        .to_vec()
        .into_boxed_slice();
    Ok(())
}

fn on_require_extension_modify_non_function(
    global: &JSGlobalObject,
    str: &[u8],
) -> Result<(), bun_alloc::AllocError> {
    // SAFETY: see `on_require_extension_modify`.
    let vm = global.bun_vm().as_mut();
    let is_built_in = DEFAULT_LOADERS.get(str).is_some();

    if let Some(prev) = vm.commonjs_custom_extensions.fetch_swap_remove(str) {
        // `prev.key: Box<[u8]>` — freed on drop (Zig: `allocator.free(prev.key)`).
        if is_built_in {
            vm.has_mutated_built_in_extensions -= 1;
        }
        // `prev.value` drops here; `Strong`'s `Drop` impl is the Zig `deinit`.
        drop(prev);
    }

    // Zig `defer vm.transpiler.resolver.opts.extra_cjs_extensions = list.keys()`.
    // PERF(port): see `on_require_extension_modify`.
    vm.transpiler.resolver.opts.extra_cjs_extensions = vm
        .commonjs_custom_extensions
        .keys()
        .to_vec()
        .into_boxed_slice();
    Ok(())
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
        let ext = &basename[i..];
        if let Some(value) = vm.commonjs_custom_extensions.get(ext) {
            return Some(value);
        }
    }
    None
}

#[unsafe(no_mangle)]
pub extern "C" fn NodeModuleModule__onRequireExtensionModify(
    global: &JSGlobalObject,
    str: *const BunString,
    loader: ApiLoader,
    value: JSValue,
) {
    // PERF(port): was stack-fallback (8192 bytes) — profile in Phase B
    // SAFETY: C++ caller guarantees non-null str for the call's duration.
    let str_slice = unsafe { &*str }.to_utf8();
    if on_require_extension_modify(global, str_slice.slice(), loader, value).is_err() {
        bun_core::out_of_memory();
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn NodeModuleModule__onRequireExtensionModifyNonFunction(
    global: &JSGlobalObject,
    str: *const BunString,
) {
    // PERF(port): was stack-fallback (8192 bytes) — profile in Phase B
    // SAFETY: C++ caller guarantees non-null str for the call's duration.
    let str_slice = unsafe { &*str }.to_utf8();
    if on_require_extension_modify_non_function(global, str_slice.slice()).is_err() {
        bun_core::out_of_memory();
    }
}

// ported from: src/jsc/NodeModuleModule.zig
