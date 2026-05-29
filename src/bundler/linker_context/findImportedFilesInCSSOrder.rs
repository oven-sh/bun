use crate::mal_prelude::*;
use bstr::BStr;

use bun_alloc::Arena;
use bun_ast::{ImportKind, ImportRecord, ImportRecordFlags};
use bun_collections::{ArrayHashMap, StringArrayHashMap, VecExt};
use bun_core::handle_oom;

use crate::Graph::Graph;
use crate::bun_css::css_parser::BundlerCssRule;
use crate::bun_css::{BundlerStyleSheet, ImportConditions, LayerName};
use crate::chunk::{CssImportOrder, CssImportOrderKind, Layers};
use crate::linker_context_mod::debug;
use crate::{Index, LinkerContext};
use bun_ast::Index as AstIndex;

#[inline(always)]
unsafe fn bitwise_copy<T>(src: &T) -> T {
    // SAFETY: `src` is a valid aligned `&T`; the `unsafe fn` contract requires
    // the caller to ensure the duplicated value's `Drop` is suppressed (arena
    // ownership, see PORT NOTE above) so the aliased buffer is never freed twice.
    unsafe { core::ptr::read(src) }
}

/// Zig: `order.len = wip_order.len; @memcpy(order.slice(), wip_order.slice());
/// wip_order.clearRetainingCapacity();` — bitwise move of arena-backed entries
/// from `wip` back into `order`'s buffer (which always has `cap >= wip.len`).
#[inline]
fn memcpy_and_reset(order: &mut Vec<CssImportOrder>, wip: &mut Vec<CssImportOrder>) {
    debug_assert!(order.capacity() >= wip.len());
    // PORT NOTE: do not Drop `order`'s prior entries — they were already
    // bitwise-copied into `wip` (see `bitwise_copy` callers above), so dropping
    // here would double-free their `conditions` buffers.
    // SAFETY: `set_len(0)` is unconditionally sound (0 ≤ capacity; shrinking
    // exposes no uninitialized range).
    unsafe { order.set_len(0) };
    // `Vec::append` = reserve (no-op given the debug_assert) +
    // `copy_nonoverlapping` into `order[0..]` + `wip.set_len(0)` — exactly the
    // original `@memcpy` + `clearRetainingCapacity` sequence.
    order.append(wip);
}

pub fn find_imported_files_in_css_order<'a>(
    this: &'a mut LinkerContext,
    temp_arena: &'a Arena,
    entry_points: &[Index],
) -> Vec<CssImportOrder> {
    let _ = temp_arena;

    struct Visitor<'a> {
        arena: &'a Arena,
        // `BundledAst.css` SoA column.
        css_asts: &'a [crate::bundled_ast::CssCol],
        all_import_records: &'a [bun_ast::import_record::List<'a>],

        parse_graph: bun_ptr::BackRef<Graph<'a>>,

        has_external_import: bool,
        visited: Vec<Index>,
        order: Vec<CssImportOrder>,
    }

    impl<'a> Visitor<'a> {
        #[inline]
        fn input_file_pretty(&self, source_index: Index) -> &BStr {
            let sources = self.parse_graph.input_files.items_source();
            BStr::new(&sources[source_index.get() as usize].path.pretty)
        }

        pub(crate) fn visit(
            &mut self,
            source_index: Index,
            wrapping_conditions: &mut Vec<ImportConditions>,
            wrapping_import_records: &mut Vec<ImportRecord>,
        ) {
            debug!(
                "Visit file: {}={}",
                source_index.get(),
                self.input_file_pretty(source_index),
            );
            for visited_source_index in self.visited.slice() {
                if visited_source_index.get() == source_index.get() {
                    debug!(
                        "Skip file: {}={}",
                        source_index.get(),
                        self.input_file_pretty(source_index),
                    );
                    return;
                }
            }

            self.visited.push(source_index);

            let Some(repr): Option<&BundlerStyleSheet> =
                self.css_asts[source_index.get() as usize].as_deref()
            else {
                return; // Sanity check
            };
            let top_level_rules = &repr.rules;

            // PORT NOTE: `defer { _ = visitor.visited.pop(); }` — explicit pop at end.
            // The defer is registered AFTER the `orelse return` above, so skipping the
            // pop on that early-return path matches the original semantics.

            // Iterate over the top-level "@import" rules
            let mut import_record_idx: usize = 0;
            for rule in top_level_rules.v.iter() {
                if let BundlerCssRule::Import(import_rule) = rule {
                    // `defer import_record_idx += 1;` — increment at end of this arm
                    let record =
                        &self.all_import_records[source_index.get() as usize][import_record_idx];

                    // Follow internal dependencies
                    if record.source_index.is_valid() {
                        // If this import has conditions, fork our state so that the entire
                        // imported stylesheet subtree is wrapped in all of the conditions
                        if import_rule.has_conditions() {
                            let mut nested_conditions = core::mem::ManuallyDrop::new(
                                deep_clone_conditions(wrapping_conditions, self.arena),
                            );
                            let mut nested_import_records =
                                shallow_clone_records(wrapping_import_records);

                            // Clone these import conditions and append them to the state
                            nested_conditions.append_assume_capacity(
                                import_rule.conditions_with_import_records(
                                    self.arena,
                                    &mut nested_import_records,
                                ),
                            );
                            self.visit(
                                record.source_index,
                                &mut nested_conditions,
                                wrapping_import_records,
                            );
                            // `nested_import_records` is *not* passed to `visit` (the
                            // outer `wrapping_import_records` is), so it is uniquely
                            // owned here — drop it normally to free the buffer.
                            drop(nested_import_records);
                            import_record_idx += 1;
                            continue;
                        }
                        self.visit(
                            record.source_index,
                            wrapping_conditions,
                            wrapping_import_records,
                        );
                        import_record_idx += 1;
                        continue;
                    }

                    // Record external depednencies
                    if !record.flags.contains(ImportRecordFlags::IS_INTERNAL) {
                        if import_rule.has_conditions() {
                            let mut all_conditions =
                                deep_clone_conditions(wrapping_conditions, self.arena);
                            let mut all_import_records =
                                shallow_clone_records(wrapping_import_records);
                            all_conditions.append_assume_capacity(
                                import_rule.conditions_with_import_records(
                                    self.arena,
                                    &mut all_import_records,
                                ),
                            );
                            self.order.push(CssImportOrder {
                                kind: CssImportOrderKind::ExternalPath(record.path),
                                conditions: all_conditions,
                                condition_import_records: all_import_records,
                            });
                        } else {
                            self.order.push(CssImportOrder {
                                kind: CssImportOrderKind::ExternalPath(record.path),
                                // PORT NOTE: Zig `wrapping_conditions.*` is a bitwise struct copy.
                                // SAFETY: arena-backed `Vec` header; the pushed
                                // `CssImportOrder` never drops it (see PORT NOTE at
                                // `bitwise_copy`), so the aliased buffer is freed once
                                // with the arena.
                                conditions: unsafe { bitwise_copy(wrapping_conditions) },
                                // SAFETY: same single-free invariant as `conditions`
                                // above; `CssImportOrder` suppresses `Drop`.
                                condition_import_records: unsafe {
                                    bitwise_copy(wrapping_import_records)
                                },
                            });
                        }
                        debug!(
                            "Push external: {}={}",
                            source_index.get(),
                            self.input_file_pretty(source_index),
                        );
                        self.has_external_import = true;
                    }

                    import_record_idx += 1;
                }
            }

            // Iterate over the "composes" directives. Note that the order doesn't
            // matter for these because the output order is explicitly undfened
            // in the specification.
            for record in self.all_import_records[source_index.get() as usize].as_slice() {
                if record.kind == ImportKind::Composes && record.source_index.is_valid() {
                    self.visit(
                        record.source_index,
                        wrapping_conditions,
                        wrapping_import_records,
                    );
                }
            }

            if cfg!(debug_assertions) {
                debug!(
                    "Push file: {}={}",
                    source_index.get(),
                    self.input_file_pretty(source_index),
                );
            }
            // Accumulate imports in depth-first postorder
            self.order.push(CssImportOrder {
                kind: CssImportOrderKind::SourceIndex(AstIndex(source_index.get())),
                // PORT NOTE: Zig `wrapping_conditions.*` is a bitwise struct copy.
                // SAFETY: arena-backed `Vec` header; `CssImportOrder` suppresses
                // `Drop` on it (see PORT NOTE at `bitwise_copy`), so the aliased
                // buffer is freed once with the arena.
                conditions: unsafe { bitwise_copy(wrapping_conditions) },
                condition_import_records: Vec::new(),
            });

            // PORT NOTE: explicit pop replacing `defer { _ = visitor.visited.pop(); }`
            let _ = self.visited.pop();
        }
    }

    // PORT NOTE: reshaped for borrowck — read MultiArrayList columns before constructing visitor.
    let css_asts_slice: &[crate::bundled_ast::CssCol] = this.graph.ast.items_css();
    let all_import_records_slice = this.graph.ast.items_import_records();
    let arena = this.graph.arena();

    let mut visitor = Visitor {
        arena,
        parse_graph: bun_ptr::BackRef::from(
            core::ptr::NonNull::new(this.parse_graph).expect("parse_graph set in load()"),
        ),
        visited: Vec::<Index>::init_capacity(16),
        css_asts: css_asts_slice,
        all_import_records: all_import_records_slice,
        has_external_import: false,
        order: Vec::new(),
    };
    let mut wrapping_conditions: Vec<ImportConditions> = Vec::new();
    let mut wrapping_import_records: Vec<ImportRecord> = Vec::new();
    // Include all files reachable from any entry point
    for entry_point in entry_points {
        visitor.visit(
            *entry_point,
            &mut wrapping_conditions,
            &mut wrapping_import_records,
        );
    }

    let has_external_import = visitor.has_external_import;
    let mut order = visitor.order;
    let mut wip_order = Vec::<CssImportOrder>::init_capacity(order.len() as usize);

    let css_asts: &[crate::bundled_ast::CssCol] = css_asts_slice;

    debug_css_order(this, &order, CssOrderDebugStep::BeforeHoisting);

    if has_external_import {
        // Pass 1: Pull out leading "@layer" and external "@import" rules
        let mut is_at_layer_prefix = true;
        for entry in order.slice() {
            if (matches!(entry.kind, CssImportOrderKind::Layers(_)) && is_at_layer_prefix)
                || matches!(entry.kind, CssImportOrderKind::ExternalPath(_))
            {
                // SAFETY: `entry` is moved back into `order` via
                // `memcpy_and_reset` (which `set_len(0)`s without dropping), so
                // each `CssImportOrder` value is dropped at most once.
                wip_order.push(unsafe { bitwise_copy(entry) });
            }
            if !matches!(entry.kind, CssImportOrderKind::Layers(_)) {
                is_at_layer_prefix = false;
            }
        }

        // Pass 2: Append everything that we didn't pull out in pass 1
        is_at_layer_prefix = true;
        for entry in order.slice() {
            if (!matches!(entry.kind, CssImportOrderKind::Layers(_)) || !is_at_layer_prefix)
                && !matches!(entry.kind, CssImportOrderKind::ExternalPath(_))
            {
                // SAFETY: `entry` is moved back into `order` via
                // `memcpy_and_reset` (which `set_len(0)`s without dropping), so
                // each `CssImportOrder` value is dropped at most once.
                wip_order.push(unsafe { bitwise_copy(entry) });
            }
            if !matches!(entry.kind, CssImportOrderKind::Layers(_)) {
                is_at_layer_prefix = false;
            }
        }

        memcpy_and_reset(&mut order, &mut wip_order);
    }
    debug_css_order(this, &order, CssOrderDebugStep::AfterHoisting);

    {
        let mut source_index_duplicates: ArrayHashMap<u32, Vec<u32>> = ArrayHashMap::new();
        let mut external_path_duplicates: StringArrayHashMap<Vec<u32>> = StringArrayHashMap::new();

        let mut i: u32 = order.len() as u32;
        let order_ptr = order.as_mut_ptr();
        'next_backward: while i != 0 {
            i -= 1;
            // SAFETY: i < order.len; buffer is not reallocated in this loop.
            let entry: &CssImportOrder = unsafe { &*order_ptr.add(i as usize) };
            match &entry.kind {
                CssImportOrderKind::SourceIndex(idx) => {
                    let idx = *idx;
                    let gop = handle_oom(source_index_duplicates.get_or_put(idx.get()));
                    if !gop.found_existing {
                        *gop.value_ptr = Vec::<u32>::default();
                    }
                    for &j in gop.value_ptr.slice() {
                        // SAFETY: j < order.len; see note above.
                        let later = unsafe { &(*order_ptr.add(j as usize)).conditions };
                        if is_conditional_import_redundant(&entry.conditions, later) {
                            let layer_names_ptr = core::ptr::NonNull::from(
                                &css_asts[idx.get() as usize].as_deref().unwrap().layer_names,
                            )
                            .cast::<Vec<LayerName>>();
                            order.mut_(i as usize).kind =
                                CssImportOrderKind::Layers(Layers::borrow(layer_names_ptr));
                            continue 'next_backward;
                        }
                    }
                    gop.value_ptr.push(i);
                }
                CssImportOrderKind::ExternalPath(p) => {
                    let gop = handle_oom(external_path_duplicates.get_or_put(p.text));
                    if !gop.found_existing {
                        *gop.value_ptr = Vec::<u32>::default();
                    }
                    for &j in gop.value_ptr.slice() {
                        // SAFETY: j < order.len; see note above.
                        let later = unsafe { &(*order_ptr.add(j as usize)).conditions };
                        if is_conditional_import_redundant(&entry.conditions, later) {
                            // Don't remove duplicates entirely. The import conditions may
                            // still introduce layers to the layer order. Represent this as a
                            // file with an empty layer list.
                            order.mut_(i as usize).kind =
                                CssImportOrderKind::Layers(Layers::Owned(Vec::new()));
                            continue 'next_backward;
                        }
                    }
                    gop.value_ptr.push(i);
                }
                CssImportOrderKind::Layers(_) => {}
            }
        }
    }
    debug_css_order(this, &order, CssOrderDebugStep::AfterRemovingDuplicates);

    // Then optimize "@layer" rules by removing redundant ones. This loop goes
    // forward instead of backward because "@layer" takes effect at the first
    // copy instead of the last copy like other things in CSS.
    {
        struct DuplicateEntry {
            layers: bun_ptr::RawSlice<LayerName>,
            indices: Vec<u32>,
        }
        let mut layer_duplicates: Vec<DuplicateEntry> = Vec::new();

        'next_forward: for entry in order.slice_mut() {
            debug_css_order(
                this,
                &wip_order,
                CssOrderDebugStep::WhileOptimizingRedundantLayerRules,
            );
            match &mut entry.kind {
                // Simplify the conditions since we know they only wrap "@layer"
                CssImportOrderKind::Layers(layers) => {
                    // Truncate the conditions at the first anonymous layer
                    for (i, conditions) in entry.conditions.slice().iter().enumerate() {
                        if conditions.has_anonymous_layer() {
                            // SAFETY: `i < entry.conditions.len() <= capacity`;
                            // shrinking exposes no uninitialized range. The
                            // truncated tail is arena-owned (`deep_clone_conditions`)
                            // and bulk-freed with the arena, so skipping `Drop` is sound.
                            unsafe { entry.conditions.set_len((i as u32) as usize) };
                            layers.replace(Vec::new());
                            break;
                        }
                    }

                    if layers.inner().len() == 0 {
                        let mut i: u32 = entry.conditions.len() as u32;
                        while i != 0 {
                            i -= 1;
                            let condition = entry.conditions.at(i as usize);
                            if condition.layer.is_some() {
                                break;
                            }
                            // SAFETY: `i` was just decremented from a value
                            // `<= len`, so `i < len <= capacity`. Truncated tail
                            // is arena-owned (`deep_clone_conditions`) and
                            // bulk-freed with the arena.
                            unsafe { entry.conditions.set_len((i) as usize) };
                        }
                    }

                    // Remove unnecessary entries entirely
                    if entry.conditions.len() == 0 && layers.inner().len() == 0 {
                        continue;
                    }
                }
                _ => {}
            }

            let layers_key: *const [LayerName] = match &entry.kind {
                CssImportOrderKind::SourceIndex(idx) => {
                    // PORT NOTE: see LayerName nominal-type note above.
                    std::ptr::from_ref::<[_]>(
                        css_asts[idx.get() as usize]
                            .as_deref()
                            .unwrap()
                            .layer_names
                            .slice_const(),
                    ) as *const [LayerName]
                }
                CssImportOrderKind::Layers(layers) => layers.inner().slice_const(),
                CssImportOrderKind::ExternalPath(_) => &[][..],
            };
            // SAFETY: every match arm yields a pointer to a live slice (`css_asts`
            // arena, `entry.kind`'s `Layers`, or a static empty); the source-index
            // arm is a `*const [_]`-level cast between layout-identical `LayerName`
            // shadows (see PORT NOTE above). Valid for this loop iteration.
            let layers_key: &[LayerName] = unsafe { &*layers_key };
            let mut index: usize = 0;
            while index < layer_duplicates.len() as usize {
                let dup_layers: &[LayerName] = layer_duplicates.at(index).layers.slice();
                let both_equal = 'both_equal: {
                    if layers_key.len() != dup_layers.len() {
                        break 'both_equal false;
                    }

                    for (a, b) in layers_key.iter().zip(dup_layers) {
                        if !a.eql(b) {
                            break 'both_equal false;
                        }
                    }

                    break 'both_equal true;
                };

                if both_equal {
                    break;
                }
                index += 1;
            }
            if index == layer_duplicates.len() as usize {
                // This is the first time we've seen this combination of layer names.
                // Allocate a new set of duplicate indices to track this combination.
                layer_duplicates.push(DuplicateEntry {
                    layers: bun_ptr::RawSlice::new(layers_key),
                    indices: Vec::new(),
                });
            }
            let duplicates: &[u32] = layer_duplicates.at(index).indices.slice();
            let mut j = duplicates.len();
            while j != 0 {
                j -= 1;
                let duplicate_index = duplicates[j];
                if is_conditional_import_redundant(
                    &entry.conditions,
                    &wip_order.at(duplicate_index as usize).conditions,
                ) {
                    if !matches!(entry.kind, CssImportOrderKind::Layers(_)) {
                        if j == duplicates.len() - 1
                            && duplicate_index as usize == wip_order.len() - 1
                        {
                            let other = wip_order.at(duplicate_index as usize);
                            if matches!(other.kind, CssImportOrderKind::Layers(_))
                                && import_conditions_are_equal(
                                    entry.conditions.slice_const(),
                                    other.conditions.slice_const(),
                                )
                            {
                                // Remove the previous entry and then overwrite it below
                                // SAFETY: `duplicate_index == wip_order.len() - 1`
                                // (checked above), so the new len is `< capacity`.
                                // The truncated entry's buffers are arena-owned
                                // (`CssImportOrder` suppresses `Drop`), so skipping
                                // its destructor is the intended semantics.
                                unsafe { wip_order.set_len((duplicate_index) as usize) };
                                break;
                            }
                        }

                        // Non-layer entries still need to be present because they have
                        // other side effects beside inserting things in the layer order
                        // SAFETY: `entry` is moved back into `order` via
                        // `memcpy_and_reset` below (no `Drop` on the source slot),
                        // so each value is dropped at most once.
                        wip_order.push(unsafe { bitwise_copy(entry) });
                    }

                    // Don't add this to the duplicate list below because it's redundant
                    continue 'next_forward;
                }
            }

            layer_duplicates
                .mut_(index)
                .indices
                .push(wip_order.len() as u32);
            // SAFETY: `entry` is moved back into `order` via `memcpy_and_reset`
            // below (which `set_len(0)`s without dropping), so each value is
            // dropped at most once.
            wip_order.push(unsafe { bitwise_copy(entry) });
        }

        debug_css_order(
            this,
            &wip_order,
            CssOrderDebugStep::WhileOptimizingRedundantLayerRules,
        );

        memcpy_and_reset(&mut order, &mut wip_order);
    }
    debug_css_order(
        this,
        &order,
        CssOrderDebugStep::AfterOptimizingRedundantLayerRules,
    );

    // Finally, merge adjacent "@layer" rules with identical conditions together.
    {
        let mut did_clone: i32 = -1;
        for entry in order.slice() {
            if matches!(entry.kind, CssImportOrderKind::Layers(_)) && wip_order.len() > 0 {
                let prev_index = wip_order.len() - 1;
                let prev = wip_order.at(prev_index as usize);
                if matches!(prev.kind, CssImportOrderKind::Layers(_))
                    && import_conditions_are_equal(
                        prev.conditions.slice_const(),
                        entry.conditions.slice_const(),
                    )
                {
                    let prev_index_i32 = prev_index as i32;
                    if did_clone != prev_index_i32 {
                        did_clone = prev_index_i32;
                    }
                    // need to clone the layers here as they could be references to css ast
                    if let CssImportOrderKind::Layers(prev_layers) =
                        &mut wip_order.mut_(prev_index as usize).kind
                    {
                        if let CssImportOrderKind::Layers(entry_layers) = &entry.kind {
                            prev_layers
                                .to_owned()
                                .append_slice(entry_layers.inner().slice_const());
                        }
                    }
                }
            }
        }
        let _ = did_clone;
    }
    debug_css_order(
        this,
        &order,
        CssOrderDebugStep::AfterMergingAdjacentLayerRules,
    );

    order
}

#[inline]
fn deep_clone_conditions(list: &Vec<ImportConditions>, arena: &Arena) -> Vec<ImportConditions> {
    let cap = list.len() as usize + 1;
    let slab = arena.alloc_uninit_slice::<ImportConditions>(cap);
    for (dst, src) in slab.iter_mut().zip(list.slice_const()) {
        dst.write(src.deep_clone(arena));
    }
    // SAFETY: `slab[..list.len()]` was just initialized; cap is the slab
    // length. The resulting `Vec` is never dropped (always `mem::forget`'d)
    // and never reallocates (callers only push one element via
    // `append_assume_capacity` and otherwise truncate), so the
    // global-allocator invariant of `Vec::from_raw_parts` is never exercised.
    unsafe {
        Vec::from_raw_parts(
            slab.as_mut_ptr().cast::<ImportConditions>(),
            list.len() as usize,
            cap,
        )
    }
}

/// Zig: `bun.handleOom(wrapping_import_records.clone(arena))` — shallow
/// memcpy of `ImportRecord` values into a fresh allocation.
#[inline]
fn shallow_clone_records(list: &Vec<ImportRecord>) -> Vec<ImportRecord> {
    let mut out = Vec::<ImportRecord>::init_capacity(list.len() as usize);
    for r in list.slice_const() {
        // PORT NOTE: `ImportRecord` is plain-old-data in Zig (no destructor);
        // `Path<'static>` slices borrow resolver storage. Bitwise copy matches
        // the Zig `clone(arena)` semantics.
        // SAFETY: `ImportRecord` is POD (borrowed slices, no owning `Drop`); a
        // bitwise duplicate aliasing the same resolver storage is sound and
        // neither copy frees it.
        out.append_assume_capacity(unsafe { bitwise_copy(r) });
    }
    out
}

fn import_conditions_are_equal(a: &[ImportConditions], b: &[ImportConditions]) -> bool {
    if a.len() != b.len() {
        return false;
    }

    for (ai, bi) in a.iter().zip(b) {
        if !ImportConditions::layers_eql(ai, bi)
            || !ImportConditions::supports_eql(ai, bi)
            || !ai.media.eql(&bi.media)
        {
            return false;
        }
    }

    true
}

pub(crate) fn is_conditional_import_redundant(
    earlier: &Vec<ImportConditions>,
    later: &Vec<ImportConditions>,
) -> bool {
    if later.len() > earlier.len() {
        return false;
    }

    for i in 0..later.len() as usize {
        let a = earlier.at(i);
        let b = later.at(i);

        // Only compare "@supports" and "@media" if "@layers" is equal
        if ImportConditions::layers_eql(a, b) {
            let same_supports = ImportConditions::supports_eql(a, b);
            let same_media = a.media.eql(&b.media);

            if same_supports && same_media {
                continue;
            }

            if same_media && b.supports.is_none() {
                continue;
            }

            if same_supports && b.media.media_queries.is_empty() {
                continue;
            }
        }

        return false;
    }

    true
}

#[derive(Clone, Copy)]
enum CssOrderDebugStep {
    BeforeHoisting,
    AfterHoisting,
    AfterRemovingDuplicates,
    WhileOptimizingRedundantLayerRules,
    AfterOptimizingRedundantLayerRules,
    AfterMergingAdjacentLayerRules,
}

impl CssOrderDebugStep {
    #[cfg(debug_assertions)]
    fn tag_name(self) -> &'static str {
        match self {
            Self::BeforeHoisting => "BEFORE_HOISTING",
            Self::AfterHoisting => "AFTER_HOISTING",
            Self::AfterRemovingDuplicates => "AFTER_REMOVING_DUPLICATES",
            Self::WhileOptimizingRedundantLayerRules => "WHILE_OPTIMIZING_REDUNDANT_LAYER_RULES",
            Self::AfterOptimizingRedundantLayerRules => "AFTER_OPTIMIZING_REDUNDANT_LAYER_RULES",
            Self::AfterMergingAdjacentLayerRules => "AFTER_MERGING_ADJACENT_LAYER_RULES",
        }
    }
}

fn debug_css_order(this: &LinkerContext, order: &Vec<CssImportOrder>, step: CssOrderDebugStep) {
    // PERF(port): `step` was a comptime enum param; debug-only so demoted to runtime.
    #[cfg(debug_assertions)]
    {
        // PORT NOTE: comptime `"BUN_DEBUG_CSS_ORDER_" ++ @tagName(step)` —
        // runtime concat is fine here (debug-only).
        let tag = step.tag_name();
        let env_var = format!("BUN_DEBUG_CSS_ORDER_{}\0", tag);
        let enable_all = bun_core::env_var::BUN_DEBUG_CSS_ORDER
            .get()
            .unwrap_or(false);
        let enable_step =
            bun_core::getenv_z(bun_core::ZStr::from_slice_with_nul(env_var.as_bytes()))
                .map(|v| !v.is_empty() && v != b"0" && v != b"false")
                .unwrap_or(false);
        if enable_all || enable_step {
            debug_css_order_impl(this, order, step);
        }
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = (this, order, step);
    }
}

#[cfg(debug_assertions)]
fn debug_css_order_impl(
    this: &LinkerContext,
    order: &Vec<CssImportOrder>,
    step: CssOrderDebugStep,
) {
    #[cfg(debug_assertions)]
    {
        use crate::bun_css::{ImportInfo, LocalsResultsMap, Printer, PrinterOptions};

        let tag = step.tag_name();
        debug!("CSS order {}:\n", tag);

        let arena = bun_alloc::Arena::new();
        let parse_graph = this.parse_graph();
        let ast_urls_for_css = parse_graph.ast.items_url_for_css();
        // SAFETY: read-only fan-out of `&[Box<[u8]>]` as `&[&[u8]]`; relies on
        // fat-pointer field-order equivalence (see `boxed_slices_as_borrowed`).
        let unique_keys: &[&[u8]] = unsafe {
            bun_ptr::boxed_slices_as_borrowed(
                parse_graph
                    .input_files
                    .items_unique_key_for_additional_file(),
            )
        };
        // `LocalsResultsMap` is the same `ArrayHashMap<Ref, Box<[u8]>>` alias as
        // `bun_js_printer::MangledProps`; no cast needed.
        let local_names: &LocalsResultsMap = &this.mangled_props;
        let symbols = bun_ast::symbol::Map::init_list(Default::default());

        for (i, entry) in order.slice().iter().enumerate() {
            let conditions_str: std::borrow::Cow<'_, str> = if entry.conditions.len() > 0 {
                let mut writer: Vec<u8> = Vec::new();
                writer.extend_from_slice(b"[");
                for (j, condition) in entry.conditions.slice_const().iter().enumerate() {
                    let mut printer = Printer::new(
                        &arena,
                        bun_alloc::ArenaVec::new_in(&arena),
                        &mut writer,
                        &PrinterOptions::default(),
                        Some(ImportInfo {
                            import_records: &entry.condition_import_records,
                            ast_urls_for_css,
                            ast_unique_key_for_additional_file: unique_keys,
                        }),
                        Some(local_names),
                        &symbols,
                    );
                    let _ = condition.to_css(&mut printer);
                    drop(printer);
                    if j != entry.conditions.len() as usize - 1 {
                        writer.extend_from_slice(b", ");
                    }
                }
                writer.extend_from_slice(b" ]");
                String::from_utf8_lossy(&writer).into_owned().into()
            } else {
                "[]".into()
            };
            debug!("  {}: {} {}\n", i, entry.fmt(this), conditions_str);
        }
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = (this, order, step);
    }
}

pub use crate::DeferredBatchTask;
pub use crate::ParseTask;
pub use crate::ThreadPool;

// ported from: src/bundler/linker_context/findImportedFilesInCSSOrder.zig
