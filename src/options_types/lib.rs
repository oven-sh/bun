#![feature(adt_const_params)]
#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
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
