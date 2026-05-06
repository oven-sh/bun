//! Port of src/bundler/LinkerContext.zig

use core::sync::atomic::{AtomicU32, Ordering};
use core::mem::offset_of;

use bun_core::{self as bun, Output, Environment, FeatureFlags, Error as BunError};
use bun_alloc::{Arena as Bump, AllocError};
use bun_collections::{BabyList, MultiArrayList, AutoBitSet, ArrayHashMap, HashMap};
use bun_logger as Logger;
use bun_logger::{Loc, Range, Data, Source, Log};
use bun_string::{strings, MutableString, string_joiner::StringJoiner};
use bun_sourcemap::{self as SourceMap, LineOffsetTable, SourceMapState, SourceMapPieces, SourceMapShifts, DebugIDFormatter};
// PORT NOTE: alias the *module* (not the `ThreadPool` struct) so
// `ThreadPoolLib::Task` / `ThreadPoolLib::Batch` resolve as nested items.
use bun_threading::{self as sync, thread_pool as ThreadPoolLib, WaitGroup};
use bun_options_types::{ImportRecord, ImportKind};
// TODO(b0): bake_types arrives from move-in (TYPE_ONLY → bundler)
use crate::bake_types as bake;
use crate::bun_css as css;

use bun_js_parser::{self as js_ast, Ref, Expr, Stmt, Part, Symbol, Binding, Dependency, NamedImport, TlaCheck, DeclaredSymbol, ExportsKind, BundledAst as JSAst};
// PORT NOTE: `crate::Index` (= `bun_options_types::BundleEnums::Index`) — the
// bundler's source-index newtype. `bun_js_parser::Index` is layout-identical
// but a distinct type; LinkerGraph/JSMeta/etc. are typed against the crate
// re-export, so use that here.
use crate::Index;
use bun_js_parser::{E, S, B, G};
use bun_js_printer::{self as js_printer, renamer};
use bun_js_parser::lexer as lex;

use bun_resolver::{self as _resolver, Resolver};
use bun_options_types::SideEffects;
use crate::bun_fs as Fs;
use crate::bun_node_fallbacks as NodeFallbackModules;
use crate::ungate_support::perf;

use crate::options::{self, Loader, Format, Target, SourceMapOption};
use crate::Graph::Graph;
use crate::{
    AdditionalFile, BundleV2, Chunk, CompileResult, CompileResultForSourceMap, ContentHasher,
    ImportTracker, LinkerGraph, MangledProps, PartRange,
    ServerComponentBoundary, StableRef, WrapKind, ThreadPool,
};

/// `bun.jsc.EventLoopHandle` (LinkerContext.zig:28). The real handle is a T6
/// JSC type; the linker only stores it to pass through to chunk-generation
/// tasks. Erased here to break the cycle (CYCLEBREAK GENUINE).
pub type EventLoop = Option<core::ptr::NonNull<()>>;

bun_core::declare_scope!(LinkerCtx, visible);
bun_core::declare_scope!(TreeShake, hidden);

// ══════════════════════════════════════════════════════════════════════════
// CYCLEBREAK(b0): vtable instance for `bun_crash_handler::BundleGenerateChunkVTable`
// (cold-path §Dispatch — crash trace only). crash_handler (T1) holds erased
// `(*const LinkerContext, *const Chunk, *const PartRange)`; bundler supplies
// the formatter that knows their layout. Mirrors src/crash_handler/crash_handler.zig:135.
// ══════════════════════════════════════════════════════════════════════════
#[cfg(feature = "show_crash_trace")]
pub static BUNDLE_GENERATE_CHUNK_VTABLE: bun_crash_handler::BundleGenerateChunkVTable =
    bun_crash_handler::BundleGenerateChunkVTable {
        fmt: |context, chunk, part_range, writer| {
            // SAFETY: erased pointers were constructed by `bundle_generate_chunk_action`
            // below from live `&LinkerContext` / `&Chunk` / `&PartRange`.
            let ctx = unsafe { &*(context as *const LinkerContext) };
            let chunk = unsafe { &*(chunk as *const Chunk) };
            let pr = unsafe { &*(part_range as *const PartRange) };
            // SAFETY: `parse_graph` is a backref into `BundleV2.graph`, valid for
            // the lifetime of the link step that constructed this Action.
            let parse_graph = unsafe { &*ctx.parse_graph };
            let sources = parse_graph.input_files.items_source();
            let entry = if pr.source_index.is_valid() {
                sources
                    .get(chunk.entry_point.source_index as usize)
                    .map(|s| bstr::BStr::new(&s.path.text))
            } else {
                None
            };
            let source = if pr.source_index.is_valid() {
                sources
                    .get(pr.source_index.get() as usize)
                    .map(|s| bstr::BStr::new(&s.path.text))
            } else {
                None
            };
            write!(
                writer,
                "generating bundler chunk\n  chunk entry point: {:?}\n  source: {:?}\n  part range: {}..{}",
                entry, source, pr.part_index_begin, pr.part_index_end,
            )
        },
    };

/// Helper for call-sites that previously wrote `Action::BundleGenerateChunk(.{...})`.
#[cfg(feature = "show_crash_trace")]
#[inline]
pub fn bundle_generate_chunk_action(
    ctx: &LinkerContext,
    chunk: &Chunk,
    part_range: &PartRange,
) -> bun_crash_handler::Action {
    bun_crash_handler::Action::BundleGenerateChunk(bun_crash_handler::BundleGenerateChunk {
        context: ctx as *const LinkerContext as *const (),
        chunk: chunk as *const Chunk as *const (),
        part_range: part_range as *const PartRange as *const (),
        vtable: &BUNDLE_GENERATE_CHUNK_VTABLE,
    })
}
#[cfg(not(feature = "show_crash_trace"))]
#[inline]
pub fn bundle_generate_chunk_action(
    _ctx: &LinkerContext,
    _chunk: &Chunk,
    _part_range: &PartRange,
) -> bun_crash_handler::Action {
    bun_crash_handler::Action::BundleGenerateChunk(())
}

macro_rules! debug {
    ($($arg:tt)*) => { bun_core::scoped_log!(LinkerCtx, $($arg)*) };
}
macro_rules! debug_tree_shake {
    ($($arg:tt)*) => { bun_core::scoped_log!(TreeShake, $($arg)*) };
}

// Re-exports from sibling modules in `linker_context/`.
// `LinkerGraph` SoA accessors are real now (`#[derive(MultiArrayElement)]` on
// `JSAst`/`JSMeta`/`File`); the submodule bodies un-gate against those. Module
// declarations live in `lib.rs::linker_context` — each re-export below is
// gated alongside its module declaration so partial un-gates compile.
pub use crate::linker_context::scan_imports_and_exports::scan_imports_and_exports;

 pub use crate::linker_context::output_file_list_builder as OutputFileListBuilder;
 pub use crate::linker_context::static_route_visitor as StaticRouteVisitor;
 pub use crate::linker_context::metafile_builder as MetafileBuilder;
 pub use crate::linker_context::compute_chunks::compute_chunks;
 pub use crate::linker_context::find_all_imported_parts_in_js_order::{find_all_imported_parts_in_js_order, find_imported_parts_in_js_order};
 pub use crate::linker_context::find_imported_files_in_css_order::find_imported_files_in_css_order;
 pub use crate::linker_context::find_imported_css_files_in_js_order::find_imported_css_files_in_js_order;
 pub use crate::linker_context::generate_code_for_lazy_export::generate_code_for_lazy_export;
 // do_step5 / create_exports_for_file are inherent methods on LinkerContext (see
 // `linker_context/doStep5.rs`), not free functions — no item re-export.
 pub use crate::linker_context::do_step5;
 pub use crate::linker_context::compute_cross_chunk_dependencies::compute_cross_chunk_dependencies;
 pub use crate::linker_context::post_process_js_chunk::post_process_js_chunk;
 pub use crate::linker_context::post_process_css_chunk::post_process_css_chunk;
 pub use crate::linker_context::post_process_html_chunk::post_process_html_chunk;
 pub use crate::linker_context::rename_symbols_in_chunk::rename_symbols_in_chunk;
 pub use crate::linker_context::generate_chunks_in_parallel::generate_chunks_in_parallel;
 pub use crate::linker_context::generate_compile_result_for_js_chunk::generate_compile_result_for_js_chunk;
 pub use crate::linker_context::generate_compile_result_for_css_chunk::generate_compile_result_for_css_chunk;
 pub use crate::linker_context::generate_compile_result_for_html_chunk::generate_compile_result_for_html_chunk;
 pub use crate::linker_context::prepare_css_asts_for_chunk::{prepare_css_asts_for_chunk, PrepareCssAstTask};
 pub use crate::linker_context::convert_stmts_for_chunk::convert_stmts_for_chunk;
 pub use crate::linker_context::convert_stmts_for_chunk_for_dev_server::convert_stmts_for_chunk_for_dev_server;
 pub use crate::linker_context::generate_code_for_file_in_chunk_js::generate_code_for_file_in_chunk_js;
 pub use crate::linker_context::write_output_files_to_disk::write_output_files_to_disk;

// TODO(port): DeferredBatchTask, ParseTask re-exports — Zig re-exports from bundle_v2
pub use crate::DeferredBatchTask::DeferredBatchTask;
pub use crate::ParseTask;

pub struct LinkerContext<'a> {
    pub parse_graph: *mut Graph,
    pub graph: LinkerGraph,
    pub log: &'a mut Log,

    pub resolver: *mut Resolver<'static>,
    pub cycle_detector: Vec<ImportTracker>,

    /// We may need to refer to the "__esm" and/or "__commonJS" runtime symbols
    pub cjs_runtime_ref: Ref,
    pub esm_runtime_ref: Ref,

    /// We may need to refer to the CommonJS "module" symbol for exports
    pub unbound_module_ref: Ref,

    /// We may need to refer to the "__promiseAll" runtime symbol
    pub promise_all_runtime_ref: Ref,

    pub options: LinkerOptions,

    pub r#loop: EventLoop,

    /// string buffer containing pre-formatted unique keys
    pub unique_key_buf: Box<[u8]>,

    /// string buffer containing prefix for each unique keys
    pub unique_key_prefix: Box<[u8]>,

    pub source_maps: SourceMapData,

    /// This will eventually be used for reference-counting LinkerContext
    /// to know whether or not we can free it safely.
    pub pending_task_count: AtomicU32,

    ///
    pub has_any_css_locals: AtomicU32,

    /// Used by Bake to extract []CompileResult before it is joined.
    /// CYCLEBREAK GENUINE: erased bake::DevServer (see bundle_v2::dispatch).
    pub dev_server: Option<crate::dispatch::DevServerHandle>,
    pub framework: Option<*const bake::Framework>,

    pub mangled_props: MangledProps,
}

// SAFETY: `LinkerContext` is shared across the worker pool via `each_ptr` /
// `SourceMapDataTask`. The raw-pointer fields (`parse_graph`, `resolver`,
// `r#loop`, `framework`) are backrefs into `BundleV2`/`Transpiler` whose
// lifetimes strictly outlive every parallel section, and per-thread writes go
// to disjoint SoA slots (see `compute_line_offsets`). This mirrors Zig's
// freely-aliased `*LinkerContext`.
unsafe impl<'a> Send for LinkerContext<'a> {}
unsafe impl<'a> Sync for LinkerContext<'a> {}

impl<'a> Default for LinkerContext<'a> {
    fn default() -> Self {
        Self {
            parse_graph: core::ptr::null_mut(),
            graph: Default::default(),
            // SAFETY: callers overwrite `log` in `load()` before any use; this
            // dangling sentinel mirrors Zig's `undefined`.
            log: unsafe { &mut *core::ptr::NonNull::<Log>::dangling().as_ptr() },
            resolver: core::ptr::null_mut(),
            cycle_detector: Vec::new(),
            cjs_runtime_ref: Ref::NONE,
            esm_runtime_ref: Ref::NONE,
            unbound_module_ref: Ref::NONE,
            promise_all_runtime_ref: Ref::NONE,
            options: Default::default(),
            r#loop: None,
            unique_key_buf: Box::default(),
            unique_key_prefix: Box::default(),
            source_maps: Default::default(),
            pending_task_count: AtomicU32::new(0),
            has_any_css_locals: AtomicU32::new(0),
            dev_server: None,
            framework: None,
            mangled_props: Default::default(),
        }
    }
}

impl<'a> LinkerContext<'a> {
    pub fn mark_pending_task_done(&self) {
        // Zig: `.monotonic` → Rust `Relaxed` (LLVM `monotonic` == C11 `relaxed`).
        self.pending_task_count.fetch_sub(1, Ordering::Relaxed);
    }

    pub fn is_external_dynamic_import(&self, record: &ImportRecord, source_index: u32) -> bool {
        use crate::linker_graph::FileListExt as _;
        self.graph.code_splitting
            && record.kind == ImportKind::Dynamic
            && self.graph.files.items_entry_point_kind()[record.source_index.get() as usize].is_entry_point()
            && record.source_index.get() != source_index
    }

    /// Spec: `LinkerContext.zig:checkForMemoryCorruption`.
    ///
    /// PORT NOTE: the Zig body calls `parse_graph.heap.helpCatchMemoryIssues()`
    /// (a `MimallocArena` debug hook). `Graph.heap` is currently
    /// `bun_alloc::Arena = bumpalo::Bump`, which has no such hook, so this is a
    /// no-op until the arena type is swapped to the real `MimallocArena`. The
    /// call sites are already gated on `FeatureFlags::HELP_CATCH_MEMORY_ISSUES`.
    #[inline]
    pub fn check_for_memory_corruption(&self) {
        // For this to work, you need mimalloc's debug build enabled.
        //    make mimalloc-debug
        // TODO(b3): `unsafe { (*self.parse_graph).heap.help_catch_memory_issues() }`
        // once `Graph.heap: MimallocArena`.
    }
}

// Local re-exports for the un-gated tree-shaking impl below. `EntryPoint::Kind`
// and `SideEffects` live in sibling modules; the Phase-A draft referenced them
// via Zig-style nested paths. The real `EntryPoint` lives in
// `ungate_support::entry_point`; re-export so `EntryPoint::Kind` here is the
// *same type* `items_entry_point_kind()` returns (was a duplicate enum before).
#[allow(non_snake_case)]
pub mod EntryPoint {
    pub use crate::ungate_support::entry_point::Kind;
}
use crate::Graph::{InputFileListExt as _, SideEffects as _GraphSideEffects};
use crate::ungate_support::js_meta::JSMetaListExt as _;
use crate::ungate_support::{EntryPointListExt as _, CompileResultForSourceMapListExt as _};
use crate::linker_graph::FileListExt as _;
use bun_js_parser::ast::bundled_ast::BundledAstListExt as _;
use bun_js_parser::ast::bundled_ast::Flags as AstFlags;
use crate::ungate_support::generic_path_with_pretty_initialized;
type DeclaredSymbolList = js_ast::DeclaredSymbolList;

// TODO(b2-blocked): method bodies depend on `LinkerGraph` SoA accessors
// (`graph.files.items_*()`, `graph.ast.items_*()`, `graph.meta.items_*()`),
// `crate::thread_pool::Worker`, `generic_path_with_pretty_initialized`, and the gated
// `linker_context/` submodules. The struct + LinkerOptions + SourceMapData
// above are real; this impl block un-gates with `LinkerGraph.rs`.

impl<'a> LinkerContext<'a> {
    pub fn allocator(&self) -> &Bump {
        // TODO(port): bundler is an AST crate; LinkerGraph owns the arena
        self.graph.allocator()
    }

    pub fn path_with_pretty_initialized(&mut self, path: Logger::fs::Path) -> Result<Logger::fs::Path, BunError> {
        // SAFETY: resolver is a backref into BundleV2.transpiler.resolver, valid for self's lifetime;
        // resolver.fs is a `*mut Fs::FileSystem` backref into the singleton FS.
        let top_level_dir = unsafe { (*(*self.resolver).fs).top_level_dir };
        generic_path_with_pretty_initialized(path, self.options.target, top_level_dir, self.allocator())
    }

    pub fn should_include_part(&self, source_index: crate::IndexInt, part: &Part) -> bool {
        // As an optimization, ignore parts containing a single import statement to
        // an internal non-wrapped file. These will be ignored anyway and it's a
        // performance hit to include the part only to discover it's unnecessary later.
        // SAFETY: `Part.stmts` is a raw `*mut [Stmt]` arena pointer; valid for the link step.
        let stmts: &[Stmt] = unsafe { &*part.stmts };
        if stmts.len() == 1 {
            if let Some(s_import) = stmts[0].data.s_import() {
                let record = self.graph.ast.items_import_records()[source_index as usize].at(s_import.import_record_index as usize);
                if record.source_index.is_valid()
                    && self.graph.meta.items_flags()[record.source_index.get() as usize].wrap == WrapKind::None
                {
                    return false;
                }
            }
        }

        true
    }

    pub fn load(
        &mut self,
        bundle: &mut BundleV2,
        entry_points: &[js_ast::Index],
        server_component_boundaries: js_ast::ast::server_component_boundary::List,
        reachable: &[Index],
    ) -> Result<(), BunError> {
        // PORT NOTE: `bun_js_parser::Index` and `crate::Index` are both
        // `#[repr(transparent)]` u32 newtypes; callers pass the former, the
        // linker graph is typed against the latter. Reinterpret in-place.
        let entry_points: &[Index] = unsafe {
            core::slice::from_raw_parts(entry_points.as_ptr().cast::<Index>(), entry_points.len())
        };
        let _trace = bun::perf::trace("Bundler.CloneLinkerGraph");
        self.parse_graph = &mut bundle.graph;

        // SAFETY: `bundle.transpiler` is a `*mut Transpiler` backref valid for
        // the bundle's lifetime; `resolver`/`log`/`options` are stable fields.
        let transpiler = unsafe { &mut *bundle.transpiler };
        self.graph.code_splitting = transpiler.options.code_splitting;
        // TODO(port): lifetime — log is &'a mut Log; reassigning here mirrors Zig's pointer assignment
        // SAFETY: `transpiler.log` is a `*mut Log` backref valid for the bundle's lifetime.
        self.log = unsafe { &mut *transpiler.log };

        self.resolver = &mut transpiler.resolver;
        self.cycle_detector = Vec::new();

        // PORT NOTE: `reachable_files` is `BabyList<Index>`; clone the
        // caller-owned slice into the linker arena. PERF(port): Zig pointed at
        // the slice in-place; revisit once BabyList grows a borrowed-view ctor.
        self.graph.reachable_files = BabyList::from_slice(reachable).map_err(BunError::from)?;

        // SAFETY: parse_graph is valid backref just assigned above
        let sources: &[Source] = unsafe { (*self.parse_graph).input_files.items_source() };

        self.graph.load(
            entry_points,
            sources,
            server_component_boundaries,
            bundle.dynamic_import_entry_points.keys(),
            // SAFETY: parse_graph backref
            unsafe { &(*self.parse_graph).entry_point_original_names },
        )?;
        // PERF(port): was arena bulk-free — `dynamic_import_entry_points` is
        // now a global-alloc `ArrayHashMap`; clearing drops it.
        bundle.dynamic_import_entry_points.clear_retaining_capacity();

        let runtime_named_exports = &self.graph.ast.items_named_exports()[Index::RUNTIME.get() as usize];

        self.esm_runtime_ref = runtime_named_exports.get(b"__esm").unwrap().ref_;
        self.cjs_runtime_ref = runtime_named_exports.get(b"__commonJS").unwrap().ref_;
        self.promise_all_runtime_ref = runtime_named_exports.get(b"__promiseAll").unwrap().ref_;

        if self.options.output_format == Format::Cjs {
            self.unbound_module_ref = self.graph.generate_new_symbol(Index::RUNTIME.get(), js_ast::ast::symbol::Kind::Unbound, b"module");
        }

        if self.options.output_format == Format::Cjs || self.options.output_format == Format::Iife {
            // PORT NOTE: reshaped for borrowck — `items_*_mut()` columns are
            // physically disjoint SoA slabs but Rust can't see that through
            // `&mut MultiArrayList`. Route through raw column pointers.
            let ast_len = self.graph.ast.len();
            let ast_slice = self.graph.ast.slice();
            // SAFETY: SoA columns are disjoint; the underlying slab does not
            // reallocate for the duration of this loop.
            let exports_kind: &mut [ExportsKind] = unsafe {
                core::slice::from_raw_parts_mut(
                    ast_slice.items_raw::<ExportsKind>(js_ast::ast::bundled_ast::BundledAstField::exports_kind),
                    ast_len,
                )
            };
            let ast_flags_list: &mut [AstFlags] = unsafe {
                core::slice::from_raw_parts_mut(
                    ast_slice.items_raw::<AstFlags>(js_ast::ast::bundled_ast::BundledAstField::flags),
                    ast_len,
                )
            };
            let meta_flags_list = self.graph.meta.items_flags_mut();

            for entry_point in entry_points.iter() {
                let ast_flags: AstFlags = ast_flags_list[entry_point.get() as usize];

                // Loaders default to CommonJS when they are the entry point and the output
                // format is not ESM-compatible since that avoids generating the ESM-to-CJS
                // machinery.
                if ast_flags.contains(AstFlags::HAS_LAZY_EXPORT) {
                    exports_kind[entry_point.get() as usize] = ExportsKind::Cjs;
                }

                // Entry points with ES6 exports must generate an exports object when
                // targeting non-ES6 formats. Note that the IIFE format only needs this
                // when the global name is present, since that's the only way the exports
                // can actually be observed externally.
                if ast_flags.contains(AstFlags::USES_EXPORT_KEYWORD) {
                    ast_flags_list[entry_point.get() as usize].insert(AstFlags::USES_EXPORTS_REF);
                    meta_flags_list[entry_point.get() as usize].force_include_exports_for_entry_point = true;
                }
            }
        }

        Ok(())
    }

    pub fn compute_data_for_source_map(&mut self, reachable: &[crate::IndexInt]) {
        debug_assert!(self.options.source_maps != SourceMapOption::None);
        self.source_maps.line_offset_wait_group = WaitGroup::init_with_count(reachable.len());
        self.source_maps.quoted_contents_wait_group = WaitGroup::init_with_count(reachable.len());
        // TODO(port): arena alloc of task arrays
        // PORT NOTE: `SourceMapDataTask` is not `Clone` (embeds an intrusive
        // `ThreadPoolLib::Task` node); build via iterator instead of `vec![x;n]`.
        self.source_maps.line_offset_tasks =
            (0..reachable.len()).map(|_| SourceMapDataTask::default()).collect::<Vec<_>>().into_boxed_slice();
        self.source_maps.quoted_contents_tasks =
            (0..reachable.len()).map(|_| SourceMapDataTask::default()).collect::<Vec<_>>().into_boxed_slice();

        // PORT NOTE: erase `'a` → `'static` for the task backref. The tasks are
        // joined before `self` is dropped (see `SourceMapData.*_wait_group`).
        let ctx: *mut LinkerContext<'static> = (self as *mut LinkerContext<'a>).cast();
        let mut batch = ThreadPoolLib::Batch::default();
        let mut second_batch = ThreadPoolLib::Batch::default();
        debug_assert_eq!(reachable.len(), self.source_maps.line_offset_tasks.len());
        debug_assert_eq!(reachable.len(), self.source_maps.quoted_contents_tasks.len());
        for ((source_index, line_offset), quoted) in reachable
            .iter()
            .zip(self.source_maps.line_offset_tasks.iter_mut())
            .zip(self.source_maps.quoted_contents_tasks.iter_mut())
        {
            *line_offset = SourceMapDataTask {
                ctx,
                source_index: *source_index,
                thread_task: ThreadPoolLib::Task {
                    node: ThreadPoolLib::Node::default(),
                    callback: SourceMapDataTask::run_line_offset,
                },
            };
            *quoted = SourceMapDataTask {
                ctx,
                source_index: *source_index,
                thread_task: ThreadPoolLib::Task {
                    node: ThreadPoolLib::Node::default(),
                    callback: SourceMapDataTask::run_quoted_source_contents,
                },
            };
            batch.push(ThreadPoolLib::Batch::from(&mut line_offset.thread_task));
            second_batch.push(ThreadPoolLib::Batch::from(&mut quoted.thread_task));
        }

        // line offsets block sooner and are faster to compute, so we should schedule those first
        batch.push(second_batch);

        self.schedule_tasks(batch);
    }

    pub fn schedule_tasks(&self, batch: ThreadPoolLib::Batch) {
        let _ = self.pending_task_count.fetch_add(u32::try_from(batch.len).unwrap(), Ordering::Relaxed);
        // SAFETY: parse_graph backref valid for self lifetime; `pool` is a
        // `NonNull<ThreadPool>` whose `worker_pool` is the live worker-pool
        // backref (initialized by `ThreadPool::start`).
        unsafe { (*(*self.parse_graph).pool.as_ref().worker_pool).schedule(batch) };
    }

    fn process_html_import_files(&mut self) {
        // SAFETY: `parse_graph` is a backref to `BundleV2.graph`, a sibling
        // field of `BundleV2.linker` (= `*self`). The two are disjoint, and no
        // other `&`/`&mut` to `BundleV2.graph` is live for this scope —
        // `self.graph` below is `LinkerGraph`, a distinct allocation.
        // PORT NOTE: reshaped for borrowck — Zig held overlapping `&`/`&mut`
        // into `parse_graph.html_imports` and `parse_graph.input_files`; here
        // we go through raw pointers and reborrow per use.
        let parse_graph: *mut Graph = self.parse_graph;
        // SAFETY: see above; sole accessor of `html_imports` for this scope.
        let server_len = unsafe { (*parse_graph).html_imports.server_source_indices.len };
        if server_len > 0 {
            let actual_ref = self.graph.runtime_function(b"__jsonParse");

            for i in 0..server_len as usize {
                // SAFETY: `server_source_indices` is a stable BabyList; index
                // bounded by `server_len`.
                let html_import: u32 =
                    unsafe { (*parse_graph).html_imports.server_source_indices.slice()[i] };
                // SAFETY: `input_files` SoA is append-only; read-only here.
                let path_text =
                    unsafe { &(*parse_graph).input_files.items_source()[html_import as usize].path.text };
                // SAFETY: sole `&mut` into the per-target map for this lookup.
                let source_index: u32 = unsafe { (*parse_graph).path_to_source_index_map(Target::Browser) }
                    .get(path_text)
                    .unwrap_or_else(|| {
                        panic!("Assertion failed: HTML import file not found in pathToSourceIndexMap");
                    });

                // SAFETY: sole `&mut` into `html_source_indices` for this push.
                unsafe { (*parse_graph).html_imports.html_source_indices.append(source_index) }.expect("OOM");

                // S.LazyExport is a call to __jsonParse.
                // SAFETY: `Part.stmts` is a raw `*mut [Stmt]` arena pointer;
                // valid for the link step. Each accessor returns `Option`;
                // `.unwrap()` mirrors Zig's untagged-union field reads (panic
                // on shape mismatch).
                let original_ref = unsafe {
                    (*self.graph.ast.items_parts()[html_import as usize].at(1).stmts)[0]
                        .data
                        .s_lazy_export()
                        .unwrap()
                        .e_call()
                        .unwrap()
                        .target
                        .data
                        .e_import_identifier()
                        .unwrap()
                        .ref_
                };

                // Make the __jsonParse in that file point to the __jsonParse in the runtime chunk.
                // SAFETY: `symbols.get` returns a stable `*mut Symbol` into the
                // SoA symbol table; sole writer here.
                unsafe { (*self.graph.symbols.get(original_ref).unwrap()).link = actual_ref };

                // When --splitting is enabled, we have to make sure we import the __jsonParse function.
                self.graph.generate_symbol_import_and_use(
                    html_import,
                    Index::part(1u32).get(),
                    actual_ref,
                    1,
                    Index::RUNTIME,
                ).expect("OOM");
            }
        }
    }

    #[inline(never)]
    pub fn link(
        &mut self,
        bundle: &mut BundleV2,
        entry_points: &[js_ast::Index],
        server_component_boundaries: js_ast::ast::server_component_boundary::List,
        reachable: &[Index],
    ) -> Result<Box<[Chunk]>, LinkError> {
        self.load(bundle, entry_points, server_component_boundaries, reachable)?;

        if self.options.source_maps != SourceMapOption::None {
            // SAFETY: Index is repr(transparent) u32 wrapper; reinterpret slice
            let reachable_ints: &[crate::IndexInt] = unsafe {
                core::slice::from_raw_parts(reachable.as_ptr().cast(), reachable.len())
            };
            self.compute_data_for_source_map(reachable_ints);
        }

        self.process_html_import_files();

        if FeatureFlags::HELP_CATCH_MEMORY_ISSUES {
            self.check_for_memory_corruption();
        }

        // Validate top-level await for all files first.
        if bundle.has_any_top_level_await_modules {
            // SAFETY: `parse_graph` is a backref to `BundleV2.graph`, disjoint
            // from `*self` (= `BundleV2.linker`). The SoA column slices below
            // are physically disjoint and the underlying slabs do not
            // reallocate inside `validate_tla`; we cache raw column pointers
            // and reborrow per call to satisfy borrowck (`&mut self` is held
            // across the recursion).
            let parse_graph: *mut Graph = self.parse_graph;
            let import_records_list: *const [BabyList<ImportRecord>] = self.graph.ast.items_import_records();
            let tla_keywords: *const [Range] = unsafe { (*parse_graph).ast.items_top_level_await_keyword() };
            let tla_checks: *mut [TlaCheck] = unsafe { (*parse_graph).ast.items_tla_check_mut() };
            let input_files: *const [Source] = unsafe { (*parse_graph).input_files.items_source() };
            let flags: *mut [crate::ungate_support::js_meta::Flags] = self.graph.meta.items_flags_mut();
            let css_asts: *const [Option<*mut core::ffi::c_void>] = self.graph.ast.items_css();
            let files_len = self.graph.files.len();
            let import_records_len = unsafe { (*import_records_list).len() };

            // Process all files in source index order, like esbuild does
            let mut source_index: u32 = 0;
            while (source_index as usize) < files_len {
                // Skip runtime
                if source_index == Index::RUNTIME.get() {
                    source_index += 1;
                    continue;
                }

                // Skip if not a JavaScript AST
                if source_index as usize >= import_records_len {
                    source_index += 1;
                    continue;
                }

                // Skip CSS files
                // SAFETY: bounds-checked by `import_records_len` above; column
                // slab is stable.
                if unsafe { (*css_asts)[source_index as usize].is_some() } {
                    source_index += 1;
                    continue;
                }

                // SAFETY: see block comment above — disjoint SoA columns,
                // stable slabs; reborrow per call.
                let import_records = unsafe { (*import_records_list)[source_index as usize].slice() };
                let _ = self.validate_tla(
                    source_index,
                    unsafe { &*tla_keywords },
                    unsafe { &mut *tla_checks },
                    unsafe { &*input_files },
                    import_records,
                    unsafe { &mut *flags },
                    unsafe { &*import_records_list },
                )?;

                source_index += 1;
            }

            // after validation propagate async through all importers.
            self.graph.propagate_async_dependencies()?;
        }

        scan_imports_and_exports(self).map_err(BunError::from)?;

        // Stop now if there were errors
        if self.log.has_errors() {
            return Err(LinkError::BuildFailed);
        }

        if FeatureFlags::HELP_CATCH_MEMORY_ISSUES {
            self.check_for_memory_corruption();
        }

        self.tree_shaking_and_code_splitting()?;

        if FeatureFlags::HELP_CATCH_MEMORY_ISSUES {
            self.check_for_memory_corruption();
        }

        let mut chunks = compute_chunks(self, bundle.unique_key)?;

        if self.log.has_errors() {
            return Err(LinkError::BuildFailed);
        }

        if FeatureFlags::HELP_CATCH_MEMORY_ISSUES {
            self.check_for_memory_corruption();
        }

        compute_cross_chunk_dependencies(self, &mut chunks)?;

        if FeatureFlags::HELP_CATCH_MEMORY_ISSUES {
            self.check_for_memory_corruption();
        }

        self.graph.symbols.follow_all();

        Ok(chunks)
    }

    pub fn tree_shaking_and_code_splitting(&mut self) -> Result<(), AllocError> {
        let _trace = bun::perf::trace("Bundler.treeShakingAndCodeSplitting");

        // PORT NOTE: reshaped for borrowck — these slices alias into self.graph;
        // Zig held them simultaneously. The SoA columns are physically disjoint
        // and the underlying slabs don't reallocate during tree-shaking, so we
        // cache raw column base pointers and reborrow at each recursive call.
        let parts: *mut [BabyList<Part>] = self.graph.ast.items_parts_mut();
        let import_records: *const [BabyList<ImportRecord>] = self.graph.ast.items_import_records();
        let css_reprs: *const [Option<*mut core::ffi::c_void>] = self.graph.ast.items_css();
        // SAFETY: parse_graph backref
        let side_effects: *const [SideEffects] = unsafe { (*self.parse_graph).input_files.items_side_effects() };
        let entry_point_kinds: *const [EntryPoint::Kind] = self.graph.files.items_entry_point_kind() as *const _;
        let entry_points: *const [crate::IndexInt] = self.graph.entry_points.items_source_index();
        let distances: *mut [u32] = self.graph.files.items_distance_from_entry_point_mut();
        let entry_points_len = unsafe { (*entry_points).len() };

        {
            let _trace2 = bun::perf::trace("Bundler.markFileLiveForTreeShaking");

            // Tree shaking: Each entry point marks all files reachable from itself
            for i in 0..entry_points_len {
                // SAFETY: see block comment above — disjoint SoA columns,
                // stable slabs; reborrow per recursive call.
                let entry_point = unsafe { (*entry_points)[i] };
                self.mark_file_live_for_tree_shaking(
                    entry_point,
                    unsafe { &*side_effects },
                    unsafe { &mut *parts },
                    unsafe { &*import_records },
                    unsafe { &*entry_point_kinds },
                    unsafe { &*css_reprs },
                );
            }
        }

        {
            let _trace2 = bun::perf::trace("Bundler.markFileReachableForCodeSplitting");

            let file_entry_bits: *mut [AutoBitSet] = self.graph.files.items_entry_bits_mut();
            // AutoBitSet needs to be initialized if it is dynamic
            // SAFETY: sole writer to `file_entry_bits` for this init pass.
            if AutoBitSet::needs_dynamic(entry_points_len) {
                for bits in unsafe { (&mut *file_entry_bits).iter_mut() } {
                    *bits = AutoBitSet::init_empty(entry_points_len)?;
                }
            } else if unsafe { !(*file_entry_bits).is_empty() } {
                // assert that the tag is correct
                debug_assert!(matches!(unsafe { &(*file_entry_bits)[0] }, AutoBitSet::Static(_)));
            }

            // Code splitting: Determine which entry points can reach which files. This
            // has to happen after tree shaking because there is an implicit dependency
            // between live parts within the same file. All liveness has to be computed
            // first before determining which entry points can reach which files.
            for i in 0..entry_points_len {
                // SAFETY: see block comment above.
                let entry_point = unsafe { (*entry_points)[i] };
                self.mark_file_reachable_for_code_splitting(
                    entry_point,
                    i,
                    unsafe { &mut *distances },
                    0,
                    unsafe { &*parts },
                    unsafe { &*import_records },
                    unsafe { &mut *file_entry_bits },
                    unsafe { &*css_reprs },
                );
            }
        }

        Ok(())
    }

    pub fn generate_chunk(ctx: &GenerateChunkCtx, chunk: *mut Chunk, chunk_index: usize) {
        // SAFETY: `each_ptr` hands us a unique `*mut Chunk` per task; deref for
        // the duration of this body. ctx.c points into BundleV2.linker;
        // container_of pattern. `Worker::get` only reads `bundle.graph.pool`
        // (shared), so a `&` is sufficient and avoids aliasing.
        let chunk: &mut Chunk = unsafe { &mut *chunk };
        let bundle: *const BundleV2 = unsafe {
            (ctx.c as *const LinkerContext as *const u8)
                .sub(offset_of!(BundleV2, linker))
                .cast::<BundleV2>()
        };
        let worker = crate::thread_pool::Worker::get(unsafe { &*bundle });
        let mut worker = scopeguard::guard(worker, |w| w.unget());
        let worker: &mut crate::thread_pool::Worker = &mut **worker;
        // PORT NOTE: dispatch on a discriminant copy so `chunk` isn't borrowed
        // across the post-process call (which takes `&mut Chunk`).
        let result = match chunk.content {
            crate::chunk::Content::Javascript(_) => post_process_js_chunk(*ctx, worker, chunk, chunk_index),
            crate::chunk::Content::Css(_) => post_process_css_chunk(*ctx, worker, chunk),
            crate::chunk::Content::Html => post_process_html_chunk(*ctx, worker, chunk),
        };
        if let Err(err) = result {
            Output::panic(format_args!("TODO: handle error: {}", err.name()));
        }
    }

    pub fn generate_js_renamer(ctx: &GenerateChunkCtx, chunk: *mut Chunk, chunk_index: usize) {
        // SAFETY: `each_ptr` hands us a unique `*mut Chunk` per task; deref for
        // the body. container_of pattern — see `generate_chunk` above.
        let chunk: &mut Chunk = unsafe { &mut *chunk };
        let bundle: *const BundleV2 = unsafe {
            (ctx.c as *const LinkerContext as *const u8)
                .sub(offset_of!(BundleV2, linker))
                .cast::<BundleV2>()
        };
        let worker = crate::thread_pool::Worker::get(unsafe { &*bundle });
        let mut worker = scopeguard::guard(worker, |w| w.unget());
        if let crate::chunk::Content::Javascript(_) = chunk.content {
            Self::generate_js_renamer_(*ctx, &mut **worker, chunk, chunk_index);
        }
    }

    fn generate_js_renamer_(ctx: GenerateChunkCtx, _worker: &mut crate::thread_pool::Worker, chunk: &mut Chunk, chunk_index: usize) {
        let _ = chunk_index;
        // PORT NOTE: reshaped for borrowck — `rename_symbols_in_chunk` needs
        // `&mut Chunk` and a borrow of `chunk.content.javascript.files_in_chunk_order`
        // simultaneously; cache the files slice via raw pointer (it lives in
        // the chunk arena, address-stable for the renamer pass).
        let files: *const [u32] = match &chunk.content {
            crate::chunk::Content::Javascript(js) => &*js.files_in_chunk_order as *const [u32],
            _ => unreachable!(),
        };
        // SAFETY: `files` points into `chunk.content.javascript`; `rename_symbols_in_chunk`
        // does not touch `chunk.content` (it writes `chunk.renamer` only).
        chunk.renamer = rename_symbols_in_chunk(ctx.c, chunk, unsafe { &*files })
            .expect("TODO: handle error");
    }

    pub fn generate_source_map_for_chunk(
        &mut self,
        isolated_hash: u64,
        _worker: &mut crate::thread_pool::Worker,
        results: MultiArrayList<CompileResultForSourceMap>,
        chunk_abs_dir: &[u8],
        can_have_shifts: bool,
    ) -> Result<SourceMapPieces, BunError> {
        let _trace = bun::perf::trace("Bundler.generateSourceMapForChunk");

        // PERF(port): Zig threaded `worker.allocator` through StringJoiner /
        // MutableString; the Rust ports use the global mimalloc, so the joiner
        // is allocator-free here. Revisit when arena threading lands.
        let mut j = StringJoiner::default();

        // SAFETY: parse_graph backref
        let sources = unsafe { (*self.parse_graph).input_files.items_source() };
        let quoted_source_map_contents = self.graph.files.items_quoted_source_contents();

        // Entries in `results` do not 1:1 map to source files, the mapping
        // is actually many to one, where a source file can have multiple chunks
        // in the sourcemap.
        //
        // This hashmap is going to map:
        //    `source_index` (per compilation) in a chunk
        //   -->
        //    Which source index in the generated sourcemap, referred to
        //    as the "mapping source index" within this function to be distinct.
        let mut source_id_map: ArrayHashMap<u32, i32> = ArrayHashMap::new();
        // PERF(port): was arena bulk-free — source_id_map drops at scope exit

        let source_indices = results.items_source_index();

        j.push_static(b"{\n  \"version\": 3,\n  \"sources\": [");
        if !source_indices.is_empty() {
            {
                let index = source_indices[0];
                let mut path = sources[index as usize].path.clone();
                source_id_map.put_no_clobber(index, 0)?;

                if path.is_file() {
                    let rel_path = bun_paths::resolve_path::relative_alloc(chunk_abs_dir, &path.text)?;
                    // PORT NOTE: `Path.pretty` is `&'static [u8]` (interned in Zig);
                    // leak the relative path into the bump-equivalent global heap.
                    path.pretty = Box::leak(rel_path);
                }

                let mut quote_buf = MutableString::init(path.pretty.len() + 2)?;
                js_printer::quote_for_json(&path.pretty, &mut quote_buf, false)?;
                // PERF(port): was arena-backed; `to_default_owned` moves the
                // buffer into the joiner (joiner owns it until `done`).
                j.push_owned(quote_buf.to_default_owned());
            }

            let mut next_mapping_source_index: i32 = 1;
            for &index in &source_indices[1..] {
                let gop = source_id_map.get_or_put(index)?;
                if gop.found_existing {
                    continue;
                }

                *gop.value_ptr = next_mapping_source_index;
                next_mapping_source_index += 1;

                let mut path = sources[index as usize].path.clone();

                if path.is_file() {
                    let rel_path = bun_paths::resolve_path::relative_alloc(chunk_abs_dir, &path.text)?;
                    path.pretty = Box::leak(rel_path);
                }

                let mut quote_buf = MutableString::init(path.pretty.len() + ", ".len() + 2)?;
                quote_buf.append_assume_capacity(b", "); // PERF(port): was assume_capacity
                js_printer::quote_for_json(&path.pretty, &mut quote_buf, false)?;
                j.push_owned(quote_buf.to_default_owned());
            }
        }

        j.push_static(b"],\n  \"sourcesContent\": [");

        let source_indices_for_contents = source_id_map.keys();
        if !source_indices_for_contents.is_empty() {
            j.push_static(b"\n    ");
            j.push_static(
                quoted_source_map_contents[source_indices_for_contents[0] as usize]
                    .as_deref()
                    .unwrap_or(b""),
            );

            for &index in &source_indices_for_contents[1..] {
                j.push_static(b",\n    ");
                j.push_static(quoted_source_map_contents[index as usize].as_deref().unwrap_or(b""));
            }
        }
        j.push_static(b"\n  ],\n  \"mappings\": \"");

        let mapping_start = j.len;
        let mut prev_end_state = SourceMapState::default();
        let mut prev_column_offset: i32 = 0;
        let source_map_chunks = results.items_source_map_chunk();
        let offsets = results.items_generated_offset();
        debug_assert_eq!(source_map_chunks.len(), offsets.len());
        debug_assert_eq!(source_map_chunks.len(), source_indices.len());
        for ((chunk, offset), &current_source_index) in source_map_chunks.iter().zip(offsets.iter()).zip(source_indices.iter()) {
            let mapping_source_index = *source_id_map.get(&current_source_index)
                .expect("unreachable"); // the pass above during printing of "sources" must add the index

            let mut start_state = SourceMapState {
                source_index: mapping_source_index,
                generated_line: offset.lines.zero_based(),
                generated_column: offset.columns.zero_based(),
                ..Default::default()
            };

            if offset.lines.zero_based() == 0 {
                start_state.generated_column += prev_column_offset;
            }

            SourceMap::append_source_map_chunk(&mut j, prev_end_state, start_state, &chunk.buffer.list)?;

            prev_end_state = chunk.end_state;
            prev_end_state.source_index = mapping_source_index;
            prev_column_offset = chunk.final_generated_column;

            if prev_end_state.generated_line == 0 {
                prev_end_state.generated_column += start_state.generated_column;
                prev_column_offset += start_state.generated_column;
            }
        }
        let mapping_end = j.len;

        if FeatureFlags::SOURCE_MAP_DEBUG_ID {
            j.push_static(b"\",\n  \"debugId\": \"");
            // TODO(port): allocPrint into arena — using Vec<u8> + write!
            let mut buf = Vec::<u8>::new();
            use std::io::Write;
            write!(&mut buf, "{}", DebugIDFormatter { id: isolated_hash }).unwrap();
            j.push_owned(buf.into_boxed_slice());
            j.push_static(b"\",\n  \"names\": []\n}");
        } else {
            j.push_static(b"\",\n  \"names\": []\n}");
        }

        let done = j.done()?;
        debug_assert!(done[0] == b'{');

        let mut pieces = SourceMapPieces::init();
        if can_have_shifts {
            pieces.prefix.extend_from_slice(&done[0..mapping_start]);
            pieces.mappings.extend_from_slice(&done[mapping_start..mapping_end]);
            pieces.suffix.extend_from_slice(&done[mapping_end..]);
        } else {
            pieces.prefix.extend_from_slice(&done);
        }

        Ok(pieces)
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ScanCssImportsResult {
    Ok,
    Errors,
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum LinkError {
    #[error("out of memory")]
    OutOfMemory,
    #[error("build failed")]
    BuildFailed,
    #[error("import resolution failed")]
    ImportResolutionFailed,
}

impl From<AllocError> for LinkError {
    fn from(_: AllocError) -> Self { LinkError::OutOfMemory }
}
impl From<BunError> for LinkError {
    fn from(_: BunError) -> Self {
        // TODO(port): narrow error set — Zig's `try this.load()` is `!void` (anyerror)
        LinkError::BuildFailed
    }
}
// TODO(b2-blocked): bun_core::Error::from_name — not yet on the public surface.

impl From<LinkError> for BunError {
    fn from(e: LinkError) -> Self { BunError::from_name(<&'static str>::from(e)) }
}

unsafe fn noop_task_callback(_: *mut ThreadPoolLib::Task) {
    // PORTING.md §Forbidden: silent no-op. Spec `LinkerContext.zig:101` defaults
    // the task callback to `&runLineOffset`; the real bodies are gated below
    // (`SourceMapDataTask::run_line_offset` / `run_quoted_source_contents`).
    // Fail loudly so a scheduled-but-unwired task can't deadlock the wait-group
    // by silently doing nothing and never calling `finish()`.
    unreachable!("b2-blocked: SourceMapData task callback (run_line_offset / run_quoted_source_contents are gated with crate::thread_pool::Worker)")
}

pub struct LinkerOptions {
    pub generate_bytecode_cache: bool,
    pub output_format: Format,
    pub ignore_dce_annotations: bool,
    pub emit_dce_annotations: bool,
    pub tree_shaking: bool,
    pub minify_whitespace: bool,
    pub minify_syntax: bool,
    pub minify_identifiers: bool,
    pub banner: &'static [u8],
    pub footer: &'static [u8],
    pub css_chunking: bool,
    pub compile_to_standalone_html: bool,
    pub source_maps: SourceMapOption,
    pub target: Target,
    pub compile: bool,
    pub metafile: bool,
    /// Path to write JSON metafile (for Bun.build API)
    pub metafile_json_path: &'static [u8],
    /// Path to write markdown metafile (for Bun.build API)
    pub metafile_markdown_path: &'static [u8],

    pub mode: LinkerOptionsMode,

    pub public_path: &'static [u8],
}

impl Default for LinkerOptions {
    fn default() -> Self {
        Self {
            generate_bytecode_cache: false,
            output_format: Format::Esm,
            ignore_dce_annotations: false,
            emit_dce_annotations: true,
            tree_shaking: true,
            minify_whitespace: false,
            minify_syntax: false,
            minify_identifiers: false,
            banner: b"",
            footer: b"",
            css_chunking: false,
            compile_to_standalone_html: false,
            source_maps: SourceMapOption::None,
            target: Target::Browser,
            compile: false,
            metafile: false,
            metafile_json_path: b"",
            metafile_markdown_path: b"",
            mode: LinkerOptionsMode::Bundle,
            public_path: b"",
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum LinkerOptionsMode {
    Passthrough,
    Bundle,
}

#[derive(Default)]
pub struct SourceMapData {
    pub line_offset_wait_group: WaitGroup,
    pub line_offset_tasks: Box<[SourceMapDataTask]>,

    pub quoted_contents_wait_group: WaitGroup,
    pub quoted_contents_tasks: Box<[SourceMapDataTask]>,
}

pub struct SourceMapDataTask {
    pub ctx: *mut LinkerContext<'static>, // BACKREF — task stored in ctx.source_maps.*_tasks
    pub source_index: crate::IndexInt,
    pub thread_task: ThreadPoolLib::Task,
}

impl Default for SourceMapDataTask {
    fn default() -> Self {
        Self {
            ctx: core::ptr::null_mut(),
            source_index: 0,
            // TODO(b2-blocked): real callback is `Self::run_line_offset`
            // (gated below with `crate::thread_pool::Worker`).
            thread_task: ThreadPoolLib::Task {
                node: ThreadPoolLib::Node::default(),
                callback: noop_task_callback,
            },
        }
    }
}

// TODO(b2-blocked): bodies depend on `crate::thread_pool::Worker`, `BundleV2.linker`
// container_of, and `LinkerGraph` SoA accessors. Un-gates with `ThreadPool.rs`.

impl SourceMapDataTask {
    pub fn run_line_offset(thread_task: *mut ThreadPoolLib::Task) {
        // SAFETY: thread_task points to SourceMapDataTask.thread_task
        let task: &mut SourceMapDataTask = unsafe {
            &mut *((thread_task as *mut u8)
                .sub(offset_of!(SourceMapDataTask, thread_task))
                .cast::<SourceMapDataTask>())
        };
        let ctx: *mut LinkerContext = task.ctx;
        let _guard = scopeguard::guard((), |_| {
            // SAFETY: ctx backref valid for task lifetime
            unsafe {
                (*ctx).mark_pending_task_done();
                (*ctx).source_maps.line_offset_wait_group.finish();
            }
        });

        // SAFETY: ctx is BundleV2.linker; container_of recovers the parent. We
        // deliberately do NOT materialize `&mut BundleV2` here — these tasks
        // run concurrently across the worker pool (one per source_index), so
        // any `&mut` to the shared `BundleV2`/`LinkerContext` would be aliased
        // UB. `Worker::get` only needs `&BundleV2` (reads `graph.pool`), and
        // that shared borrow ends before any per-slot write below.
        let bundle: *const BundleV2 = unsafe {
            (ctx as *const u8).sub(offset_of!(BundleV2, linker)).cast::<BundleV2>()
        };
        let worker = crate::thread_pool::Worker::get(unsafe { &*bundle });
        // SAFETY: `worker.allocator` points at `worker.heap` (init by `Worker::create`).
        SourceMapData::compute_line_offsets(ctx, unsafe { &*worker.allocator }, task.source_index);
        worker.unget();
    }

    pub fn run_quoted_source_contents(thread_task: *mut ThreadPoolLib::Task) {
        // SAFETY: thread_task points to SourceMapDataTask.thread_task
        let task: &mut SourceMapDataTask = unsafe {
            &mut *((thread_task as *mut u8)
                .sub(offset_of!(SourceMapDataTask, thread_task))
                .cast::<SourceMapDataTask>())
        };
        let ctx: *mut LinkerContext = task.ctx;
        let _guard = scopeguard::guard((), |_| {
            // SAFETY: ctx backref
            unsafe {
                (*ctx).mark_pending_task_done();
                (*ctx).source_maps.quoted_contents_wait_group.finish();
            }
        });

        // SAFETY: see `run_line_offset` — raw-ptr container_of, no `&mut`
        // materialized over the shared `BundleV2` while peer tasks are live.
        let bundle: *const BundleV2 = unsafe {
            (ctx as *const u8).sub(offset_of!(BundleV2, linker)).cast::<BundleV2>()
        };
        let worker = crate::thread_pool::Worker::get(unsafe { &*bundle });

        // Use the default allocator when using DevServer and the file
        // was generated. This will be preserved so that remapping
        // stack traces can show the source code, even after incremental
        // rebuilds occur.
        // SAFETY: `worker.ctx` is a `*mut BundleV2` backref; `transpiler` is a
        // `*mut Transpiler` backref. Both valid for the worker's lifetime.
        let alloc: *const Bump = unsafe {
            if (*(*worker.ctx).transpiler).options.dev_server.is_some() {
                // CYCLEBREAK FORWARD_DECL: `bake::DevServer.allocator()` —
                // dev_server is type-erased here (Option<()>); the real handle
                // arrives with the bake crate. Fall through to the worker arena.
                todo!("blocked_on: bake::DevServer::allocator")
            } else {
                worker.allocator
            }
        };

        // SAFETY: `alloc` is either the dev-server's static arena or the
        // thread-local worker arena (initialized by `Worker::create`).
        SourceMapData::compute_quoted_source_contents(ctx, unsafe { &*alloc }, task.source_index);
        worker.unget();
    }
}

// TODO(b2-blocked): see SourceMapDataTask above.

impl SourceMapData {
    /// Runs concurrently across the worker pool (one task per `source_index`).
    /// Takes `*mut LinkerContext` (not `&mut`) because Zig's `*LinkerContext`
    /// freely aliases across threads — materializing `&mut LinkerContext` here
    /// while peer tasks hold the same pointer would be aliased-mut UB. Each
    /// task writes only `graph.files[source_index].line_offset_table`
    /// (disjoint by `source_index`); all other access is read-only.
    pub fn compute_line_offsets(this: *mut LinkerContext, alloc: &Bump, source_index: crate::IndexInt) {
        use crate::linker_graph::FileField;
        debug!("Computing LineOffsetTable: {}", source_index);
        // SAFETY: `this` is a backref to `BundleV2.linker`, valid for the link
        // step. We only take transient `&` (autoref) to read SoA column base
        // pointers via `Slice::items_raw`; the underlying `MultiArrayList`
        // header is not mutated for the duration of these tasks. The write
        // target is the per-source_index slot, addressed by raw pointer —
        // disjoint across concurrent tasks.
        let line_offset_table: *mut SourceMap::line_offset_table::List = unsafe {
            (*this).graph.files.slice()
                .items_raw::<SourceMap::line_offset_table::List>(FileField::line_offset_table)
                .add(source_index as usize)
        };

        // SAFETY: parse_graph backref; read-only across all tasks.
        let parse_graph = unsafe { &*(*this).parse_graph };
        let source: &Source = &parse_graph.input_files.items_source()[source_index as usize];
        let loader: Loader = parse_graph.input_files.items_loader()[source_index as usize];

        if !loader.can_have_source_map() {
            // This is not a file which we support generating source maps for
            // SAFETY: sole writer to this slot (disjoint by source_index).
            unsafe { *line_offset_table = Default::default() };
            return;
        }

        // SAFETY: `graph.ast` is read-only for the duration of these tasks.
        let approximate_line_count =
            unsafe { (*this).graph.ast.items_approximate_newline_count()[source_index as usize] };

        // SAFETY: sole writer to this slot (disjoint by source_index).
        let _ = alloc;
        unsafe {
            *line_offset_table = LineOffsetTable::generate(
                &source.contents,
                // We don't support sourcemaps for source files with more than 2^31 lines
                (approximate_line_count as u32 & 0x7FFF_FFFF) as i32, // @intCast(@truncate to u31)
            )
            .expect("OOM");
        }
    }

    /// Runs concurrently across the worker pool — see `compute_line_offsets`
    /// for the raw-pointer aliasing contract.
    pub fn compute_quoted_source_contents(this: *mut LinkerContext, _alloc: &Bump, source_index: crate::IndexInt) {
        use crate::linker_graph::FileField;
        debug!("Computing Quoted Source Contents: {}", source_index);
        // SAFETY: see `compute_line_offsets` — transient `&` to read the SoA
        // column base, then raw-ptr offset to the per-source_index slot. Sole
        // writer to this slot (disjoint across concurrent tasks).
        let quoted_source_contents = unsafe {
            &mut *(*this).graph.files.slice()
                .items_raw::<Option<Box<[u8]>>>(FileField::quoted_source_contents)
                .add(source_index as usize)
        };
        *quoted_source_contents = None;

        // SAFETY: parse_graph backref; read-only across all tasks.
        let parse_graph = unsafe { &*(*this).parse_graph };
        let loader: Loader = parse_graph.input_files.items_loader()[source_index as usize];
        if !loader.can_have_source_map() {
            return;
        }

        let source: &Source = &parse_graph.input_files.items_source()[source_index as usize];
        let mut mutable = MutableString::init_empty();
        js_printer::quote_for_json(&source.contents, &mut mutable, false).expect("OOM");
        *quoted_source_contents = Some(mutable.to_default_owned());
    }
}

#[derive(Clone)]
pub struct MatchImport {
    alias: *const [u8], // TODO(port): lifetime — Zig string borrowed from AST arena
    kind: MatchImportKind,
    namespace_ref: Ref,
    source_index: u32,
    name_loc: Loc, // Optional, goes with sourceIndex, ignore if zero,
    other_source_index: u32,
    other_name_loc: Loc, // Optional, goes with otherSourceIndex, ignore if zero,
    r#ref: Ref,
}

impl Default for MatchImport {
    fn default() -> Self {
        Self {
            alias: b"" as *const [u8],
            kind: MatchImportKind::default(),
            namespace_ref: Ref::default(),
            source_index: 0,
            name_loc: Loc::default(),
            other_source_index: 0,
            other_name_loc: Loc::default(),
            r#ref: Ref::default(),
        }
    }
}

#[derive(Default, Clone, Copy, PartialEq, Eq)]
pub enum MatchImportKind {
    /// The import is either external or undefined
    #[default]
    Ignore,
    /// "sourceIndex" and "ref" are in use
    Normal,
    /// "namespaceRef" and "alias" are in use
    Namespace,
    /// Both "normal" and "namespace"
    NormalAndNamespace,
    /// The import could not be evaluated due to a cycle
    Cycle,
    /// The import is missing but came from a TypeScript file
    ProbablyTypescriptType,
    /// The import resolved to multiple symbols via "export * from"
    Ambiguous,
}

pub struct ChunkMeta {
    pub imports: ChunkMetaMap,
    pub exports: ChunkMetaMap,
    pub dynamic_imports: ArrayHashMap<crate::IndexInt, ()>,
}

pub type ChunkMetaMap = ArrayHashMap<Ref, ()>;

/// PORT NOTE: raw-pointer fields (was `&'a mut`) because `each_ptr` requires
/// `Ctx: Sync + Copy` and the same context is observed from every worker
/// thread. Each task only writes to its own `*mut Chunk` slot; reads of
/// `c`/`chunks` are disjoint or read-only per the Zig spec.
#[derive(Clone, Copy)]
pub struct GenerateChunkCtx<'a> {
    pub c: *mut LinkerContext<'a>,
    pub chunks: *mut [Chunk],
    pub chunk: *mut Chunk,
}
// SAFETY: see PORT NOTE above — mirrors Zig's freely-aliased `*LinkerContext`.
unsafe impl<'a> Send for GenerateChunkCtx<'a> {}
unsafe impl<'a> Sync for GenerateChunkCtx<'a> {}

pub struct PendingPartRange<'a> {
    pub part_range: PartRange,
    pub task: ThreadPoolLib::Task,
    pub ctx: &'a GenerateChunkCtx<'a>,
    pub i: u32,
}

struct SubstituteChunkFinalPathResult {
    j: StringJoiner,
    shifts: Box<[SourceMapShifts]>,
}

// TODO(b2-blocked): scan/tree-shake/link method bodies. These reach into
// `LinkerGraph` SoA fields (`graph.files`, `graph.meta`, `graph.ast`), the
// gated `linker_context/scanImportsAndExports.rs`, `bun_resolve_builtins`,
// and `css::css_modules`. The bodies are real ports of `LinkerContext.zig`
// and un-gate together with `LinkerGraph.rs`.

impl<'a> LinkerContext<'a> {
    pub fn generate_isolated_hash(&mut self, chunk: &Chunk) -> u64 {
        let _trace = bun::perf::trace("Bundler.generateIsolatedHash");

        let mut hasher = ContentHasher::default();

        // Mix the file names and part ranges of all of the files in this chunk into
        // the hash. Objects that appear identical but that live in separate files or
        // that live in separate parts in the same file must not be merged. This only
        // needs to be done for JavaScript files, not CSS files.
        if let crate::chunk::Content::Javascript(js) = &chunk.content {
            // SAFETY: parse_graph backref; exclusive access via &mut *.
            let sources = unsafe { (*self.parse_graph).input_files.items_source_mut() };
            for part_range in js.parts_in_chunk_in_order.iter() {
                let source: &mut Source = &mut sources[part_range.source_index.get() as usize];

                let file_path: &[u8] = 'brk: {
                    if source.path.is_file() {
                        // Use the pretty path as the file name since it should be platform-
                        // independent (relative paths and the "/" path separator)
                        if source.path.text.as_ptr() == source.path.pretty.as_ptr() {
                            source.path = self.path_with_pretty_initialized(source.path.clone()).expect("OOM");
                        }
                        // PORT NOTE: `Path::assert_pretty_is_valid` lives on the
                        // resolver-side `Path<'a>`; the logger `Path` has no
                        // such debug hook yet.
                        debug_assert!(source.path.text.as_ptr() != source.path.pretty.as_ptr());

                        break 'brk &source.path.pretty;
                    } else {
                        // If this isn't in the "file" namespace, just use the full path text
                        // verbatim. This could be a source of cross-platform differences if
                        // plugins are storing platform-specific information in here, but then
                        // that problem isn't caused by esbuild itself.
                        break 'brk &source.path.text;
                    }
                };

                // Include the path namespace in the hash
                hasher.write(&source.path.namespace);

                // Then include the file path
                hasher.write(file_path);

                // Then include the part range
                hasher.write_ints(&[
                    part_range.part_index_begin,
                    part_range.part_index_end,
                ]);
            }
        }

        // Hash the output path template as part of the content hash because we want
        // any import to be considered different if the import's output path has changed.
        hasher.write(&chunk.template.data);

        let public_path: &[u8] = if chunk.flags.contains(crate::chunk::Flags::IS_BROWSER_CHUNK_FROM_SERVER_BUILD) {
            // SAFETY: self is BundleV2.linker; container_of recovers the parent.
            // `transpiler_for_target` only reads `bundle.browser_transpiler`.
            let bundle = unsafe {
                &mut *((self as *mut LinkerContext as *mut u8)
                    .sub(offset_of!(BundleV2, linker))
                    .cast::<BundleV2>())
            };
            &bundle.transpiler_for_target(Target::Browser).options.public_path
        } else {
            &self.options.public_path
        };

        // Also hash the public path. If provided, this is used whenever files
        // reference each other such as cross-chunk imports, asset file references,
        // and source map comments. We always include the hash in all chunks instead
        // of trying to figure out which chunks will include the public path for
        // simplicity and for robustness to code changes in the future.
        if !public_path.is_empty() {
            hasher.write(public_path);
        }

        // Include the generated output content in the hash. This excludes the
        // randomly-generated import paths (the unique keys) and only includes the
        // data in the spans between them.
        match &chunk.intermediate_output {
            crate::chunk::IntermediateOutput::Pieces(pieces) => {
                for piece in pieces.slice() {
                    hasher.write(piece.data());
                }
            }
            crate::chunk::IntermediateOutput::Joiner(_joiner) => {
                // PORT NOTE: Zig walked `joiner.head` and hashed each
                // `node.slice`; the Rust `StringJoiner::Node` keeps `slice` /
                // `next` private (no public iterator yet). Hashing the joined
                // output here would force an early `done()`, which would
                // invalidate `IntermediateOutput::Joiner`. Defer until
                // `StringJoiner` grows a node iterator.
                todo!("blocked_on: StringJoiner node iterator (private fields)")
            }
            crate::chunk::IntermediateOutput::Empty => {}
        }

        // Also include the source map data in the hash. The source map is named the
        // same name as the chunk name for ease of discovery. So we want the hash to
        // change if the source map data changes even if the chunk data doesn't change.
        // Otherwise the output path for the source map wouldn't change and the source
        // map wouldn't end up being updated.
        //
        // Note that this means the contents of all input files are included in the
        // hash because of "sourcesContent", so changing a comment in an input file
        // can now change the hash of the output file. This only happens when you
        // have source maps enabled (and "sourcesContent", which is on by default).
        //
        // The generated positions in the mappings here are in the output content
        // *before* the final paths have been substituted. This may seem weird.
        // However, I think this shouldn't cause issues because a) the unique key
        // values are all always the same length so the offsets are deterministic
        // and b) the final paths will be folded into the final hash later.
        hasher.write(&chunk.output_source_map.prefix);
        hasher.write(&chunk.output_source_map.mappings);
        hasher.write(&chunk.output_source_map.suffix);

        hasher.digest()
    }

    pub fn validate_tla(
        &mut self,
        source_index: crate::IndexInt,
        tla_keywords: &[Range],
        tla_checks: &mut [TlaCheck],
        input_files: &[Source],
        import_records: &[ImportRecord],
        meta_flags: &mut [crate::ungate_support::js_meta::Flags],
        ast_import_records: &[BabyList<ImportRecord>],
    ) -> Result<TlaCheck, AllocError> {
        // PORT NOTE: reshaped for borrowck — Zig held &mut tla_checks[source_index] across recursive
        // calls that also mutate tla_checks. We re-index after each recursion.
        if tla_checks[source_index as usize].depth == 0 {
            tla_checks[source_index as usize].depth = 1;
            if tla_keywords[source_index as usize].len > 0 {
                tla_checks[source_index as usize].parent = source_index;
            }

            for (import_record_index, record) in import_records.iter().enumerate() {
                if Index::is_valid(record.source_index) && (record.kind == ImportKind::Require || record.kind == ImportKind::Stmt) {
                    let parent = self.validate_tla(
                        record.source_index.get(),
                        tla_keywords,
                        tla_checks,
                        input_files,
                        ast_import_records[record.source_index.get() as usize].slice(),
                        meta_flags,
                        ast_import_records,
                    )?;
                    if Index::is_invalid(Index::init(parent.parent)) {
                        continue;
                    }

                    let result_tla_check = &mut tla_checks[source_index as usize];

                    // Follow any import chains
                    if record.kind == ImportKind::Stmt
                        && (Index::is_invalid(Index::init(result_tla_check.parent)) || parent.depth < result_tla_check.depth)
                    {
                        result_tla_check.depth = parent.depth + 1;
                        result_tla_check.parent = record.source_index.get();
                        result_tla_check.import_record_index = u32::try_from(import_record_index).unwrap();
                        continue;
                    }

                    // Require of a top-level await chain is forbidden
                    if record.kind == ImportKind::Require {
                        let mut notes: Vec<Data> = Vec::new();

                        let mut tla_pretty_path: &[u8] = b"";
                        let mut other_source_index = record.source_index.get();

                        // Build up a chain of notes for all of the imports
                        loop {
                            let parent_result_tla_keyword = tla_keywords[other_source_index as usize];
                            let parent_tla_check = tla_checks[other_source_index as usize];
                            let parent_source_index = other_source_index;

                            if parent_result_tla_keyword.len > 0 {
                                let source = &input_files[other_source_index as usize];
                                tla_pretty_path = &source.path.pretty;
                                let mut text = Vec::new();
                                use std::io::Write;
                                write!(&mut text, "The top-level await in {} is here:", bstr::BStr::new(tla_pretty_path)).unwrap();
                                notes.push(Data {
                                    text: text.into(),
                                    location: Logger::Location::init_or_null(Some(source), parent_result_tla_keyword),
                                    ..Default::default()
                                });
                                break;
                            }

                            if !Index::is_valid(Index::init(parent_tla_check.parent)) {
                                notes.push(Data {
                                    text: b"unexpected invalid index"[..].into(),
                                    ..Default::default()
                                });
                                break;
                            }

                            other_source_index = parent_tla_check.parent;

                            let mut text = Vec::new();
                            use std::io::Write;
                            write!(
                                &mut text,
                                "The file {} imports the file {} here:",
                                bstr::BStr::new(&input_files[parent_source_index as usize].path.pretty),
                                bstr::BStr::new(&input_files[other_source_index as usize].path.pretty),
                            ).unwrap();
                            notes.push(Data {
                                text: text.into(),
                                location: Logger::Location::init_or_null(
                                    Some(&input_files[parent_source_index as usize]),
                                    ast_import_records[parent_source_index as usize].slice()
                                        [tla_checks[parent_source_index as usize].import_record_index as usize]
                                        .range,
                                ),
                                ..Default::default()
                            });
                        }

                        let source: &Source = &input_files[source_index as usize];
                        let imported_pretty_path = &source.path.pretty;
                        let mut text = Vec::new();
                        use std::io::Write;
                        if imported_pretty_path[..] == tla_pretty_path[..] {
                            write!(&mut text, "This require call is not allowed because the imported file \"{}\" contains a top-level await", bstr::BStr::new(imported_pretty_path)).unwrap();
                        } else {
                            write!(&mut text, "This require call is not allowed because the transitive dependency \"{}\" contains a top-level await", bstr::BStr::new(tla_pretty_path)).unwrap();
                        }

                        self.log.add_range_error_with_notes(Some(source), record.range, &text, notes.into_boxed_slice())?;
                    }
                }
            }

            // Make sure that if we wrap this module in a closure, the closure is also
            // async. This happens when you call "import()" on this module and code
            // splitting is off.
            if Index::is_valid(Index::init(tla_checks[source_index as usize].parent)) {
                meta_flags[source_index as usize].is_async_or_has_async_dependency = true;
            }
        }

        Ok(tla_checks[source_index as usize])
    }

    pub fn should_remove_import_export_stmt(
        &mut self,
        stmts: &mut StmtList,
        loc: Loc,
        namespace_ref: Ref,
        import_record_index: u32,
        alloc: &Bump,
        ast: &JSAst,
    ) -> Result<bool, BunError> {
        let record = ast.import_records.at(import_record_index as usize);
        // Barrel optimization: deferred import records should be dropped
        if record.flags.contains(bun_options_types::ImportRecordFlags::IS_UNUSED) {
            return Ok(true);
        }
        // Is this an external import?
        if !record.source_index.is_valid() {
            // Keep the "import" statement if import statements are supported
            if self.options.output_format.keep_es6_import_export_syntax() {
                return Ok(false);
            }

            // Otherwise, replace this statement with a call to "require()"
            stmts.inside_wrapper_prefix.append_non_dependency(
                Stmt::alloc(
                    S::Local {
                        decls: BabyList::<G::Decl>::from_slice(&[G::Decl {
                            binding: Binding::alloc(alloc, js_ast::ast::b::Identifier { r#ref: namespace_ref }, loc),
                            value: Some(Expr::init(
                                E::RequireString { import_record_index, ..Default::default() },
                                loc,
                            )),
                        }]).expect("unreachable"),
                        ..Default::default()
                    },
                    record.range.loc,
                ),
            ).expect("unreachable");
            return Ok(true);
        }

        // We don't need a call to "require()" if this is a self-import inside a
        // CommonJS-style module, since we can just reference the exports directly.
        if ast.exports_kind == ExportsKind::Cjs && self.graph.symbols.follow(namespace_ref).eql(ast.exports_ref) {
            return Ok(true);
        }

        let other_flags = self.graph.meta.items_flags()[record.source_index.get() as usize];
        match other_flags.wrap {
            WrapKind::None => {}
            WrapKind::Cjs => {
                // Replace the statement with a call to "require()" since the other module is CJS-wrapped
                stmts.inside_wrapper_prefix.append_non_dependency(
                    Stmt::alloc(
                        S::Local {
                            decls: BabyList::<G::Decl>::from_slice(&[G::Decl {
                                binding: Binding::alloc(alloc, js_ast::ast::b::Identifier { r#ref: namespace_ref }, loc),
                                value: Some(Expr::init(E::RequireString { import_record_index, ..Default::default() }, loc)),
                            }])?,
                            ..Default::default()
                        },
                        loc,
                    ),
                )?;
            }
            WrapKind::Esm => {
                // Ignore this file if it's not included in the bundle. This can happen for
                // wrapped ESM files but not for wrapped CommonJS files because we allow
                // tree shaking inside wrapped ESM files.
                if !self.graph.files_live.is_set(record.source_index.get() as usize) {
                    return Ok(true);
                }

                let wrapper_ref = self.graph.ast.items_wrapper_ref()[record.source_index.get() as usize];
                if wrapper_ref.is_empty() {
                    return Ok(true);
                }

                // Replace the statement with a call to "init()"
                let init_call = Expr::init(
                    E::Call {
                        target: Expr::init_identifier(wrapper_ref, loc),
                        ..Default::default()
                    },
                    loc,
                );

                if other_flags.is_async_or_has_async_dependency {
                    stmts.inside_wrapper_prefix.append_async_dependency(init_call, self.promise_all_runtime_ref)?;
                } else {
                    stmts.inside_wrapper_prefix.append_sync_dependency(init_call)?;
                }
            }
        }

        Ok(true)
    }

    // runtime_function: moved to the un-gated forward-decl impl block
    // (see "Forward-decl shims for scanImportsAndExports.rs callees" below).

    pub fn print_code_for_file_in_chunk_js(
        &mut self,
        r: renamer::Renamer,
        alloc: &Bump,
        writer: &mut js_printer::BufferWriter,
        out_stmts: &mut [Stmt],
        ast: &JSAst,
        flags: crate::ungate_support::js_meta::Flags,
        to_esm_ref: Ref,
        to_commonjs_ref: Ref,
        runtime_require_ref: Option<Ref>,
        source_index: Index,
        source: &Source,
    ) -> js_printer::PrintResult {
        let parts_to_print = &[Part { stmts: out_stmts as *mut [Stmt], ..Default::default() }];

        // SAFETY: parse_graph backref
        let parse_graph = unsafe { &*self.parse_graph };

        // PORT NOTE: `Options.allocator` / `source_map_allocator` were removed in
        // the Rust port (printer uses global mimalloc + the explicit `bump`
        // argument to `print_with_writer`). The dev-server source-map-allocator
        // selection is folded into TODO(b3) until allocator threading lands.
        let _ = self.dev_server.is_some()
            && parse_graph.input_files.items_loader()[source_index.get() as usize].is_javascript_like();

        let print_options = js_printer::Options {
            bundling: true,
            // TODO: IIFE
            indent: Default::default(),
            // PERF(port): Zig copied the StringArrayHashMap by value; the Rust
            // port's map isn't `Clone`, so move a fresh shallow handle in.
            // TODO(b3): switch `Options.commonjs_named_exports` to a borrow.
            commonjs_named_exports: Default::default(),
            commonjs_named_exports_ref: ast.exports_ref,
            commonjs_module_ref: if ast.flags.contains(AstFlags::USES_MODULE_REF) { ast.module_ref } else { Ref::NONE },
            commonjs_named_exports_deoptimized: flags.wrap == WrapKind::Cjs,
            commonjs_module_exports_assigned_deoptimized: ast.flags.contains(AstFlags::COMMONJS_MODULE_EXPORTS_ASSIGNED_DEOPTIMIZED),
            // .const_values = c.graph.const_values,
            ts_enums: core::mem::take(&mut self.graph.ts_enums),

            minify_whitespace: self.options.minify_whitespace,
            minify_syntax: self.options.minify_syntax,
            input_module_type: ast.exports_kind.to_module_type(),
            module_type: self.options.output_format,
            print_dce_annotations: self.options.emit_dce_annotations,
            has_run_symbol_renamer: true,

            to_esm_ref,
            to_commonjs_ref,
            require_ref: match self.options.output_format {
                Format::Cjs => None, // use unbounded global
                _ => runtime_require_ref,
            },
            require_or_import_meta_for_source_callback:
                js_printer::RequireOrImportMetaCallback::init(self),
            line_offset_tables: Some(core::mem::take(
                &mut self.graph.files.items_line_offset_table_mut()[source_index.get() as usize],
            )),
            target: self.options.target,

            hmr_ref: if self.options.output_format == Format::InternalBakeDev {
                ast.wrapper_ref
            } else {
                Ref::NONE
            },

            input_files_for_dev_server: if self.options.output_format == Format::InternalBakeDev {
                Some(parse_graph.input_files.items_source())
            } else {
                None
            },
            mangled_props: Some(&self.mangled_props),
            ..Default::default()
        };

        writer.buffer.reset();
        // PORT NOTE: Zig moved `*writer` into the printer by value and wrote it
        // back via `defer writer.* = printer.ctx;`. `BufferWriter` isn't
        // `Clone`/`Default` in Rust; move it through `mem::replace` with a
        // freshly-initialized writer instead.
        let printer =
            js_printer::BufferPrinter::init(core::mem::replace(writer, js_printer::BufferWriter::init()));

        let enable_source_maps = self.options.source_maps != SourceMapOption::None && !source_index.is_runtime();
        // PERF(port): was comptime bool dispatch — profile in Phase B
        // PORT NOTE: `print_with_writer<_, true/false>` ties `Renamer<'r,'src>`,
        // `&Bump`, `&Ast`, `&self` lifetimes invariantly together; the inputs
        // here come from disjoint borrows (`&mut self`, `r`, `alloc`, `ast`).
        // The Zig original threads raw pointers, so the actual lifetimes are
        // all "outlive this call". Body un-gates once `print_with_writer`
        // relaxes its variance or `BundledAst::to_ast` is borrow-based.
        let _ = (printer, alloc, ast, source, print_options, r, parts_to_print, enable_source_maps);
        todo!("blocked_on: js_printer::print_with_writer lifetime variance")
    }

    pub fn require_or_import_meta_for_source(
        &mut self,
        source_index: crate::IndexInt,
        was_unwrapped_require: bool,
    ) -> js_printer::RequireOrImportMeta {
        let flags = self.graph.meta.items_flags()[source_index as usize];
        js_printer::RequireOrImportMeta {
            exports_ref: if flags.wrap == WrapKind::Esm
                || (was_unwrapped_require && self.graph.ast.items_flags()[source_index as usize].contains(AstFlags::FORCE_CJS_TO_ESM))
            {
                self.graph.ast.items_exports_ref()[source_index as usize]
            } else {
                Ref::NONE
            },
            is_wrapper_async: flags.is_async_or_has_async_dependency,
            wrapper_ref: self.graph.ast.items_wrapper_ref()[source_index as usize],

            was_unwrapped_require: was_unwrapped_require
                && self.graph.ast.items_flags()[source_index as usize].contains(AstFlags::FORCE_CJS_TO_ESM),
        }
    }

    pub fn mangle_local_css(&mut self) {
        if self.has_any_css_locals.load(Ordering::Relaxed) == 0 {
            return;
        }

        let all_css_asts: &[Option<*mut core::ffi::c_void>] = self.graph.ast.items_css();
        let all_symbols: &[BabyList<Symbol>] = self.graph.ast.items_symbols();
        // SAFETY: parse_graph backref
        let all_sources: &[Source] = unsafe { (*self.parse_graph).input_files.items_source() };

        // Collect all local css names
        // PERF(port): was stack-fallback alloc
        let mut local_css_names: HashMap<Ref, ()> = HashMap::new();

        for (source_index, maybe_css_ast) in all_css_asts.iter().enumerate() {
            if let Some(css_ast_ptr) = maybe_css_ast {
                // SAFETY: the SoA `css` column stores type-erased
                // `*mut BundlerStyleSheet` (see `BundledAst.rs:58`); cast back
                // to the concrete type. Pointer owned by the graph arena.
                let css_ast = unsafe { &*(*css_ast_ptr as *mut css::BundlerStyleSheet) };
                if css_ast.local_scope.count() == 0 {
                    continue;
                }
                let symbols = &all_symbols[source_index];
                for (inner_index, symbol_) in symbols.slice_const().iter().enumerate() {
                    let mut symbol = symbol_;
                    if symbol.kind == js_ast::ast::symbol::Kind::LocalCss {
                        let r#ref = 'follow: {
                            // PORT NOTE: Zig set `.tag = .symbol` after `init`;
                            // `Ref` is packed in Rust — construct via `new`.
                            let mut r#ref = Ref::new(
                                u32::try_from(inner_index).unwrap(),
                                u32::try_from(source_index).unwrap(),
                                js_ast::RefTag::Symbol,
                            );
                            while symbol.has_link() {
                                r#ref = symbol.link;
                                symbol = all_symbols[r#ref.source_index() as usize]
                                    .at(r#ref.inner_index() as usize);
                            }
                            break 'follow r#ref;
                        };

                        let entry = local_css_names.get_or_put(r#ref).expect("OOM");
                        if entry.found_existing {
                            continue;
                        }

                        let source = &all_sources[r#ref.source_index() as usize];

                        // SAFETY: `Symbol.original_name` is a `*const [u8]` arena
                        // pointer; valid for the link step.
                        let original_name: &[u8] = unsafe { &*symbol.original_name };
                        // CYCLEBREAK FORWARD_DECL: `bun_css::css_modules::hash`
                        // is feature-gated; route through the local shim until
                        // the `css` feature is the default. The shim mirrors the
                        // real signature (path → fixed-width base62 hash).
                        let path_hash = css_modules_hash_shim(&source.path.pretty);

                        let mut final_generated_name = Vec::<u8>::new();
                        use std::io::Write;
                        write!(&mut final_generated_name, "{}_{}", bstr::BStr::new(original_name), bstr::BStr::new(&path_hash)).unwrap();
                        // TODO(port): allocator() is arena; mangled_props key/value lifetime
                        self.mangled_props.put(r#ref, final_generated_name.into_boxed_slice()).expect("OOM");
                    }
                }
            }
        }
    }

    pub fn append_isolated_hashes_for_imported_chunks(
        &self,
        hash: &mut ContentHasher,
        chunks: &mut [Chunk],
        index: u32,
        chunk_visit_map: &mut AutoBitSet,
    ) {
        // Only visit each chunk at most once. This is important because there may be
        // cycles in the chunk import graph. If there's a cycle, we want to include
        // the hash of every chunk involved in the cycle (along with all of their
        // dependencies). This depth-first traversal will naturally do that.
        if chunk_visit_map.is_set(index as usize) {
            return;
        }
        chunk_visit_map.set(index as usize);

        // Visit the other chunks that this chunk imports before visiting this chunk
        // PORT NOTE: reshaped for borrowck — collect imports first to avoid aliasing &chunks[index] with recursive &mut chunks
        let cross_chunk_imports: Vec<u32> = chunks[index as usize]
            .cross_chunk_imports
            .slice()
            .iter()
            .map(|import| import.chunk_index)
            .collect();
        for chunk_index in cross_chunk_imports {
            self.append_isolated_hashes_for_imported_chunks(hash, chunks, chunk_index, chunk_visit_map);
        }

        let chunk = &chunks[index as usize];

        // Mix in hashes for content referenced via output pieces. JS chunks
        // express cross-chunk dependencies via `cross_chunk_imports` above, but
        // HTML (and CSS) chunks only reference other chunks through pieces, so
        // recurse on those too.
        // PORT NOTE: reshaped for borrowck — collect piece queries first
        let piece_queries: Vec<(crate::chunk::QueryKind, u32)> =
            if let crate::chunk::IntermediateOutput::Pieces(pieces) = &chunk.intermediate_output {
                pieces.slice().iter().map(|p| (p.query.kind(), p.query.index())).collect()
            } else {
                Vec::new()
            };
        let final_rel_path = chunk.final_rel_path.clone();

        for (kind, piece_index) in piece_queries {
            match kind {
                crate::chunk::QueryKind::Asset => {
                    let mut from_chunk_dir = bun_paths::resolve_path::dirname::<bun_paths::resolve_path::platform::Posix>(&final_rel_path);
                    if from_chunk_dir == b"." {
                        from_chunk_dir = b"";
                    }

                    let source_index = piece_index;
                    // SAFETY: parse_graph backref
                    let parse_graph = unsafe { &*self.parse_graph };
                    let additional_files: &[AdditionalFile] =
                        parse_graph.input_files.items_additional_files()[source_index as usize].slice();
                    debug_assert!(!additional_files.is_empty());
                    match &additional_files[0] {
                        AdditionalFile::OutputFile(output_file_id) => {
                            let path = &parse_graph.additional_output_files[*output_file_id as usize].dest_path;
                            hash.write(bun_paths::resolve_path::relative_platform::<bun_paths::resolve_path::platform::Posix, false>(from_chunk_dir, path));
                        }
                        AdditionalFile::SourceIndex(_) => {}
                    }
                }
                crate::chunk::QueryKind::Chunk => {
                    self.append_isolated_hashes_for_imported_chunks(hash, chunks, piece_index, chunk_visit_map);
                }
                crate::chunk::QueryKind::Scb => {
                    self.append_isolated_hashes_for_imported_chunks(
                        hash,
                        chunks,
                        self.graph.files.items_entry_point_chunk_index()[piece_index as usize],
                        chunk_visit_map,
                    );
                }
                crate::chunk::QueryKind::None | crate::chunk::QueryKind::HtmlImport => {}
            }
        }

        // Mix in the hash for this chunk
        let chunk = &chunks[index as usize];
        // PORT NOTE: Zig `std.mem.asBytes(&u64)` → native-endian byte view.
        hash.write(&chunk.isolated_hash.to_ne_bytes());
    }

    // Sort cross-chunk exports by chunk name for determinism
    pub fn sorted_cross_chunk_export_items(
        &self,
        export_refs: &ChunkMetaMap,
        list: &mut Vec<StableRef>,
    ) {
        list.clear();
        list.reserve(export_refs.count());
        // PORT NOTE: Zig set .items.len = count() then indexed; Rust pushes
        for &export_ref in export_refs.keys() {
            #[cfg(debug_assertions)]
            {
                // SAFETY: `symbols.get` returns a stable `*mut Symbol` into the
                // SoA symbol table; read-only here. `parse_graph` is a backref
                // into BundleV2 (LIFETIMES.tsv).
                let sym = unsafe { &*self.graph.symbols.get(export_ref).unwrap() };
                debug_tree_shake!(
                    "Export name: {} (in {})",
                    bstr::BStr::new(unsafe { &*sym.original_name }),
                    bstr::BStr::new(unsafe {
                        &(*self.parse_graph).input_files.items_source()
                            [export_ref.source_index() as usize].path.text
                    }),
                );
            }
            list.push(StableRef {
                stable_source_index: *self.graph.stable_source_indices.at(export_ref.source_index() as usize),
                r#ref: export_ref,
            });
        }
        list.sort_by(|a, b| {
            if StableRef::is_less_than((), *a, *b) { core::cmp::Ordering::Less } else { core::cmp::Ordering::Greater }
        });
    }
} // end  — split: tree-shaking trio un-gated below (B-2 second pass)

/// CYCLEBREAK FORWARD_DECL: `bun_css::css_modules::hash` — the real CSS-modules
/// hasher is feature-gated (`feature = "css"`). With the feature on, delegate;
/// without it, mirror its shape (32-bit wyhash truncation, base62-ish encoding)
/// so `mangle_local_css` produces deterministic names. The hash *value* only
/// matters for cross-bundle determinism, not correctness.
#[cfg(feature = "css")]
#[inline]
fn css_modules_hash_shim(pretty_path: &[u8]) -> Box<[u8]> {
    ::bun_css::css_modules::hash(format_args!("{}", bstr::BStr::new(pretty_path)), false)
}
#[cfg(not(feature = "css"))]
#[inline]
fn css_modules_hash_shim(pretty_path: &[u8]) -> Box<[u8]> {
    let h = bun_core::hash::wyhash(pretty_path) as u32;
    let mut out = Vec::with_capacity(6);
    let mut n = h;
    const ALPHA: &[u8; 62] = b"0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    for _ in 0..6 {
        out.push(ALPHA[(n % 62) as usize]);
        n /= 62;
    }
    out.into_boxed_slice()
}

/// `js_printer::RequireOrImportMetaSource` — manual-vtable shim so the printer
/// can call back into `LinkerContext::require_or_import_meta_for_source`.
impl<'a> js_printer::RequireOrImportMetaSource for LinkerContext<'a> {
    #[inline]
    fn require_or_import_meta_for_source(&mut self, id: u32, was_unwrapped_require: bool) -> js_printer::RequireOrImportMeta {
        LinkerContext::require_or_import_meta_for_source(self, id, was_unwrapped_require)
    }
}

// ══════════════════════════════════════════════════════════════════════════
// B-2 second pass: un-gated tree-shaking primitives. These reach into
// `LinkerGraph` SoA columns (`files_live`, `meta.items_flags()`) and the
// `Graph::InputFileListExt` accessors. `LinkerGraph` real fields land via the
// concurrent `LinkerGraph.rs` un-gate; until lib.rs flips its module gate the
// stub `LinkerGraph(())` will surface here — expected and tracked.
// ══════════════════════════════════════════════════════════════════════════
impl<'a> LinkerContext<'a> {
    pub fn mark_file_reachable_for_code_splitting(
        &mut self,
        source_index: crate::IndexInt,
        entry_points_count: usize,
        distances: &mut [u32],
        distance: u32,
        // Spec (LinkerContext.zig:1579) passes `parts: []BabyList(Part)` and only
        // reads it. `&mut` here forced an aliased reborrow against the
        // `parts_in_file` slice below — borrowck conflict in un-gated code.
        parts: &[BabyList<Part>],
        import_records: &[BabyList<ImportRecord>],
        file_entry_bits: &mut [AutoBitSet],
        css_reprs: &[Option<*mut core::ffi::c_void>],
    ) {
        if !self.graph.files_live.is_set(source_index as usize) {
            return;
        }

        let cur_dist = distances[source_index as usize];
        let traverse_again = distance < cur_dist;
        if traverse_again {
            distances[source_index as usize] = distance;
        }
        let out_dist = distance + 1;

        let bits = &mut file_entry_bits[source_index as usize];

        // Don't mark this file more than once
        if bits.is_set(entry_points_count) && !traverse_again {
            return;
        }

        bits.set(entry_points_count);

        #[cfg(feature = "debug_logs")]
        {
            // SAFETY: parse_graph backref
            let parse_graph = unsafe { &*self.parse_graph };
            debug_tree_shake!(
                "markFileReachableForCodeSplitting(entry: {}): {} {} ({})",
                entry_points_count,
                bstr::BStr::new(&parse_graph.input_files.items_source()[source_index as usize].path.pretty),
                <&'static str>::from(parse_graph.ast.items_target()[source_index as usize].bake_graph()),
                out_dist,
            );
        }

        if css_reprs[source_index as usize].is_some() {
            for record in import_records[source_index as usize].slice() {
                if record.source_index.is_valid() && !self.is_external_dynamic_import(record, source_index) {
                    self.mark_file_reachable_for_code_splitting(
                        record.source_index.get(),
                        entry_points_count,
                        distances,
                        out_dist,
                        parts,
                        import_records,
                        file_entry_bits,
                        css_reprs,
                    );
                }
            }
            return;
        }

        for record in import_records[source_index as usize].slice() {
            if record.source_index.is_valid() && !self.is_external_dynamic_import(record, source_index) {
                self.mark_file_reachable_for_code_splitting(
                    record.source_index.get(),
                    entry_points_count,
                    distances,
                    out_dist,
                    parts,
                    import_records,
                    file_entry_bits,
                    css_reprs,
                );
            }
        }

        let parts_in_file = parts[source_index as usize].slice();
        for part in parts_in_file {
            for dependency in part.dependencies.slice() {
                if dependency.source_index.get() != source_index {
                    self.mark_file_reachable_for_code_splitting(
                        dependency.source_index.get(),
                        entry_points_count,
                        distances,
                        out_dist,
                        parts,
                        import_records,
                        file_entry_bits,
                        css_reprs,
                    );
                }
            }
        }
    }

    pub fn mark_file_live_for_tree_shaking(
        &mut self,
        source_index: crate::IndexInt,
        side_effects: &[SideEffects],
        parts: &mut [BabyList<Part>],
        import_records: &[BabyList<ImportRecord>],
        entry_point_kinds: &[EntryPoint::Kind],
        css_reprs: &[Option<*mut core::ffi::c_void>],
    ) {
        #[cfg(debug_assertions)]
        {
            // SAFETY: parse_graph backref
            let parse_graph = unsafe { &*self.parse_graph };
            debug_tree_shake!(
                "markFileLiveForTreeShaking({}, {} {}) = {}",
                source_index,
                bstr::BStr::new(&parse_graph.input_files.get(source_index as usize).source.path.pretty),
                // PORT NOTE: Zig printed `target.bakeGraph()` (a `bake.Graph` tag);
                // `bake_graph()` lives in `bun_bake` (tier-6 — would back-edge).
                // The debug log only needs a stable label, so print the `Target`
                // tag directly via its `IntoStaticStr` derive.
                <&'static str>::from(parse_graph.ast.items_target()[source_index as usize]),
                if self.graph.files_live.is_set(source_index as usize) { "already seen" } else { "first seen" },
            );
        }

        let _guard = scopeguard::guard((), |_| {
            #[cfg(debug_assertions)]
            debug_tree_shake!("end()");
        });

        if self.graph.files_live.is_set(source_index as usize) {
            return;
        }
        self.graph.files_live.set(source_index as usize);

        if source_index as usize >= self.graph.ast.len() {
            debug_assert!(false);
            return;
        }

        if css_reprs[source_index as usize].is_some() {
            for record in import_records[source_index as usize].slice() {
                let other_source_index = record.source_index.get();
                if record.source_index.is_valid() {
                    self.mark_file_live_for_tree_shaking(
                        other_source_index,
                        side_effects,
                        parts,
                        import_records,
                        entry_point_kinds,
                        css_reprs,
                    );
                }
            }
            return;
        }

        // HTML files can reference non-JS/CSS assets (favicons, images, etc.)
        // via .url kind import records. Follow all import records for HTML files
        // so these assets are marked live and included in the manifest.
        // SAFETY: parse_graph backref
        if unsafe { (*self.parse_graph).input_files.items_loader()[source_index as usize] } == Loader::Html {
            for record in import_records[source_index as usize].slice() {
                if record.source_index.is_valid() {
                    self.mark_file_live_for_tree_shaking(
                        record.source_index.get(),
                        side_effects,
                        parts,
                        import_records,
                        entry_point_kinds,
                        css_reprs,
                    );
                }
            }
            return;
        }

        let part_count = parts[source_index as usize].slice().len();
        for part_index in 0..part_count {
            // PORT NOTE: reshaped for borrowck — re-borrow part each iteration since recursion mutates `parts`
            let part = &parts[source_index as usize].slice()[part_index];
            let mut can_be_removed_if_unused = part.can_be_removed_if_unused;

            if can_be_removed_if_unused && part.tag == js_ast::PartTag::CommonjsNamedExport {
                if self.graph.meta.items_flags()[source_index as usize].wrap == WrapKind::Cjs {
                    can_be_removed_if_unused = false;
                }
            }

            // Also include any statement-level imports
            // PORT NOTE: clone indices to avoid holding borrow across recursive call
            let import_indices: Vec<u32> = part.import_record_indices.slice().to_vec();
            for import_index in import_indices {
                let record = import_records[source_index as usize].at(import_index as usize);
                if record.kind != ImportKind::Stmt {
                    continue;
                }

                if record.source_index.is_valid() {
                    let other_source_index = record.source_index.get();

                    // Don't include this module for its side effects if it can be
                    // considered to have no side effects
                    let se = side_effects[other_source_index as usize];

                    if se != SideEffects::HasSideEffects && !self.options.ignore_dce_annotations {
                        continue;
                    }

                    // Otherwise, include this module for its side effects
                    self.mark_file_live_for_tree_shaking(
                        other_source_index,
                        side_effects,
                        parts,
                        import_records,
                        entry_point_kinds,
                        css_reprs,
                    );
                } else if record.flags.contains(bun_options_types::ImportRecordFlags::IS_EXTERNAL_WITHOUT_SIDE_EFFECTS) {
                    // This can be removed if it's unused
                    continue;
                }

                // If we get here then the import was included for its side effects, so
                // we must also keep this part
                can_be_removed_if_unused = false;
            }

            // Include all parts in this file with side effects, or just include
            // everything if tree-shaking is disabled. Note that we still want to
            // perform tree-shaking on the runtime even if tree-shaking is disabled.
            let force_tree_shaking = parts[source_index as usize].slice()[part_index].force_tree_shaking;
            if !can_be_removed_if_unused
                || (!force_tree_shaking
                    && !self.options.tree_shaking
                    && entry_point_kinds[source_index as usize].is_entry_point())
            {
                self.mark_part_live_for_tree_shaking(
                    u32::try_from(part_index).unwrap(),
                    source_index,
                    side_effects,
                    parts,
                    import_records,
                    entry_point_kinds,
                    css_reprs,
                );
            }
        }
    }

    pub fn mark_part_live_for_tree_shaking(
        &mut self,
        part_index: crate::IndexInt,
        source_index: crate::IndexInt,
        side_effects: &[SideEffects],
        parts: &mut [BabyList<Part>],
        import_records: &[BabyList<ImportRecord>],
        entry_point_kinds: &[EntryPoint::Kind],
        css_reprs: &[Option<*mut core::ffi::c_void>],
    ) {
        let part: &mut Part = &mut parts[source_index as usize].slice_mut()[part_index as usize];

        // only once
        if part.is_live {
            return;
        }
        part.is_live = true;

        #[cfg(debug_assertions)]
        {
            // SAFETY: parse_graph backref
            let parse_graph = unsafe { &*self.parse_graph };
            // SAFETY: `part.stmts` is `*mut [Stmt]` (arena slice); reborrow for the
            // debug print only.
            let stmts: &[Stmt] = unsafe { &*part.stmts };
            debug_tree_shake!(
                "markPartLiveForTreeShaking({}): {}:{} = {}, {}",
                source_index,
                bstr::BStr::new(&parse_graph.input_files.get(source_index as usize).source.path.pretty),
                part_index,
                if !stmts.is_empty() { stmts[0].loc.start } else { Loc::EMPTY.start },
                // Zig used `@tagName(stmts[0].data)`. `StmtData::tag()` → `StmtTag` which
                // derives `strum::IntoStaticStr`.
                if !stmts.is_empty() { <&'static str>::from(stmts[0].data.tag()) } else { "s_empty" },
            );
        }

        let _guard = scopeguard::guard((), |_| {
            #[cfg(debug_assertions)]
            debug_tree_shake!("end()");
        });

        // PORT NOTE: reshaped for borrowck — clone dependencies before recursing (recursion mutates `parts`)
        let dependencies: Vec<Dependency> = part.dependencies.slice().to_vec();

        // Include the file containing this part
        self.mark_file_live_for_tree_shaking(
            source_index,
            side_effects,
            parts,
            import_records,
            entry_point_kinds,
            css_reprs,
        );

        #[cfg(feature = "debug_logs")]
        if dependencies.is_empty() {
            log_part_dependency_tree!("markPartLiveForTreeShaking {}:{} | EMPTY", source_index, part_index);
        }

        for dependency in &dependencies {
            #[cfg(feature = "debug_logs")]
            if source_index != 0 && dependency.source_index.get() != 0 {
                log_part_dependency_tree!(
                    "markPartLiveForTreeShaking: {}:{} --> {}:{}\n",
                    source_index, part_index, dependency.source_index.get(), dependency.part_index,
                );
            }

            self.mark_part_live_for_tree_shaking(
                dependency.part_index,
                dependency.source_index.get(),
                side_effects,
                parts,
                import_records,
                entry_point_kinds,
                css_reprs,
            );
        }
    }
} // end un-gated tree-shaking impl (B-2 second pass)

// ══════════════════════════════════════════════════════════════════════════
// `scanImportsAndExports.rs` callees — un-gated (B-2 third pass).
//
// `linker_context/scanImportsAndExports.rs` calls these `LinkerContext`
// methods inherently. Real ports of the `LinkerContext.zig` /
// `linker_context/doStep5.zig` / `linker_context/generateCodeForLazyExport.zig`
// bodies. The `` impl block immediately below retains the
// Phase-A drafts (now duplicated) until the next sweep removes them.
// ══════════════════════════════════════════════════════════════════════════

// Local imports for the un-gated bodies. `AstFlags` / `DeclaredSymbolList`
// already imported at the top of the file.
use bun_js_parser::{DependencyList, ImportItemStatus, PartSymbolUseMap};
use bun_js_parser::ast::symbol::Use as SymbolUse;

/// `bundle_v2.zig:ImportTracker.Status`. Mirrors the still-gated
/// `bundle_v2::ImportTrackerStatus` (inside the Phase-A `` draft);
/// collapses to a re-export once `bundle_v2` un-gates it.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum ImportTrackerStatus {
    /// The imported file has no matching export
    #[default]
    NoMatch,
    /// The imported file has a matching export
    Found,
    /// The imported file is CommonJS and has unknown exports
    Cjs,
    /// The import is missing but there is a dynamic fallback object
    DynamicFallback,
    /// The import is missing but there is a dynamic fallback object
    /// and the file was originally CommonJS.
    DynamicFallbackInteropDefault,
    /// The import was treated as a CommonJS import but the file is known to have no exports
    CjsWithoutExports,
    /// The imported file was disabled by mapping it to false in the "browser"
    /// field of package.json
    Disabled,
    /// The imported file is external and has unknown exports
    External,
    /// This is a missing re-export in a TypeScript file, so it's probably a type
    ProbablyTypescriptType,
}

/// `bundle_v2.zig:ImportTracker.Iterator`. See `ImportTrackerStatus` above.
#[derive(Default)]
pub struct ImportTrackerIterator {
    pub status: ImportTrackerStatus,
    pub value: ImportTracker,
    pub import_data: Box<[crate::ImportData]>,
}

/// CYCLEBREAK FORWARD_DECL: `bun_resolve_builtins::HardcodedModule::Alias::has`.
/// `bun_resolve_builtins` is not yet a dependency of `bun_bundler` (Cargo.toml
/// `TODO(b2-blocked)`); mirror the resolver's local stub so
/// `match_import_with_export` type-checks. Real lookup wires up when the dep
/// lands — until then no browser-polyfill-specific note is emitted (matches
/// `linker.rs::hardcoded_module`).
mod resolve_builtins_shim {
    pub mod HardcodedModule {
        pub mod Alias {
            #[inline]
            pub fn has(_name: &[u8], _target: super::super::RuntimeTarget, _opts: super::AliasOptions) -> bool {
                // TODO(b2-blocked): bun_resolve_builtins — real lookup table.
                false
            }
        }
        #[derive(Default, Clone, Copy)]
        pub struct AliasOptions {
            pub rewrite_jest_for_tests: bool,
        }
    }
    #[derive(Clone, Copy)]
    pub enum RuntimeTarget { Bun }
}

/// Field-wise eq for `ImportTracker` — `crate::ImportTracker` (the
/// `ungate_support` flavour) intentionally does not derive `PartialEq` so the
/// cycle-detector loop spells the comparison explicitly (matches Zig's
/// `eql(ImportTracker)` shape).
#[inline]
fn import_tracker_eq(a: &ImportTracker, b: &ImportTracker) -> bool {
    a.source_index.get() == b.source_index.get()
        && a.import_ref == b.import_ref
        && a.name_loc.start == b.name_loc.start
}

impl<'a> LinkerContext<'a> {
    /// Spec: `LinkerContext.zig:1298 runtimeFunction`.
    #[inline]
    pub fn runtime_function(&self, name: &[u8]) -> Ref {
        self.graph.runtime_function(name)
    }

    /// Spec: `LinkerContext.zig:2150 topLevelSymbolsToParts`.
    #[inline]
    pub fn top_level_symbols_to_parts(&self, id: u32, r#ref: Ref) -> &[u32] {
        self.graph.top_level_symbol_to_parts(id, r#ref)
    }

    /// Spec: `LinkerContext.zig:2154 topLevelSymbolsToPartsForRuntime`.
    #[inline]
    pub fn top_level_symbols_to_parts_for_runtime(&self, r#ref: Ref) -> &[u32] {
        self.top_level_symbols_to_parts(Index::RUNTIME.get(), r#ref)
    }

    /// Spec: `LinkerContext.zig:489 source_`.
    ///
    /// PORT NOTE: returns `'static` so callers can hold the source across a
    /// `&mut self.log` borrow; the underlying `parse_graph.input_files` slab
    /// is append-only and outlives the link step (LIFETIMES.tsv: GRAPHBACKED).
    #[inline]
    pub fn get_source(&self, index: u32) -> &'static Source {
        let index = index as usize;
        // SAFETY: parse_graph backref into BundleV2.graph; the input_files SoA
        // is monotonically grown and never freed for the link step's lifetime,
        // so the element address is stable. `'static` is a white lie matching
        // the `*mut Graph` erasure on `self.parse_graph`.
        unsafe { &*core::ptr::from_ref(&(*self.parse_graph).input_files.items_source()[index]) }
    }

    /// Spec: `LinkerContext.zig:496 scanCSSImports`.
    ///
    /// PORT NOTE: signature reshaped vs. the gated draft above — the un-gated
    /// caller (`scanImportsAndExports.rs`) holds raw SoA column pointers and
    /// passes the `css_asts` column as an opaque `*mut [Option<*mut c_void>]`
    /// (the `bun_css::BundlerStyleSheet` element type is still gated). `log`
    /// is borrowed through `&mut self` instead of as a separate parameter.
    pub fn scan_css_imports(
        &mut self,
        file_source_index: u32,
        file_import_records: &[ImportRecord],
        css_asts: *mut [Option<*mut core::ffi::c_void>],
        sources: &[Source],
        loaders: &[Loader],
    ) -> ScanCssImportsResult {
        // SAFETY: `css_asts` points at the `graph.ast.items_css()` column for
        // the duration of `scanImportsAndExports`; we only test `is_none()`.
        let css_asts: &[Option<*mut core::ffi::c_void>] = unsafe { &*css_asts };
        for record in file_import_records.iter() {
            if record.source_index.is_valid() {
                // Other file is not CSS
                if css_asts[record.source_index.get() as usize].is_none() {
                    let source = &sources[file_source_index as usize];
                    let loader = loaders[record.source_index.get() as usize];

                    match loader {
                        Loader::Jsx | Loader::Js | Loader::Ts | Loader::Tsx | Loader::Napi
                        | Loader::Sqlite | Loader::Json | Loader::Jsonc | Loader::Json5
                        | Loader::Yaml | Loader::Html | Loader::SqliteEmbedded | Loader::Md => {
                            self.log.add_error_fmt(
                                Some(source),
                                record.range.loc,
                                format_args!(
                                    "Cannot import a \".{}\" file into a CSS file",
                                    <&'static str>::from(loader),
                                ),
                            ).expect("OOM");
                        }
                        Loader::Css | Loader::File | Loader::Toml | Loader::Wasm
                        | Loader::Base64 | Loader::Dataurl | Loader::Text | Loader::Bunsh => {}
                    }
                }
            }
        }
        if self.log.errors > 0 { ScanCssImportsResult::Errors } else { ScanCssImportsResult::Ok }
    }

    /// Spec: `LinkerContext.zig:2158 createWrapperForFile`.
    pub fn create_wrapper_for_file(
        &mut self,
        wrap: WrapKind,
        wrapper_ref: Ref,
        // PORT NOTE: `crate::Index` (`bun_options_types::BundleEnums::Index`),
        // not `bun_js_parser::Index` — the SoA `wrapper_part_index` column is
        // typed via the crate-root re-export.
        wrapper_part_index: &mut crate::Index,
        source_index: crate::IndexInt,
    ) {
        match wrap {
            // If this is a CommonJS file, we're going to need to generate a wrapper
            // for the CommonJS closure. That will end up looking something like this:
            //
            //   var require_foo = __commonJS((exports, module) => {
            //     ...
            //   });
            //
            // However, that generation is special-cased for various reasons and is
            // done later on. Still, we're going to need to ensure that this file
            // both depends on the "__commonJS" symbol and declares the "require_foo"
            // symbol. Instead of special-casing this during the reachability analysis
            // below, we just append a dummy part to the end of the file with these
            // dependencies and let the general-purpose reachability analysis take care
            // of it.
            WrapKind::Cjs => {
                let common_js_parts = self.top_level_symbols_to_parts_for_runtime(self.cjs_runtime_ref);

                // PORT NOTE: reshaped for borrowck — Zig held `runtime_parts`
                // simultaneously with the mutable graph borrows below; the inner
                // loop is empty (`if r#ref.eql(...) continue;` only) so it's a
                // no-op kept for parity with the original.
                for &part_id in common_js_parts {
                    let runtime_parts = self.graph.ast.items_parts()[Index::RUNTIME.get() as usize].slice();
                    let part: &Part = &runtime_parts[part_id as usize];
                    let symbol_refs = part.symbol_uses.keys();
                    for r#ref in symbol_refs {
                        if *r#ref == self.cjs_runtime_ref {
                            continue;
                        }
                    }
                }

                // generate a dummy part that depends on the "__commonJS" symbol.
                let dependencies: DependencyList = if self.options.output_format != Format::InternalBakeDev {
                    let mut deps = BabyList::<Dependency>::init_capacity(common_js_parts.len()).expect("OOM");
                    for &part in common_js_parts {
                        deps.append_assume_capacity(Dependency {
                            part_index: part,
                            source_index: js_ast::Index::RUNTIME,
                        });
                    }
                    deps
                } else {
                    DependencyList::default()
                };
                let mut symbol_uses = PartSymbolUseMap::default();
                symbol_uses.put(wrapper_ref, SymbolUse { count_estimate: 1 }).expect("OOM");
                let exports_ref = self.graph.ast.items_exports_ref()[source_index as usize];
                let module_ref = self.graph.ast.items_module_ref()[source_index as usize];
                let wrap_ref = self.graph.ast.items_wrapper_ref()[source_index as usize];
                let part_index = self.graph.add_part_to_file(
                    source_index,
                    Part {
                        symbol_uses,
                        declared_symbols: DeclaredSymbolList::from_slice(&[
                            DeclaredSymbol { ref_: exports_ref, is_top_level: true },
                            DeclaredSymbol { ref_: module_ref, is_top_level: true },
                            DeclaredSymbol { ref_: wrap_ref, is_top_level: true },
                        ]).expect("unreachable"),
                        dependencies,
                        ..Default::default()
                    },
                ).expect("unreachable");
                debug_assert!(part_index != js_ast::NAMESPACE_EXPORT_PART_INDEX);
                *wrapper_part_index = crate::Index::part(part_index);

                // Bake uses a wrapping approach that does not use __commonJS
                if self.options.output_format != Format::InternalBakeDev {
                    self.graph.generate_symbol_import_and_use(
                        source_index,
                        part_index,
                        self.cjs_runtime_ref,
                        1,
                        crate::Index::RUNTIME,
                    ).expect("unreachable");
                }
            }

            WrapKind::Esm => {
                // If this is a lazily-initialized ESM file, we're going to need to
                // generate a wrapper for the ESM closure. That will end up looking
                // something like this:
                //
                //   var init_foo = __esm(() => {
                //     ...
                //   });
                //
                // This depends on the "__esm" symbol and declares the "init_foo" symbol
                // for similar reasons to the CommonJS closure above.

                // Count async dependencies to determine if we need __promiseAll
                let mut async_import_count: usize = 0;
                {
                    let import_records = self.graph.ast.items_import_records()[source_index as usize].slice();
                    let meta_flags = self.graph.meta.items_flags();

                    for record in import_records {
                        if !record.source_index.is_valid() {
                            continue;
                        }
                        let other_flags = meta_flags[record.source_index.get() as usize];
                        if other_flags.is_async_or_has_async_dependency {
                            async_import_count += 1;
                            if async_import_count >= 2 {
                                break;
                            }
                        }
                    }
                }

                let needs_promise_all = async_import_count >= 2;

                let esm_parts: &[u32] = if wrapper_ref.is_valid() && self.options.output_format != Format::InternalBakeDev {
                    self.top_level_symbols_to_parts_for_runtime(self.esm_runtime_ref)
                } else {
                    &[]
                };

                let promise_all_parts: &[u32] = if needs_promise_all && wrapper_ref.is_valid() && self.options.output_format != Format::InternalBakeDev {
                    self.top_level_symbols_to_parts_for_runtime(self.promise_all_runtime_ref)
                } else {
                    &[]
                };

                // generate a dummy part that depends on the "__esm" and optionally "__promiseAll" symbols
                let mut dependencies =
                    BabyList::<Dependency>::init_capacity(esm_parts.len() + promise_all_parts.len()).expect("OOM");
                for &part in esm_parts {
                    dependencies.append_assume_capacity(Dependency { part_index: part, source_index: js_ast::Index::RUNTIME });
                }
                for &part in promise_all_parts {
                    dependencies.append_assume_capacity(Dependency { part_index: part, source_index: js_ast::Index::RUNTIME });
                }

                let mut symbol_uses = PartSymbolUseMap::default();
                symbol_uses.put(wrapper_ref, SymbolUse { count_estimate: 1 }).expect("OOM");
                let part_index = self.graph.add_part_to_file(
                    source_index,
                    Part {
                        symbol_uses,
                        declared_symbols: DeclaredSymbolList::from_slice(&[
                            DeclaredSymbol { ref_: wrapper_ref, is_top_level: true },
                        ]).expect("unreachable"),
                        dependencies,
                        ..Default::default()
                    },
                ).expect("unreachable");
                debug_assert!(part_index != js_ast::NAMESPACE_EXPORT_PART_INDEX);
                *wrapper_part_index = crate::Index::part(part_index);
                if wrapper_ref.is_valid() && self.options.output_format != Format::InternalBakeDev {
                    self.graph.generate_symbol_import_and_use(
                        source_index,
                        part_index,
                        self.esm_runtime_ref,
                        1,
                        crate::Index::RUNTIME,
                    ).expect("OOM");

                    // Only mark __promiseAll as used if we have multiple async dependencies
                    if needs_promise_all {
                        self.graph.generate_symbol_import_and_use(
                            source_index,
                            part_index,
                            self.promise_all_runtime_ref,
                            1,
                            crate::Index::RUNTIME,
                        ).expect("OOM");
                    }
                }
            }
            WrapKind::None => {}
        }
    }

    /// Spec: `LinkerContext.zig:1710 advanceImportTracker`.
    pub fn advance_import_tracker(&mut self, tracker: &ImportTracker) -> ImportTrackerIterator {
        let id = tracker.source_index.get();
        // PORT NOTE: reshaped for borrowck — Zig held `&mut named_imports[id]`
        // and `&import_records[id]` simultaneously; here we read `named_import`
        // out first, then borrow the rest.
        let named_import: &NamedImport = match self.graph.ast.items_named_imports()[id as usize].get(&tracker.import_ref) {
            Some(ni) => ni,
            None => {
                // TODO: investigate if this is a bug
                // It implies there are imports being added without being resolved
                return ImportTrackerIterator {
                    value: Default::default(),
                    status: ImportTrackerStatus::External,
                    ..Default::default()
                };
            }
        };
        let import_records = &self.graph.ast.items_import_records()[id as usize];
        let exports_kind: &[ExportsKind] = self.graph.ast.items_exports_kind();
        let ast_flags = self.graph.ast.items_flags();

        // Is this an external file?
        let record: &ImportRecord = import_records.at(named_import.import_record_index as usize);
        if !record.source_index.is_valid() {
            return ImportTrackerIterator {
                value: Default::default(),
                status: ImportTrackerStatus::External,
                ..Default::default()
            };
        }

        // Barrel optimization: deferred import records point to empty ASTs
        if record.flags.contains(bun_options_types::import_record::Flags::IS_UNUSED) {
            return ImportTrackerIterator {
                value: Default::default(),
                status: ImportTrackerStatus::External,
                ..Default::default()
            };
        }

        // Is this a disabled file?
        let other_source_index = record.source_index.get();
        let other_id = other_source_index;

        // SAFETY: parse_graph backref
        if other_id as usize > self.graph.ast.len()
            || unsafe { (*self.parse_graph).input_files.items_source()[other_source_index as usize].path.is_disabled }
        {
            return ImportTrackerIterator {
                value: ImportTracker { source_index: record.source_index, ..Default::default() },
                status: ImportTrackerStatus::Disabled,
                ..Default::default()
            };
        }

        let flags = ast_flags[other_id as usize];

        // Is this a named import of a file without any exports?
        if !named_import.alias_is_star
            && flags.contains(AstFlags::HAS_LAZY_EXPORT)
            // ESM exports
            && !flags.contains(AstFlags::USES_EXPORT_KEYWORD)
            // SAFETY: `alias` is an arena `*const [u8]` valid for the link pass.
            && named_import.alias.map(|a| unsafe { &*a } != b"default").unwrap_or(true)
            // CommonJS exports
            && !flags.contains(AstFlags::USES_EXPORTS_REF)
            && !flags.contains(AstFlags::USES_MODULE_REF)
        {
            // Just warn about it and replace the import with "undefined"
            return ImportTrackerIterator {
                value: ImportTracker {
                    source_index: crate::Index::init(other_source_index),
                    import_ref: Ref::NONE,
                    ..Default::default()
                },
                status: ImportTrackerStatus::CjsWithoutExports,
                ..Default::default()
            };
        }
        let other_kind = exports_kind[other_id as usize];
        // Is this a CommonJS file?
        if other_kind == ExportsKind::Cjs {
            return ImportTrackerIterator {
                value: ImportTracker {
                    source_index: crate::Index::init(other_source_index),
                    import_ref: Ref::NONE,
                    ..Default::default()
                },
                status: ImportTrackerStatus::Cjs,
                ..Default::default()
            };
        }

        // Match this import star with an export star from the imported file
        if named_import.alias_is_star {
            let matching_export = &self.graph.meta.items_resolved_export_star()[other_id as usize];
            if matching_export.data.import_ref.is_valid() {
                // Check to see if this is a re-export of another import
                return ImportTrackerIterator {
                    value: matching_export.data,
                    status: ImportTrackerStatus::Found,
                    import_data: matching_export
                        .potentially_ambiguous_export_star_refs
                        .slice()
                        .iter()
                        .map(|d| crate::ImportData { data: d.data, ..Default::default() })
                        .collect(),
                };
            }
        }

        // Match this import up with an export from the imported file
        // SAFETY: `alias` is an arena `*const [u8]` valid for the link pass.
        if let Some(matching_export) = self.graph.meta.items_resolved_exports()[other_id as usize]
            .get(unsafe { &*named_import.alias.unwrap() })
        {
            // Check to see if this is a re-export of another import
            return ImportTrackerIterator {
                value: ImportTracker {
                    source_index: matching_export.data.source_index,
                    import_ref: matching_export.data.import_ref,
                    name_loc: matching_export.data.name_loc,
                },
                status: ImportTrackerStatus::Found,
                import_data: matching_export
                    .potentially_ambiguous_export_star_refs
                    .slice()
                    .iter()
                    .map(|d| crate::ImportData { data: d.data, ..Default::default() })
                    .collect(),
            };
        }

        // Is this a file with dynamic exports?
        let is_commonjs_to_esm = flags.contains(AstFlags::FORCE_CJS_TO_ESM);
        if other_kind.is_esm_with_dynamic_fallback() || is_commonjs_to_esm {
            return ImportTrackerIterator {
                value: ImportTracker {
                    source_index: crate::Index::init(other_source_index),
                    import_ref: self.graph.ast.items_exports_ref()[other_id as usize],
                    ..Default::default()
                },
                status: if is_commonjs_to_esm {
                    ImportTrackerStatus::DynamicFallbackInteropDefault
                } else {
                    ImportTrackerStatus::DynamicFallback
                },
                ..Default::default()
            };
        }

        // Missing re-exports in TypeScript files are indistinguishable from types
        // SAFETY: parse_graph backref
        let other_loader = unsafe { (*self.parse_graph).input_files.items_loader()[other_id as usize] };
        if named_import.is_exported && other_loader.is_typescript() {
            return ImportTrackerIterator {
                value: Default::default(),
                status: ImportTrackerStatus::ProbablyTypescriptType,
                ..Default::default()
            };
        }

        ImportTrackerIterator {
            value: ImportTracker {
                source_index: crate::Index::init(other_source_index),
                ..Default::default()
            },
            status: ImportTrackerStatus::NoMatch,
            ..Default::default()
        }
    }

    /// Spec: `LinkerContext.zig:1443 matchImportWithExport`.
    pub fn match_import_with_export(
        &mut self,
        init_tracker: ImportTracker,
        re_exports: &mut Vec<Dependency>,
    ) -> MatchImport {
        let cycle_detector_top = self.cycle_detector.len();
        // PORT NOTE: Zig's `defer cycle_detector.shrinkRetainingCapacity` is
        // lowered to an explicit `truncate` after the `'loop_` below — the only
        // exits are the three `return`s that follow it, so a single post-loop
        // truncate covers every path. A scopeguard holding a raw `*mut` into
        // `self.cycle_detector` would be invalidated by the `&mut self`
        // reborrows inside the loop (Stacked Borrows), so we don't use one.

        let mut tracker = init_tracker;
        let mut ambiguous_results: Vec<MatchImport> = Vec::new();
        let mut result: MatchImport = MatchImport::default();

        'loop_: loop {
            // Make sure we avoid infinite loops trying to resolve cycles:
            //
            //   // foo.js
            //   export {a as b} from './foo.js'
            //   export {b as c} from './foo.js'
            //   export {c as a} from './foo.js'
            //
            // This uses a O(n^2) array scan instead of a O(n) map because the vast
            // majority of cases have one or two elements
            for prev_tracker in &self.cycle_detector[cycle_detector_top..] {
                if import_tracker_eq(&tracker, prev_tracker) {
                    result = MatchImport { kind: MatchImportKind::Cycle, ..Default::default() };
                    break 'loop_;
                }
            }

            if tracker.source_index.is_invalid() {
                // External
                break;
            }

            let prev_source_index = tracker.source_index.get();
            self.cycle_detector.push(tracker);

            // Resolve the import by one step
            let advanced = self.advance_import_tracker(&tracker);
            let next_tracker = advanced.value;
            let status = advanced.status;
            let potentially_ambiguous_export_star_refs = advanced.import_data;

            match status {
                ImportTrackerStatus::Cjs
                | ImportTrackerStatus::CjsWithoutExports
                | ImportTrackerStatus::Disabled
                | ImportTrackerStatus::External => {
                    if status == ImportTrackerStatus::External
                        && self.options.output_format.keep_es6_import_export_syntax()
                    {
                        // Imports from external modules should not be converted to CommonJS
                        // if the output format preserves the original ES6 import statements
                        break;
                    }

                    // If it's a CommonJS or external file, rewrite the import to a
                    // property access. Don't do this if the namespace reference is invalid
                    // though. This is the case for star imports, where the import is the
                    // namespace.
                    let named_import: &NamedImport = self.graph.ast.items_named_imports()[prev_source_index as usize]
                        .get(&tracker.import_ref).unwrap();

                    if named_import.namespace_ref.is_some() && named_import.namespace_ref.unwrap().is_valid() {
                        if result.kind == MatchImportKind::Normal {
                            result.kind = MatchImportKind::NormalAndNamespace;
                            result.namespace_ref = named_import.namespace_ref.unwrap();
                            result.alias = named_import.alias.unwrap();
                        } else {
                            result = MatchImport {
                                kind: MatchImportKind::Namespace,
                                namespace_ref: named_import.namespace_ref.unwrap(),
                                alias: named_import.alias.unwrap(),
                                ..Default::default()
                            };
                        }
                    }

                    // Warn about importing from a file that is known to not have any exports
                    if status == ImportTrackerStatus::CjsWithoutExports {
                        let source = self.get_source(tracker.source_index.get() as usize);
                        // SAFETY: `alias` is an arena `*const [u8]` valid for the link pass.
                        let alias = unsafe { &*named_import.alias.unwrap() };
                        self.log.add_range_warning_fmt(
                            Some(source),
                            source.range_of_identifier(named_import.alias_loc.unwrap()),
                            format_args!(
                                "Import \"{}\" will always be undefined because the file \"{}\" has no exports",
                                bstr::BStr::new(alias),
                                bstr::BStr::new(&self.get_source(next_tracker.source_index.get() as usize).path.pretty),
                            ),
                        ).expect("unreachable");
                    }
                }

                ImportTrackerStatus::DynamicFallbackInteropDefault => {
                    // if the file was rewritten from CommonJS into ESM
                    // and the developer imported an export that doesn't exist
                    // We don't do a runtime error since that CJS would have returned undefined.
                    let named_import: &NamedImport = self.graph.ast.items_named_imports()[prev_source_index as usize]
                        .get(&tracker.import_ref).unwrap();

                    if named_import.namespace_ref.is_some() && named_import.namespace_ref.unwrap().is_valid() {
                        // SAFETY: get() yields a stable *mut into the symbols NestedList
                        // (NonNull-backed heap, never reallocated during linking). Sole
                        // live &mut into that allocation here — `named_import` borrows
                        // `graph.ast`, a disjoint allocation.
                        let symbol = unsafe { &mut *self.graph.symbols.get(tracker.import_ref).unwrap() };
                        symbol.import_item_status = ImportItemStatus::Missing;
                        result.kind = MatchImportKind::NormalAndNamespace;
                        result.namespace_ref = tracker.import_ref;
                        result.alias = named_import.alias.unwrap();
                        result.name_loc = named_import.alias_loc.unwrap_or(Loc::EMPTY);
                    }
                }

                ImportTrackerStatus::DynamicFallback => {
                    // If it's a file with dynamic export fallback, rewrite the import to a property access
                    let named_import: &NamedImport = self.graph.ast.items_named_imports()[prev_source_index as usize]
                        .get(&tracker.import_ref).unwrap();
                    if named_import.namespace_ref.is_some() && named_import.namespace_ref.unwrap().is_valid() {
                        if result.kind == MatchImportKind::Normal {
                            result.kind = MatchImportKind::NormalAndNamespace;
                            result.namespace_ref = next_tracker.import_ref;
                            result.alias = named_import.alias.unwrap();
                        } else {
                            result = MatchImport {
                                kind: MatchImportKind::Namespace,
                                namespace_ref: next_tracker.import_ref,
                                alias: named_import.alias.unwrap(),
                                ..Default::default()
                            };
                        }
                    }
                }
                ImportTrackerStatus::NoMatch => {
                    // Report mismatched imports and exports
                    // SAFETY: get() yields a stable *mut into the symbols NestedList
                    // (NonNull-backed heap, never reallocated during linking). Sole live
                    // &mut into that allocation for this scope — subsequent borrows
                    // (`named_import` from graph.ast, `get_source` from parse_graph,
                    // `self.log`) touch disjoint allocations and never reach symbols.
                    let symbol = unsafe { &mut *self.graph.symbols.get(tracker.import_ref).unwrap() };
                    let named_import: &NamedImport = self.graph.ast.items_named_imports()[prev_source_index as usize]
                        .get(&tracker.import_ref).unwrap();
                    let source = self.get_source(prev_source_index as usize);

                    let next_source = self.get_source(next_tracker.source_index.get() as usize);
                    let r = source.range_of_identifier(named_import.alias_loc.unwrap());
                    // SAFETY: arena `*const [u8]` valid for the link pass.
                    let alias = unsafe { &*named_import.alias.unwrap() };

                    // Report mismatched imports and exports
                    if symbol.import_item_status == ImportItemStatus::Generated {
                        // This is a debug message instead of an error because although it
                        // appears to be a named import, it's actually an automatically-
                        // generated named import that was originally a property access on an
                        // import star namespace object. Normally this property access would
                        // just resolve to undefined at run-time instead of failing at binding-
                        // time, so we emit a debug message and rewrite the value to the literal
                        // "undefined" instead of emitting an error.
                        symbol.import_item_status = ImportItemStatus::Missing;

                        // SAFETY: resolver backref into BundleV2.transpiler.resolver (LIFETIMES.tsv)
                        if unsafe { (*self.resolver).opts.target } == Target::Browser
                            && resolve_builtins_shim::HardcodedModule::Alias::has(
                                &next_source.path.pretty,
                                resolve_builtins_shim::RuntimeTarget::Bun,
                                Default::default(),
                            )
                        {
                            self.log.add_range_warning_fmt_with_note(
                                Some(source), r,
                                format_args!(
                                    "Browser polyfill for module \"{}\" doesn't have a matching export named \"{}\"",
                                    bstr::BStr::new(&next_source.path.pretty),
                                    bstr::BStr::new(alias),
                                ),
                                format_args!("Bun's bundler defaults to browser builds instead of node or bun builds. If you want to use node or bun builds, you can set the target to \"node\" or \"bun\" in the transpiler options."),
                                r,
                            ).expect("unreachable");
                        } else {
                            self.log.add_range_warning_fmt(
                                Some(source), r,
                                format_args!(
                                    "Import \"{}\" will always be undefined because there is no matching export in \"{}\"",
                                    bstr::BStr::new(alias),
                                    bstr::BStr::new(&next_source.path.pretty),
                                ),
                            ).expect("unreachable");
                        }
                    } else if unsafe {
                        // SAFETY: resolver is a BACKREF into BundleV2.transpiler.resolver (LIFETIMES.tsv)
                        (*self.resolver).opts.target
                    } == Target::Browser
                        && next_source.path.text.starts_with(NodeFallbackModules::IMPORT_PATH)
                    {
                        self.log.add_range_error_fmt_with_note(
                            Some(source), r,
                            format_args!(
                                "Browser polyfill for module \"{}\" doesn't have a matching export named \"{}\"",
                                bstr::BStr::new(&next_source.path.pretty),
                                bstr::BStr::new(alias),
                            ),
                            format_args!("Bun's bundler defaults to browser builds instead of node or bun builds. If you want to use node or bun builds, you can set the target to \"node\" or \"bun\" in the transpiler options."),
                            r,
                        ).expect("unreachable");
                    } else {
                        self.log.add_range_error_fmt(
                            Some(source), r,
                            format_args!(
                                "No matching export in \"{}\" for import \"{}\"",
                                bstr::BStr::new(&next_source.path.pretty),
                                bstr::BStr::new(alias),
                            ),
                        ).expect("unreachable");
                    }
                }
                ImportTrackerStatus::ProbablyTypescriptType => {
                    // Omit this import from any namespace export code we generate for
                    // import star statements (i.e. "import * as ns from 'path'")
                    result = MatchImport { kind: MatchImportKind::ProbablyTypescriptType, ..Default::default() };
                }
                ImportTrackerStatus::Found => {
                    // If there are multiple ambiguous results due to use of "export * from"
                    // statements, trace them all to see if they point to different things.
                    for ambiguous_tracker in potentially_ambiguous_export_star_refs.iter() {
                        // If this is a re-export of another import, follow the import
                        if self.graph.ast.items_named_imports()[ambiguous_tracker.data.source_index.get() as usize]
                            .contains(&ambiguous_tracker.data.import_ref)
                        {
                            let ambig = self.match_import_with_export(ambiguous_tracker.data, re_exports);
                            ambiguous_results.push(ambig);
                        } else {
                            ambiguous_results.push(MatchImport {
                                kind: MatchImportKind::Normal,
                                source_index: ambiguous_tracker.data.source_index.get(),
                                r#ref: ambiguous_tracker.data.import_ref,
                                name_loc: ambiguous_tracker.data.name_loc,
                                ..Default::default()
                            });
                        }
                    }

                    // Defer the actual binding of this import until after we generate
                    // namespace export code for all files. This has to be done for all
                    // import-to-export matches, not just the initial import to the final
                    // export, since all imports and re-exports must be merged together
                    // for correctness.
                    result = MatchImport {
                        kind: MatchImportKind::Normal,
                        source_index: next_tracker.source_index.get(),
                        r#ref: next_tracker.import_ref,
                        name_loc: next_tracker.name_loc,
                        ..Default::default()
                    };

                    // Depend on the statement(s) that declared this import symbol in the
                    // original file
                    {
                        let deps = self.top_level_symbols_to_parts(prev_source_index, tracker.import_ref);
                        re_exports.reserve(deps.len());
                        for &dep in deps {
                            re_exports.push(Dependency {
                                part_index: dep,
                                source_index: js_ast::Index::init(tracker.source_index.get()),
                            });
                            // PERF(port): was assume_capacity
                        }
                    }

                    // If this is a re-export of another import, continue for another
                    // iteration of the loop to resolve that import as well
                    let next_id = next_tracker.source_index.get();
                    if self.graph.ast.items_named_imports()[next_id as usize].contains(&next_tracker.import_ref) {
                        tracker = next_tracker;
                        continue 'loop_;
                    }
                }
            }

            break 'loop_;
        }

        // Spec `defer`: restore cycle_detector to its entry length now that the
        // loop is done. All remaining exit paths are below this point.
        self.cycle_detector.truncate(cycle_detector_top);

        // If there is a potential ambiguity, all results must be the same
        for ambig in &ambiguous_results {
            if *ambig != result {
                if result.kind == ambig.kind
                    && ambig.kind == MatchImportKind::Normal
                    && ambig.name_loc.start != 0
                    && result.name_loc.start != 0
                {
                    return MatchImport {
                        kind: MatchImportKind::Ambiguous,
                        source_index: result.source_index,
                        name_loc: result.name_loc,
                        other_source_index: ambig.source_index,
                        other_name_loc: ambig.name_loc,
                        ..Default::default()
                    };
                }

                return MatchImport { kind: MatchImportKind::Ambiguous, ..Default::default() };
            }
        }

        result
    }

    /// Spec: `LinkerContext.zig:2471 matchImportsWithExportsForFile`.
    pub fn match_imports_with_exports_for_file(
        &mut self,
        named_imports_ptr: *const bun_js_parser::ast::bundled_ast::NamedImports,
        imports_to_bind: &mut crate::RefImportData,
        source_index: crate::IndexInt,
    ) {
        // PORT NOTE: Zig clones into a local, sorts, iterates, then writes back.
        // `ArrayHashMap` has no in-place key sort and `NamedImport` is non-Clone
        // (owns a `BabyList`), so we sort an index vector over the live
        // keys/values instead — same observable iteration order (ascending
        // `inner_index`). The write-back is a no-op here since we never mutate
        // the map.
        //
        // The Zig clone existed to break the alias between this parameter and
        // `self.graph.ast.named_imports[source_index]`, which
        // `match_import_with_export` re-reads via the SoA column. Taking the
        // parameter as a raw `*const` (no uniqueness assertion) and reading
        // through it preserves that alias-safety without the clone: no live
        // `&`/`&mut` to the column element spans the `&mut self` call below.
        //
        // SAFETY: `named_imports_ptr` points into the `graph.ast.named_imports`
        // SoA column, which is never reallocated during linking; the loop body
        // never mutates that column (only `imports_to_bind`/`log`/`symbols`/
        // `meta.probably_typescript_type`), so the backing `keys`/`values`
        // slices stay valid for the whole loop.
        let keys: *const [Ref] = unsafe { (*named_imports_ptr).keys() };
        let values: *const [NamedImport] = unsafe { (*named_imports_ptr).values() };
        let mut order: Vec<usize> = (0..unsafe { (&*keys).len() }).collect();
        order.sort_by(|&a, &b| unsafe { (&*keys)[a].inner_index().cmp(&(&*keys)[b].inner_index()) });

        for &i in &order {
            // SAFETY: see above.
            let import_ref = unsafe { (*keys)[i] };
            let named_import = unsafe { &(*values)[i] };

            // Re-use memory for the cycle detector
            self.cycle_detector.clear();

            let mut re_exports: Vec<Dependency> = Vec::new();
            let result = self.match_import_with_export(
                ImportTracker {
                    source_index: crate::Index::init(source_index),
                    import_ref,
                    ..Default::default()
                },
                &mut re_exports,
            );

            match result.kind {
                MatchImportKind::Normal => {
                    imports_to_bind.put(
                        import_ref,
                        crate::ImportData {
                            re_exports: BabyList::<Dependency>::move_from_list(re_exports),
                            data: ImportTracker {
                                source_index: crate::Index::init(result.source_index),
                                import_ref: result.r#ref,
                                ..Default::default()
                            },
                        },
                    ).expect("unreachable");
                }
                MatchImportKind::Namespace => {
                    // SAFETY: get() yields a stable *mut into the symbols NestedList
                    // (NonNull-backed heap, never reallocated during linking). Sole
                    // live &mut into that allocation — one-shot field store, no other
                    // borrow of symbols is live in this arm.
                    unsafe { &mut *self.graph.symbols.get(import_ref).unwrap() }.namespace_alias =
                        Some(G::NamespaceAlias {
                            namespace_ref: result.namespace_ref,
                            alias: result.alias,
                            ..Default::default()
                        });
                }
                MatchImportKind::NormalAndNamespace => {
                    imports_to_bind.put(
                        import_ref,
                        crate::ImportData {
                            re_exports: BabyList::<Dependency>::move_from_list(re_exports),
                            data: ImportTracker {
                                source_index: crate::Index::init(result.source_index),
                                import_ref: result.r#ref,
                                ..Default::default()
                            },
                        },
                    ).expect("unreachable");

                    // SAFETY: get() yields a stable *mut into the symbols NestedList
                    // (NonNull-backed heap, never reallocated during linking). Sole
                    // live &mut into that allocation — one-shot field store after
                    // `imports_to_bind.put` (disjoint map) has fully returned.
                    unsafe { &mut *self.graph.symbols.get(import_ref).unwrap() }.namespace_alias =
                        Some(G::NamespaceAlias {
                            namespace_ref: result.namespace_ref,
                            alias: result.alias,
                            ..Default::default()
                        });
                }
                MatchImportKind::Cycle => {
                    let source = self.get_source(source_index as usize);
                    let r = lex::range_of_identifier(source, named_import.alias_loc.unwrap_or(Loc::default()));
                    // SAFETY: arena `*const [u8]` valid for the link pass.
                    let alias = unsafe { &*named_import.alias.unwrap() };
                    self.log.add_range_error_fmt(
                        Some(source), r,
                        format_args!(
                            "Detected cycle while resolving import \"{}\"",
                            bstr::BStr::new(alias),
                        ),
                    ).expect("unreachable");
                }
                MatchImportKind::ProbablyTypescriptType => {
                    self.graph.meta.items_probably_typescript_type_mut()[source_index as usize]
                        .put(import_ref, ())
                        .expect("unreachable");
                }
                MatchImportKind::Ambiguous => {
                    let source = self.get_source(source_index as usize);
                    let r = lex::range_of_identifier(source, named_import.alias_loc.unwrap_or(Loc::default()));

                    // TODO: log locations of the ambiguous exports

                    // SAFETY: get() yields a stable *mut into the symbols NestedList
                    // (NonNull-backed heap, never reallocated during linking). Sole
                    // live &mut into that allocation for this scope — `source`/`r`
                    // borrow parse_graph, `named_import`/`alias` borrow arena slices,
                    // and `self.log` is a disjoint field; none reach symbols.
                    let symbol = unsafe { &mut *self.graph.symbols.get(import_ref).unwrap() };
                    // SAFETY: arena `*const [u8]` valid for the link pass.
                    let alias = unsafe { &*named_import.alias.unwrap() };
                    if symbol.import_item_status == ImportItemStatus::Generated {
                        symbol.import_item_status = ImportItemStatus::Missing;
                        self.log.add_range_warning_fmt(
                            Some(source), r,
                            format_args!(
                                "Import \"{}\" will always be undefined because there are multiple matching exports",
                                bstr::BStr::new(alias),
                            ),
                        ).expect("unreachable");
                    } else {
                        self.log.add_range_error_fmt(
                            Some(source), r,
                            format_args!(
                                "Ambiguous import \"{}\" has multiple matching exports",
                                bstr::BStr::new(alias),
                            ),
                        ).expect("unreachable");
                    }
                }
                MatchImportKind::Ignore => {}
            }
        }
    }

    /// Spec: `linker_context/generateCodeForLazyExport.zig`.
    pub fn generate_code_for_lazy_export(
        &mut self,
        source_index: crate::IndexInt,
    ) -> Result<(), AllocError> {
        let exports_kind = self.graph.ast.items_exports_kind()[source_index as usize];
        let module_ref = self.graph.ast.items_module_ref()[source_index as usize];
        // PORT NOTE: reshaped for borrowck — `parts` re-borrowed below after
        // other graph borrows drop.
        let parts: *mut [Part] = self.graph.ast.items_parts_mut()[source_index as usize].slice_mut();

        // SAFETY: `parts` is a stable SoA column slice.
        if unsafe { (*parts).len() } < 1 {
            panic!("Internal error: expected at least one part for lazy export");
        }

        // SAFETY: `parts.ptr[1]` — BabyList raw indexing.
        let part: &mut Part = unsafe { &mut (*parts)[1] };

        // SAFETY: `stmts: *mut [Stmt]` is an arena slice valid for the link pass.
        if unsafe { (*part.stmts).is_empty() } {
            panic!("Internal error: expected at least one statement in the lazy export");
        }

        // Handle css modules
        //
        // --- original comment from esbuild ---
        // If this JavaScript file is a stub from a CSS file, populate the exports of
        // this JavaScript stub with the local names from that CSS file. This is done
        // now instead of earlier because we need the whole bundle to be present.
        //
        // PORT NOTE: the CSS-module path (`BundlerStyleSheet.{local_scope,composes}`)
        // walks `bun_css::CssRef` / `composes` / `LocalEntry` to synthesize an
        // `E::Object` of `{ name: \`${ref} ...\` }` per local class. The full
        // Visitor port lives in `linker_context/generateCodeForLazyExport.rs`
        // (Phase-A draft, still type-gated on `bun_css::{CssRef,Specifier,
        // ComposesMap}`); until those land this branch performs the spec's
        // entry checks and the `local_scope.count() == 0` early-out, which is
        // the only reachable path while `bun_css` is feature-stubbed.
        if let Some(css_ast) = self.graph.ast.items_css()[source_index as usize] {
            // SAFETY: `part.stmts` is a non-empty arena slice (checked above).
            let stmt: Stmt = unsafe { (*part.stmts)[0] };
            if !matches!(stmt.data, bun_js_parser::ast::stmt::Data::SLazyExport(_)) {
                panic!("Internal error: expected top-level lazy export statement");
            }
            // SAFETY: `css_ast` is a type-erased `*mut BundlerStyleSheet`
            // (BundledAst.rs:58) pointing into the graph's arena-backed AST
            // column; cast back and deref for the link pass.
            let css_ast = unsafe { &mut *(css_ast as *mut css::BundlerStyleSheet) };
            'out: {
                if css_ast.local_scope.count() == 0 {
                    break 'out;
                }
                // TODO(port): full `composes`/`local_scope` Visitor — blocked on
                // `bun_css::{CssRef, Specifier, ComposesMap, LocalEntry}` un-gate.
                // The Visitor body is ported verbatim in
                // `linker_context/generateCodeForLazyExport.rs::generate_code_for_lazy_export`;
                // wire it through here once those types resolve.
                let _ = stmt;
                break 'out;
            }
        }

        // SAFETY: `part.stmts` is a non-empty arena slice (checked above).
        let stmt: &Stmt = unsafe { &(*part.stmts)[0] };
        let stmt_loc = stmt.loc;
        let bun_js_parser::ast::stmt::Data::SLazyExport(lazy) = stmt.data else {
            panic!("Internal error: expected top-level lazy export statement");
        };
        let expr = Expr { data: *lazy, loc: stmt_loc };

        match exports_kind {
            ExportsKind::Cjs => {
                // SAFETY: `part.stmts` non-empty arena slice.
                unsafe {
                    (*part.stmts)[0] = Stmt::assign(
                        Expr::init(
                            E::Dot {
                                target: Expr::init_identifier(module_ref, stmt_loc),
                                name: b"exports",
                                name_loc: stmt_loc,
                                ..Default::default()
                            },
                            stmt_loc,
                        ),
                        expr,
                    );
                }
                self.graph.generate_symbol_import_and_use(
                    source_index,
                    0,
                    module_ref,
                    1,
                    crate::Index::init(source_index),
                )?;

                // If this is a .napi addon and it's not node, we need to generate a require() call to the runtime
                if matches!(expr.data, bun_js_parser::ast::expr::Data::ECall(c)
                    if matches!(c.target.data, bun_js_parser::ast::expr::Data::ERequireCallTarget))
                    // if it's commonjs, use require()
                    && self.options.output_format != Format::Cjs
                {
                    self.graph.generate_runtime_symbol_import_and_use(
                        source_index,
                        crate::Index::part(1u32),
                        b"__require",
                        1,
                    )?;
                }
            }
            _ => {
                // Otherwise, generate ES6 export statements. These are added as additional
                // parts so they can be tree shaken individually.
                // SAFETY: `part.stmts` is an arena slice; setting len to 0 leaks
                // the unused tail back to the arena (matches Zig `.len = 0`).
                part.stmts = &mut [] as *mut [Stmt];

                // PORT NOTE: detach the arena lifetime from `&self` so the
                // `&mut self` calls below (`generate_named_export_in_file`)
                // don't conflict with slices borrowed from it. The arena is
                // GRAPHBACKED and outlives the link step (LIFETIMES.tsv).
                // SAFETY: `self.graph.allocator()` returns a stable `&Bump`
                // into `LinkerGraph`; never freed mid-link.
                let alloc: &Bump = unsafe { &*(self.allocator() as *const Bump) };

                if let bun_js_parser::ast::expr::Data::EObject(e_object) = expr.data {
                    for property_ in e_object.properties.slice() {
                        let property: &G::Property = property_;
                        let Some(key) = property.key.as_ref() else { continue };
                        let bun_js_parser::ast::expr::Data::EString(mut key_str) = key.data else { continue };
                        if property.value.is_none()
                            || key_str.eql_comptime(b"default")
                            || key_str.eql_comptime(b"__esModule")
                        {
                            continue;
                        }

                        let name = key_str.slice(alloc);

                        // TODO: support non-identifier names
                        if !lex::is_identifier(name) {
                            continue;
                        }

                        // This initializes the generated variable with a copy of the property
                        // value, which is INCORRECT for values that are objects/arrays because
                        // they will have separate object identity. This is fixed up later in
                        // "generateCodeForFileInChunkJS" by changing the object literal to
                        // reference this generated variable instead.
                        //
                        // Changing the object literal is deferred until that point instead of
                        // doing it now because we only want to do this for top-level variables
                        // that actually end up being used, and we don't know which ones will
                        // end up actually being used at this point (since import binding hasn't
                        // happened yet). So we need to wait until after tree shaking happens.
                        let generated =
                            self.generate_named_export_in_file(source_index, module_ref, name, name)?;
                        let new_stmts: *mut [Stmt] = alloc.alloc_slice_fill_iter(core::iter::once(
                            Stmt::alloc(
                                S::Local {
                                    is_export: true,
                                    decls: G::DeclList::from_slice(&[G::Decl {
                                        binding: Binding::alloc(
                                            alloc,
                                            bun_js_parser::ast::b::Identifier { r#ref: generated.0 },
                                            expr.loc,
                                        ),
                                        value: property.value,
                                    }])?,
                                    ..Default::default()
                                },
                                key.loc,
                            ),
                        ));
                        // PORT NOTE: `parts.ptr[generated[1]]` — re-borrow `parts`
                        // here for borrowck.
                        let parts = self.graph.ast.items_parts_mut()[source_index as usize].slice_mut();
                        parts[generated.1 as usize].stmts = new_stmts;
                    }
                }

                {
                    // PERF(port): was `std.fmt.allocPrint` into arena.
                    use std::io::Write as _;
                    let mut name_buf: Vec<u8> = Vec::new();
                    write!(
                        &mut name_buf,
                        "{}_default",
                        self.get_source(source_index as usize).fmt_identifier()
                    )
                    .expect("write to Vec<u8> cannot fail");
                    let name: &[u8] = self.allocator().alloc_slice_copy(&name_buf);

                    let generated = self.generate_named_export_in_file(
                        source_index,
                        module_ref,
                        name,
                        b"default",
                    )?;
                    let alloc = self.allocator();
                    let new_stmts = alloc.alloc_slice_fill_iter(core::iter::once(Stmt::alloc(
                        S::ExportDefault {
                            default_name: js_ast::LocRef { ref_: Some(generated.0), loc: stmt_loc },
                            value: js_ast::StmtOrExpr::Expr(expr),
                        },
                        stmt_loc,
                    )));
                    let parts = self.graph.ast.items_parts_mut()[source_index as usize].slice_mut();
                    parts[generated.1 as usize].stmts = new_stmts as *mut [Stmt];
                }
            }
        }

        Ok(())
    }

    /// Spec: `LinkerContext.zig:503 generateNamedExportInFile`.
    pub fn generate_named_export_in_file(
        &mut self,
        source_index: crate::IndexInt,
        module_ref: Ref,
        name: &[u8],
        alias: &[u8],
    ) -> Result<(Ref, u32), AllocError> {
        let r#ref = self.graph.generate_new_symbol(source_index, bun_js_parser::ast::symbol::Kind::Other, name);
        let part_index = self.graph.add_part_to_file(source_index, Part {
            declared_symbols: DeclaredSymbolList::from_slice(
                &[DeclaredSymbol { ref_: r#ref, is_top_level: true }],
            )?,
            can_be_removed_if_unused: true,
            ..Default::default()
        })?;

        self.graph.generate_symbol_import_and_use(source_index, part_index, module_ref, 1, crate::Index::init(source_index))?;
        let top_level = &mut self.graph.meta.items_top_level_symbol_to_parts_overlay_mut()[source_index as usize];
        top_level.put(r#ref, BabyList::<u32>::from_slice(&[part_index])?)?;

        let resolved_exports = &mut self.graph.meta.items_resolved_exports_mut()[source_index as usize];
        resolved_exports.put(alias, crate::ExportData {
            data: ImportTracker {
                source_index: crate::Index::init(source_index),
                import_ref: r#ref,
                ..Default::default()
            },
            ..Default::default()
        })?;
        Ok((r#ref, part_index))
    }

    pub fn break_output_into_pieces(
        &self,
        _alloc: *const Bump,
        j: &mut StringJoiner,
        count: u32,
    ) -> Result<crate::chunk::IntermediateOutput, BunError> {
        let _trace = bun::perf::trace("Bundler.breakOutputIntoPieces");

        type OutputPiece = crate::chunk::OutputPiece;

        if !j.contains(&self.unique_key_prefix) {
            // There are like several cases that prohibit this from being checked more trivially, example:
            // 1. dynamic imports
            // 2. require()
            // 3. require.resolve()
            // 4. externals
            return Ok(crate::chunk::IntermediateOutput::Joiner(core::mem::take(j)));
        }

        // PORT NOTE: Zig had `errdefer j.deinit()` around the initCapacity — Drop handles it.
        let mut pieces: Vec<OutputPiece> = Vec::with_capacity(count as usize);
        // errdefer pieces.deinit() — Drop handles it
        // PERF(port): Zig used `j.done(alloc)` (worker arena); the Rust
        // StringJoiner port uses global mimalloc, no allocator param.
        let complete_output = j.done()?;
        let mut output: &[u8] = &complete_output;

        let prefix = &self.unique_key_prefix;

        'outer: loop {
            // Scan for the next piece boundary
            let Some(boundary) = strings::index_of(output, prefix) else {
                break;
            };

            // Try to parse the piece boundary
            let start = boundary + prefix.len();
            if start + 9 > output.len() {
                // Not enough bytes to parse the piece index
                break;
            }

            let kind: crate::chunk::QueryKind = match output[start] {
                b'A' => crate::chunk::QueryKind::Asset,
                b'C' => crate::chunk::QueryKind::Chunk,
                b'S' => crate::chunk::QueryKind::Scb,
                b'H' => crate::chunk::QueryKind::HtmlImport,
                _ => {
                    if cfg!(debug_assertions) {
                        Output::debug_warn(format_args!("Invalid output piece boundary"));
                    }
                    break;
                }
            };

            let mut index: usize = 0;
            // SAFETY: bounds checked above (start + 9 <= output.len())
            let digits: [u8; 8] = output[start + 1..start + 9].try_into().unwrap();
            for char in digits {
                if char < b'0' || char > b'9' {
                    if cfg!(debug_assertions) {
                        Output::debug_warn(format_args!("Invalid output piece boundary"));
                    }
                    break 'outer;
                }

                index = (index * 10) + ((char as usize) - (b'0' as usize));
            }

            // Validate the boundary
            match kind {
                crate::chunk::QueryKind::Asset | crate::chunk::QueryKind::Scb => {
                    if index >= self.graph.files.len() {
                        if cfg!(debug_assertions) {
                            Output::debug_warn(format_args!("Invalid output piece boundary"));
                        }
                        break;
                    }
                }
                crate::chunk::QueryKind::Chunk => {
                    if index >= count as usize {
                        if cfg!(debug_assertions) {
                            Output::debug_warn(format_args!("Invalid output piece boundary"));
                        }
                        break;
                    }
                }
                crate::chunk::QueryKind::HtmlImport => {
                    // SAFETY: parse_graph backref
                    if index >= unsafe { (*self.parse_graph).html_imports.server_source_indices.len } as usize {
                        if cfg!(debug_assertions) {
                            Output::debug_warn(format_args!("Invalid output piece boundary"));
                        }
                        break;
                    }
                }
                _ => unreachable!(),
            }

            // PORT NOTE: `Query` is a packed `u32` (`index: u29`, `kind: u3`);
            // construct via `new` rather than field-init.
            pieces.push(OutputPiece::init(
                &output[0..boundary],
                crate::chunk::Query::new(u32::try_from(index).unwrap(), kind),
            ));
            output = &output[boundary + prefix.len() + 9..];
        }

        pieces.push(OutputPiece::init(output, crate::chunk::Query::NONE));

        Ok(crate::chunk::IntermediateOutput::Pieces(
            BabyList::<OutputPiece>::from_owned_slice(pieces.into_boxed_slice()),
        ))
    }
}

// PartialEq for MatchImport (needed for std.meta.eql in match_import_with_export)
impl PartialEq for MatchImport {
    fn eq(&self, other: &Self) -> bool {
        self.alias == other.alias
            && self.kind == other.kind
            && self.namespace_ref == other.namespace_ref
            && self.source_index == other.source_index
            && self.name_loc == other.name_loc
            && self.other_source_index == other.other_source_index
            && self.other_name_loc == other.other_name_loc
            && self.r#ref == other.r#ref
    }
}

// ──────────────────────────────────────────────────────────────────────────
// StmtList
// ──────────────────────────────────────────────────────────────────────────

pub struct StmtList {
    // TODO(port): allocator field dropped — Vec uses global mimalloc; bundler is AST crate but
    // these are temporary scratch buffers, not arena-backed in the original (uses generic allocator param)
    pub inside_wrapper_prefix: InsideWrapperPrefix,
    pub outside_wrapper_prefix: Vec<Stmt>,
    pub inside_wrapper_suffix: Vec<Stmt>,
    pub all_stmts: Vec<Stmt>,
}

pub struct InsideWrapperPrefix {
    pub stmts: Vec<Stmt>,
    pub sync_dependencies_end: usize,
    // if true it will exist at `sync_dependencies_end`
    pub has_async_dependency: bool,
}

impl InsideWrapperPrefix {
    pub fn init() -> Self {
        Self { stmts: Vec::new(), sync_dependencies_end: 0, has_async_dependency: false }
    }

    // deinit → Drop (Vec frees automatically); reset is explicit

    pub fn reset(&mut self) {
        self.stmts.clear();
        self.sync_dependencies_end = 0;
        self.has_async_dependency = false;
    }
}

// TODO(b2-blocked): `Expr`/`Stmt` builder helpers (`E::Call`, `S::SExpr` etc.)
// — bun_js_parser AST builder surface not yet stable.

impl InsideWrapperPrefix {
    pub fn append_non_dependency(&mut self, stmt: Stmt) -> Result<(), AllocError> {
        self.stmts.push(stmt);
        Ok(())
    }

    pub fn append_non_dependency_slice(&mut self, stmts: &[Stmt]) -> Result<(), AllocError> {
        self.stmts.extend_from_slice(stmts);
        Ok(())
    }

    pub fn append_sync_dependency(&mut self, call_expr: Expr) -> Result<(), AllocError> {
        self.stmts.insert(
            self.sync_dependencies_end,
            Stmt::alloc(S::SExpr { value: call_expr, ..Default::default() }, call_expr.loc),
        );
        self.sync_dependencies_end += 1;
        Ok(())
    }

    pub fn append_async_dependency(&mut self, call_expr: Expr, promise_all_ref: Ref) -> Result<(), AllocError> {
        if !self.has_async_dependency {
            self.has_async_dependency = true;
            self.stmts.insert(
                self.sync_dependencies_end,
                Stmt::alloc(
                    S::SExpr {
                        value: Expr::init(E::Await { value: call_expr }, Loc::EMPTY),
                        ..Default::default()
                    },
                    Loc::EMPTY,
                ),
            );
            return Ok(());
        }

        // PORT NOTE: deep AST mutation chain — `s_expr_mut`/`e_await_mut`/
        // `e_call_mut`/`e_array_mut` return `Option`; `.unwrap()` mirrors Zig's
        // untagged-union field reads (panic on shape mismatch).
        let mut first_dep_call_expr = self.stmts[self.sync_dependencies_end]
            .data.s_expr_mut().unwrap().value.data.e_await_mut().unwrap().value;
        let call = first_dep_call_expr.data.e_call_mut().unwrap();

        if call.target.data.e_identifier().unwrap().ref_.eql(promise_all_ref) {
            // `await __promiseAll` already in place, append to the array argument
            call.args.mut_(0).data.e_array_mut().unwrap().items.append(call_expr)?;
        } else {
            // convert single `await init_` to `await __promiseAll([init_1(), init_2()])`

            let promise_all = Expr::init(E::Identifier { ref_: promise_all_ref, ..Default::default() }, Loc::EMPTY);

            let mut items: BabyList<Expr> = BabyList::init_capacity(2)?;
            items.append_slice_assume_capacity(&[first_dep_call_expr, call_expr]);
            // PERF(port): was assume_capacity

            let mut args: BabyList<Expr> = BabyList::init_capacity(1)?;
            args.append_assume_capacity(Expr::init(E::Array { items, ..Default::default() }, Loc::EMPTY));
            // PERF(port): was assume_capacity

            let promise_all_call = Expr::init(E::Call { target: promise_all, args, ..Default::default() }, Loc::EMPTY);

            // replace the `await init_` expr with `await __promiseAll`
            self.stmts[self.sync_dependencies_end] = Stmt::alloc(
                S::SExpr {
                    value: Expr::init(E::Await { value: promise_all_call }, Loc::EMPTY),
                    ..Default::default()
                },
                Loc::EMPTY,
            );
        }
        Ok(())
    }
}

impl StmtList {
    pub fn reset(&mut self) {
        self.inside_wrapper_prefix.reset();
        self.outside_wrapper_prefix.clear();
        self.inside_wrapper_suffix.clear();
        self.all_stmts.clear();
    }

    // deinit → Drop (Vec fields free automatically)

    pub fn init() -> Self {
        Self {
            inside_wrapper_prefix: InsideWrapperPrefix::init(),
            outside_wrapper_prefix: Vec::new(),
            inside_wrapper_suffix: Vec::new(),
            all_stmts: Vec::new(),
        }
    }

    pub fn append_slice(&mut self, list: StmtListWhich, stmts: &[Stmt]) -> Result<(), AllocError> {
        match list {
            StmtListWhich::OutsideWrapperPrefix => self.outside_wrapper_prefix.extend_from_slice(stmts),
            StmtListWhich::InsideWrapperSuffix => self.inside_wrapper_suffix.extend_from_slice(stmts),
            StmtListWhich::AllStmts => self.all_stmts.extend_from_slice(stmts),
        }
        Ok(())
    }

    pub fn append(&mut self, list: StmtListWhich, stmt: Stmt) -> Result<(), AllocError> {
        match list {
            StmtListWhich::OutsideWrapperPrefix => self.outside_wrapper_prefix.push(stmt),
            StmtListWhich::InsideWrapperSuffix => self.inside_wrapper_suffix.push(stmt),
            StmtListWhich::AllStmts => self.all_stmts.push(stmt),
        }
        Ok(())
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum StmtListWhich {
    OutsideWrapperPrefix,
    InsideWrapperSuffix,
    AllStmts,
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/LinkerContext.zig (2782 lines)
//   confidence: low
//   todos:      17
//   notes:      Heavy borrowck reshaping around recursive tree-shaking & MultiArrayList column slices; raw *mut backrefs (parse_graph/resolver) per LIFETIMES.tsv; many container_of! patterns for BundleV2.linker; allocator threading (arena vs global) needs Phase B audit; MatchImport.alias is arena-owned raw `*const [u8]`.
// ──────────────────────────────────────────────────────────────────────────
