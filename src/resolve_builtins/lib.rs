#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
#![warn(unused_must_use)]
// AUTOGEN: mod declarations only — real exports added in B-1.

// ─── B-2 un-gated ─────────────────────────────────────────────────────────
// Phase-A draft body now compiles. `bun_bundler::options::Target` resolved
// via the move-in at `bun_options_types::BundleEnums::Target`; `ZStr` via
// `bun_string`; `ImportRecord.Tag` via `bun_options_types::import_record::Tag`.
#[path = "HardcodedModule.rs"]
pub mod HardcodedModule;

pub use HardcodedModule::{Alias, Cfg, HardcodedModule as Module};
pub use bun_options_types::BundleEnums::Target;
