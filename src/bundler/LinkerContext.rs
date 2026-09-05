use crate::mal_prelude::*;
use core::sync::atomic::{AtomicU32, Ordering};

use crate::Error as BunError;
use bun_alloc::{AllocError, Arena as Bump};
use bun_ast::{Data, Loc, Log, Range, Source};
use bun_collections::{ArrayHashMap, AutoBitSet, HashMap, MultiArrayList, VecExt, index_sort};
use bun_core::{self as bun, FeatureFlags, Output};
use bun_core::{MutableString, string_joiner::StringJoiner, strings};
use bun_sourcemap::{
    self as SourceMap, DebugIDFormatter, LineOffsetTable, SourceMapPieces, SourceMapState,
};
// Note: alias the *module* (not the `ThreadPool` struct) so
// `ThreadPoolLib::Task` / `ThreadPoolLib::Batch` resolve as nested items.
use crate::bake_types as bake;
use bun_ast::{ImportKind, ImportRecord};
use bun_threading::{WaitGroup, thread_pool as ThreadPoolLib};

use crate::BundledAst as JSAst;
use bun_ast::{
    Binding, DeclaredSymbol, Dependency, ExportsKind, Expr, NamedImport, Part, Ref, Stmt, TlaCheck,
};
// Note: `crate::Index` (= `bun_ast::Index`) — the
// bundler's source-index newtype. `bun_ast::Index` is layout-identical
// but a distinct type; LinkerGraph/JSMeta/etc. are typed against the crate
// re-export, so use that here.
use crate::Index;
use bun_ast::{E, G, S};
use bun_js_parser::lexer as lex;
use bun_js_printer::{self as js_printer, renamer};

use crate::bun_node_fallbacks as NodeFallbackModules;
use bun_ast::SideEffects;
use bun_resolver::Resolver;

use crate::Graph::Graph;
use crate::options::{CompileMode, Format, Loader, SourceMapOption, Target};
use crate::{
    AdditionalFile, BundleV2, Chunk, CompileResultForSourceMap, ContentHasher, ImportTracker,
    LinkerGraph, MangledProps, PartRange, StableRef, WrapKind,
};

/// `bun_event_loop` is a
/// lower-tier crate, so the bundler can name the real enum (the `Js` arm
/// holds an erased `*mut jsc::EventLoop` driven through a vtable). Stored as
/// a pointer because the linker borrows the loop owned by the
/// `BundleThread` / runtime.
pub type EventLoop = Option<core::ptr::NonNull<bun_event_loop::AnyEventLoop>>;

bun_core::declare_scope!(LinkerCtx, visible);
bun_core::declare_scope!(TreeShake, hidden);

// Scoped-log wrappers; re-exported so `linker_context/*` submodules import directly.
bun_core::define_scoped_log!(debug, crate::linker_context_mod::LinkerCtx);
pub(crate) use debug;
bun_core::define_scoped_log!(debug_tree_shake, crate::linker_context_mod::TreeShake);

// Re-exports from sibling modules in `linker_context/`.
// Module declarations live in `lib.rs::linker_context`.
pub(crate) use crate::linker_context::scan_imports_and_exports::scan_imports_and_exports;

pub(crate) use crate::linker_context::compute_chunks::compute_chunks;
// do_step5 / create_exports_for_file are inherent methods on LinkerContext (see
// `linker_context/doStep5.rs`), not free functions — no item re-export.
pub(crate) use crate::linker_context::compute_cross_chunk_dependencies::compute_cross_chunk_dependencies;
pub(crate) use crate::linker_context::generate_chunks_in_parallel::generate_chunks_in_parallel;
pub(crate) use crate::linker_context::post_process_css_chunk::post_process_css_chunk;
pub(crate) use crate::linker_context::post_process_html_chunk::post_process_html_chunk;
pub(crate) use crate::linker_context::post_process_js_chunk::post_process_js_chunk;
pub(crate) use crate::linker_context::rename_symbols_in_chunk::rename_symbols_in_chunk;

pub struct LinkerContext<'a> {
    pub(crate) parse_graph: *mut Graph<'a>,
    pub graph: LinkerGraph<'a>,
    /// Backref into `Transpiler.log`, assigned in [`Self::load`]. Stored as a
    /// raw pointer (like `parse_graph` / `resolver`) so `Default` can be
    /// `null_mut()` instead of a dangling `&mut` (instant UB). Use
    /// [`Self::log`] / [`Self::log_mut`]; deref the field directly only for
    /// split-borrow patterns that hold other `self` borrows across the access.
    pub(crate) log: *mut Log,

    /// Backref into `BundleV2.transpiler.resolver` (LIFETIMES.tsv:
    /// GRAPHBACKED). `ParentRef` (not `*mut`) so the accessor and the
    /// split-borrow sites in `linker_context/*.rs` deref it via safe `Deref`
    /// instead of open-coding a raw deref. `Option` because `Default` precedes
    /// [`Self::load`]. Read-only — never `assume_mut`.
    pub(crate) resolver: Option<bun_ptr::ParentRef<Resolver<'a>>>,
    pub(crate) cycle_detector: Vec<ImportTracker>,

    /// We may need to refer to the "__esm" and/or "__commonJS" runtime symbols
    pub(crate) cjs_runtime_ref: Ref,
    pub(crate) esm_runtime_ref: Ref,

    /// We may need to refer to the CommonJS "module" symbol for exports
    pub(crate) unbound_module_ref: Ref,

    /// We may need to refer to the "__promiseAll" runtime symbol
    pub(crate) promise_all_runtime_ref: Ref,
    /// `__preload` / `__chunks`: modulepreload for split browser `import()`s.
    pub(crate) preload_runtime_ref: Ref,
    pub(crate) chunks_runtime_ref: Ref,

    pub(crate) options: LinkerOptions,

    pub(crate) r#loop: EventLoop,

    /// string buffer containing pre-formatted unique keys
    pub(crate) unique_key_buf: Box<[u8]>,

    /// string buffer containing prefix for each unique keys
    pub(crate) unique_key_prefix: Box<[u8]>,

    pub source_maps: SourceMapData,

    /// This will eventually be used for reference-counting LinkerContext
    /// to know whether or not we can free it safely.
    pub(crate) pending_task_count: AtomicU32,

    pub(crate) has_any_css_locals: AtomicU32,

    /// Used by Bake to extract []CompileResult before it is joined.
    /// CYCLEBREAK GENUINE: erased bake::DevServer (see bundle_v2::dispatch).
    pub dev_server: Option<crate::dispatch::DevServerHandle>,
    pub(crate) framework: Option<bun_ptr::BackRef<bake::Framework>>,

    pub(crate) mangled_props: MangledProps,

    /// One name per binding that crosses a chunk boundary, shared by the
    /// chunk that exports it and every chunk that imports it
    /// (`assign_cross_chunk_names`). Values live in the linker arena.
    pub(crate) cross_chunk_names: bun_collections::HashMap<bun_ast::Ref, &'static [u8]>,

    /// User entry points (by source index) that reach a split browser `import()`: their chunk registers the chunk graph.
    pub(crate) preload_entries: AutoBitSet,
    /// Files whose only top-level effect, `init_x()` / `require_x()` calls,
    /// `merge_small_chunks` proved to be no-ops where it moved them: a chunk
    /// their chunk imports makes the same calls first.
    pub(crate) inits_already_done: Option<AutoBitSet>,
    /// The part `scan_imports_and_exports` adds to each entry point file (`u32::MAX` elsewhere).
    pub(crate) entry_point_part_indices: Vec<u32>,
}

// SAFETY: `LinkerContext` is shared across the worker pool via `each_ptr` /
// `SourceMapDataTask`. The raw-pointer fields (`parse_graph`, `resolver`,
// `r#loop`, `framework`) are backrefs into `BundleV2`/`Transpiler` whose
// lifetimes strictly outlive every parallel section, and per-thread writes go
// to disjoint SoA slots (see `compute_line_offsets`).
unsafe impl<'a> Send for LinkerContext<'a> {}
// SAFETY: see the `Send` impl above — same backref-lifetime / disjoint-write invariants.
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
            preload_runtime_ref: Ref::NONE,
            chunks_runtime_ref: Ref::NONE,
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
            cross_chunk_names: Default::default(),
            preload_entries: AutoBitSet::init_empty(0).expect("static AutoBitSet"),
            inits_already_done: None,
            entry_point_part_indices: Vec::new(),
        }
    }
}

impl<'a> LinkerContext<'a> {
    /// container_of: `*LinkerContext` → `*BundleV2` via the embedded `.linker`
    /// field. Returns raw; caller
    /// decides `&*` vs `&mut *` per local aliasing rules (several callers run
    /// on worker-pool threads and MUST NOT materialize `&mut BundleV2`).
    ///
    /// SAFETY: `linker` must point to the `.linker` field of a live `BundleV2`
    /// and carry provenance over the full `BundleV2` allocation.
    #[inline(always)]
    pub(crate) unsafe fn bundle_v2_ptr(linker: *mut Self) -> *mut BundleV2<'a> {
        bun_core::from_field_ptr!(BundleV2, linker, linker)
    }

    /// Read-only container-of for callers holding a `*const Self`.
    ///
    /// # Safety
    /// Same contract as [`Self::bundle_v2_ptr`].
    #[inline]
    pub(crate) unsafe fn bundle_v2_const_ptr(linker: *const Self) -> *const BundleV2<'a> {
        // SAFETY: address computation only; constness restored on return.
        unsafe { Self::bundle_v2_ptr(linker.cast_mut()).cast_const() }
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
    pub(crate) fn parse_graph(&self) -> &Graph<'_> {
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
    pub(crate) fn parse_graph_mut(&mut self) -> &mut Graph<'a> {
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
    pub(crate) fn resolver(&self) -> &Resolver<'a> {
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
    pub(crate) fn any_loop_mut(&self) -> Option<&mut bun_event_loop::AnyEventLoop> {
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
    pub(crate) fn log(&self) -> &Log {
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
    pub(crate) fn log_mut(&mut self) -> &mut Log {
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
    pub(crate) fn worker_pool(&self) -> &bun_threading::ThreadPool {
        self.parse_graph().pool().worker_pool()
    }

    pub(crate) fn mark_pending_task_done(&self) {
        self.pending_task_count.fetch_sub(1, Ordering::Relaxed);
    }

    /// Split browser ESM builds preload each `import()`ed chunk's static imports.
    pub(crate) fn module_preload(&self) -> bool {
        self.options.module_preload
            && self.graph.code_splitting
            && self.options.target == Target::Browser
            && self.options.output_format == Format::Esm
            && self.chunks_runtime_ref.is_valid()
    }

    /// An `import()` — or a split `require()` — whose target is a
    /// chunk entry point: the record is resolved at runtime against the
    /// target's chunk instead of binding to a wrapper.
    pub(crate) fn is_external_dynamic_import(
        &self,
        record: &ImportRecord,
        source_index: u32,
    ) -> bool {
        use crate::linker_graph::FileColumns as _;
        if !self.graph.code_splitting || record.source_index.get() == source_index {
            return false;
        }
        let crosses_chunk = match record.kind {
            ImportKind::Dynamic => true,
            ImportKind::Require => record
                .flags
                .contains(bun_ast::ImportRecordFlags::CROSS_CHUNK_REQUIRE),
            _ => false,
        };
        crosses_chunk
            && self.graph.files.items_entry_point_kind()[record.source_index.get() as usize]
                .is_entry_point()
    }

    /// The bundled file a live part's import record makes the importer's
    /// chunk load, if any: not a split `import()` / `require()`, which loads
    /// on demand, and not an `import` or `export ... from` of a side-effect-free
    /// file, which prints nothing (the bindings used from it are part
    /// dependencies). Chunk assignment follows these edges, so everything that
    /// reasons about which chunks load together must too.
    pub(crate) fn file_loaded_by_import(
        &self,
        record: &ImportRecord,
        source_index: u32,
    ) -> Option<u32> {
        if !record.source_index.is_valid() || self.is_external_dynamic_import(record, source_index)
        {
            return None;
        }
        let other = record.source_index.get();
        if record.kind == ImportKind::Stmt && self.file_has_no_side_effects(other) {
            return None;
        }
        Some(other)
    }

    /// `"sideEffects": false` (or the resolver's equivalent), unless
    /// `--ignore-dce-annotations` says not to trust it.
    pub(crate) fn file_has_no_side_effects(&self, source_index: u32) -> bool {
        self.parse_graph().input_files.items_side_effects()[source_index as usize]
            != SideEffects::HasSideEffects
            && !self.options.ignore_dce_annotations
    }

    /// Note: this should call a `MimallocArena` debug hook
    /// (`helpCatchMemoryIssues`), but `Graph.heap` is currently
    /// `bun_alloc::Arena = bumpalo::Bump`, which has no such hook, so this is a
    /// no-op until the arena type is swapped to the real `MimallocArena`. The
    /// call sites are already gated on `FeatureFlags::HELP_CATCH_MEMORY_ISSUES`.
    #[inline]
    pub(crate) fn check_for_memory_corruption(&self) {
        // For this to work, you need mimalloc's debug build enabled.
        //    make mimalloc-debug
        // Becomes `unsafe { (*self.parse_graph).heap.help_catch_memory_issues() }`
        // if `Graph.heap` ever grows the `MimallocArena` debug hook (see the
        // doc comment above).
    }
}

// Local re-exports for the tree-shaking impl below. `EntryPoint::Kind`
// and `SideEffects` live in sibling modules. Re-export so `EntryPoint::Kind` here is the
// *same type* `items_entry_point_kind()` returns.
#[allow(non_snake_case)]
pub mod EntryPoint {
    pub(crate) use crate::entry_point::Kind;
}
use crate::bundled_ast::Flags as AstFlags;
use crate::generic_path_with_pretty_initialized;
type DeclaredSymbolList = bun_ast::DeclaredSymbolList;

impl<'a> LinkerContext<'a> {
    pub(crate) fn arena(&self) -> &Bump {
        // LinkerGraph owns (a backref to) the bundle arena; see `LinkerGraph::arena`.
        self.graph.arena()
    }

    /// `arena` must be the arena owned by the thread making this call — on
    /// worker threads (chunk post-processing) that is `worker.arena()`, NOT
    /// `self.arena()` (the bundle-thread graph arena). `generic_path_with_pretty_initialized`
    /// allocates the duped display path from it, and `MimallocArena` asserts
    /// single-thread ownership, so passing the wrong arena is a cross-thread
    /// allocation (debug panic / release heap corruption).
    pub(crate) fn path_with_pretty_initialized(
        &mut self,
        path: &bun_paths::fs::Path<'static>,
        arena: &Bump,
    ) -> Result<bun_paths::fs::Path<'static>, BunError> {
        let top_level_dir = bun_resolver::fs::FileSystem::get().top_level_dir;
        generic_path_with_pretty_initialized(path, self.options.target, top_level_dir, arena)
    }

    pub(crate) fn should_include_part(&self, source_index: crate::IndexInt, part: &Part) -> bool {
        // As an optimization, ignore parts containing a single import statement to
        // an internal non-wrapped file. These will be ignored anyway and it's a
        // performance hit to include the part only to discover it's unnecessary later.
        let stmts: &[Stmt] = part.stmts.slice();
        if stmts.len() == 1 {
            if let Some(s_import) = stmts[0].data.s_import() {
                let record = &self.graph.ast.items_import_records()[source_index as usize]
                    [s_import.import_record_index as usize];
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
    /// `self.linker.load(self, …)` — `self` *is*
    /// `(*bundle).linker`, so a `&mut BundleV2` here would alias the receiver
    /// under Stacked Borrows. This body only reaches into fields of `*bundle`
    /// that are disjoint from `linker` (`graph`, `transpiler`,
    /// `dynamic_import_entry_points`) via `addr_of_mut!`, never materializing a
    /// full `&mut BundleV2`.
    ///
    /// # Safety
    /// `bundle` must be valid for the call and `self` must be `(*bundle).linker`
    /// (or otherwise not overlap the fields named above).
    pub(crate) unsafe fn load(
        &mut self,
        bundle: *mut BundleV2<'a>,
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
        // `transpiler.log` is the canonical
        // `*mut Log` (same value aliased into `linker.log` / `resolver.log`).
        self.log = transpiler.log;

        // Note: lifetime — `self.resolver` is `ParentRef<Resolver<'a>>`
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
        self.inits_already_done = None;

        // Note: `reachable_files` is `Vec<Index>`; clone the
        // caller-owned slice into the linker arena.
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
        // Browser runtime only (`RUNTIME_PRELOAD_BROWSER`).
        self.preload_runtime_ref = runtime_named_exports
            .get(b"__preload")
            .map_or(Ref::NONE, |export| export.ref_);
        self.chunks_runtime_ref = runtime_named_exports
            .get(b"__chunks")
            .map_or(Ref::NONE, |export| export.ref_);

        if self.options.output_format == Format::Cjs {
            self.unbound_module_ref = self.graph.generate_new_symbol(
                Index::RUNTIME.get(),
                bun_ast::symbol::Kind::Unbound,
                b"module",
            );
        }

        if self.options.output_format == Format::Cjs || self.options.output_format == Format::Iife {
            // Note: reshaped for borrowck — `Slice<T>` is a value-type
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

    pub(crate) fn compute_data_for_source_map(&mut self, reachable: &[Index]) {
        debug_assert!(self.options.source_maps != SourceMapOption::None);
        self.source_maps.line_offset_wait_group = WaitGroup::init_with_count(reachable.len());
        self.source_maps.quoted_contents_wait_group = WaitGroup::init_with_count(reachable.len());
        // Note: `SourceMapDataTask` is not `Clone` (embeds an intrusive
        // `ThreadPoolLib::Task` node); build via iterator instead of `vec![x;n]`.
        self.source_maps.line_offset_tasks = (0..reachable.len())
            .map(|_| SourceMapDataTask::default())
            .collect::<Vec<_>>()
            .into_boxed_slice();
        self.source_maps.quoted_contents_tasks = (0..reachable.len())
            .map(|_| SourceMapDataTask::default())
            .collect::<Vec<_>>()
            .into_boxed_slice();

        // Note: erase `'a` → `'static` for the task backref. The tasks are
        // joined before `self` is dropped (see `SourceMapData.*_wait_group`).
        // Shared provenance: worker tasks only read the context (they never
        // form `&mut LinkerContext`); peer tasks hold the same pointer.
        // SAFETY: `self` outlives every task (joined before drop).
        let ctx: Option<bun_ptr::ParentRef<LinkerContext<'static>>> = Some(unsafe {
            bun_ptr::ParentRef::from_raw(
                std::ptr::from_ref::<LinkerContext<'a>>(self)
                    .cast::<LinkerContext<'static>>()
                    .cast_mut(),
            )
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

    pub(crate) fn schedule_tasks(&self, batch: ThreadPoolLib::Batch) {
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
        // Note: go through raw pointers and reborrow per use to avoid holding
        // overlapping `&`/`&mut` into `parse_graph.html_imports` and
        // `parse_graph.input_files`.
        let parse_graph: *mut Graph<'a> = self.parse_graph;
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

                // S.LazyExport is a call to __jsonParse. Each accessor returns
                // `Option`; `.unwrap()` panics on shape mismatch.
                let original_ref = (*self.graph.ast.items_parts()[html_import as usize][1].stmts)
                    [0]
                .data
                .s_lazy_export()
                .unwrap()
                .e_call()
                .unwrap()
                .target
                .data
                .e_import_identifier()
                .unwrap()
                .ref_;

                // Make the __jsonParse in that file point to the __jsonParse in the runtime chunk.
                // SAFETY: `original_ref`'s symbol slot is disjoint from any live borrow here
                // (only `actual_ref` is held, a `Copy` value).
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

    /// The side of the output file of `chunk`.
    pub(crate) fn chunk_side(&self, chunk: &Chunk) -> crate::options::Side {
        use crate::options::Side;
        if matches!(chunk.content, crate::chunk::Content::Css(_))
            || chunk
                .flags
                .contains(crate::chunk::Flags::IS_BROWSER_CHUNK_FROM_SERVER_BUILD)
        {
            return Side::Client;
        }
        match self.graph.ast.items_target()[chunk.entry_point.source_index() as usize] {
            Target::Browser => Side::Client,
            _ => Side::Server,
        }
    }

    /// The output kind of the output file of `chunk`.
    pub(crate) fn chunk_output_kind(&self, chunk: &Chunk) -> crate::options::OutputKind {
        use crate::options::OutputKind;
        if matches!(chunk.content, crate::chunk::Content::Css(_)) {
            OutputKind::Asset
        } else if chunk.entry_point.is_entry_point() {
            self.graph.files.items_entry_point_kind()[chunk.entry_point.source_index() as usize]
                .output_kind()
        } else {
            OutputKind::Chunk
        }
    }

    /// See [`Self::load`] for why `bundle` is a raw `*mut` (caller passes
    /// `self` while the receiver is `self.linker`; field-disjoint access only).
    ///
    /// # Safety
    /// `bundle` must be valid for the call and `self` must be `(*bundle).linker`.
    #[inline(never)]
    pub(crate) unsafe fn link(
        &mut self,
        bundle: *mut BundleV2<'a>,
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
            // and reborrow once for the loop to satisfy borrowck alongside
            // `&mut self`.
            let parse_graph: *mut Graph<'a> = self.parse_graph;
            let import_records_list: *const [bun_ast::import_record::List<'a>] =
                self.graph.ast.items_import_records();
            let flags: *mut [crate::js_meta::Flags] = self.graph.meta.items_flags_mut();
            let css_asts: *const [crate::bundled_ast::CssCol] = self.graph.ast.items_css();
            let files_len = self.graph.files.len();
            // SAFETY: see block comment above — `parse_graph` backref disjoint
            // from `*self`, stable SoA slabs; `validate_tla` neither
            // reallocates the slabs nor forms a competing `&mut` to any
            // read-only column. All seven derefs share that invariant.
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

                self.validate_tla(
                    source_index,
                    tla_keywords,
                    tla_checks,
                    input_files,
                    flags,
                    import_records_list,
                );

                source_index += 1;
            }

            // after validation propagate async through all importers.
            self.graph.propagate_async_dependencies()?;
        }

        scan_imports_and_exports(self)?;

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

    pub(crate) fn tree_shaking_and_code_splitting(&mut self) -> Result<(), AllocError> {
        let _trace = bun::perf::trace("Bundler.treeShakingAndCodeSplitting");

        // Size the per-file part-liveness bitsets now that `scan_imports_and_exports`
        // has finished pushing wrapper / entry-point parts.
        {
            let loaders = self.parse_graph().input_files.items_loader();
            let parts_col = self.graph.ast.items_parts();
            let mut parts_live: Vec<bun_collections::AutoBitSet> =
                Vec::with_capacity(parts_col.len());
            for (i, parts) in parts_col.iter().enumerate() {
                let mut bits = bun_collections::AutoBitSet::init_empty(parts.len())?;
                // The HTML loader's `ParseTask` builds its synthetic part 1 already
                // live (so the JS-chunk visitor follows every embedded import record).
                // `mark_file_live_for_tree_shaking` short-circuits for HTML and never
                // walks its parts, so seed the bit here to preserve the old
                // `Part::is_live = true` initializer.
                if loaders.get(i).is_some_and(|l| *l == Loader::Html) && parts.len() > 1 {
                    bits.set(1);
                }
                parts_live.push(bits);
            }
            self.graph.parts_live = parts_live;
        }

        // Note: these slices alias into self.graph.
        // The SoA columns are physically disjoint
        // and the underlying slabs don't reallocate during tree-shaking, so we
        // cache raw column base pointers and reborrow once for the
        // worklist-driven passes below.
        let parts: *mut [bun_ast::PartList<'a>] = self.graph.ast.items_parts_mut();
        let parts_live: *mut [bun_collections::AutoBitSet] = self.graph.parts_live.as_mut_slice();
        let import_records: *const [bun_ast::import_record::List<'a>] =
            self.graph.ast.items_import_records();
        let css_reprs: *const [crate::bundled_ast::CssCol] = self.graph.ast.items_css();
        let entry_point_kinds: *const [EntryPoint::Kind] =
            std::ptr::from_ref(self.graph.files.items_entry_point_kind());
        let entry_points: *const [crate::IndexInt] = self.graph.entry_points.items_source_index();
        let distances: *mut [u32] = self.graph.files.items_distance_from_entry_point_mut();
        let file_entry_bits: *mut [AutoBitSet] = self.graph.files.items_entry_bits_mut();
        let loaders: *const [Loader] = self.parse_graph().input_files.items_loader();

        // SAFETY: see block comment above — disjoint SoA columns, stable slabs
        // (no reallocation during tree-shaking). All column derefs share that
        // invariant; reborrowing once here is sound because the
        // worklist-driven `mark_file_*` steps neither reallocate the slabs
        // nor form a competing `&mut` to any read-only column.
        let (
            entry_points,
            import_records,
            entry_point_kinds,
            css_reprs,
            parts,
            parts_live,
            distances,
            file_entry_bits,
            loaders,
        ) = unsafe {
            (
                &*entry_points,
                &*import_records,
                &*entry_point_kinds,
                &*css_reprs,
                &mut *parts,
                &mut *parts_live,
                &mut *distances,
                &mut *file_entry_bits,
                &*loaders,
            )
        };
        let entry_points_len = entry_points.len();

        {
            let _trace2 = bun::perf::trace("Bundler.markFileLiveForTreeShaking");

            let mut ctx = TreeShakeCtx {
                parts,
                parts_live,
                import_records,
                entry_point_kinds,
                css_reprs,
                worklist: Vec::new(),
            };

            // Tree shaking: Each entry point marks all files reachable from itself.
            // `import()` targets are marked live from the live part that holds
            // the `import()` instead (see `mark_part_live_step`).
            let root_dynamic_imports = !self.options.tree_shaking;
            for i in 0..entry_points_len {
                let entry_point = entry_points[i];
                if !root_dynamic_imports
                    && entry_point_kinds[entry_point as usize] == EntryPoint::Kind::DynamicImport
                {
                    continue;
                }
                self.mark_file_live_for_tree_shaking(&mut ctx, entry_point);
            }

            if self.module_preload() {
                self.mark_preload_entries(&mut ctx, entry_points)?;
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

            let mut ctx = CodeSplitCtx {
                distances,
                parts,
                import_records,
                file_entry_bits,
                css_reprs,
                loaders,
                queue: std::collections::VecDeque::new(),
            };

            // Code splitting: Determine which entry points can reach which files. This
            // has to happen after tree shaking because there is an implicit dependency
            // between live parts within the same file. All liveness has to be computed
            // first before determining which entry points can reach which files.
            for i in 0..entry_points_len {
                let entry_point = entry_points[i];
                self.mark_file_reachable_for_code_splitting(&mut ctx, entry_point, i, 0);
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
    pub(crate) fn generate_chunk(ctx: &GenerateChunkCtx, chunk: *mut Chunk, chunk_index: usize) {
        // SAFETY: `each_ptr` hands us a unique `*mut Chunk` per task; deref for
        // the duration of this body. ctx.c points into BundleV2.linker;
        // container_of pattern. `Worker::get` only reads `bundle.graph.pool`
        // (shared), so a `&` is sufficient and avoids aliasing.
        let chunk: &mut Chunk = unsafe { &mut *chunk };
        let worker = crate::thread_pool::Worker::get(ctx.bundle());
        let mut worker = scopeguard::guard(worker, |w| w.unget());
        let worker: &mut crate::thread_pool::Worker = &mut **worker;
        // Note: dispatch on a discriminant copy so `chunk` isn't borrowed
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
    pub(crate) fn generate_js_renamer(
        ctx: &GenerateChunkCtx,
        chunk: *mut Chunk,
        chunk_index: usize,
    ) {
        // SAFETY: `each_ptr` hands us a unique `*mut Chunk` per task; deref for
        // the body. container_of pattern — see `generate_chunk` above.
        let chunk: &mut Chunk = unsafe { &mut *chunk };
        let worker = crate::thread_pool::Worker::get(ctx.bundle());
        let mut worker = scopeguard::guard(worker, |w| w.unget());
        if let crate::chunk::Content::Javascript(_) = chunk.content {
            Self::generate_js_renamer_(*ctx, &mut **worker, chunk, chunk_index);
        }
    }

    /// Second half of the minifying renamer under code splitting: names every
    /// slot `assign_cross_chunk_names` did not pin. Writes `chunk.renamer` only.
    pub(crate) fn finish_js_renamer(
        _ctx: &GenerateChunkCtx,
        chunk: *mut Chunk,
        _chunk_index: usize,
    ) {
        // SAFETY: `each_ptr` hands us a unique `*mut Chunk` per task.
        let chunk: &mut Chunk = unsafe { &mut *chunk };
        if let crate::bun_renamer::ChunkRenamer::Minify(r) = &mut chunk.renamer {
            // Only allocation can fail here.
            bun_core::handle_oom(r.finish());
        }
    }

    fn generate_js_renamer_(
        ctx: GenerateChunkCtx,
        _worker: &mut crate::thread_pool::Worker,
        chunk: &mut Chunk,
        chunk_index: usize,
    ) {
        let _ = chunk_index;
        // Note: reshaped for borrowck — `rename_symbols_in_chunk` needs
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

    /// The relative path from the chunk directory to a file source, as written
    /// into the source map's `sources` array. `sources` entries are URLs, so the
    /// host separator is normalized to `/` (the invariant `Path::pretty` holds).
    fn source_map_relative_path(
        chunk_abs_dir: &[u8],
        source_abs_path: &[u8],
    ) -> Result<Box<[u8]>, AllocError> {
        let mut rel = bun_paths::resolve_path::relative_alloc(chunk_abs_dir, source_abs_path)?;
        bun_paths::resolve_path::platform_to_posix_in_place::<u8>(&mut rel);
        Ok(rel)
    }

    pub(crate) fn generate_source_map_for_chunk(
        &mut self,
        isolated_hash: u64,
        _worker: &mut crate::thread_pool::Worker,
        results: &MultiArrayList<CompileResultForSourceMap>,
        chunk_abs_dir: &[u8],
        can_have_shifts: bool,
    ) -> Result<SourceMapPieces, BunError> {
        let _trace = bun::perf::trace("Bundler.generateSourceMapForChunk");

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

        let source_indices = results.items_source_index();

        j.push_static(b"{\n  \"version\": 3,\n  \"sources\": [");
        if !source_indices.is_empty() {
            {
                let index = source_indices[0];
                let path = &sources[index as usize].path;
                source_id_map.put_no_clobber(index, 0)?;

                // Note: the relative path lives in a local owned buffer
                // (drops at scope exit).
                let rel_path_storage;
                let pretty: &[u8] = if path.is_file() {
                    rel_path_storage = Self::source_map_relative_path(chunk_abs_dir, path.text)?;
                    &rel_path_storage
                } else {
                    path.pretty
                };

                let mut quote_buf = MutableString::init(pretty.len() + 2)?;
                js_printer::quote_for_json(pretty, &mut quote_buf, false)?;
                // `to_default_owned` moves the buffer into the joiner
                // (joiner owns it until `done`).
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
                    rel_path_storage = Self::source_map_relative_path(chunk_abs_dir, path.text)?;
                    &rel_path_storage
                } else {
                    path.pretty
                };

                let mut quote_buf = MutableString::init(pretty.len() + ", ".len() + 2)?;
                quote_buf.append_assume_capacity(b", ");
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
            // No shifts → `finalize()` returns `prefix` verbatim. Move the
            // joined buffer instead of allocating a fresh `Vec` and memcpying
            // it; for the bundled three.js x100 case the source map JSON is
            // ~300 MB, so this alloc+copy was ~20% of the build.
            pieces.prefix = done.into_vec();
        }

        Ok(pieces)
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum ScanCssImportsResult {
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
    fn from(e: BunError) -> Self {
        // OOM keeps its identity through
        // `load()`, so OOMs travelling as `crate::Error` must not be
        // misreported as build failures. Everything else collapses to
        // `BuildFailed`; user-facing diagnostics flow through the bundler `Log`,
        // not this variant.
        if matches!(e, BunError::Alloc(_)) {
            LinkError::OutOfMemory
        } else {
            LinkError::BuildFailed
        }
    }
}

pub struct LinkerOptions {
    pub(crate) generate_bytecode_cache: bool,
    pub(crate) generate_internal_module_bytecode: bool,
    /// See `CompileTargetBuiltins::Target`.
    pub(crate) target_builtins: Option<std::sync::Arc<[u8]>>,
    pub(crate) bytecode_depth: u32,
    pub(crate) output_format: Format,
    pub(crate) ignore_dce_annotations: bool,
    pub(crate) emit_dce_annotations: bool,
    pub(crate) deprecated_namespace_object_setters: bool,
    pub(crate) tree_shaking: bool,
    pub(crate) minify_whitespace: bool,
    pub(crate) minify_syntax: bool,
    pub(crate) minify_identifiers: bool,
    pub(crate) banner: &'static [u8],
    pub(crate) footer: &'static [u8],
    pub(crate) css_chunking: bool,
    /// Code splitting: side-effect-free chunks whose summed source size is
    /// below this also fold into a chunk more entry points load (0 = off).
    /// See `merge_small_chunks`.
    pub(crate) min_chunk_size: u64,
    pub(crate) module_preload: bool,
    pub(crate) source_maps: SourceMapOption,
    pub(crate) target: Target,
    pub(crate) compile_mode: CompileMode,
    pub(crate) metafile: bool,
    /// Path to write JSON metafile (for Bun.build API)
    pub(crate) metafile_json_path: &'static [u8],
    /// Path to write markdown metafile (for Bun.build API)
    pub(crate) metafile_markdown_path: &'static [u8],

    pub(crate) mode: LinkerOptionsMode,

    pub(crate) public_path: &'static [u8],
}

impl LinkerOptions {
    /// ESM bytecode in a `--compile` build: JSC does not parse the chunk, so
    /// its `JSModuleRecord` is built from a `ModuleInfo` the linker records
    /// while printing (see `post_process_js_chunk`).
    pub(crate) fn generates_module_info(&self) -> bool {
        self.generate_bytecode_cache
            && self.output_format == Format::Esm
            && self.compile_mode.is_executable()
    }
}

impl Default for LinkerOptions {
    fn default() -> Self {
        Self {
            generate_bytecode_cache: false,
            generate_internal_module_bytecode: false,
            target_builtins: None,
            bytecode_depth: u32::MAX,
            output_format: Format::Esm,
            ignore_dce_annotations: false,
            emit_dce_annotations: true,
            deprecated_namespace_object_setters: true,
            tree_shaking: true,
            minify_whitespace: false,
            minify_syntax: false,
            minify_identifiers: false,
            banner: b"",
            footer: b"",
            css_chunking: false,
            min_chunk_size: 0,
            module_preload: true,
            source_maps: SourceMapOption::None,
            target: Target::Browser,
            compile_mode: CompileMode::None,
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
    pub(crate) line_offset_tasks: Box<[SourceMapDataTask]>,

    pub quoted_contents_wait_group: WaitGroup,
    pub(crate) quoted_contents_tasks: Box<[SourceMapDataTask]>,
}

pub struct SourceMapDataTask {
    /// `None` only in `Default` (the per-index slot is overwritten before
    /// scheduling).
    pub(crate) ctx: Option<bun_ptr::ParentRef<LinkerContext<'static>>>,
    pub(crate) source_index: crate::IndexInt,
    pub(crate) thread_task: ThreadPoolLib::Task,
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
    fn run_line_offset(thread_task: *mut ThreadPoolLib::Task) {
        // SAFETY: thread_task points to SourceMapDataTask.thread_task
        let task: &mut SourceMapDataTask = unsafe {
            &mut *(bun_core::from_field_ptr!(SourceMapDataTask, thread_task, thread_task))
        };
        // `ParentRef<LinkerContext>` — Deref yields `&LinkerContext`; the
        // pointee outlives every task (joined via `line_offset_wait_group`).
        let ctx = task.ctx.expect("SourceMapDataTask.ctx");
        scopeguard::defer! {
            ctx.mark_pending_task_done();
            // SAFETY: live until this lets the linker's `wait()` return; the linker then frees
            // the tasks at once (`generate_chunks_in_parallel`), and nothing below touches `ctx`.
            unsafe {
                WaitGroup::finish_raw(
                    &raw const (*ctx.as_const_ptr()).source_maps.line_offset_wait_group,
                )
            };
        }

        // SAFETY: ctx is BundleV2.linker; container_of recovers the parent. We
        // deliberately do NOT materialize `&mut BundleV2` here — these tasks
        // run concurrently across the worker pool (one per source_index), so
        // any `&mut` to the shared `BundleV2`/`LinkerContext` would be aliased
        // UB. `Worker::get` only needs `&BundleV2` (reads `graph.pool`), and
        // that shared borrow ends before any per-slot write below.
        let bundle: *const BundleV2 =
            unsafe { LinkerContext::bundle_v2_const_ptr(ctx.as_const_ptr()) };
        // SAFETY: `bundle` is a valid backref into the owning `BundleV2` (see above);
        // only a shared borrow is formed and it ends before any per-slot write.
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
    fn run_quoted_source_contents(thread_task: *mut ThreadPoolLib::Task) {
        // SAFETY: thread_task points to SourceMapDataTask.thread_task
        let task: &mut SourceMapDataTask = unsafe {
            &mut *(bun_core::from_field_ptr!(SourceMapDataTask, thread_task, thread_task))
        };
        // `ParentRef<LinkerContext>` — Deref yields `&LinkerContext`; the
        // pointee outlives every task (joined via `quoted_contents_wait_group`).
        let ctx = task.ctx.expect("SourceMapDataTask.ctx");
        scopeguard::defer! {
            ctx.mark_pending_task_done();
            // SAFETY: as in `run_line_offset`, for `quoted_contents_wait_group`.
            unsafe {
                WaitGroup::finish_raw(
                    &raw const (*ctx.as_const_ptr()).source_maps.quoted_contents_wait_group,
                )
            };
        }

        // SAFETY: see `run_line_offset` — raw-ptr container_of, no `&mut`
        // materialized over the shared `BundleV2` while peer tasks are live.
        let bundle: *const BundleV2 =
            unsafe { LinkerContext::bundle_v2_const_ptr(ctx.as_const_ptr()) };
        // SAFETY: `bundle` is a valid backref (see `run_line_offset`); only a shared
        // borrow is formed for `Worker::get`, which reads `graph.pool` under a mutex.
        let worker = crate::thread_pool::Worker::get(unsafe { &*bundle });

        // Use the default arena when using DevServer and the file
        // was generated. This will be preserved so that remapping
        // stack traces can show the source code, even after incremental
        // rebuilds occur.
        //
        // Note: `compute_quoted_source_contents` ignores which arena it is
        // handed (it allocates via the default allocator internally), so we
        // pass the worker arena unconditionally; `DevServerHandle` does not
        // expose an arena accessor (§Dispatch).
        SourceMapData::compute_quoted_source_contents(ctx, worker.arena(), task.source_index);
        worker.unget();
    }
}

impl SourceMapData {
    /// Runs concurrently across the worker pool (one task per `source_index`).
    /// Takes [`ParentRef<LinkerContext>`](bun_ptr::ParentRef) (not `&mut`)
    /// because peer tasks on other threads hold the same pointer —
    /// materializing `&mut LinkerContext` here would be aliased-mut UB. `ParentRef::Deref` yields
    /// `&LinkerContext` (SharedReadOnly) for all SoA-header reads; each task
    /// writes only `graph.files[source_index].line_offset_table` (disjoint by
    /// `source_index`) via a raw column pointer.
    pub(crate) fn compute_line_offsets(
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
        let line_offset_table: *mut SourceMap::line_offset_table::List<bun_alloc::AstAlloc> = unsafe {
            this.graph
                .files
                .slice()
                .items_raw::<"line_offset_table", SourceMap::line_offset_table::List<bun_alloc::AstAlloc>>()
                .add(source_index as usize)
        };

        // `parse_graph` backref accessor — read-only across all tasks.
        let parse_graph = this.parse_graph();
        let source: &Source = &parse_graph.input_files.items_source()[source_index as usize];
        let loader: Loader = parse_graph.input_files.items_loader()[source_index as usize];

        if !loader.can_have_source_map() {
            // This is not a file which we support generating source maps for
            // SAFETY: sole writer to this slot (disjoint by source_index).
            unsafe {
                *line_offset_table = SourceMap::line_offset_table::List::new_in(bun_alloc::AstAlloc)
            };
            return;
        }

        // `graph.ast` is read-only for the duration of these tasks.
        let approximate_line_count =
            this.graph.ast.items_approximate_newline_count()[source_index as usize];

        let _ = alloc;
        // SAFETY: sole writer to this slot (disjoint by source_index).
        // `Worker::get` (the caller) brackets this in `ast_memory_store.push()/
        // pop()`, so the active `AstAlloc` state is this worker's and the
        // `AstAlloc` route lands the SoA slab + every `columns_for_non_ascii`
        // payload there for bulk-free on `pool.deinit()`.
        unsafe {
            *line_offset_table = LineOffsetTable::generate_in::<bun_alloc::AstAlloc>(
                &source.contents,
                // We don't support sourcemaps for source files with more than 2^31 lines
                (approximate_line_count as u32 & 0x7FFF_FFFF) as i32,
            )
            .expect("OOM");
        }
    }

    /// Runs concurrently across the worker pool — see `compute_line_offsets`
    /// for the `ParentRef` aliasing contract.
    pub(crate) fn compute_quoted_source_contents(
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
                .items_raw::<"quoted_source_contents", Option<bun_alloc::AstVec<u8>>>()
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
        // Allocate from the worker's AST allocation state (installed by
        // `Worker::get`); ~12.5% escape-expansion slack matches `quote_for_json`'s
        // heuristic so the writer rarely reallocs. The slack is dropped with
        // the arena at bundle end, and `StringJoiner` only borrows a `&[u8]`
        // view downstream.
        let contents: &[u8] = &source.contents;
        let mut buf = bun_alloc::AstAlloc::vec_with_capacity::<u8>(
            contents.len() + (contents.len() >> 3) + 8,
        );
        buf.push(b'"');
        js_printer::write_pre_quoted_string_inner::<_, { js_printer::Encoding::Utf8 }>(
            contents, &mut buf, b'"', false, true,
        )
        .expect("OOM");
        buf.push(b'"');
        *quoted_source_contents = Some(buf);
    }
}

/// Where export `name` of some file finally resolves to, plus the re-export
/// statements walked to get there. Memoized per `(file, name)` for the
/// duration of step 4 (`ImportMemberResolutions`) since the walk does not
/// depend on the importing file.
pub(crate) struct ImportMemberResolution {
    source_index: u32,
    r#ref: Ref,
    re_exports: Vec<Dependency>,
}
pub(crate) type ImportMemberResolutions =
    bun_collections::HashMap<(crate::IndexInt, bun_ast::StoreStr), Option<ImportMemberResolution>>;

// Clone: bitwise OK — `alias` borrows from the AST arena (non-owning); all
// other fields are POD.
#[derive(Clone, Default)]
pub struct MatchImport {
    alias: bun_ast::StoreStr, // string borrowed from AST arena
    kind: MatchImportKind,
    namespace_ref: Ref,
    source_index: u32,
    name_loc: Loc, // Optional, goes with sourceIndex, ignore if zero,
    other_source_index: u32,
    other_name_loc: Loc, // Optional, goes with otherSourceIndex, ignore if zero,
    r#ref: Ref,
}

#[derive(Default, Clone, Copy, PartialEq, Eq)]
pub(crate) enum MatchImportKind {
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
    pub(crate) imports: ChunkMetaMap,
    pub(crate) exports: ChunkMetaMap,
    pub(crate) dynamic_imports: ArrayHashMap<crate::IndexInt, ()>,
    /// Split `require()` targets, kept apart from `dynamic_imports`
    /// only so the metafile labels them `require-call`.
    pub(crate) require_imports: ArrayHashMap<crate::IndexInt, ()>,
}

pub(crate) type ChunkMetaMap = ArrayHashMap<Ref, ()>;

/// Note: raw-pointer fields (was `&'a mut`) because `each_ptr` requires
/// `Ctx: Sync + Copy` and the same context is observed from every worker
/// thread. Each task only writes to its own `*mut Chunk` slot; reads of
/// `c`/`chunks` are disjoint or read-only.
#[derive(Clone, Copy)]
pub struct GenerateChunkCtx<'a> {
    pub(crate) c: bun_ptr::ParentRef<LinkerContext<'a>, bun_ptr::Mut>,
    /// Backref to the full `chunks: &mut [Chunk]` slice owned by
    /// `generate_chunks_in_parallel`. The slice outlives every
    /// `GenerateChunkCtx` (joined via the batch's `group.wait()`), so [`bun_ptr::BackRef`]'s
    /// owner-outlives-holder invariant holds and per-task reads go through
    /// safe `Deref`. Read-only: each task writes only through its own
    /// `*mut Chunk`.
    pub(crate) chunks: bun_ptr::BackRef<[Chunk]>,
    /// Backref to this task's `Chunk` (an element of `chunks`). Constructed
    /// via [`bun_ptr::BackRef::new_mut`] so the stored `NonNull` carries write
    /// provenance; per-task slot writes recover the raw `*mut Chunk` via
    /// [`bun_ptr::BackRef::as_ptr`], shared reads go through safe `Deref`.
    pub(crate) chunk: bun_ptr::BackRef<Chunk, bun_ptr::Mut>,
}
// SAFETY: see note above — each task writes only its own `*mut Chunk` slot;
// shared reads are read-only.
unsafe impl<'a> Send for GenerateChunkCtx<'a> {}
// SAFETY: see the `Send` impl above — same backref-lifetime / disjoint-write invariants.
unsafe impl<'a> Sync for GenerateChunkCtx<'a> {}

impl<'a> GenerateChunkCtx<'a> {
    /// Recover a shared borrow of the owning `BundleV2` via container_of from
    /// the embedded `LinkerContext` pointer (`BundleV2.linker == *self.c`).
    /// Used solely to call `Worker::get`, which only reads `bundle.graph.pool`
    /// (shared) and serializes via mutex — so a `&BundleV2` is sufficient and
    /// no `&mut` is ever materialized over the shared bundle while peer
    /// per-chunk tasks run concurrently.
    #[inline]
    pub(crate) fn bundle(&self) -> &BundleV2<'a> {
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
    pub(crate) fn c(&self) -> &mut LinkerContext<'a> {
        // SAFETY: ParentRef into `BundleV2.linker`, valid for the
        // chunk-generation pass; this task's chunk row is disjoint from peers'.
        // Constructed via `from_raw_mut` (write provenance) in
        // `generate_chunks_in_parallel`.
        unsafe { self.c.assume_mut() }
    }
}

pub struct PendingPartRange<'a> {
    pub(crate) part_range: PartRange,
    pub(crate) task: ThreadPoolLib::CountedTask,
    pub(crate) ctx: &'a GenerateChunkCtx<'a>,
    pub(crate) i: u32,
}

/// Shared prologue for `generate_compile_result_for_{js,css}_chunk` thread-pool
/// callbacks: recover the intrusive [`PendingPartRange`] from `task`, extract
/// the raw `*mut LinkerContext` / `*mut Chunk` from its [`GenerateChunkCtx`],
/// and acquire the per-thread [`Worker`](crate::thread_pool::Worker) (returned
/// as a scopeguard that calls `unget()` on drop).
///
/// `GenerateChunkCtx.{c, chunk}` are raw `*mut T` (Copy), so reading them
/// through `&GenerateChunkCtx` preserves the mutable provenance they were
/// constructed with in `generate_chunks_in_parallel` — many `PendingPartRange`
/// tasks share one `chunk_ctx` across worker threads.
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

impl<'a> LinkerContext<'a> {
    pub(crate) fn generate_isolated_hash(&mut self, chunk: &Chunk, arena: &Bump) -> u64 {
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
                                .path_with_pretty_initialized(&source.path, arena)
                                .expect("OOM");
                        }
                        // Note: `Path::assert_pretty_is_valid` lives on the
                        // resolver-side `Path<'a>`; the logger `Path` has no
                        // such debug hook yet.
                        debug_assert!(source.path.text.as_ptr() != source.path.pretty.as_ptr());

                        break 'brk source.path.pretty;
                    } else {
                        // If this isn't in the "file" namespace, just use the full path text
                        // verbatim. This could be a source of cross-platform differences if
                        // plugins are storing platform-specific information in here, but then
                        // that problem isn't caused by esbuild itself.
                        break 'brk source.path.text;
                    }
                };

                // Include the path namespace in the hash
                hasher.write(source.path.namespace);

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
            // `transpiler_for_target` only reads `bundle.client_transpiler`.
            let bundle = unsafe {
                &mut *LinkerContext::bundle_v2_ptr(std::ptr::from_mut::<LinkerContext>(self))
            };
            &bundle
                .transpiler_for_target(Target::Browser)
                .options
                .public_path
        } else {
            self.options.public_path
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

    pub(crate) fn validate_tla(
        &mut self,
        source_index: crate::IndexInt,
        tla_keywords: &[Range],
        tla_checks: &mut [TlaCheck],
        input_files: &[Source],
        meta_flags: &mut [crate::js_meta::Flags],
        ast_import_records: &[bun_ast::import_record::List<'a>],
    ) {
        // Explicit-stack postorder DFS (was per-edge recursive). `Enter`
        // seeds a file and queues each followed import paired with an
        // `AfterChild` resume point; that resume reads the child's completed
        // `tla_checks` entry. `Leave` sets the async flag once all children
        // are settled. Successors are pushed in pop order then the tail is
        // reversed so LIFO pop reproduces the original recursion order.
        #[derive(Copy, Clone)]
        enum Frame {
            Enter(crate::IndexInt),
            AfterChild {
                source_index: crate::IndexInt,
                import_record_index: u32,
            },
            Leave(crate::IndexInt),
        }

        if tla_checks[source_index as usize].depth != 0 {
            return;
        }

        let mut stack: Vec<Frame> = vec![Frame::Enter(source_index)];

        while let Some(frame) = stack.pop() {
            match frame {
                Frame::Enter(source_index) => {
                    if tla_checks[source_index as usize].depth != 0 {
                        continue;
                    }
                    tla_checks[source_index as usize].depth = 1;
                    if tla_keywords[source_index as usize].len > 0 {
                        tla_checks[source_index as usize].parent = source_index;
                    }

                    let mark = stack.len();
                    for (import_record_index, record) in ast_import_records[source_index as usize]
                        .as_slice()
                        .iter()
                        .enumerate()
                    {
                        if Index::is_valid(record.source_index)
                            && (record.kind == ImportKind::Require
                                || record.kind == ImportKind::Stmt)
                        {
                            stack.push(Frame::Enter(record.source_index.get()));
                            stack.push(Frame::AfterChild {
                                source_index,
                                import_record_index: u32::try_from(import_record_index)
                                    .expect("int cast"),
                            });
                        }
                    }
                    stack.push(Frame::Leave(source_index));
                    stack[mark..].reverse();
                }
                Frame::Leave(source_index) => {
                    // Make sure that if we wrap this module in a closure, the closure is also
                    // async. This happens when you call "import()" on this module and code
                    // splitting is off.
                    if Index::is_valid(Index::init(tla_checks[source_index as usize].parent)) {
                        meta_flags[source_index as usize].is_async_or_has_async_dependency = true;
                    }
                }
                Frame::AfterChild {
                    source_index,
                    import_record_index,
                } => {
                    let record = &ast_import_records[source_index as usize].as_slice()
                        [import_record_index as usize];
                    let parent = tla_checks[record.source_index.get() as usize];
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
                        result_tla_check.import_record_index = import_record_index;
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
                                tla_pretty_path = source.path.pretty;
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
                                    ast_import_records[parent_source_index as usize].as_slice()
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
        }
    }

    pub(crate) fn should_remove_import_export_stmt(
        &mut self,
        stmts: &mut StmtList,
        loc: Loc,
        namespace_ref: Ref,
        import_record_index: u32,
        alloc: &Bump,
        ast: &JSAst<'_>,
    ) -> Result<bool, BunError> {
        let record = &ast.import_records[import_record_index as usize];
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

    pub(crate) fn print_code_for_file_in_chunk_js(
        &mut self,
        r: renamer::Renamer,
        alloc: &Bump,
        writer: &mut js_printer::BufferWriter,
        out_stmts: &mut [Stmt],
        ast: &JSAst<'_>,
        flags: crate::js_meta::Flags,
        to_esm_ref: Ref,
        to_commonjs_ref: Ref,
        runtime_require_ref: Option<Ref>,
        source_index: Index,
        source: &Source,
        module_info: Option<&mut crate::analyze_transpiled_module::ModuleInfo>,
    ) -> js_printer::PrintResult {
        let parts_to_print = &[Part {
            stmts: bun_ast::StoreSlice::new_mut(out_stmts),
            ..Default::default()
        }];

        // SAFETY: parse_graph backref; raw deref because `parse_graph` is held
        // across `RequireOrImportMetaCallback::init(self)` (`&mut self`) below.
        let parse_graph = unsafe { &*self.parse_graph };

        // Note: reshaped for borrowck — `Options` borrows `ts_enums` /
        // `line_offset_tables` / `mangled_props` from `self.graph`, but the
        // `require_or_import_meta_for_source_callback` field below needs
        // `&mut self`. Detach the read-only borrows via raw-pointer round-trip
        // (graph SoA storage is never reallocated during the print step).
        // SAFETY: `self.graph` columns are stable heap allocations valid for
        // the duration of this call; the printer only reads from them.
        let ts_enums: &bun_ast::ast_result::TsEnumsMap =
            unsafe { bun_ptr::detach_lifetime_ref(&self.graph.ts_enums) };
        // SAFETY: as for `ts_enums`.
        let import_member_bindings: &bun_ast::ast_result::ImportMemberBindings =
            unsafe { bun_ptr::detach_lifetime_ref(&self.graph.import_member_bindings) };
        // SAFETY: `graph.files` SoA columns are stable heap allocations valid for this
        // call (see above); the printer only reads from this slot.
        let line_offset_table: &bun_sourcemap::line_offset_table::List<bun_alloc::AstAlloc> = unsafe {
            bun_ptr::detach_lifetime_ref(
                &self.graph.files.items_line_offset_table()[source_index.get() as usize],
            )
        };
        let mangled_props: &MangledProps =
            // SAFETY: `self.mangled_props` is not mutated during printing; detached borrow
            // outlives only this call (see above).
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
            import_member_bindings: Some(import_member_bindings),
            has_dynamic_import_items: ast
                .dynamic_import_aliases
                .values()
                .iter()
                .any(|dynamic_use| !dynamic_use.items.is_empty()),

            minify_whitespace: self.options.minify_whitespace,
            minify_syntax: self.options.minify_syntax,
            input_module_type: ast.module_type,
            module_type: self.options.output_format,
            print_dce_annotations: self.options.emit_dce_annotations,
            has_run_symbol_renamer: true,

            to_esm_ref,
            to_commonjs_ref,
            module_preload_ref: if self.module_preload() {
                self.preload_runtime_ref
            } else {
                Ref::NONE
            },
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
            module_info,
            ..Default::default()
        };

        writer.buffer.reset();
        // Note: `BufferWriter` isn't `Clone`/`Default`; move it through
        // `mem::replace` with a freshly-initialized writer.
        let mut printer = js_printer::BufferPrinter::init(core::mem::replace(
            writer,
            js_printer::BufferWriter::init(),
        ));

        // Note: shallow bitwise copy via `ptr::read` + `ManuallyDrop` — the
        // resulting `Ast` aliases `ast`'s storage; dropping it would
        // double-free.
        // SAFETY: `ast` is a valid `&BundledAst` for the duration of this call;
        // the read is a bitwise copy whose result is never dropped.
        let printer_ast = core::mem::ManuallyDrop::new(unsafe { core::ptr::read(ast) }.to_ast());

        // Note: `print_with_writer<'a>` requires `Renamer<'a,'a>` (the
        // printer struct stores it with a single lifetime), but `Renamer`'s
        // `'src` is invariant behind `&mut`, so the caller's `Renamer<'r,'src>`
        // cannot unify with the local `'a` picked from `alloc`/`mangled_props`.
        // Rebind via a
        // lifetime-only cast — sound because the renamer's borrowed data
        // (symbol map, source) strictly outlives this call.
        // SAFETY: lifetime-only erase; layout identical across instantiations.
        let r: renamer::Renamer<'_, '_> = unsafe {
            core::mem::transmute::<renamer::Renamer<'_, '_>, renamer::Renamer<'_, '_>>(r)
        };

        let enable_source_maps =
            self.options.source_maps != SourceMapOption::None && !source_index.is_runtime();
        let result = if enable_source_maps {
            js_printer::print_with_writer::<&mut js_printer::BufferPrinter, true>(
                &mut printer,
                alloc,
                ast.target,
                &printer_ast,
                source,
                print_options,
                ast.import_records.as_slice(),
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
                ast.import_records.as_slice(),
                parts_to_print,
                r,
            )
        };

        // `defer writer.* = printer.ctx;`
        *writer = printer.ctx;
        result
    }

    pub(crate) fn require_or_import_meta_for_source(
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

    pub(crate) fn mangle_local_css(&mut self) {
        if self.has_any_css_locals.load(Ordering::Relaxed) == 0 {
            return;
        }

        let all_css_asts = self.graph.ast.items_css();
        let all_symbols: &[bun_ast::symbol::List<'a>] = self.graph.ast.items_symbols();
        // SAFETY: parse_graph backref; raw deref because `all_sources` is held
        // across `&mut self.mangled_props` below (split borrow).
        let all_sources: &[Source] = unsafe { (*self.parse_graph).input_files.items_source() };

        // Collect all local css names
        let mut local_css_names: HashMap<Ref, ()> = HashMap::new();

        for (source_index, maybe_css_ast) in all_css_asts.iter().enumerate() {
            if let Some(css_ast) = maybe_css_ast.as_deref() {
                if css_ast.local_scope.count() == 0 {
                    continue;
                }
                let symbols = &all_symbols[source_index];
                for (inner_index, symbol_) in symbols.as_slice().iter().enumerate() {
                    let mut symbol = symbol_;
                    if symbol.kind == bun_ast::symbol::Kind::LocalCss {
                        let r#ref = 'follow: {
                            let mut r#ref = Ref::new(
                                u32::try_from(inner_index).expect("int cast"),
                                u32::try_from(source_index).expect("int cast"),
                                bun_ast::RefTag::Symbol,
                            );
                            while symbol.has_link() {
                                r#ref = symbol.link.get();
                                symbol = &all_symbols[r#ref.source_index() as usize]
                                    [r#ref.inner_index() as usize];
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
                        // The hash itself is short-lived; use a scratch bump.
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
                        // The map owns its boxed values (freed with `mangled_props`).
                        self.mangled_props
                            .put(r#ref, final_generated_name.into_boxed_slice())
                            .expect("OOM");
                    }
                }
            }
        }
    }

    /// Each chunk's final content hash: its own isolated hash (plus the
    /// asset paths its output pieces reference) and that of every chunk it
    /// transitively reaches through cross-chunk imports or output pieces, so a
    /// change anywhere below a chunk renames it. Cycles are fine: reachability
    /// is a fixpoint over bitsets, and each chunk digests its own hash first,
    /// then the rest of its closure in chunk order (so two chunks that reach
    /// each other still differ).
    ///
    /// The width is the template's (`[hash]` = 8, `[hashN]` = N) unless two
    /// chunks with different hashes would print the same characters; those
    /// widen until they differ, and every chunk that reaches a widened chunk
    /// (its output embeds that chunk's path or id) has the widths folded into
    /// its own hash so that its name changes with its bytes.
    pub(crate) fn final_chunk_hashes(
        &self,
        chunks: &[Chunk],
    ) -> Result<Vec<bun_core::fmt::ContentHash>, AllocError> {
        let n = chunks.len();
        let mut own: Vec<u64> = Vec::with_capacity(n);
        let mut edges: Vec<Vec<u32>> = Vec::with_capacity(n);
        for chunk in chunks {
            let mut hash = ContentHasher::default();
            let mut out: Vec<u32> = chunk
                .cross_chunk_imports
                .slice()
                .iter()
                .map(|import| import.chunk_index)
                .collect();
            if let crate::chunk::IntermediateOutput::Pieces(pieces) = &chunk.intermediate_output {
                for piece in pieces.slice() {
                    match piece.query.kind() {
                        crate::chunk::QueryKind::Asset => {
                            let mut from_chunk_dir =
                                bun_paths::resolve_path::dirname::<
                                    bun_paths::resolve_path::platform::Posix,
                                >(&chunk.final_rel_path);
                            if from_chunk_dir == b"." {
                                from_chunk_dir = b"";
                            }
                            let parse_graph = self.parse_graph();
                            let additional_files: &[AdditionalFile] =
                                parse_graph.input_files.items_additional_files()
                                    [piece.query.index() as usize]
                                    .slice();
                            debug_assert!(!additional_files.is_empty());
                            if let AdditionalFile::OutputFile(output_file_id) = &additional_files[0]
                            {
                                let path = &parse_graph.additional_output_files
                                    [*output_file_id as usize]
                                    .dest_path;
                                hash.write(bun_paths::resolve_path::relative_platform::<
                                    bun_paths::resolve_path::platform::Posix,
                                    false,
                                >(from_chunk_dir, path));
                            }
                        }
                        crate::chunk::QueryKind::Chunk | crate::chunk::QueryKind::ChunkId => {
                            out.push(piece.query.index())
                        }
                        crate::chunk::QueryKind::Scb => {
                            let chunk_index = self.graph.files.items_entry_point_chunk_index()
                                [piece.query.index() as usize];
                            if chunk_index != u32::MAX {
                                out.push(chunk_index);
                            }
                        }
                        crate::chunk::QueryKind::None | crate::chunk::QueryKind::HtmlImport => {}
                    }
                }
            }
            hash.write(&chunk.isolated_hash.to_ne_bytes());
            own.push(hash.digest());
            edges.push(out);
        }

        let mut reach: Vec<AutoBitSet> = Vec::with_capacity(n);
        for i in 0..n {
            let mut bits = AutoBitSet::init_empty(n)?;
            bits.set(i);
            reach.push(bits);
        }
        loop {
            let mut changed = false;
            for i in 0..n {
                for &j in &edges[i] {
                    let j = j as usize;
                    if j == i || reach[j].subset_of(&reach[i]) {
                        continue;
                    }
                    let other = reach[j].clone()?;
                    reach[i].set_union(&other);
                    changed = true;
                }
            }
            if !changed {
                break;
            }
        }

        let closure: Vec<u64> = reach
            .iter()
            .enumerate()
            .map(|(i, bits)| {
                let mut hash = ContentHasher::default();
                hash.write(&own[i].to_ne_bytes());
                let mut iter = bits.iterator::<true, true>();
                while let Some(j) = iter.next() {
                    if j != i {
                        hash.write(&own[j].to_ne_bytes());
                    }
                }
                hash.digest()
            })
            .collect();

        use bun_core::fmt::ContentHash;
        let min_len: Vec<usize> = chunks
            .iter()
            .map(|chunk| chunk.template.hash_len())
            .collect();
        let mut names: Vec<ContentHash> = (0..n)
            .map(|i| ContentHash::new(closure[i], min_len[i]))
            .collect();
        for _ in 0..ContentHash::MAX_LEN {
            if !ContentHash::widen_to_distinguish(&mut names) {
                break;
            }
            for i in 0..n {
                let mut hash = ContentHasher::default();
                let mut any = false;
                let mut iter = reach[i].iterator::<true, true>();
                while let Some(j) = iter.next() {
                    if j != i && names[j].len() != min_len[j] {
                        hash.write_ints(&[j as u32, names[j].len() as u32]);
                        any = true;
                    }
                }
                if any {
                    hash.write(&closure[i].to_ne_bytes());
                    names[i] = ContentHash::new(hash.digest(), names[i].len());
                }
            }
        }
        Ok(names)
    }

    // Sort cross-chunk exports by chunk name for determinism
    pub(crate) fn sorted_cross_chunk_export_items(
        &self,
        export_refs: &ChunkMetaMap,
        list: &mut Vec<StableRef>,
    ) {
        list.clear();
        list.reserve(export_refs.count());
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
        index_sort::sort_slice_by(list, |a, b| {
            if StableRef::is_less_than((), *a, *b) {
                core::cmp::Ordering::Less
            } else {
                core::cmp::Ordering::Greater
            }
        });
    }
} // end — split: tree-shaking trio below

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
// Tree-shaking primitives. These reach into `LinkerGraph` SoA columns
// (`files_live`, `meta.items_flags()`) and the `Graph::InputFileColumns`
// accessors.
// ══════════════════════════════════════════════════════════════════════════

// The liveness pass visits every (file, part) at most once. Processing order is
// irrelevant to the final bitset state, so the former mutual recursion is
// driven off an explicit worklist (LIFO, so traversal order matches the old
// DFS). Packing the slices into a borrowed context struct keeps each step at
// 3-4 register-sized arguments.
pub(crate) struct TreeShakeCtx<'a, 'r> {
    pub(crate) parts: &'r mut [bun_ast::PartList<'a>],
    pub(crate) parts_live: &'r mut [bun_collections::AutoBitSet],
    pub(crate) import_records: &'r [bun_ast::import_record::List<'a>],
    pub(crate) entry_point_kinds: &'r [EntryPoint::Kind],
    pub(crate) css_reprs: &'r [crate::bundled_ast::CssCol],
    pub(crate) worklist: Vec<TreeShakeWork>,
}

#[derive(Clone, Copy)]
pub enum TreeShakeWork {
    File(crate::IndexInt),
    Part {
        part_index: crate::IndexInt,
        source_index: crate::IndexInt,
    },
}

pub(crate) struct CodeSplitCtx<'a, 'r> {
    pub(crate) distances: &'r mut [u32],
    pub(crate) parts: &'r [bun_ast::PartList<'a>],
    pub(crate) import_records: &'r [bun_ast::import_record::List<'a>],
    pub(crate) file_entry_bits: &'r mut [AutoBitSet],
    pub(crate) css_reprs: &'r [crate::bundled_ast::CssCol],
    pub(crate) loaders: &'r [Loader],
    pub(crate) queue: std::collections::VecDeque<(crate::IndexInt, u32)>,
}

impl<'a> LinkerContext<'a> {
    pub(crate) fn mark_file_reachable_for_code_splitting(
        &mut self,
        ctx: &mut CodeSplitCtx<'a, '_>,
        source_index: crate::IndexInt,
        entry_points_count: usize,
        distance: u32,
    ) {
        // BFS over the import graph from one entry point. Every edge has unit
        // weight, so FIFO order makes the first dequeue of a file carry its
        // shortest distance from this entry point, and re-enqueued already-
        // visited files can be skipped on their entry bit alone. That keeps
        // the work at O(V+E). esbuild (and the earlier recursive port here)
        // runs the same fixpoint as LIFO DFS with a `traverseAgain`
        // relaxation, which reaches the same `distances` / entry bits but
        // does O(V*E) work when shorter paths are discovered late on
        // diamond-shaped DAGs.
        debug_assert!(ctx.queue.is_empty());
        ctx.queue.push_back((source_index, distance));

        while let Some((source_index, distance)) = ctx.queue.pop_front() {
            if !self.graph.files_live.is_set(source_index as usize) {
                continue;
            }

            let bits = &mut ctx.file_entry_bits[source_index as usize];

            // Don't mark this file more than once
            if bits.is_set(entry_points_count) {
                continue;
            }
            bits.set(entry_points_count);

            // Track the minimum distance to an entry point
            if distance < ctx.distances[source_index as usize] {
                ctx.distances[source_index as usize] = distance;
            }
            let out_dist = distance + 1;

            let records = &ctx.import_records[source_index as usize];

            // CSS and HTML files have no parts: follow every import record.
            if ctx.css_reprs[source_index as usize].is_some()
                || ctx.loaders[source_index as usize] == Loader::Html
            {
                for record in records.iter() {
                    if record.source_index.is_valid()
                        && !ctx.file_entry_bits[record.source_index.get() as usize]
                            .is_set(entry_points_count)
                    {
                        ctx.queue.push_back((record.source_index.get(), out_dist));
                    }
                }
                continue;
            }

            // A dead part prints nothing, so only live parts reach other files.
            let parts_live = &self.graph.parts_live[source_index as usize];
            for (part_index, part) in ctx.parts[source_index as usize]
                .as_slice()
                .iter()
                .enumerate()
            {
                if !parts_live.is_set(part_index) {
                    continue;
                }

                for &import_index in part.import_record_indices.iter() {
                    let Some(other) =
                        self.file_loaded_by_import(&records[import_index as usize], source_index)
                    else {
                        continue;
                    };
                    if !ctx.file_entry_bits[other as usize].is_set(entry_points_count) {
                        ctx.queue.push_back((other, out_dist));
                    }
                }

                for dependency in part.dependencies.iter() {
                    let dep = dependency.source_index.get();
                    if dep != source_index
                        && !ctx.file_entry_bits[dep as usize].is_set(entry_points_count)
                    {
                        ctx.queue.push_back((dep, out_dist));
                    }
                }
            }
        }
    }

    /// Once liveness is known: each user entry point whose live code reaches a split
    /// `import()` uses `__chunks` from its entry point part (see `module_preload_registration`).
    fn mark_preload_entries(
        &mut self,
        ctx: &mut TreeShakeCtx<'a, '_>,
        entry_points: &[crate::IndexInt],
    ) -> Result<(), AllocError> {
        let files_len = ctx.parts.len();
        let mut reaches = AutoBitSet::init_empty(files_len)?;
        loop {
            let mut changed = false;
            for source_index in 0..files_len {
                if reaches.is_set(source_index) || !self.graph.files_live.is_set(source_index) {
                    continue;
                }
                let records = ctx.import_records[source_index].as_slice();
                'parts: for (part_index, part) in
                    ctx.parts[source_index].as_slice().iter().enumerate()
                {
                    if !ctx.parts_live[source_index].is_set(part_index) {
                        continue;
                    }
                    for &record_index in part.import_record_indices.iter() {
                        let record = &records[record_index as usize];
                        if !record.source_index.is_valid() {
                            continue;
                        }
                        if reaches.is_set(record.source_index.get() as usize)
                            || (record.kind == ImportKind::Dynamic
                                && self.is_external_dynamic_import(record, source_index as u32))
                        {
                            reaches.set(source_index);
                            changed = true;
                            break 'parts;
                        }
                    }
                }
            }
            if !changed {
                break;
            }
        }

        let mut preload_entries = AutoBitSet::init_empty(files_len)?;
        for &entry in entry_points {
            let id = entry as usize;
            if ctx.entry_point_kinds[id] != EntryPoint::Kind::UserSpecified || !reaches.is_set(id) {
                continue;
            }
            preload_entries.set(id);
            let part_index = self.entry_point_part_indices[id];
            // Through `ctx.parts` (the tree shaker's view of the parts column), not a second `&mut` via `self.graph`.
            {
                let ast = self.graph.ast.split_raw();
                let meta = self.graph.meta.split_raw();
                // SAFETY: columns other than `parts`; stable for the link step and not otherwise borrowed here.
                let (ast_flags, exports_ref, module_ref, top_level, imports_to_bind, overlay) = unsafe {
                    (
                        &mut *ast.flags,
                        &*ast.exports_ref,
                        &*ast.module_ref,
                        &*ast.top_level_symbols_to_parts,
                        &mut *meta.imports_to_bind,
                        &*meta.top_level_symbol_to_parts_overlay,
                    )
                };
                crate::linker_graph::generate_symbol_import_and_use(
                    ctx.parts,
                    ast_flags,
                    exports_ref,
                    module_ref,
                    top_level,
                    imports_to_bind,
                    overlay,
                    entry,
                    part_index,
                    self.chunks_runtime_ref,
                    1,
                    Index::RUNTIME,
                )?;
            }
            if ctx.parts_live[id].is_set(part_index as usize) {
                for dependency in ctx.parts[id].as_slice()[part_index as usize]
                    .dependencies
                    .iter()
                {
                    ctx.worklist.push(TreeShakeWork::Part {
                        part_index: dependency.part_index,
                        source_index: dependency.source_index.get(),
                    });
                }
            } else {
                ctx.worklist.push(TreeShakeWork::Part {
                    part_index,
                    source_index: entry,
                });
            }
            self.drain_tree_shake_worklist(ctx);
        }
        self.preload_entries = preload_entries;
        Ok(())
    }

    pub(crate) fn mark_file_live_for_tree_shaking(
        &mut self,
        ctx: &mut TreeShakeCtx<'a, '_>,
        source_index: crate::IndexInt,
    ) {
        debug_assert!(ctx.worklist.is_empty());
        ctx.worklist.push(TreeShakeWork::File(source_index));
        self.drain_tree_shake_worklist(ctx);
    }

    fn drain_tree_shake_worklist(&mut self, ctx: &mut TreeShakeCtx<'a, '_>) {
        while let Some(work) = ctx.worklist.pop() {
            match work {
                TreeShakeWork::File(src) => self.mark_file_live_step(ctx, src),
                TreeShakeWork::Part {
                    part_index,
                    source_index,
                } => self.mark_part_live_step(ctx, part_index, source_index),
            }
        }
    }

    fn mark_file_live_step(
        &mut self,
        ctx: &mut TreeShakeCtx<'a, '_>,
        source_index: crate::IndexInt,
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
                // Note: `bake_graph()` lives in `bun_bake` (tier-6 — would back-edge).
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

        if self.graph.files_live.is_set(source_index as usize) {
            return;
        }
        self.graph.files_live.set(source_index as usize);

        if source_index as usize >= self.graph.ast.len() {
            debug_assert!(false);
            return;
        }

        if ctx.css_reprs[source_index as usize].is_some() {
            for record in ctx.import_records[source_index as usize].iter() {
                if record.source_index.is_valid() {
                    let other = record.source_index.get();
                    if !self.graph.files_live.is_set(other as usize) {
                        ctx.worklist.push(TreeShakeWork::File(other));
                    }
                }
            }
            return;
        }

        // HTML files can reference non-JS/CSS assets (favicons, images, etc.)
        // via .url kind import records. Follow all import records for HTML files
        // so these assets are marked live and included in the manifest.
        if self.parse_graph().input_files.items_loader()[source_index as usize] == Loader::Html {
            for record in ctx.import_records[source_index as usize].iter() {
                if record.source_index.is_valid() {
                    let other = record.source_index.get();
                    if !self.graph.files_live.is_set(other as usize) {
                        ctx.worklist.push(TreeShakeWork::File(other));
                    }
                }
            }
            return;
        }

        let parts = ctx.parts[source_index as usize].as_slice();
        for (part_index, part) in parts.iter().enumerate() {
            let mut can_be_removed_if_unused = part.can_be_removed_if_unused;

            if can_be_removed_if_unused && part.tag == bun_ast::PartTag::CommonjsNamedExport {
                if self.graph.meta.items_flags()[source_index as usize].wrap == WrapKind::Cjs {
                    can_be_removed_if_unused = false;
                }
            }

            // A destructuring of an import namespace reads like a member
            // access, which is side-effect free. The parser cannot see that
            // the initializer is a namespace, so refine its verdict here.
            if !can_be_removed_if_unused
                && self.part_is_removable_namespace_destructuring(source_index, part)
            {
                can_be_removed_if_unused = true;
            }

            // The automatic JSX runtime import is synthesized by the parser; it
            // exists only so lowered JSX can reference `jsx`/`jsxDEV`/etc. If no
            // live part references those symbols the import must not be kept
            // "for its side effects": the user never wrote it, and keeping it
            // would bundle (or externally import) React for JSX that was
            // entirely dead code. Liveness of the JSX import source, when it is
            // actually needed, is established via part.dependencies (step 6
            // wires the wrapper_ref/__toESM dependency onto this part), so
            // skipping the side-effect scan here is safe.
            if part.tag == bun_ast::PartTag::JsxImport {
                if !can_be_removed_if_unused
                    || (!part.force_tree_shaking
                        && !self.options.tree_shaking
                        && ctx.entry_point_kinds[source_index as usize].is_entry_point())
                {
                    let part_index = u32::try_from(part_index).expect("int cast");
                    if !ctx.parts_live[source_index as usize].is_set(part_index as usize) {
                        ctx.worklist.push(TreeShakeWork::Part {
                            part_index,
                            source_index,
                        });
                    }
                }
                continue;
            }

            // Also include any statement-level imports
            for &import_index in part.import_record_indices.iter() {
                let record = &ctx.import_records[source_index as usize][import_index as usize];
                if record.kind != ImportKind::Stmt {
                    continue;
                }
                let record_source_index = record.source_index;
                let is_external_without_side_effects = record
                    .flags
                    .contains(bun_ast::ImportRecordFlags::IS_EXTERNAL_WITHOUT_SIDE_EFFECTS);

                if record_source_index.is_valid() {
                    let other_source_index = record_source_index.get();

                    // Don't include this module for its side effects if it can be
                    // considered to have no side effects
                    if self.file_has_no_side_effects(other_source_index) {
                        continue;
                    }

                    // Otherwise, include this module for its side effects
                    if !self.graph.files_live.is_set(other_source_index as usize) {
                        ctx.worklist.push(TreeShakeWork::File(other_source_index));
                    }
                } else if is_external_without_side_effects {
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
            if !can_be_removed_if_unused
                || (!part.force_tree_shaking
                    && !self.options.tree_shaking
                    && ctx.entry_point_kinds[source_index as usize].is_entry_point())
            {
                let part_index = u32::try_from(part_index).expect("int cast");
                if !ctx.parts_live[source_index as usize].is_set(part_index as usize) {
                    ctx.worklist.push(TreeShakeWork::Part {
                        part_index,
                        source_index,
                    });
                }
            }
        }
    }

    fn mark_part_live_step(
        &mut self,
        ctx: &mut TreeShakeCtx<'a, '_>,
        part_index: crate::IndexInt,
        source_index: crate::IndexInt,
    ) {
        // only once — check the sidecar bitset first so the fast-path early
        // return does not have to load the 272-byte `Part`.
        {
            let bits = &mut ctx.parts_live[source_index as usize];
            if bits.is_set(part_index as usize) {
                return;
            }
            bits.set(part_index as usize);
        }

        #[cfg(debug_assertions)]
        {
            let part: &Part = &ctx.parts[source_index as usize].as_slice()[part_index as usize];
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
                if !stmts.is_empty() {
                    <&'static str>::from(stmts[0].data.tag())
                } else {
                    "s_empty"
                },
            );
        }

        // Include the file containing this part
        if !self.graph.files_live.is_set(source_index as usize) {
            ctx.worklist.push(TreeShakeWork::File(source_index));
        }

        let part = &ctx.parts[source_index as usize].as_slice()[part_index as usize];

        for dependency in part.dependencies.iter() {
            let dep_source = dependency.source_index.get();
            let dep_part = dependency.part_index;
            if !ctx.parts_live[dep_source as usize].is_set(dep_part as usize) {
                ctx.worklist.push(TreeShakeWork::Part {
                    part_index: dep_part,
                    source_index: dep_source,
                });
            }
        }

        // `scan_imports_and_exports` adds no wrapper dependency for external `import()`.
        if self.graph.code_splitting {
            let records = &ctx.import_records[source_index as usize];
            for &import_index in part.import_record_indices.iter() {
                let record = &records[import_index as usize];
                if record.source_index.is_valid()
                    && self.is_external_dynamic_import(record, source_index)
                {
                    let other = record.source_index.get();
                    if !self.graph.files_live.is_set(other as usize) {
                        ctx.worklist.push(TreeShakeWork::File(other));
                    }
                }
            }
        }
    }
} // end tree-shaking impl

// ══════════════════════════════════════════════════════════════════════════
// `scanImportsAndExports.rs` callees.
//
// `linker_context/scanImportsAndExports.rs` calls these `LinkerContext`
// methods inherently.
// ══════════════════════════════════════════════════════════════════════════

// Local imports. `AstFlags` / `DeclaredSymbolList`
// already imported at the top of the file.
use bun_ast::symbol::Use as SymbolUse;
use bun_ast::{DependencyList, ImportItemStatus, PartSymbolUseMap};

// `ImportTracker::{Status,Iterator}`'s canonical definition lives
// in `bundle_v2.rs`. Re-exported here so the 30+
// unqualified uses in `advance_import_tracker` / `match_import_with_export`
// below resolve unchanged.
pub(crate) use crate::bundle_v2::{ImportTrackerIterator, ImportTrackerStatus};

/// Field-wise eq for `ImportTracker`.
#[inline]
fn import_tracker_eq(a: &ImportTracker, b: &ImportTracker) -> bool {
    a.source_index.get() == b.source_index.get()
        && a.import_ref == b.import_ref
        && a.name_loc.start == b.name_loc.start
}

impl<'a> LinkerContext<'a> {
    /// Looks up the symbol `Ref` for a named export of the runtime module.
    #[inline]
    pub(crate) fn runtime_function(&self, name: &[u8]) -> Ref {
        self.graph.runtime_function(name)
    }

    /// Returns the part indices within file `id` that declare the
    /// top-level symbol `ref`.
    #[inline]
    pub(crate) fn top_level_symbols_to_parts(&self, id: u32, r#ref: Ref) -> &[u32] {
        self.graph.top_level_symbol_to_parts(id, r#ref)
    }

    /// Returns the part indices in the runtime module that declare the
    /// top-level symbol `ref`.
    #[inline]
    pub(crate) fn top_level_symbols_to_parts_for_runtime(&self, r#ref: Ref) -> &[u32] {
        self.top_level_symbols_to_parts(Index::RUNTIME.get(), r#ref)
    }

    /// Note: returns `'static` so callers can hold the source across a
    /// `&mut self.log` borrow; the underlying `parse_graph.input_files` slab
    /// is append-only and outlives the link step (LIFETIMES.tsv: GRAPHBACKED).
    #[inline]
    pub(crate) fn get_source<I: TryInto<usize>>(&self, index: I) -> &'static Source {
        // Note: callers pass both `u32` and
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

    /// `log` is an explicit parameter (not `self.log`) because the dev-server
    /// caller (`finish_from_bake_dev_server`) runs this *before* `load()` has
    /// initialized `self.log`, passing a stack-local `Log` instead.
    pub(crate) fn scan_css_imports(
        file_source_index: u32,
        file_import_records: &[ImportRecord],
        css_asts: *const [crate::bundled_ast::CssCol],
        sources: &[Source],
        loaders: &[Loader],
        log: &mut Log,
    ) -> ScanCssImportsResult {
        // SAFETY: `css_asts` points at the `graph.ast.items_css()` column for
        // the duration of `scan_imports_and_exports`; we only test `is_none()`.
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
                        | Loader::Xml
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

    /// Creates the synthetic wrapper part (CommonJS or ESM) for a wrapped
    /// file and records its part index in `wrapper_part_index`.
    pub(crate) fn create_wrapper_for_file(
        &mut self,
        wrap: WrapKind,
        wrapper_ref: Ref,
        // Note: `crate::Index` (`bun_ast::Index`),
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

                // Note: the inner loop is intentionally a no-op
                // (`if r#ref.eql(...) continue;` only).
                for &part_id in common_js_parts {
                    let runtime_parts =
                        self.graph.ast.items_parts()[Index::RUNTIME.get() as usize].as_slice();
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
                        let mut deps = DependencyList::init_capacity(common_js_parts.len());
                        for &part in common_js_parts {
                            deps.append_assume_capacity(Dependency {
                                part_index: part,
                                source_index: bun_ast::Index::RUNTIME,
                            });
                        }
                        deps
                    } else {
                        DependencyList::new_in(bun_alloc::AstAlloc)
                    };
                let mut symbol_uses = PartSymbolUseMap::default();
                symbol_uses
                    .put(wrapper_ref, SymbolUse::unscoped(1))
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
                        self.graph.ast.items_import_records()[source_index as usize].as_slice();
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
                    DependencyList::init_capacity(esm_parts.len() + promise_all_parts.len());
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
                    .put(wrapper_ref, SymbolUse::unscoped(1))
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

    /// Follows one step of an import chain: resolves what `tracker`'s import
    /// points to in the target file and reports the match status.
    /// `first_hop`: resolve export `alias` of file `source` directly instead of
    /// reading `tracker`'s `NamedImport` and following its import record (used
    /// by `bind_import_property_accesses`, which starts from a namespace it
    /// already resolved rather than from an import statement).
    pub(crate) fn advance_import_tracker(
        &mut self,
        tracker: &ImportTracker,
        first_hop: Option<(crate::IndexInt, bun_ast::StoreStr)>,
    ) -> ImportTrackerIterator {
        let id = tracker.source_index.get();
        let exports_kind: &[ExportsKind] = self.graph.ast.items_exports_kind();
        let ast_flags = self.graph.ast.items_flags();
        let is_import_stmt = first_hop.is_none();

        let (other_source_index, alias, alias_is_star, is_exported) = match first_hop {
            Some((source, alias)) => (source, Some(alias), false, false),
            None => {
                let named_import: &NamedImport = match self.graph.ast.items_named_imports()
                    [id as usize]
                    .get(&tracker.import_ref)
                {
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
                // Is this an external file?
                let record: &ImportRecord =
                    &import_records[named_import.import_record_index as usize];
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
                (
                    record.source_index.get(),
                    named_import.alias,
                    named_import.alias_is_star,
                    named_import.is_exported,
                )
            }
        };

        // Is this a disabled file?
        let other_id = other_source_index;

        if other_id as usize > self.graph.ast.len()
            || self.parse_graph().input_files.items_source()[other_source_index as usize]
                .path
                .is_disabled
        {
            return ImportTrackerIterator {
                value: ImportTracker {
                    source_index: crate::Index::init(other_source_index),
                    ..Default::default()
                },
                status: ImportTrackerStatus::Disabled,
                ..Default::default()
            };
        }

        let flags = ast_flags[other_id as usize];

        // Is this a named import of a file without any exports?
        if !alias_is_star
            && flags.contains(AstFlags::HAS_LAZY_EXPORT)
            // ESM exports
            && !flags.contains(AstFlags::USES_EXPORT_KEYWORD)
            // SAFETY: `alias` is an arena `*const [u8]` valid for the link pass.
            && alias.map(|a| a.slice() != b"default").unwrap_or(true)
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

        // The default import of a lifted CommonJS module is `module.exports`,
        // which is its namespace: bind it like `import * as X`. `ns.default` on
        // `import * as ns` (a generated item) reads the namespace object's own
        // `default` key when the module exports one.
        if is_import_stmt
            && !alias_is_star
            && flags.contains(AstFlags::COMMONJS_LIFTED_TO_ESM)
            && alias.is_some_and(|a| a.slice() == b"default")
            && !Self::lifted_default_import_needs_wrapper(
                self.graph.ast.items_module_type()[id as usize],
                &self.graph.ast.items_named_exports()[other_id as usize],
            )
            && !(self
                .graph
                .symbols
                .get_const(tracker.import_ref)
                .is_some_and(|s| s.import_item_status == ImportItemStatus::Generated)
                && self.graph.meta.items_resolved_exports()[other_id as usize]
                    .get(b"default")
                    .is_some())
        {
            let matching_export = &self.graph.meta.items_resolved_export_star()[other_id as usize];
            return ImportTrackerIterator {
                value: matching_export.data,
                status: ImportTrackerStatus::Found,
                import_data: bun_ptr::BackRef::new(
                    matching_export
                        .potentially_ambiguous_export_star_refs
                        .slice(),
                ),
                ..Default::default()
            };
        }

        // Match this import star with an export star from the imported file
        if alias_is_star {
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
                    ..Default::default()
                };
            }
        }

        // Match this import up with an export from the imported file
        if let Some(matching_export) = self.graph.meta.items_resolved_exports()[other_id as usize]
            .get(alias.expect("infallible: alias present").slice())
        {
            let default_alias_of = if alias.unwrap().slice() == b"default"
                && matching_export.data.source_index.get() == other_id
            {
                self.graph.ast.items_export_default_alias_of_import()[other_id as usize]
            } else {
                Ref::NONE
            };
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
                default_alias_of,
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
        if is_exported && other_loader.is_typescript() {
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

    /// Walks an import chain (through re-exports) to its final target and
    /// returns how the import should be bound, collecting any re-export
    /// dependencies along the way.
    pub(crate) fn match_import_with_export(
        &mut self,
        init_tracker: ImportTracker,
        re_exports: &mut bun_alloc::AstVec<Dependency>,
    ) -> MatchImport {
        self.match_import_with_export_inner(init_tracker, None, re_exports)
    }

    /// `first_hop`: see `advance_import_tracker`.
    fn match_import_with_export_inner(
        &mut self,
        init_tracker: ImportTracker,
        mut first_hop: Option<(crate::IndexInt, bun_ast::StoreStr)>,
        re_exports: &mut bun_alloc::AstVec<Dependency>,
    ) -> MatchImport {
        let cycle_detector_top = self.cycle_detector.len();
        // Note: `cycle_detector` is restored by an explicit
        // `truncate` after the `'loop_` below — the only
        // exits are the three `return`s that follow it, so a single post-loop
        // truncate covers every path. A scopeguard holding a raw `*mut` into
        // `self.cycle_detector` would be invalidated by the `&mut self`
        // reborrows inside the loop (Stacked Borrows), so we don't use one.

        let mut tracker = init_tracker;
        let mut ambiguous_results: Vec<MatchImport> = Vec::new();
        let mut result: MatchImport = MatchImport::default();
        // `export default X` with `X` an import: keep following `X`, but only
        // keep that answer if it ends at a module namespace (whose identity is
        // fixed, so the default's snapshot of it is the live value). Otherwise
        // restore the binding to the `default` variable itself.
        let mut default_alias_checkpoint: Option<(MatchImport, usize, usize)> = None;

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
            let is_first_hop_override = first_hop.is_some();
            let advanced = self.advance_import_tracker(&tracker, first_hop.take());
            let next_tracker = advanced.value;
            let status = advanced.status;
            let default_alias_of = advanced.default_alias_of;
            // The override hop has no `NamedImport` for the branches below to
            // report against; the caller pre-checked that the export exists.
            if is_first_hop_override && status != ImportTrackerStatus::Found {
                break 'loop_;
            }
            // While speculatively following `export default X`, anything but a
            // clean hop means the default keeps its own binding; bail before the
            // branches below log or mutate anything (the checkpoint restores).
            if default_alias_checkpoint.is_some() && status != ImportTrackerStatus::Found {
                break 'loop_;
            }
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

                    if named_import.namespace_ref.is_valid() {
                        if result.kind == MatchImportKind::Normal {
                            result.kind = MatchImportKind::NormalAndNamespace;
                            result.namespace_ref = named_import.namespace_ref;
                            result.alias = named_import.alias.expect("infallible: alias present");
                        } else {
                            result = MatchImport {
                                kind: MatchImportKind::Namespace,
                                namespace_ref: named_import.namespace_ref,
                                alias: named_import.alias.expect("infallible: alias present"),
                                ..Default::default()
                            };
                        }
                    }

                    // Warn about importing from a file that is known to not have any exports
                    if status == ImportTrackerStatus::CjsWithoutExports
                        && !self.is_call_record(prev_source_index, named_import.import_record_index)
                    {
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
                            source.range_of_identifier(named_import.alias_loc),
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

                    if named_import.namespace_ref.is_valid() {
                        // SAFETY: `named_import` borrows `graph.ast`; the symbol slot is a
                        // disjoint allocation, so no aliasing with this `&mut`.
                        let symbol = unsafe { self.graph.symbol_mut(tracker.import_ref) };
                        symbol.import_item_status = ImportItemStatus::Missing;
                        result.kind = MatchImportKind::NormalAndNamespace;
                        result.namespace_ref = tracker.import_ref;
                        result.alias = named_import.alias.expect("infallible: alias present");
                        result.name_loc = named_import.alias_loc;
                    }
                }

                ImportTrackerStatus::DynamicFallback => {
                    // If it's a file with dynamic export fallback, rewrite the import to a property access
                    let named_import: &NamedImport = self.graph.ast.items_named_imports()
                        [prev_source_index as usize]
                        .get(&tracker.import_ref)
                        .unwrap();
                    if named_import.namespace_ref.is_valid() {
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
                    // SAFETY: the mutated symbol slot is disjoint from the later borrows
                    // (`named_import` from graph.ast, `get_source` from parse_graph,
                    // `log_disjoint`) — all separate allocations.
                    let symbol = unsafe { self.graph.symbol_mut(tracker.import_ref) };
                    let named_import: &NamedImport = self.graph.ast.items_named_imports()
                        [prev_source_index as usize]
                        .get(&tracker.import_ref)
                        .unwrap();
                    let source = self.get_source(prev_source_index);

                    let next_source = self.get_source(next_tracker.source_index.get());
                    let r = source.range_of_identifier(named_import.alias_loc);
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

                        // A name read off `import()` / `require()` is `undefined`
                        // at run time too, so there is nothing to say.
                        if self.is_call_record(prev_source_index, named_import.import_record_index)
                        {
                        } else if self.resolver().opts.target == Target::Browser
                            && bun_resolve_builtins::Alias::has(
                                next_source.path.pretty,
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

                    if default_alias_of.is_valid() {
                        if default_alias_checkpoint.is_none() {
                            default_alias_checkpoint =
                                Some((result.clone(), re_exports.len(), ambiguous_results.len()));
                        }
                        tracker = ImportTracker {
                            source_index: next_tracker.source_index,
                            import_ref: default_alias_of,
                            name_loc: next_tracker.name_loc,
                        };
                        continue 'loop_;
                    }
                }
            }

            break 'loop_;
        }

        // Spec `defer`: restore cycle_detector to its entry length now that the
        // loop is done. All remaining exit paths are below this point.
        self.cycle_detector.truncate(cycle_detector_top);

        if let Some((default_result, re_exports_len, ambiguous_len)) = default_alias_checkpoint
            && !(result.kind == MatchImportKind::Normal
                && self.is_esm_namespace_ref(result.source_index, result.r#ref))
        {
            result = default_result;
            re_exports.truncate(re_exports_len);
            ambiguous_results.truncate(ambiguous_len);
        }

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

    pub(crate) fn export_runtime_function(&self) -> &'static [u8] {
        if self.options.deprecated_namespace_object_setters {
            b"__export"
        } else {
            b"__exportGetters"
        }
    }

    /// Is `ref_` the `exports` object of ES module `source_index` (i.e. an
    /// import that resolved here is that module's namespace)?
    /// The record of a named import in `source_index` is an `import()` or a
    /// `require()`, so the name is read off the call's result.
    fn is_call_record(&self, source_index: crate::IndexInt, record_index: u32) -> bool {
        self.graph.ast.items_import_records()[source_index as usize]
            .as_slice()
            .get(record_index as usize)
            .is_some_and(|record| matches!(record.kind, ImportKind::Dynamic | ImportKind::Require))
    }

    /// An item read off an `import()` / `require()` result is bound only to an
    /// export the importer may read directly. Otherwise it reads as written:
    /// `ns.a` off the namespace object, or the local a pattern binds.
    fn call_record_binds(&self, source_index: crate::IndexInt, record_index: u32) -> bool {
        let record = &self.graph.ast.items_import_records()[source_index as usize].as_slice()
            [record_index as usize];
        // Its own chunk: the name is a binding of the loaded module.
        record.source_index.is_valid()
            && !self.is_external_dynamic_import(record, source_index)
            // `require()` returns this export, not the namespace.
            && !(record.kind == ImportKind::Require
                && self.graph.meta.items_resolved_exports()[record.source_index.get() as usize]
                    .contains(b"module.exports"))
    }

    /// Whether the export an item of such a record matched can stand in for it.
    fn binds_call_item(&self, import_ref: Ref, result: &MatchImport) -> bool {
        // A lifted CommonJS export changes through `exports.x = …`, which the
        // parser does not record as an assignment.
        if !matches!(result.kind, MatchImportKind::Normal)
            || self.graph.ast.items_flags()[result.source_index as usize]
                .contains(AstFlags::COMMONJS_LIFTED_TO_ESM)
        {
            return false;
        }
        // `ns.a` is a live read, but a pattern copies the value: a local it
        // binds stays a copy of an export that can change.
        let is_pattern_local = self
            .graph
            .symbols
            .get_const(import_ref)
            .is_some_and(|symbol| symbol.namespace_alias.is_none());
        !is_pattern_local
            || !self
                .graph
                .symbols
                .get_const(result.r#ref)
                .is_some_and(|symbol| {
                    // A direct `eval` in the exporting file can assign it too.
                    symbol.has_been_assigned_to() || symbol.must_not_be_renamed()
                })
    }

    /// Must `X.name()` keep `X` as `this`, where `X.name` is export `ref_`?
    fn method_call_needs_this(&self, source_index: crate::IndexInt, ref_: Ref) -> bool {
        self.graph.ast.items_flags()[source_index as usize]
            .contains(AstFlags::COMMONJS_LIFTED_TO_ESM)
            && !self
                .graph
                .symbols
                .get_const(ref_)
                .is_some_and(|symbol| symbol.call_ignores_this())
    }

    /// `ns.name()` for `import * as ns`. An unbound item prints as `ns.name`.
    fn method_call_item_needs_this(
        &self,
        import_ref: Ref,
        named_import: &NamedImport,
        result: &MatchImport,
    ) -> bool {
        self.options.output_format != Format::InternalBakeDev
            && named_import.namespace_ref.is_valid()
            && self
                .graph
                .symbols
                .get_const(import_ref)
                .is_some_and(|symbol| symbol.called_as_method() && symbol.namespace_alias.is_some())
            && self.method_call_needs_this(result.source_index, result.r#ref)
    }

    fn is_esm_namespace_ref(&self, source_index: crate::IndexInt, ref_: Ref) -> bool {
        let id = source_index as usize;
        id < self.graph.ast.len()
            && ref_ == self.graph.ast.items_exports_ref()[id]
            && matches!(
                self.graph.ast.items_exports_kind()[id],
                ExportsKind::Esm
                    | ExportsKind::EsmWithDynamicFallback
                    | ExportsKind::EsmWithDynamicFallbackFromCjs
            )
            && self.graph.meta.items_flags()[id].wrap != WrapKind::Cjs
    }

    /// The default import of a lifted module that sets `__esModule` and exports
    /// `default` depends on the flag's run-time value, unless the importer is an
    /// ES module by type (Node ignores the flag).
    pub(crate) fn lifted_default_import_needs_wrapper(
        importer_module_type: crate::options::ModuleType,
        exports: &crate::bundled_ast::NamedExports,
    ) -> bool {
        importer_module_type != crate::options::ModuleType::Esm
            && exports.contains(b"__esModule")
            && exports.contains(b"default")
    }

    /// `const { a } = ns` where `ns` is an import namespace. The parser
    /// keeps such a part because a pattern over an arbitrary object can run
    /// getters, but the linker knows `ns` is a module namespace, so every
    /// key reads like `ns.a` and is side-effect free. True when each
    /// declaration destructures plain string keys into identifiers (no
    /// computed key, no rest, no default, no nested pattern) out of an
    /// import namespace.
    fn part_is_removable_namespace_destructuring(
        &self,
        source_index: crate::IndexInt,
        part: &Part,
    ) -> bool {
        // With a direct eval() in the file, the parser pins every
        // symbol-declaring part: eval'd code can reference the bindings.
        if self.graph.ast.items_module_scope()[source_index as usize].contains_direct_eval {
            return false;
        }
        let stmts = part.stmts.slice();
        if stmts.is_empty() {
            return false;
        }
        stmts.iter().all(|stmt| {
            let bun_ast::StmtData::SLocal(local) = &stmt.data else {
                return false;
            };
            if matches!(
                local.kind,
                bun_ast::s::Kind::KUsing | bun_ast::s::Kind::KAwaitUsing
            ) {
                return false;
            }
            local.decls.slice().iter().all(|decl| {
                let bun_ast::b::B::BObject(pattern) = decl.binding.data else {
                    return false;
                };
                let Some(value) = &decl.value else {
                    return false;
                };
                if !self.value_is_import_namespace(source_index, value) {
                    return false;
                }
                pattern.properties().iter().all(|property| {
                    !property.flags.contains(bun_ast::flags::Property::IsSpread)
                        && !property
                            .flags
                            .contains(bun_ast::flags::Property::IsComputed)
                        && property.default_value.is_none()
                        && matches!(property.key.data, bun_ast::ExprData::EString(_))
                        && matches!(property.value.data, bun_ast::b::B::BIdentifier(_))
                })
            })
        })
    }

    /// Does `value` evaluate to a module namespace: a star import's binding,
    /// an import that resolved to another module's namespace (`export * as`),
    /// or a `require()` that `unwrap_commonjs_to_esm` turned into an import?
    fn value_is_import_namespace(&self, source_index: crate::IndexInt, value: &Expr) -> bool {
        let id = source_index as usize;
        let ref_ = match &value.data {
            bun_ast::ExprData::EIdentifier(identifier) => identifier.ref_,
            // A named import that holds a namespace (`export * as`) prints as
            // an import identifier.
            bun_ast::ExprData::EImportIdentifier(identifier) => identifier.ref_,
            bun_ast::ExprData::ERequireString(require) => {
                return require.unwrapped_id.get().is_some();
            }
            _ => return false,
        };
        // A require() lifted into an import binds an ordinary local, so user
        // code can rebind it to an object with getters. Only a binding that
        // is never assigned still holds the namespace. A `var` can also be
        // re-initialized by a duplicate declaration or a `for (var ns of ..)`
        // head, which the parser does not record as an assignment, so a
        // hoisted symbol is never trusted.
        match self.graph.symbols.get_const(ref_) {
            Some(symbol)
                if !symbol.has_been_assigned_to()
                    && !matches!(
                        symbol.kind,
                        bun_ast::symbol::Kind::Hoisted | bun_ast::symbol::Kind::HoistedFunction
                    ) => {}
            _ => return false,
        }
        if let Some(named_import) = self.graph.ast.items_named_imports()[id].get(&ref_) {
            if named_import.alias_is_star {
                return true;
            }
        }
        if let Some(import_data) = self.graph.meta.items_imports_to_bind()[id].get(&ref_) {
            let target = import_data.data;
            return self.is_esm_namespace_ref(target.source_index.get(), target.import_ref);
        }
        false
    }

    /// The chunk of a lifted CommonJS module exports its namespace object as `default`.
    pub(crate) fn chunk_default_export_is_namespace(
        meta_flags: crate::js_meta::Flags,
        ast_flags: AstFlags,
    ) -> bool {
        meta_flags.needs_synthetic_default_export
            && meta_flags.wrap != WrapKind::Cjs
            && ast_flags.contains(AstFlags::COMMONJS_LIFTED_TO_ESM)
    }

    /// Resolves every named import in one file to its matching export,
    /// recording the bindings in `imports_to_bind`.
    pub(crate) fn match_imports_with_exports_for_file(
        &mut self,
        named_imports_ptr: *const crate::bundled_ast::NamedImports,
        imports_to_bind: &mut crate::RefImportData,
        source_index: crate::IndexInt,
        member_resolutions: &mut ImportMemberResolutions,
    ) {
        // Note: `ArrayHashMap` has no in-place key sort and `NamedImport` is
        // non-Clone (owns a `Vec`), so we sort an index vector over the live
        // keys/values instead — same observable iteration order (ascending
        // `inner_index`). We never mutate the map.
        //
        // This parameter aliases
        // `self.graph.ast.named_imports[source_index]`, which
        // `match_import_with_export` re-reads via the SoA column. Taking the
        // parameter as a raw `*const` (no uniqueness assertion) and reading
        // through it preserves that alias-safety: no live
        // `&`/`&mut` to the column element spans the `&mut self` call below.
        //
        // SAFETY: `named_imports_ptr` points into the `graph.ast.named_imports`
        // SoA column, which is never reallocated during linking; the loop body
        // never mutates that column (only `imports_to_bind`/`log`/`symbols`/
        // `meta.probably_typescript_type`), so the backing `keys`/`values`
        // slices stay valid for the whole loop.
        let keys: *const [Ref] = unsafe { (*named_imports_ptr).keys() };
        // SAFETY: same column-validity invariant as `keys` above.
        let values: *const [NamedImport] = unsafe { (*named_imports_ptr).values() };
        // SAFETY: `keys` points into stable SoA storage (see above); read-only deref.
        let mut order = index_sort::identity(unsafe { (&*keys).len() });
        // SAFETY: `keys` points into stable SoA storage (see above); read-only deref.
        index_sort::sort_indices(&mut order, &mut |a, b| unsafe {
            (&*keys)[a as usize]
                .inner_index()
                .cmp(&(&*keys)[b as usize].inner_index())
        });

        // Items of `ns.name()` left unbound, each with its `ns`.
        let mut method_call_items: HashMap<Ref, Ref> = HashMap::default();
        for &i in &order {
            let i = i as usize;
            // SAFETY: `keys`/`values` point into stable SoA storage (see above); read-only deref.
            let (import_ref, named_import) = unsafe { ((*keys)[i], &(*values)[i]) };

            // Not matched at all: matching marks a name it can't find `Missing`,
            // which prints `undefined` where the read should stay `ns.a`.
            let is_call_item = self.is_call_record(source_index, named_import.import_record_index);
            if is_call_item
                && !self.call_record_binds(source_index, named_import.import_record_index)
            {
                continue;
            }

            // Re-use memory for the cycle detector
            self.cycle_detector.clear();

            let mut re_exports: bun_alloc::AstVec<Dependency> = bun_alloc::AstAlloc::vec();
            let result = self.match_import_with_export(
                ImportTracker {
                    source_index: crate::Index::init(source_index),
                    import_ref,
                    ..Default::default()
                },
                &mut re_exports,
            );

            if is_call_item && !self.binds_call_item(import_ref, &result) {
                continue;
            }

            match result.kind {
                MatchImportKind::Normal
                    if self.method_call_item_needs_this(import_ref, named_import, &result) =>
                {
                    method_call_items.insert(import_ref, named_import.namespace_ref);
                }
                MatchImportKind::Normal | MatchImportKind::NormalAndNamespace => {
                    self.bind_matched_import(imports_to_bind, import_ref, &result, re_exports);
                }
                MatchImportKind::Namespace => {
                    // SAFETY: the mutated symbol slot is disjoint from `named_import`
                    // (graph.ast SoA) and `result` (stack local).
                    unsafe { self.graph.symbol_mut(import_ref) }.namespace_alias =
                        Some(bun_alloc::ast_box(G::NamespaceAlias {
                            namespace_ref: result.namespace_ref,
                            alias: result.alias,
                            ..Default::default()
                        }));
                }
                MatchImportKind::Cycle => {
                    let source = self.get_source(source_index);
                    let r = lex::range_of_identifier(source, named_import.alias_loc);
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
                    let r = lex::range_of_identifier(source, named_import.alias_loc);

                    // TODO: log locations of the ambiguous exports

                    // SAFETY: the mutated symbol slot is disjoint from `source`/`r`
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

        // A part that calls such an item reads its namespace.
        if !method_call_items.is_empty() {
            let mut namespace_uses: Vec<(Ref, u32)> = Vec::new();
            for part in self.graph.ast.items_parts_mut()[source_index as usize].as_mut_slice() {
                namespace_uses.clear();
                for (item, item_use) in part
                    .symbol_uses
                    .keys()
                    .iter()
                    .zip(part.symbol_uses.values())
                {
                    if item_use.count_estimate() == 0 {
                        continue;
                    }
                    if let Some(&namespace_ref) = method_call_items.get(item) {
                        namespace_uses.push((namespace_ref, item_use.count_estimate()));
                    }
                }
                for &(namespace_ref, count) in &namespace_uses {
                    part.symbol_uses
                        .get_or_put_value(namespace_ref, Default::default())
                        .expect("OOM")
                        .value_ptr
                        .merge(SymbolUse::unscoped(count));
                }
            }
        }

        self.bind_import_property_accesses(source_index, imports_to_bind, member_resolutions);
    }

    /// `import X from './a'; X.foo` where `X` resolved to the namespace of an
    /// ES module (`export * as X`, `import * as X; export { X }`,
    /// `export default X`, `export * as default from '.'`): bind `X.foo` to
    /// that module's export `foo` as if it had been a named import, so the
    /// namespace object need not be materialized and unused exports still
    /// tree-shake. The parser recorded these accesses per part in
    /// `import_symbol_property_uses`; `do_step5` moves their use counts from
    /// `X` to the new symbol and the printer substitutes it at the `E::Dot`.
    fn bind_import_property_accesses(
        &mut self,
        source_index: crate::IndexInt,
        imports_to_bind: &mut crate::RefImportData,
        member_resolutions: &mut ImportMemberResolutions,
    ) {
        if self.options.output_format == Format::InternalBakeDev {
            return;
        }
        /// One `X.name` read that can bind to an export.
        struct PropertyAccess {
            part_index: usize,
            base: Ref,
            target_source: crate::IndexInt,
            name: bun_ast::StoreStr,
            count: u32,
            is_call_target: bool,
        }

        let id = source_index as usize;
        let parts_len = self.graph.ast.items_parts()[id].len();
        let mut accesses: Vec<PropertyAccess> = Vec::new();
        for part_index in 0..parts_len {
            let part = &self.graph.ast.items_parts()[id].as_slice()[part_index];
            let Some(uses) = part.import_symbol_property_uses.as_ref() else {
                continue;
            };
            for (base, properties) in uses.keys().iter().zip(uses.values()) {
                let Some(import_data) = imports_to_bind.get(base) else {
                    continue;
                };
                let target = import_data.data;
                let target_source = target.source_index.get();
                if !self.is_esm_namespace_ref(target_source, target.import_ref) {
                    continue;
                }
                let resolved_exports =
                    &self.graph.meta.items_resolved_exports()[target_source as usize];
                for (name, prop_use) in properties.iter() {
                    // Not a static export of the target (missing, or only reachable
                    // through `export *` from CommonJS): keep the property access.
                    let name = if let Some(index) = resolved_exports.get_index(name) {
                        bun_ast::StoreStr::new(&resolved_exports.keys()[index])
                    } else if &**name == b"default"
                        && self.graph.ast.items_flags()[target_source as usize]
                            .contains(AstFlags::COMMONJS_LIFTED_TO_ESM)
                        && !Self::lifted_default_import_needs_wrapper(
                            self.graph.ast.items_module_type()[id],
                            &self.graph.ast.items_named_exports()[target_source as usize],
                        )
                    {
                        // `default` of a lifted CommonJS module is `module.exports`, the
                        // namespace itself, the same as `ns.default` on `import * as ns`.
                        let name = bun_ast::StoreStr::new(b"default");
                        member_resolutions
                            .entry((target_source, name))
                            .or_insert_with(|| {
                                Some(ImportMemberResolution {
                                    source_index: target_source,
                                    r#ref: target.import_ref,
                                    re_exports: Vec::new(),
                                })
                            });
                        name
                    } else {
                        continue;
                    };
                    accesses.push(PropertyAccess {
                        part_index,
                        base: *base,
                        target_source,
                        name,
                        count: prop_use.count_estimate,
                        is_call_target: prop_use.is_call_target,
                    });
                }
            }
        }

        for access in &accesses {
            let key = (access.target_source, access.name);
            if member_resolutions.contains_key(&key) {
                continue;
            }
            self.cycle_detector.clear();
            let mut re_exports: bun_alloc::AstVec<Dependency> = bun_alloc::AstAlloc::vec();
            let result = self.match_import_with_export_inner(
                ImportTracker {
                    source_index: crate::Index::init(access.target_source),
                    ..Default::default()
                },
                Some(key),
                &mut re_exports,
            );
            let resolved = match result.kind {
                MatchImportKind::Normal | MatchImportKind::NormalAndNamespace => {
                    Some(ImportMemberResolution {
                        source_index: result.source_index,
                        r#ref: result.r#ref,
                        re_exports: re_exports.to_vec(),
                    })
                }
                _ => None,
            };
            member_resolutions.insert(key, resolved);
        }

        // The printer substitutes a binding at each `X.name` of the file, so a
        // call that needs `X` as `this` keeps every `X.name` of the file.
        let mut keeps_this: Vec<(Ref, bun_ast::StoreStr)> = Vec::new();
        for access in &accesses {
            if access.is_call_target
                && let Some(resolved) = member_resolutions
                    .get(&(access.target_source, access.name))
                    .unwrap()
                && self.method_call_needs_this(resolved.source_index, resolved.r#ref)
            {
                keeps_this.push((access.base, access.name));
            }
        }

        let mut dependencies: Vec<Dependency> = Vec::new();
        let mut bound_bases: Vec<Ref> = Vec::new();
        for part_accesses in accesses.chunk_by(|a, b| a.part_index == b.part_index) {
            let part_index = part_accesses[0].part_index;
            dependencies.clear();
            bound_bases.clear();
            for access in part_accesses {
                let (base, name, count) = (access.base, access.name, access.count);
                if keeps_this.contains(&(base, name)) {
                    continue;
                }
                let Some(resolved) = member_resolutions
                    .get(&(access.target_source, name))
                    .unwrap()
                else {
                    continue;
                };

                if !bound_bases.contains(&base) {
                    // First bound member of `base` in this part: depend on this
                    // file's import statement for `base` and on the re-exports
                    // walked to resolve `base` itself, once.
                    bound_bases.push(base);
                    dependencies
                        .extend_from_slice(imports_to_bind.get(&base).unwrap().re_exports.slice());
                    for &part in self.top_level_symbols_to_parts(source_index, base) {
                        dependencies.push(Dependency {
                            source_index: bun_ast::Index::source(id),
                            part_index: part,
                        });
                    }
                }
                // `name` points into `resolved_exports` keys, which outlive printing.
                self.graph
                    .import_member_bindings
                    .get_or_put_value(base, Default::default())
                    .expect("OOM")
                    .value_ptr
                    .put_static_key(name.slice(), resolved.r#ref)
                    .expect("OOM");

                // From here on this is an ordinary use of the target's symbol by this
                // part: move the use count over, record it as an import of this file
                // so code splitting sees it, and depend on what a named import would
                // — the parts declaring it, the re-exports walked to reach it, and
                // this file's own import statement for `base`.
                {
                    let part = &mut self.graph.ast.items_parts_mut()[id].as_mut_slice()[part_index];
                    let uses = part.import_symbol_property_uses.as_mut().unwrap();
                    let _ = uses.get_ptr_mut(&base).unwrap().remove(name.slice());
                    part.symbol_uses
                        .get_or_put_value(resolved.r#ref, Default::default())
                        .expect("OOM")
                        .value_ptr
                        .merge(SymbolUse::unscoped(count));
                }
                if resolved.source_index != source_index
                    && !imports_to_bind.contains(&resolved.r#ref)
                {
                    imports_to_bind
                        .put(
                            resolved.r#ref,
                            crate::ImportData {
                                data: ImportTracker {
                                    source_index: crate::Index::init(resolved.source_index),
                                    import_ref: resolved.r#ref,
                                    ..Default::default()
                                },
                                ..Default::default()
                            },
                        )
                        .expect("OOM");
                }
                for &part in self.top_level_symbols_to_parts(resolved.source_index, resolved.r#ref)
                {
                    dependencies.push(Dependency {
                        source_index: bun_ast::Index::source(resolved.source_index as usize),
                        part_index: part,
                    });
                }
                dependencies.extend_from_slice(&resolved.re_exports);
            }
            if !dependencies.is_empty() {
                let part = &mut self.graph.ast.items_parts_mut()[id].as_mut_slice()[part_index];
                for &dependency in &dependencies {
                    part.dependencies.push(dependency);
                }
            }
        }
    }

    /// Records a `Normal`/`NormalAndNamespace` match for `import_ref`.
    fn bind_matched_import(
        &mut self,
        imports_to_bind: &mut crate::RefImportData,
        import_ref: Ref,
        result: &MatchImport,
        re_exports: bun_alloc::AstVec<Dependency>,
    ) {
        imports_to_bind
            .put(
                import_ref,
                crate::ImportData {
                    re_exports,
                    data: ImportTracker {
                        source_index: crate::Index::init(result.source_index),
                        import_ref: result.r#ref,
                        ..Default::default()
                    },
                },
            )
            .expect("unreachable");
        if result.kind == MatchImportKind::NormalAndNamespace {
            self.graph
                .symbols
                .get_mut(import_ref)
                .unwrap()
                .namespace_alias = Some(bun_alloc::ast_box(G::NamespaceAlias {
                namespace_ref: result.namespace_ref,
                alias: result.alias,
                ..Default::default()
            }));
        }
    }

    /// Thin inherent-method shim so callers can write
    /// `this.generate_code_for_lazy_export(id)`. The full body —
    /// including the CSS-modules `composes`/`local_scope` Visitor — lives in
    /// `linker_context/generateCodeForLazyExport.rs`.
    #[inline]
    pub(crate) fn generate_code_for_lazy_export(
        &mut self,
        source_index: crate::IndexInt,
    ) -> Result<(), AllocError> {
        crate::linker_context::generate_code_for_lazy_export::generate_code_for_lazy_export(
            self,
            source_index,
        )
    }

    /// Synthesizes a named export symbol in a file (creating a new part for
    /// it) and returns the symbol's `Ref` and the part index.
    pub(crate) fn generate_named_export_in_file(
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
        top_level.put(r#ref, bun_alloc::AstAlloc::vec_from_slice(&[part_index]))?;

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

    pub(crate) fn break_output_into_pieces(
        &self,
        _alloc: *const Bump,
        j: &mut StringJoiner<'static>,
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

        let mut pieces: Vec<OutputPiece> = Vec::with_capacity(count as usize);
        // Note: `StringJoiner::done()`
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
                    bun_core::debug_warn!("Invalid output piece boundary");
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
                        bun_core::debug_warn!("Invalid output piece boundary");
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
                            bun_core::debug_warn!("Invalid output piece boundary");
                        }
                        break;
                    }
                }
                crate::chunk::QueryKind::Chunk | crate::chunk::QueryKind::ChunkId => {
                    if index >= count as usize {
                        if cfg!(debug_assertions) {
                            bun_core::debug_warn!("Invalid output piece boundary");
                        }
                        break;
                    }
                }
                crate::chunk::QueryKind::HtmlImport => {
                    if index >= self.parse_graph().html_imports.server_source_indices.len() as usize
                    {
                        if cfg!(debug_assertions) {
                            bun_core::debug_warn!("Invalid output piece boundary");
                        }
                        break;
                    }
                }
                _ => unreachable!(),
            }

            // Note: `Query` is a packed `u32` (`index: u29`, `kind: u3`);
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

// PartialEq for MatchImport (used by match_import_with_export)
impl PartialEq for MatchImport {
    fn eq(&self, other: &Self) -> bool {
        // Note: intentionally compares the raw fat pointer
        // (address + length metadata), not contents.
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
    // Temporary scratch buffers: plain `Vec`s on the global allocator
    // (cleared/reused per chunk, freed by Drop).
    pub(crate) inside_wrapper_prefix: InsideWrapperPrefix,
    pub(crate) outside_wrapper_prefix: Vec<Stmt>,
    pub(crate) inside_wrapper_suffix: Vec<Stmt>,
    pub(crate) all_stmts: Vec<Stmt>,
}

pub struct InsideWrapperPrefix {
    pub(crate) stmts: Vec<Stmt>,
    pub(crate) sync_dependencies_end: usize,
    // if true it will exist at `sync_dependencies_end`
    pub(crate) has_async_dependency: bool,
}

impl InsideWrapperPrefix {
    fn init() -> Self {
        Self {
            stmts: Vec::new(),
            sync_dependencies_end: 0,
            has_async_dependency: false,
        }
    }

    // deinit → Drop (Vec frees automatically); reset is explicit

    pub(crate) fn reset(&mut self) {
        self.stmts.clear();
        self.sync_dependencies_end = 0;
        self.has_async_dependency = false;
    }
}

impl InsideWrapperPrefix {
    pub(crate) fn append_non_dependency(&mut self, stmt: Stmt) -> Result<(), AllocError> {
        self.stmts.push(stmt);
        Ok(())
    }

    pub(crate) fn append_non_dependency_slice(&mut self, stmts: &[Stmt]) -> Result<(), AllocError> {
        self.stmts.extend_from_slice(stmts);
        Ok(())
    }

    fn append_sync_dependency(&mut self, call_expr: Expr) -> Result<(), AllocError> {
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

    fn append_async_dependency(
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

        // Note: deep AST mutation chain — `s_expr_mut`/`e_await_mut`/
        // `e_call_mut`/`e_array_mut` return `Option`; `.unwrap()` panics on
        // shape mismatch.
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

            let mut args = bun_ast::ExprNodeList::init_capacity(1);
            args.append_assume_capacity(Expr::init(
                E::Array {
                    items,
                    ..Default::default()
                },
                Loc::EMPTY,
            ));

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
    pub(crate) fn reset(&mut self) {
        self.inside_wrapper_prefix.reset();
        self.outside_wrapper_prefix.clear();
        self.inside_wrapper_suffix.clear();
        self.all_stmts.clear();
    }

    // deinit → Drop (Vec fields free automatically)

    pub(crate) fn init() -> Self {
        Self {
            inside_wrapper_prefix: InsideWrapperPrefix::init(),
            outside_wrapper_prefix: Vec::new(),
            inside_wrapper_suffix: Vec::new(),
            all_stmts: Vec::new(),
        }
    }

    pub(crate) fn append_slice(&mut self, list: StmtListWhich, stmts: &[Stmt]) {
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

    pub(crate) fn append(&mut self, list: StmtListWhich, stmt: Stmt) {
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
