#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
// AUTOGEN: mod declarations only — real exports added in B-1.
//
// B-1 gate-and-stub: all Phase-A draft modules are gated behind `#[cfg(any())]`
// so the crate compiles. Draft bodies are preserved on disk; un-gating happens
// in B-2 as lower-tier crate surfaces solidify.

pub mod IndexStringMap;
pub mod PathToSourceIndexMap;
pub mod DeferredBatchTask;
pub mod Graph;
#[cfg(any())]
pub mod BundleThread;
#[cfg(any())]
pub mod ServerComponentParseTask;
#[cfg(any())]
pub mod HTMLImportManifest;
#[cfg(any())]
pub mod HTMLScanner;
#[cfg(any())]
pub mod OutputFile;
#[cfg(any())]
pub mod cache;
#[cfg(any())]
pub mod ThreadPool;
pub mod entry_points;
#[cfg(any())]
pub mod AstBuilder;
pub mod analyze_transpiled_module;
#[cfg(any())]
pub mod linker;
#[cfg(any())]
pub mod defines;
#[cfg(any())]
pub mod barrel_imports;
#[cfg(any())]
pub mod LinkerGraph;
#[cfg(any())]
pub mod Chunk;
#[path = "defines-table.rs"]
pub mod defines_table;
#[cfg(any())]
pub mod transpiler;
#[cfg(any())]
pub mod ParseTask;
#[cfg(any())]
pub mod options;
#[cfg(any())]
pub mod LinkerContext;
#[cfg(any())]
pub mod bundle_v2;

// ---------------------------------------------------------------------------
// Minimal stub surface for downstream crates (B-1). Opaque newtypes + todo!()
// bodies; real impls live in the gated modules above and will be un-gated in
// B-2.
// ---------------------------------------------------------------------------

/// Stub: see gated `bundle_v2` module.
pub struct BundleV2(());
/// Stub: see gated `transpiler` module.
pub struct Transpiler(());
/// Stub: see gated `options` module.
pub struct BundleOptions(());
/// Stub: see gated `OutputFile` module.
pub struct OutputFile(());
/// Stub: see gated `Chunk` module.
pub struct Chunk(());
/// Stub: see gated `LinkerContext` module.
pub struct LinkerContext(());
/// Stub: see gated `LinkerGraph` module.
pub struct LinkerGraph(());
pub use Graph::Graph as GraphStruct;
/// Stub: see gated `ParseTask` module.
pub struct ParseTask(());
/// Stub: see gated `entry_points` module.
pub struct EntryPoint(());
/// Stub: see gated `defines` module.
pub struct Define(());
/// Stub: see gated `cache` module.
pub struct Cache(());
/// Stub: see gated `ThreadPool` module.
pub struct ThreadPool(());
/// Stub: defined in gated `bundle_v2` module (`bundle_v2.zig:AdditionalFile`).
pub enum AdditionalFile {
    SourceIndex(u32),
    OutputFile(u32),
}

// Re-export stub modules under their original names so `bun_bundler::options::X`
// style paths resolve to *something* during B-1.
pub mod options {
    pub use super::BundleOptions;
    pub type Options = super::BundleOptions;
    // Type-only enums live in `bun_options_types` (lower tier); re-export here so
    // intra-crate `crate::options::Loader` paths resolve while the full `options`
    // module remains gated.
    pub use bun_options_types::BundleEnums::{Loader, Target};
    pub use super::OutputFile;
}
pub mod transpiler {
    pub use super::Transpiler;
    /// Stub: plugin runner placeholder.
    pub struct PluginRunner(());
}
pub mod bundle_v2 {
    pub use super::BundleV2;
}
