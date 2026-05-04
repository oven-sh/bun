use bun_alloc::AllocError;
use bun_bundler::options::{self, Loader};
use bun_jsc::{
    self as jsc, CallFrame, ErrorableString, JSArray, JSGlobalObject, JSValue, JsError, JsResult,
    Strong, VirtualMachine,
};
use bun_paths;
use bun_str::{self, strings, String as BunString};
use bun_sys::{self, Fd};
// TODO(port): `bun.schema.api.Loader` lives in generated `src/api/schema.zig`; confirm crate path.
use bun_api::schema::api::Loader as ApiLoader;

// TODO(port): `jsc.host_fn.wrap3` auto-coerces CallFrame args (BunString, Option<&JSArray>)
// into the wrapped fn's params. Phase B: emit equivalent via `#[bun_jsc::host_fn]` proc-macro
// or hand-write the CallFrame → (BunString, Option<&JSArray>) extraction shim.
#[bun_jsc::host_fn]
pub fn NodeModuleModule__findPath(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // TODO(port): wrap3 arg extraction — see note above
    let request_bun_str: BunString = todo!("extract arg 0 as bun.String");
    let paths_maybe: Option<&JSArray> = todo!("extract arg 1 as ?*JSArray");
    find_path(global, request_bun_str, paths_maybe)
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
                // `defer cur_path.deref()` — handled by Drop on bun_str::String

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
        return Ok(str.transfer_to_js(global));
    }

    Ok(JSValue::FALSE)
}

fn find_path_inner(
    request: &BunString,
    cur_path: &BunString,
    global: &JSGlobalObject,
) -> Option<BunString> {
    let mut errorable = core::mem::MaybeUninit::<ErrorableString>::uninit();
    // TODO(port): in-place init — Zig passes `*ErrorableString` (uninit out-param).
    // Forming `&mut ErrorableString` from uninit memory is UB in Rust, so pass the
    // `&mut MaybeUninit<_>` slot through and let Phase B reshape the callee to either
    // accept `&mut MaybeUninit<ErrorableString>` / `*mut ErrorableString` or return by value.
    match VirtualMachine::resolve_maybe_needs_trailing_slash(
        &mut errorable,
        global,
        request.clone(),
        cur_path.clone(),
        None,
        false,
        true,
        true,
    ) {
        Ok(()) => {}
        Err(JsError::Thrown) => {
            global.clear_exception(); // TODO sus
            return None;
        }
        Err(_) => return None,
    }
    // SAFETY: callee initialized `errorable` on the Ok path
    unsafe { errorable.assume_init() }.unwrap().ok()
}

pub fn _stat(path: &[u8]) -> i32 {
    let Ok(exists) = bun_sys::exists_at_type(Fd::cwd(), path) else {
        return -1; // Returns a negative integer for any other kind of strings.
    };
    match exists {
        bun_sys::ExistsAtType::File => 0, // Returns 0 for files.
        bun_sys::ExistsAtType::Directory => 1, // Returns 1 for directories.
    }
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
fn on_require_extension_modify(
    global: &JSGlobalObject,
    str: &[u8],
    loader: ApiLoader,
    value: JSValue,
) -> Result<(), AllocError> {
    let vm = global.bun_vm();
    let list = &mut vm.commonjs_custom_extensions;
    // TODO(port): Zig `defer vm.transpiler.resolver.opts.extra_cjs_extensions = list.keys();`
    // runs on both success and error paths. scopeguard here would need disjoint &mut borrows
    // of `vm.transpiler` and `vm.commonjs_custom_extensions` — reshape in Phase B.
    let is_built_in = options::DEFAULT_LOADERS.get(str).is_some();

    let gop = list.get_or_put(str)?;
    if !gop.found_existing {
        *gop.key_ptr = Box::<[u8]>::from(str);
        if is_built_in {
            vm.has_mutated_built_in_extensions += 1;
        }

        *gop.value_ptr = if loader != ApiLoader::None {
            CustomLoader::Loader(Loader::from_api(loader))
        } else {
            CustomLoader::Custom(Strong::create(value, global))
        };
    } else {
        if loader != ApiLoader::None {
            match gop.value_ptr {
                CustomLoader::Loader(_) => {}
                CustomLoader::Custom(_strong) => {
                    // `strong.deinit()` — Drop on overwrite below frees the HandleSlot
                }
            }
            *gop.value_ptr = CustomLoader::Loader(Loader::from_api(loader));
        } else {
            match gop.value_ptr {
                CustomLoader::Loader(_) => {
                    *gop.value_ptr = CustomLoader::Custom(Strong::create(value, global));
                }
                CustomLoader::Custom(strong) => strong.set(global, value),
            }
        }
    }

    // PORT NOTE: reshaped for borrowck — Zig `defer` ran this at scope exit (incl. error path)
    vm.transpiler.resolver.opts.extra_cjs_extensions = list.keys();
    Ok(())
}

fn on_require_extension_modify_non_function(
    global: &JSGlobalObject,
    str: &[u8],
) -> Result<(), AllocError> {
    let vm = global.bun_vm();
    let list = &mut vm.commonjs_custom_extensions;
    // TODO(port): same `defer` reshape note as on_require_extension_modify
    let is_built_in = options::DEFAULT_LOADERS.get(str).is_some();

    if let Some(prev) = list.fetch_swap_remove(str) {
        // `bun.default_allocator.free(prev.key)` — Box<[u8]> key drops here
        drop(prev.key);
        if is_built_in {
            vm.has_mutated_built_in_extensions -= 1;
        }
        match prev.value {
            CustomLoader::Loader(_) => {}
            CustomLoader::Custom(strong) => {
                drop(strong); // `mut.deinit()` — Strong's Drop deallocates the HandleSlot
            }
        }
    }

    // PORT NOTE: reshaped for borrowck — Zig `defer` ran this at scope exit
    vm.transpiler.resolver.opts.extra_cjs_extensions = list.keys();
    Ok(())
}

pub fn find_longest_registered_extension(
    vm: &VirtualMachine,
    filename: &[u8],
) -> Option<CustomLoader> {
    let basename = bun_paths::basename(filename);
    let mut next: usize = 0;
    while let Some(i) = strings::index_of_char_pos(basename, b'.', next) {
        next = i + 1;
        if i == 0 {
            continue;
        }
        let ext = &basename[i..];
        if let Some(value) = vm.commonjs_custom_extensions.get(ext) {
            // TODO(port): Zig returned `CustomLoader` by value (copied the Strong handle
            // without bumping refcount). Verify ownership semantics — likely should return
            // a borrow `Option<&CustomLoader>` instead.
            return Some(value);
        }
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
    on_require_extension_modify(global, str_slice.slice(), loader, value).unwrap_or_oom();
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
    on_require_extension_modify_non_function(global, str_slice.slice()).unwrap_or_oom();
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/NodeModuleModule.zig (196 lines)
//   confidence: medium
//   todos:      8
//   notes:      host_fn.wrap3 arg-coercion shim needs proc-macro; `defer list.keys()` side-effect reshaped to fn-end (loses error-path coverage); CustomLoader return-by-value may need &-borrow; ErrorableString out-param passed as MaybeUninit slot pending callee reshape
// ──────────────────────────────────────────────────────────────────────────
