use crate::options::Externals;
use bun_core::strings::last_index_of_char;
use bun_paths::{Path, from_portable, is_absolute, is_package_path};
use bun_sema::resolve::CodeImportKind;

pub(crate) fn is_external(
    externals: &Externals,
    specifier: &[u8],
    kind: CodeImportKind,
    directory: &[u8],
) -> bool {
    if matches_pattern(&externals.patterns, specifier) {
        return true;
    }
    if is_package_path(specifier) {
        return externals.are_all_packages || matches_package(&externals.packages, specifier);
    }
    matches_path(&externals.paths, specifier, kind, directory)
}

fn matches_pattern(patterns: &[(Vec<u8>, Vec<u8>)], specifier: &[u8]) -> bool {
    patterns.iter().any(|(prefix, suffix)| {
        specifier.len() >= prefix.len() + suffix.len()
            && specifier.starts_with(prefix)
            && specifier.ends_with(suffix)
    })
}

fn matches_package(packages: &[Vec<u8>], specifier: &[u8]) -> bool {
    if packages.is_empty() || specifier.ends_with(b"/") {
        return false;
    }
    let mut query = specifier;
    loop {
        if contains(packages, query) {
            return true;
        }
        match last_index_of_char(query, b'/') {
            Some(slash) => query = &query[..slash],
            None => return false,
        }
    }
}

fn matches_path(
    paths: &[Vec<u8>],
    specifier: &[u8],
    kind: CodeImportKind,
    directory: &[u8],
) -> bool {
    if paths.is_empty() {
        return false;
    }
    if is_absolute(specifier) {
        return contains(paths, specifier);
    }
    if !is_absolute(directory) {
        return false;
    }
    let specifier: &[u8] = match kind {
        CodeImportKind::Import => &from_portable(specifier),
        CodeImportKind::EntryPoint | CodeImportKind::Require => specifier,
    };
    let mut path = Path::resolve(&[directory, specifier]);
    if specifier.ends_with(&[bun_paths::SEP]) {
        path.push_trailing_sep();
    }
    contains(paths, &path)
}

pub(crate) fn contains(sorted_list: &[Vec<u8>], item: &[u8]) -> bool {
    sorted_list
        .binary_search_by(|entry| entry.as_slice().cmp(item))
        .is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use bstr::BStr;
    use bun_sema_standalone as _;

    fn owned(items: &[&[u8]]) -> Vec<Vec<u8>> {
        items.iter().map(|item| item.to_vec()).collect()
    }

    fn assert_external(externals: &Externals, directory: &[u8], specifiers: &[&[u8]]) {
        for specifier in specifiers {
            let is_external = is_external(externals, specifier, CodeImportKind::Import, directory);
            assert!(is_external, "{} is not external", BStr::new(specifier));
        }
    }

    fn assert_not_external(externals: &Externals, directory: &[u8], specifiers: &[&[u8]]) {
        for specifier in specifiers {
            let is_external = is_external(externals, specifier, CodeImportKind::Import, directory);
            assert!(!is_external, "{} is external", BStr::new(specifier));
        }
    }

    #[test]
    fn package_includes_subpaths() {
        let externals = Externals {
            packages: owned(&[b"@scope/pkg", b"foo"]),
            ..Externals::default()
        };
        assert_external(
            &externals,
            b"/p",
            &[
                b"foo",
                b"foo/bar",
                b"foo/bar/baz.js",
                b"@scope/pkg",
                b"@scope/pkg/sub",
            ],
        );
        assert_not_external(
            &externals,
            b"/p",
            &[
                b"foobar",
                b"foo/",
                b"fo",
                b"@scope",
                b"@scope/other",
                b"./foo",
                b"/foo",
                b"",
            ],
        );
    }

    #[cfg(unix)]
    #[test]
    fn relative_specifier_joins_importer_directory() {
        let externals = Externals {
            paths: owned(&[b"/p/src/a.js"]),
            ..Externals::default()
        };
        assert_external(&externals, b"/p/src", &[b"./a.js", b"./x/../a.js"]);
        assert_external(&externals, b"/p/lib", &[b"../src/a.js"]);
        assert_not_external(&externals, b"/p", &[b"./a.js"]);
        assert_not_external(&externals, b"/p/src", &[b"./b.js", b"a.js", b".", b".."]);
        assert_not_external(&externals, b"p/src", &[b"./a.js"]);
        assert_not_external(&externals, b"", &[b"./a.js"]);
    }

    #[cfg(unix)]
    #[test]
    fn absolute_specifier_ignores_importer_directory() {
        let externals = Externals {
            paths: owned(&[b"/p/src/a.js", b"/p/src/c.js"]),
            ..Externals::default()
        };
        assert_external(&externals, b"/q", &[b"/p/src/a.js", b"/p/src/c.js"]);
        assert_not_external(
            &externals,
            b"/p/src",
            &[b"/p/src/b.js", b"/p/src", b"/a.js"],
        );
    }

    #[cfg(unix)]
    #[test]
    fn overlong_path_is_not_external() {
        let externals = Externals {
            paths: owned(&[b"/p/src/a.js"]),
            ..Externals::default()
        };
        let overlong = [&b"./"[..], &b"a/".repeat(bun_paths::MAX_PATH_BYTES)].concat();
        assert_not_external(&externals, b"/p/src", &[&overlong]);

        let normalizes_to_listed_path = [
            &b"./"[..],
            &b"a/../".repeat(bun_paths::MAX_PATH_BYTES),
            b"a.js",
        ]
        .concat();
        assert_external(&externals, b"/p/src", &[&normalizes_to_listed_path]);
    }

    #[test]
    fn pattern_matches_prefix_and_suffix() {
        let externals = Externals {
            patterns: vec![
                (Vec::new(), b".png".to_vec()),
                (b"@scope/".to_vec(), Vec::new()),
                (b"ab".to_vec(), b"bc".to_vec()),
            ],
            ..Externals::default()
        };
        assert_external(
            &externals,
            b"/p",
            &[
                b"./logo.png",
                b"logo.png",
                b".png",
                b"@scope/pkg",
                b"@scope/",
                b"abbc",
                b"ab-bc",
            ],
        );
        assert_not_external(
            &externals,
            b"/p",
            &[
                b"./logo.jpg",
                b"logo.png.js",
                b"png",
                b"@scope",
                b"@scoped/pkg",
                b"abc",
            ],
        );
    }

    #[test]
    fn all_packages_excludes_paths() {
        let externals = Externals {
            are_all_packages: true,
            ..Externals::default()
        };
        assert_external(&externals, b"/p", &[b"react", b"react/", b"@scope/pkg"]);
        assert_not_external(
            &externals,
            b"/p",
            &[b"./react", b"../react", b"/react", b".", b".."],
        );
    }

    #[test]
    fn empty_lists_match_nothing() {
        assert_not_external(
            &Externals::default(),
            b"/p",
            &[b"react", b"./a.js", b"/p/a.js", b"logo.png", b""],
        );
    }
}
