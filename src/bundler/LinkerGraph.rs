use bun_alloc::Arena;
use bun_collections::{AutoBitSet, BabyList, DynamicBitSet as BitSet, MultiArrayList};
use bun_js_parser as js_ast;
use bun_js_parser::Symbol;
use bun_options_types::{ImportKind, ImportRecord};
use bun_str::PathString;

use crate::{
    entry_point, import_record, index, js_meta, part, EntryPoint, Index, IndexStringMap, JSAst,
    JSMeta, Logger, Part, Ref, ResolvedExports, ServerComponentBoundary, TopLevelSymbolToParts,
};

bun_output::declare_scope!(LinkerGraph, visible);

// TODO(port): MultiArrayList per-field slice accessor API is assumed below as
// `.items().field_name` (immutable) / `.items_mut().field_name` (mutable),
// matching Zig's `.items(.field_name)`. Phase B: align with the real
// `bun_collections::MultiArrayList` codegen.

pub struct LinkerGraph<'bump> {
    pub files: FileList,
    pub files_live: BitSet,
    pub entry_points: entry_point::List,
    pub symbols: js_ast::symbol::Map,

    pub bump: &'bump Arena,

    pub code_splitting: bool,

    // This is an alias from Graph
    // it is not a clone!
    pub ast: MultiArrayList<JSAst>,
    pub meta: MultiArrayList<JSMeta>,

    /// We should avoid traversing all files in the bundle, because the linker
    /// should be able to run a linking operation on a large bundle where only
    /// a few files are needed (e.g. an incremental compilation scenario). This
    /// holds all files that could possibly be reached through the entry points.
    /// If you need to iterate over all files in the linking operation, iterate
    /// over this array. This array is also sorted in a deterministic ordering
    /// to help ensure deterministic builds (source indices are random).
    pub reachable_files: &'bump [Index],

    /// Index from `.parse_graph.input_files` to index in `.files`
    pub stable_source_indices: &'bump [u32],

    pub is_scb_bitset: BitSet,

    /// This is for cross-module inlining of detected inlinable constants
    // const_values: js_ast::Ast::ConstValuesMap,
    /// This is for cross-module inlining of TypeScript enum constants
    pub ts_enums: js_ast::ast::TsEnumsMap,
}

impl<'bump> LinkerGraph<'bump> {
    pub fn init(bump: &'bump Arena, file_count: usize) -> Result<Self, bun_core::Error> {
        // TODO(port): narrow error set
        Ok(LinkerGraph {
            files: FileList::default(),
            files_live: BitSet::init_empty(file_count)?,
            entry_points: entry_point::List::default(),
            symbols: js_ast::symbol::Map::default(),
            bump,
            code_splitting: false,
            ast: MultiArrayList::default(),
            meta: MultiArrayList::default(),
            reachable_files: &[],
            stable_source_indices: &[],
            is_scb_bitset: BitSet::default(),
            ts_enums: js_ast::ast::TsEnumsMap::default(),
        })
    }

    pub fn runtime_function(&self, name: &[u8]) -> Ref {
        self.ast.items().named_exports[Index::RUNTIME.value()]
            .get(name)
            .unwrap()
            .ref_
    }

    pub fn generate_new_symbol(
        &mut self,
        source_index: u32,
        kind: Symbol::Kind,
        original_name: &[u8],
    ) -> Ref {
        let source_symbols =
            &mut self.symbols.symbols_for_source.slice_mut()[source_index as usize];

        let mut ref_ = Ref::init(
            source_symbols.len() as u32, // @truncate
            source_index,                // @truncate (already u32)
            false,
        );
        ref_.tag = Ref::Tag::Symbol;

        // TODO: will this crash on resize due to using threadlocal mimalloc heap?
        source_symbols.push(
            self.bump,
            Symbol {
                kind,
                original_name,
                ..Default::default()
            },
        );

        self.ast.items_mut().module_scope[source_index as usize]
            .generated
            .push(self.bump, ref_);
        ref_
    }

    pub fn generate_runtime_symbol_import_and_use(
        &mut self,
        source_index: index::Int,
        entry_point_part_index: Index,
        name: &[u8],
        count: u32,
    ) -> Result<(), bun_alloc::AllocError> {
        if count == 0 {
            return Ok(());
        }
        bun_output::scoped_log!(
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

    pub fn add_part_to_file(&mut self, id: u32, part: Part) -> Result<u32, bun_alloc::AllocError> {
        let parts: &mut part::List = &mut self.ast.items_mut().parts[id as usize];
        let part_id = parts.len() as u32; // @truncate
        parts.push(self.bump, part)?;
        let mut top_level_symbol_to_parts_overlay: Option<&mut TopLevelSymbolToParts> = None;

        struct Iterator<'a, 'bump> {
            graph: &'a mut LinkerGraph<'bump>,
            id: u32,
            top_level_symbol_to_parts_overlay: &'a mut Option<&'a mut TopLevelSymbolToParts>,
            part_id: u32,
        }

        impl<'a, 'bump> Iterator<'a, 'bump> {
            pub fn next(&mut self, ref_: Ref) {
                // TODO(port): borrowck — `top_level_symbol_to_parts_overlay`
                // caches a `&mut` into `self.graph.meta` while `self.graph` is
                // also held `&mut`. Phase B: reshape to re-index `meta` each
                // call instead of caching the pointer, or split borrows.
                let overlay = 'brk: {
                    if let Some(out) = self.top_level_symbol_to_parts_overlay.as_deref_mut() {
                        break 'brk out;
                    }

                    let out = &mut self
                        .graph
                        .meta
                        .items_mut()
                        .top_level_symbol_to_parts_overlay[self.id as usize];

                    *self.top_level_symbol_to_parts_overlay = Some(out);
                    break 'brk self
                        .top_level_symbol_to_parts_overlay
                        .as_deref_mut()
                        .unwrap();
                };

                let entry = overlay
                    .get_or_put(self.graph.bump, ref_)
                    .expect("unreachable");
                if !entry.found_existing {
                    if let Some(original_parts) = self.graph.ast.items().top_level_symbols_to_parts
                        [self.id as usize]
                        .get(ref_)
                    {
                        let mut list =
                            bumpalo::collections::Vec::<u32>::new_in(self.graph.bump);
                        list.reserve_exact(original_parts.len() + 1);
                        list.extend_from_slice(original_parts.slice());
                        // PERF(port): was assume_capacity
                        list.push(self.part_id);
                        // PERF(port): was assume_capacity

                        *entry.value_ptr = BabyList::from_owned_slice(list.into_bump_slice());
                    } else {
                        *entry.value_ptr =
                            BabyList::<u32>::from_slice(self.graph.bump, &[self.part_id]);
                    }
                } else {
                    entry.value_ptr.push(self.graph.bump, self.part_id);
                }
            }
        }

        let mut ctx = Iterator {
            graph: self,
            id,
            part_id,
            top_level_symbol_to_parts_overlay: &mut top_level_symbol_to_parts_overlay,
        };

        // PORT NOTE: reshaped for borrowck — `parts` borrow above conflicts
        // with `ctx.graph = self`; re-index here instead of reusing `parts`.
        js_ast::DeclaredSymbol::for_each_top_level_symbol(
            &mut ctx.graph.ast.items_mut().parts[id as usize]
                .get_mut(part_id)
                .declared_symbols,
            &mut ctx,
            Iterator::next,
        );

        Ok(part_id)
    }

    pub fn generate_symbol_import_and_use(
        &mut self,
        source_index: u32,
        part_index: u32,
        ref_: Ref,
        use_count: u32,
        source_index_to_import_from: Index,
    ) -> Result<(), bun_alloc::AllocError> {
        if use_count == 0 {
            return Ok(());
        }

        let parts_list = self.ast.items_mut().parts[source_index as usize].slice_mut();
        let part: &mut Part = &mut parts_list[part_index as usize];

        // Mark this symbol as used by this part

        let uses = &mut part.symbol_uses;
        let uses_entry = uses.get_or_put(self.bump, ref_)?;

        if !uses_entry.found_existing {
            *uses_entry.value_ptr = part::SymbolUse {
                count_estimate: use_count,
                ..Default::default()
            };
        } else {
            uses_entry.value_ptr.count_estimate += use_count;
        }

        let exports_ref = self.ast.items().exports_ref[source_index as usize];
        let module_ref = self.ast.items().module_ref[source_index as usize];
        if !exports_ref.is_null() && ref_.eql(exports_ref) {
            self.ast.items_mut().flags[source_index as usize].uses_exports_ref = true;
        }

        if !module_ref.is_null() && ref_.eql(module_ref) {
            self.ast.items_mut().flags[source_index as usize].uses_module_ref = true;
        }

        // null ref shouldn't be there.
        debug_assert!(!ref_.is_empty());

        // Track that this specific symbol was imported
        if source_index_to_import_from.get() != source_index {
            let imports_to_bind = &mut self.meta.items_mut().imports_to_bind[source_index as usize];
            imports_to_bind.put(
                self.bump,
                ref_,
                js_meta::ImportToBind {
                    data: js_meta::ImportData {
                        source_index: source_index_to_import_from,
                        import_ref: ref_,
                        ..Default::default()
                    },
                    ..Default::default()
                },
            )?;
        }

        // Pull in all parts that declare this symbol
        // PORT NOTE: reshaped for borrowck — re-borrow `part.dependencies`
        // after calling `top_level_symbol_to_parts` (which borrows `self`).
        let part_ids = self
            .top_level_symbol_to_parts(source_index_to_import_from.get(), ref_)
            .to_vec();
        // PERF(port): was zero-copy slice borrow into ast/meta — profile in Phase B
        let dependencies = &mut self.ast.items_mut().parts[source_index as usize].slice_mut()
            [part_index as usize]
            .dependencies;
        let new_dependencies = dependencies.writable_slice(self.bump, part_ids.len())?;
        debug_assert_eq!(part_ids.len(), new_dependencies.len());
        for (part_id, dependency) in part_ids.iter().zip(new_dependencies.iter_mut()) {
            *dependency = part::Dependency {
                source_index: source_index_to_import_from,
                part_index: *part_id as u32, // @truncate
            };
        }
        Ok(())
    }

    pub fn top_level_symbol_to_parts(&self, id: u32, ref_: Ref) -> &[u32] {
        if let Some(overlay) =
            self.meta.items().top_level_symbol_to_parts_overlay[id as usize].get(ref_)
        {
            return overlay.slice();
        }

        if let Some(list) = self.ast.items().top_level_symbols_to_parts[id as usize].get(ref_) {
            return list.slice();
        }

        &[]
    }

    pub fn load(
        &mut self,
        entry_points: &[Index],
        sources: &[Logger::Source],
        server_component_boundaries: ServerComponentBoundary::List,
        dynamic_import_entry_points: &[index::Int],
        entry_point_original_names: &IndexStringMap,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        let scb = server_component_boundaries.slice();
        self.files.set_capacity(self.bump, sources.len())?;
        self.files.zero();
        self.files_live = BitSet::init_empty(sources.len())?;
        self.files.len = sources.len();
        let mut files = self.files.slice_mut();

        let entry_point_kinds = files.items_mut().entry_point_kind;
        {
            // SAFETY: EntryPoint::Kind is #[repr(u8)] POD; zeroing is the .none discriminant.
            let kinds = unsafe {
                core::slice::from_raw_parts_mut(
                    entry_point_kinds.as_mut_ptr().cast::<u8>(),
                    core::mem::size_of_val(entry_point_kinds),
                )
            };
            kinds.fill(0);
        }

        // Setup entry points
        {
            self.entry_points.set_capacity(
                self.bump,
                entry_points.len()
                    + server_component_boundaries.list.len()
                    + dynamic_import_entry_points.len(),
            )?;
            self.entry_points.len = entry_points.len();
            let source_indices = self.entry_points.items_mut().source_index;

            let path_strings: &mut [PathString] = self.entry_points.items_mut().output_path;
            {
                // SAFETY: bool slice as bytes; zero is `false`.
                let output_was_auto_generated = unsafe {
                    core::slice::from_raw_parts_mut(
                        self.entry_points
                            .items_mut()
                            .output_path_was_auto_generated
                            .as_mut_ptr()
                            .cast::<u8>(),
                        self.entry_points
                            .items()
                            .output_path_was_auto_generated
                            .len(),
                    )
                };
                output_was_auto_generated.fill(0);
            }

            debug_assert_eq!(entry_points.len(), path_strings.len());
            debug_assert_eq!(entry_points.len(), source_indices.len());
            for ((i, path_string), source_index) in entry_points
                .iter()
                .zip(path_strings.iter_mut())
                .zip(source_indices.iter_mut())
            {
                let source = &sources[i.get() as usize];
                if cfg!(debug_assertions) {
                    debug_assert!(source.index.get() == i.get());
                }
                entry_point_kinds[source.index.get() as usize] = EntryPoint::Kind::UserSpecified;

                // Check if this entry point has an original name (from virtual entry resolution)
                if let Some(original_name) = entry_point_original_names.get(i.get()) {
                    *path_string = PathString::init(original_name);
                } else {
                    *path_string = PathString::init(source.path.text);
                }

                *source_index = source.index.get();
            }

            for &id in dynamic_import_entry_points {
                debug_assert!(self.code_splitting); // this should never be a thing without code splitting

                if entry_point_kinds[id as usize] != EntryPoint::Kind::None {
                    // You could dynamic import a file that is already an entry point
                    continue;
                }

                let source = &sources[id as usize];
                entry_point_kinds[id as usize] = EntryPoint::Kind::DynamicImport;

                // PERF(port): was assume_capacity
                self.entry_points.push(EntryPoint {
                    source_index: id,
                    output_path: PathString::init(source.path.text),
                    output_path_was_auto_generated: true,
                    ..Default::default()
                });
            }

            let import_records_list: &mut [import_record::List] =
                self.ast.items_mut().import_records;
            self.meta.set_capacity(self.bump, import_records_list.len())?;
            self.meta.len = self.ast.len;
            self.meta.zero();

            if scb.list.len() > 0 {
                self.is_scb_bitset =
                    BitSet::init_empty(self.files.len).expect("unreachable");

                // Index all SCBs into the bitset. This is needed so chunking
                // can track the chunks that SCBs belong to.
                debug_assert_eq!(
                    scb.list.items().use_directive.len(),
                    scb.list.items().source_index.len()
                );
                debug_assert_eq!(
                    scb.list.items().use_directive.len(),
                    scb.list.items().reference_source_index.len()
                );
                for ((use_, original_id), ref_id) in scb
                    .list
                    .items()
                    .use_directive
                    .iter()
                    .zip(scb.list.items().source_index.iter())
                    .zip(scb.list.items().reference_source_index.iter())
                {
                    match use_ {
                        UseDirective::None => {}
                        UseDirective::Client => {
                            self.is_scb_bitset.set(*original_id as usize);
                            self.is_scb_bitset.set(*ref_id as usize);
                        }
                        UseDirective::Server => {
                            todo!("um");
                        }
                    }
                }

                // For client components, the import record index currently points to the original source index, instead of the reference source index.
                for source_id in self.reachable_files {
                    for import_record in
                        import_records_list[source_id.get() as usize].slice_mut().iter_mut()
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
            let stable_source_indices = self.bump.alloc_slice_fill_copy(
                sources.len() + 1,
                // set it to max value so that if we access an invalid one, it crashes
                Index::from_raw_bytes(u32::MAX),
            );
            // TODO(port): Zig used `@memset(sliceAsBytes(...), 255)` to fill raw
            // bytes; here we fill with an Index whose bytes are all 0xFF. Verify
            // `Index` layout matches.

            for (i, source_index) in self.reachable_files.iter().enumerate() {
                stable_source_indices[source_index.get() as usize] = Index::source(i);
            }

            files
                .items_mut()
                .distance_from_entry_point
                .fill(File::default().distance_from_entry_point);
            // SAFETY: Index is #[repr(transparent)] over u32; reinterpreting
            // [Index] as [u32] is sound.
            self.stable_source_indices = unsafe {
                core::slice::from_raw_parts(
                    stable_source_indices.as_ptr().cast::<u32>(),
                    stable_source_indices.len(),
                )
            };
        }

        {
            let input_symbols = js_ast::symbol::Map::init_list(
                js_ast::symbol::NestedList::from_borrowed_slice_dangerous(
                    self.ast.items_mut().symbols,
                ),
            );
            let mut symbols = input_symbols.symbols_for_source.clone_in(self.bump);
            debug_assert_eq!(symbols.len(), input_symbols.symbols_for_source.len());
            for (dest, src) in symbols
                .slice_mut()
                .iter_mut()
                .zip(input_symbols.symbols_for_source.slice().iter())
            {
                *dest = src.clone_in(self.bump);
            }
            self.symbols = js_ast::symbol::Map::init_list(symbols);
        }

        // TODO: const_values
        // {
        //     var const_values = this.const_values;
        //     var count: usize = 0;
        //
        //     for (this.ast.items(.const_values)) |const_value| {
        //         count += const_value.count();
        //     }
        //
        //     if (count > 0) {
        //         try const_values.ensureTotalCapacity(this.allocator, count);
        //         for (this.ast.items(.const_values)) |const_value| {
        //             for (const_value.keys(), const_value.values()) |key, value| {
        //                 const_values.putAssumeCapacityNoClobber(key, value);
        //             }
        //         }
        //     }
        //
        //     this.const_values = const_values;
        // }

        {
            let mut count: usize = 0;
            for ts_enums in self.ast.items().ts_enums.iter() {
                count += ts_enums.count();
            }
            if count > 0 {
                self.ts_enums.ensure_total_capacity(self.bump, count)?;
                for ts_enums in self.ast.items().ts_enums.iter() {
                    debug_assert_eq!(ts_enums.keys().len(), ts_enums.values().len());
                    for (key, value) in ts_enums.keys().iter().zip(ts_enums.values().iter()) {
                        // PERF(port): was assume_capacity
                        self.ts_enums.put_assume_capacity_no_clobber(*key, *value);
                    }
                }
            }
        }

        let src_named_exports: &[js_ast::ast::NamedExports] = self.ast.items().named_exports;
        let dest_resolved_exports: &mut [ResolvedExports] = self.meta.items_mut().resolved_exports;
        debug_assert_eq!(src_named_exports.len(), dest_resolved_exports.len());
        for (source_index, (src, dest)) in src_named_exports
            .iter()
            .zip(dest_resolved_exports.iter_mut())
            .enumerate()
        {
            let mut resolved = ResolvedExports::default();
            resolved
                .ensure_total_capacity(self.bump, src.count())
                .expect("unreachable");
            debug_assert_eq!(src.keys().len(), src.values().len());
            for (key, value) in src.keys().iter().zip(src.values().iter()) {
                // PERF(port): was assume_capacity
                resolved.put_assume_capacity_no_clobber(
                    *key,
                    js_meta::ResolvedExport {
                        data: js_meta::ImportData {
                            import_ref: value.ref_,
                            name_loc: value.alias_loc,
                            source_index: Index::source(source_index),
                            ..Default::default()
                        },
                        ..Default::default()
                    },
                );
            }
            *dest = resolved;
        }
        Ok(())
    }

    /// Transfers ownership of the AST to the graph allocator.
    /// This is valid only if all allocators are `MimallocArena`s.
    pub fn take_ast_ownership(&mut self) {
        let ast = self.ast.slice_mut();
        // TODO(port): `MimallocArena::Borrowed::downcast(allocator)` has no Rust
        // equivalent — `self.bump` is already the arena. Phase B: confirm
        // `transfer_ownership` API on BabyList.
        let heap = self.bump;
        if !bun_collections::baby_list::SAFETY_CHECKS {
            return;
        }
        for import_records in ast.items_mut().import_records.iter_mut() {
            import_records.transfer_ownership(heap);
        }
        for parts in ast.items_mut().parts.iter_mut() {
            parts.transfer_ownership(heap);
            for part in parts.slice_mut().iter_mut() {
                part.dependencies.transfer_ownership(heap);
            }
        }
        for symbols in ast.items_mut().symbols.iter_mut() {
            symbols.transfer_ownership(heap);
        }
    }

    pub fn propagate_async_dependencies(&mut self) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        struct State<'a> {
            visited: AutoBitSet,
            import_records: &'a [import_record::List],
            flags: &'a mut [js_meta::Flags],
        }

        impl<'a> State<'a> {
            pub fn visit_all(&mut self) {
                for i in 0..self.import_records.len() {
                    self.visit(i);
                }
            }

            fn visit(&mut self, index: usize) {
                if self.visited.is_set(index) {
                    return;
                }
                self.visited.set(index);
                if self.flags[index].is_async_or_has_async_dependency {
                    return;
                }

                for import_record in self.import_records[index].slice_const().iter() {
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
                    if import_index >= self.import_records.len() {
                        continue;
                    }
                    self.visit(import_index);

                    if self.flags[import_index].is_async_or_has_async_dependency {
                        self.flags[index].is_async_or_has_async_dependency = true;
                        break;
                    }
                }
            }
        }

        let mut state = State {
            visited: AutoBitSet::init_empty(self.ast.len)?,
            import_records: self.ast.items().import_records,
            flags: self.meta.items_mut().flags,
        };
        state.visit_all();
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

    pub line_offset_table: bun_sourcemap::line_offset_table::List,
    pub quoted_source_contents: Option<Box<[u8]>>,
}

impl File {
    pub fn is_entry_point(&self) -> bool {
        self.entry_point_kind.is_entry_point()
    }

    pub fn is_user_specified_entry_point(&self) -> bool {
        self.entry_point_kind.is_user_specified_entry_point()
    }
}

impl Default for File {
    fn default() -> Self {
        Self {
            // TODO(port): Zig had `entry_bits: AutoBitSet = undefined` — using
            // Default here; Phase B: confirm zero-init is acceptable.
            entry_bits: AutoBitSet::default(),
            input_file: Index::source(0),
            distance_from_entry_point: u32::MAX,
            entry_point_kind: EntryPoint::Kind::None,
            entry_point_chunk_index: u32::MAX,
            line_offset_table: bun_sourcemap::line_offset_table::List::EMPTY,
            quoted_source_contents: None,
        }
    }
}

pub type FileList = MultiArrayList<File>;

// TODO(port): `UseDirective` enum location — assumed under
// `crate::ServerComponentBoundary` or sibling; Phase B: fix import.
use crate::UseDirective;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/LinkerGraph.zig (563 lines)
//   confidence: medium
//   todos:      9
//   notes:      MultiArrayList field-slice API assumed; addPartToFile Iterator has overlapping &mut (graph + cached overlay ptr) needing borrowck reshape; arena threaded as &'bump Arena
// ──────────────────────────────────────────────────────────────────────────
