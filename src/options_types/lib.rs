#![feature(adt_const_params)]
#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
#![warn(unused_must_use)]
// AUTOGEN: mod declarations only — real exports added in B-1.
pub mod schema;
pub mod OfflineMode;
pub mod CodeCoverageOptions;
pub mod GlobalCache;
pub mod CommandTag;

// ─── B-2 un-gated ─────────────────────────────────────────────────────────
// Phase-A draft bodies now compile. Remaining `` gates are
// fn-body re-gates blocked on lower-tier symbols (see TODO(b2-blocked)).

#[path = "BundleEnums.rs"]
pub mod BundleEnums;

#[path = "import_record.rs"]
pub mod import_record;

#[path = "Context.rs"]
pub mod Context;

#[path = "CompileTarget.rs"]
pub mod CompileTarget;

// ─── B-2 Track A: crate-root re-exports for dependents ───────────────────
// Dependents (bundler/css/js_parser/http_types/watcher) import these by bare
// name from the crate root rather than reaching into the defining module.
pub use import_record::{ImportRecord, ImportKind, Index as ImportRecordIndex, Flags as ImportRecordFlags, Tag as ImportRecordTag};
pub use BundleEnums::{Loader, LoaderOptional, LoaderHashTable, Format, Target, ModuleType, SideEffects, BundlePackage, BuiltInModule, WindowsOptions, ForceNodeEnv};

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
            let canonicalized = bun_string::strings::paths::without_nt_prefix::<u8>(str_);
            return is_bun_standalone_file_path_canonicalized(canonicalized);
        }
        #[cfg(not(windows))]
        {
            is_bun_standalone_file_path_canonicalized(str_)
        }
    }
}
