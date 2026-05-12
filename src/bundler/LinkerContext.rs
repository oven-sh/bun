//! Port of src/bundler/LinkerContext.zig

use crate::mal_prelude::*;
use core::mem::offset_of;
use core::sync::atomic::{AtomicU32, Ordering};

use bun_alloc::{AllocError, Arena as Bump};
use bun_ast::{Data, Loc, Log, Range, Source};
use bun_collections::{ArrayHashMap, AutoBitSet, HashMap, MultiArrayList, VecExt};
use bun_core::{self as bun, Environment, Error as BunError, FeatureFlags, Output};
use bun_core::{MutableString, string_joiner::StringJoiner, strings};
use bun_sourcemap::{
    self as SourceMap, DebugIDFormatter, LineOffsetTable, SourceMapPieces, SourceMapShifts,
    SourceMapState,
};
// PORT NOTE: alias the *module* (not the `ThreadPool` struct) so
// `ThreadPoolLib::Task` / `ThreadPoolLib::Batch` resolve as nested items.
use bun_ast::{ImportKind, ImportRecord};
use bun_threading::{self as sync, WaitGroup, thread_pool as ThreadPoolLib};
// TODO(b0): bake_types arrives from move-in (TYPE_ONLY → bundler)
use crate::bake_types as bake;
use crate::bun_css as css;

use crate::BundledAst as JSAst;
use bun_ast::{
    self as js_ast, Binding, DeclaredSymbol, Dependency, ExportsKind, Expr, NamedImport, Part, Ref,
    Stmt, Symbol, TlaCheck,
};
// PORT NOTE: `crate::Index` (= `bun_ast::Index`) — the
// bundler's source-index newtype. `bun_ast::Index` is layout-identical
// but a distinct type; LinkerGraph/JSMeta/etc. are typed against the crate
// re-export, so use that here.
use crate::Index;
use bun_ast::{E, G, S};
use bun_js_parser::lexer as lex;
use bun_js_printer::{self as js_printer, renamer};

use crate::bun_fs as Fs;
use crate::bun_node_fallbacks as NodeFallbackModules;
use crate::ungate_support::perf;
use bun_ast::SideEffects;
use bun_resolver::{self as _resolver, Resolver};

use crate::Graph::Graph;
use crate::options::{self, Format, Loader, SourceMapOption, Target};
use crate::{
    AdditionalFile, BundleV2, Chunk, CompileResult, CompileResultForSourceMap, ContentHasher,
    ImportTracker, LinkerGraph, MangledProps, PartRange, ServerComponentBoundary, StableRef,
    ThreadPool, WrapKind,
};

/// `bun.jsc.AnyEventLoop` (LinkerContext.zig:28). `bun_event_loop` is a
/// lower-tier crate, so the bundler can name the real enum (the `Js` arm
/// holds an erased `*mut jsc::EventLoop` driven through a vtable). Stored as
/// a pointer because the linker borrows the loop owned by the
/// `BundleThread` / runtime.
pub type EventLoop = Option<core::ptr::NonNull<bun_event_loop::AnyEventLoop<'static>>>;

bun_core::declare_scope!(LinkerCtx, visible);
bun_core::declare_scope!(TreeShake, hidden);

// ══════════════════════════════════════════════════════════════════════════
// CYCLEBREAK(b0): vtable instance for `bun_crash_handler::BundleGenerateChunkVTable`
// (cold-path §Dispatch — crash trace only). crash_handler (T1) holds erased
// `(*const LinkerContext, *const Chunk, *const PartRange)`; bundler supplies
// the formatter that knows their layout. Mirrors src/crash_handler/crash_handler.zig:135.
// ══════════════════════════════════════════════════════════════════════════
#[cfg(feature = "show_crash_trace")]
bun_crash_handler::link_impl_BundleGenerateChunkCtx! {
    Linker for LinkerContext => |this| {
        fmt(chunk, part_range, writer) => {
            let ctx = &*this;
            let chunk = &*chunk.cast::<Chunk>();
            let pr = &*part_range.cast::<PartRange>();
            let parse_graph = ctx.parse_graph();
            let sources = parse_graph.input_files.items_source();
            let entry = if pr.source_index.is_valid() {
                sources
                    .get(chunk.entry_point.source_index() as usize)
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
    }
}

/// Helper for call-sites that previously wrote `Action::BundleGenerateChunk(.{...})`.
#[cfg(feature = "show_crash_trace")]
#[inline]
pub fn bundle_generate_chunk_action(
    ctx: &LinkerContext,
    chunk: &Chunk,
    part_range: &PartRange,
) -> bun_crash_handler::Action {
    bun_crash_handler::Action::BundleGenerateChunk(bun_crash_handler::BundleGenerateChunk {
        // SAFETY: `ctx`/`chunk`/`part_range` outlive the crash-trace scope this is held for.
        ctx: unsafe {
            bun_crash_handler::BundleGenerateChunkCtx::new(
                bun_crash_handler::BundleGenerateChunkCtxKind::Linker,
                core::ptr::from_ref(ctx).cast_mut(),
            )
        },
        chunk: core::ptr::from_ref::<Chunk>(chunk).cast::<()>(),
        part_range: core::ptr::from_ref::<PartRange>(part_range).cast::<()>(),
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

// Scoped-log wrappers (LinkerContext.zig:2, :2705); re-exported so `linker_context/*` submodules import directly.
bun_core::define_scoped_log!(debug, crate::linker_context_mod::LinkerCtx);
pub(crate) use debug;
bun_core::define_scoped_log!(debug_tree_shake, crate::linker_context_mod::TreeShake);
#[allow(unused_imports)]
pub(crate) use debug_tree_shake;

// Re-exports from sibling modules in `linker_context/`.
// `LinkerGraph` SoA accessors are real now (`` on
// `JSAst`/`JSMeta`/`File`); the submodule bodies un-gate against those. Module
// declarations live in `lib.rs::linker_context` — each re-export below is
// gated alongside its module declaration so partial un-gates compile.
pub use crate::linker_context::scan_imports_and_exports::scan_imports_and_exports;

pub use crate::linker_context::compute_chunks::compute_chunks;
pub use crate::linker_context::find_all_imported_parts_in_js_order::{
    find_all_imported_parts_in_js_order, find_imported_parts_in_js_order,
};
pub use crate::linker_context::find_imported_css_files_in_js_order::find_imported_css_files_in_js_order;
pub use crate::linker_context::find_imported_files_in_css_order::find_imported_files_in_css_order;
pub use crate::linker_context::generate_code_for_lazy_export::generate_code_for_lazy_export;
pub use crate::linker_context::metafile_builder as MetafileBuilder;
pub use crate::linker_context::output_file_list_builder as OutputFileListBuilder;
pub use crate::linker_context::static_route_visitor as StaticRouteVisitor;
// do_step5 / create_exports_for_file are inherent methods on LinkerContext (see
// `linker_context/doStep5.rs`), not free functions — no item re-export.
pub use crate::linker_context::compute_cross_chunk_dependencies::compute_cross_chunk_dependencies;
pub use crate::linker_context::convert_stmts_for_chunk::convert_stmts_for_chunk;
pub use crate::linker_context::convert_stmts_for_chunk_for_dev_server::convert_stmts_for_chunk_for_dev_server;
pub use crate::linker_context::do_step5;
pub use crate::linker_context::generate_chunks_in_parallel::generate_chunks_in_parallel;
pub use crate::linker_context::generate_code_for_file_in_chunk_js::generate_code_for_file_in_chunk_js;
pub use crate::linker_context::generate_compile_result_for_css_chunk::generate_compile_result_for_css_chunk;
pub use crate::linker_context::generate_compile_result_for_html_chunk::generate_compile_result_for_html_chunk;
pub use crate::linker_context::generate_compile_result_for_js_chunk::generate_compile_result_for_js_chunk;
pub use crate::linker_context::post_process_css_chunk::post_process_css_chunk;
pub use crate::linker_context::post_process_html_chunk::post_process_html_chunk;
pub use crate::linker_context::post_process_js_chunk::post_process_js_chunk;
pub use crate::linker_context::prepare_css_asts_for_chunk::{
    PrepareCssAstTask, prepare_css_asts_for_chunk,
};
pub use crate::linker_context::rename_symbols_in_chunk::rename_symbols_in_chunk;
pub use crate::linker_context::write_output_files_to_disk::write_output_files_to_disk;

// TODO(port): DeferredBatchTask, ParseTask re-exports — Zig re-exports from bundle_v2
pub use crate::DeferredBatchTask::DeferredBatchTask;
pub use crate::ParseTask;

pub struct LinkerContext<'a> {
    pub parse_graph: *mut Graph,
    pub graph: LinkerGraph,
    /// Backref into `Transpiler.log`, assigned in [`Self::load`]. Stored as a
    /// raw pointer (like `parse_graph` / `resolver`) so `Default` can be
    /// `null_mut()` instead of a dangling `&mut` (instant UB). Use
    /// [`Self::log`] / [`Self::log_mut`]; deref the field directly only for
    /// split-borrow patterns that hold other `self` borrows across the access.
    pub log: *mut Log,

    /// Backref into `BundleV2.transpiler.resolver` (LIFETIMES.tsv:
    /// GRAPHBACKED). `ParentRef` (not `*mut`) so the accessor and the
    /// split-borrow sites in `linker_context/*.rs` deref it via safe `Deref`
    /// instead of open-coding a raw deref. `Option` because `Default` precedes
    /// [`Self::load`]. Read-only — never `assume_mut`.
    pub resolver: Option<bun_ptr::ParentRef<Resolver<'a>>>,
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
    pub framework: Option<bun_ptr::BackRef<bake::Framework>>,

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
            log: core::ptr::null_mut(),
            resolver: None,
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
    /// container_of: `*LinkerContext` → `*BundleV2` via the embedded `.linker`
    /// field. Mirrors Zig `@fieldParentPtr("linker", c)`. Returns raw; caller
    /// decides `&*` vs `&mut *` per local aliasing rules (several callers run
    /// on worker-pool threads and MUST NOT materialize `&mut BundleV2`).
    ///
    /// SAFETY: `linker` must point to the `.linker` field of a live `BundleV2`
    /// and carry provenance over the full `BundleV2` allocation.
    #[inline(always)]
    pub unsafe fn bundle_v2_ptr(linker: *mut Self) -> *mut BundleV2<'a> {
        bun_core::from_field_ptr!(BundleV2, linker, linker)
    }

    /// Shared-read accessor for the parse-side graph.
    ///
    /// `parse_graph` is a backref into `BundleV2.graph`, a sibling field of
    /// `BundleV2.linker` (= `*self`), assigned in [`Self::load`]. It is
    /// non-null and valid for the entire link step; the pointee is disjoint
    /// from `*self` (LIFETIMES.tsv: GRAPHBACKED).
    ///
    /// The returned borrow is tied to `&self`. Callers that need to hold a
    /// `&Graph` across a `&mut self` borrow (split-borrow patterns — e.g.
    /// `process_html_import_files`, TLA-check column caching, or
    /// `generate_isolated_hash`) must continue to deref the raw
    /// `self.parse_graph` field directly.
    #[inline]
    pub fn parse_graph(&self) -> &Graph {
        debug_assert!(
            !self.parse_graph.is_null(),
            "LinkerContext.parse_graph accessed before load()"
        );
        // SAFETY: non-null backref into `BundleV2.graph`, valid for the link
        // step, disjoint from `*self` (= `BundleV2.linker`).
        unsafe { &*self.parse_graph }
    }

    /// Exclusive accessor for the parse-side graph. See [`Self::parse_graph`]
    /// for the lifetime invariant. Prefer the raw `self.parse_graph` field for
    /// split-borrow patterns that interleave `&mut Graph` with other `self`
    /// borrows.
    #[inline]
    pub fn parse_graph_mut(&mut self) -> &mut Graph {
        debug_assert!(
            !self.parse_graph.is_null(),
            "LinkerContext.parse_graph accessed before load()"
        );
        // SAFETY: non-null backref into `BundleV2.graph`, disjoint from
        // `*self`; `&mut self` excludes other safe borrows of the linker.
        unsafe { &mut *self.parse_graph }
    }

    /// Shared-read accessor for the resolver.
    ///
    /// `resolver` is a backref into `BundleV2.transpiler.resolver`, assigned
    /// in [`Self::load`] (LIFETIMES.tsv: GRAPHBACKED). Non-null and valid for
    /// the link step; never mutated through this pointer.
    #[inline]
    pub fn resolver(&self) -> &Resolver<'a> {
        self.resolver
            .as_ref()
            .expect("LinkerContext.resolver accessed before load()")
            .get()
    }

    /// Mutable projection of the `r#loop` BACKREF for `AnyEventLoop` dispatch
    /// (`enqueue_task_concurrent*`, `tick`). Centralises the raw `NonNull`
    /// deref so the three callers (`BundleV2::any_loop_mut`, `ParseTask` /
    /// `ServerComponentParseTask` completion) are safe.
    ///
    /// `&self` receiver (not `&mut self`): the loop storage is **disjoint**
    /// from `LinkerContext` (it lives in the `BundleThread` / runtime arena —
    /// see [`EventLoop`]), and worker-thread completions reach this through a
    /// `BackRef<BundleV2>` (`&` only).
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub fn any_loop_mut(&self) -> Option<&mut bun_event_loop::AnyEventLoop<'static>> {
        // SAFETY: BACKREF — set once in `BundleV2::init` from a loop that
        // outlives the bundle pass; the pointee is disjoint from `*self`.
        // Exclusivity: `Js { owner }.enqueue_task_concurrent` is `&self`
        // (MPSC), and `Mini.enqueue_task_concurrent_with_extra_ctx` only
        // pushes to an MPSC queue + writes the caller-owned intrusive task
        // node, so concurrent worker completions do not alias loop state.
        self.r#loop.map(|p| unsafe { &mut *p.as_ptr() })
    }

    /// Shared-read accessor for the bundler log.
    ///
    /// `log` is a backref into `Transpiler.log`, assigned in [`Self::load`]
    /// (LIFETIMES.tsv: GRAPHBACKED). Non-null and valid for the link step.
    #[inline]
    pub fn log(&self) -> &Log {
        debug_assert!(
            !self.log.is_null(),
            "LinkerContext.log accessed before load()"
        );
        // SAFETY: non-null backref valid for the link step.
        unsafe { &*self.log }
    }

    /// Exclusive accessor for the bundler log. See [`Self::log`] for the
    /// lifetime invariant. Prefer [`Self::log_disjoint`] for split-borrow
    /// patterns that interleave `&mut Log` with other `self` borrows.
    #[inline]
    pub fn log_mut(&mut self) -> &mut Log {
        debug_assert!(
            !self.log.is_null(),
            "LinkerContext.log accessed before load()"
        );
        // SAFETY: non-null backref valid for the link step; `&mut self`
        // excludes other safe borrows of the linker.
        unsafe { &mut *self.log }
    }

    /// Detached mutable borrow of the bundler log for split-borrow contexts.
    ///
    /// `self.log` is a backref into `Transpiler.log`, a sibling allocation of
    /// `BundleV2.linker` (= `*self`) — it is allocation-disjoint from every
    /// `self.graph` / `self.parse_graph` / `self.mangled_props` borrow. This
    /// accessor exists for the diagnostic paths (`match_import_with_export`,
    /// `scan_imports_and_exports`, CSS validation) that hold SoA-column borrows
    /// of `self.graph` while emitting an error; [`Self::log_mut`] would
    /// needlessly conflict on `&mut self`.
    ///
    /// `#[allow(clippy::mut_from_ref)]` follows the same precedent as
    /// [`GenerateChunkCtx::c`]: the pointee is a set-once GRAPHBACKED backref,
    /// not interior storage of `*self`, so `&self` cannot alias the returned
    /// `&mut Log`. Do not call this twice with overlapping live borrows.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub(crate) fn log_disjoint(&self) -> &mut Log {
        debug_assert!(
            !self.log.is_null(),
            "LinkerContext.log accessed before load()"
        );
        // SAFETY: non-null backref into `Transpiler.log`, valid for the link
        // step, allocation-disjoint from `*self` (= `BundleV2.linker`). All
        // call sites previously open-coded the raw deref under the same
        // invariant; centralised here so the proof obligation lives once.
        unsafe { &mut *self.log }
    }

    /// Safe accessor for the underlying `bun_threading::ThreadPool` driving
    /// link-phase parallel work. Chains [`Self::parse_graph`] →
    /// [`Graph::pool`] → [`ThreadPool::worker_pool`](crate::ThreadPool::worker_pool),
    /// keeping the `unsafe` deref centralized in those accessors.
    #[inline]
    pub fn worker_pool(&self) -> &bun_threading::ThreadPool {
        self.parse_graph().pool().worker_pool()
    }

    pub fn mark_pending_task_done(&self) {
        // Zig: `.monotonic` → Rust `Relaxed` (LLVM `monotonic` == C11 `relaxed`).
        self.pending_task_count.fetch_sub(1, Ordering::Relaxed);
    }

    pub fn is_external_dynamic_import(&self, record: &ImportRecord, source_index: u32) -> bool {
        use crate::linker_graph::FileColumns as _;
        self.graph.code_splitting
            && record.kind == ImportKind::Dynamic
            && self.graph.files.items_entry_point_kind()[record.source_index.get() as usize]
                .is_entry_point()
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
use crate::Graph::InputFileColumns as _;
use crate::bundled_ast::Flags as AstFlags;
use crate::ungate_support::generic_path_with_pretty_initialized;
use crate::ungate_support::{CompileResultForSourceMapColumns as _, EntryPointColumns as _};
use bun_ast::SideEffects as _GraphSideEffects;
type DeclaredSymbolList = bun_ast::DeclaredSymbolList;

// TODO(b2-blocked): method bodies depend on `LinkerGraph` SoA accessors
// (`graph.files.items_*()`, `graph.ast.items_*()`, `graph.meta.items_*()`),
// `crate::thread_pool::Worker`, `generic_path_with_pretty_initialized`, and the gated
// `linker_context/` submodules. The struct + LinkerOptions + SourceMapData
// above are real; this impl block un-gates with `LinkerGraph.rs`.

impl<'a> LinkerContext<'a> {
    pub fn arena(&self) -> &Bump {
        // TODO(port): bundler is an AST crate; LinkerGraph owns the arena
        self.graph.arena()
    }

    pub fn path_with_pretty_initialized(
        &mut self,
        path: bun_paths::fs::Path<'static>,
    ) -> Result<bun_paths::fs::Path<'static>, BunError> {
        let top_level_dir = bun_resolver::fs::FileSystem::get().top_level_dir;
        generic_path_with_pretty_initialized(path, self.options.target, top_level_dir, self.arena())
    }

    pub fn should_include_part(&self, source_index: crate::IndexInt, part: &Part) -> bool {
        // As an optimization, ignore parts containing a single import statement to
        // an internal non-wrapped file. These will be ignored anyway and it's a
        // performance hit to include the part only to discover it's unnecessary later.
        let stmts: &[Stmt] = part.stmts.slice();
        if stmts.len() == 1 {
            if let Some(s_import) = stmts[0].data.s_import() {
                let record = self.graph.ast.items_import_records()[source_index as usize]
                    .at(s_import.import_record_index as usize);
                if record.source_index.is_valid()
                    && self.graph.meta.items_flags()[record.source_index.get() as usize].wrap
                        == WrapKind::None
                {
                    return false;
                }
            }
        }

        true
    }

    /// `bundle` is taken as a raw `*mut` because the caller invokes this as
    /// `self.linker.load(self, …)` (Zig spec bundle_v2.zig:2574) — `self` *is*
    /// `(*bundle).linker`, so a `&mut BundleV2` here would alias the receiver
    /// under Stacked Borrows. This body only reaches into fields of `*bundle`
    /// that are disjoint from `linker` (`graph`, `transpiler`,
    /// `dynamic_import_entry_points`) via `addr_of_mut!`, never materializing a
    /// full `&mut BundleV2`.
    ///
    /// # Safety
    /// `bundle` must be valid for the call and `self` must be `(*bundle).linker`
    /// (or otherwise not overlap the fields named above).
    pub unsafe fn load(
        &mut self,
        bundle: *mut BundleV2,
        entry_points: &[Index],
        server_component_boundaries: &bun_ast::server_component_boundary::List,
        reachable: &[Index],
    ) -> Result<(), BunError> {
        let _trace = bun::perf::trace("Bundler.CloneLinkerGraph");
        // SAFETY: field-disjoint with `self` (= `(*bundle).linker`); `parse_graph`
        // is a `*mut Graph` backref so no `&mut` is materialized.
        self.parse_graph = unsafe { core::ptr::addr_of_mut!((*bundle).graph) };
        // SAFETY: field-disjoint scalar read; `transpiler` is itself a `*mut`.
        let dyn_entry_points =
            unsafe { &mut *core::ptr::addr_of_mut!((*bundle).dynamic_import_entry_points) };

        // SAFETY: `bundle.transpiler` is a `*mut Transpiler` backref valid for
        // the bundle's lifetime; `resolver`/`log`/`options` are stable fields.
        let transpiler = unsafe { &mut *(*bundle).transpiler };
        self.graph.code_splitting = transpiler.options.code_splitting;
        // Mirrors Zig's pointer assignment; `transpiler.log` is the canonical
        // `*mut Log` (same value aliased into `linker.log` / `resolver.log`).
        self.log = transpiler.log;

        // PORT NOTE: lifetime — `self.resolver` is `ParentRef<Resolver<'a>>`
        // but `transpiler.resolver` is `Resolver<'_>` (anonymous `bundle`
        // lifetime); erase via a pointer cast (LIFETIMES.tsv: GRAPHBACKED —
        // resolver outlives the link step). Read-only — `from_raw` provenance
        // is sufficient.
        // SAFETY: `transpiler.resolver` is a stable field of the
        // bundle-lifetime `Transpiler`, valid for the entire link step.
        self.resolver = Some(unsafe {
            bun_ptr::ParentRef::from_raw(core::ptr::from_ref(&transpiler.resolver).cast())
        });
        self.cycle_detector = Vec::new();

        // PORT NOTE: `reachable_files` is `Vec<Index>`; clone the
        // caller-owned slice into the linker arena. PERF(port): Zig pointed at
        // the slice in-place; revisit once Vec grows a borrowed-view ctor.
        self.graph.reachable_files = reachable.to_vec();

        // SAFETY: parse_graph is valid backref just assigned above
        let sources: &[Source] = unsafe { (*self.parse_graph).input_files.items_source() };

        self.graph.load(
            entry_points,
            sources,
            server_component_boundaries,
            dyn_entry_points.keys(),
            // SAFETY: parse_graph backref
            unsafe { &(*self.parse_graph).entry_point_original_names },
        )?;
        // PERF(port): was arena bulk-free — `dynamic_import_entry_points` is
        // now a global-alloc `ArrayHashMap`; clearing drops it.
        dyn_entry_points.clear_retaining_capacity();

        let runtime_named_exports =
            &self.graph.ast.items_named_exports()[Index::RUNTIME.get() as usize];

        self.esm_runtime_ref = runtime_named_exports
            .get(b"__esm")
            .expect("infallible: runtime export")
            .ref_;
        self.cjs_runtime_ref = runtime_named_exports
            .get(b"__commonJS")
            .expect("infallible: runtime export")
            .ref_;
        self.promise_all_runtime_ref = runtime_named_exports
            .get(b"__promiseAll")
            .expect("infallible: runtime export")
            .ref_;

        if self.options.output_format == Format::Cjs {
            self.unbound_module_ref = self.graph.generate_new_symbol(
                Index::RUNTIME.get(),
                bun_ast::symbol::Kind::Unbound,
                b"module",
            );
        }

        if self.options.output_format == Format::Cjs || self.options.output_format == Format::Iife {
            // PORT NOTE: reshaped for borrowck — `Slice<T>` is a value-type
            // snapshot of column pointers (does not borrow `self.graph.ast`),
            // so `split_mut()` on the local can coexist with the
            // `self.graph.meta` borrow below. The slab does not reallocate for
            // the duration of this loop.
            let mut ast_slice = self.graph.ast.slice();
            let ast_cols = ast_slice.split_mut();
            let exports_kind: &mut [ExportsKind] = ast_cols.exports_kind;
            let ast_flags_list: &mut [AstFlags] = ast_cols.flags;
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
                    meta_flags_list[entry_point.get() as usize]
                        .force_include_exports_for_entry_point = true;
                }
            }
        }

        Ok(())
    }

    pub fn compute_data_for_source_map(&mut self, reachable: &[Index]) {
        debug_assert!(self.options.source_maps != SourceMapOption::None);
        self.source_maps.line_offset_wait_group = WaitGroup::init_with_count(reachable.len());
        self.source_maps.quoted_contents_wait_group = WaitGroup::init_with_count(reachable.len());
        // TODO(port): arena alloc of task arrays
        // PORT NOTE: `SourceMapDataTask` is not `Clone` (embeds an intrusive
        // `ThreadPoolLib::Task` node); build via iterator instead of `vec![x;n]`.
        self.source_maps.line_offset_tasks = (0..reachable.len())
            .map(|_| SourceMapDataTask::default())
            .collect::<Vec<_>>()
            .into_boxed_slice();
        self.source_maps.quoted_contents_tasks = (0..reachable.len())
            .map(|_| SourceMapDataTask::default())
            .collect::<Vec<_>>()
            .into_boxed_slice();

        // PORT NOTE: erase `'a` → `'static` for the task backref. The tasks are
        // joined before `self` is dropped (see `SourceMapData.*_wait_group`).
        // SAFETY: write provenance from `ptr::from_mut`; outlives every task.
        let ctx: Option<bun_ptr::ParentRef<LinkerContext<'static>>> = Some(unsafe {
            bun_ptr::ParentRef::from_raw_mut(std::ptr::from_mut::<LinkerContext<'a>>(self).cast())
        });
        let mut batch = ThreadPoolLib::Batch::default();
        let mut second_batch = ThreadPoolLib::Batch::default();
        debug_assert_eq!(reachable.len(), self.source_maps.line_offset_tasks.len());
        debug_assert_eq!(
            reachable.len(),
            self.source_maps.quoted_contents_tasks.len()
        );
        for ((source_index, line_offset), quoted) in reachable
            .iter()
            .zip(self.source_maps.line_offset_tasks.iter_mut())
            .zip(self.source_maps.quoted_contents_tasks.iter_mut())
        {
            *line_offset = SourceMapDataTask {
                ctx,
                source_index: source_index.get(),
                thread_task: ThreadPoolLib::Task {
                    node: ThreadPoolLib::Node::default(),
                    callback: SourceMapDataTask::run_line_offset,
                },
            };
            *quoted = SourceMapDataTask {
                ctx,
                source_index: source_index.get(),
                thread_task: ThreadPoolLib::Task {
                    node: ThreadPoolLib::Node::default(),
                    callback: SourceMapDataTask::run_quoted_source_contents,
                },
            };
            batch.push(ThreadPoolLib::Batch::from(&raw mut line_offset.thread_task));
            second_batch.push(ThreadPoolLib::Batch::from(&raw mut quoted.thread_task));
        }

        // line offsets block sooner and are faster to compute, so we should schedule those first
        batch.push(second_batch);

        self.schedule_tasks(batch);
    }

    pub fn schedule_tasks(&self, batch: ThreadPoolLib::Batch) {
        let _ = self.pending_task_count.fetch_add(
            u32::try_from(batch.len).expect("int cast"),
            Ordering::Relaxed,
        );
        self.worker_pool().schedule(batch);
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
        let server_len = unsafe { (*parse_graph).html_imports.server_source_indices.len() };
        if server_len > 0 {
            let actual_ref = self.graph.runtime_function(b"__jsonParse");

            for i in 0..server_len as usize {
                // SAFETY: `server_source_indices` is a stable Vec; index
                // bounded by `server_len`.
                let html_import: u32 =
                    unsafe { (*parse_graph).html_imports.server_source_indices.slice()[i] };
                // SAFETY: `input_files` SoA is append-only; read-only here.
                let path_text = unsafe {
                    &(*parse_graph).input_files.items_source()[html_import as usize]
                        .path
                        .text
                };
                // SAFETY: sole `&mut` into the per-target map for this lookup.
                let source_index: u32 = unsafe {
                    (*parse_graph).path_to_source_index_map(Target::Browser)
                }
                .get(path_text)
                .unwrap_or_else(|| {
                    panic!("Assertion failed: HTML import file not found in pathToSourceIndexMap");
                });

                // SAFETY: sole `&mut` into `html_source_indices` for this push.
                unsafe {
                    (*parse_graph)
                        .html_imports
                        .html_source_indices
                        .push(source_index)
                };

                // S.LazyExport is a call to __jsonParse.
                // SAFETY: `Part.stmts` is a raw `*mut [Stmt]` arena pointer;
                // valid for the link step. Each accessor returns `Option`;
                // `.unwrap()` mirrors Zig's untagged-union field reads (panic
                // on shape mismatch).
                let original_ref = unsafe {
                    (*self.graph.ast.items_parts()[html_import as usize]
                        .at(1)
                        .stmts)[0]
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
                unsafe { self.graph.symbol_mut(original_ref) }
                    .link
                    .set(actual_ref);

                // When --splitting is enabled, we have to make sure we import the __jsonParse function.
                self.graph
                    .generate_symbol_import_and_use(
                        html_import,
                        Index::part(1u32).get(),
                        actual_ref,
                        1,
                        Index::RUNTIME,
                    )
                    .expect("OOM");
            }
        }
    }

    /// See [`Self::load`] for why `bundle` is a raw `*mut` (caller passes
    /// `self` while the receiver is `self.linker`; field-disjoint access only).
    ///
    /// # Safety
    /// `bundle` must be valid for the call and `self` must be `(*bundle).linker`.
    #[inline(never)]
    pub unsafe fn link(
        &mut self,
        bundle: *mut BundleV2,
        entry_points: &[Index],
        server_component_boundaries: &bun_ast::server_component_boundary::List,
        reachable: &[Index],
    ) -> Result<Box<[Chunk]>, LinkError> {
        // SAFETY: forwarded; see fn-level contract.
        unsafe { self.load(bundle, entry_points, server_component_boundaries, reachable)? };

        if self.options.source_maps != SourceMapOption::None {
            self.compute_data_for_source_map(reachable);
        }

        self.process_html_import_files();

        if FeatureFlags::HELP_CATCH_MEMORY_ISSUES {
            self.check_for_memory_corruption();
        }

        // Validate top-level await for all files first.
        // SAFETY: scalar `bool` read of a field disjoint from `self` (= `(*bundle).linker`).
        if unsafe { (*bundle).has_any_top_level_await_modules } {
            // SAFETY: `parse_graph` is a backref to `BundleV2.graph`, disjoint
            // from `*self` (= `BundleV2.linker`). The SoA column slices below
            // are physically disjoint and the underlying slabs do not
            // reallocate inside `validate_tla`; we cache raw column pointers
            // and reborrow per call to satisfy borrowck (`&mut self` is held
            // across the recursion).
            let parse_graph: *mut Graph = self.parse_graph;
            let import_records_list: *const [Vec<ImportRecord>] =
                self.graph.ast.items_import_records();
            let flags: *mut [crate::ungate_support::js_meta::Flags] =
                self.graph.meta.items_flags_mut();
            let css_asts: *const [crate::bundled_ast::CssCol] = self.graph.ast.items_css();
            let files_len = self.graph.files.len();
            // SAFETY: see block comment above — `parse_graph` backref disjoint
            // from `*self`, stable SoA slabs; the recursive `validate_tla` body
            // neither reallocates the slabs nor forms a competing `&mut` to
            // any read-only column. All seven derefs share that invariant.
            let (tla_keywords, tla_checks, input_files, import_records_list, css_asts, flags) = unsafe {
                (
                    (*parse_graph).ast.items_top_level_await_keyword(),
                    (*parse_graph).ast.items_tla_check_mut(),
                    (*parse_graph).input_files.items_source(),
                    &*import_records_list,
                    &*css_asts,
                    &mut *flags,
                )
            };
            let import_records_len = import_records_list.len();

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
                if css_asts[source_index as usize].is_some() {
                    source_index += 1;
                    continue;
                }

                let import_records = import_records_list[source_index as usize].slice();
                let _ = self.validate_tla(
                    source_index,
                    tla_keywords,
                    tla_checks,
                    input_files,
                    import_records,
                    flags,
                    import_records_list,
                )?;

                source_index += 1;
            }

            // after validation propagate async through all importers.
            self.graph.propagate_async_dependencies()?;
        }

        scan_imports_and_exports(self).map_err(BunError::from)?;

        // Stop now if there were errors
        if self.log().has_errors() {
            return Err(LinkError::BuildFailed);
        }

        if FeatureFlags::HELP_CATCH_MEMORY_ISSUES {
            self.check_for_memory_corruption();
        }

        self.tree_shaking_and_code_splitting()?;

        if FeatureFlags::HELP_CATCH_MEMORY_ISSUES {
            self.check_for_memory_corruption();
        }

        // SAFETY: scalar `u64` read of a field disjoint from `self` (= `(*bundle).linker`).
        let mut chunks = compute_chunks(self, unsafe { (*bundle).unique_key })?;

        if self.log().has_errors() {
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
        let parts: *mut [Vec<Part>] = self.graph.ast.items_parts_mut();
        let import_records: *const [Vec<ImportRecord>] = self.graph.ast.items_import_records();
        let css_reprs: *const [crate::bundled_ast::CssCol] = self.graph.ast.items_css();
        let side_effects: *const [SideEffects] =
            self.parse_graph().input_files.items_side_effects();
        let entry_point_kinds: *const [EntryPoint::Kind] =
            std::ptr::from_ref(self.graph.files.items_entry_point_kind());
        let entry_points: *const [crate::IndexInt] = self.graph.entry_points.items_source_index();
        let distances: *mut [u32] = self.graph.files.items_distance_from_entry_point_mut();
        let file_entry_bits: *mut [AutoBitSet] = self.graph.files.items_entry_bits_mut();

        // SAFETY: see block comment above — disjoint SoA columns, stable slabs
        // (no reallocation during tree-shaking). All column derefs share that
        // invariant; reborrowing once here (rather than per-call) is sound
        // because the recursive `mark_file_*` bodies neither reallocate the
        // slabs nor form a competing `&mut` to any read-only column.
        let (
            entry_points,
            side_effects,
            import_records,
            entry_point_kinds,
            css_reprs,
            parts,
            distances,
            file_entry_bits,
        ) = unsafe {
            (
                &*entry_points,
                &*side_effects,
                &*import_records,
                &*entry_point_kinds,
                &*css_reprs,
                &mut *parts,
                &mut *distances,
                &mut *file_entry_bits,
            )
        };
        let entry_points_len = entry_points.len();

        {
            let _trace2 = bun::perf::trace("Bundler.markFileLiveForTreeShaking");

            // Tree shaking: Each entry point marks all files reachable from itself
            for i in 0..entry_points_len {
                let entry_point = entry_points[i];
                self.mark_file_live_for_tree_shaking(
                    entry_point,
                    side_effects,
                    parts,
                    import_records,
                    entry_point_kinds,
                    css_reprs,
                );
            }
        }

        {
            let _trace2 = bun::perf::trace("Bundler.markFileReachableForCodeSplitting");

            // AutoBitSet needs to be initialized if it is dynamic
            if AutoBitSet::needs_dynamic(entry_points_len) {
                for bits in file_entry_bits.iter_mut() {
                    *bits = AutoBitSet::init_empty(entry_points_len)?;
                }
            } else if !file_entry_bits.is_empty() {
                // assert that the tag is correct
                debug_assert!(matches!(&file_entry_bits[0], AutoBitSet::Static(_)));
            }

            // Code splitting: Determine which entry points can reach which files. This
            // has to happen after tree shaking because there is an implicit dependency
            // between live parts within the same file. All liveness has to be computed
            // first before determining which entry points can reach which files.
            for i in 0..entry_points_len {
                let entry_point = entry_points[i];
                self.mark_file_reachable_for_code_splitting(
                    entry_point,
                    i,
                    distances,
                    0,
                    parts,
                    import_records,
                    file_entry_bits,
                    css_reprs,
                );
            }
        }

        Ok(())
    }

    // CONCURRENCY: `each_ptr` callback — runs on worker threads, one task per
    // `chunk_index`. Writes: `chunk.intermediate_output`, `chunk.isolated_hash`,
    // `chunk.output_source_map` (per-chunk, disjoint by `*mut Chunk`). Reads
    // `ctx.c`/`ctx.chunks` shared. Never forms `&mut LinkerContext` — the
    // `post_process_*` callees take `GenerateChunkCtx` by value and deref
    // `ctx.c` to `&LinkerContext` for read-only graph access plus per-chunk
    // raw-ptr writes (see `postProcessJSChunk.rs`).
    pub fn generate_chunk(ctx: &GenerateChunkCtx, chunk: *mut Chunk, chunk_index: usize) {
        // SAFETY: `each_ptr` hands us a unique `*mut Chunk` per task; deref for
        // the duration of this body. ctx.c points into BundleV2.linker;
        // container_of pattern. `Worker::get` only reads `bundle.graph.pool`
        // (shared), so a `&` is sufficient and avoids aliasing.
        let chunk: &mut Chunk = unsafe { &mut *chunk };
        let worker = crate::thread_pool::Worker::get(ctx.bundle());
        let mut worker = scopeguard::guard(worker, |w| w.unget());
        let worker: &mut crate::thread_pool::Worker = &mut **worker;
        // PORT NOTE: dispatch on a discriminant copy so `chunk` isn't borrowed
        // across the post-process call (which takes `&mut Chunk`).
        let result = match chunk.content {
            crate::chunk::Content::Javascript(_) => {
                post_process_js_chunk(*ctx, worker, chunk, chunk_index)
            }
            crate::chunk::Content::Css(_) => post_process_css_chunk(*ctx, worker, chunk),
            crate::chunk::Content::Html => post_process_html_chunk(*ctx, worker, chunk),
        };
        if let Err(err) = result {
            Output::panic(format_args!("TODO: handle error: {}", err.name()));
        }
    }

    // CONCURRENCY: `each_ptr` callback — runs on worker threads, one task per
    // `chunk_index`. Writes: `chunk.renamer` only (per-chunk, disjoint by
    // `*mut Chunk`). Reads `ctx.c.graph.{ast,meta,symbols}` SoA columns and
    // `ctx.c.options` shared. `rename_symbols_in_chunk` takes `*mut
    // LinkerContext` raw and never materializes `&mut LinkerContext` while
    // peer renamer tasks are live (see its CONCURRENCY note).
    pub fn generate_js_renamer(ctx: &GenerateChunkCtx, chunk: *mut Chunk, chunk_index: usize) {
        // SAFETY: `each_ptr` hands us a unique `*mut Chunk` per task; deref for
        // the body. container_of pattern — see `generate_chunk` above.
        let chunk: &mut Chunk = unsafe { &mut *chunk };
        let worker = crate::thread_pool::Worker::get(ctx.bundle());
        let mut worker = scopeguard::guard(worker, |w| w.unget());
        if let crate::chunk::Content::Javascript(_) = chunk.content {
            Self::generate_js_renamer_(*ctx, &mut **worker, chunk, chunk_index);
        }
    }

    fn generate_js_renamer_(
        ctx: GenerateChunkCtx,
        _worker: &mut crate::thread_pool::Worker,
        chunk: &mut Chunk,
        chunk_index: usize,
    ) {
        let _ = chunk_index;
        // PORT NOTE: reshaped for borrowck — `rename_symbols_in_chunk` needs
        // `&mut Chunk` and a borrow of `chunk.content.javascript.files_in_chunk_order`
        // simultaneously; cache the files slice via raw pointer (it lives in
        // the chunk arena, address-stable for the renamer pass).
        let files: *const [u32] = match &chunk.content {
            crate::chunk::Content::Javascript(js) => &raw const *js.files_in_chunk_order,
            _ => unreachable!(),
        };
        // SAFETY: `files` points into `chunk.content.javascript`; `rename_symbols_in_chunk`
        // does not touch `chunk.content` (it writes `chunk.renamer` only). `ctx.c` is the
        // shared `*mut LinkerContext` — pass it raw so `rename_symbols_in_chunk` can deref
        // to `&LinkerContext` (shared) without asserting whole-context exclusivity while
        // peer renamer tasks run concurrently.
        chunk.renamer = unsafe { rename_symbols_in_chunk(ctx.c.as_mut_ptr(), chunk, &*files) }
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

        // PERF(port): Zig threaded `worker.arena` through StringJoiner /
        // MutableString; the Rust ports use the global mimalloc, so the joiner
        // is arena-free here. Revisit when arena threading lands.
        let mut j = StringJoiner::default();

        let sources = self.parse_graph().input_files.items_source();
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
                let path = &sources[index as usize].path;
                source_id_map.put_no_clobber(index, 0)?;

                // PORT NOTE: Zig mutated a local copy's `path.pretty` from the
                // worker arena; we keep the relative path in a local owned
                // buffer instead (drops at scope exit — same lifetime as the
                // arena slice).
                let rel_path_storage;
                let pretty: &[u8] = if path.is_file() {
                    rel_path_storage =
                        bun_paths::resolve_path::relative_alloc(chunk_abs_dir, path.text)?;
                    &rel_path_storage
                } else {
                    path.pretty
                };

                let mut quote_buf = MutableString::init(pretty.len() + 2)?;
                js_printer::quote_for_json(pretty, &mut quote_buf, false)?;
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

                let path = &sources[index as usize].path;

                let rel_path_storage;
                let pretty: &[u8] = if path.is_file() {
                    rel_path_storage =
                        bun_paths::resolve_path::relative_alloc(chunk_abs_dir, path.text)?;
                    &rel_path_storage
                } else {
                    path.pretty
                };

                let mut quote_buf = MutableString::init(pretty.len() + ", ".len() + 2)?;
                quote_buf.append_assume_capacity(b", "); // PERF(port): was assume_capacity
                js_printer::quote_for_json(pretty, &mut quote_buf, false)?;
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
                j.push_static(
                    quoted_source_map_contents[index as usize]
                        .as_deref()
                        .unwrap_or(b""),
                );
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
        for ((chunk, offset), &current_source_index) in source_map_chunks
            .iter()
            .zip(offsets.iter())
            .zip(source_indices.iter())
        {
            let mapping_source_index = *source_id_map
                .get(&current_source_index)
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

            SourceMap::append_source_map_chunk(
                &mut j,
                prev_end_state,
                start_state,
                &chunk.buffer.list,
            )?;

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
            write!(&mut buf, "{}", DebugIDFormatter { id: isolated_hash })
                .expect("infallible: in-memory write");
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
            pieces
                .mappings
                .extend_from_slice(&done[mapping_start..mapping_end]);
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

bun_core::oom_from_alloc!(LinkError);
impl From<BunError> for LinkError {
    fn from(_: BunError) -> Self {
        // TODO(port): narrow error set — Zig's `try this.load()` is `!void` (anyerror)
        LinkError::BuildFailed
    }
}
bun_core::named_error_set!(LinkError);

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
    /// `None` only in `Default` (the per-index slot is overwritten before
    /// scheduling).
    pub ctx: Option<bun_ptr::ParentRef<LinkerContext<'static>>>,
    pub source_index: crate::IndexInt,
    pub thread_task: ThreadPoolLib::Task,
}

// SAFETY: scheduled on the worker pool via raw `*mut Task` (bypassing the
// `OwnedTask: Send` route). `ctx` is a backref into `BundleV2.linker`
// (`LinkerContext: Send`); `source_index`/`thread_task` are POD. The callback
// only writes the per-`source_index` SoA cell (see `run_line_offset`
// CONCURRENCY note), so moving the task to a worker thread is sound.
unsafe impl Send for SourceMapDataTask {}

impl Default for SourceMapDataTask {
    fn default() -> Self {
        Self {
            ctx: None,
            source_index: 0,
            // Spec `LinkerContext.zig:101`: default task callback is `&runLineOffset`.
            thread_task: ThreadPoolLib::Task {
                node: ThreadPoolLib::Node::default(),
                callback: Self::run_line_offset,
            },
        }
    }
}

impl SourceMapDataTask {
    // CONCURRENCY: thread-pool callback — runs on worker threads, one task per
    // `source_index`. Writes: `ctx.graph.files[source_index].line_offset_table`
    // (per-row disjoint), `ctx.pending_task_count` (atomic),
    // `ctx.source_maps.line_offset_wait_group` (atomic). Reads
    // `ctx.parse_graph.input_files[source_index].source` shared. Never forms
    // `&mut LinkerContext` — `compute_line_offsets` takes a `ParentRef` (yields
    // `&LinkerContext` only) and writes the single SoA cell via raw per-row
    // pointer.
    pub fn run_line_offset(thread_task: *mut ThreadPoolLib::Task) {
        // SAFETY: thread_task points to SourceMapDataTask.thread_task
        let task: &mut SourceMapDataTask = unsafe {
            &mut *(bun_core::from_field_ptr!(SourceMapDataTask, thread_task, thread_task))
        };
        // `ParentRef<LinkerContext>` — Deref yields `&LinkerContext`; the
        // pointee outlives every task (joined via `line_offset_wait_group`).
        let ctx = task.ctx.expect("SourceMapDataTask.ctx");
        scopeguard::defer! {
            // Both `&self` methods (atomic ops) — safe via `ParentRef::Deref`.
            ctx.mark_pending_task_done();
            ctx.source_maps.line_offset_wait_group.finish();
        }

        // SAFETY: ctx is BundleV2.linker; container_of recovers the parent. We
        // deliberately do NOT materialize `&mut BundleV2` here — these tasks
        // run concurrently across the worker pool (one per source_index), so
        // any `&mut` to the shared `BundleV2`/`LinkerContext` would be aliased
        // UB. `Worker::get` only needs `&BundleV2` (reads `graph.pool`), and
        // that shared borrow ends before any per-slot write below.
        let bundle: *const BundleV2 = unsafe { LinkerContext::bundle_v2_ptr(ctx.as_mut_ptr()) };
        let worker = crate::thread_pool::Worker::get(unsafe { &*bundle });
        // SAFETY: `worker.arena` points at `worker.heap` (init by `Worker::create`).
        SourceMapData::compute_line_offsets(ctx, worker.arena(), task.source_index);
        worker.unget();
    }

    // CONCURRENCY: thread-pool callback — runs on worker threads, one task per
    // `source_index`. Writes: `ctx.graph.files[source_index].quoted_source_contents`
    // (per-row disjoint), `ctx.pending_task_count` (atomic),
    // `ctx.source_maps.quoted_contents_wait_group` (atomic). Never forms
    // `&mut LinkerContext` — `compute_quoted_source_contents` takes a
    // `ParentRef` (yields `&LinkerContext` only) and writes the single SoA cell
    // via raw per-row pointer.
    pub fn run_quoted_source_contents(thread_task: *mut ThreadPoolLib::Task) {
        // SAFETY: thread_task points to SourceMapDataTask.thread_task
        let task: &mut SourceMapDataTask = unsafe {
            &mut *(bun_core::from_field_ptr!(SourceMapDataTask, thread_task, thread_task))
        };
        // `ParentRef<LinkerContext>` — Deref yields `&LinkerContext`; the
        // pointee outlives every task (joined via `quoted_contents_wait_group`).
        let ctx = task.ctx.expect("SourceMapDataTask.ctx");
        scopeguard::defer! {
            // Both `&self` methods (atomic ops) — safe via `ParentRef::Deref`.
            ctx.mark_pending_task_done();
            ctx.source_maps.quoted_contents_wait_group.finish();
        }

        // SAFETY: see `run_line_offset` — raw-ptr container_of, no `&mut`
        // materialized over the shared `BundleV2` while peer tasks are live.
        let bundle: *const BundleV2 = unsafe { LinkerContext::bundle_v2_ptr(ctx.as_mut_ptr()) };
        let worker = crate::thread_pool::Worker::get(unsafe { &*bundle });

        // Use the default arena when using DevServer and the file
        // was generated. This will be preserved so that remapping
        // stack traces can show the source code, even after incremental
        // rebuilds occur.
        //
        // PORT NOTE: Zig branched on `worker.ctx.transpiler.options.dev_server`
        // to pick `dev.arena()` vs `worker.arena`, but
        // `computeQuotedSourceContents` discards the arena parameter
        // (`_: std.mem.Allocator`) — it always allocates via
        // `bun.default_allocator` internally. The branch is a no-op, so we
        // pass the worker arena unconditionally; `DevServerHandle` does not
        // expose an arena accessor (§Dispatch).
        SourceMapData::compute_quoted_source_contents(ctx, worker.arena(), task.source_index);
        worker.unget();
    }
}

// TODO(b2-blocked): see SourceMapDataTask above.

impl SourceMapData {
    /// Runs concurrently across the worker pool (one task per `source_index`).
    /// Takes [`ParentRef<LinkerContext>`](bun_ptr::ParentRef) (not `&mut`)
    /// because Zig's `*LinkerContext` freely aliases across threads —
    /// materializing `&mut LinkerContext` here while peer tasks hold the same
    /// pointer would be aliased-mut UB. `ParentRef::Deref` yields
    /// `&LinkerContext` (SharedReadOnly) for all SoA-header reads; each task
    /// writes only `graph.files[source_index].line_offset_table` (disjoint by
    /// `source_index`) via a raw column pointer.
    pub fn compute_line_offsets(
        this: bun_ptr::ParentRef<LinkerContext<'_>>,
        alloc: &Bump,
        source_index: crate::IndexInt,
    ) {
        debug!("Computing LineOffsetTable: {}", source_index);
        // `ParentRef::Deref` → `&LinkerContext` (backref to `BundleV2.linker`,
        // valid for the link step). We only take transient `&` to read SoA
        // column base pointers via `Slice::items_raw`; the underlying
        // `MultiArrayList` header is not mutated for the duration of these
        // tasks. The write target is the per-source_index slot, addressed by
        // raw pointer — disjoint across concurrent tasks.
        // SAFETY: `add` offset is in-bounds (`source_index < files.len()`).
        let line_offset_table: *mut SourceMap::line_offset_table::List = unsafe {
            this.graph
                .files
                .slice()
                .items_raw::<"line_offset_table", SourceMap::line_offset_table::List>()
                .add(source_index as usize)
        };

        // `parse_graph` backref accessor — read-only across all tasks.
        let parse_graph = this.parse_graph();
        let source: &Source = &parse_graph.input_files.items_source()[source_index as usize];
        let loader: Loader = parse_graph.input_files.items_loader()[source_index as usize];

        if !loader.can_have_source_map() {
            // This is not a file which we support generating source maps for
            // SAFETY: sole writer to this slot (disjoint by source_index).
            unsafe { *line_offset_table = Default::default() };
            return;
        }

        // `graph.ast` is read-only for the duration of these tasks.
        let approximate_line_count =
            this.graph.ast.items_approximate_newline_count()[source_index as usize];

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
    /// for the `ParentRef` aliasing contract.
    pub fn compute_quoted_source_contents(
        this: bun_ptr::ParentRef<LinkerContext<'_>>,
        _alloc: &Bump,
        source_index: crate::IndexInt,
    ) {
        debug!("Computing Quoted Source Contents: {}", source_index);
        // SAFETY: see `compute_line_offsets` — transient `&` (via
        // `ParentRef::Deref`) to read the SoA column base, then raw-ptr offset
        // to the per-source_index slot. Sole writer to this slot (disjoint
        // across concurrent tasks); `add` offset is in-bounds.
        let quoted_source_contents = unsafe {
            &mut *this
                .graph
                .files
                .slice()
                .items_raw::<"quoted_source_contents", Option<Box<[u8]>>>()
                .add(source_index as usize)
        };
        *quoted_source_contents = None;

        // `parse_graph` backref accessor — read-only across all tasks.
        let parse_graph = this.parse_graph();
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

// Clone: bitwise OK — `alias` borrows from the AST arena (non-owning); all
// other fields are POD.
#[derive(Clone, Default)]
pub struct MatchImport {
    alias: bun_ast::StoreStr, // Zig string borrowed from AST arena
    kind: MatchImportKind,
    namespace_ref: Ref,
    source_index: u32,
    name_loc: Loc, // Optional, goes with sourceIndex, ignore if zero,
    other_source_index: u32,
    other_name_loc: Loc, // Optional, goes with otherSourceIndex, ignore if zero,
    r#ref: Ref,
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
    pub c: bun_ptr::ParentRef<LinkerContext<'a>>,
    /// Backref to the full `chunks: &mut [Chunk]` slice owned by
    /// `generate_chunks_in_parallel`. The slice outlives every
    /// `GenerateChunkCtx` (joined via `wait_for_all`), so [`bun_ptr::BackRef`]'s
    /// owner-outlives-holder invariant holds and per-task reads go through
    /// safe `Deref`. Tasks that need write provenance (HTML loader) recover
    /// the raw `*mut [Chunk]` via [`bun_ptr::BackRef::as_ptr`].
    pub chunks: bun_ptr::BackRef<[Chunk]>,
    /// Backref to this task's `Chunk` (an element of `chunks`). Constructed
    /// via [`bun_ptr::BackRef::new_mut`] so the stored `NonNull` carries write
    /// provenance; per-task slot writes recover the raw `*mut Chunk` via
    /// [`bun_ptr::BackRef::as_ptr`], shared reads go through safe `Deref`.
    pub chunk: bun_ptr::BackRef<Chunk>,
}
// SAFETY: see PORT NOTE above — mirrors Zig's freely-aliased `*LinkerContext`.
unsafe impl<'a> Send for GenerateChunkCtx<'a> {}
unsafe impl<'a> Sync for GenerateChunkCtx<'a> {}

impl<'a> GenerateChunkCtx<'a> {
    /// Recover a shared borrow of the owning `BundleV2` via container_of from
    /// the embedded `LinkerContext` pointer (`BundleV2.linker == *self.c`).
    /// Used solely to call `Worker::get`, which only reads `bundle.graph.pool`
    /// (shared) and serializes via mutex — so a `&BundleV2` is sufficient and
    /// no `&mut` is ever materialized over the shared bundle while peer
    /// per-chunk tasks run concurrently.
    #[inline]
    pub fn bundle(&self) -> &BundleV2<'a> {
        // SAFETY: `self.c` is `&raw mut bundle.linker` set in
        // `generate_chunks_in_parallel`; container_of recovers the parent.
        // The bundle is valid for the link step.
        unsafe { &*LinkerContext::bundle_v2_ptr(self.c.as_mut_ptr()) }
    }

    /// Mutable view of the owning `LinkerContext`. Centralizes the `unsafe`
    /// deref of the `c: *mut LinkerContext` backref (set in
    /// `generate_chunks_in_parallel`); callers previously open-coded
    /// `unsafe { &mut *ctx.c }`. The per-chunk tasks each touch a disjoint
    /// chunk, so the linker fields they write don't alias across tasks.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub fn c(&self) -> &mut LinkerContext<'a> {
        // SAFETY: ParentRef into `BundleV2.linker`, valid for the
        // chunk-generation pass; this task's chunk row is disjoint from peers'.
        // Constructed via `from_raw_mut` (write provenance) in
        // `generate_chunks_in_parallel`.
        unsafe { self.c.assume_mut() }
    }
}

pub struct PendingPartRange<'a> {
    pub part_range: PartRange,
    pub task: ThreadPoolLib::Task,
    pub ctx: &'a GenerateChunkCtx<'a>,
    pub i: u32,
}

/// Shared prologue for `generate_compile_result_for_{js,css}_chunk` thread-pool
/// callbacks: recover the intrusive [`PendingPartRange`] from `task`, extract
/// the raw `*mut LinkerContext` / `*mut Chunk` from its [`GenerateChunkCtx`],
/// and acquire the per-thread [`Worker`](crate::thread_pool::Worker) (returned
/// as a scopeguard that calls `unget()` on drop — Zig: `defer worker.unget()`).
///
/// `GenerateChunkCtx.{c, chunk}` are raw `*mut T` (Copy), so reading them
/// through `&GenerateChunkCtx` preserves the mutable provenance they were
/// constructed with in `generate_chunks_in_parallel`. This mirrors Zig's
/// `*LinkerContext` / `*Chunk` semantics where many `PendingPartRange` tasks
/// share one `chunk_ctx` across worker threads.
///
/// # Safety
/// `task` must point to the `task` field of a live `PendingPartRange` scheduled
/// by `generate_chunks_in_parallel`. The returned `&PendingPartRange` borrows
/// the task allocation for the callback's duration; the returned raw pointers
/// carry the mutable provenance the `GenerateChunkCtx` was constructed with.
/// Callers uphold the disjoint-write contract:
///   - `chunk.compile_results_for_chunk[i]` is written at a per-task unique `i`
///     via [`Chunk::write_compile_result_slot`] (raw `addr_of_mut!` +
///     `UnsafeCell` slot write — never `&mut Chunk`),
///   - `chunk.files_with_parts_in_chunk` entries are updated via atomic RMW only,
///   - all other access through `c` / `chunk` during codegen is read-only.
#[inline]
#[allow(clippy::type_complexity)]
pub(crate) unsafe fn pending_part_range_prologue<'a>(
    task: *mut ThreadPoolLib::Task,
) -> (
    &'a PendingPartRange<'a>,
    *mut LinkerContext<'a>,
    *mut Chunk,
    scopeguard::ScopeGuard<
        &'static mut crate::thread_pool::Worker,
        impl FnOnce(&'static mut crate::thread_pool::Worker),
    >,
) {
    // SAFETY: per fn contract — `task` is the intrusive `task` field.
    let part_range: &PendingPartRange =
        unsafe { &*bun_core::from_field_ptr!(PendingPartRange, task, task) };
    let ctx = part_range.ctx;
    let c_ptr: *mut LinkerContext = ctx.c.as_mut_ptr().cast();
    let chunk_ptr: *mut Chunk = ctx.chunk.as_ptr();
    let worker = crate::thread_pool::Worker::get(ctx.bundle());
    let worker = scopeguard::guard(worker, |w| w.unget());
    (part_range, c_ptr, chunk_ptr, worker)
}

/// `Environment.show_crash_trace` scoped-action guard for the
/// `generate_compile_result_for_{js,css}_chunk` callbacks. Thin wrapper over
/// [`bundle_generate_chunk_action`] + [`bun_crash_handler::scoped_action`].
///
/// Callers materialise the `&LinkerContext` / `&Chunk` from the worker-task
/// raw pointers (see [`pending_part_range_prologue`]); the borrows are only
/// used to derive erased `*const ()` for the crash-trace vtable and are not
/// retained past the `scoped_action` expression.
#[cfg(feature = "show_crash_trace")]
#[inline]
#[must_use]
pub(crate) fn crash_guard_for_part_range(
    c: &LinkerContext<'_>,
    chunk: &Chunk,
    part_range: &PartRange,
) -> bun_crash_handler::ActionGuard {
    bun_crash_handler::scoped_action(bundle_generate_chunk_action(c, chunk, part_range))
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
                            source.path = self
                                .path_with_pretty_initialized(source.path.clone())
                                .expect("OOM");
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
                hasher.write_ints(&[part_range.part_index_begin, part_range.part_index_end]);
            }
        }

        // Hash the output path template as part of the content hash because we want
        // any import to be considered different if the import's output path has changed.
        hasher.write(&chunk.template.data);

        let public_path: &[u8] = if chunk
            .flags
            .contains(crate::chunk::Flags::IS_BROWSER_CHUNK_FROM_SERVER_BUILD)
        {
            // SAFETY: self is BundleV2.linker; container_of recovers the parent.
            // `transpiler_for_target` only reads `bundle.browser_transpiler`.
            let bundle = unsafe {
                &mut *LinkerContext::bundle_v2_ptr(std::ptr::from_mut::<LinkerContext>(self))
            };
            &bundle
                .transpiler_for_target(Target::Browser)
                .options
                .public_path
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
            crate::chunk::IntermediateOutput::Joiner(joiner) => {
                for slice in joiner.node_slices() {
                    hasher.write(slice);
                }
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
        ast_import_records: &[Vec<ImportRecord>],
    ) -> Result<TlaCheck, AllocError> {
        // PORT NOTE: reshaped for borrowck — Zig held &mut tla_checks[source_index] across recursive
        // calls that also mutate tla_checks. We re-index after each recursion.
        if tla_checks[source_index as usize].depth == 0 {
            tla_checks[source_index as usize].depth = 1;
            if tla_keywords[source_index as usize].len > 0 {
                tla_checks[source_index as usize].parent = source_index;
            }

            for (import_record_index, record) in import_records.iter().enumerate() {
                if Index::is_valid(record.source_index)
                    && (record.kind == ImportKind::Require || record.kind == ImportKind::Stmt)
                {
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
                        && (Index::is_invalid(Index::init(result_tla_check.parent))
                            || parent.depth < result_tla_check.depth)
                    {
                        result_tla_check.depth = parent.depth + 1;
                        result_tla_check.parent = record.source_index.get();
                        result_tla_check.import_record_index =
                            u32::try_from(import_record_index).expect("int cast");
                        continue;
                    }

                    // Require of a top-level await chain is forbidden
                    if record.kind == ImportKind::Require {
                        let mut notes: Vec<Data> = Vec::new();

                        let mut tla_pretty_path: &[u8] = b"";
                        let mut other_source_index = record.source_index.get();

                        // Build up a chain of notes for all of the imports
                        loop {
                            let parent_result_tla_keyword =
                                tla_keywords[other_source_index as usize];
                            let parent_tla_check = tla_checks[other_source_index as usize];
                            let parent_source_index = other_source_index;

                            if parent_result_tla_keyword.len > 0 {
                                let source = &input_files[other_source_index as usize];
                                tla_pretty_path = &source.path.pretty;
                                let mut text = Vec::new();
                                use std::io::Write;
                                write!(
                                    &mut text,
                                    "The top-level await in {} is here:",
                                    bstr::BStr::new(tla_pretty_path)
                                )
                                .expect("infallible: in-memory write");
                                notes.push(Data {
                                    text: text.into(),
                                    location: bun_ast::Location::init_or_null(
                                        Some(source),
                                        parent_result_tla_keyword,
                                    ),
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
                                bstr::BStr::new(
                                    &input_files[parent_source_index as usize].path.pretty
                                ),
                                bstr::BStr::new(
                                    &input_files[other_source_index as usize].path.pretty
                                ),
                            )
                            .unwrap();
                            notes.push(Data {
                                text: text.into(),
                                location: bun_ast::Location::init_or_null(
                                    Some(&input_files[parent_source_index as usize]),
                                    ast_import_records[parent_source_index as usize].slice()
                                        [tla_checks[parent_source_index as usize]
                                            .import_record_index
                                            as usize]
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
                            write!(&mut text, "This require call is not allowed because the imported file \"{}\" contains a top-level await", bstr::BStr::new(imported_pretty_path)).expect("infallible: in-memory write");
                        } else {
                            write!(&mut text, "This require call is not allowed because the transitive dependency \"{}\" contains a top-level await", bstr::BStr::new(tla_pretty_path)).expect("infallible: in-memory write");
                        }

                        // Split-borrow with `source`/`record` (parse_graph backref
                        // slices) — `log_disjoint` returns the disjoint backref.
                        self.log_disjoint().add_range_error_with_notes(
                            Some(source),
                            record.range,
                            text,
                            notes.into_boxed_slice(),
                        );
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
        if record.flags.contains(bun_ast::ImportRecordFlags::IS_UNUSED) {
            return Ok(true);
        }
        // Is this an external import?
        if !record.source_index.is_valid() {
            // Keep the "import" statement if import statements are supported
            if self.options.output_format.keep_es6_import_export_syntax() {
                return Ok(false);
            }

            // Otherwise, replace this statement with a call to "require()"
            stmts
                .inside_wrapper_prefix
                .append_non_dependency(Stmt::alloc(
                    S::Local {
                        decls: G::DeclList::from_slice(&[G::Decl {
                            binding: Binding::alloc(
                                alloc,
                                bun_ast::b::Identifier {
                                    r#ref: namespace_ref,
                                },
                                loc,
                            ),
                            value: Some(Expr::init(
                                E::RequireString {
                                    import_record_index,
                                    ..Default::default()
                                },
                                loc,
                            )),
                        }]),
                        ..Default::default()
                    },
                    record.range.loc,
                ))
                .expect("unreachable");
            return Ok(true);
        }

        // We don't need a call to "require()" if this is a self-import inside a
        // CommonJS-style module, since we can just reference the exports directly.
        if ast.exports_kind == ExportsKind::Cjs
            && self
                .graph
                .symbols
                .follow(namespace_ref)
                .eql(ast.exports_ref)
        {
            return Ok(true);
        }

        let other_flags = self.graph.meta.items_flags()[record.source_index.get() as usize];
        match other_flags.wrap {
            WrapKind::None => {}
            WrapKind::Cjs => {
                // Replace the statement with a call to "require()" since the other module is CJS-wrapped
                stmts
                    .inside_wrapper_prefix
                    .append_non_dependency(Stmt::alloc(
                        S::Local {
                            decls: G::DeclList::from_slice(&[G::Decl {
                                binding: Binding::alloc(
                                    alloc,
                                    bun_ast::b::Identifier {
                                        r#ref: namespace_ref,
                                    },
                                    loc,
                                ),
                                value: Some(Expr::init(
                                    E::RequireString {
                                        import_record_index,
                                        ..Default::default()
                                    },
                                    loc,
                                )),
                            }]),
                            ..Default::default()
                        },
                        loc,
                    ))?;
            }
            WrapKind::Esm => {
                // Ignore this file if it's not included in the bundle. This can happen for
                // wrapped ESM files but not for wrapped CommonJS files because we allow
                // tree shaking inside wrapped ESM files.
                if !self
                    .graph
                    .files_live
                    .is_set(record.source_index.get() as usize)
                {
                    return Ok(true);
                }

                let wrapper_ref =
                    self.graph.ast.items_wrapper_ref()[record.source_index.get() as usize];
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
                    stmts
                        .inside_wrapper_prefix
                        .append_async_dependency(init_call, self.promise_all_runtime_ref)?;
                } else {
                    stmts
                        .inside_wrapper_prefix
                        .append_sync_dependency(init_call)?;
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
        let parts_to_print = &[Part {
            stmts: bun_ast::StoreSlice::new_mut(out_stmts),
            ..Default::default()
        }];

        // SAFETY: parse_graph backref; raw deref because `parse_graph` is held
        // across `RequireOrImportMetaCallback::init(self)` (`&mut self`) below.
        let parse_graph = unsafe { &*self.parse_graph };

        // PORT NOTE: `Options.arena` / `source_map_allocator` were removed in
        // the Rust port (printer uses global mimalloc + the explicit `bump`
        // argument to `print_with_writer`). The dev-server source-map-arena
        // selection is folded into TODO(b3) until arena threading lands.
        let _ = self.dev_server.is_some()
            && parse_graph.input_files.items_loader()[source_index.get() as usize]
                .is_javascript_like();

        // PORT NOTE: reshaped for borrowck — `Options` borrows `ts_enums` /
        // `line_offset_tables` / `mangled_props` from `self.graph`, but the
        // `require_or_import_meta_for_source_callback` field below needs
        // `&mut self`. Detach the read-only borrows via raw-pointer round-trip
        // (graph SoA storage is never reallocated during the print step).
        // SAFETY: `self.graph` columns are stable heap allocations valid for
        // the duration of this call; the printer only reads from them.
        let ts_enums: &bun_ast::ast_result::TsEnumsMap =
            unsafe { bun_ptr::detach_lifetime_ref(&self.graph.ts_enums) };
        let line_offset_table: &bun_sourcemap::line_offset_table::List = unsafe {
            &*(&raw const self.graph.files.items_line_offset_table()[source_index.get() as usize])
        };
        let mangled_props: &MangledProps =
            unsafe { bun_ptr::detach_lifetime_ref(&self.mangled_props) };

        let print_options = js_printer::Options {
            bundling: true,
            // TODO: IIFE
            indent: Default::default(),
            commonjs_named_exports: Some(&ast.commonjs_named_exports),
            commonjs_named_exports_ref: ast.exports_ref,
            commonjs_module_ref: if ast.flags.contains(AstFlags::USES_MODULE_REF) {
                ast.module_ref
            } else {
                Ref::NONE
            },
            commonjs_named_exports_deoptimized: flags.wrap == WrapKind::Cjs,
            commonjs_module_exports_assigned_deoptimized: ast
                .flags
                .contains(AstFlags::COMMONJS_MODULE_EXPORTS_ASSIGNED_DEOPTIMIZED),
            // .const_values = c.graph.const_values,
            ts_enums: Some(ts_enums),

            minify_whitespace: self.options.minify_whitespace,
            minify_syntax: self.options.minify_syntax,
            input_module_type: ast.exports_kind.into(),
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
            line_offset_tables: Some(line_offset_table),
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
            mangled_props: Some(mangled_props),
            ..Default::default()
        };

        writer.buffer.reset();
        // PORT NOTE: Zig moved `*writer` into the printer by value and wrote it
        // back via `defer writer.* = printer.ctx;`. `BufferWriter` isn't
        // `Clone`/`Default` in Rust; move it through `mem::replace` with a
        // freshly-initialized writer instead.
        let mut printer = js_printer::BufferPrinter::init(core::mem::replace(
            writer,
            js_printer::BufferWriter::init(),
        ));

        // PORT NOTE: Zig's `ast.toAST()` bitwise-copies every field of
        // `*const BundledAst` into a stack `Ast` that is never deinit'd. The
        // Rust collections aren't `Copy`, so mirror the Zig shallow copy via
        // `ptr::read` + `ManuallyDrop` (the resulting `Ast` aliases `ast`'s
        // storage; dropping it would double-free).
        // SAFETY: `ast` is a valid `&BundledAst` for the duration of this call;
        // the read is a bitwise copy whose result is never dropped.
        let printer_ast = core::mem::ManuallyDrop::new(unsafe { core::ptr::read(ast) }.to_ast());

        // PORT NOTE: `print_with_writer<'a>` requires `Renamer<'a,'a>` (the
        // printer struct stores it with a single lifetime), but `Renamer`'s
        // `'src` is invariant behind `&mut`, so the caller's `Renamer<'r,'src>`
        // cannot unify with the local `'a` picked from `alloc`/`mangled_props`.
        // Zig threads it as a raw pointer (no lifetimes). Rebind via a
        // lifetime-only cast — sound because the renamer's borrowed data
        // (symbol map, source) strictly outlives this call.
        // SAFETY: lifetime-only erase; layout identical across instantiations.
        let r: renamer::Renamer<'_, '_> = unsafe {
            core::mem::transmute::<renamer::Renamer<'_, '_>, renamer::Renamer<'_, '_>>(r)
        };

        let enable_source_maps =
            self.options.source_maps != SourceMapOption::None && !source_index.is_runtime();
        // PERF(port): was comptime bool dispatch — profile in Phase B
        let result = if enable_source_maps {
            js_printer::print_with_writer::<&mut js_printer::BufferPrinter, true>(
                &mut printer,
                alloc,
                ast.target,
                &printer_ast,
                source,
                print_options,
                ast.import_records.slice(),
                parts_to_print,
                r,
            )
        } else {
            js_printer::print_with_writer::<&mut js_printer::BufferPrinter, false>(
                &mut printer,
                alloc,
                ast.target,
                &printer_ast,
                source,
                print_options,
                ast.import_records.slice(),
                parts_to_print,
                r,
            )
        };

        // `defer writer.* = printer.ctx;`
        *writer = printer.ctx;
        result
    }

    pub fn require_or_import_meta_for_source(
        &mut self,
        source_index: crate::IndexInt,
        was_unwrapped_require: bool,
    ) -> js_printer::RequireOrImportMeta {
        let flags = self.graph.meta.items_flags()[source_index as usize];
        js_printer::RequireOrImportMeta {
            exports_ref: if flags.wrap == WrapKind::Esm
                || (was_unwrapped_require
                    && self.graph.ast.items_flags()[source_index as usize]
                        .contains(AstFlags::FORCE_CJS_TO_ESM))
            {
                self.graph.ast.items_exports_ref()[source_index as usize]
            } else {
                Ref::NONE
            },
            is_wrapper_async: flags.is_async_or_has_async_dependency,
            wrapper_ref: self.graph.ast.items_wrapper_ref()[source_index as usize],

            was_unwrapped_require: was_unwrapped_require
                && self.graph.ast.items_flags()[source_index as usize]
                    .contains(AstFlags::FORCE_CJS_TO_ESM),
        }
    }

    pub fn mangle_local_css(&mut self) {
        if self.has_any_css_locals.load(Ordering::Relaxed) == 0 {
            return;
        }

        let all_css_asts = self.graph.ast.items_css();
        let all_symbols: &[Vec<Symbol>] = self.graph.ast.items_symbols();
        // SAFETY: parse_graph backref; raw deref because `all_sources` is held
        // across `&mut self.mangled_props` below (split borrow).
        let all_sources: &[Source] = unsafe { (*self.parse_graph).input_files.items_source() };

        // Collect all local css names
        // PERF(port): was stack-fallback alloc
        let mut local_css_names: HashMap<Ref, ()> = HashMap::new();

        for (source_index, maybe_css_ast) in all_css_asts.iter().enumerate() {
            if let Some(css_ast) = maybe_css_ast.as_deref() {
                if css_ast.local_scope.count() == 0 {
                    continue;
                }
                let symbols = &all_symbols[source_index];
                for (inner_index, symbol_) in symbols.slice_const().iter().enumerate() {
                    let mut symbol = symbol_;
                    if symbol.kind == bun_ast::symbol::Kind::LocalCss {
                        let r#ref = 'follow: {
                            // PORT NOTE: Zig set `.tag = .symbol` after `init`;
                            // `Ref` is packed in Rust — construct via `new`.
                            let mut r#ref = Ref::new(
                                u32::try_from(inner_index).expect("int cast"),
                                u32::try_from(source_index).expect("int cast"),
                                bun_ast::RefTag::Symbol,
                            );
                            while symbol.has_link() {
                                r#ref = symbol.link.get();
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
                        let original_name: &[u8] = symbol.original_name.slice();
                        // PERF(port): was stack-fallback alloc. The hash itself
                        // is short-lived; use a scratch bump.
                        let scratch = ::bun_alloc::Arena::new();
                        let path_hash = ::bun_base64::wyhash_url_safe(
                            &scratch,
                            // use path relative to cwd for determinism
                            format_args!("{}", bstr::BStr::new(&source.path.pretty)),
                            false,
                        );

                        let mut final_generated_name = Vec::<u8>::new();
                        use std::io::Write;
                        write!(
                            &mut final_generated_name,
                            "{}_{}",
                            bstr::BStr::new(original_name),
                            bstr::BStr::new(path_hash)
                        )
                        .expect("infallible: in-memory write");
                        // TODO(port): arena() is arena; mangled_props key/value lifetime
                        self.mangled_props
                            .put(r#ref, final_generated_name.into_boxed_slice())
                            .expect("OOM");
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
            self.append_isolated_hashes_for_imported_chunks(
                hash,
                chunks,
                chunk_index,
                chunk_visit_map,
            );
        }

        // Mix in hashes for content referenced via output pieces. JS chunks
        // express cross-chunk dependencies via `cross_chunk_imports` above, but
        // HTML (and CSS) chunks only reference other chunks through pieces, so
        // recurse on those too.
        // PORT NOTE: reshaped for borrowck — collect piece queries first so the
        // `&chunks[index]` borrow is dropped before the recursive `&mut chunks`
        // calls in the Chunk/Scb arms below. `final_rel_path` is re-indexed per
        // Asset arm (not hoisted) because it is now `Box<[u8]>` (not `Copy`).
        let piece_queries: Vec<(crate::chunk::QueryKind, u32)> =
            if let crate::chunk::IntermediateOutput::Pieces(pieces) =
                &chunks[index as usize].intermediate_output
            {
                pieces
                    .slice()
                    .iter()
                    .map(|p| (p.query.kind(), p.query.index()))
                    .collect()
            } else {
                Vec::new()
            };

        for (kind, piece_index) in piece_queries {
            match kind {
                crate::chunk::QueryKind::Asset => {
                    let mut from_chunk_dir = bun_paths::resolve_path::dirname::<
                        bun_paths::resolve_path::platform::Posix,
                    >(
                        &chunks[index as usize].final_rel_path
                    );
                    if from_chunk_dir == b"." {
                        from_chunk_dir = b"";
                    }

                    let source_index = piece_index;
                    let parse_graph = self.parse_graph();
                    let additional_files: &[AdditionalFile] =
                        parse_graph.input_files.items_additional_files()[source_index as usize]
                            .slice();
                    debug_assert!(!additional_files.is_empty());
                    match &additional_files[0] {
                        AdditionalFile::OutputFile(output_file_id) => {
                            let path = &parse_graph.additional_output_files
                                [*output_file_id as usize]
                                .dest_path;
                            hash.write(bun_paths::resolve_path::relative_platform::<
                                bun_paths::resolve_path::platform::Posix,
                                false,
                            >(from_chunk_dir, path));
                        }
                        AdditionalFile::SourceIndex(_) => {}
                    }
                }
                crate::chunk::QueryKind::Chunk => {
                    self.append_isolated_hashes_for_imported_chunks(
                        hash,
                        chunks,
                        piece_index,
                        chunk_visit_map,
                    );
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
                // `parse_graph` is a backref into BundleV2 (LIFETIMES.tsv).
                let sym = self.graph.symbol(export_ref);
                debug_tree_shake!(
                    "Export name: {} (in {})",
                    bstr::BStr::new(sym.original_name.slice()),
                    bstr::BStr::new(
                        &self.parse_graph().input_files.items_source()
                            [export_ref.source_index() as usize]
                            .path
                            .text
                    ),
                );
            }
            list.push(StableRef {
                stable_source_index: *self
                    .graph
                    .stable_source_indices
                    .at(export_ref.source_index() as usize),
                r#ref: export_ref,
            });
        }
        list.sort_by(|a, b| {
            if StableRef::is_less_than((), *a, *b) {
                core::cmp::Ordering::Less
            } else {
                core::cmp::Ordering::Greater
            }
        });
    }
} // end  — split: tree-shaking trio un-gated below (B-2 second pass)

/// `js_printer::RequireOrImportMetaSource` — manual-vtable shim so the printer
/// can call back into `LinkerContext::require_or_import_meta_for_source`.
impl<'a> js_printer::RequireOrImportMetaSource for LinkerContext<'a> {
    #[inline]
    fn require_or_import_meta_for_source(
        &mut self,
        id: u32,
        was_unwrapped_require: bool,
    ) -> js_printer::RequireOrImportMeta {
        LinkerContext::require_or_import_meta_for_source(self, id, was_unwrapped_require)
    }
}

// ══════════════════════════════════════════════════════════════════════════
// B-2 second pass: un-gated tree-shaking primitives. These reach into
// `LinkerGraph` SoA columns (`files_live`, `meta.items_flags()`) and the
// `Graph::InputFileColumns` accessors. `LinkerGraph` real fields land via the
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
        // Spec (LinkerContext.zig:1579) passes `parts: []Vec(Part)` and only
        // reads it. `&mut` here forced an aliased reborrow against the
        // `parts_in_file` slice below — borrowck conflict in un-gated code.
        parts: &[Vec<Part>],
        import_records: &[Vec<ImportRecord>],
        file_entry_bits: &mut [AutoBitSet],
        css_reprs: &[crate::bundled_ast::CssCol],
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
            let parse_graph = self.parse_graph();
            debug_tree_shake!(
                "markFileReachableForCodeSplitting(entry: {}): {} {} ({})",
                entry_points_count,
                bstr::BStr::new(
                    &parse_graph.input_files.items_source()[source_index as usize]
                        .path
                        .pretty
                ),
                <&'static str>::from(
                    parse_graph.ast.items_target()[source_index as usize].bake_graph()
                ),
                out_dist,
            );
        }

        if css_reprs[source_index as usize].is_some() {
            for record in import_records[source_index as usize].slice() {
                if record.source_index.is_valid()
                    && !self.is_external_dynamic_import(record, source_index)
                {
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
            if record.source_index.is_valid()
                && !self.is_external_dynamic_import(record, source_index)
            {
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
        parts: &mut [Vec<Part>],
        import_records: &[Vec<ImportRecord>],
        entry_point_kinds: &[EntryPoint::Kind],
        css_reprs: &[crate::bundled_ast::CssCol],
    ) {
        #[cfg(debug_assertions)]
        {
            let parse_graph = self.parse_graph();
            debug_tree_shake!(
                "markFileLiveForTreeShaking({}, {} {}) = {}",
                source_index,
                bstr::BStr::new(
                    &parse_graph
                        .input_files
                        .get(source_index as usize)
                        .source
                        .path
                        .pretty
                ),
                // PORT NOTE: Zig printed `target.bakeGraph()` (a `bake.Graph` tag);
                // `bake_graph()` lives in `bun_bake` (tier-6 — would back-edge).
                // The debug log only needs a stable label, so print the `Target`
                // tag directly via its `IntoStaticStr` derive.
                <&'static str>::from(parse_graph.ast.items_target()[source_index as usize]),
                if self.graph.files_live.is_set(source_index as usize) {
                    "already seen"
                } else {
                    "first seen"
                },
            );
        }

        #[cfg(debug_assertions)]
        scopeguard::defer! { debug_tree_shake!("end()"); }

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
        if self.parse_graph().input_files.items_loader()[source_index as usize] == Loader::Html {
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

            if can_be_removed_if_unused && part.tag == bun_ast::PartTag::CommonjsNamedExport {
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
                } else if record
                    .flags
                    .contains(bun_ast::ImportRecordFlags::IS_EXTERNAL_WITHOUT_SIDE_EFFECTS)
                {
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
            let force_tree_shaking =
                parts[source_index as usize].slice()[part_index].force_tree_shaking;
            if !can_be_removed_if_unused
                || (!force_tree_shaking
                    && !self.options.tree_shaking
                    && entry_point_kinds[source_index as usize].is_entry_point())
            {
                self.mark_part_live_for_tree_shaking(
                    u32::try_from(part_index).expect("int cast"),
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
        parts: &mut [Vec<Part>],
        import_records: &[Vec<ImportRecord>],
        entry_point_kinds: &[EntryPoint::Kind],
        css_reprs: &[crate::bundled_ast::CssCol],
    ) {
        let part: &mut Part = &mut parts[source_index as usize].slice_mut()[part_index as usize];

        // only once
        if part.is_live {
            return;
        }
        part.is_live = true;

        #[cfg(debug_assertions)]
        {
            let parse_graph = self.parse_graph();
            let stmts: &[Stmt] = part.stmts.slice();
            debug_tree_shake!(
                "markPartLiveForTreeShaking({}): {}:{} = {}, {}",
                source_index,
                bstr::BStr::new(
                    &parse_graph
                        .input_files
                        .get(source_index as usize)
                        .source
                        .path
                        .pretty
                ),
                part_index,
                if !stmts.is_empty() {
                    stmts[0].loc.start
                } else {
                    Loc::EMPTY.start
                },
                // Zig used `@tagName(stmts[0].data)`. `StmtData::tag()` → `StmtTag` which
                // derives `strum::IntoStaticStr`.
                if !stmts.is_empty() {
                    <&'static str>::from(stmts[0].data.tag())
                } else {
                    "s_empty"
                },
            );
        }

        #[cfg(debug_assertions)]
        scopeguard::defer! { debug_tree_shake!("end()"); }

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
            log_part_dependency_tree!(
                "markPartLiveForTreeShaking {}:{} | EMPTY",
                source_index,
                part_index
            );
        }

        for dependency in &dependencies {
            #[cfg(feature = "debug_logs")]
            if source_index != 0 && dependency.source_index.get() != 0 {
                log_part_dependency_tree!(
                    "markPartLiveForTreeShaking: {}:{} --> {}:{}\n",
                    source_index,
                    part_index,
                    dependency.source_index.get(),
                    dependency.part_index,
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
use bun_ast::symbol::Use as SymbolUse;
use bun_ast::{DependencyList, ImportItemStatus, PartSymbolUseMap};

// `bundle_v2.zig:ImportTracker.{Status,Iterator}` — canonical definition lives
// in `bundle_v2.rs` (matches Zig spec location). Re-exported here so the 30+
// unqualified uses in `advance_import_tracker` / `match_import_with_export`
// below resolve unchanged.
pub use crate::bundle_v2::{ImportTrackerIterator, ImportTrackerStatus};

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
    pub fn get_source<I: TryInto<usize>>(&self, index: I) -> &'static Source {
        // PORT NOTE: Zig spec is `index: anytype`; callers pass both `u32` and
        // `usize`. Route through `TryInto<usize>` so the SoA index works for
        // either width without forcing `as`-casts at every call site.
        let index: usize = match index.try_into() {
            Ok(i) => i,
            Err(_) => unreachable!(),
        };
        // SAFETY: parse_graph backref into BundleV2.graph; the input_files SoA
        // is monotonically grown and never freed for the link step's lifetime,
        // so the element address is stable. `'static` is a white lie matching
        // the `*mut Graph` erasure on `self.parse_graph`.
        unsafe { &*core::ptr::from_ref(&(*self.parse_graph).input_files.items_source()[index]) }
    }

    /// Spec: `LinkerContext.zig:496 scanCSSImports`.
    ///
    /// `log` is an explicit parameter (not `self.log`) because the dev-server
    /// caller (`finish_from_bake_dev_server`) runs this *before* `load()` has
    /// initialized `self.log`, passing a stack-local `Log` instead.
    pub fn scan_css_imports(
        file_source_index: u32,
        file_import_records: &[ImportRecord],
        css_asts: *const [crate::bundled_ast::CssCol],
        sources: &[Source],
        loaders: &[Loader],
        log: &mut Log,
    ) -> ScanCssImportsResult {
        // SAFETY: `css_asts` points at the `graph.ast.items_css()` column for
        // the duration of `scanImportsAndExports`; we only test `is_none()`.
        let css_asts = unsafe { &*css_asts };
        for record in file_import_records.iter() {
            if record.source_index.is_valid() {
                // Other file is not CSS
                if css_asts[record.source_index.get() as usize].is_none() {
                    let source = &sources[file_source_index as usize];
                    let loader = loaders[record.source_index.get() as usize];

                    match loader {
                        Loader::Jsx
                        | Loader::Js
                        | Loader::Ts
                        | Loader::Tsx
                        | Loader::Napi
                        | Loader::Sqlite
                        | Loader::Json
                        | Loader::Jsonc
                        | Loader::Json5
                        | Loader::Yaml
                        | Loader::Html
                        | Loader::SqliteEmbedded
                        | Loader::Md => {
                            log.add_error_fmt(
                                Some(source),
                                record.range.loc,
                                format_args!(
                                    "Cannot import a \".{}\" file into a CSS file",
                                    <&'static str>::from(loader),
                                ),
                            );
                        }
                        Loader::Css
                        | Loader::File
                        | Loader::Toml
                        | Loader::Wasm
                        | Loader::Base64
                        | Loader::Dataurl
                        | Loader::Text
                        | Loader::Bunsh => {}
                    }
                }
            }
        }
        if log.errors > 0 {
            ScanCssImportsResult::Errors
        } else {
            ScanCssImportsResult::Ok
        }
    }

    /// Spec: `LinkerContext.zig:2158 createWrapperForFile`.
    pub fn create_wrapper_for_file(
        &mut self,
        wrap: WrapKind,
        wrapper_ref: Ref,
        // PORT NOTE: `crate::Index` (`bun_ast::Index`),
        // not `bun_ast::Index` — the SoA `wrapper_part_index` column is
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
                let common_js_parts =
                    self.top_level_symbols_to_parts_for_runtime(self.cjs_runtime_ref);

                // PORT NOTE: reshaped for borrowck — Zig held `runtime_parts`
                // simultaneously with the mutable graph borrows below; the inner
                // loop is empty (`if r#ref.eql(...) continue;` only) so it's a
                // no-op kept for parity with the original.
                for &part_id in common_js_parts {
                    let runtime_parts =
                        self.graph.ast.items_parts()[Index::RUNTIME.get() as usize].slice();
                    let part: &Part = &runtime_parts[part_id as usize];
                    let symbol_refs = part.symbol_uses.keys();
                    for r#ref in symbol_refs {
                        if *r#ref == self.cjs_runtime_ref {
                            continue;
                        }
                    }
                }

                // generate a dummy part that depends on the "__commonJS" symbol.
                let dependencies: DependencyList =
                    if self.options.output_format != Format::InternalBakeDev {
                        let mut deps = Vec::<Dependency>::init_capacity(common_js_parts.len());
                        for &part in common_js_parts {
                            deps.append_assume_capacity(Dependency {
                                part_index: part,
                                source_index: bun_ast::Index::RUNTIME,
                            });
                        }
                        deps
                    } else {
                        DependencyList::default()
                    };
                let mut symbol_uses = PartSymbolUseMap::default();
                symbol_uses
                    .put(wrapper_ref, SymbolUse { count_estimate: 1 })
                    .expect("OOM");
                let exports_ref = self.graph.ast.items_exports_ref()[source_index as usize];
                let module_ref = self.graph.ast.items_module_ref()[source_index as usize];
                let wrap_ref = self.graph.ast.items_wrapper_ref()[source_index as usize];
                let part_index = self
                    .graph
                    .add_part_to_file(
                        source_index,
                        Part {
                            symbol_uses,
                            declared_symbols: DeclaredSymbolList::from_slice(&[
                                DeclaredSymbol {
                                    ref_: exports_ref,
                                    is_top_level: true,
                                },
                                DeclaredSymbol {
                                    ref_: module_ref,
                                    is_top_level: true,
                                },
                                DeclaredSymbol {
                                    ref_: wrap_ref,
                                    is_top_level: true,
                                },
                            ])
                            .expect("unreachable"),
                            dependencies,
                            ..Default::default()
                        },
                    )
                    .expect("unreachable");
                debug_assert!(part_index != bun_ast::NAMESPACE_EXPORT_PART_INDEX);
                *wrapper_part_index = crate::Index::part(part_index);

                // Bake uses a wrapping approach that does not use __commonJS
                if self.options.output_format != Format::InternalBakeDev {
                    self.graph
                        .generate_symbol_import_and_use(
                            source_index,
                            part_index,
                            self.cjs_runtime_ref,
                            1,
                            crate::Index::RUNTIME,
                        )
                        .expect("unreachable");
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
                    let import_records =
                        self.graph.ast.items_import_records()[source_index as usize].slice();
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

                let esm_parts: &[u32] = if wrapper_ref.is_valid()
                    && self.options.output_format != Format::InternalBakeDev
                {
                    self.top_level_symbols_to_parts_for_runtime(self.esm_runtime_ref)
                } else {
                    &[]
                };

                let promise_all_parts: &[u32] = if needs_promise_all
                    && wrapper_ref.is_valid()
                    && self.options.output_format != Format::InternalBakeDev
                {
                    self.top_level_symbols_to_parts_for_runtime(self.promise_all_runtime_ref)
                } else {
                    &[]
                };

                // generate a dummy part that depends on the "__esm" and optionally "__promiseAll" symbols
                let mut dependencies =
                    Vec::<Dependency>::init_capacity(esm_parts.len() + promise_all_parts.len());
                for &part in esm_parts {
                    dependencies.append_assume_capacity(Dependency {
                        part_index: part,
                        source_index: bun_ast::Index::RUNTIME,
                    });
                }
                for &part in promise_all_parts {
                    dependencies.append_assume_capacity(Dependency {
                        part_index: part,
                        source_index: bun_ast::Index::RUNTIME,
                    });
                }

                let mut symbol_uses = PartSymbolUseMap::default();
                symbol_uses
                    .put(wrapper_ref, SymbolUse { count_estimate: 1 })
                    .expect("OOM");
                let part_index = self
                    .graph
                    .add_part_to_file(
                        source_index,
                        Part {
                            symbol_uses,
                            declared_symbols: DeclaredSymbolList::from_slice(&[DeclaredSymbol {
                                ref_: wrapper_ref,
                                is_top_level: true,
                            }])
                            .expect("unreachable"),
                            dependencies,
                            ..Default::default()
                        },
                    )
                    .expect("unreachable");
                debug_assert!(part_index != bun_ast::NAMESPACE_EXPORT_PART_INDEX);
                *wrapper_part_index = crate::Index::part(part_index);
                if wrapper_ref.is_valid() && self.options.output_format != Format::InternalBakeDev {
                    self.graph
                        .generate_symbol_import_and_use(
                            source_index,
                            part_index,
                            self.esm_runtime_ref,
                            1,
                            crate::Index::RUNTIME,
                        )
                        .expect("OOM");

                    // Only mark __promiseAll as used if we have multiple async dependencies
                    if needs_promise_all {
                        self.graph
                            .generate_symbol_import_and_use(
                                source_index,
                                part_index,
                                self.promise_all_runtime_ref,
                                1,
                                crate::Index::RUNTIME,
                            )
                            .expect("OOM");
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
        let named_import: &NamedImport =
            match self.graph.ast.items_named_imports()[id as usize].get(&tracker.import_ref) {
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
        if record.flags.contains(bun_ast::ImportRecordFlags::IS_UNUSED) {
            return ImportTrackerIterator {
                value: Default::default(),
                status: ImportTrackerStatus::External,
                ..Default::default()
            };
        }

        // Is this a disabled file?
        let other_source_index = record.source_index.get();
        let other_id = other_source_index;

        if other_id as usize > self.graph.ast.len()
            || self.parse_graph().input_files.items_source()[other_source_index as usize]
                .path
                .is_disabled
        {
            return ImportTrackerIterator {
                value: ImportTracker {
                    source_index: record.source_index,
                    ..Default::default()
                },
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
            && named_import.alias.map(|a| a.slice() != b"default").unwrap_or(true)
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
                    import_data: bun_ptr::BackRef::new(
                        matching_export
                            .potentially_ambiguous_export_star_refs
                            .slice(),
                    ),
                };
            }
        }

        // Match this import up with an export from the imported file
        if let Some(matching_export) = self.graph.meta.items_resolved_exports()[other_id as usize]
            .get(
                named_import
                    .alias
                    .expect("infallible: alias present")
                    .slice(),
            )
        {
            // Check to see if this is a re-export of another import
            return ImportTrackerIterator {
                value: ImportTracker {
                    source_index: matching_export.data.source_index,
                    import_ref: matching_export.data.import_ref,
                    name_loc: matching_export.data.name_loc,
                },
                status: ImportTrackerStatus::Found,
                import_data: bun_ptr::BackRef::new(
                    matching_export
                        .potentially_ambiguous_export_star_refs
                        .slice(),
                ),
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
        let other_loader = self.parse_graph().input_files.items_loader()[other_id as usize];
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
                    result = MatchImport {
                        kind: MatchImportKind::Cycle,
                        ..Default::default()
                    };
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
            // `advanced.import_data` borrows
            // `graph.meta[..].resolved_exports[..].potentially_ambiguous_export_star_refs`;
            // that storage is never reallocated while this loop runs (only
            // `cycle_detector`, `log`, and `graph.symbols` are mutated below).
            let potentially_ambiguous_export_star_refs: &[crate::ImportData] =
                advanced.import_data.get();

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
                    let named_import: &NamedImport = self.graph.ast.items_named_imports()
                        [prev_source_index as usize]
                        .get(&tracker.import_ref)
                        .unwrap();

                    if named_import.namespace_ref.is_some()
                        && named_import
                            .namespace_ref
                            .expect("infallible: checked is_some")
                            .is_valid()
                    {
                        if result.kind == MatchImportKind::Normal {
                            result.kind = MatchImportKind::NormalAndNamespace;
                            result.namespace_ref = named_import
                                .namespace_ref
                                .expect("infallible: checked is_some");
                            result.alias = named_import.alias.expect("infallible: alias present");
                        } else {
                            result = MatchImport {
                                kind: MatchImportKind::Namespace,
                                namespace_ref: named_import
                                    .namespace_ref
                                    .expect("infallible: checked is_some"),
                                alias: named_import.alias.expect("infallible: alias present"),
                                ..Default::default()
                            };
                        }
                    }

                    // Warn about importing from a file that is known to not have any exports
                    if status == ImportTrackerStatus::CjsWithoutExports {
                        let source = self.get_source(tracker.source_index.get());
                        // SAFETY: `alias` is an arena `*const [u8]` valid for the link pass.
                        let alias = named_import
                            .alias
                            .expect("infallible: alias present")
                            .slice();
                        // Split-borrow with `named_import` (`&self.graph`) —
                        // `log_disjoint` returns the disjoint `Transpiler.log` backref.
                        self.log_disjoint().add_range_warning_fmt(
                            Some(source),
                            source.range_of_identifier(named_import.alias_loc.expect("infallible: alias present")),
                            format_args!(
                                "Import \"{}\" will always be undefined because the file \"{}\" has no exports",
                                bstr::BStr::new(alias),
                                bstr::BStr::new(&source.path.pretty),
                            ),
                        );
                    }
                }

                ImportTrackerStatus::DynamicFallbackInteropDefault => {
                    // if the file was rewritten from CommonJS into ESM
                    // and the developer imported an export that doesn't exist
                    // We don't do a runtime error since that CJS would have returned undefined.
                    let named_import: &NamedImport = self.graph.ast.items_named_imports()
                        [prev_source_index as usize]
                        .get(&tracker.import_ref)
                        .unwrap();

                    if named_import.namespace_ref.is_some()
                        && named_import
                            .namespace_ref
                            .expect("infallible: checked is_some")
                            .is_valid()
                    {
                        // `named_import` borrows `graph.ast`; the symbol slot is a
                        // disjoint allocation, so no aliasing with this `&mut`.
                        let symbol = unsafe { self.graph.symbol_mut(tracker.import_ref) };
                        symbol.import_item_status = ImportItemStatus::Missing;
                        result.kind = MatchImportKind::NormalAndNamespace;
                        result.namespace_ref = tracker.import_ref;
                        result.alias = named_import.alias.expect("infallible: alias present");
                        result.name_loc = named_import.alias_loc.unwrap_or(Loc::EMPTY);
                    }
                }

                ImportTrackerStatus::DynamicFallback => {
                    // If it's a file with dynamic export fallback, rewrite the import to a property access
                    let named_import: &NamedImport = self.graph.ast.items_named_imports()
                        [prev_source_index as usize]
                        .get(&tracker.import_ref)
                        .unwrap();
                    if named_import.namespace_ref.is_some()
                        && named_import
                            .namespace_ref
                            .expect("infallible: checked is_some")
                            .is_valid()
                    {
                        if result.kind == MatchImportKind::Normal {
                            result.kind = MatchImportKind::NormalAndNamespace;
                            result.namespace_ref = next_tracker.import_ref;
                            result.alias = named_import.alias.expect("infallible: alias present");
                        } else {
                            result = MatchImport {
                                kind: MatchImportKind::Namespace,
                                namespace_ref: next_tracker.import_ref,
                                alias: named_import.alias.expect("infallible: alias present"),
                                ..Default::default()
                            };
                        }
                    }
                }
                ImportTrackerStatus::NoMatch => {
                    // Report mismatched imports and exports
                    // The mutated symbol slot is disjoint from the later borrows
                    // (`named_import` from graph.ast, `get_source` from parse_graph,
                    // `log_disjoint`) — all separate allocations.
                    let symbol = unsafe { self.graph.symbol_mut(tracker.import_ref) };
                    let named_import: &NamedImport = self.graph.ast.items_named_imports()
                        [prev_source_index as usize]
                        .get(&tracker.import_ref)
                        .unwrap();
                    let source = self.get_source(prev_source_index);

                    let next_source = self.get_source(next_tracker.source_index.get());
                    let r = source.range_of_identifier(
                        named_import.alias_loc.expect("infallible: alias present"),
                    );
                    // SAFETY: arena `*const [u8]` valid for the link pass.
                    let alias = named_import
                        .alias
                        .expect("infallible: alias present")
                        .slice();

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

                        if self.resolver().opts.target == Target::Browser
                            && bun_resolve_builtins::Alias::has(
                                &next_source.path.pretty,
                                Target::Bun,
                                bun_resolve_builtins::Cfg::default(),
                            )
                        {
                            self.log_disjoint().add_range_warning_fmt_with_note(
                                Some(source), r,
                                format_args!(
                                    "Browser polyfill for module \"{}\" doesn't have a matching export named \"{}\"",
                                    bstr::BStr::new(&next_source.path.pretty),
                                    bstr::BStr::new(alias),
                                ),
                                format_args!("Bun's bundler defaults to browser builds instead of node or bun builds. If you want to use node or bun builds, you can set the target to \"node\" or \"bun\" in the transpiler options."),
                                r,
                            );
                        } else {
                            self.log_disjoint().add_range_warning_fmt(
                                Some(source), r,
                                format_args!(
                                    "Import \"{}\" will always be undefined because there is no matching export in \"{}\"",
                                    bstr::BStr::new(alias),
                                    bstr::BStr::new(&next_source.path.pretty),
                                ),
                            );
                        }
                    } else if self.resolver().opts.target == Target::Browser
                        && next_source
                            .path
                            .text
                            .starts_with(NodeFallbackModules::IMPORT_PATH)
                    {
                        self.log_disjoint().add_range_error_fmt_with_note(
                            Some(source), r,
                            format_args!(
                                "Browser polyfill for module \"{}\" doesn't have a matching export named \"{}\"",
                                bstr::BStr::new(&next_source.path.pretty),
                                bstr::BStr::new(alias),
                            ),
                            format_args!("Bun's bundler defaults to browser builds instead of node or bun builds. If you want to use node or bun builds, you can set the target to \"node\" or \"bun\" in the transpiler options."),
                            r,
                        );
                    } else {
                        self.log_disjoint().add_range_error_fmt(
                            Some(source),
                            r,
                            format_args!(
                                "No matching export in \"{}\" for import \"{}\"",
                                bstr::BStr::new(&next_source.path.pretty),
                                bstr::BStr::new(alias),
                            ),
                        );
                    }
                }
                ImportTrackerStatus::ProbablyTypescriptType => {
                    // Omit this import from any namespace export code we generate for
                    // import star statements (i.e. "import * as ns from 'path'")
                    result = MatchImport {
                        kind: MatchImportKind::ProbablyTypescriptType,
                        ..Default::default()
                    };
                }
                ImportTrackerStatus::Found => {
                    // If there are multiple ambiguous results due to use of "export * from"
                    // statements, trace them all to see if they point to different things.
                    for ambiguous_tracker in potentially_ambiguous_export_star_refs.iter() {
                        // If this is a re-export of another import, follow the import
                        if self.graph.ast.items_named_imports()
                            [ambiguous_tracker.data.source_index.get() as usize]
                            .contains(&ambiguous_tracker.data.import_ref)
                        {
                            let ambig =
                                self.match_import_with_export(ambiguous_tracker.data, re_exports);
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
                        let deps =
                            self.top_level_symbols_to_parts(prev_source_index, tracker.import_ref);
                        re_exports.reserve(deps.len());
                        for &dep in deps {
                            re_exports.push(Dependency {
                                part_index: dep,
                                source_index: bun_ast::Index::init(tracker.source_index.get()),
                            });
                            // PERF(port): was assume_capacity
                        }
                    }

                    // If this is a re-export of another import, continue for another
                    // iteration of the loop to resolve that import as well
                    let next_id = next_tracker.source_index.get();
                    if self.graph.ast.items_named_imports()[next_id as usize]
                        .contains(&next_tracker.import_ref)
                    {
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

                return MatchImport {
                    kind: MatchImportKind::Ambiguous,
                    ..Default::default()
                };
            }
        }

        result
    }

    /// Spec: `LinkerContext.zig:2471 matchImportsWithExportsForFile`.
    pub fn match_imports_with_exports_for_file(
        &mut self,
        named_imports_ptr: *const crate::bundled_ast::NamedImports,
        imports_to_bind: &mut crate::RefImportData,
        source_index: crate::IndexInt,
    ) {
        // PORT NOTE: Zig clones into a local, sorts, iterates, then writes back.
        // `ArrayHashMap` has no in-place key sort and `NamedImport` is non-Clone
        // (owns a `Vec`), so we sort an index vector over the live
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
        order
            .sort_by(|&a, &b| unsafe { (&*keys)[a].inner_index().cmp(&(&*keys)[b].inner_index()) });

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
                    imports_to_bind
                        .put(
                            import_ref,
                            crate::ImportData {
                                re_exports: Vec::<Dependency>::move_from_list(re_exports),
                                data: ImportTracker {
                                    source_index: crate::Index::init(result.source_index),
                                    import_ref: result.r#ref,
                                    ..Default::default()
                                },
                            },
                        )
                        .expect("unreachable");
                }
                MatchImportKind::Namespace => {
                    unsafe { self.graph.symbol_mut(import_ref) }.namespace_alias =
                        Some(G::NamespaceAlias {
                            namespace_ref: result.namespace_ref,
                            alias: result.alias,
                            ..Default::default()
                        });
                }
                MatchImportKind::NormalAndNamespace => {
                    imports_to_bind
                        .put(
                            import_ref,
                            crate::ImportData {
                                re_exports: Vec::<Dependency>::move_from_list(re_exports),
                                data: ImportTracker {
                                    source_index: crate::Index::init(result.source_index),
                                    import_ref: result.r#ref,
                                    ..Default::default()
                                },
                            },
                        )
                        .expect("unreachable");

                    // One-shot field store after `imports_to_bind.put` (disjoint
                    // map) has fully returned.
                    unsafe { self.graph.symbol_mut(import_ref) }.namespace_alias =
                        Some(G::NamespaceAlias {
                            namespace_ref: result.namespace_ref,
                            alias: result.alias,
                            ..Default::default()
                        });
                }
                MatchImportKind::Cycle => {
                    let source = self.get_source(source_index);
                    let r = lex::range_of_identifier(
                        source,
                        named_import.alias_loc.unwrap_or(Loc::default()),
                    );
                    // SAFETY: arena `*const [u8]` valid for the link pass.
                    let alias = named_import
                        .alias
                        .expect("infallible: alias present")
                        .slice();
                    // Split-borrow with `named_import` — `log_disjoint` returns
                    // the disjoint `Transpiler.log` backref.
                    self.log_disjoint().add_range_error_fmt(
                        Some(source),
                        r,
                        format_args!(
                            "Detected cycle while resolving import \"{}\"",
                            bstr::BStr::new(alias),
                        ),
                    );
                }
                MatchImportKind::ProbablyTypescriptType => {
                    self.graph.meta.items_probably_typescript_type_mut()[source_index as usize]
                        .put(import_ref, ())
                        .expect("unreachable");
                }
                MatchImportKind::Ambiguous => {
                    let source = self.get_source(source_index);
                    let r = lex::range_of_identifier(
                        source,
                        named_import.alias_loc.unwrap_or(Loc::default()),
                    );

                    // TODO: log locations of the ambiguous exports

                    // The mutated symbol slot is disjoint from `source`/`r`
                    // (parse_graph), `named_import`/`alias` (arena slices), and
                    // `log_disjoint` — all separate allocations.
                    let symbol = unsafe { self.graph.symbol_mut(import_ref) };
                    // SAFETY: arena `*const [u8]` valid for the link pass.
                    let alias = named_import
                        .alias
                        .expect("infallible: alias present")
                        .slice();
                    if symbol.import_item_status == ImportItemStatus::Generated {
                        symbol.import_item_status = ImportItemStatus::Missing;
                        self.log_disjoint().add_range_warning_fmt(
                            Some(source), r,
                            format_args!(
                                "Import \"{}\" will always be undefined because there are multiple matching exports",
                                bstr::BStr::new(alias),
                            ),
                        );
                    } else {
                        self.log_disjoint().add_range_error_fmt(
                            Some(source),
                            r,
                            format_args!(
                                "Ambiguous import \"{}\" has multiple matching exports",
                                bstr::BStr::new(alias),
                            ),
                        );
                    }
                }
                MatchImportKind::Ignore => {}
            }
        }
    }

    /// Spec: `linker_context/generateCodeForLazyExport.zig`.
    ///
    /// Thin inherent-method shim so callers can write
    /// `this.generate_code_for_lazy_export(id)` (matches Zig's
    /// `pub const generateCodeForLazyExport = @import(...)`). The full body —
    /// including the CSS-modules `composes`/`local_scope` Visitor — lives in
    /// `linker_context/generateCodeForLazyExport.rs`.
    #[inline]
    pub fn generate_code_for_lazy_export(
        &mut self,
        source_index: crate::IndexInt,
    ) -> Result<(), AllocError> {
        crate::linker_context::generate_code_for_lazy_export::generate_code_for_lazy_export(
            self,
            source_index,
        )
    }

    /// Spec: `LinkerContext.zig:503 generateNamedExportInFile`.
    pub fn generate_named_export_in_file(
        &mut self,
        source_index: crate::IndexInt,
        module_ref: Ref,
        name: &[u8],
        alias: &[u8],
    ) -> Result<(Ref, u32), AllocError> {
        let r#ref =
            self.graph
                .generate_new_symbol(source_index, bun_ast::symbol::Kind::Other, name);
        let part_index = self.graph.add_part_to_file(
            source_index,
            Part {
                declared_symbols: DeclaredSymbolList::from_slice(&[DeclaredSymbol {
                    ref_: r#ref,
                    is_top_level: true,
                }])?,
                can_be_removed_if_unused: true,
                ..Default::default()
            },
        )?;

        self.graph.generate_symbol_import_and_use(
            source_index,
            part_index,
            module_ref,
            1,
            crate::Index::init(source_index),
        )?;
        let top_level = &mut self
            .graph
            .meta
            .items_top_level_symbol_to_parts_overlay_mut()[source_index as usize];
        top_level.put(r#ref, Vec::<u32>::from_slice(&[part_index]))?;

        let resolved_exports =
            &mut self.graph.meta.items_resolved_exports_mut()[source_index as usize];
        resolved_exports.put(
            alias,
            crate::ExportData {
                data: ImportTracker {
                    source_index: crate::Index::init(source_index),
                    import_ref: r#ref,
                    ..Default::default()
                },
                ..Default::default()
            },
        )?;
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
        // PORT NOTE: Zig used `j.done(alloc)` (worker arena), so the joined
        // buffer outlived this function. The Rust `StringJoiner::done()`
        // returns a `Box<[u8]>`; we must keep it alive alongside the pieces
        // (each `OutputPiece` stores a raw `*const u8` into it). It is moved
        // into the returned `OutputPieces` below.
        let complete_output: Box<[u8]> = j.done()?;
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

            let Some(kind) = crate::chunk::QueryKind::from_letter(output[start]) else {
                if cfg!(debug_assertions) {
                    Output::debug_warn(format_args!("Invalid output piece boundary"));
                }
                break;
            };

            let mut index: usize = 0;
            // SAFETY: bounds checked above (start + 9 <= output.len())
            let digits: [u8; 8] = output[start + 1..start + 9]
                .try_into()
                .expect("infallible: size matches");
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
                    if index >= self.parse_graph().html_imports.server_source_indices.len() as usize
                    {
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
                crate::chunk::Query::new(u32::try_from(index).expect("int cast"), kind),
            ));
            output = &output[boundary + prefix.len() + 9..];
        }

        pieces.push(OutputPiece::init(output, crate::chunk::Query::NONE));

        Ok(crate::chunk::IntermediateOutput::Pieces(
            crate::chunk::OutputPieces::new(pieces, complete_output),
        ))
    }
}

// PartialEq for MatchImport (needed for std.meta.eql in match_import_with_export)
impl PartialEq for MatchImport {
    fn eq(&self, other: &Self) -> bool {
        // PORT NOTE: Zig `std.meta.eql` on a slice compares ptr+len, not contents —
        // compare the raw fat pointer (address + length metadata).
        std::ptr::eq(self.alias.as_raw(), other.alias.as_raw())
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
    // TODO(port): arena field dropped — Vec uses global mimalloc; bundler is AST crate but
    // these are temporary scratch buffers, not arena-backed in the original (uses generic arena param)
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
        Self {
            stmts: Vec::new(),
            sync_dependencies_end: 0,
            has_async_dependency: false,
        }
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
            Stmt::alloc(
                S::SExpr {
                    value: call_expr,
                    ..Default::default()
                },
                call_expr.loc,
            ),
        );
        self.sync_dependencies_end += 1;
        Ok(())
    }

    pub fn append_async_dependency(
        &mut self,
        call_expr: Expr,
        promise_all_ref: Ref,
    ) -> Result<(), AllocError> {
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
            .data
            .s_expr_mut()
            .unwrap()
            .value
            .data
            .e_await_mut()
            .expect("infallible: variant checked")
            .value;
        let call = first_dep_call_expr
            .data
            .e_call_mut()
            .expect("infallible: variant checked");

        if call
            .target
            .data
            .e_identifier()
            .expect("infallible: variant checked")
            .ref_
            .eql(promise_all_ref)
        {
            // `await __promiseAll` already in place, append to the array argument
            call.args
                .mut_(0)
                .data
                .e_array_mut()
                .expect("infallible: variant checked")
                .items
                .push(call_expr);
        } else {
            // convert single `await init_` to `await __promiseAll([init_1(), init_2()])`

            let promise_all = Expr::init(
                E::Identifier {
                    ref_: promise_all_ref,
                    ..Default::default()
                },
                Loc::EMPTY,
            );

            let mut items = bun_ast::ExprNodeList::init_capacity(2);
            items.append_slice_assume_capacity(&[first_dep_call_expr, call_expr]);
            // PERF(port): was assume_capacity

            let mut args = bun_ast::ExprNodeList::init_capacity(1);
            args.append_assume_capacity(Expr::init(
                E::Array {
                    items,
                    ..Default::default()
                },
                Loc::EMPTY,
            ));
            // PERF(port): was assume_capacity

            let promise_all_call = Expr::init(
                E::Call {
                    target: promise_all,
                    args,
                    ..Default::default()
                },
                Loc::EMPTY,
            );

            // replace the `await init_` expr with `await __promiseAll`
            self.stmts[self.sync_dependencies_end] = Stmt::alloc(
                S::SExpr {
                    value: Expr::init(
                        E::Await {
                            value: promise_all_call,
                        },
                        Loc::EMPTY,
                    ),
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

    pub fn append_slice(&mut self, list: StmtListWhich, stmts: &[Stmt]) {
        match list {
            StmtListWhich::OutsideWrapperPrefix => {
                self.outside_wrapper_prefix.extend_from_slice(stmts)
            }
            StmtListWhich::InsideWrapperSuffix => {
                self.inside_wrapper_suffix.extend_from_slice(stmts)
            }
            StmtListWhich::AllStmts => self.all_stmts.extend_from_slice(stmts),
        }
    }

    pub fn append(&mut self, list: StmtListWhich, stmt: Stmt) {
        match list {
            StmtListWhich::OutsideWrapperPrefix => self.outside_wrapper_prefix.push(stmt),
            StmtListWhich::InsideWrapperSuffix => self.inside_wrapper_suffix.push(stmt),
            StmtListWhich::AllStmts => self.all_stmts.push(stmt),
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum StmtListWhich {
    OutsideWrapperPrefix,
    InsideWrapperSuffix,
    AllStmts,
}

// ported from: src/bundler/LinkerContext.zig
