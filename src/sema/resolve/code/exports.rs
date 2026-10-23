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
            Self::PackagePathNotExported
            | Self::PackagePathDisabled
            | Self::Undefined
            | Self::UndefinedNoConditionsMatch
            | Self::Null => CodeFailure::PackagePathNotExported,
            Self::Exact | Self::ExactEndsWithStar | Self::Inexact | Self::PackageResolve => {
                CodeFailure::ModuleNotFound
            }
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

#[cfg(test)]
mod tests {
    use super::Field::{Exports, Imports};
    use super::KeyKind::{Directory, Exact, Pattern};
    use super::manifest::build_exports_entry;
    use super::memory_host::parse_json;
    use super::*;

    const CONDITIONS: [&str; 2] = ["import", "default"];
    const NO_CONDITION: &str = "UndefinedNoConditionsMatch";
    const NOT_EXPORTED: &str = "PackagePathNotExported";
    const DISABLED: &str = "PackagePathDisabled";
    const NOT_DEFINED: &str = "PackageImportNotDefined";
    const BAD_SPECIFIER: &str = "InvalidModuleSpecifier";
    const BAD_TARGET: &str = "InvalidPackageTarget";
    const BAD_CONFIGURATION: &str = "InvalidPackageConfiguration";
    const IS_DIRECTORY: &str = "UnsupportedDirectoryImport";

    fn tree<'a>(arena: &'a Arena, json: &str) -> ExportsEntry<'a> {
        build_exports_entry(arena, &parse_json(json.as_bytes()).unwrap())
    }

    fn describe(resolution: &TargetResolution) -> String {
        let status = resolution.status;
        match resolution.path.is_empty() {
            true => format!("{status:?}"),
            false => format!("{status:?} {}", bstr::BStr::new(&resolution.path)),
        }
    }

    fn matches_condition(condition: &[u8]) -> bool {
        CONDITIONS.iter().any(|it| it.as_bytes() == condition)
    }

    fn query(subpath: &str, key: KeyKind, field: Field) -> TargetQuery<'_> {
        TargetQuery {
            subpath: subpath.as_bytes(),
            key,
            field,
            matches: &matches_condition,
        }
    }

    fn exports_with_conditions(conditions: &[&str], json: &str, subpath: &str) -> String {
        let arena = Arena::new();
        let root = tree(&arena, json);
        let matches = |condition: &[u8]| conditions.iter().any(|it| it.as_bytes() == condition);
        describe(&resolve_exports(&root, subpath.as_bytes(), &matches))
    }

    fn exports(json: &str, subpath: &str) -> String {
        exports_with_conditions(&CONDITIONS, json, subpath)
    }

    fn imports(json: &str, specifier: &str) -> String {
        let arena = Arena::new();
        let root = tree(&arena, json);
        let resolution = resolve_imports(&root, specifier.as_bytes(), &matches_condition);
        describe(&resolution)
    }

    fn table(json: &str, match_key: &str) -> String {
        let arena = Arena::new();
        let ExportsEntry::Map(map) = tree(&arena, json) else {
            panic!("{json} is not an object");
        };
        let resolution = resolve_table(match_key.as_bytes(), map, Exports, &matches_condition);
        describe(&resolution)
    }

    fn target(json: &str) -> String {
        let arena = Arena::new();
        let resolution = resolve_target(&tree(&arena, json), &query("", Exact, Exports));
        describe(&resolution)
    }

    fn target_text(target: &str, subpath: &str, key: KeyKind, field: Field) -> String {
        let resolution = resolve_target_text(target.as_bytes(), &query(subpath, key, field));
        describe(&resolution)
    }

    fn exported_text(target: &str) -> String {
        target_text(target, "", Exact, Exports)
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn main_export() {
        let cases = [
            (r#""./a.js""#, "Exact /a.js"),
            (r#"["./a.js"]"#, "Exact /a.js"),
            (r#"{"import": "./a.js"}"#, "Exact /a.js"),
            (r#"{".": "./a.js"}"#, "Exact /a.js"),
            (r#"{".": "./a.js", ".": "./b.js"}"#, "Exact /a.js"),
            (r#"{".": null}"#, NOT_EXPORTED),
            (r#"{"./b": "./b.js"}"#, NOT_EXPORTED),
            (r#"[{"deno": "./a.js"}]"#, NOT_EXPORTED),
            ("null", NOT_EXPORTED),
            (r#"{"deno": "./a.js"}"#, NO_CONDITION),
            (r#"{".": "./a.js", "import": "./b.js"}"#, BAD_CONFIGURATION),
            ("true", BAD_CONFIGURATION),
        ];
        for (json, expected) in cases {
            assert_eq!(exports(json, "."), expected, "{json}");
        }
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn subpath_keys() {
        let cases = [
            (r#"{"./a": "./a.js"}"#, "Exact /a.js"),
            (r#"{"./a": "./a.js", "./a": "./b.js"}"#, "Exact /a.js"),
            (r#"{"./a": null}"#, DISABLED),
            (r#"{"./b": "./b.js"}"#, DISABLED),
            (r#"{"./a": [{"deno": "./x.js"}]}"#, NOT_EXPORTED),
            (r#"{"./a": {"deno": "./x.js"}}"#, NO_CONDITION),
            (r#"{"import": "./a.js"}"#, NOT_EXPORTED),
            (r#""./a.js""#, NOT_EXPORTED),
            (r#"{"./a": "./a.js", "import": "./b"}"#, BAD_CONFIGURATION),
            ("true", BAD_CONFIGURATION),
        ];
        for (json, expected) in cases {
            assert_eq!(exports(json, "./a"), expected, "{json}");
        }
        assert_eq!(exports(r#"{"./*": "./src/*"}"#, ""), DISABLED);
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn imports_table() {
        let cases = [
            (r##"{"#a": "./a.js"}"##, "Exact /a.js"),
            (r##"{"#*": "./src/*.js"}"##, "ExactEndsWithStar /src/a.js"),
            (r##"{"#a": "pkg"}"##, "PackageResolve pkg"),
            (r##"{"#a": "./dir/"}"##, IS_DIRECTORY),
            (r##"{"#b": "./b.js"}"##, NOT_DEFINED),
            (r##"{"#a": null}"##, NOT_DEFINED),
            (r##"{"#a": [{"deno": "./x.js"}]}"##, NOT_DEFINED),
            (r##"{"#a": {"deno": "./x.js"}}"##, NO_CONDITION),
            (r#""./a.js""#, BAD_CONFIGURATION),
            ("true", BAD_CONFIGURATION),
        ];
        for (json, expected) in cases {
            assert_eq!(imports(json, "#a"), expected, "{json}");
        }
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn pattern_keys() {
        let by_base = r#"{"./*": "./any/*.js", "./a/*": "./deep/*.js"}"#;
        assert_eq!(exports(by_base, "./a/x"), "ExactEndsWithStar /deep/x.js");
        assert_eq!(exports(by_base, "./b"), "ExactEndsWithStar /any/b.js");
        assert_eq!(exports(by_base, "./a/"), "ExactEndsWithStar /deep/.js");

        let first_match = r#"{"./*": "./any/*.js", "./a/*": null}"#;
        assert_eq!(exports(first_match, "./a/x"), DISABLED);
        assert_eq!(exports(first_match, "./b"), "ExactEndsWithStar /any/b.js");

        let trailer = r#"{"./*.js": "./src/*.ts"}"#;
        assert_eq!(exports(trailer, "./x.js"), "ExactEndsWithStar /src/x.ts");
        assert_eq!(exports(trailer, "./x.css"), DISABLED);
        assert_eq!(exports(trailer, "./.js"), DISABLED);
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn directory_key_is_inexact() {
        let json = r#"{"./a/": "./src/"}"#;
        assert_eq!(exports(json, "./a/x.js"), "Inexact /src/x.js");
        assert_eq!(exports(json, "./a/b/x"), "Inexact /src/b/x");
        assert_eq!(exports(json, "./b/x.js"), DISABLED);

        let conditional = r#"{"./a/": {"import": ["./src/"]}}"#;
        assert_eq!(exports(conditional, "./a/x.js"), "Inexact /src/x.js");
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn exact_lookup_skips_expansion_syntax() {
        let cases = [
            (r#"{"./a": "./a.js"}"#, "./a", "Exact /a.js"),
            (r#"{"./a*": "./a.js"}"#, "./a*", "ExactEndsWithStar /a.js"),
            (r#"{"./a/": "./src/"}"#, "./a/", "Inexact /src/"),
            (r#"{"./a": "./a.js"}"#, "./b", "Null"),
        ];
        for (json, match_key, expected) in cases {
            assert_eq!(table(json, match_key), expected, "{json}");
        }
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn conditions_match_in_key_order() {
        let json = r#"{"require": "./r.js", "import": "./i.js"}"#;
        let resolve = |conditions: &[&str]| exports_with_conditions(conditions, json, ".");
        assert_eq!(resolve(&["import", "require"]), "Exact /r.js");
        assert_eq!(resolve(&["import"]), "Exact /i.js");
        assert_eq!(resolve(&[]), NO_CONDITION);

        let pattern = r#"{"./*": {"import": "./esm/*.js", "default": "./cjs/*.js"}}"#;
        assert_eq!(exports(pattern, "./x"), "ExactEndsWithStar /esm/x.js");
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn only_undefined_conditions_fall_through() {
        let nested = r#"{"import": {"deno": "./x.js"}, "default": "./d.js"}"#;
        assert_eq!(target(nested), "Exact /d.js");
        let nested_array = r#"{"import": [{"deno": "./x.js"}], "default": "./d.js"}"#;
        assert_eq!(target(nested_array), "Exact /d.js");
        assert_eq!(target(r#"{"import": {"deno": "./x.js"}}"#), NO_CONDITION);

        let null = r#"{"import": null, "default": "./d.js"}"#;
        assert_eq!(target(null), "Null");
        let invalid = r#"{"import": "bad", "default": "./d.js"}"#;
        assert_eq!(target(invalid), BAD_TARGET);
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn arrays_and_leaves() {
        let cases = [
            (r#""./a.js""#, "Exact /a.js"),
            ("null", "Null"),
            ("true", BAD_TARGET),
            ("[]", "Null"),
            (r#"["./a.js", "./b.js"]"#, "Exact /a.js"),
            (r#"[[["./a.js"]]]"#, "Exact /a.js"),
            (r#"[{"deno": "./x.js"}, "./b.js"]"#, "Exact /b.js"),
            (r#"[{"deno": "./x.js"}]"#, "Undefined"),
            (r#"["bad", "./b.js"]"#, BAD_TARGET),
            (r#"[null, "./b.js"]"#, "Null"),
        ];
        for (json, expected) in cases {
            assert_eq!(target(json), expected, "{json}");
        }
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn deep_nesting_is_invalid_configuration() {
        const STACK_SIZE: usize = 4 << 20;
        let resolve_nested = || {
            bun_sema_standalone::native::set_stack_size(STACK_SIZE / 2);
            let arena = Arena::new();
            let mut entry = ExportsEntry::Target(b"./a.js");
            let mut nest_and_resolve = |levels: usize| {
                for _ in 0..levels {
                    entry = ExportsEntry::Array(arena.alloc_slice_copy(&[entry]));
                }
                describe(&resolve_target(&entry, &query("", Exact, Exports)))
            };
            (nest_and_resolve(64), nest_and_resolve(100_000))
        };
        let thread = std::thread::Builder::new().stack_size(STACK_SIZE);
        let (shallow, deep) = thread.spawn(resolve_nested).unwrap().join().unwrap();
        assert_eq!(shallow, "Exact /a.js");
        assert_eq!(deep, BAD_CONFIGURATION);
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn target_length_limit() {
        let longest = MAX_PATH_BYTES - PACKAGE_URL.len() - JOIN_HEADROOM;
        let fitting = format!("./{}", "a".repeat(longest - 2));
        assert!(exported_text(&fitting).starts_with("Exact /aaa"));
        assert_eq!(exported_text(&format!("{fitting}a")), BAD_TARGET);

        let substitute = |subpath: &str| target_text("./*", subpath, Pattern, Exports);
        let fitting = "a".repeat(longest - 3);
        assert!(substitute(&fitting).starts_with("ExactEndsWithStar /aaa"));
        assert_eq!(substitute(&format!("{fitting}a")), BAD_TARGET);
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn leftover_subpath_needs_directory_target() {
        let cases = [
            ("./x/", "y", Directory, Exports, "Inexact /x/y"),
            ("./x", "y", Directory, Exports, BAD_SPECIFIER),
            ("pkg", "y", Directory, Imports, BAD_SPECIFIER),
            ("./x", "", Directory, Exports, "Inexact /x"),
            ("./x", "y", Pattern, Exports, "ExactEndsWithStar /x"),
        ];
        for (target, subpath, key, field, expected) in cases {
            assert_eq!(target_text(target, subpath, key, field), expected);
        }
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn invalid_subpaths() {
        for subpath in ["../x", "x/./y", "x\\..\\y", "NODE_MODULES/x", "%2e%2e/x"] {
            let pattern = target_text("./src/*", subpath, Pattern, Exports);
            assert_eq!(pattern, BAD_SPECIFIER, "{subpath}");
            let directory = target_text("./src/", subpath, Directory, Exports);
            assert_eq!(directory, BAD_SPECIFIER, "{subpath}");
            let package = target_text("pkg/*", subpath, Pattern, Imports);
            assert_eq!(package, BAD_SPECIFIER, "{subpath}");
        }
        let valid = target_text("./src/*", "..x/.y/node_modules.js", Pattern, Exports);
        assert_eq!(valid, "ExactEndsWithStar /src/..x/.y/node_modules.js");
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn target_outside_package() {
        for target in ["../x", "/x", "pkg", ""] {
            assert_eq!(exported_text(target), BAD_TARGET, "{target}");
        }
        let cases = [
            ("../x", "", Exact, BAD_TARGET),
            ("/x", "", Exact, BAD_TARGET),
            ("pkg", "", Exact, "PackageResolve pkg"),
            ("@s/pkg/lib.js", "", Exact, "PackageResolve @s/pkg/lib.js"),
            ("node:fs", "", Exact, "PackageResolve node:fs"),
            ("pkg/", "x", Directory, "PackageResolve pkg/x"),
            ("pkg/*", "a/b", Pattern, "PackageResolve pkg/a/b"),
        ];
        for (target, subpath, key, expected) in cases {
            assert_eq!(target_text(target, subpath, key, Imports), expected);
        }
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn invalid_target_segments() {
        for target in ["./a/../b", "./a\\..\\b", "./node_modules/x", "./%2e%2e/x"] {
            assert_eq!(exported_text(target), BAD_TARGET, "{target}");
        }
        assert_eq!(exported_text("./a/..b/.c"), "Exact /a/..b/.c");
        assert_eq!(exported_text("./a//b.js"), "Exact /a/b.js");
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn pattern_substitution() {
        let cases = [
            ("./src/*.js", "x", "ExactEndsWithStar /src/x.js"),
            ("./*/*.js", "x", "ExactEndsWithStar /x/x.js"),
            ("./src/*", "a/b.js", "ExactEndsWithStar /src/a/b.js"),
            ("./node_*/x.js", "modules", BAD_SPECIFIER),
            ("./%2*/x.js", "e", BAD_SPECIFIER),
        ];
        for (target, subpath, expected) in cases {
            let resolution = target_text(target, subpath, Pattern, Exports);
            assert_eq!(resolution, expected, "{target}");
        }
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn substitution_length_limit() {
        let subpath = "a".repeat(MAX_PATH_BYTES / 4);
        let exported = |target: &str| target_text(target, &subpath, Pattern, Exports);
        assert!(exported("./*/*").starts_with("ExactEndsWithStar /aaa"));
        assert_eq!(exported("./********"), BAD_SPECIFIER);

        let imported = |target: &str| target_text(target, &subpath, Pattern, Imports);
        assert!(imported("*/*").starts_with("PackageResolve aaa"));
        assert_eq!(imported("********"), BAD_SPECIFIER);
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn path_segments() {
        for path in ["./a", "../a", "node_modules/a", "./a//b/", "/"] {
            assert!(!has_invalid_segment(path.as_bytes()), "{path}");
        }
        for path in ["", "a", "./..", "./a\\..\\b", "/node_modules"] {
            assert!(has_invalid_segment(path.as_bytes()), "{path}");
        }
        for path in ["", "a", "a//b/", "..a"] {
            assert!(!has_invalid_subpath_segment(path.as_bytes()), "{path}");
        }
        for path in ["..", "../a", "node_modules", "a\\.."] {
            assert!(has_invalid_subpath_segment(path.as_bytes()), "{path}");
        }

        let plain = [".", "..", "node_modules", "Node_MODULES"];
        let escaped = ["%2e", "%2E%2e", ".%2E", "%4Eode_modules"];
        for segment in plain.into_iter().chain(escaped) {
            assert!(is_invalid_segment(segment.as_bytes()), "{segment}");
        }
        let plain = ["", "a", "...", ".a", "node_module", "node_modules2"];
        let escaped = ["%2", "%2e%2", "%zz", "%2e%2e%2e", "node_modules%2e"];
        for segment in plain.into_iter().chain(escaped) {
            assert!(!is_invalid_segment(segment.as_bytes()), "{segment}");
        }
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn resolved_path_is_decoded() {
        let cases = [
            (r#""./a%20b.js""#, "Exact /a b.js"),
            (r#""./%41.js""#, "Exact /A.js"),
            (r#""./a%2fb.js""#, BAD_SPECIFIER),
            (r#""./a%2Fb.js""#, BAD_SPECIFIER),
            (r#""./a%5cb.js""#, BAD_SPECIFIER),
            (r#""./a%5Cb.js""#, BAD_SPECIFIER),
            (r#""./a%zz.js""#, BAD_SPECIFIER),
            (r#""./a%2""#, BAD_SPECIFIER),
        ];
        for (json, expected) in cases {
            assert_eq!(exports(json, "."), expected, "{json}");
        }

        let pattern = r#"{"./*": "./src/*.js"}"#;
        assert_eq!(exports(pattern, "./a%20b"), "ExactEndsWithStar /src/a b.js");
        assert_eq!(exports(pattern, "./a%2fb"), BAD_SPECIFIER);
        let directory = r#"{"./a/": "./src/"}"#;
        assert_eq!(exports(directory, "./a/b%20c"), "Inexact /src/b c");
        let package = r##"{"#a": "pkg%2fx/"}"##;
        assert_eq!(imports(package, "#a"), "PackageResolve pkg%2fx/");
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn resolved_directory_is_unsupported() {
        for json in [r#""./dir/""#, r#""./""#, r#""./dir\\""#, r#""./a%20/""#] {
            assert_eq!(exports(json, "."), IS_DIRECTORY, "{json}");
        }
        assert_eq!(exports(r#"{"./a/": "./src/"}"#, "./a/"), IS_DIRECTORY);
        assert_eq!(exports(r#""./dir""#, "."), "Exact /dir");
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn strict_percent_decoding() {
        let decode = |text: &str| decode_percent(text.as_bytes());
        assert_eq!(decode("a%20b%41%7a"), Some(b"a bAz".to_vec()));
        assert_eq!(decode(""), Some(Vec::new()));
        for text in ["%", "a%4", "%4g", "%g4", "%%41", "%41%"] {
            assert_eq!(decode(text), None, "{text}");
        }
    }

    fn parse(specifier: &str) -> Option<[String; 2]> {
        let parsed = PackageSpecifier::parse(specifier.as_bytes())?;
        let fields = [parsed.name, &parsed.subpath];
        Some(fields.map(|field| bstr::BStr::new(field).to_string()))
    }

    fn parts(name: &str, subpath: &str) -> Option<[String; 2]> {
        Some([name, subpath].map(str::to_owned))
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn package_specifiers() {
        let cases = [
            ("react", parts("react", ".")),
            ("react/jsx-runtime", parts("react", "./jsx-runtime")),
            ("@s/p", parts("@s/p", ".")),
            ("@s/p/x/y", parts("@s/p", "./x/y")),
            ("a@1.2.3/b", parts("a", "./b")),
            ("@s/p@2", parts("@s/p", ".")),
            ("@s/p@2/x", parts("@s/p", "./x")),
            ("pkg/@scope/x", parts("pkg", "./@scope/x")),
            ("a/b%20c", parts("a", "./b%20c")),
            ("a@", parts("a", ".")),
            ("a@/b", parts("a", ".")),
            ("", None),
            ("@scope", None),
            (".hidden", None),
            ("a%b", None),
            ("a\\b", None),
        ];
        for (specifier, expected) in cases {
            assert_eq!(parse(specifier), expected, "{specifier}");
        }

        let cases = [
            ("a/b/c", Some("a")),
            ("a@1/b", Some("a@1")),
            ("@s/p", Some("@s/p")),
            ("@s/p/x", Some("@s/p")),
            ("", Some("")),
            ("@s", None),
        ];
        for (specifier, expected) in cases {
            let name = PackageSpecifier::parse_name(specifier.as_bytes());
            assert_eq!(name, expected.map(str::as_bytes), "{specifier}");
        }
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn subpath_capacity() {
        let fitting = format!("a/{}", "b".repeat(SUBPATH_CAPACITY - 2));
        let parsed = PackageSpecifier::parse(fitting.as_bytes()).unwrap();
        assert_eq!(parsed.subpath.len(), SUBPATH_CAPACITY);
        assert!(parsed.subpath.starts_with(b"./b"));

        let too_long = format!("{fitting}b");
        let parsed = PackageSpecifier::parse(too_long.as_bytes()).unwrap();
        assert_eq!(parsed.name, b"a");
        assert!(parsed.subpath.is_empty());
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn status_failures() {
        let same_name = [
            ExportsStatus::InvalidModuleSpecifier,
            ExportsStatus::InvalidPackageConfiguration,
            ExportsStatus::InvalidPackageTarget,
            ExportsStatus::PackagePathNotExported,
            ExportsStatus::UnsupportedDirectoryImport,
            ExportsStatus::PackageImportNotDefined,
        ];
        for status in same_name {
            assert_eq!(format!("{:?}", status.failure()), format!("{status:?}"));
        }
        let not_exported = [
            ExportsStatus::PackagePathDisabled,
            ExportsStatus::Undefined,
            ExportsStatus::UndefinedNoConditionsMatch,
            ExportsStatus::Null,
        ];
        for status in not_exported {
            let failure = status.failure();
            assert_eq!(failure, CodeFailure::PackagePathNotExported, "{status:?}");
        }
        let not_found = [
            ExportsStatus::Exact,
            ExportsStatus::ExactEndsWithStar,
            ExportsStatus::Inexact,
            ExportsStatus::PackageResolve,
        ];
        for status in not_found {
            assert_eq!(status.failure(), CodeFailure::ModuleNotFound, "{status:?}");
        }
    }
}
