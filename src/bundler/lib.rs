#![feature(inherent_associated_types)]
#![feature(adt_const_params, allocator_api)]
#![allow(incomplete_features)] // inherent_associated_types — used only for ThreadPool::Worker path compat with Zig
#![allow(
    unused,
    non_snake_case,
    non_camel_case_types,
    non_upper_case_globals,
    clippy::all
)]
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
    pub use crate::bundled_ast::BundledAstColumns as _;
    pub use crate::linker_graph::FileColumns as _;
    pub use crate::ungate_support::CompileResultForSourceMapColumns as _;
    pub use crate::ungate_support::entry_point::EntryPointColumns as _;
    pub use crate::ungate_support::js_meta::JSMetaColumns as _;
    pub use bun_ast::server_component_boundary::ServerComponentBoundaryColumns as _;
}

pub mod DeferredBatchTask;
pub mod Graph;
pub mod IndexStringMap;
pub mod PathToSourceIndexMap;

pub mod BundleThread;

pub mod ServerComponentParseTask;

pub mod HTMLImportManifest;

pub mod HTMLScanner;
pub mod cache;
pub mod entry_points;
#[path = "OutputFile.rs"]
pub mod output_file;
#[path = "ThreadPool.rs"]
pub mod thread_pool;

pub mod AstBuilder;
pub mod analyze_transpiled_module;
pub mod bundled_ast;
pub use bundled_ast::BundledAst;
pub mod barrel_imports;
#[path = "Chunk.rs"]
pub mod chunk;
pub mod defines;
pub mod linker;
/// Real `LinkerGraph` (un-gated B-2).
#[path = "LinkerGraph.rs"]
pub mod linker_graph;
// Moved down to `bun_js_parser::defines_table` so the parser reads its own
// const without a cross-crate hook. Re-export for existing callers.
pub use bun_js_parser::defines_table;
pub mod bundle_v2;
#[path = "LinkerContext.rs"]
pub mod linker_context_mod;
#[path = "options.rs"]
pub mod options_impl;
#[path = "ParseTask.rs"]
pub mod parse_task;
pub mod transpiler;

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
    pub use crate::linker_context_mod::{
        ChunkMeta, GenerateChunkCtx, LinkerContext, PendingPartRange,
    };
    /// `Output.scoped(.LinkerCtx, .visible)` — re-export the canonical scope
    /// static + `debug!` macro from `linker_context_mod` so every
    /// `linker_context/*` submodule logs under one `[linkerctx]` tag without
    /// redeclaring the scope.
    pub(crate) use crate::linker_context_mod::{LinkerCtx, debug};
    pub use output_file_list_builder::OutputFileList as OutputFileListBuilder;
    pub use static_route_visitor::StaticRouteVisitor;
}

// ---------------------------------------------------------------------------
// Public surface for downstream crates. Re-exports the real types from the
// modules above (formerly opaque newtypes during the B-1 staging phase).
// ---------------------------------------------------------------------------

pub use Graph::Graph as GraphStruct;
/// Real `BundleV2` (un-gated B-2). See `bundle_v2`.
pub use bundle_v2::BundleV2;
/// Real `Chunk` (un-gated B-2). See `chunk` module.
pub use chunk::Chunk;
pub use defines::{Define, DefineDataExt, DefineExt};
/// Real `Linker` (un-gated B-2). See `linker` module.
pub use linker::Linker;
/// Real `LinkerContext` (un-gated B-2). See `linker_context_mod` module.
pub use linker_context_mod::LinkerContext;
/// Real `LinkerGraph` (un-gated B-2). See `linker_graph` module.
pub use linker_graph::LinkerGraph;
/// Real `BundleOptions` (un-gated B-2). See `options_impl`.
pub use options_impl::BundleOptions;
pub use output_file::OutputFile;
/// Real `ParseTask` (un-gated B-2). See `parse_task` module.
pub use parse_task::ParseTask;
/// Real `ThreadPool` (un-gated B-2). See `thread_pool` module.
pub use thread_pool::{ThreadPool, Worker};
/// Real `Transpiler` (un-gated B-2). See `transpiler`.
pub use transpiler::Transpiler;
/// Real `EntryPoint` struct (un-gated B-2). `EntryPoint::Kind` is an inherent
/// associated type on the struct (not a sibling module — that would collide
/// with this re-export).
pub use ungate_support::entry_point::EntryPoint;
/// Stub: defined in gated `bundle_v2` module (`bundle_v2.zig:AdditionalFile`).
pub enum AdditionalFile {
    SourceIndex(u32),
    OutputFile(u32),
}

/// `bun.ast.Index` — source-index newtype. Re-exported here because every
/// `*.zig` in this crate aliases it as `pub const Index = bun.ast.Index`.
pub(crate) use bun_ast::{Index, IndexInt};

// Re-export the real `options` module (un-gated B-2). `Loader`/`Target` were
// MOVE_DOWN'd to `bun_options_types::bundle_enums` in B-3 — `options_impl`
// re-exports the canonical defs, so there is exactly ONE nominal type for each
// across bundler/resolver/js_parser. Bundler-only behaviour hangs off
// `TargetExt`/`LoaderExt` extension traits in `options_impl`.
pub mod options {
    pub use super::OutputFile;
    pub use super::options_impl::*;
    pub use super::output_file::BakeExtra;
    pub use super::output_file::IndexOptional;
    /// `OutputFile.init` argument struct (`options.zig:OutputFile.Options`).
    pub use super::output_file::Options as OutputFileInit;
    pub use super::output_file::OptionsData as OutputFileData;
    pub use super::output_file::Value as OutputValue;
    pub use super::output_file::Value as OutputFileValue;
    /// `options.Format` — many ported call-sites spell this `OutputFormat`.
    pub use bun_options_types::Format as OutputFormat;
    pub use bun_options_types::schema::api::DotEnvBehavior as EnvBehavior;
    pub type Options<'a> = super::BundleOptions<'a>;

    /// `jsc.API.BuildArtifact.OutputKind` (JSBundler.zig:1799). Re-exported by
    /// `options.zig` callers via `OutputFile.output_kind`.
    ///
    /// `IntoStaticStr` provides the JS-facing tag (`"entry-point"` etc.) so
    /// `bun_runtime::api::BuildArtifact` can spell `<&str>::from(kind)` without
    /// a duplicate enum.
    #[repr(u8)]
    #[derive(Clone, Copy, PartialEq, Eq, Debug, Default, strum::IntoStaticStr)]
    pub enum OutputKind {
        #[default]
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
    /// Re-export of the canonical def in `crate::bake_types` (bundle_v2.rs).
    pub use crate::bake_types::Side;

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

/// Re-export so `crate::RuntimeTranspilerCache` resolves for `transpiler::ParseOptions`
/// and downstream callers (`jsc_hooks` / `RuntimeTranspilerStore`). B-3: the
/// struct is canonical in `bun_js_parser`; the bundler-tier `disabled`/
/// `set_disabled` live on `RuntimeTranspilerCacheExt`.
pub use cache::RuntimeTranspilerCacheExt;
pub use cache::Set as Cache;

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

// ── link-interfaces (must be at crate root so `$crate::__alias` resolves) ──
// Re-exported through `bundle_v2::dispatch` for existing call sites.

// Erased handle to `bake::DevServer`. PORT NOTE: Zig takes
// `*const DevServerOutput` but mutates through the `chunks: []Chunk` slice it
// holds; in Rust the struct stores `&'a mut [Chunk]`, hence `*mut`.
bun_dispatch::link_interface! {
    pub DevServerHandle[Bake] {
        fn barrel_needed_exports() -> *mut bun_collections::StringArrayHashMap<bun_collections::StringHashMap<()>>;
        fn log_for_resolution_failures(abs_path: &[u8], graph: bake_types::Graph) -> *mut bun_ast::Log;
        fn finalize_bundle(bv2: *mut bundle_v2::BundleV2<'_>, result: *mut bundle_v2::DevServerOutput<'_>) -> Result<(), bun_core::Error>;
        fn handle_parse_task_failure(err: bun_core::Error, graph: bake_types::Graph, abs_path: &[u8], log: *const bun_ast::Log, bv2: *mut bundle_v2::BundleV2<'_>) -> Result<(), bun_core::Error>;
        fn put_or_overwrite_asset(path: *const (), contents: &[u8], content_hash: u64) -> Result<(), bun_core::Error>;
        fn track_resolution_failure(import_source: &[u8], specifier: &[u8], renderer: bake_types::Graph, loader: bun_ast::Loader) -> Result<(), bun_core::Error>;
        fn is_file_cached(abs_path: &[u8], side: bake_types::Graph) -> Option<bake_types::CacheEntry>;
        fn asset_hash(abs_path: &[u8]) -> Option<u64>;
        fn current_bundle_start_data() -> *mut ();
        fn register_barrel_with_deferrals(path: &[u8]) -> Result<(), bun_core::Error>;
        fn register_barrel_export(barrel_path: &[u8], alias: &[u8]);
    }
}
unsafe impl Send for DevServerHandle {}
unsafe impl Sync for DevServerHandle {}

// VirtualMachine accessors for `normalize_specifier` / `get_loader_and_virtual_source`.
// `bun_runtime::jsc_hooks` provides the `Runtime` arm.
bun_dispatch::link_interface! {
    pub VmLoaderCtx[Runtime] {
        fn origin_host() -> &'static [u8];
        fn origin_path() -> &'static [u8];
        fn loaders() -> *const bun_collections::StringArrayHashMap<bun_ast::Loader>;
        fn eval_source() -> Option<*const bun_ast::Source>;
        fn main() -> &'static [u8];
        fn read_dir_info_package_json(dir: &[u8]) -> Option<*const bun_resolver::PackageJSON>;
        fn is_blob_url(specifier: &[u8]) -> bool;
        fn resolve_blob(specifier: &[u8]) -> Option<options::OpaqueBlob>;
        fn blob_loader(blob: options::OpaqueBlob) -> Option<bun_ast::Loader>;
        fn blob_file_name(blob: options::OpaqueBlob) -> Option<&'static [u8]>;
        fn blob_needs_read_file(blob: options::OpaqueBlob) -> bool;
        fn blob_shared_view(blob: options::OpaqueBlob) -> &'static [u8];
        fn blob_deinit(blob: options::OpaqueBlob);
    }
}

// `OutputFile.Options` defaults (`options.zig:OutputFile.Options` field
// default-initializers). Kept here rather than in `OutputFile.rs` so the
// derive-free struct stays codegen-friendly while every `init(..)` call site
// can use struct-update syntax.
impl Default for output_file::OptionsData {
    fn default() -> Self {
        output_file::OptionsData::Buffer {
            data: Box::default(),
        }
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
