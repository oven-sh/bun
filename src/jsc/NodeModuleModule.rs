use core::ptr::NonNull;

use crate::{
    self as jsc, JSGlobalObject, JSValue, JsResult, Strong, VirtualMachineRef as VirtualMachine,
    bun_string_jsc,
};
use bun_ast::Loader;
use bun_bundler::options::DEFAULT_LOADERS;
use bun_core::{String as BunString, Utf8Bytes, strings};
use bun_options_types::LoaderExt as _;
use bun_options_types::schema::api;
use bun_resolver::{FoundInDirectory, Resolver};

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

// The C++ caller (NodeModuleModule.cpp `jsFunctionFindPath`) checks that the request is a string and
// passes `paths` as it is.
#[unsafe(no_mangle)]
extern "C" fn NodeModuleModule__findPath(
    global: &JSGlobalObject,
    request_bun_str: &BunString,
    paths: JSValue,
) -> JSValue {
    jsc::host_fn::to_js_host_call(global, || find_path(global, request_bun_str, paths))
}

// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/modules/cjs/loader.js#L728-L839
fn find_path(
    global: &JSGlobalObject,
    request_bun_str: &BunString,
    paths: JSValue,
) -> JsResult<JSValue> {
    let request_slice = request_bun_str.to_utf8();
    let request = request_slice.slice();

    // Node replaces `paths` with `['']` for an absolute request, and reads it no further.
    let absolute_request = bun_paths::is_absolute(request);
    let mut len = if absolute_request {
        1
    } else {
        paths_length(global, paths)?
    };

    // What the resolver logs for a directory of `paths` is no error of the caller.
    let mut log = bun_ast::Log::default();

    // The first look is in the resolver's cache of the directories, where `require()` looks. If no
    // entry has the request, the cache can be older than the disk: it forgets each entry, and the
    // second look reads the disk.
    for is_second_look in [false, true] {
        for i in 0..len {
            let cur_path_slice = if absolute_request {
                Utf8Bytes::Borrowed(b"")
            } else {
                let cur_path = paths.get_index(global, i)?;
                if !cur_path.is_string_literal() {
                    return Err(global.throw_invalid_argument_type_value2(
                        "paths",
                        "array of strings",
                        paths,
                    ));
                }
                cur_path.to_utf8(global)?
            };
            let cur_path = cur_path_slice.slice();

            // `paths[i]` may have run JS that resolves a module. That puts the log of the VM back,
            // so the log is set for each entry, and the VM is read again.
            // SAFETY: the VM and its resolver outlive this call, and this is dropped before `log`.
            // The slot comes from the raw pointer to the VM, so `as_mut()` below leaves it valid.
            let _restore_log = unsafe {
                Resolver::scoped_log(
                    &raw mut (*global.bun_vm_ptr()).transpiler.resolver,
                    NonNull::from(&mut log),
                )
            };
            let resolver = &mut global.bun_vm().as_mut().transpiler.resolver;
            if is_second_look {
                resolver.forget_in_directory(cur_path, request);
            }
            match resolver.find_in_directory(cur_path, request) {
                FoundInDirectory::Found(path) => {
                    return bun_string_jsc::create_utf8_for_js(global, path);
                }
                FoundInDirectory::NotFound => {}
                // Node throws here. Like Node, look in no later entry.
                FoundInDirectory::NotExported => {
                    len = i;
                    break;
                }
            }
        }
    }

    Ok(JSValue::FALSE)
}

/// How many entries Node's loop `for (let i = 0; i < paths.length; i++)` reads. It takes `paths` as it
/// comes: an array, an object with a `length`, or a string.
fn paths_length(global: &JSGlobalObject, paths: JSValue) -> JsResult<u32> {
    let length = if paths.is_array() || paths.is_string_literal() {
        paths.get_length(global)? as f64
    } else if paths.is_object() {
        match paths.get(global, "length")? {
            Some(length) => length.to_number(global)?,
            None => 0.0,
        }
    } else {
        0.0
    };
    // `NaN` compares false, and a fraction is one more index.
    Ok(if length > 0.0 {
        length.ceil().min(u32::MAX as f64) as u32
    } else {
        0
    })
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
        // boxes the key on insert).
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
    let is_built_in = DEFAULT_LOADERS.get(str).is_some();

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
