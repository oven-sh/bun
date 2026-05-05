#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
// AUTOGEN: mod declarations only — real exports added in B-1.
pub mod schema;
pub mod OfflineMode;
pub mod CodeCoverageOptions;
pub mod GlobalCache;
pub mod CommandTag;

// ─── B-1 gate-and-stub ────────────────────────────────────────────────────
// Phase-A draft bodies preserved on disk; gated behind `#[cfg(any())]` so
// `cargo check` succeeds. Stub modules below expose the minimal type surface
// other crates / sibling modules reference. Un-gating happens in B-2.

#[cfg(any())]
#[path = "BundleEnums.rs"]
pub mod BundleEnums;
#[cfg(not(any()))]
pub mod BundleEnums {
    // TODO(b1): bun_schema::api, bun_str::strings missing from lower-tier stubs;
    // E0658 inherent assoc types at lines 96, 297.
    pub struct Format;
    pub struct Target;
    pub struct Loader;
    pub struct SourceMapOption;
    pub struct PackagesOption;
    pub struct UnwrapCommonJS;
    pub struct OutputFormat;
    pub struct GlobalCache;
    pub struct ModuleType;
    pub struct JSX;
    pub struct WriteDestination;
    /// `ast::Index` newtype (u32) — used by import_record.
    #[derive(Copy, Clone, Default)]
    pub struct Index(pub u32);
}

#[cfg(any())]
#[path = "import_record.rs"]
pub mod import_record;
#[cfg(not(any()))]
pub mod import_record {
    // TODO(b1): bun_fs::Path, bun_schema::api missing; E0015 non-const EnumMap
    // index in static initializer (ALL_LABELS / ERROR_LABELS).
    pub struct ImportKind;
    pub struct ImportRecord;
    pub type Label = ();
}

#[cfg(any())]
#[path = "Context.rs"]
pub mod Context;
#[cfg(not(any()))]
pub mod Context {
    // TODO(b1): bun_schema::api missing; sibling-module path case mismatch
    // (bundle_enums vs BundleEnums etc.) — fix in B-2 when un-gating.
    pub struct ContextData<'a>(core::marker::PhantomData<&'a ()>);
    pub struct DebugOptions;
    pub struct TestOptions;
    pub struct BundlerOptions;
    pub struct RuntimeOptions;
}

#[cfg(any())]
#[path = "CompileTarget.rs"]
pub mod CompileTarget;
#[cfg(not(any()))]
pub mod CompileTarget {
    // TODO(b1): bun_core::{env_var, fmt, environment, MutableString, Progress,
    // self_exe_path, fast_random, Output::err_generic, Global::PACKAGE_JSON_VERSION},
    // bun_str::{strings, ZStr}, bun_sys::{Dir, move_file_z, INVALID_FD,
    // fetch_cache_directory_path}, bun_fs, bun_paths::{Platform, join_abs_string_buf_z}
    // all missing from lower-tier stub surfaces. Also: thiserror not in deps,
    // const_format::concatcp! inside format_args! (line 628).
    pub struct CompileTarget;
    pub struct HttpSyncDownloadVTable;
}
