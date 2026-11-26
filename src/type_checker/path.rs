use bun_core::strings;

#[derive(Debug, PartialEq, Eq)]
pub enum PathError {
    ContainsNul,
}

pub fn check_no_nul(bytes: &[u8]) -> Result<(), PathError> {
    if strings::contains_char(bytes, 0) {
        Err(PathError::ContainsNul)
    } else {
        Ok(())
    }
}

/// Resolve a path against `cwd` and normalize lexically. No filesystem
/// access: the path may not exist.
pub fn resolve_against(cwd: &[u8], path: &[u8]) -> Vec<u8> {
    if bun_paths::is_absolute(path) {
        bun_paths::Path::resolve(&[path]).as_bytes().to_vec()
    } else {
        bun_paths::Path::resolve(&[cwd, path]).as_bytes().to_vec()
    }
}

/// A project is named by its config file: `GetNormalizedAbsolutePath(fileName, cwd)`. A directory
/// does not stand for the `tsconfig.json` in it.
pub fn canonical_selector(cwd: &[u8], raw: &[u8]) -> Vec<u8> {
    resolve_against(cwd, raw)
}

/// Whether the file system that holds `cwd` is case-sensitive, by the probe the checker's disk uses.
pub fn file_system_is_case_sensitive(cwd: &[u8]) -> bool {
    bun_sema_driver::host::is_file_system_case_sensitive(&bun_sema_driver::host::from_native(cwd))
}

/// `tspath.ToPath` of an absolute, normalized path: the key that identifies a file or project
/// whatever its spelling. Lowercased by `ToFileNameLowerCase` on a case-insensitive file system.
pub fn canonical_key(path: &[u8], case_sensitive: bool) -> Vec<u8> {
    bun_sema::resolve::to_path(path, case_sensitive).into_owned()
}

/// Whether two absolute paths name the same file on a file system with this case sensitivity.
pub fn is_same_path(a: &[u8], b: &[u8], case_sensitive: bool) -> bool {
    bun_sema::resolve::is_same_path(a, b, case_sensitive)
}

/// Embedded library files keep this identity in diagnostics.
pub(crate) fn is_bundled_name(name: &[u8]) -> bool {
    name.starts_with(b"bundled:///")
}

/// The file argument of `getDiagnostics(file)`.
pub enum FileFilter {
    /// A `bundled:///libs/...` name, compared verbatim.
    Bundled(Vec<u8>),
    /// A path resolved against the cwd.
    Path(Vec<u8>),
}

impl FileFilter {
    pub fn new(cwd: &[u8], raw: &[u8]) -> Self {
        if is_bundled_name(raw) {
            Self::Bundled(raw.to_vec())
        } else {
            Self::Path(resolve_against(cwd, raw))
        }
    }

    pub fn matches(&self, diagnostic_file: &[u8], case_sensitive: bool) -> bool {
        match self {
            Self::Bundled(name) => name == diagnostic_file,
            Self::Path(path) => {
                !is_bundled_name(diagnostic_file)
                    && is_same_path(
                        &resolve_against(b"/", diagnostic_file),
                        path,
                        case_sensitive,
                    )
            }
        }
    }
}

#[cfg(all(test, not(windows)))]
mod tests {
    use super::*;

    #[test]
    fn selector_is_the_normalized_absolute_path_as_given() {
        assert_eq!(canonical_selector(b"/w", b"app"), b"/w/app");
        assert_eq!(canonical_selector(b"/w", b"/x/../y/"), b"/y");
        assert_eq!(
            canonical_selector(b"/w", b"app/tsconfig.base.json"),
            b"/w/app/tsconfig.base.json"
        );
        assert_eq!(canonical_selector(b"/w", b"/a/b.json"), b"/a/b.json");
    }

    #[test]
    fn resolve_against_ignores_cwd_for_absolute() {
        assert_eq!(resolve_against(b"/w", b"/a/./b"), b"/a/b");
        assert_eq!(resolve_against(b"/w", b"../a"), b"/a");
    }

    #[test]
    fn nul_is_rejected() {
        assert_eq!(check_no_nul(b"a\0b"), Err(PathError::ContainsNul));
        assert_eq!(check_no_nul(b"ab"), Ok(()));
    }

    #[test]
    fn bundled_filter_is_verbatim() {
        let filter = FileFilter::new(b"/w", b"bundled:///libs/lib.es5.d.ts");
        assert!(filter.matches(b"bundled:///libs/lib.es5.d.ts", true));
        assert!(!filter.matches(b"bundled:///libs/lib.es2015.d.ts", true));
        assert!(!filter.matches(b"/w/bundled:/libs/lib.es5.d.ts", true));
    }

    #[test]
    fn path_filter_resolves_and_never_matches_bundled() {
        let filter = FileFilter::new(b"/w", b"src/../a.ts");
        assert!(filter.matches(b"/w/a.ts", true));
        assert!(!filter.matches(b"/w/A.ts", true));
        assert!(filter.matches(b"/w/A.ts", false));
        assert!(!filter.matches(b"bundled:///libs/a.ts", true));
    }

    #[test]
    fn canonical_key_lowers_only_when_insensitive() {
        assert_eq!(canonical_key(b"/W/A.ts", true), b"/W/A.ts");
        assert_eq!(canonical_key(b"/W/A.ts", false), b"/w/a.ts");
        assert_eq!(
            canonical_key("/\u{130}\u{c9}".as_bytes(), false),
            "/\u{130}\u{e9}".as_bytes()
        );
    }
}
