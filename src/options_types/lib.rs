#![feature(adt_const_params)]
#![allow(
    unused,
    non_snake_case,
    non_camel_case_types,
    non_upper_case_globals,
    clippy::all
)]
#![warn(unused_must_use)]
// AUTOGEN: mod declarations only — real exports added in B-1.
#![warn(unreachable_pub)]
pub mod bundle_enums;
pub mod code_coverage_options;
pub mod command_tag;
pub mod compile_target;
pub mod context;
pub mod global_cache;
pub mod jsx;
pub mod offline_mode;
pub mod schema;

pub use jsx as JSX;

// ─── B-2 Track A: crate-root re-exports for dependents ───────────────────
// `ImportKind` / `ImportRecord` / `Loader` / `Target` / `Index` / `SideEffects`
// are now canonical in `bun_ast` — callers import from there directly.
// Only the `schema::api`-coupled extension traits and option-only types
// (`Format`, `ModuleType`, …) are surfaced from this crate.
pub use bundle_enums::{
    BuiltInModule, BundlePackage, ForceNodeEnv, Format, ImportKindExt, LOADER_API_NAMES, LoaderExt,
    LoaderOptionalExt, ModuleType, TargetExt, WindowsOptions,
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
    pub const BASE_PATH: &str = "/$bunfs/";
    #[cfg(windows)]
    pub const BASE_PATH: &str = "B:\\~BUN\\";

    #[cfg(not(windows))]
    pub const BASE_PUBLIC_PATH: &str = "/$bunfs/";
    #[cfg(windows)]
    pub const BASE_PUBLIC_PATH: &str = "B:/~BUN/";

    #[cfg(not(windows))]
    pub const BASE_PUBLIC_PATH_WITH_DEFAULT_SUFFIX: &str =
        const_format::concatcp!(BASE_PUBLIC_PATH, "root/");
    #[cfg(windows)]
    pub const BASE_PUBLIC_PATH_WITH_DEFAULT_SUFFIX: &str =
        const_format::concatcp!(BASE_PUBLIC_PATH, "root/");

    #[inline]
    pub fn is_bun_standalone_file_path_canonicalized(str_: &[u8]) -> bool {
        str_.starts_with(BASE_PATH.as_bytes())
            || (cfg!(windows) && str_.starts_with(BASE_PUBLIC_PATH.as_bytes()))
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
}
