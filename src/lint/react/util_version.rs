//! `lib/util/version.js` of eslint-plugin-react.
//!
//! `semver.coerce` never returns a prerelease, so `testReactVersion(context, range)` is a tuple comparison:
//!
//! | upstream | here, with `let version = get_react_version_from_context(file);` |
//! |---|---|
//! | `">= 16.3.0"`, `">= 18"` | `version >= (16, 3, 0)`, `version >= (18, 0, 0)` |
//! | `"< 18.3.0"` | `version < (18, 3, 0)` |
//! | `"^15.7.0"` | `((15, 7, 0)..(16, 0, 0)).contains(&version)` |
//! | `"^0.14.10"` | `((0, 14, 10)..(0, 15, 0)).contains(&version)` |
//! | `"999.999.999"` | `version == ULTIMATE_LATEST_SEMVER` |
//!
//! Upstream caches the detected version, and a default that it couldn't read, for the whole
//! process, so the first file decides for all of them. Here each file is resolved independently.
//! Upstream's console warnings aren't printed.

use bun_core::strings;
use bun_lint::prelude::*;

/// Major, minor, patch.
pub(crate) type Version = (u64, u64, u64);

pub(crate) const ULTIMATE_LATEST_SEMVER: Version = (999, 999, 999);

fn convert_conf_ver_to_semver(conf_ver: &[u8]) -> Option<Version> {
    let numbers = strings::split(conf_ver, b".").map(bun_core::fmt::js_string_to_number);
    let numbers: Vec<Vec<u8>> = numbers.map(text::number_to_string).collect();
    let version = bun_semver::Version::coerce(&numbers.join(&b"."[..]))?;
    Some((version.major, version.minor, version.patch))
}

/// `String(value)`
pub(crate) fn string_of(value: &Json) -> Vec<u8> {
    match value {
        Json::Null => b"null".to_vec(),
        Json::Bool(it) => it.to_string().into_bytes(),
        Json::Number(it) => text::number_to_string(*it),
        Json::String(it) => it.clone(),
        // In an array, `null` becomes an empty string.
        Json::Array(all) => {
            let parts = all.iter().map(|it| match it {
                Json::Null => Vec::new(),
                it => string_of(it),
            });
            parts.collect::<Vec<_>>().join(&b","[..])
        }
        Json::Object(_) => b"[object Object]".to_vec(),
    }
}

/// `String(value)`, if `value` is truthy and isn't an object. An object is never a version.
fn truthy_text(value: &Json) -> Option<Vec<u8>> {
    match value {
        Json::Array(_) => Some(string_of(value)),
        Json::String(it) if !it.is_empty() => Some(it.clone()),
        Json::Number(it) if *it != 0.0 && !it.is_nan() => Some(text::number_to_string(*it)),
        Json::Bool(true) => Some(b"true".to_vec()),
        _ => None,
    }
}

fn name_in(package_json: &Json) -> Option<&[u8]> {
    package_json.get(b"name").and_then(Json::as_str)
}

/// `detectReactVersion` and `detectFlowVersion`: the version of `package` that's installed for
/// `file`.
fn detect_version<'a>(file: &'a File<'a>, package: &[u8]) -> Option<&'a [u8]> {
    let modules = file.modules()?;
    let mut directory = file.path();
    loop {
        let slash = strings::last_index_of_char(directory, b'/');
        let end = slash.max(strings::last_index_of_char(directory, b'\\'))?;
        directory = directory.get(..end)?;
        // This finds the closest `package.json`, which is the project's own if the package isn't installed.
        let path = [directory, b"/node_modules/", package, b"/package.json"].concat();
        // `"react": "npm:@preact/compat"` installs a package with a different name there.
        let project = || modules.package_json(&[directory, b"/package.json"].concat());
        if let Some(found) = modules.package_json(&path)
            && (name_in(found) == Some(package) || name_in(found) != project().and_then(name_in))
        {
            return found.get(b"version")?.as_str();
        }
    }
}

/// `String(settings.react[key])`, if it's truthy.
fn setting(file: &File, key: &[u8]) -> Option<Vec<u8>> {
    let value = file.settings().get(b"react")?.get(key)?;
    truthy_text(value)
}

/// `defaultVersion`, as `readDefaultReactVersionFromContext` sets it.
fn default_version(file: &File) -> Version {
    let configured = setting(file, b"defaultVersion");
    (configured.and_then(|it| convert_conf_ver_to_semver(&it))).unwrap_or(ULTIMATE_LATEST_SEMVER)
}

pub(crate) fn get_react_version_from_context<'a>(file: &'a File<'a>) -> Version {
    let version = match setting(file, b"version") {
        Some(version) if version == b"detect" => detect_version(file, b"react").map(<[u8]>::to_vec),
        version => version,
    };
    let version = version.and_then(|it| convert_conf_ver_to_semver(&it));
    version.unwrap_or_else(|| default_version(file))
}

/// `getFlowVersionFromContext`. `None` if there's no `settings.react.flowVersion`, where upstream
/// throws.
pub(crate) fn get_flow_version_from_context<'a>(file: &'a File<'a>) -> Option<Version> {
    let version = match setting(file, b"flowVersion")? {
        version if version == b"detect" => match detect_version(file, b"flow-bin") {
            Some(detected) => detected.to_vec(),
            None => return Some(ULTIMATE_LATEST_SEMVER),
        },
        version => version,
    };
    Some(convert_conf_ver_to_semver(&version).unwrap_or_else(|| default_version(file)))
}
