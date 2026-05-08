#![feature(inherent_associated_types)]
#![feature(adt_const_params, allocator_api)]
#![allow(incomplete_features)] // inherent_associated_types — used only for ThreadPool::Worker path compat with Zig
#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
#![warn(unused_must_use)]
// AUTOGEN: mod declarations only — real exports added in B-1.
//
// B-1 gate-and-stub: all Phase-A draft modules are gated behind ``
// so the crate compiles. Draft bodies are preserved on disk; un-gating happens
// in B-2 as lower-tier crate surfaces solidify.

// B-2 un-gate support: shared value types + crate-name shims for the
// freshly un-gated `Chunk` / `LinkerContext` / `ParseTask` modules.
pub mod ungate_support;
pub use ungate_support::*;

/// `MultiArrayList` SoA column-accessor traits, gathered so a single
/// `use crate::mal_prelude::*;` brings every `items_<field>()` set into scope.
pub mod mal_prelude {
    pub use crate::Graph::InputFileColumns as _;
    pub use crate::linker_graph::FileColumns as _;
    pub use crate::ungate_support::js_meta::JSMetaColumns as _;
    pub use crate::ungate_support::entry_point::EntryPointColumns as _;
    pub use crate::ungate_support::CompileResultForSourceMapColumns as _;
    pub use bun_js_parser::ast::bundled_ast::BundledAstColumns as _;
    pub use bun_js_parser::ast::server_component_boundary::ServerComponentBoundaryColumns as _;
}

pub mod IndexStringMap;
pub mod PathToSourceIndexMap;
pub mod DeferredBatchTask;
pub mod Graph;

pub mod BundleThread;

pub mod ServerComponentParseTask;

pub mod HTMLImportManifest;

pub mod HTMLScanner;
#[path = "OutputFile.rs"]
pub mod output_file;
pub mod cache;
#[path = "ThreadPool.rs"]
pub mod thread_pool;
pub mod entry_points;

pub mod AstBuilder;
pub mod analyze_transpiled_module;
pub mod linker;
pub mod defines;
pub mod barrel_imports;
/// Real `LinkerGraph` (un-gated B-2).
#[path = "LinkerGraph.rs"]
pub mod linker_graph;
#[path = "Chunk.rs"]
pub mod chunk;
// Moved down to `bun_js_parser::defines_table` so the parser reads its own
// const without a cross-crate hook. Re-export for existing callers.
pub use bun_js_parser::defines_table;
pub mod transpiler;
#[path = "ParseTask.rs"]
pub mod parse_task;
#[path = "options.rs"]
pub mod options_impl;
#[path = "LinkerContext.rs"]
pub mod linker_context_mod;
pub mod bundle_v2;

/// `linker_context/` submodule directory. Un-gated B-2: only
/// `scanImportsAndExports.rs` so far; remaining files un-gate as their
/// `LinkerGraph` SoA accessors land. Declared inline (no `mod.rs`) so paths
/// stay 1:1 with the Zig directory.
pub mod linker_context {
    #[path = "scanImportsAndExports.rs"]
    pub mod scan_imports_and_exports;

    // ── Gated drafts (B-1). Each maps 1:1 to a `.zig` of the same basename.
    //    Un-gate per-file as the crate-root surface they import (Fs / JSMeta /
    //    ImportData / GenerateChunkCtx / thread_pool::Worker / …) lands.
    //    Re-exports from these into `linker_context::*` stay blocked until
    //    un-gate; downstream callers go through `LinkerContext` methods.
    
    #[path = "computeChunks.rs"]
    pub mod compute_chunks;
    
    #[path = "computeCrossChunkDependencies.rs"]
    pub mod compute_cross_chunk_dependencies;
    
    #[path = "convertStmtsForChunk.rs"]
    pub mod convert_stmts_for_chunk;
    
    #[path = "convertStmtsForChunkForDevServer.rs"]
    pub mod convert_stmts_for_chunk_for_dev_server;
    
    #[path = "doStep5.rs"]
    pub mod do_step5;
    
    #[path = "findAllImportedPartsInJSOrder.rs"]
    pub mod find_all_imported_parts_in_js_order;
    
    #[path = "findImportedCSSFilesInJSOrder.rs"]
    pub mod find_imported_css_files_in_js_order;
    
    #[path = "findImportedFilesInCSSOrder.rs"]
    pub mod find_imported_files_in_css_order;
    
    #[path = "generateChunksInParallel.rs"]
    pub mod generate_chunks_in_parallel;
    
    #[path = "generateCodeForFileInChunkJS.rs"]
    pub mod generate_code_for_file_in_chunk_js;
    
    #[path = "generateCodeForLazyExport.rs"]
    pub mod generate_code_for_lazy_export;
    
    #[path = "generateCompileResultForCssChunk.rs"]
    pub mod generate_compile_result_for_css_chunk;
    
    #[path = "generateCompileResultForHtmlChunk.rs"]
    pub mod generate_compile_result_for_html_chunk;
    
    #[path = "generateCompileResultForJSChunk.rs"]
    pub mod generate_compile_result_for_js_chunk;
    
    #[path = "postProcessCSSChunk.rs"]
    pub mod post_process_css_chunk;
    
    #[path = "postProcessHTMLChunk.rs"]
    pub mod post_process_html_chunk;
    
    #[path = "postProcessJSChunk.rs"]
    pub mod post_process_js_chunk;
    
    #[path = "prepareCssAstsForChunk.rs"]
    pub mod prepare_css_asts_for_chunk;
    
    #[path = "renameSymbolsInChunk.rs"]
    pub mod rename_symbols_in_chunk;
    
    #[path = "writeOutputFilesToDisk.rs"]
    pub mod write_output_files_to_disk;
    
    #[path = "MetafileBuilder.rs"]
    pub mod metafile_builder;
    
    #[path = "OutputFileListBuilder.rs"]
    pub mod output_file_list_builder;
    
    #[path = "StaticRouteVisitor.rs"]
    pub mod static_route_visitor;

    // ── Re-exports so `crate::linker_context::{debug, LinkerContext, …}`
    //    resolves at every submodule call-site (mirrors Zig's `@import("./LinkerContext.zig")`).
    pub use crate::linker_context_mod::{LinkerContext, GenerateChunkCtx, PendingPartRange, ChunkMeta};
    pub use output_file_list_builder::OutputFileList as OutputFileListBuilder;
    pub use static_route_visitor::StaticRouteVisitor;
    /// `Output.scoped(.LinkerCtx, .visible)` — shared scope so every
    /// `linker_context/*` submodule logs under one `[linkerctx]` tag.
    bun_core::declare_scope!(LinkerCtx, visible);
    /// Free fn so `linker_context::debug(format_args!(..))` works from sibling
    /// modules without re-declaring the scope (mirrors Zig's `const debug =
    /// Output.scoped(.LinkerCtx, .visible)`).
    #[inline]
    pub fn debug(args: core::fmt::Arguments<'_>) {
        if cfg!(debug_assertions) && LinkerCtx.is_visible() {
            LinkerCtx.log(args);
        }
    }
}

// ---------------------------------------------------------------------------
// Public surface for downstream crates. Re-exports the real types from the
// modules above (formerly opaque newtypes during the B-1 staging phase).
// ---------------------------------------------------------------------------

/// Real `BundleV2` (un-gated B-2). See `bundle_v2`.
pub use bundle_v2::BundleV2;
/// Real `Transpiler` (un-gated B-2). See `transpiler`.
pub use transpiler::Transpiler;
/// Real `BundleOptions` (un-gated B-2). See `options_impl`.
pub use options_impl::BundleOptions;
pub use output_file::OutputFile;
/// Real `Chunk` (un-gated B-2). See `chunk` module.
pub use chunk::Chunk;
/// Real `LinkerContext` (un-gated B-2). See `linker_context_mod` module.
pub use linker_context_mod::LinkerContext;
/// Real `Linker` (un-gated B-2). See `linker` module.
pub use linker::Linker;
/// Real `LinkerGraph` (un-gated B-2). See `linker_graph` module.
pub use linker_graph::LinkerGraph;
pub use Graph::Graph as GraphStruct;
/// Real `ParseTask` (un-gated B-2). See `parse_task` module.
pub use parse_task::ParseTask;
/// Real `EntryPoint` struct (un-gated B-2). `EntryPoint::Kind` is an inherent
/// associated type on the struct (not a sibling module — that would collide
/// with this re-export).
pub use ungate_support::entry_point::EntryPoint;
pub use defines::{Define, DefineExt, DefineDataExt};
/// Real `ThreadPool` (un-gated B-2). See `thread_pool` module.
pub use thread_pool::{ThreadPool, Worker};
/// Stub: defined in gated `bundle_v2` module (`bundle_v2.zig:AdditionalFile`).
pub enum AdditionalFile {
    SourceIndex(u32),
    OutputFile(u32),
}

/// `bun.ast.Index` — source-index newtype. Lives in `bun_options_types` (lower
/// tier) and is re-exported here because every `*.zig` in this crate aliases it
/// as `pub const Index = bun.ast.Index`.
pub use bun_options_types::BundleEnums::{Index, IndexInt};

// Re-export the real `options` module (un-gated B-2). `Loader`/`Target` were
// MOVE_DOWN'd to `bun_options_types::BundleEnums` in B-3 — `options_impl`
// re-exports the canonical defs, so there is exactly ONE nominal type for each
// across bundler/resolver/js_parser. Bundler-only behaviour hangs off
// `TargetExt`/`LoaderExt` extension traits in `options_impl`.
pub mod options {
    pub use super::options_impl::*;
    // Explicit re-export (redundant with the glob above post-B-3) kept so the
    // public-API surface of `bun_bundler::options::{Loader,Target}` is stable
    // even if `options_impl`'s internal re-exports churn.
    pub use bun_options_types::BundleEnums::{Loader, LoaderHashTable, Target};
    pub use bun_options_types::schema::api::DotEnvBehavior as EnvBehavior;
    pub use super::OutputFile;
    pub use super::output_file::Value as OutputValue;
    pub use super::output_file::Value as OutputFileValue;
    /// `OutputFile.init` argument struct (`options.zig:OutputFile.Options`).
    pub use super::output_file::Options as OutputFileInit;
    pub use super::output_file::OptionsData as OutputFileData;
    pub use super::output_file::BakeExtra;
    pub use super::output_file::IndexOptional;
    /// `options.Format` — many ported call-sites spell this `OutputFormat`.
    pub use bun_options_types::Format as OutputFormat;
    pub type Options<'a> = super::BundleOptions<'a>;

    /// `jsc.API.BuildArtifact.OutputKind` (JSBundler.zig:1799). Re-exported by
    /// `options.zig` callers via `OutputFile.output_kind`.
    ///
    /// `IntoStaticStr` provides the JS-facing tag (`"entry-point"` etc.) so
    /// `bun_runtime::api::BuildArtifact` can spell `<&str>::from(kind)` without
    /// a duplicate enum.
    #[derive(Clone, Copy, PartialEq, Eq, Debug, strum::IntoStaticStr)]
    pub enum OutputKind {
        #[strum(serialize = "chunk")]
        Chunk,
        #[strum(serialize = "asset")]
        Asset,
        #[strum(serialize = "entry-point")]
        EntryPoint,
        #[strum(serialize = "sourcemap")]
        Sourcemap,
        #[strum(serialize = "bytecode")]
        Bytecode,
        #[strum(serialize = "module_info")]
        ModuleInfo,
        #[strum(serialize = "metafile-json")]
        MetafileJson,
        #[strum(serialize = "metafile-markdown")]
        MetafileMarkdown,
    }

    impl OutputKind {
        /// JSBundler.zig:1809.
        pub fn is_file_in_standalone_mode(self) -> bool {
            !matches!(
                self,
                OutputKind::Sourcemap
                    | OutputKind::Bytecode
                    | OutputKind::ModuleInfo
                    | OutputKind::MetafileJson
                    | OutputKind::MetafileMarkdown
            )
        }
    }

    /// `bun.bake.Side` (bake.zig:874) — which graph an output belongs to.
    #[repr(u8)]
    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    pub enum Side {
        Client = 0,
        Server = 1,
    }

    /// Name used by `resolver/package_json.rs::load_define_defaults` —
    /// alias of the canonical `options_impl::EnvEntry` brought in via the glob.
    pub type EnvDefault = EnvEntry;

    /// Legacy `options::Framework` (referenced by `resolver/package_json.zig`'s
    /// `FrameworkRouterPair`). The full struct is `bun.bake.Framework` which
    /// lives in a higher-tier crate; minimal real struct lives in `bake_types`.
    pub use crate::bake_types::Framework;

    // `Env`, `EnvEntry`, `RouteConfig`, `jsx`/`JSX` are intentionally NOT
    // redefined here — the `pub use super::options_impl::*` glob above exposes
    // the single canonical defs (options.rs:1141/2493/2501/2722). The previous
    // inline shadows produced 4+ incompatible `jsx::Pragma`/`Runtime` types and
    // a `&'static [&'static [u8]]` `factory`/`fragment` that could not hold the
    // heap allocation from `member_list_to_components_if_different`
    // (options.zig:1296) without `Box::leak` (PORTING.md §Forbidden patterns).
}

pub use cache::Set as Cache;
/// Re-export so `crate::RuntimeTranspilerCache` resolves for `transpiler::ParseOptions`
/// and downstream callers (`jsc_hooks` / `RuntimeTranspilerStore`). B-3: the
/// struct is canonical in `bun_js_parser`; the bundler-tier `put`/`disabled`/
/// `as_printer_ref` live on `RuntimeTranspilerCacheExt`.
pub use cache::{RuntimeTranspilerCache, RuntimeTranspilerCacheExt};

// ──────────────────────────────────────────────────────────────────────────
// Re-export the canonical `bake_types` defs from
// `bundle_v2` so there is exactly ONE nominal `Side`/`Graph`/`Framework` etc.
// across the crate (the previous inline copy here diverged and produced
// "expected `bake_types::Graph`, found `bake_types::Graph`" errors).
// ──────────────────────────────────────────────────────────────────────────
pub use bundle_v2::bake_types;

// ──────────────────────────────────────────────────────────────────────────
// Re-export the canonical `dispatch` module from
// `bundle_v2` (full vtable slot set) so there is one `DevServerHandle` type.
// ──────────────────────────────────────────────────────────────────────────
pub use bundle_v2::dispatch;

// `OutputFile.Options` defaults (`options.zig:OutputFile.Options` field
// default-initializers). Kept here rather than in `OutputFile.rs` so the
// derive-free struct stays codegen-friendly while every `init(..)` call site
// can use struct-update syntax.
impl Default for output_file::OptionsData {
    fn default() -> Self {
        output_file::OptionsData::Buffer { data: Box::default() }
    }
}
impl Default for output_file::Options {
    fn default() -> Self {
        output_file::Options {
            loader: options::Loader::default(),
            input_loader: options::Loader::default(),
            hash: None,
            source_map_index: None,
            bytecode_index: None,
            module_info_index: None,
            output_path: Box::default(),
            source_index: output_file::IndexOptional::NONE,
            size: None,
            input_path: Box::default(),
            display_size: 0,
            output_kind: options::OutputKind::Chunk,
            is_executable: false,
            data: output_file::OptionsData::default(),
            side: None,
            entry_point_index: None,
            referenced_css_chunks: Box::default(),
            bake_extra: output_file::BakeExtra::default(),
        }
    }
}
