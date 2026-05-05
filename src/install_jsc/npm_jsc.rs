//! JSC host fns extracted from `src/install/npm.zig` so that `install/` has
//! no `JSValue`/`JSGlobalObject`/`CallFrame` references. Each enum keeps a
//! `pub const jsFunction… = @import(...)` alias so call sites and the
//! `$newZigFunction("npm.zig", "…")` codegen path are unchanged.

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

// TODO(port): proc-macro — `#[bun_jsc::host_fn]` will wrap these into the
// `JSHostFn` ABI for `JSFunction::create`. Until that lands, the bodies are
// plain `JSHostFnZig`-shaped fns (compile-checked, not yet ABI-wrapped).
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
        operating_system.combine().is_match(npm::OperatingSystem::CURRENT),
    ))
}

pub fn libc_is_match(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    use bun_install::npm;
    let args = frame.arguments_old::<1>();
    let mut libc = npm::Libc::NONE.negatable();
    // PORT NOTE: Zig source omits `try` on arrayIterator/next/toSlice here (unlike the
    // sibling fns above/below). Added `?` for type consistency; verify in Phase B.
    // TODO(port): confirm Zig source intent for missing `try` in libcIsMatch
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
    Ok(JSValue::js_boolean(libc.combine().is_match(npm::Libc::CURRENT)))
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

/// Formerly `npm.PackageManifest.bindings` — testing-only (`internal-for-testing.ts`).
pub struct ManifestBindings;

impl ManifestBindings {
    pub fn generate(_global: &JSGlobalObject) -> JSValue {
        // TODO(b2-blocked): bun_jsc::host_fn (proc-macro) — `JSFunction::create`
        // takes a raw-ABI `JSHostFn`, which the proc-macro produces from a
        // `JSHostFnZig`-shaped fn. Until that lands, `Self::js_parse_manifest`
        // has the wrong fn-pointer type to pass here.
        #[cfg(any())]
        {
            use bun_jsc::JSFunction;
            let obj = JSValue::create_empty_object(_global, 1);
            obj.put(
                _global,
                b"parseManifest",
                JSFunction::create(
                    _global,
                    bun_string::String::static_(b"parseManifest"),
                    Self::js_parse_manifest,
                    2,
                    Default::default(),
                ),
            );
            return obj;
        }
        #[cfg(not(any()))]
        todo!("npm_jsc::ManifestBindings::generate — gated on bun_jsc::host_fn proc-macro")
    }

    // TODO(b2-blocked): bun_install::npm::PackageManifest (fields: name(), versions, string_buf)
    // TODO(b2-blocked): bun_sys::Fd::cwd
    // TODO(b2-blocked): bun_jsc::StringJsc::to_js_by_parse_json
    #[cfg(any())]
    pub fn js_parse_manifest(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        use std::io::Write as _;
        use bstr::BStr;
        use bun_jsc::JsError;
        use bun_string::{strings, String as BunString, ZigString};
        use bun_install::npm;

        let args = frame.arguments_old::<2>();
        let args = args.slice();
        if args.len() < 2 || !args[0].is_string() || !args[1].is_string() {
            return Err(global.throw(format_args!(
                "expected manifest filename and registry string arguments"
            )));
        }

        let manifest_filename_str = args[0].to_bun_string(global)?;
        let manifest_filename = manifest_filename_str.to_utf8();

        let registry_str = args[1].to_bun_string(global)?;
        let registry = registry_str.to_utf8();

        // TODO(port): Zig used `std.fs.cwd().openFile`; replaced with bun_sys per
        // §Allocators/FFI rules (std::fs banned). Verify exact bun_sys API in Phase B.
        let manifest_file = match bun_sys::File::open_at(bun_sys::Fd::cwd(), manifest_filename.slice()) {
            Ok(f) => f,
            Err(err) => {
                return global.throw(format_args!(
                    "failed to open manifest file \"{}\": {}",
                    BStr::new(manifest_filename.slice()),
                    err.name(),
                ));
            }
        };

        // TODO(port): npm::registry::Scope / inline URL struct — field types borrow from
        // `registry` slice; Phase B must reconcile lifetimes with the actual struct defs.
        let scope = npm::registry::Scope {
            url_hash: npm::registry::Scope::hash(strings::without_trailing_slash(registry.slice())),
            url: npm::registry::Url {
                host: strings::without_trailing_slash(strings::without_prefix(
                    registry.slice(),
                    b"http://",
                )),
                hostname: strings::without_trailing_slash(strings::without_prefix(
                    registry.slice(),
                    b"http://",
                )),
                href: registry.slice(),
                origin: strings::without_trailing_slash(registry.slice()),
                protocol: if let Some(colon) = strings::index_of_char(registry.slice(), b':') {
                    &registry.slice()[..colon as usize]
                } else {
                    b""
                },
                ..Default::default()
            },
            ..Default::default()
        };

        // TODO(port): verify module path for PackageManifest::Serializer in bun_install
        let maybe_package_manifest = match npm::package_manifest::Serializer::load_by_file(
            &scope,
            // PORT NOTE: Zig wrapped std.fs.File via `bun.sys.File.from(...)`; we already
            // opened a bun_sys::File above, so pass directly.
            manifest_file,
        ) {
            Ok(m) => m,
            Err(err) => {
                return global.throw(format_args!("failed to load manifest file: {}", err.name()));
            }
        };

        let package_manifest: npm::PackageManifest = match maybe_package_manifest {
            Some(m) => m,
            None => {
                return global.throw(format_args!("manifest is invalid "));
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
                    version.fmt(package_manifest.string_buf),
                )
                .map_err(|_| JsError::OutOfMemory)?;
            } else {
                write!(
                    &mut buf,
                    "\"{}\",",
                    version.fmt(package_manifest.string_buf),
                )
                .map_err(|_| JsError::OutOfMemory)?;
            }
        }

        let result = BunString::borrow_utf8(&buf);
        result.to_js_by_parse_json(global)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install_jsc/npm_jsc.zig (125 lines)
//   confidence: medium
//   todos:      4
//   notes:      Scope/URL struct literal borrows from local slice; bun_sys file-open API and PackageManifest::Serializer path need Phase-B verification; libcIsMatch Zig source missing `try`.
// ──────────────────────────────────────────────────────────────────────────
