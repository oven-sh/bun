#![feature(inherent_associated_types)]
#![feature(adt_const_params, allocator_api, thread_local)]
#![allow(incomplete_features)] // inherent_associated_types — used only for the ThreadPool::Worker path
#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]

pub use bun_resolver::fs as bun_fs;
pub use bun_resolver::node_fallbacks as bun_node_fallbacks;

pub mod perf {
    pub use bun_perf::{Ctx, PerfEvent};

    #[inline]
    pub(crate) fn trace(_name: &'static str) -> Ctx {
        bun_perf::trace(PerfEvent::_Stub)
    }
}

pub mod bun_css {
    pub use ::bun_css::css_modules::Config as CssModuleConfig;
    pub use ::bun_css::css_parser::LayerName;
    pub use ::bun_css::*;
}

pub use crate::HTMLScanner as html_scanner;

pub(crate) mod index {
    pub(crate) use bun_ast::IndexInt as Int;
}
pub(crate) mod part {
    pub(crate) use bun_ast::PartList as List;
}
pub(crate) mod import_record {
    pub(crate) use bun_ast::import_record::List;
}

pub(crate) type JSAst<'a> = crate::BundledAst<'a>;
pub(crate) use bun_ast::UseDirective;
pub(crate) use bun_ast::{Part, Ref};
pub use bun_js_printer::MangledProps;
pub use options_impl::PathTemplate;

pub use HTMLImportManifest::html_import_manifest;
pub use bun_core::cheap_prefix_normalizer;
pub use bundle_v2::{
    CompileResult, CompileResultForSourceMap, ContentHasher, DeclInfo, DeclInfoKind, EventLoop,
    ImportTracker, PartRange, StableRef, WrapKind, generic_path_with_pretty_initialized,
    target_from_hashbang,
};
pub use chunk::{
    CrossChunkImport, CrossChunkImportItem, CrossChunkImportItemList, bun_renamer,
    cross_chunk_import,
};
pub use linker_graph::{
    ExportData, ImportData, JSMeta, RefImportData, ResolvedExports, TopLevelSymbolToParts,
    entry_point, js_meta,
};

/// `MultiArrayList` SoA column-accessor traits, gathered so a single
/// `use crate::mal_prelude::*;` brings every `items_<field>()` set into scope.
pub mod mal_prelude {
    pub use crate::Graph::InputFileColumns as _;
    pub use crate::bundle_v2::CompileResultForSourceMapColumns as _;
    pub use crate::bundled_ast::BundledAstColumns as _;
    pub use crate::linker_graph::FileColumns as _;
    pub use crate::linker_graph::entry_point::EntryPointColumns as _;
    pub use crate::linker_graph::js_meta::JSMetaColumns as _;
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
pub mod bundle_v2;
#[path = "Chunk.rs"]
pub mod chunk;
pub mod defines;
pub mod linker;
#[path = "LinkerContext.rs"]
pub mod linker_context_mod;
#[path = "LinkerGraph.rs"]
pub mod linker_graph;
#[path = "options.rs"]
pub mod options_impl;
#[path = "ParseTask.rs"]
pub mod parse_task;
pub mod transpiler;

/// `linker_context/` submodule directory. Declared inline (no `mod.rs`).
pub mod linker_context {
    #[path = "scanImportsAndExports.rs"]
    pub mod scan_imports_and_exports;

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
    //    resolves at every submodule call-site.
    pub use crate::linker_context_mod::{
        ChunkMeta, GenerateChunkCtx, LinkerContext, PendingPartRange,
    };

    pub use output_file_list_builder::OutputFileList as OutputFileListBuilder;
    pub use static_route_visitor::StaticRouteVisitor;
}

// ---------------------------------------------------------------------------
// Public surface for downstream crates. Re-exports the real types from the
// modules above.
// ---------------------------------------------------------------------------

pub use Graph::Graph as GraphStruct;
/// See `bundle_v2`.
pub use bundle_v2::BundleV2;
/// See `chunk` module.
pub use chunk::Chunk;
pub use defines::{DefineDataExt, DefineExt};
/// See `linker` module.
pub use linker::Linker;
/// See `linker_context_mod` module.
pub use linker_context_mod::LinkerContext;
/// See `linker_graph` module.
pub use linker_graph::LinkerGraph;
/// `EntryPoint::Kind` is an inherent associated type on the struct (not a
/// sibling module — that would collide with this re-export).
pub use linker_graph::entry_point::EntryPoint;
/// See `options_impl`.
pub use options_impl::BundleOptions;
pub use output_file::OutputFile;
/// See `parse_task` module.
pub use parse_task::ParseTask;
/// See `thread_pool` module.
pub use thread_pool::{ThreadPool, Worker};
/// See `transpiler`.
pub use transpiler::Transpiler;
pub enum AdditionalFile {
    SourceIndex(u32),
    OutputFile(u32),
}

/// `bun_ast::Index` — source-index newtype, re-exported for crate-wide use.
pub(crate) use bun_ast::{Index, IndexInt};

// Re-export the `options` module. `Loader`/`Target` live in
// `bun_options_types::bundle_enums` — `options_impl` re-exports the canonical
// defs, so there is exactly ONE nominal type for each across
// bundler/resolver/js_parser. Bundler-only behaviour hangs off
// `TargetExt`/`LoaderExt` extension traits in `options_impl`.
pub mod options {
    pub use super::OutputFile;
    pub use super::options_impl::*;
    pub use super::output_file::BakeExtra;
    pub use super::output_file::IndexOptional;
    /// `OutputFile.init` argument struct.
    pub use super::output_file::Options as OutputFileInit;
    pub use super::output_file::OptionsData as OutputFileData;
    pub use super::output_file::Value as OutputValue;
    pub use super::output_file::Value as OutputFileValue;
    pub use bun_dotenv::DotEnvBehavior as EnvBehavior;
    pub type Options<'a> = super::BundleOptions<'a>;

    /// Output kind of a build artifact (`OutputFile.output_kind`).
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

    /// Which graph an output belongs to.
    /// Re-export of the canonical def in `crate::bake_types` (bundle_v2.rs).
    pub use crate::bake_types::Side;

    // `Env`, `EnvEntry`, `RouteConfig`, `jsx`/`JSX` are intentionally NOT
    // redefined here — the `pub use super::options_impl::*` glob above exposes
    // the single canonical defs (options.rs:1141/2493/2501/2722). The previous
    // inline shadows produced 4+ incompatible `jsx::Pragma`/`Runtime` types and
    // a `&'static [&'static [u8]]` `factory`/`fragment` that could not hold the
    // heap allocation from `member_list_to_components_if_different`
    // without `Box::leak`.
}

/// Re-export so `crate::RuntimeTranspilerCache` resolves for `transpiler::ParseOptions`
/// and downstream callers (`jsc_hooks` / `RuntimeTranspilerStore`). The struct
/// is canonical in `bun_js_parser`.
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

// ── dev-server dispatch (crate root; re-exported through `bundle_v2::dispatch`) ──

/// Concrete callbacks vtable for `bake::DevServer` (bun_runtime). The runtime
/// owns the single static instance (dev_server/mod.rs) and constructs the
/// handle in `DevServer::bundler_handle()`. Replaces the former link-time
/// `__BUN_DEV_SERVER_HANDLE_VTABLE` extern-static dispatch — the dependency
/// is explicit data flow now.
/// Every fn receives the erased `*mut DevServer` first; bodies uphold their
/// own thread-safety (same contract as before).
pub struct DevServerVTable {
    pub barrel_needed_exports: unsafe fn(
        *mut (),
    ) -> *mut bun_collections::StringArrayHashMap<
        bun_collections::StringHashMap<()>,
    >,
    pub log_for_resolution_failures:
        unsafe fn(*mut (), abs_path: &[u8], graph: bake_types::Graph) -> *mut bun_ast::Log,
    pub finalize_bundle: unsafe fn(
        *mut (),
        bv2: *mut bundle_v2::BundleV2<'_>,
        result: *mut bundle_v2::DevServerOutput<'_>,
    ) -> Result<(), bun_core::Error>,
    pub handle_parse_task_failure: unsafe fn(
        *mut (),
        err: bun_core::Error,
        graph: bake_types::Graph,
        abs_path: &[u8],
        log: *const bun_ast::Log,
        bv2: *mut bundle_v2::BundleV2<'_>,
    ) -> Result<(), bun_core::Error>,
    pub put_or_overwrite_asset: unsafe fn(
        *mut (),
        path: *const (),
        contents: &[u8],
        content_hash: u64,
    ) -> Result<(), bun_core::Error>,
    pub track_resolution_failure: unsafe fn(
        *mut (),
        import_source: &[u8],
        specifier: &[u8],
        renderer: bake_types::Graph,
        loader: bun_ast::Loader,
    ) -> Result<(), bun_core::Error>,
    pub is_file_cached: unsafe fn(
        *mut (),
        abs_path: &[u8],
        side: bake_types::Graph,
    ) -> Option<bake_types::CacheEntry>,
    pub asset_hash: unsafe fn(*mut (), abs_path: &[u8]) -> Option<u64>,
    pub current_bundle_start_data: unsafe fn(*mut ()) -> *mut (),
    pub register_barrel_with_deferrals:
        unsafe fn(*mut (), path: &[u8]) -> Result<(), bun_core::Error>,
    pub register_barrel_export: unsafe fn(*mut (), barrel_path: &[u8], alias: &[u8]),
}

/// Typed handle over the erased `*mut bake::DevServer` plus the
/// owner-provided method table.
#[derive(Copy, Clone)]
pub struct DevServerHandle {
    pub owner: *mut (),
    pub vtable: &'static DevServerVTable,
}

impl DevServerHandle {
    /// SAFETY: `owner` must be the live `*mut bake::DevServer` the vtable's
    /// fns expect, and must remain live for every dispatch through the
    /// returned handle. This is the only place the caller writes `unsafe` for
    /// this interface — the dispatch methods are safe given this precondition.
    #[inline]
    pub unsafe fn new<T: ?Sized>(owner: *mut T, vtable: &'static DevServerVTable) -> Self {
        Self {
            owner: owner.cast::<()>(),
            vtable,
        }
    }

    #[inline]
    pub fn barrel_needed_exports(
        &self,
    ) -> *mut bun_collections::StringArrayHashMap<bun_collections::StringHashMap<()>> {
        // SAFETY: established by `unsafe fn new()`.
        unsafe { (self.vtable.barrel_needed_exports)(self.owner) }
    }

    #[inline]
    pub fn log_for_resolution_failures(
        &self,
        abs_path: &[u8],
        graph: bake_types::Graph,
    ) -> *mut bun_ast::Log {
        // SAFETY: established by `unsafe fn new()`.
        unsafe { (self.vtable.log_for_resolution_failures)(self.owner, abs_path, graph) }
    }

    /// `bv2`/`result` are forwarded to the dev server verbatim; this method
    /// never dereferences them (see `unsafe fn new` for the owner contract).
    #[inline]
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub fn finalize_bundle(
        &self,
        bv2: *mut bundle_v2::BundleV2<'_>,
        result: *mut bundle_v2::DevServerOutput<'_>,
    ) -> Result<(), bun_core::Error> {
        // SAFETY: established by `unsafe fn new()`.
        unsafe { (self.vtable.finalize_bundle)(self.owner, bv2, result) }
    }

    /// `log`/`bv2` are forwarded to the dev server verbatim; this method never
    /// dereferences them (see `unsafe fn new` for the owner contract).
    #[inline]
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub fn handle_parse_task_failure(
        &self,
        err: bun_core::Error,
        graph: bake_types::Graph,
        abs_path: &[u8],
        log: *const bun_ast::Log,
        bv2: *mut bundle_v2::BundleV2<'_>,
    ) -> Result<(), bun_core::Error> {
        // SAFETY: established by `unsafe fn new()`.
        unsafe {
            (self.vtable.handle_parse_task_failure)(self.owner, err, graph, abs_path, log, bv2)
        }
    }

    /// `path` is an erased pointer forwarded to the dev server verbatim; this
    /// method never dereferences it (see `unsafe fn new` for the owner contract).
    #[inline]
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub fn put_or_overwrite_asset(
        &self,
        path: *const (),
        contents: &[u8],
        content_hash: u64,
    ) -> Result<(), bun_core::Error> {
        // SAFETY: established by `unsafe fn new()`.
        unsafe { (self.vtable.put_or_overwrite_asset)(self.owner, path, contents, content_hash) }
    }

    #[inline]
    pub fn track_resolution_failure(
        &self,
        import_source: &[u8],
        specifier: &[u8],
        renderer: bake_types::Graph,
        loader: bun_ast::Loader,
    ) -> Result<(), bun_core::Error> {
        // SAFETY: established by `unsafe fn new()`.
        unsafe {
            (self.vtable.track_resolution_failure)(
                self.owner,
                import_source,
                specifier,
                renderer,
                loader,
            )
        }
    }

    #[inline]
    pub fn is_file_cached(
        &self,
        abs_path: &[u8],
        side: bake_types::Graph,
    ) -> Option<bake_types::CacheEntry> {
        // SAFETY: established by `unsafe fn new()`.
        unsafe { (self.vtable.is_file_cached)(self.owner, abs_path, side) }
    }

    #[inline]
    pub fn asset_hash(&self, abs_path: &[u8]) -> Option<u64> {
        // SAFETY: established by `unsafe fn new()`.
        unsafe { (self.vtable.asset_hash)(self.owner, abs_path) }
    }

    #[inline]
    pub fn current_bundle_start_data(&self) -> *mut () {
        // SAFETY: established by `unsafe fn new()`.
        unsafe { (self.vtable.current_bundle_start_data)(self.owner) }
    }

    #[inline]
    pub fn register_barrel_with_deferrals(&self, path: &[u8]) -> Result<(), bun_core::Error> {
        // SAFETY: established by `unsafe fn new()`.
        unsafe { (self.vtable.register_barrel_with_deferrals)(self.owner, path) }
    }

    #[inline]
    pub fn register_barrel_export(&self, barrel_path: &[u8], alias: &[u8]) {
        // SAFETY: established by `unsafe fn new()`.
        unsafe { (self.vtable.register_barrel_export)(self.owner, barrel_path, alias) }
    }
}
// SAFETY: the handle is `{ owner: *mut (), vtable: &'static _ }`; the raw
// pointer is what defeats the auto-impl. `owner` is the single per-process
// `bake::DevServer` (established at `unsafe fn new()`), which outlives every
// bundler worker thread that carries this handle; thread-safety of each
// dispatched method is upheld by the vtable shim bodies in
// `bake::dev_server`, not by the handle itself.
unsafe impl Send for DevServerHandle {}
// SAFETY: see `Send` above — sharing the erased pointer + vtable is sound for
// the same reason.
unsafe impl Sync for DevServerHandle {}

// `OutputFile.Options` field defaults. Kept here rather than in `OutputFile.rs` so the
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
