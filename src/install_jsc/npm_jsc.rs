//! JSC host fns for `bun_install::npm`, kept here so that `install/` has
//! no `JSValue`/`JSGlobalObject`/`CallFrame` references.

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

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
        let obj = JSValue::create_empty_object(global, 2);
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
        obj.put(
            global,
            b"benchManifestParse",
            JSFunction::create(
                global,
                bun_core::String::static_(b"benchManifestParse"),
                __jsc_host_js_bench_manifest_parse,
                3,
                Default::default(),
            ),
        );
        obj
    }
}

/// Time the real `PackageManifest::parse()` on raw packument JSON bytes.
/// Args: (jsonString, packageName, iters). Returns timing breakdown from
/// `npm::PARSE_TIMING` (json/count/build/total) averaged over `iters`.
#[bun_jsc::host_fn]
pub(crate) fn js_bench_manifest_parse(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    use bun_install::npm;

    let json_str = frame.argument(0).to_slice(global)?;
    let name_str = frame.argument(1).to_slice(global)?;
    let iters = frame.argument(2).coerce_to_i32(global)?.max(1) as u32;

    let json = json_str.slice();
    let name = name_str.slice();

    let scope = npm::registry::Scope {
        url_hash: *npm::registry::DEFAULT_URL_HASH,
        url: bun_url::OwnedURL::from_href(Box::from(b"https://registry.npmjs.org/".as_slice())),
        ..Default::default()
    };

    type ParseFn = fn(
        &npm::registry::Scope,
        &mut bun_ast::Log,
        &[u8],
        &[u8],
        &[u8],
        &[u8],
        u32,
        bool,
    ) -> Result<Option<npm::PackageManifest>, bun_core::Error>;

    let run = |which: ParseFn| -> JsResult<(npm::ParseTiming, usize, u64)> {
        // Warmup.
        for _ in 0..2 {
            let mut log = bun_ast::Log::init();
            let _ = which(&scope, &mut log, json, name, b"", b"", 0, false);
        }
        let mut sum = npm::ParseTiming::default();
        let mut versions = 0usize;
        let mut string_buf_hash = 0u64;
        for _ in 0..iters {
            let mut log = bun_ast::Log::init();
            match which(&scope, &mut log, json, name, b"", b"", 0, false) {
                Ok(Some(m)) => {
                    versions = m.versions.len();
                    string_buf_hash =
                        npm::registry::Scope::hash(&m.string_buf);
                }
                Ok(None) => {
                    return Err(
                        global.throw(format_args!("PackageManifest::parse returned None"))
                    );
                }
                Err(e) => {
                    return Err(global.throw(format_args!(
                        "PackageManifest::parse failed: {}",
                        bstr::BStr::new(e.name().as_bytes())
                    )));
                }
            }
            let t = npm::PARSE_TIMING.with(|c| c.get());
            sum.json_ns += t.json_ns;
            sum.count_ns += t.count_ns;
            sum.build_ns += t.build_ns;
            sum.total_ns += t.total_ns;
        }
        Ok((sum, versions, string_buf_hash))
    };

    let (sum_expr, ver_expr, hash_expr) = run(npm::PackageManifest::parse)?;
    let (sum_cur, ver_cur, hash_cur) = run(npm::PackageManifest::parse_cursor)?;

    let obj = JSValue::create_empty_object(global, 12);
    let f = |n: u64| JSValue::js_number(n as f64 / iters as f64);
    obj.put(global, b"exprJsonNs", f(sum_expr.json_ns));
    obj.put(global, b"exprCountNs", f(sum_expr.count_ns));
    obj.put(global, b"exprBuildNs", f(sum_expr.build_ns));
    obj.put(global, b"exprTotalNs", f(sum_expr.total_ns));
    obj.put(global, b"curJsonNs", f(sum_cur.json_ns));
    obj.put(global, b"curCountNs", f(sum_cur.count_ns));
    obj.put(global, b"curBuildNs", f(sum_cur.build_ns));
    obj.put(global, b"curTotalNs", f(sum_cur.total_ns));
    obj.put(global, b"versionsExpr", JSValue::js_number(ver_expr as f64));
    obj.put(global, b"versionsCur", JSValue::js_number(ver_cur as f64));
    obj.put(
        global,
        b"outputsMatch",
        JSValue::js_boolean(ver_expr == ver_cur && hash_expr == hash_cur),
    );
    obj.put(global, b"bytes", JSValue::js_number(json.len() as f64));
    Ok(obj)
}

// Lives at module scope (not `impl ManifestBindings`) because the
// `#[bun_jsc::host_fn]` Free-kind shim body emits `#fn_name(__g, __f)` without
// a `Self::` qualifier, so the wrapped fn must resolve unqualified.
#[bun_jsc::host_fn]
pub(crate) fn js_parse_manifest(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
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

    // The `Scope.url` field
    // is `OwnedURL`, which stores only the href buffer and re-derives components
    // via `URL::parse` on demand. `load_by_file`/`read_all` only consult
    // `scope.url_hash` and `scope.url.href().len()`, so copying the raw href is
    // sufficient and drops the unsafe lifetime-extension hack the earlier draft
    // needed.
    let scope = npm::registry::Scope {
        url_hash: npm::registry::Scope::hash(strings::without_trailing_slash(registry.slice())),
        url: bun_url::OwnedURL::from_href(Box::from(registry.slice())),
        ..Default::default()
    };

    let maybe_package_manifest =
        match npm::package_manifest::Serializer::load_by_file(&scope, &manifest_file) {
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
