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

/// The one rule for naming a project: a path with an extension is a config
/// file, any other path is a directory and names the `tsconfig.json` in it.
/// It is lexical, so the worker receives selectors that are already final.
pub fn canonical_selector(cwd: &[u8], raw: &[u8]) -> Vec<u8> {
    let resolved = resolve_against(cwd, raw);
    if bun_paths::extension(&resolved).is_empty() {
        bun_paths::Path::from_parts(&[&resolved, b"tsconfig.json"])
            .as_bytes()
            .to_vec()
    } else {
        resolved
    }
}

#[cfg(all(test, not(windows)))]
mod tests {
    use super::*;

    #[test]
    fn directory_names_its_tsconfig() {
        assert_eq!(canonical_selector(b"/w", b"app"), b"/w/app/tsconfig.json");
        assert_eq!(canonical_selector(b"/w", b"/x/../y"), b"/y/tsconfig.json");
    }

    #[test]
    fn extension_names_a_config_file() {
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
}
