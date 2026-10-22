//! JSC host fns for `bun_install::npm`, kept here so that `install/` has
//! no `JSValue`/`JSGlobalObject` references.

use bun_core::String as BunString;
use bun_jsc::bindgen::{JsHeap, JsLocal, JsScope};
use bun_jsc::{JSValue, JsResult, StringJsc as _};

pub(crate) fn operating_system_is_match<'a>(
    cx: &mut JsScope<'a>,
    names: JsLocal<'a>,
) -> JsResult<bool> {
    use bun_install::npm;
    let global = cx.global();
    let mut operating_system = npm::OperatingSystem::NONE.negatable();
    let mut iter = names.to_js().array_iterator(global)?;
    while let Some(item) = iter.next()? {
        let slice = item.to_utf8(global)?;
        operating_system.apply(slice.slice());
    }
    Ok(operating_system
        .combine()
        .is_match(npm::OperatingSystem::CURRENT))
}

pub(crate) fn architecture_is_match<'a>(
    cx: &mut JsScope<'a>,
    names: JsLocal<'a>,
) -> JsResult<bool> {
    use bun_install::npm;
    let global = cx.global();
    let mut architecture = npm::Architecture::NONE.negatable();
    let mut iter = names.to_js().array_iterator(global)?;
    while let Some(item) = iter.next()? {
        let slice = item.to_utf8(global)?;
        architecture.apply(slice.slice());
    }
    Ok(architecture.combine().is_match(npm::Architecture::CURRENT))
}

pub(crate) fn parse_manifest(
    heap: &JsHeap<'_>,
    manifest_filename: &BunString,
    registry: &BunString,
) -> JsResult<JSValue> {
    use bstr::BStr;
    use bun_install::npm;
    use bun_jsc::JsError;
    use std::io::Write as _;

    // SAFETY: `JSON.parse` without a reviver runs no JavaScript, and what throws returns.
    let global = unsafe { heap.global() };
    let manifest_filename = manifest_filename.to_utf8();
    let registry = registry.to_utf8();

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

    let mut scope = npm::registry::Scope::default();
    scope.set_url(Box::from(registry.slice()));

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

    BunString::borrow_utf8(&buf).to_js_by_parse_json(global)
}
