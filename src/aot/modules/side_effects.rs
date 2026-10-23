use bun_paths::platform::Posix;
use bun_paths::resolve_path::join_spill;
use bun_sema::resolve::DeclaredSideEffects;

/// The answer of the bundler's `SideEffects::has_side_effects`, negated.
pub(super) fn is_declared_free_of_side_effects(
    declared: DeclaredSideEffects<'_>,
    path: &[u8],
) -> bool {
    match declared {
        DeclaredSideEffects::Unspecified => false,
        DeclaredSideEffects::None => true,
        DeclaredSideEffects::Listed { directory, entries } => {
            let mut entries = entries.iter();
            path.starts_with(directory) && !entries.any(|entry| names(directory, entry, path))
        }
    }
}

fn is_pattern(entry: &[u8]) -> bool {
    let has_wildcard = bun_core::strings::index_of_any(entry, b"*?[{").is_some();
    has_wildcard || bun_glob::has_extglob_prefix(entry)
}

fn names(directory: &[u8], entry: &[u8], path: &[u8]) -> bool {
    let mut long_path = Vec::new();
    let named = join_spill::<Posix>(&mut long_path, &[directory, entry]);
    match is_pattern(entry) {
        true => bun_glob::Prepared::new(named).r#match(path).matches(),
        false => named == path,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DIRECTORY: &[u8] = b"/p/node_modules/s";

    fn is_free(entries: &[&[u8]], file: &str) -> bool {
        let declared = DeclaredSideEffects::Listed {
            directory: DIRECTORY,
            entries,
        };
        let path = [DIRECTORY, b"/", file.as_bytes()].concat();
        is_declared_free_of_side_effects(declared, &path)
    }

    #[test]
    fn field_without_list_speaks_for_every_file() {
        let path = b"/p/node_modules/s/a.js";
        assert!(is_declared_free_of_side_effects(
            DeclaredSideEffects::None,
            path
        ));
        assert!(!is_declared_free_of_side_effects(
            DeclaredSideEffects::Unspecified,
            path
        ));
    }

    #[test]
    fn listed_path_has_side_effects() {
        for entries in [[b"./a.js".as_slice()], [b"a.js"], [b"lib/../a.js"]] {
            assert!(
                !is_free(&entries, "a.js"),
                "{:?}",
                bstr::BStr::new(entries[0])
            );
            assert!(is_free(&entries, "b.js"));
            assert!(is_free(&entries, "lib/a.js"));
        }
    }

    #[test]
    fn file_that_pattern_matches_has_side_effects() {
        let cases: [(&[u8], &[&str], &[&str]); 5] = [
            (
                b"./lib/*.js",
                &["lib/a.js"],
                &["a.js", "lib/deep/a.js", "lib/a.mjs"],
            ),
            (
                b"**/*.setup.js",
                &["a.setup.js", "lib/deep/a.setup.js"],
                &["a.js"],
            ),
            (b"lib/{a,b}.js", &["lib/a.js", "lib/b.js"], &["lib/c.js"]),
            (b"lib/[ab].js", &["lib/a.js"], &["lib/c.js"]),
            (b"lib/@(a|b).js", &["lib/b.js"], &["lib/c.js"]),
        ];
        for (pattern, matched, others) in cases {
            for file in matched {
                assert!(
                    !is_free(&[pattern], file),
                    "{} {file}",
                    bstr::BStr::new(pattern)
                );
            }
            for file in others {
                assert!(
                    is_free(&[pattern], file),
                    "{} {file}",
                    bstr::BStr::new(pattern)
                );
            }
        }
    }

    #[test]
    fn paths_and_patterns_mix() {
        let entries: [&[u8]; 3] = [b"./a.js", b"./styles.css", b"./polyfills/*.js"];
        assert!(!is_free(&entries, "a.js"));
        assert!(!is_free(&entries, "polyfills/b.js"));
        assert!(is_free(&entries, "c.js"));
    }

    #[test]
    fn file_outside_the_directory_keeps_its_side_effects() {
        let declared = DeclaredSideEffects::Listed {
            directory: DIRECTORY,
            entries: &[b"./a.js"],
        };
        assert!(!is_declared_free_of_side_effects(
            declared,
            b"/p/elsewhere/b.js"
        ));
    }
}
