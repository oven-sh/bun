use bun_collections::{AutoBitSet, BabyList, DynamicBitSet, HashMap};
use bun_options_types::ImportRecord;

use crate::{
    Chunk, Index, JSMeta, LinkerContext, Part, PartRange,
    chunk::{self, EntryPoint, Order},
    js_ast,
};
// TODO(port): verify crate path for bun.perf.trace
use bun_core::perf;

pub fn find_all_imported_parts_in_js_order(
    this: &mut LinkerContext,
    chunks: &mut [Chunk],
) -> Result<(), bun_core::Error> {
    // TODO(port): narrow error set
    let _trace = perf::trace("Bundler.findAllImportedPartsInJSOrder");

    let mut part_ranges_shared: Vec<PartRange> = Vec::new();
    let mut parts_prefix_shared: Vec<PartRange> = Vec::new();
    // PERF(port): temp_allocator dropped — bundler is an AST crate, so per PORTING.md these arena-fed
    // scratch lists should become `bumpalo::collections::Vec<'bump, PartRange>` with a threaded
    // `&'bump Bump`; deferred to Phase B (introduces lifetimes on this fn + visitor). Profile in Phase B.
    for (index, chunk) in chunks.iter_mut().enumerate() {
        match &chunk.content {
            chunk::Content::Javascript(_) => {
                find_imported_parts_in_js_order(
                    this,
                    chunk,
                    &mut part_ranges_shared,
                    &mut parts_prefix_shared,
                    u32::try_from(index).unwrap(),
                )?;
            }
            chunk::Content::Css(_) => {} // handled in `find_imported_css_files_in_js_order`
            chunk::Content::Html(_) => {}
        }
    }
    Ok(())
}

pub fn find_imported_parts_in_js_order(
    this: &mut LinkerContext,
    chunk: &mut Chunk,
    part_ranges_shared: &mut Vec<PartRange>,
    parts_prefix_shared: &mut Vec<PartRange>,
    chunk_index: u32,
) -> Result<(), bun_core::Error> {
    // TODO(port): narrow error set
    let mut chunk_order_array: Vec<Order> =
        Vec::with_capacity(chunk.files_with_parts_in_chunk.count());
    // PERF(port): this.allocator() dropped — was per-LinkerContext arena; profile in Phase B
    let distances = this.graph.files.items().distance_from_entry_point;
    for &source_index in chunk.files_with_parts_in_chunk.keys() {
        // PERF(port): was appendAssumeCapacity
        chunk_order_array.push(Order {
            source_index,
            distance: distances[source_index as usize],
            tie_breaker: this.graph.stable_source_indices[source_index as usize],
        });
    }

    Order::sort(&mut chunk_order_array);

    part_ranges_shared.clear();
    parts_prefix_shared.clear();

    // PORT NOTE: reshaped for borrowck — capture before constructing visitor (which holds &mut LinkerContext)
    let with_code_splitting = this.graph.code_splitting;
    let with_scb = this.graph.is_scb_bitset.bit_length() > 0;

    // TODO(port): borrowck — visitor holds &mut LinkerContext alongside slices borrowed
    // from this.graph (flags/parts/import_records) and chunk.entry_bits(). Phase B may
    // need to either drop the cached slice fields and access through `c`, or use raw
    // pointers for the slices.
    let mut visitor = FindImportedPartsVisitor {
        // PERF(port): files/visited were this.allocator() arena — profile in Phase B
        files: Vec::new(),
        part_ranges: core::mem::take(part_ranges_shared),
        parts_prefix: core::mem::take(parts_prefix_shared),
        visited: HashMap::default(),
        flags: this.graph.meta.items().flags,
        parts: this.graph.ast.items().parts,
        import_records: this.graph.ast.items().import_records,
        entry_bits: chunk.entry_bits(),
        c: this,
        entry_point: chunk.entry_point,
        chunk_index,
    };

    // PERF(port): was comptime bool dispatch (nested `inline else`) — profile in Phase B
    match (with_code_splitting, with_scb) {
        (true, true) => run_visits::<true, true>(&mut visitor, &chunk_order_array),
        (true, false) => run_visits::<true, false>(&mut visitor, &chunk_order_array),
        (false, true) => run_visits::<false, true>(&mut visitor, &chunk_order_array),
        (false, false) => run_visits::<false, false>(&mut visitor, &chunk_order_array),
    }

    // PERF(port): was this.allocator() arena — profile in Phase B
    let mut parts_in_chunk_order: Vec<PartRange> =
        Vec::with_capacity(visitor.part_ranges.len() + visitor.parts_prefix.len());
    // bun.concat: parts_prefix first, then part_ranges
    parts_in_chunk_order.extend_from_slice(&visitor.parts_prefix);
    parts_in_chunk_order.extend_from_slice(&visitor.part_ranges);

    // Zig `defer { part_ranges_shared.* = visitor.part_ranges; ... visitor.visited.deinit(); }`
    // No fallible ops remain past this point in Rust, so plain move-back is equivalent.
    *part_ranges_shared = visitor.part_ranges;
    *parts_prefix_shared = visitor.parts_prefix;
    // visitor.visited dropped implicitly

    // TODO(port): chunk.content.javascript field access — depends on Chunk::Content enum shape
    chunk.content.javascript_mut().files_in_chunk_order = visitor.files;
    chunk.content.javascript_mut().parts_in_chunk_in_order = parts_in_chunk_order;
    Ok(())
}

#[inline]
fn run_visits<'a, const WITH_CODE_SPLITTING: bool, const WITH_SCB: bool>(
    visitor: &mut FindImportedPartsVisitor<'a>,
    chunk_order_array: &[Order],
) {
    visitor.visit::<WITH_CODE_SPLITTING, WITH_SCB>(Index::RUNTIME.value());
    for order in chunk_order_array {
        visitor.visit::<WITH_CODE_SPLITTING, WITH_SCB>(order.source_index);
    }
}

pub struct FindImportedPartsVisitor<'a> {
    pub entry_bits: &'a AutoBitSet,
    pub flags: &'a [JSMeta::Flags],
    pub parts: &'a [BabyList<Part>],
    pub import_records: &'a [BabyList<ImportRecord>],
    pub files: Vec<Index::Int>,
    pub part_ranges: Vec<PartRange>,
    pub visited: HashMap<Index::Int, ()>,
    pub parts_prefix: Vec<PartRange>,
    pub c: &'a mut LinkerContext,
    pub entry_point: EntryPoint,
    pub chunk_index: u32,
}

impl<'a> FindImportedPartsVisitor<'a> {
    fn append_or_extend_range(
        ranges: &mut Vec<PartRange>,
        source_index: Index::Int,
        part_index: Index::Int,
    ) {
        if let Some(last_range) = ranges.last_mut() {
            if last_range.source_index.get() == source_index
                && last_range.part_index_end == part_index
            {
                last_range.part_index_end += 1;
                return;
            }
        }

        ranges.push(PartRange {
            source_index: Index::init(source_index),
            part_index_begin: part_index,
            part_index_end: part_index + 1,
        });
    }

    // Traverse the graph using this stable order and linearize the files with
    // dependencies before dependents
    pub fn visit<const WITH_CODE_SPLITTING: bool, const WITH_SCB: bool>(
        &mut self,
        source_index: Index::Int,
    ) {
        if source_index == Index::INVALID.value() {
            return;
        }
        // TODO(port): bun_collections::HashMap get_or_put API — using entry() shape for now
        let visited_entry = self.visited.get_or_put(source_index);
        if visited_entry.found_existing {
            return;
        }

        let mut is_file_in_chunk = if WITH_CODE_SPLITTING
            && self.c.graph.ast.items().css[source_index as usize].is_none()
        {
            // when code splitting, include the file in the chunk if ALL of the entry points overlap
            self.entry_bits
                .eql(&self.c.graph.files.items().entry_bits[source_index as usize])
        } else {
            // when NOT code splitting, include the file in the chunk if ANY of the entry points overlap
            self.entry_bits
                .has_intersection(&self.c.graph.files.items().entry_bits[source_index as usize])
        };

        // Wrapped files can't be split because they are all inside the wrapper
        let can_be_split = self.flags[source_index as usize].wrap == Wrap::None;

        let parts = self.parts[source_index as usize].slice();
        if can_be_split
            && is_file_in_chunk
            && parts[js_ast::NAMESPACE_EXPORT_PART_INDEX as usize].is_live
        {
            Self::append_or_extend_range(
                &mut self.part_ranges,
                source_index,
                js_ast::NAMESPACE_EXPORT_PART_INDEX,
            );
        }

        let records = self.import_records[source_index as usize].slice();

        for (part_index_, part) in parts.iter().enumerate() {
            let part_index = part_index_ as u32;
            let is_part_in_this_chunk = is_file_in_chunk && part.is_live;
            for &record_id in part.import_record_indices.slice() {
                let record: &ImportRecord = &records[record_id as usize];
                if record.source_index.is_valid()
                    && (record.kind == ImportKind::Stmt || is_part_in_this_chunk)
                {
                    if self.c.is_external_dynamic_import(record, source_index) {
                        // Don't follow import() dependencies
                        continue;
                    }

                    self.visit::<WITH_CODE_SPLITTING, WITH_SCB>(record.source_index.get());
                }
            }

            // Then include this part after the files it imports
            if is_part_in_this_chunk {
                is_file_in_chunk = true;

                if can_be_split
                    && part_index != js_ast::NAMESPACE_EXPORT_PART_INDEX
                    && self.c.should_include_part(source_index, part)
                {
                    let js_parts = if source_index == Index::RUNTIME.value() {
                        &mut self.parts_prefix
                    } else {
                        &mut self.part_ranges
                    };

                    Self::append_or_extend_range(js_parts, source_index, part_index);
                }
            }
        }

        if is_file_in_chunk {
            if WITH_SCB && self.c.graph.is_scb_bitset.is_set(source_index as usize) {
                self.c.graph.files.items_mut().entry_point_chunk_index[source_index as usize] =
                    self.chunk_index;
            }

            self.files.push(source_index);

            // CommonJS files are all-or-nothing so all parts must be contiguous
            if !can_be_split {
                self.parts_prefix.push(PartRange {
                    source_index: Index::init(source_index),
                    part_index_begin: 0,
                    part_index_end: parts.len() as u32,
                });
            }
        }
    }
}

pub type BitSet = DynamicBitSet;

// TODO(port): these are referenced via path expressions; verify exact module paths in Phase B
use bun_options_types::ImportKind;
use crate::js_meta::Wrap;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/linker_context/findAllImportedPartsInJSOrder.zig (221 lines)
//   confidence: medium
//   todos:      6
//   notes:      visitor holds &mut LinkerContext + slices into it (borrowck conflict); MultiArrayList .items(.field) mapped to .items().field placeholder
// ──────────────────────────────────────────────────────────────────────────
