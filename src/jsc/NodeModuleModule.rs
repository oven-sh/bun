use crate::resolve_message::esm_package_name;
use crate::{
    self as jsc, CallFrame, JSArray, JSGlobalObject, JSValue, JsResult, StringJsc, Strong,
    URLJsc as _, VirtualMachineRef as VirtualMachine,
};
use bstr::BStr;
use bun_ast::Loader;
use bun_bundler::options::DEFAULT_LOADERS;
use bun_core::{String as BunString, strings};
use bun_options_types::LoaderExt as _;
use bun_options_types::schema::api;
use bun_paths::resolve_path;
use core::ptr::NonNull;

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

// https://nodejs.org/api/module.html#modulefindpackagejsonspecifier-base
#[crate::host_fn(export = "NodeModuleModule__findPackageJSON")]
fn find_package_json(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    crate::mark_binding!();
    if frame.arguments_count() == 0 {
        return Err(global.throw_missing_arguments_value(&["specifier"]));
    }
    let specifier_value = frame.argument(0);
    if specifier_value.is_symbol() {
        return Err(global.throw_invalid_argument_type_value(
            "specifier",
            "string",
            specifier_value,
        ));
    }
    let specifier = match Location::from_js(global, specifier_value) {
        Ok(specifier) => specifier,
        // Like Node, a value whose `toString()` throws is reported as the wrong type.
        Err(jsc::JsError::Thrown) if global.clear_exception_except_termination() => {
            return Err(global.throw_invalid_argument_type_value(
                "specifier",
                "string",
                specifier_value,
            ));
        }
        Err(err) => return Err(err),
    };
    let base_value = frame.argument(1);
    let base = if base_value.is_undefined() {
        None
    } else if base_value.is_string() || jsc::DOMURL::cast_(base_value, global.vm()).is_some() {
        Some(Location::from_js(global, base_value)?)
    } else {
        return Err(global.throw_invalid_argument_type_value("base", "string", base_value));
    };

    let is_url = matches!(specifier, Location::Url(_));
    let specifier = specifier.into_path(global)?;
    let specifier_utf8 = specifier.to_utf8();
    let mut specifier = specifier_utf8.slice();
    // `import()` ignores a query string (`./a.js?v=1`); a file URL already lost its own.
    if !is_url {
        if let Some(query) = strings::index_of_char_usize(specifier, b'?') {
            specifier = &specifier[..query];
        }
    }
    let base = base.map(|base| base.into_path(global)).transpose()?;
    let base_utf8 = base.as_ref().map(BunString::to_utf8);

    let top_level_dir = global.bun_vm().top_level_dir();
    let mut base_buf = bun_paths::path_buffer_pool::get();
    // `base` is the calling module (`__filename` / `import.meta.url`), so
    // resolution starts in its directory; without one it starts in the cwd.
    let (source_dir, referrer): (&[u8], &[u8]) = match &base_utf8 {
        Some(base) => {
            // Like Node's `new URL(base)`: a path must be absolute.
            if !bun_paths::is_absolute(base.slice()) {
                let error = global
                    .err(jsc::ErrorCode::ERR_INVALID_URL, format_args!("Invalid URL"))
                    .to_js();
                error.put(global, "input", base_value);
                return Err(global.throw_value(error));
            }
            // A trailing separator (`dir/`, `file:///dir/`) names the directory itself.
            // Checked before the join, which keeps only the platform's own separator.
            let is_directory = base
                .slice()
                .last()
                .is_some_and(|&last| bun_paths::Platform::AUTO.is_separator(last));
            let joined = resolve_path::join_abs_string_buf_checked::<bun_paths::platform::Auto>(
                top_level_dir,
                &mut base_buf,
                &[base.slice()],
            );
            // `None`: longer than any path the OS accepts.
            let Some(base) = joined else {
                return Err(global.throw_invalid_argument_value(b"base", base_value));
            };
            let source_dir = if is_directory {
                base
            } else {
                bun_paths::dirname(base).unwrap_or(base)
            };
            (source_dir, base)
        }
        None => (top_level_dir, top_level_dir),
    };

    let mut log = bun_ast::Log::default();
    // SAFETY: the per-thread VM outlives this synchronous call, and `log` is
    // declared before the guard so it is still alive when the guard restores
    // the resolver's previous log on drop.
    let _restore_log = unsafe {
        bun_resolver::Resolver::scoped_log(
            core::ptr::addr_of_mut!((*global.bun_vm_ptr()).transpiler.resolver),
            NonNull::from(&mut log),
        )
    };

    let resolver = &mut global.bun_vm().as_mut().transpiler.resolver;
    match resolver.find_package_json(source_dir, specifier) {
        Ok(Some(package_dir)) => {
            let dir = package_dir.abs_path;
            let separator = match dir.last() {
                Some(&last) if bun_paths::Platform::AUTO.is_separator(last) => "",
                _ => bun_paths::SEP_STR,
            };
            BunString::create_format(format_args!("{}{}package.json", BStr::new(dir), separator))
                .into_js(global)
        }
        Ok(None) => Ok(JSValue::UNDEFINED),
        Err(bun_resolver::Error::ModuleNotFound) => {
            // Node names the package, or the path it looked for.
            let mut path_buf = bun_paths::path_buffer_pool::get();
            let (kind, name) =
                if bun_paths::is_package_path(specifier) {
                    ("package", esm_package_name(specifier))
                } else {
                    let joined = resolve_path::join_abs_string_buf_checked::<
                        bun_paths::platform::Auto,
                    >(source_dir, &mut path_buf, &[specifier]);
                    ("module", joined.unwrap_or(specifier))
                };
            Err(global
                .err(
                    jsc::ErrorCode::ERR_MODULE_NOT_FOUND,
                    format_args!(
                        "Cannot find {} '{}' imported from {}",
                        kind,
                        BStr::new(name),
                        BStr::new(referrer)
                    ),
                )
                .throw())
        }
        Err(err) => Err(global.throw(format_args!(
            "{} while resolving '{}' from '{}'",
            err.name(),
            BStr::new(specifier),
            BStr::new(referrer)
        ))),
    }
}

/// A `specifier` or `base` argument: a path, or a `file:` URL to convert.
enum Location {
    Url(JSValue),
    /// Like Node, any value that is not a `URL` is used as `${value}`.
    Text(BunString),
}

impl Location {
    fn from_js(global: &JSGlobalObject, value: JSValue) -> JsResult<Self> {
        if jsc::DOMURL::cast_(value, global.vm()).is_some() {
            return Ok(Self::Url(value));
        }
        Ok(Self::Text(value.to_bun_string(global)?))
    }

    /// A URL is converted, and rejected, exactly as `Bun.fileURLToPath()` would.
    fn into_path(self, global: &JSGlobalObject) -> JsResult<BunString> {
        let url = match self {
            Self::Url(url) => url,
            Self::Text(text) => {
                if !has_url_scheme(text.to_utf8().slice()) {
                    return Ok(text);
                }
                text.to_js(global)?
            }
        };
        jsc::URL::file_url_to_path_from_js(url, global)
    }
}

/// `file:`, `https://`, `node:` and the like. A scheme must be at least two
/// characters so that a Windows drive letter (`C:\`) is still a path.
fn has_url_scheme(location: &[u8]) -> bool {
    let Some(colon) = strings::index_of_char_usize(location, b':') else {
        return false;
    };
    let scheme = &location[..colon];
    scheme.len() >= 2
        && scheme[0].is_ascii_alphabetic()
        && scheme[1..]
            .iter()
            .all(|&c| c.is_ascii_alphanumeric() || matches!(c, b'+' | b'-' | b'.'))
}

pub fn stat(path: &[u8]) -> i32 {
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
