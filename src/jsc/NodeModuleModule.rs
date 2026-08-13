use crate::resolve_message::esm_package_name;
use crate::{
    self as jsc, CallFrame, JSArray, JSGlobalObject, JSValue, JsResult, StringJsc, Strong,
    VirtualMachineRef as VirtualMachine,
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
    let specifier = OwnedString::new(frame.argument(0).to_bun_string(global)?);
    let base_value = frame.argument(1);
    let base = if base_value.is_undefined() {
        None
    } else if base_value.is_string() || jsc::DOMURL::cast_(base_value, global.vm()).is_some() {
        Some(OwnedString::new(base_value.to_bun_string(global)?))
    } else {
        return Err(global.throw_invalid_argument_type_value("base", "string", base_value));
    };

    let specifier = location_to_path(global, specifier.get())?;
    let specifier_utf8 = specifier.get().to_utf8();
    let specifier = specifier_utf8.slice();
    let base = base
        .map(|base| location_to_path(global, base.get()))
        .transpose()?;
    let base_utf8 = base.as_ref().map(|base| base.get().to_utf8());

    let top_level_dir = global.bun_vm().top_level_dir();
    let mut base_buf = bun_paths::path_buffer_pool::get();
    // `base` is the calling module (`__filename` / `import.meta.url`), so
    // resolution starts in its directory; without one it starts in the cwd.
    let (source_dir, referrer): (&[u8], &[u8]) = match &base_utf8 {
        Some(base) => {
            let joined = resolve_path::join_abs_string_buf_checked::<bun_paths::platform::Auto>(
                top_level_dir,
                &mut base_buf,
                &[base.slice()],
            );
            // `None`: longer than any path the OS accepts.
            let Some(base) = joined else {
                return Err(global.throw_invalid_argument_value(b"base", base_value));
            };
            (bun_paths::dirname(base).unwrap_or(base), base)
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
        Ok(Some(package_json)) => {
            jsc::bun_string_jsc::create_utf8_for_js(global, package_json.source.path.text)
        }
        Ok(None) => Ok(JSValue::UNDEFINED),
        Err(bun_resolver::Error::ModuleNotFound) => {
            let (kind, name) = if bun_paths::is_package_path(specifier) {
                ("package", esm_package_name(specifier))
            } else {
                ("module", specifier)
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

/// Both arguments accept either a path or a `file:` URL (`import.meta.url`,
/// `import.meta.resolve()`, or a `URL`, which arrives here as its href). A URL
/// of any other scheme is rejected the way `fileURLToPath()` rejects it.
fn location_to_path(global: &JSGlobalObject, location: BunString) -> JsResult<OwnedString> {
    let location_utf8 = location.to_utf8();
    let Some(scheme) = url_scheme(location_utf8.slice()) else {
        return Ok(OwnedString::new(location.dupe_ref()));
    };
    if !scheme.eq_ignore_ascii_case(b"file") {
        return Err(global
            .err(
                jsc::ErrorCode::INVALID_URL_SCHEME,
                format_args!("The URL must be of scheme file"),
            )
            .throw());
    }
    let path = OwnedString::new(jsc::URL::path_from_file_url(location));
    if path.get().is_dead() {
        return Err(global
            .err(
                jsc::ErrorCode::INVALID_URL,
                format_args!("Invalid URL: {}", location),
            )
            .throw());
    }
    Ok(path)
}

/// The `https` of `https://`, the `node` of `node:fs`; `None` for a path. A
/// scheme must be at least two characters so that a Windows drive letter
/// (`C:\`) is still a path.
fn url_scheme(location: &[u8]) -> Option<&[u8]> {
    let scheme = &location[..strings::index_of_char_usize(location, b':')?];
    let is_scheme = scheme.len() >= 2
        && scheme[0].is_ascii_alphabetic()
        && scheme[1..]
            .iter()
            .all(|&c| c.is_ascii_alphanumeric() || matches!(c, b'+' | b'-' | b'.'));
    is_scheme.then_some(scheme)
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
// WriteBarriers in C++ but the hash map for extensions is in Rust for flexibility.
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
