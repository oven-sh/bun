use super::manifest::{ExportsEntry, ExportsMap};
use super::*;
use bun_paths::MAX_PATH_BYTES;
use bun_paths::resolve_path::join_string_buf;

const PACKAGE_URL: &[u8] = b"/";
const SEPARATORS: &[u8] = b"/\\";
const ENCODED_SLASHES: [&[u8]; 4] = [b"%2f", b"%2F", b"%5c", b"%5C"];
const JOIN_HEADROOM: usize = 8;
// `bun run` copies a subpath into a buffer of this size. A longer one becomes the empty subpath, which no key matches.
const SUBPATH_CAPACITY: usize = 512;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum ExportsStatus {
    Undefined,
    UndefinedNoConditionsMatch,
    Null,
    Exact,
    ExactEndsWithStar,
    Inexact,
    InvalidModuleSpecifier,
    InvalidPackageConfiguration,
    InvalidPackageTarget,
    PackagePathNotExported,
    UnsupportedDirectoryImport,
    PackagePathDisabled,
    PackageImportNotDefined,
    PackageResolve,
}

impl ExportsStatus {
    fn is_undefined(self) -> bool {
        matches!(self, Self::Undefined | Self::UndefinedNoConditionsMatch)
    }

    fn is_nullish(self) -> bool {
        matches!(self, Self::Undefined | Self::Null)
    }

    fn is_resolved(self) -> bool {
        matches!(self, Self::Exact | Self::ExactEndsWithStar | Self::Inexact)
    }

    pub(super) fn failure(self) -> CodeFailure {
        match self {
            Self::InvalidModuleSpecifier => CodeFailure::InvalidModuleSpecifier,
            Self::InvalidPackageConfiguration => CodeFailure::InvalidPackageConfiguration,
            Self::InvalidPackageTarget => CodeFailure::InvalidPackageTarget,
            Self::UnsupportedDirectoryImport => CodeFailure::UnsupportedDirectoryImport,
            Self::PackageImportNotDefined => CodeFailure::PackageImportNotDefined,
            Self::Exact | Self::ExactEndsWithStar | Self::Inexact | Self::PackageResolve => {
                CodeFailure::ModuleNotFound
            }
            _ => CodeFailure::PackagePathNotExported,
        }
    }
}

#[derive(Clone, Debug)]
pub(super) struct TargetResolution {
    pub status: ExportsStatus,
    pub path: Vec<u8>,
}

impl From<ExportsStatus> for TargetResolution {
    fn from(status: ExportsStatus) -> TargetResolution {
        let path = Vec::new();
        TargetResolution { status, path }
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum KeyKind {
    Exact,
    Directory,
    Pattern,
}

impl KeyKind {
    fn resolved_status(self) -> ExportsStatus {
        match self {
            KeyKind::Exact => ExportsStatus::Exact,
            KeyKind::Directory => ExportsStatus::Inexact,
            KeyKind::Pattern => ExportsStatus::ExactEndsWithStar,
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Field {
    Exports,
    Imports,
}

struct TargetQuery<'a> {
    subpath: &'a [u8],
    key: KeyKind,
    field: Field,
    matches: &'a dyn Fn(&[u8]) -> bool,
}

pub(super) fn resolve_exports(
    exports: &ExportsEntry<'_>,
    subpath: &[u8],
    matches: &dyn Fn(&[u8]) -> bool,
) -> TargetResolution {
    finalize(resolve_exports_subpath(exports, subpath, matches))
}

pub(super) fn resolve_imports(
    imports: &ExportsEntry<'_>,
    specifier: &[u8],
    matches: &dyn Fn(&[u8]) -> bool,
) -> TargetResolution {
    let ExportsEntry::Map(map) = *imports else {
        return ExportsStatus::InvalidPackageConfiguration.into();
    };
    let resolution = resolve_table(specifier, map, Field::Imports, matches);
    if resolution.status.is_nullish() {
        return ExportsStatus::PackageImportNotDefined.into();
    }
    finalize(resolution)
}

fn resolve_exports_subpath(
    exports: &ExportsEntry<'_>,
    subpath: &[u8],
    matches: &dyn Fn(&[u8]) -> bool,
) -> TargetResolution {
    if matches!(exports, ExportsEntry::Invalid) {
        return ExportsStatus::InvalidPackageConfiguration.into();
    }
    if subpath == b"." {
        if let Some(main) = main_export(exports) {
            let query = TargetQuery {
                subpath: b"",
                key: KeyKind::Exact,
                field: Field::Exports,
                matches,
            };
            let resolution = resolve_target(main, &query);
            if !resolution.status.is_nullish() {
                return resolution;
            }
        }
    } else if let ExportsEntry::Map(map) = *exports
        && keys_start_with_dot(map)
    {
        let resolution = resolve_table(subpath, map, Field::Exports, matches);
        if resolution.status == ExportsStatus::Null {
            return ExportsStatus::PackagePathDisabled.into();
        }
        if resolution.status != ExportsStatus::Undefined {
            return resolution;
        }
    }
    ExportsStatus::PackagePathNotExported.into()
}

fn main_export<'e, 'h>(exports: &'e ExportsEntry<'h>) -> Option<&'e ExportsEntry<'h>> {
    match *exports {
        ExportsEntry::Target(_) | ExportsEntry::Array(_) => Some(exports),
        ExportsEntry::Map(map) if keys_start_with_dot(map) => value_for_key(map, b"."),
        ExportsEntry::Map(_) => Some(exports),
        ExportsEntry::Null | ExportsEntry::Invalid => None,
    }
}

fn keys_start_with_dot(map: &ExportsMap<'_>) -> bool {
    let first = map.entries.first();
    first.is_some_and(|entry| entry.0.starts_with(b"."))
}

fn value_for_key<'h>(map: &ExportsMap<'h>, key: &[u8]) -> Option<&'h ExportsEntry<'h>> {
    let entry = map.entries.iter().find(|entry| entry.0 == key)?;
    Some(&entry.1)
}

fn resolve_table(
    match_key: &[u8],
    map: &ExportsMap<'_>,
    field: Field,
    matches: &dyn Fn(&[u8]) -> bool,
) -> TargetResolution {
    let Some((target, key, subpath)) = find_table_entry(match_key, map) else {
        return ExportsStatus::Null.into();
    };
    let query = TargetQuery {
        subpath,
        key,
        field,
        matches,
    };
    resolve_target(target, &query)
}

fn find_table_entry<'h, 'k>(
    match_key: &'k [u8],
    map: &ExportsMap<'h>,
) -> Option<(&'h ExportsEntry<'h>, KeyKind, &'k [u8])> {
    if !match_key.ends_with(b"/")
        && !strings::contains_char(match_key, b'*')
        && let Some(target) = value_for_key(map, match_key)
    {
        return Some((target, KeyKind::Exact, b"".as_slice()));
    }
    map.expansion_keys.iter().find_map(|(key, target)| {
        let (kind, subpath) = match_expansion_key(key, match_key)?;
        Some((target, kind, subpath))
    })
}

fn match_expansion_key<'k>(key: &[u8], match_key: &'k [u8]) -> Option<(KeyKind, &'k [u8])> {
    let Some(star) = strings::index_of_char_usize(key, b'*') else {
        return Some((KeyKind::Directory, match_key.strip_prefix(key)?));
    };
    let (base, trailer) = (&key[..star], &key[star + 1..]);
    let subpath = match_key.strip_prefix(base)?.strip_suffix(trailer)?;
    (trailer.is_empty() || !subpath.is_empty()).then_some((KeyKind::Pattern, subpath))
}

fn resolve_target(target: &ExportsEntry<'_>, query: &TargetQuery<'_>) -> TargetResolution {
    if !bun_core::StackCheck::init().is_safe_to_recurse() {
        return ExportsStatus::InvalidPackageConfiguration.into();
    }
    match *target {
        ExportsEntry::Target(text) => resolve_target_text(text, query),
        ExportsEntry::Null => ExportsStatus::Null.into(),
        ExportsEntry::Invalid => ExportsStatus::InvalidPackageTarget.into(),
        ExportsEntry::Map(map) => {
            let matching = map.entries.iter().filter(|entry| (query.matches)(entry.0));
            resolve_first_defined(matching.map(|entry| &entry.1), query)
                .unwrap_or_else(|| ExportsStatus::UndefinedNoConditionsMatch.into())
        }
        ExportsEntry::Array([]) => ExportsStatus::Null.into(),
        // Node continues past an invalid target or `null`. `bun run` stops at either.
        ExportsEntry::Array(elements) => resolve_first_defined(elements.iter(), query)
            .unwrap_or_else(|| ExportsStatus::Undefined.into()),
    }
}

fn resolve_first_defined<'e>(
    targets: impl Iterator<Item = &'e ExportsEntry<'e>>,
    query: &TargetQuery<'_>,
) -> Option<TargetResolution> {
    targets
        .map(|target| resolve_target(target, query))
        .find(|resolution| !resolution.status.is_undefined())
}

fn resolve_target_text(target: &[u8], query: &TargetQuery<'_>) -> TargetResolution {
    let subpath = query.subpath;
    if PACKAGE_URL.len() + target.len() + subpath.len() + JOIN_HEADROOM > MAX_PATH_BYTES {
        return ExportsStatus::InvalidPackageTarget.into();
    }
    if query.key != KeyKind::Pattern && !subpath.is_empty() && !target.ends_with(b"/") {
        return ExportsStatus::InvalidModuleSpecifier.into();
    }
    if has_invalid_subpath_segment(subpath) {
        return ExportsStatus::InvalidModuleSpecifier.into();
    }
    if !target.starts_with(b"./") {
        return resolve_package_target(target, query);
    }
    if has_invalid_segment(target) {
        return ExportsStatus::InvalidPackageTarget.into();
    }
    let resolved = join_posix(&[PACKAGE_URL, target]);
    if has_invalid_segment(&resolved) {
        return ExportsStatus::InvalidModuleSpecifier.into();
    }
    let path = match query.key {
        KeyKind::Exact | KeyKind::Directory => join_posix(&[PACKAGE_URL, target, subpath]),
        KeyKind::Pattern => match substitute_subpath(&resolved, subpath) {
            Some(path) if !has_invalid_segment(&path) => path,
            _ => return ExportsStatus::InvalidModuleSpecifier.into(),
        },
    };
    let status = query.key.resolved_status();
    TargetResolution { status, path }
}

fn resolve_package_target(target: &[u8], query: &TargetQuery<'_>) -> TargetResolution {
    let is_package_name =
        query.field == Field::Imports && !target.starts_with(b"../") && !target.starts_with(b"/");
    if !is_package_name {
        return ExportsStatus::InvalidPackageTarget.into();
    }
    let path = match query.key {
        KeyKind::Exact | KeyKind::Directory => Some(join_posix(&[target, query.subpath])),
        KeyKind::Pattern => substitute_subpath(target, query.subpath),
    };
    let Some(path) = path else {
        return ExportsStatus::InvalidModuleSpecifier.into();
    };
    let status = ExportsStatus::PackageResolve;
    TargetResolution { status, path }
}

fn substitute_subpath(pattern: &[u8], subpath: &[u8]) -> Option<Vec<u8>> {
    (strings::replacement_size(pattern, b"*", subpath) <= MAX_PATH_BYTES)
        .then(|| strings::replace_owned(pattern, b"*", subpath))
}

fn finalize(mut resolution: TargetResolution) -> TargetResolution {
    if !resolution.status.is_resolved() {
        return resolution;
    }
    if strings::contains_char(&resolution.path, b'%') {
        let Some(decoded) = decode_path(&resolution.path) else {
            return ExportsStatus::InvalidModuleSpecifier.into();
        };
        resolution.path = decoded;
    }
    if matches!(resolution.path.last(), Some(b'/' | b'\\')) {
        return ExportsStatus::UnsupportedDirectoryImport.into();
    }
    resolution
}

fn decode_path(path: &[u8]) -> Option<Vec<u8>> {
    if ENCODED_SLASHES.iter().any(|it| strings::contains(path, it)) {
        return None;
    }
    decode_percent(path)
}

fn has_invalid_segment(path: &[u8]) -> bool {
    match strings::index_of_any(path, SEPARATORS) {
        Some(separator) => has_invalid_subpath_segment(&path[separator + 1..]),
        None => true,
    }
}

fn has_invalid_subpath_segment(path: &[u8]) -> bool {
    strings::split_any(path, SEPARATORS).any(is_invalid_segment)
}

fn is_invalid_segment(segment: &[u8]) -> bool {
    let mut decoded = [0u8; b"node_modules".len()];
    let mut len = 0;
    let mut rest = segment;
    while let [first, after @ ..] = rest {
        if len == decoded.len() {
            return false;
        }
        let escaped = match rest {
            [b'%', high, low, ..] => bun_core::fmt::hex_pair_value(*high, *low),
            _ => None,
        };
        decoded[len] = escaped.unwrap_or(*first).to_ascii_lowercase();
        len += 1;
        rest = if escaped.is_some() { &rest[3..] } else { after };
    }
    matches!(&decoded[..len], b"." | b".." | b"node_modules")
}

fn decode_percent(text: &[u8]) -> Option<Vec<u8>> {
    let mut decoded = Vec::with_capacity(text.len());
    let mut rest = text;
    while let Some(percent) = strings::index_of_char_usize(rest, b'%') {
        let [high, low, after @ ..] = &rest[percent + 1..] else {
            return None;
        };
        decoded.extend_from_slice(&rest[..percent]);
        decoded.push(bun_core::fmt::hex_pair_value(*high, *low)?);
        rest = after;
    }
    decoded.extend_from_slice(rest);
    Some(decoded)
}

fn join_posix(parts: &[&[u8]]) -> Vec<u8> {
    join_string_buf::<Posix>(&mut path_buffer_pool::get()[..], parts).to_vec()
}

#[derive(Clone, Debug)]
pub(super) struct PackageSpecifier<'a> {
    pub name: &'a [u8],
    pub subpath: Vec<u8>,
}

impl<'a> PackageSpecifier<'a> {
    pub(super) fn parse_name(specifier: &[u8]) -> Option<&[u8]> {
        let slash = strings::index_of_char_usize(specifier, b'/');
        if !specifier.starts_with(b"@") {
            return Some(&specifier[..slash.unwrap_or(specifier.len())]);
        }
        let scope_len = slash? + 1;
        let slash = strings::index_of_char_usize(&specifier[scope_len..], b'/');
        let name_len = slash.map_or(specifier.len(), |slash| scope_len + slash);
        Some(&specifier[..name_len])
    }

    pub(super) fn parse(specifier: &'a [u8]) -> Option<PackageSpecifier<'a>> {
        if specifier.is_empty() {
            return None;
        }
        let name = Self::parse_name(specifier)?;
        if name.starts_with(b".") || strings::index_of_any(name, b"\\%").is_some() {
            return None;
        }
        let scope_marker_len = usize::from(name.starts_with(b"@"));
        let Some(at) = strings::index_of_char_usize(&name[scope_marker_len..], b'@') else {
            let subpath = to_subpath(&specifier[name.len()..]);
            return Some(PackageSpecifier { name, subpath });
        };
        let (name, rest) = specifier.split_at(scope_marker_len + at);
        let rest = &rest[1..];
        let version = match strings::index_of_char_usize(rest, b'/') {
            Some(0) | None => rest,
            Some(slash) => &rest[..slash],
        };
        let subpath = to_subpath(&rest[version.len()..]);
        Some(PackageSpecifier { name, subpath })
    }
}

fn to_subpath(rest: &[u8]) -> Vec<u8> {
    if rest.len() + 1 > SUBPATH_CAPACITY {
        return Vec::new();
    }
    [b".".as_slice(), rest].concat()
}
