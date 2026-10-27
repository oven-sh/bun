use crate::{
    self as jsc, JSArray, JSGlobalObject, JSValue, JsResult, StringJsc, Strong,
    VirtualMachineRef as VirtualMachine,
};
use bun_ast::Loader;
use bun_bundler::options::DEFAULT_LOADERS;
use bun_collections::StringArrayHashMap;
use bun_core::{String as BunString, strings};
use bun_options_types::LoaderExt as _;
use bun_options_types::schema::api;
use core::cell::Cell;

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

/// What `require.extensions[ext]` is set to.
#[derive(Clone, Copy)]
pub enum CustomLoader {
    Loader(Loader),
    Custom(JSValue),
}

enum Registered {
    Loader(Loader),
    Custom(Strong),
}

impl Default for Registered {
    /// Placeholder for `StringArrayHashMap::get_or_put` — overwritten
    /// immediately when `!found_existing`.
    fn default() -> Self {
        Registered::Loader(Loader::default())
    }
}

/// The extensions that exist in the `require.extensions` map.
#[derive(Default)]
pub struct CustomExtensions {
    /// Out of the cell for the length of one operation, none of which runs JavaScript.
    map: Cell<StringArrayHashMap<Registered>>,
}

impl CustomExtensions {
    fn with<R>(&self, operation: impl FnOnce(&mut StringArrayHashMap<Registered>) -> R) -> R {
        let mut map = self.map.take();
        let result = operation(&mut map);
        self.map.set(map);
        result
    }

    pub fn is_empty(&self) -> bool {
        self.with(|map| map.is_empty())
    }

    fn find_longest(&self, filename: &[u8]) -> Option<CustomLoader> {
        let basename = bun_paths::basename(filename);
        self.with(|map| {
            let mut next: usize = 0;
            while let Some(i) = strings::index_of_char_pos(basename, b'.', next) {
                next = i + 1;
                if i == 0 {
                    continue;
                }
                match map.get(&basename[i..]) {
                    Some(Registered::Loader(loader)) => return Some(CustomLoader::Loader(*loader)),
                    Some(Registered::Custom(strong)) => {
                        return Some(CustomLoader::Custom(strong.get()));
                    }
                    None => {}
                }
            }
            None
        })
    }

    /// Whether `ext` is new to the map.
    fn set(
        &self,
        global: &JSGlobalObject,
        ext: &[u8],
        loader: ApiLoader,
        value: JSValue,
    ) -> Result<bool, bun_alloc::AllocError> {
        self.with(|map| {
            let gop = map.get_or_put(ext)?;
            if loader != ApiLoader::NONE {
                // Drops any held `Strong`.
                *gop.value_ptr = Registered::Loader(Loader::from_api(loader.to_schema()));
            } else {
                match gop.value_ptr {
                    Registered::Loader(_) => {
                        *gop.value_ptr = Registered::Custom(Strong::create(value, global));
                    }
                    Registered::Custom(strong) => strong.set(global, value),
                }
            }
            Ok(!gop.found_existing)
        })
    }

    /// Whether `ext` was in the map.
    fn remove(&self, ext: &[u8]) -> bool {
        self.with(|map| map.fetch_swap_remove(ext)).is_some()
    }

    fn keys(&self) -> Box<[Box<[u8]>]> {
        self.with(|map| map.keys().to_vec().into_boxed_slice())
    }
}

fn set_resolver_extensions(vm: &VirtualMachine) {
    // PERF: the resolver's
    // `extra_cjs_extensions` is owned `Box<[Box<[u8]>]>`, so we clone the keys.
    let extensions = vm.commonjs_custom_extensions.keys();
    // SAFETY: script assigning to `require.extensions` got us here, and no borrow of the
    // transpiler is held across a call into script. This one ends with the assignment.
    // FIXME: a macro is the exception. It runs under the `&mut Transpiler` of the parse that
    // called it.
    unsafe { vm.transpiler_mut() }
        .resolver
        .opts
        .extra_cjs_extensions = extensions;
}

fn on_require_extension_modify(
    global: &JSGlobalObject,
    str: &[u8],
    loader: ApiLoader,
    value: JSValue,
) -> Result<(), bun_alloc::AllocError> {
    let vm = global.bun_vm();
    let is_built_in = DEFAULT_LOADERS.get(str).is_some();

    let is_new = vm
        .commonjs_custom_extensions
        .set(global, str, loader, value)?;
    if is_new && is_built_in {
        vm.has_mutated_built_in_extensions
            .set(vm.has_mutated_built_in_extensions.get() + 1);
    }

    set_resolver_extensions(vm);
    Ok(())
}

fn on_require_extension_modify_non_function(global: &JSGlobalObject, str: &[u8]) {
    let vm = global.bun_vm();
    let is_built_in = DEFAULT_LOADERS.get(str).is_some();

    if vm.commonjs_custom_extensions.remove(str) && is_built_in {
        vm.has_mutated_built_in_extensions
            .set(vm.has_mutated_built_in_extensions.get() - 1);
    }

    set_resolver_extensions(vm);
}

pub fn find_longest_registered_extension(
    vm: &VirtualMachine,
    filename: &[u8],
) -> Option<CustomLoader> {
    vm.commonjs_custom_extensions.find_longest(filename)
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
    on_require_extension_modify_non_function(global, str.to_utf8().slice());
}
