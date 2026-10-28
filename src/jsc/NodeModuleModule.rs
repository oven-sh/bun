use crate::{
    self as jsc, JSArray, JSGlobalObject, JSValue, JsResult, StringJsc, Strong,
    VirtualMachineRef as VirtualMachine,
};
use bun_ast::Loader;
use bun_bundler::options::DEFAULT_LOADERS;
use bun_core::{String as BunString, strings};
use bun_options_types::LoaderExt as _;
use bun_options_types::schema::api;

// `bun.schema.api.Loader` — bindgen-emitted schema enum.
// Mirrored as a transparent `u8` because the schema enum is *open*
// and the FFI caller may hand us discriminants outside
// the closed Rust `api::Loader` set; transmuting an unknown tag would be UB.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub(crate) struct ApiLoader(pub u8);
impl ApiLoader {
    /// `_none = 254`.
    const NONE: Self = Self(api::Loader::_none as u8);
    /// What C++ passes for the built-in `Module._extensions[".js"]` handler.
    const JS: Self = Self(api::Loader::js as u8);
    /// What C++ passes for the built-in `Module._extensions[".ts"]` handler.
    const TS: Self = Self(api::Loader::ts as u8);

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

// The C++ caller (NodeModuleModule.cpp
// `jsFunctionFindPath`) does the CallFrame → (BunString, JSArray*) extraction itself and
// invokes this with the coerced args directly — there is no CallFrame here.
#[unsafe(no_mangle)]
extern "C" fn NodeModuleModule__findPath(
    global: &JSGlobalObject,
    request_bun_str: &BunString,
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
    request_bun_str: &BunString,
    paths_maybe: Option<&JSArray>,
) -> JsResult<JSValue> {
    let request_slice = request_bun_str.to_utf8();
    let request = request_slice.slice();

    let absolute_request = bun_paths::is_absolute(request);
    if !absolute_request && paths_maybe.is_none() {
        return Ok(JSValue::FALSE);
    }

    // for each path
    let found = if let Some(paths) = paths_maybe {
        'found: {
            let mut iter = paths.iterator(global)?;
            while let Some(path) = iter.next()? {
                let cur_path = BunString::from_js(path, global)?;

                if let Some(found) = find_path_inner(request_bun_str, &cur_path, global)? {
                    break 'found Some(found);
                }
            }

            break 'found None;
        }
    } else {
        find_path_inner(request_bun_str, &BunString::EMPTY, global)?
    };

    if let Some(str) = found {
        return str.into_js(global);
    }

    Ok(JSValue::FALSE)
}

fn find_path_inner(
    request: &BunString,
    cur_path: &BunString,
    global: &JSGlobalObject,
) -> JsResult<Option<BunString>> {
    Ok(VirtualMachine::resolve_maybe_needs_trailing_slash::<true>(
        global,
        request,
        cur_path,
        None,
        crate::virtual_machine::ResolveMode::RequireResolve,
    )?
    .ok())
}

pub(crate) fn stat(path: &[u8]) -> i32 {
    // Node passes the path to `uv_fs_stat` as a C string, which ends at the first NUL.
    let path = bun_core::slice_to_nul(path);
    // PERF: `exists_at_type`
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

/// The file extension (with its leading `.`) of a file that the
/// `require.extensions` key `key` matches. `key` starts with `.`, so the last
/// `.` always exists. For a key such as `.spec.ts` that is `.ts`.
fn file_ext_of_key(key: &[u8]) -> &[u8] {
    let last_dot = strings::last_index_of_char(key, b'.').unwrap_or(0);
    &key[last_dot..]
}

/// The loader a built-in `Module._extensions` handler uses for a file with the
/// extension `ext` (with its leading `.`).
///
/// Node's `.js` handler does not force a format. It picks a JavaScript flavor
/// from the file name it is given (`.ts`, `.cts` and `.mts` strip types), and
/// compiles any other file as JavaScript. Bun does the same with its loader
/// map, so `.js` files get the JSX-enabled loader that a plain `require()`
/// gives them. Bun's own `.ts` handler always strips types and takes JSX from
/// the file name the same way. The `.json` and `.node` handlers mean one
/// loader.
pub(crate) fn builtin_handler_loader(
    vm: &VirtualMachine,
    ext: &[u8],
    handler: ApiLoader,
) -> Loader {
    let by_name = vm.transpiler.options.loader(ext);
    match handler {
        ApiLoader::JS if by_name.is_javascript_like() => by_name,
        ApiLoader::JS => Loader::Js,
        ApiLoader::TS if matches!(by_name, Loader::Jsx | Loader::Tsx) => Loader::Tsx,
        ApiLoader::TS => Loader::Ts,
        _ => Loader::from_api(handler.to_schema()),
    }
}

/// Whether an entry under `key` can change how a file that already has a
/// default loader is loaded. `require()` consults the extension table for such
/// files only while `has_mutated_built_in_extensions` is non-zero. A compound
/// key such as `.spec.ts` matches `a.spec.ts` ahead of the default `.ts`
/// loader, so it counts too.
fn shadows_default_loader(key: &[u8]) -> bool {
    DEFAULT_LOADERS.get(file_ext_of_key(key)).is_some()
}

fn on_require_extension_modify(
    global: &JSGlobalObject,
    str: &[u8],
    loader: ApiLoader,
    value: JSValue,
) -> Result<(), bun_alloc::AllocError> {
    // global; we are on the JS thread so a `&mut` view is sound for this scope.
    let vm = global.bun_vm().as_mut();
    let is_built_in = shadows_default_loader(str);
    let builtin = (loader != ApiLoader::NONE)
        .then(|| builtin_handler_loader(vm, file_ext_of_key(str), loader));

    let gop = vm.commonjs_custom_extensions.get_or_put(str)?;
    if !gop.found_existing {
        // `gop.key_ptr` already owns a duped `Box<[u8]>` (StringArrayHashMap
        // boxes the key on insert).
        if is_built_in {
            vm.has_mutated_built_in_extensions += 1;
        }

        *gop.value_ptr = match builtin {
            Some(loader) => CustomLoader::Loader(loader),
            None => CustomLoader::Custom(Strong::create(value, global)),
        };
    } else if let Some(loader) = builtin {
        // Replacing with a built-in loader: drop any held Strong via assignment.
        *gop.value_ptr = CustomLoader::Loader(loader);
    } else {
        match gop.value_ptr {
            CustomLoader::Loader(_) => {
                *gop.value_ptr = CustomLoader::Custom(Strong::create(value, global));
            }
            CustomLoader::Custom(strong) => strong.set(global, value),
        }
    }

    // PERF: the resolver's
    // `extra_cjs_extensions` is owned `Box<[Box<[u8]>]>`, so we clone the keys.
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
    let is_built_in = shadows_default_loader(str);

    if let Some(prev) = vm.commonjs_custom_extensions.fetch_swap_remove(str) {
        // `prev.key: Box<[u8]>` — freed on drop.
        if is_built_in {
            vm.has_mutated_built_in_extensions -= 1;
        }
        // `prev.value` drops here, releasing any held `Strong`.
        drop(prev);
    }

    // PERF: see `on_require_extension_modify`.
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
extern "C" fn NodeModuleModule__onRequireExtensionModify(
    global: &JSGlobalObject,
    str: &BunString,
    loader: ApiLoader,
    value: JSValue,
) {
    let str_slice = str.to_utf8();
    if on_require_extension_modify(global, str_slice.slice(), loader, value).is_err() {
        bun_core::out_of_memory();
    }
}

#[unsafe(no_mangle)]
extern "C" fn NodeModuleModule__onRequireExtensionModifyNonFunction(
    global: &JSGlobalObject,
    str: &BunString,
) {
    let str_slice = str.to_utf8();
    if on_require_extension_modify_non_function(global, str_slice.slice()).is_err() {
        bun_core::out_of_memory();
    }
}

/// C++ entry point for a direct call of a built-in handler: the loader it
/// uses for `filename`, as a `BunLoaderType`.
#[unsafe(no_mangle)]
extern "C" fn NodeModuleModule__builtinHandlerLoader(
    global: &JSGlobalObject,
    handler: ApiLoader,
    filename: &BunString,
) -> ApiLoader {
    let filename = filename.to_utf8();
    let ext = bun_paths::fs::PathName::find_extname(filename.slice());
    ApiLoader(builtin_handler_loader(global.bun_vm(), ext, handler).to_api() as u8)
}
