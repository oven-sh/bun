use crate::bundled_ast;
use crate::mal_prelude::*;
use bun_alloc::Arena;
use bun_ast::ImportKind;
use bun_ast::base::RefTag;
use bun_ast::server_component_boundary;
use bun_ast::symbol;
use bun_ast::{DeclaredSymbol, DeclaredSymbolList, Dependency, Symbol};
use bun_collections::{AutoBitSet, DynamicBitSetUnmanaged as BitSet, MultiArrayList, VecExt};
use bun_core::RawSlice;

use crate::IndexStringMap::IndexStringMap;
use crate::{ImportTracker, Index, JSAst, Part, Ref, UseDirective, import_record, index, part};
// `items_<field>()` column accessors — bring the `*ListExt` traits into scope.
// Note: `BundledAstColumns` is emitted by `bun_collections::multi_array_columns!`
// on `BundledAst` in `crate::bundled_ast` (the same macro output
// `scanImportsAndExports.rs` already imports as `BundledAstField`).
bun_core::declare_scope!(LinkerGraph, visible);

pub mod entry_point {
    use bun_collections::MultiArrayList;
    use bun_core::RawSlice;

    #[derive(Default)]
    pub struct EntryPoint {
        pub output_path: RawSlice<u8>,
        pub source_index: crate::IndexInt,
    }

    pub type List = MultiArrayList<EntryPoint>;

    bun_collections::multi_array_columns! {
        pub trait EntryPointColumns for EntryPoint {
            output_path: RawSlice<u8>,
            source_index: crate::IndexInt,
        }
    }

    impl EntryPoint {
        pub type Kind = Kind;
    }

    #[repr(u8)]
    #[derive(Clone, Copy, PartialEq, Eq, Default)]
    pub enum Kind {
        #[default]
        None,
        UserSpecified,
        DynamicImport,
        Html,
    }
    impl Kind {
        #[inline]
        pub fn is_entry_point(self) -> bool {
            self != Self::None
        }
        #[inline]
        pub fn output_kind(self) -> crate::options::OutputKind {
            match self {
                Self::UserSpecified => crate::options::OutputKind::EntryPoint,
                _ => crate::options::OutputKind::Chunk,
            }
        }
    }
}

pub mod js_meta {
    use bun_alloc::{AstAlloc, AstVec};
    use bun_ast::{Dependency, Ref};
    use bun_collections::array_hash_map::StringContext;
    use bun_collections::{ArrayHashMap, AutoContext, StringArrayHashMap};

    use crate::{ImportTracker, Index, WrapKind};

    pub struct ImportData {
        pub(crate) re_exports: AstVec<Dependency>,
        pub(crate) data: ImportTracker,
    }
    impl Default for ImportData {
        fn default() -> Self {
            Self {
                re_exports: AstAlloc::vec(),
                data: ImportTracker::default(),
            }
        }
    }
    pub(crate) type ImportToBind = ImportData;

    pub struct ExportData {
        pub(crate) potentially_ambiguous_export_star_refs: AstVec<ImportData>,
        pub(crate) data: ImportTracker,
    }
    impl Default for ExportData {
        fn default() -> Self {
            Self {
                potentially_ambiguous_export_star_refs: AstAlloc::vec(),
                data: ImportTracker::default(),
            }
        }
    }
    pub(crate) type ResolvedExport = ExportData;

    pub type RefImportData = ArrayHashMap<Ref, ImportData, AutoContext, AstAlloc>;
    pub type ResolvedExports = StringArrayHashMap<ExportData, StringContext, AstAlloc>;
    pub type ProbablyTypescriptType = ArrayHashMap<Ref, (), AutoContext, AstAlloc>;
    pub type SortedAndFilteredExportAliases = AstVec<Box<[u8], AstAlloc>>;
    pub type CjsExportCopies = AstVec<Ref>;
    pub type TopLevelSymbolToParts = bun_ast::ast_result::TopLevelSymbolToParts;

    #[derive(Clone, Copy, Default)]
    pub struct Flags {
        pub(crate) is_async_or_has_async_dependency: bool,
        pub(crate) needs_exports_variable: bool,
        pub(crate) force_include_exports_for_entry_point: bool,
        pub(crate) needs_export_symbol_from_runtime: bool,
        pub(crate) did_wrap_dependencies: bool,
        pub(crate) needs_synthetic_default_export: bool,
        pub(crate) wrap: WrapKind,
    }
    pub use crate::WrapKind as Wrap;

    pub struct JSMeta {
        pub probably_typescript_type: ProbablyTypescriptType,
        pub imports_to_bind: RefImportData,
        pub resolved_exports: ResolvedExports,
        pub resolved_export_star: ExportData,
        pub sorted_and_filtered_export_aliases: SortedAndFilteredExportAliases,
        pub top_level_symbol_to_parts_overlay: TopLevelSymbolToParts,
        pub cjs_export_copies: CjsExportCopies,
        pub wrapper_part_index: Index,
        pub entry_point_part_index: Index,
        pub flags: Flags,
    }

    impl Default for JSMeta {
        fn default() -> Self {
            Self {
                probably_typescript_type: ProbablyTypescriptType::default(),
                imports_to_bind: RefImportData::default(),
                resolved_exports: ResolvedExports::default(),
                resolved_export_star: ExportData::default(),
                sorted_and_filtered_export_aliases: AstAlloc::vec(),
                top_level_symbol_to_parts_overlay: TopLevelSymbolToParts::default(),
                cjs_export_copies: AstAlloc::vec(),
                wrapper_part_index: Index::default(),
                entry_point_part_index: Index::default(),
                flags: Flags::default(),
            }
        }
    }

    bun_collections::multi_array_columns! {
        pub trait JSMetaColumns for JSMeta {
            probably_typescript_type: ProbablyTypescriptType,
            imports_to_bind: RefImportData,
            resolved_exports: ResolvedExports,
            resolved_export_star: ExportData,
            sorted_and_filtered_export_aliases: SortedAndFilteredExportAliases,
            top_level_symbol_to_parts_overlay: TopLevelSymbolToParts,
            cjs_export_copies: CjsExportCopies,
            wrapper_part_index: Index,
            entry_point_part_index: Index,
            flags: Flags,
        }
    }
}

pub use entry_point::EntryPoint;
pub use js_meta::{
    ExportData, ImportData, JSMeta, RefImportData, ResolvedExports, TopLevelSymbolToParts,
};

pub struct LinkerGraph<'a> {
    pub files: FileList,
    pub(crate) files_live: BitSet,
    /// Per-part liveness — `parts_live[source_index].is_set(part_index)`.
    /// One bitset per source file, sized to that file's `parts.len()`.
    /// Populated by `tree_shaking_and_code_splitting` (regular link) or by
    /// the DevServer chunk path (which marks every JS-file part live);
    /// read-only thereafter. Replaces the former `Part::is_live: bool` so the
    /// tree-shaking visited-check doesn't pull a full 272-byte `Part` into
    /// cache for a 1-bit answer.
    pub(crate) parts_live: Vec<AutoBitSet>,
    pub(crate) entry_points: entry_point::List,
    pub(crate) symbols: symbol::Map,

    // Note: lifetime-erased. The
    // arena is owned by `BundleV2` and outlives every `LinkerGraph` — kept as
    // a raw pointer (matching `LinkerContext.parse_graph: *mut Graph`) so the
    // struct stays `'static`-ish and `LinkerContext`/`Chunk` callers don't
    // grow a `'bump` parameter; threading `'bump` would require `Chunk` and
    // `html_import_manifest` to gain lifetimes first.
    pub(crate) bump: bun_ptr::BackRef<Arena>,

    pub(crate) code_splitting: bool,

    // This is an alias from Graph
    // it is not a clone!
    pub(crate) ast: MultiArrayList<JSAst<'a>>,
    pub meta: MultiArrayList<JSMeta>,

    /// We should avoid traversing all files in the bundle, because the linker
    /// should be able to run a linking operation on a large bundle where only
    /// a few files are needed (e.g. an incremental compilation scenario). This
    /// holds all files that could possibly be reached through the entry points.
    /// If you need to iterate over all files in the linking operation, iterate
    /// over this array. This array is also sorted in a deterministic ordering
    /// to help ensure deterministic builds (source indices are random).
    pub(crate) reachable_files: Vec<Index>,

    /// Index from `.parse_graph.input_files` to index in `.files`
    pub(crate) stable_source_indices: Vec<u32>,

    pub(crate) is_scb_bitset: BitSet,

    /// This is for cross-module inlining of detected inlinable constants
    // const_values: bun_ast::Ast::ConstValuesMap,
    /// This is for cross-module inlining of TypeScript enum constants
    pub(crate) ts_enums: bun_ast::ast_result::TsEnumsMap,
}

// SAFETY: `LinkerGraph` is shared read-mostly across worker threads during
// linking. What makes `&LinkerGraph`
// sound to hold concurrently:
//
// - `bump: *const Arena` is a backref into `BundleV2`; the arena is frozen
//   (no new allocations) for the duration of any worker-pool fan-out that
//   holds `&LinkerGraph`.
// - `files_live` / `parts_live` / `is_scb_bitset` / `reachable_files` /
//   `stable_source_indices` / `code_splitting` / `ts_enums` are populated
//   before fan-out and only read by workers.
// - `ast` / `meta` / `files` columns that workers mutate are split out via
//   `split_mut()` into disjoint `&mut [_]` *before* the pool runs (see
//   `compute_cross_chunk_dependencies`); workers never reach those columns
//   through `&LinkerGraph`.
// - `symbols: symbol::Map` IS written by workers
//   (`Map::assign_chunk_index`), but the written field is
//   `Symbol.chunk_index: AtomicU32` — interior-mutable, Relaxed store — so
//   the write is sound through `&Map`. All other `Symbol` fields are
//   read-only during worker fan-out.
//
// `Send` is required because `LinkerGraph` is moved into `LinkerContext`
// which is itself sent to the link task; the only `!Send` constituent is the
// raw `*const Arena`, whose pointee is `Sync` and outlives the graph.
unsafe impl Send for LinkerGraph<'_> {}
// SAFETY: see the block above — every field reachable through `&LinkerGraph`
// during worker fan-out is either frozen before the pool runs, split out as a
// disjoint `&mut [_]` column beforehand, or written only via
// `Symbol.chunk_index: AtomicU32` (interior-mutable), so shared `&Self` is sound.
unsafe impl Sync for LinkerGraph<'_> {}

impl<'a> LinkerGraph<'a> {
    /// `&Arena` accessor — `bump` is a raw backref into `BundleV2`.
    #[inline]
    pub(crate) fn arena(&self) -> &Arena {
        // `bump` is a `BackRef` into `BundleV2.graph.arena`, valid for the
        // lifetime of the link step that constructed this LinkerGraph.
        self.bump.get()
    }
}

impl<'a> LinkerGraph<'a> {
    pub fn init(bump: &Arena, file_count: usize) -> Result<Self, crate::Error> {
        Ok(LinkerGraph {
            files: FileList::default(),
            files_live: BitSet::init_empty(file_count)?,
            parts_live: Vec::new(),
            entry_points: entry_point::List::default(),
            symbols: symbol::Map::default(),
            bump: bun_ptr::BackRef::new(bump),
            code_splitting: false,
            ast: MultiArrayList::default(),
            meta: MultiArrayList::default(),
            reachable_files: Vec::new(),
            stable_source_indices: Vec::new(),
            is_scb_bitset: BitSet::default(),
            ts_enums: bun_ast::ast_result::TsEnumsMap::default(),
        })
    }
}

impl Default for LinkerGraph<'_> {
    fn default() -> Self {
        LinkerGraph {
            files: FileList::default(),
            files_live: BitSet::default(),
            parts_live: Vec::new(),
            entry_points: entry_point::List::default(),
            symbols: symbol::Map::default(),
            // Note: `bump` is a backref assigned in `init`/`LinkerContext::load`;
            // dangling sentinel (never read before assignment).
            bump: bun_ptr::BackRef::from(core::ptr::NonNull::dangling()),
            code_splitting: false,
            ast: MultiArrayList::default(),
            meta: MultiArrayList::default(),
            reachable_files: Vec::new(),
            stable_source_indices: Vec::new(),
            is_scb_bitset: BitSet::default(),
            ts_enums: bun_ast::ast_result::TsEnumsMap::default(),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Symbol/part graph mutation surface needed by
// `linker_context/scanImportsAndExports.rs` and `LinkerContext::do_step5`.
//
// Expressed as free fns over individual SoA column slices so callers that
// already hold a `BundledAstColumnsMut` / `JSMetaColumnsMut` split-borrow
// can hand in just the columns these touch without re-borrowing
// `&mut LinkerGraph` (RUST_IDIOMS_AUDIT.md §3). The `&mut self` methods are
// thin forwarders for call sites that don't have a split in hand.
// ──────────────────────────────────────────────────────────────────────────

fn runtime_function(named_exports: &[bundled_ast::NamedExports], name: &[u8]) -> Ref {
    named_exports[Index::RUNTIME.get() as usize]
        .get(name)
        .expect("runtime function must be a named export of the runtime module")
        .ref_
}

pub(crate) fn generate_new_symbol(
    symbols: &mut symbol::Map,
    module_scopes: &mut [bun_ast::Scope],
    source_index: u32,
    kind: symbol::Kind,
    original_name: &[u8],
) -> Ref {
    let source_symbols = &mut symbols.symbols_for_source.slice_mut()[source_index as usize];

    let ref_ = Ref::new(
        source_symbols.len() as u32, // narrows to u31 in pack()
        source_index,
        RefTag::Symbol,
    );

    // TODO: will this crash on resize due to using threadlocal mimalloc heap?
    source_symbols.push(Symbol {
        kind,
        // Note: `Symbol.original_name` is a `StoreStr` —
        // arena-owned slice whose lifetime is erased;
        // caller guarantees it outlives the symbol table.
        original_name: bun_ast::StoreStr::new(original_name),
        ..Default::default()
    });

    module_scopes[source_index as usize].generated.push(ref_);
    ref_
}

fn top_level_symbol_to_parts<'a>(
    top_level_symbol_to_parts_overlay: &'a [TopLevelSymbolToParts],
    top_level_symbols_to_parts: &'a [bundled_ast::TopLevelSymbolToParts],
    id: u32,
    ref_: Ref,
) -> &'a [u32] {
    if let Some(overlay) = top_level_symbol_to_parts_overlay[id as usize].get(&ref_) {
        return overlay.slice();
    }
    if let Some(list) = top_level_symbols_to_parts[id as usize].get(&ref_) {
        return list.slice();
    }
    &[]
}

fn add_part_to_file(
    parts: &mut [part::List<'_>],
    top_level_symbol_to_parts_overlay: &mut [TopLevelSymbolToParts],
    top_level_symbols_to_parts: &[bundled_ast::TopLevelSymbolToParts],
    id: u32,
    part: Part,
) -> Result<u32, bun_alloc::AllocError> {
    let part_id = parts[id as usize].len() as u32;
    parts[id as usize].push(part);

    // Note: the two `ast` columns arrive pre-split, so no detach/reattach is
    // needed; re-index `meta` on each call (O(1)).
    let declared_symbols: &mut DeclaredSymbolList =
        &mut parts[id as usize][part_id as usize].declared_symbols;

    struct Ctx<'a> {
        overlay: &'a mut [TopLevelSymbolToParts],
        ast_tlsp: &'a [bundled_ast::TopLevelSymbolToParts],
        id: u32,
        part_id: u32,
    }
    let mut ctx = Ctx {
        overlay: top_level_symbol_to_parts_overlay,
        ast_tlsp: top_level_symbols_to_parts,
        id,
        part_id,
    };

    DeclaredSymbol::for_each_top_level_symbol(declared_symbols, &mut ctx, |ctx, ref_| {
        let id = ctx.id;
        let part_id = ctx.part_id;
        let slot = ctx.overlay[id as usize].entry(ref_).or_insert_with(|| {
            if let Some(original_parts) = ctx.ast_tlsp[id as usize].get(&ref_) {
                original_parts.clone()
            } else {
                bun_alloc::AstAlloc::vec()
            }
        });
        slot.push(part_id);
    });

    Ok(part_id)
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn generate_symbol_import_and_use(
    parts: &mut [part::List<'_>],
    ast_flags: &mut [bundled_ast::Flags],
    exports_ref: &[Ref],
    module_ref: &[Ref],
    top_level_symbols_to_parts: &[bundled_ast::TopLevelSymbolToParts],
    imports_to_bind: &mut [js_meta::RefImportData],
    top_level_symbol_to_parts_overlay: &[TopLevelSymbolToParts],
    source_index: u32,
    part_index: u32,
    ref_: Ref,
    use_count: u32,
    // Note: callers are split between `crate::Index` (options_types)
    // and the structurally identical `bun_ast::Index` until the two newtypes
    // unify. Accept either via `Into` and normalize once.
    source_index_to_import_from: impl Into<Index>,
) -> Result<(), bun_alloc::AllocError> {
    let source_index_to_import_from: Index = source_index_to_import_from.into();
    if use_count == 0 {
        return Ok(());
    }

    let exports_ref_v = exports_ref[source_index as usize];
    let module_ref_v = module_ref[source_index as usize];

    // Mark this symbol as used by this part
    {
        let part: &mut Part = &mut parts[source_index as usize].as_mut_slice()[part_index as usize];
        let uses_entry = part.symbol_uses.get_or_put(ref_)?;
        if !uses_entry.found_existing {
            *uses_entry.value_ptr = symbol::Use {
                count_estimate: use_count,
            };
        } else {
            uses_entry.value_ptr.count_estimate += use_count;
        }
    }

    if !exports_ref_v.is_empty() && ref_.eql(exports_ref_v) {
        ast_flags[source_index as usize].insert(bundled_ast::Flags::USES_EXPORTS_REF);
    }

    if !module_ref_v.is_empty() && ref_.eql(module_ref_v) {
        ast_flags[source_index as usize].insert(bundled_ast::Flags::USES_MODULE_REF);
    }

    // null ref shouldn't be there.
    debug_assert!(!ref_.is_empty());

    // Track that this specific symbol was imported
    if source_index_to_import_from.get() != source_index {
        imports_to_bind[source_index as usize].put(
            ref_,
            js_meta::ImportToBind {
                data: ImportTracker {
                    source_index: source_index_to_import_from,
                    import_ref: ref_,
                    ..Default::default()
                },
                ..Default::default()
            },
        )?;
    }

    // Pull in all parts that declare this symbol
    let part_ids = top_level_symbol_to_parts(
        top_level_symbol_to_parts_overlay,
        top_level_symbols_to_parts,
        source_index_to_import_from.get(),
        ref_,
    );
    let dependencies =
        &mut parts[source_index as usize].as_mut_slice()[part_index as usize].dependencies;
    // SAFETY: every element of `new_dependencies` is overwritten in the
    // zip-loop immediately below before any read/drop.
    let new_dependencies = unsafe { dependencies.writable_slice(part_ids.len()) };
    debug_assert_eq!(part_ids.len(), new_dependencies.len());
    for (part_id, dependency) in part_ids.iter().zip(new_dependencies.iter_mut()) {
        *dependency = Dependency {
            // Note: `Dependency.source_index` is the structurally
            // identical `bun_ast::Index`; convert by value until the
            // two `Index` newtypes unify.
            source_index: bun_ast::Index::init(source_index_to_import_from.get()),
            part_index: *part_id, // already u32
        };
    }
    Ok(())
}

impl<'a> LinkerGraph<'a> {
    pub(crate) fn runtime_function(&self, name: &[u8]) -> Ref {
        runtime_function(self.ast.items_named_exports(), name)
    }

    /// Shared-ref view of a symbol that is known to exist (the `Ref` was
    /// produced by the symbol table itself). Thin wrapper over
    /// [`symbol::Map::get_const`]; callers previously open-coded
    /// `unsafe { &*graph.symbols.get(r).expect(..) }`.
    #[inline]
    #[cfg(debug_assertions)]
    pub(crate) fn symbol(&self, ref_: Ref) -> &Symbol {
        self.symbols
            .get_const(ref_)
            .expect("infallible: ref in symbol table")
    }

    /// Mutable view of a symbol that is known to exist. Takes `&self` (not
    /// `&mut self`): the linker mutates per-symbol fields (`link`,
    /// `namespace_alias`, `import_item_status`, ...) through shared
    /// `&LinkerContext`/`&LinkerGraph` paths while iterating disjoint graph
    /// columns, mirroring the prior open-coded `unsafe { &mut *get(r) }`.
    ///
    /// # Safety
    /// Caller must ensure no other live `&`/`&mut` borrow aliases the same
    /// symbol slot for the returned reference's lifetime (the `&self` signature
    /// alone cannot enforce this — two calls with the same `Ref` while both
    /// results are live is UB). Mirrors the prior open-coded
    /// `unsafe { &mut *get(r) }` call-site obligation.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub(crate) unsafe fn symbol_mut(&self, ref_: Ref) -> &mut Symbol {
        // SAFETY: see `symbol` for liveness/validity; caller guarantees the
        // mutated slot is disjoint from any other borrow held at the call site.
        unsafe {
            &mut *self
                .symbols
                .get(ref_)
                .expect("infallible: ref in symbol table")
        }
    }

    pub(crate) fn generate_new_symbol(
        &mut self,
        source_index: u32,
        kind: symbol::Kind,
        original_name: &[u8],
    ) -> Ref {
        generate_new_symbol(
            &mut self.symbols,
            self.ast.items_module_scope_mut(),
            source_index,
            kind,
            original_name,
        )
    }

    pub(crate) fn generate_runtime_symbol_import_and_use(
        &mut self,
        source_index: index::Int,
        entry_point_part_index: Index,
        name: &[u8],
        count: u32,
    ) -> Result<(), bun_alloc::AllocError> {
        if count == 0 {
            return Ok(());
        }
        bun_core::scoped_log!(
            LinkerGraph,
            "generateRuntimeSymbolImportAndUse({}) for {}",
            bstr::BStr::new(name),
            source_index
        );

        let ref_ = self.runtime_function(name);
        self.generate_symbol_import_and_use(
            source_index,
            entry_point_part_index.get(),
            ref_,
            count,
            Index::RUNTIME,
        )
    }

    pub(crate) fn add_part_to_file(
        &mut self,
        id: u32,
        part: Part,
    ) -> Result<u32, bun_alloc::AllocError> {
        let ast = self.ast.split_mut();
        add_part_to_file(
            ast.parts,
            self.meta.items_top_level_symbol_to_parts_overlay_mut(),
            ast.top_level_symbols_to_parts,
            id,
            part,
        )
    }

    pub(crate) fn generate_symbol_import_and_use(
        &mut self,
        source_index: u32,
        part_index: u32,
        ref_: Ref,
        use_count: u32,
        source_index_to_import_from: impl Into<Index>,
    ) -> Result<(), bun_alloc::AllocError> {
        let ast = self.ast.split_mut();
        let meta = self.meta.split_mut();
        generate_symbol_import_and_use(
            ast.parts,
            ast.flags,
            ast.exports_ref,
            ast.module_ref,
            ast.top_level_symbols_to_parts,
            meta.imports_to_bind,
            meta.top_level_symbol_to_parts_overlay,
            source_index,
            part_index,
            ref_,
            use_count,
            source_index_to_import_from,
        )
    }

    pub(crate) fn top_level_symbol_to_parts(&self, id: u32, ref_: Ref) -> &[u32] {
        top_level_symbol_to_parts(
            self.meta.items_top_level_symbol_to_parts_overlay(),
            self.ast.items_top_level_symbols_to_parts(),
            id,
            ref_,
        )
    }
}

impl<'a> LinkerGraph<'a> {
    pub(crate) fn load(
        &mut self,
        entry_points: &[Index],
        sources: &[bun_ast::Source],
        server_component_boundaries: &server_component_boundary::List,
        dynamic_import_entry_points: &[index::Int],
        entry_point_original_names: &IndexStringMap,
    ) -> Result<(), crate::Error> {
        let scb = server_component_boundaries.slice();
        self.files.set_capacity(sources.len())?;
        self.files.zero();
        self.files_live = BitSet::init_empty(sources.len())?;
        // SAFETY: capacity reserved above; columns zeroed by `zero()`.
        unsafe { self.files.set_len(sources.len()) };

        // Note: `Slice<T>` caches raw column pointers and does not borrow
        // `self.files`, so the `split_mut()` borrows (tied to the local
        // `files_slice`) can stay live across other `&mut self.*` accesses
        // below. The columns are not reallocated during `load`.
        let mut files_slice = self.files.slice();
        let files_cols = files_slice.split_mut();
        let entry_point_kinds: &mut [entry_point::Kind] = files_cols.entry_point_kind;
        entry_point_kinds.fill(entry_point::Kind::None);

        // Setup entry points
        {
            self.entry_points.set_capacity(
                entry_points.len()
                    + server_component_boundaries.list.len()
                    + dynamic_import_entry_points.len(),
            )?;
            // SAFETY: capacity reserved; columns initialized below.
            unsafe { self.entry_points.set_len(entry_points.len()) };

            // Note: `source_indices` / `path_strings` are disjoint columns of
            // the same `MultiArrayList`. `split_mut()` hands out both at once;
            // `self.entry_points` is not
            // reallocated until after `path_strings`/`source_indices` are done
            // with (the next `append_assume_capacity` is within the
            // pre-reserved capacity, so no realloc).
            let mut ep_slice = self.entry_points.slice();
            let ep_cols = ep_slice.split_mut();
            let source_indices: &mut [index::Int] = ep_cols.source_index;
            let path_strings: &mut [RawSlice<u8>] = ep_cols.output_path;

            debug_assert_eq!(entry_points.len(), path_strings.len());
            debug_assert_eq!(entry_points.len(), source_indices.len());
            for ((i, path_string), source_index) in entry_points
                .iter()
                .zip(path_strings.iter_mut())
                .zip(source_indices.iter_mut())
            {
                let source = &sources[i.get() as usize];
                debug_assert!(source.index.0 == i.get());
                entry_point_kinds[source.index.0 as usize] = entry_point::Kind::UserSpecified;

                // Check if this entry point has an original name (from virtual entry resolution)
                if let Some(original_name) = entry_point_original_names.get(i.get()) {
                    *path_string = RawSlice::new(original_name);
                } else {
                    *path_string = RawSlice::new(source.path.text);
                }

                *source_index = source.index.0;
            }

            for &id in dynamic_import_entry_points {
                debug_assert!(self.code_splitting); // this should never be a thing without code splitting

                if entry_point_kinds[id as usize] != entry_point::Kind::None {
                    // You could dynamic import a file that is already an entry point
                    continue;
                }

                let source = &sources[id as usize];
                entry_point_kinds[id as usize] = entry_point::Kind::DynamicImport;

                self.entry_points.append_assume_capacity(EntryPoint {
                    source_index: id,
                    output_path: RawSlice::new(source.path.text),
                });
            }

            let import_records_len = self.ast.items_import_records().len();
            self.meta.set_capacity(import_records_len)?;
            // Fill each slot with `Default`.
            let ast_len = self.ast.len();
            debug_assert!(ast_len <= import_records_len);
            for _ in 0..ast_len {
                self.meta.append_assume_capacity(JSMeta::default());
            }

            if scb.list.len() > 0 {
                self.is_scb_bitset = BitSet::init_empty(self.files.len()).expect("unreachable");

                // Index all SCBs into the bitset. This is needed so chunking
                // can track the chunks that SCBs belong to.
                debug_assert_eq!(
                    scb.list.items_use_directive().len(),
                    scb.list.items_source_index().len()
                );
                debug_assert_eq!(
                    scb.list.items_use_directive().len(),
                    scb.list.items_reference_source_index().len()
                );
                for ((use_, original_id), ref_id) in scb
                    .list
                    .items_use_directive()
                    .iter()
                    .zip(scb.list.items_source_index().iter())
                    .zip(scb.list.items_reference_source_index().iter())
                {
                    match use_ {
                        UseDirective::None => {}
                        UseDirective::Client => {
                            self.is_scb_bitset.set(*original_id as usize);
                            self.is_scb_bitset.set(*ref_id as usize);
                        }
                        UseDirective::Server => {
                            bun_core::todo_panic!("um");
                        }
                    }
                }

                // For client components, the import record index currently points to the original source index, instead of the reference source index.
                let import_records_list: &mut [import_record::List<'_>] =
                    self.ast.items_import_records_mut();
                for source_id in self.reachable_files.slice() {
                    for import_record in import_records_list[source_id.get() as usize]
                        .as_mut_slice()
                        .iter_mut()
                    {
                        if import_record.source_index.is_valid()
                            && self
                                .is_scb_bitset
                                .is_set(import_record.source_index.get() as usize)
                        {
                            // Only rewrite if this is an original SCB file, not a reference file
                            if let Some(ref_index) =
                                scb.get_reference_source_index(import_record.source_index.get())
                            {
                                import_record.source_index = Index::init(ref_index);
                                debug_assert!(import_record.source_index.is_valid());
                                // did not generate
                            }
                            // If it's already a reference file, leave it as-is
                        }
                    }
                }
            } else {
                self.is_scb_bitset = BitSet::default();
            }
        }

        // Setup files
        {
            // set it to max value so that if we access an invalid one, it crashes
            // Note: fill with `Index::INVALID` whose bytes are all
            // 0xFF (`#[repr(transparent)]` over `u32::MAX`).
            let stable_source_indices = self
                .arena()
                .alloc_slice_fill_copy(sources.len() + 1, Index::INVALID);

            for (i, source_index) in self.reachable_files.slice().iter().enumerate() {
                stable_source_indices[source_index.get() as usize] = Index::source(i as u32);
            }

            let distances: &mut [u32] = files_cols.distance_from_entry_point;
            distances.fill(File::default().distance_from_entry_point);
            // `Index` is `#[repr(transparent)]` over `u32`; the field stores
            // raw `u32` so unwrap via `.get()` (no slice reinterpret needed).
            self.stable_source_indices = stable_source_indices.iter().map(|i| i.get()).collect();
        }

        {
            // Note: `Vec::clone` requires `T: Clone` which `Symbol` does not
            // derive (it carries a raw `*const [u8]`), so spell out the
            // bitwise copy explicitly — `Symbol` has no `Drop` impl.
            let src_symbols: &[symbol::List] = self.ast.items_symbols();
            let mut symbols: symbol::NestedList = Vec::with_capacity(src_symbols.len());
            for src in src_symbols {
                let n = src.len();
                let mut dest: Vec<symbol::Symbol> = Vec::with_capacity(n);
                // SAFETY: `dest` has capacity `n`; `src` is `n` initialized
                // `Symbol`s; `Symbol` is bitwise-copyable (no `Drop`).
                unsafe {
                    core::ptr::copy_nonoverlapping(src.as_ptr(), dest.as_mut_ptr(), n);
                    dest.set_len(n);
                }
                symbols.push(dest);
            }
            self.symbols = symbol::Map::init_list(symbols);
        }

        // TODO: const_values

        {
            let mut count: usize = 0;
            for ts_enums in self.ast.items_ts_enums().iter() {
                count += ts_enums.count();
            }
            if count > 0 {
                self.ts_enums.ensure_total_capacity(count)?;
                for ts_enums in self.ast.items_ts_enums().iter() {
                    debug_assert_eq!(ts_enums.keys().len(), ts_enums.values().len());
                    for (key, value) in ts_enums.keys().iter().zip(ts_enums.values().iter()) {
                        // Note: the per-file maps are not mutated after
                        // this point so aliasing is not required.
                        self.ts_enums.put_assume_capacity(*key, value.clone());
                    }
                }
            }
        }

        let src_named_exports: &[bundled_ast::NamedExports] = self.ast.items_named_exports();
        let dest_resolved_exports: &mut [ResolvedExports] = self.meta.items_resolved_exports_mut();
        debug_assert_eq!(src_named_exports.len(), dest_resolved_exports.len());
        for (source_index, (src, dest)) in src_named_exports
            .iter()
            .zip(dest_resolved_exports.iter_mut())
            .enumerate()
        {
            let mut resolved = ResolvedExports::default();
            resolved
                .ensure_total_capacity(src.count())
                .expect("unreachable");
            debug_assert_eq!(src.keys().len(), src.values().len());
            for (key, value) in src.keys().iter().zip(src.values().iter()) {
                resolved.put_assume_capacity(
                    key,
                    js_meta::ResolvedExport {
                        data: ImportTracker {
                            import_ref: value.ref_,
                            name_loc: value.alias_loc,
                            source_index: Index::source(source_index as u32),
                        },
                        ..Default::default()
                    },
                );
            }
            *dest = resolved;
        }
        Ok(())
    }

    /// `clone_ast` left each
    /// `PartList`/import-record list with its allocator handle pointing at
    /// the per-worker `mi_heap` that built it; re-tag to `heap` (the
    /// bundle-thread arena) so linker-side `add_part_to_file` pushes call
    /// `mi_heap_realloc_aligned(heap, worker_ptr, ..)` from the thread that
    /// owns `heap`. Zero-copy: only files the linker actually grows pay a
    /// (lazy, mimalloc-internal) cross-heap migration on first realloc.
    ///
    /// `Vec<T, &Arena>` stores its allocator, so swap it here.
    /// `part.dependencies` and `symbols` need no transfer:
    /// `DependencyList` is `Vec<_, AstAlloc>` (linker-side grows just route
    /// through whichever thread's `AstAlloc` state is active — `AstAlloc` is a
    /// ZST, so there is nothing to retag) and new symbols feed through
    /// `self.symbols: symbol::Map` (global).
    pub(crate) fn take_ast_ownership(&mut self, heap: &'a Arena) {
        for v in self.ast.items_import_records_mut() {
            bun_alloc::transfer_arena(v, heap);
        }
        for v in self.ast.items_parts_mut() {
            bun_alloc::transfer_arena(v, heap);
        }
    }

    pub(crate) fn propagate_async_dependencies(&mut self) -> Result<(), crate::Error> {
        // Explicit-stack postorder DFS (was per-edge recursive). A parent's
        // flag is read from each child after that child's subtree is fully
        // processed; `AfterChild` is the resumption point for that read.
        #[derive(Copy, Clone)]
        enum Frame {
            Enter(usize),
            AfterChild { parent: usize, child: usize },
        }

        let import_records = self.ast.items_import_records();
        let flags = self.meta.items_flags_mut();
        let len = import_records.len();
        let mut visited = AutoBitSet::init_empty(self.ast.len())?;
        let mut stack: Vec<Frame> = Vec::new();

        for root in 0..len {
            if visited.is_set(root) {
                continue;
            }
            stack.push(Frame::Enter(root));

            while let Some(frame) = stack.pop() {
                match frame {
                    Frame::AfterChild { parent, child } => {
                        if flags[child].is_async_or_has_async_dependency {
                            flags[parent].is_async_or_has_async_dependency = true;
                        }
                    }
                    Frame::Enter(index) => {
                        if visited.is_set(index) {
                            continue;
                        }
                        visited.set(index);
                        if flags[index].is_async_or_has_async_dependency {
                            continue;
                        }

                        let mark = stack.len();
                        for import_record in import_records[index].as_slice().iter() {
                            match import_record.kind {
                                ImportKind::Stmt => {}

                                // Any use of `import()` that makes the parent async will necessarily use
                                // top-level await, so this will have already been detected by `validateTLA`,
                                // and `is_async_or_has_async_dependency` will already be true.
                                //
                                // We don't want to process these imports here because `import()` can appear in
                                // non-top-level contexts (like inside an async function) or in contexts that
                                // don't use `await`, which don't necessarily make the parent module async.
                                ImportKind::Dynamic => continue,

                                // `require()` cannot import async modules.
                                ImportKind::Require | ImportKind::RequireResolve => continue,

                                // Entry points; not imports from JS
                                ImportKind::EntryPointRun | ImportKind::EntryPointBuild => continue,
                                // CSS imports
                                ImportKind::At
                                | ImportKind::AtConditional
                                | ImportKind::Url
                                | ImportKind::Composes => continue,
                                // Other non-JS imports
                                ImportKind::HtmlManifest | ImportKind::Internal => continue,
                            }

                            let import_index: usize = import_record.source_index.get() as usize;
                            if import_index >= len {
                                continue;
                            }
                            stack.push(Frame::Enter(import_index));
                            stack.push(Frame::AfterChild {
                                parent: index,
                                child: import_index,
                            });
                        }
                        stack[mark..].reverse();
                    }
                }
            }
        }
        Ok(())
    }
}

pub struct File {
    pub entry_bits: AutoBitSet,

    pub input_file: Index,

    /// The minimum number of links in the module graph to get from an entry point
    /// to this file
    pub distance_from_entry_point: u32,

    /// This file is an entry point if and only if this is not ".none".
    /// Note that dynamically-imported files are allowed to also be specified by
    /// the user as top-level entry points, so some dynamically-imported files
    /// may be ".user_specified" instead of ".dynamic_import".
    pub entry_point_kind: EntryPoint::Kind,

    /// If "entry_point_kind" is not ".none", this is the index of the
    /// corresponding entry point chunk.
    ///
    /// This is also initialized for files that are a SCB's generated
    /// reference, pointing to its destination. This forms a lookup map from
    /// a Source.Index to its output path inb reakOutputIntoPieces
    pub entry_point_chunk_index: u32,

    pub line_offset_table: bun_sourcemap::line_offset_table::List<bun_alloc::AstAlloc>,
    pub quoted_source_contents: Option<bun_alloc::AstVec<u8>>,
}

impl Default for File {
    fn default() -> Self {
        Self {
            // Note: empty static-arm bitset; load() overwrites before any read.
            entry_bits: AutoBitSet::init_empty(0).expect("static AutoBitSet"),
            input_file: Index::source(0u32),
            distance_from_entry_point: u32::MAX,
            entry_point_kind: EntryPoint::Kind::None,
            entry_point_chunk_index: u32::MAX,
            line_offset_table: bun_sourcemap::line_offset_table::List::new_in(bun_alloc::AstAlloc),
            quoted_source_contents: None,
        }
    }
}

pub(crate) type FileList = MultiArrayList<File>;

bun_collections::multi_array_columns! {
    pub trait FileColumns for File {
        entry_bits: AutoBitSet,
        input_file: Index,
        distance_from_entry_point: u32,
        entry_point_kind: EntryPoint::Kind,
        entry_point_chunk_index: u32,
        line_offset_table: bun_sourcemap::line_offset_table::List<bun_alloc::AstAlloc>,
        quoted_source_contents: Option<bun_alloc::AstVec<u8>>,
    }
}
