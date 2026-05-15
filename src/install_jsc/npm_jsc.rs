//! JSC host fns extracted from `bun_install::npm` so that `install/` has
//! no `JSValue`/`JSGlobalObject`/`CallFrame` references. Bound to JS via the
//! `$newRustFunction("npm.rs", "…")` codegen path.

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

// TODO(port): proc-macro — `#[bun_jsc::host_fn]` will wrap these into the
// `JSHostFn` ABI for `JSFunction::create`. Until that lands, the bodies are
// plain `(global, callframe) -> JsResult<JSValue>` host fns (compile-checked,
// not yet ABI-wrapped).
pub fn operating_system_is_match(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    use bun_install::npm;
    let args = frame.arguments_old::<1>();
    let mut operating_system = npm::OperatingSystem::NONE.negatable();
    let mut iter = args.ptr[0].array_iterator(global)?;
    while let Some(item) = iter.next()? {
        let slice = item.to_slice(global)?;
        operating_system.apply(slice.slice());
        if global.has_exception() {
            return Ok(JSValue::ZERO);
        }
    }
    if global.has_exception() {
        return Ok(JSValue::ZERO);
    }
    Ok(JSValue::js_boolean(
        operating_system
            .combine()
            .is_match(npm::OperatingSystem::CURRENT),
    ))
}

pub fn libc_is_match(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    use bun_install::npm;
    let args = frame.arguments_old::<1>();
    let mut libc = npm::Libc::NONE.negatable();
    // PORT NOTE: the original omitted error propagation on
    // arrayIterator/next/toSlice here (unlike the sibling fns above/below).
    // Added `?` for type consistency; verify in Phase B.
    // TODO(port): confirm intent for missing error propagation in libcIsMatch
    let mut iter = args.ptr[0].array_iterator(global)?;
    while let Some(item) = iter.next()? {
        let slice = item.to_slice(global)?;
        libc.apply(slice.slice());
        if global.has_exception() {
            return Ok(JSValue::ZERO);
        }
    }
    if global.has_exception() {
        return Ok(JSValue::ZERO);
    }
    Ok(JSValue::js_boolean(
        libc.combine().is_match(npm::Libc::CURRENT),
    ))
}

pub fn architecture_is_match(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    use bun_install::npm;
    let args = frame.arguments_old::<1>();
    let mut architecture = npm::Architecture::NONE.negatable();
    let mut iter = args.ptr[0].array_iterator(global)?;
    while let Some(item) = iter.next()? {
        let slice = item.to_slice(global)?;
        architecture.apply(slice.slice());
        if global.has_exception() {
            return Ok(JSValue::ZERO);
        }
    }
    if global.has_exception() {
        return Ok(JSValue::ZERO);
    }
    Ok(JSValue::js_boolean(
        architecture.combine().is_match(npm::Architecture::CURRENT),
    ))
}

/// Free-fn alias of [`ManifestBindings::generate`] so `bun_runtime::dispatch::js2native`
/// can `pub use` it (associated fns aren't importable items).
#[inline]
pub fn package_manifest_bindings_generate(global: &JSGlobalObject) -> JSValue {
    ManifestBindings::generate(global)
}

/// Formerly `npm.PackageManifest.bindings` — testing-only (`internal-for-testing.ts`).
pub struct ManifestBindings;

impl ManifestBindings {
    pub fn generate(global: &JSGlobalObject) -> JSValue {
        use bun_jsc::JSFunction;
        let obj = JSValue::create_empty_object(global, 1);
        obj.put(
            global,
            b"parseManifest",
            JSFunction::create(
                global,
                bun_core::String::static_(b"parseManifest"),
                // `#[bun_jsc::host_fn]` on the module-scope `js_parse_manifest`
                // emits this `JSHostFn`-ABI shim.
                __jsc_host_js_parse_manifest,
                2,
                Default::default(),
            ),
        );
        obj
    }
}

// PORT NOTE: lives at module scope (not `impl ManifestBindings`) because the
// `#[bun_jsc::host_fn]` Free-kind shim body emits `#fn_name(__g, __f)` without
// a `Self::` qualifier, so the wrapped fn must resolve unqualified.
#[bun_jsc::host_fn]
pub fn js_parse_manifest(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    use bstr::BStr;
    use bun_core::{String as BunString, strings};
    use bun_install::npm;
    use bun_jsc::JsError;
    use std::io::Write as _;

    let args = frame.arguments_old::<2>();
    let args = args.slice();
    if args.len() < 2 || !args[0].is_string() || !args[1].is_string() {
        return Err(global.throw(format_args!(
            "expected manifest filename and registry string arguments"
        )));
    }

    // `defer manifest_filename_str.deref()` — release the +1 WTFStringImpl ref
    // returned by `toBunString`; `bun_core::String` has no `Drop` impl.
    let manifest_filename_str = scopeguard::guard(args[0].to_bun_string(global)?, |s| s.deref());
    let manifest_filename = manifest_filename_str.to_utf8();

    // `defer registry_str.deref()` — see above.
    let registry_str = scopeguard::guard(args[1].to_bun_string(global)?, |s| s.deref());
    let registry = registry_str.to_utf8();

    // PORT NOTE: PORTING.md bans std::fs, so go through bun_sys (read-only open).
    let manifest_file = match bun_sys::openat_a(
        bun_sys::Fd::cwd(),
        manifest_filename.slice(),
        bun_sys::O::RDONLY,
        0,
    ) {
        Ok(fd) => bun_sys::File::from_fd(fd),
        Err(err) => {
            return Err(global.throw(format_args!(
                "failed to open manifest file \"{}\": {}",
                BStr::new(manifest_filename.slice()),
                BStr::new(err.name()),
            )));
        }
    };
    // `defer manifest_file.close()` — closed at fn return.
    let _close_manifest = bun_sys::CloseOnDrop::file(&manifest_file);

    // PORT NOTE: the original built a borrowing URL struct literal
    // (host/hostname/href/origin/protocol all slicing `registry`). The Rust
    // `Scope.url` field is `OwnedURL`, which stores only the href buffer and
    // re-derives components via `URL::parse` on demand. `load_by_file`/`read_all`
    // only consult `scope.url_hash` and `scope.url.href().len()`, so copying the
    // raw href is sufficient and drops the unsafe lifetime-extension hack the
    // earlier draft needed.
    let scope = npm::registry::Scope {
        url_hash: npm::registry::Scope::hash(strings::without_trailing_slash(registry.slice())),
        url: bun_url::OwnedURL::from_href(Box::from(registry.slice())),
        ..Default::default()
    };

    let maybe_package_manifest = match npm::package_manifest::Serializer::load_by_file(
        &scope,
        // We already opened a `bun_sys::File` above, so pass directly.
        &manifest_file,
    ) {
        Ok(m) => m,
        Err(err) => {
            return Err(global.throw(format_args!(
                "failed to load manifest file: {}",
                BStr::new(err.name())
            )));
        }
    };

    let package_manifest: npm::PackageManifest = match maybe_package_manifest {
        Some(m) => m,
        None => {
            return Err(global.throw(format_args!("manifest is invalid ")));
        }
    };

    let mut buf: Vec<u8> = Vec::new();

    // TODO: we can add more information. for now just versions is fine

    write!(
        &mut buf,
        "{{\"name\":\"{}\",\"versions\":[",
        BStr::new(package_manifest.name()),
    )
    .map_err(|_| JsError::OutOfMemory)?;

    for (i, version) in package_manifest.versions.iter().enumerate() {
        if i == package_manifest.versions.len() - 1 {
            write!(
                &mut buf,
                "\"{}\"]}}",
                version.fmt(&package_manifest.string_buf),
            )
            .map_err(|_| JsError::OutOfMemory)?;
        } else {
            write!(
                &mut buf,
                "\"{}\",",
                version.fmt(&package_manifest.string_buf),
            )
            .map_err(|_| JsError::OutOfMemory)?;
        }
    }

    let mut result = BunString::borrow_utf8(&buf);
    bun_jsc::bun_string_jsc::to_js_by_parse_json(&mut result, global)
}
