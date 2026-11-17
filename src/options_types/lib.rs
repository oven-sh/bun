#![feature(adt_const_params)]
#![allow(non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]
pub mod aot_options;
pub mod bundle_enums;
pub mod code_coverage_options;
pub mod command_tag;
pub mod compile_target;
pub mod context;
pub mod error;
pub mod global_cache;
pub mod jsx;
pub mod offline_mode;
pub mod schema;
pub mod trim;

pub use error::{Error, Result};

pub use jsx as JSX;

// ─── crate-root re-exports for dependents ────────────────────────────────
// `ImportKind` / `ImportRecord` / `Loader` / `Target` / `Index` / `SideEffects`
// are now canonical in `bun_ast` — callers import from there directly.
// Only the `schema::api`-coupled extension traits and option-only types
// (`Format`, `ModuleType`, …) are surfaced from this crate.
pub use bundle_enums::{
    BuiltInModule, BundlePackage, ForceNodeEnv, Format, LOADER_API_NAMES, LoaderExt, ModuleType,
    TargetExt, WindowsOptions,
};

/// Compiled-standalone-binary virtual filesystem path prefix + predicate.
///
/// MOVE_DOWN from `bun_standalone_graph` (which sits above `bun_resolver` via
/// `bun_bundler`) so the resolver can test "is this an embedded module path"
/// without an upward dependency edge. The full graph type stays in
/// `bun_standalone_graph`; only the path-prefix constants and the pure
/// `is_bun_standalone_file_path` check live here.
pub mod standalone_path {
    /// `/$bunfs/` (POSIX) — 8 bytes for one u64 compare; `$` avoids colliding
    /// with a real path. Windows uses a drive-letter form so file URLs validate.
    #[cfg(not(windows))]
    pub(crate) const BASE_PATH: &str = "/$bunfs/";
    #[cfg(windows)]
    pub(crate) const BASE_PATH: &str = "B:\\~BUN\\";

    #[cfg(not(windows))]
    pub(crate) const BASE_PUBLIC_PATH: &str = "/$bunfs/";
    #[cfg(windows)]
    pub(crate) const BASE_PUBLIC_PATH: &str = "B:/~BUN/";

    #[inline]
    fn is_bun_standalone_file_path_canonicalized(str_: &[u8]) -> bool {
        if cfg!(windows) {
            return has_prefix_ignoring_drive_case(str_, BASE_PATH.as_bytes())
                || has_prefix_ignoring_drive_case(str_, BASE_PUBLIC_PATH.as_bytes());
        }
        str_.starts_with(BASE_PATH.as_bytes())
    }

    /// Drive letters are case-insensitive on Windows.
    fn has_prefix_ignoring_drive_case(path: &[u8], base: &[u8]) -> bool {
        match (path.split_first(), base.split_first()) {
            (Some((drive, rest)), Some((base_drive, base_rest))) => {
                drive.eq_ignore_ascii_case(base_drive) && rest.starts_with(base_rest)
            }
            _ => base.is_empty(),
        }
    }

    /// True iff `str_` lives under the embedded-module virtual root.
    #[inline]
    pub fn is_bun_standalone_file_path(str_: &[u8]) -> bool {
        #[cfg(windows)]
        {
            // On Windows, remove NT path prefixes before checking.
            let canonicalized = bun_paths::string_paths::without_nt_prefix::<u8>(str_);
            return is_bun_standalone_file_path_canonicalized(canonicalized);
        }
        #[cfg(not(windows))]
        {
            is_bun_standalone_file_path_canonicalized(str_)
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn prefix_ignores_drive_case() {
            for (path, is_found) in [
                (&b"B:/~BUN/root/a.txt"[..], true),
                (b"b:/~BUN/root/a.txt", true),
                (b"C:/~BUN/root/a.txt", false),
                (b"b:/~bun/root/a.txt", false),
                (b"b", false),
                (b"", false),
            ] {
                assert_eq!(has_prefix_ignoring_drive_case(path, b"B:/~BUN/"), is_found);
            }
        }
    }
}
