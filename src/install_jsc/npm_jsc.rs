//! JSC host fns for `bun_install::npm`, kept here so that `install/` has
//! no `JSValue`/`JSGlobalObject` references.

use bun_core::Utf8Bytes;
use bun_jsc::bindgen::{self, JsHeap};

use crate::generated_bindgen::npm_jsc::PackageManifest;

pub(crate) fn operating_system_is_match(names: Vec<Utf8Bytes<'static>>) -> bool {
    use bun_install::npm;
    let mut operating_system = npm::OperatingSystem::NONE.negatable();
    for name in names {
        operating_system.apply(name.slice());
    }
    operating_system
        .combine()
        .is_match(npm::OperatingSystem::CURRENT)
}

pub(crate) fn architecture_is_match(names: Vec<Utf8Bytes<'static>>) -> bool {
    use bun_install::npm;
    let mut architecture = npm::Architecture::NONE.negatable();
    for name in names {
        architecture.apply(name.slice());
    }
    architecture.combine().is_match(npm::Architecture::CURRENT)
}

pub(crate) fn parse_manifest<'a>(
    heap: &JsHeap<'a>,
    manifest_filename: &[u8],
    registry: &[u8],
) -> bindgen::Result<'a, PackageManifest> {
    use bstr::BStr;
    use bun_install::npm;

    let manifest_file =
        match bun_sys::openat_a(bun_sys::Fd::cwd(), manifest_filename, bun_sys::O::RDONLY, 0) {
            Ok(fd) => bun_sys::File::from_fd(fd),
            Err(err) => {
                return Err(heap.error(format_args!(
                    "failed to open manifest file \"{}\": {}",
                    BStr::new(manifest_filename),
                    BStr::new(err.name()),
                )));
            }
        };

    let mut scope = npm::registry::Scope::default();
    scope.set_url(Box::from(registry));

    let maybe_package_manifest =
        match npm::package_manifest::Serializer::load_by_file(&scope, &manifest_file) {
            Ok(m) => m,
            Err(err) => {
                return Err(heap.error(format_args!(
                    "failed to load manifest file: {}",
                    BStr::new(err.name())
                )));
            }
        };

    let package_manifest: npm::PackageManifest = match maybe_package_manifest {
        Some(m) => m,
        None => {
            return Err(heap.error(format_args!("manifest is invalid ")));
        }
    };

    // TODO: we can add more information. for now just versions is fine
    Ok(PackageManifest {
        name: package_manifest.name().to_vec(),
        versions: package_manifest
            .versions
            .iter()
            .map(|version| {
                version
                    .fmt(&package_manifest.string_buf)
                    .to_string()
                    .into_bytes()
            })
            .collect(),
    })
}
