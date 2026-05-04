use bstr::BStr;

use bun_alloc::Arena; // bumpalo::Bump re-export (AST crate: bundler keeps arenas)
use bun_collections::{ArrayHashMap, BabyList};
use bun_css::{BundlerStyleSheet, ImportConditions, LayerName};
use bun_js_parser::Symbol;
use bun_options_types::ImportRecord;

use crate::chunk::{self, Chunk, CssImportOrder};
// TODO(port): exact module paths for Kind/Layers depend on how Chunk.CssImportOrder is ported.
use crate::chunk::css_import_order::{Kind as CssImportKind, Layers as CssImportLayers};
use crate::{Graph, Index, LinkerContext, LinkerGraph};

// `debug` in the Zig is `LinkerContext.debug`, a scoped Output log.
// TODO(port): wire this to the actual scoped-log macro once LinkerContext is ported.
macro_rules! debug {
    ($($args:tt)*) => {
        crate::linker_context::debug(format_args!($($args)*))
    };
}

/// CSS files are traversed in depth-first postorder just like JavaScript. But
/// unlike JavaScript import statements, CSS "@import" rules are evaluated every
/// time instead of just the first time.
///
///      A
///     / \
///    B   C
///     \ /
///      D
///
/// If A imports B and then C, B imports D, and C imports D, then the CSS
/// traversal order is D B D C A.
///
/// However, evaluating a CSS file multiple times is sort of equivalent to
/// evaluating it once at the last location. So we basically drop all but the
/// last evaluation in the order.
///
/// The only exception to this is "@layer". Evaluating a CSS file multiple
/// times is sort of equivalent to evaluating it once at the first location
/// as far as "@layer" is concerned. So we may in some cases keep both the
/// first and last locations and only write out the "@layer" information
/// for the first location.
pub fn find_imported_files_in_css_order<'a>(
    this: &'a mut LinkerContext,
    temp_allocator: &'a Arena,
    entry_points: &[Index],
) -> BabyList<CssImportOrder> {
    struct Visitor<'a> {
        allocator: &'a Arena,
        temp_allocator: &'a Arena,
        // TODO(port): element type may be Option<Box<BundlerStyleSheet>> depending on Graph.ast layout
        css_asts: &'a [Option<&'a BundlerStyleSheet>],
        all_import_records: &'a [BabyList<ImportRecord>],

        graph: &'a mut LinkerGraph,
        parse_graph: &'a Graph,

        has_external_import: bool,
        visited: BabyList<Index>,
        order: BabyList<CssImportOrder>,
    }

    impl<'a> Visitor<'a> {
        pub fn visit(
            visitor: &mut Self,
            source_index: Index,
            wrapping_conditions: &mut BabyList<ImportConditions>,
            wrapping_import_records: &mut BabyList<ImportRecord>,
        ) {
            debug!(
                "Visit file: {}={}",
                source_index.get(),
                BStr::new(
                    &visitor.parse_graph.input_files.items().source[source_index.get() as usize]
                        .path
                        .pretty
                ),
            );
            // The CSS specification strangely does not describe what to do when there
            // is a cycle. So we are left with reverse-engineering the behavior from a
            // real browser. Here's what the WebKit code base has to say about this:
            //
            //   "Check for a cycle in our import chain. If we encounter a stylesheet
            //   in our parent chain with the same URL, then just bail."
            //
            // So that's what we do here. See "StyleRuleImport::requestStyleSheet()" in
            // WebKit for more information.
            for visited_source_index in visitor.visited.slice() {
                if visited_source_index.get() == source_index.get() {
                    debug!(
                        "Skip file: {}={}",
                        source_index.get(),
                        BStr::new(
                            &visitor.parse_graph.input_files.items().source
                                [source_index.get() as usize]
                                .path
                                .pretty
                        ),
                    );
                    return;
                }
            }

            visitor.visited.append(visitor.temp_allocator, source_index);

            let Some(repr): Option<&BundlerStyleSheet> =
                visitor.css_asts[source_index.get() as usize]
            else {
                return; // Sanity check
            };
            let top_level_rules = &repr.rules;

            // TODO: should we even do this? @import rules have to be the first rules in the stylesheet, why even allow pre-import layers?
            // Any pre-import layers come first
            // if len(repr.AST.LayersPreImport) > 0 {
            //     order = append(order, cssImportOrder{
            //         kind:                   cssImportLayers,
            //         layers:                 repr.AST.LayersPreImport,
            //         conditions:             wrappingConditions,
            //         conditionImportRecords: wrappingImportRecords,
            //     })
            // }

            // `defer { _ = visitor.visited.pop(); }`
            // PORT NOTE: reshaped for borrowck — explicit pop at end instead of defer guard.
            // (Cannot capture &mut visitor in a scopeguard while the body also uses it; the
            // Zig defer is registered AFTER the `orelse return` above, so skipping the pop on
            // that early-return path matches the original semantics.)

            // Iterate over the top-level "@import" rules
            let mut import_record_idx: usize = 0;
            for rule in top_level_rules.v.iter() {
                if let bun_css::CssRule::Import(import_rule) = rule {
                    // `defer import_record_idx += 1;` — increment at end of this arm
                    let record = visitor.all_import_records[source_index.get() as usize]
                        .at(import_record_idx);

                    // Follow internal dependencies
                    if record.source_index.is_valid() {
                        // If this import has conditions, fork our state so that the entire
                        // imported stylesheet subtree is wrapped in all of the conditions
                        if import_rule.has_conditions() {
                            // Fork our state
                            let mut nested_conditions =
                                wrapping_conditions.deep_clone_infallible(visitor.allocator);
                            let mut nested_import_records =
                                wrapping_import_records.clone_in(visitor.allocator);

                            // Clone these import conditions and append them to the state
                            nested_conditions.append(
                                visitor.allocator,
                                import_rule.conditions_with_import_records(
                                    visitor.allocator,
                                    &mut nested_import_records,
                                ),
                            );
                            visitor.visit(
                                record.source_index,
                                &mut nested_conditions,
                                wrapping_import_records,
                            );
                            import_record_idx += 1;
                            continue;
                        }
                        visitor.visit(
                            record.source_index,
                            wrapping_conditions,
                            wrapping_import_records,
                        );
                        import_record_idx += 1;
                        continue;
                    }

                    // Record external depednencies
                    if !record.flags.is_internal {
                        let mut all_conditions =
                            wrapping_conditions.deep_clone_infallible(visitor.allocator);
                        let mut all_import_records =
                            wrapping_import_records.clone_in(visitor.allocator);
                        // If this import has conditions, append it to the list of overall
                        // conditions for this external import. Note that an external import
                        // may actually have multiple sets of conditions that can't be
                        // merged. When this happens we need to generate a nested imported
                        // CSS file using a data URL.
                        if import_rule.has_conditions() {
                            all_conditions.append(
                                visitor.allocator,
                                import_rule.conditions_with_import_records(
                                    visitor.allocator,
                                    &mut all_import_records,
                                ),
                            );
                            visitor.order.append(
                                visitor.allocator,
                                CssImportOrder {
                                    kind: CssImportKind::ExternalPath(record.path.clone()),
                                    conditions: all_conditions,
                                    condition_import_records: all_import_records,
                                },
                            );
                        } else {
                            visitor.order.append(
                                visitor.allocator,
                                CssImportOrder {
                                    kind: CssImportKind::ExternalPath(record.path.clone()),
                                    conditions: *wrapping_conditions,
                                    condition_import_records: *wrapping_import_records,
                                },
                            );
                        }
                        debug!(
                            "Push external: {}={}",
                            source_index.get(),
                            BStr::new(
                                &visitor.parse_graph.input_files.items().source
                                    [source_index.get() as usize]
                                    .path
                                    .pretty
                            ),
                        );
                        visitor.has_external_import = true;
                    }

                    import_record_idx += 1;
                }
            }

            // Iterate over the "composes" directives. Note that the order doesn't
            // matter for these because the output order is explicitly undfened
            // in the specification.
            for record in visitor.all_import_records[source_index.get() as usize].slice_const() {
                if record.kind == bun_options_types::ImportKind::Composes
                    && record.source_index.is_valid()
                {
                    visitor.visit(
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
                    BStr::new(
                        &visitor.parse_graph.input_files.items().source
                            [source_index.get() as usize]
                            .path
                            .pretty
                    ),
                );
            }
            // Accumulate imports in depth-first postorder
            visitor.order.append(
                visitor.allocator,
                CssImportOrder {
                    kind: CssImportKind::SourceIndex(source_index),
                    conditions: *wrapping_conditions,
                    condition_import_records: BabyList::default(),
                },
            );

            // PORT NOTE: explicit pop replacing `defer { _ = visitor.visited.pop(); }`
            let _ = visitor.visited.pop();
        }
    }

    // PORT NOTE: reshaped for borrowck — read MultiArrayList columns before taking &mut graph.
    let css_asts_slice = this.graph.ast.items().css;
    let all_import_records_slice = this.graph.ast.items().import_records;
    let allocator = this.allocator();

    let mut visitor = Visitor {
        allocator,
        temp_allocator,
        graph: &mut this.graph,
        parse_graph: this.parse_graph,
        visited: BabyList::<Index>::init_capacity(temp_allocator, 16),
        css_asts: css_asts_slice,
        all_import_records: all_import_records_slice,
        has_external_import: false,
        order: BabyList::default(),
    };
    let mut wrapping_conditions: BabyList<ImportConditions> = BabyList::default();
    let mut wrapping_import_records: BabyList<ImportRecord> = BabyList::default();
    // Include all files reachable from any entry point
    for entry_point in entry_points {
        visitor.visit(*entry_point, &mut wrapping_conditions, &mut wrapping_import_records);
    }

    let mut order = visitor.order;
    let mut wip_order =
        BabyList::<CssImportOrder>::init_capacity(temp_allocator, order.len as usize);

    let css_asts: &[Option<&BundlerStyleSheet>] = css_asts_slice;
    // TODO(port): css_asts column type — see Visitor.css_asts note above.

    debug_css_order(this, &order, CssOrderDebugStep::BeforeHoisting);

    // CSS syntax unfortunately only allows "@import" rules at the top of the
    // file. This means we must hoist all external "@import" rules to the top of
    // the file when bundling, even though doing so will change the order of CSS
    // evaluation.
    if visitor.has_external_import {
        // Pass 1: Pull out leading "@layer" and external "@import" rules
        let mut is_at_layer_prefix = true;
        for entry in order.slice() {
            if (matches!(entry.kind, CssImportKind::Layers(_)) && is_at_layer_prefix)
                || matches!(entry.kind, CssImportKind::ExternalPath(_))
            {
                wip_order.append(temp_allocator, *entry);
            }
            if !matches!(entry.kind, CssImportKind::Layers(_)) {
                is_at_layer_prefix = false;
            }
        }

        // Pass 2: Append everything that we didn't pull out in pass 1
        is_at_layer_prefix = true;
        for entry in order.slice() {
            if (!matches!(entry.kind, CssImportKind::Layers(_)) || !is_at_layer_prefix)
                && !matches!(entry.kind, CssImportKind::ExternalPath(_))
            {
                wip_order.append(temp_allocator, *entry);
            }
            if !matches!(entry.kind, CssImportKind::Layers(_)) {
                is_at_layer_prefix = false;
            }
        }

        order.len = wip_order.len;
        order.slice_mut().copy_from_slice(wip_order.slice());
        wip_order.clear();
    }
    debug_css_order(this, &order, CssOrderDebugStep::AfterHoisting);

    // Next, optimize import order. If there are duplicate copies of an imported
    // file, replace all but the last copy with just the layers that are in that
    // file. This works because in CSS, the last instance of a declaration
    // overrides all previous instances of that declaration.
    {
        let mut source_index_duplicates: ArrayHashMap<u32, BabyList<u32>> =
            ArrayHashMap::new_in(temp_allocator);
        // TODO(port): StringArrayHashMap key borrows path text from `order`; verify lifetime in Phase B.
        let mut external_path_duplicates: ArrayHashMap<&[u8], BabyList<u32>> =
            ArrayHashMap::new_in(temp_allocator);

        let mut i: u32 = order.len;
        'next_backward: while i != 0 {
            i -= 1;
            let entry = order.at(i as usize);
            match &entry.kind {
                CssImportKind::SourceIndex(idx) => {
                    let gop = source_index_duplicates.get_or_put(idx.get());
                    if !gop.found_existing {
                        *gop.value_ptr = BabyList::<u32>::default();
                    }
                    for &j in gop.value_ptr.slice() {
                        if is_conditional_import_redundant(
                            &entry.conditions,
                            &order.at(j as usize).conditions,
                        ) {
                            // This import is redundant, but it might have @layer rules.
                            // So we should keep the @layer rules so that the cascade ordering of layers
                            // is preserved
                            order.at_mut(i as usize).kind = CssImportKind::Layers(
                                CssImportLayers::borrow(
                                    &css_asts[idx.get() as usize].unwrap().layer_names,
                                ),
                            );
                            continue 'next_backward;
                        }
                    }
                    gop.value_ptr.append(temp_allocator, i);
                }
                CssImportKind::ExternalPath(p) => {
                    let gop = external_path_duplicates.get_or_put(p.text.as_ref());
                    if !gop.found_existing {
                        *gop.value_ptr = BabyList::<u32>::default();
                    }
                    for &j in gop.value_ptr.slice() {
                        if is_conditional_import_redundant(
                            &entry.conditions,
                            &order.at(j as usize).conditions,
                        ) {
                            // Don't remove duplicates entirely. The import conditions may
                            // still introduce layers to the layer order. Represent this as a
                            // file with an empty layer list.
                            order.at_mut(i as usize).kind =
                                CssImportKind::Layers(CssImportLayers::owned(BabyList::default()));
                            continue 'next_backward;
                        }
                    }
                    gop.value_ptr.append(temp_allocator, i);
                }
                CssImportKind::Layers(_) => {}
            }
        }
    }
    debug_css_order(this, &order, CssOrderDebugStep::AfterRemovingDuplicates);

    // Then optimize "@layer" rules by removing redundant ones. This loop goes
    // forward instead of backward because "@layer" takes effect at the first
    // copy instead of the last copy like other things in CSS.
    {
        struct DuplicateEntry<'b> {
            layers: &'b [LayerName],
            indices: BabyList<u32>,
        }
        let mut layer_duplicates: BabyList<DuplicateEntry> = BabyList::default();

        'next_forward: for entry in order.slice_mut() {
            debug_css_order(
                this,
                &wip_order,
                CssOrderDebugStep::WhileOptimizingRedundantLayerRules,
            );
            match &mut entry.kind {
                // Simplify the conditions since we know they only wrap "@layer"
                CssImportKind::Layers(layers) => {
                    // Truncate the conditions at the first anonymous layer
                    for (i, condition_) in entry.conditions.slice().iter().enumerate() {
                        let conditions: &ImportConditions = condition_;
                        // The layer is anonymous if it's a "layer" token without any
                        // children instead of a "layer(...)" token with children:
                        //
                        //   /* entry.css */
                        //   @import "foo.css" layer;
                        //
                        //   /* foo.css */
                        //   @layer foo;
                        //
                        // We don't need to generate this (as far as I can tell):
                        //
                        //   @layer {
                        //     @layer foo;
                        //   }
                        //
                        if conditions.has_anonymous_layer() {
                            entry.conditions.len = u32::try_from(i).unwrap();
                            layers.replace(temp_allocator, BabyList::default());
                            break;
                        }
                    }

                    // If there are no layer names for this file, trim all conditions
                    // without layers because we know they have no effect.
                    //
                    // (They have no effect because this is a `.layer` import with no rules
                    //  and only layer declarations.)
                    //
                    //   /* entry.css */
                    //   @import "foo.css" layer(foo) supports(display: flex);
                    //
                    //   /* foo.css */
                    //   @import "empty.css" supports(display: grid);
                    //
                    // That would result in this:
                    //
                    //   @supports (display: flex) {
                    //     @layer foo {
                    //       @supports (display: grid) {}
                    //     }
                    //   }
                    //
                    // Here we can trim "supports(display: grid)" to generate this:
                    //
                    //   @supports (display: flex) {
                    //     @layer foo;
                    //   }
                    //
                    if layers.inner().len == 0 {
                        let mut i: u32 = entry.conditions.len;
                        while i != 0 {
                            i -= 1;
                            let condition = entry.conditions.at(i as usize);
                            if condition.layer.is_some() {
                                break;
                            }
                            entry.conditions.len = i;
                        }
                    }

                    // Remove unnecessary entries entirely
                    if entry.conditions.len == 0 && layers.inner().len == 0 {
                        continue;
                    }
                }
                _ => {}
            }

            // Omit redundant "@layer" rules with the same set of layer names. Note
            // that this tests all import order entries (not just layer ones) because
            // sometimes non-layer ones can make following layer ones redundant.
            // layers_post_import
            let layers_key: &[LayerName] = match &entry.kind {
                CssImportKind::SourceIndex(idx) => {
                    css_asts[idx.get() as usize].unwrap().layer_names.slice_const()
                }
                CssImportKind::Layers(layers) => layers.inner().slice_const(),
                CssImportKind::ExternalPath(_) => &[],
            };
            let mut index: usize = 0;
            while index < layer_duplicates.len as usize {
                let both_equal = 'both_equal: {
                    if layers_key.len() != layer_duplicates.at(index).layers.len() {
                        break 'both_equal false;
                    }

                    debug_assert_eq!(layers_key.len(), layer_duplicates.at(index).layers.len());
                    for (a, b) in layers_key.iter().zip(layer_duplicates.at(index).layers) {
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
            if index == layer_duplicates.len as usize {
                // This is the first time we've seen this combination of layer names.
                // Allocate a new set of duplicate indices to track this combination.
                layer_duplicates.append(
                    temp_allocator,
                    DuplicateEntry {
                        layers: layers_key,
                        indices: BabyList::default(),
                    },
                );
            }
            let mut duplicates = layer_duplicates.at(index).indices.slice();
            let mut j = duplicates.len();
            while j != 0 {
                j -= 1;
                let duplicate_index = duplicates[j];
                if is_conditional_import_redundant(
                    &entry.conditions,
                    &wip_order.at(duplicate_index as usize).conditions,
                ) {
                    if !matches!(entry.kind, CssImportKind::Layers(_)) {
                        // If an empty layer is followed immediately by a full layer and
                        // everything else is identical, then we don't need to emit the
                        // empty layer. For example:
                        //
                        //   @media screen {
                        //     @supports (display: grid) {
                        //       @layer foo;
                        //     }
                        //   }
                        //   @media screen {
                        //     @supports (display: grid) {
                        //       @layer foo {
                        //         div {
                        //           color: red;
                        //         }
                        //       }
                        //     }
                        //   }
                        //
                        // This can be improved by dropping the empty layer. But we can
                        // only do this if there's nothing in between these two rules.
                        if j == duplicates.len() - 1 && duplicate_index == wip_order.len - 1 {
                            let other = wip_order.at(duplicate_index as usize);
                            if matches!(other.kind, CssImportKind::Layers(_))
                                && import_conditions_are_equal(
                                    entry.conditions.slice_const(),
                                    other.conditions.slice_const(),
                                )
                            {
                                // Remove the previous entry and then overwrite it below
                                duplicates = &duplicates[0..j];
                                wip_order.len = duplicate_index;
                                break;
                            }
                        }

                        // Non-layer entries still need to be present because they have
                        // other side effects beside inserting things in the layer order
                        wip_order.append(temp_allocator, *entry);
                    }

                    // Don't add this to the duplicate list below because it's redundant
                    continue 'next_forward;
                }
            }

            layer_duplicates
                .at_mut(index)
                .indices
                .append(temp_allocator, wip_order.len);
            wip_order.append(temp_allocator, *entry);
        }

        debug_css_order(
            this,
            &wip_order,
            CssOrderDebugStep::WhileOptimizingRedundantLayerRules,
        );

        order.len = wip_order.len;
        order.slice_mut().copy_from_slice(wip_order.slice());
        wip_order.clear();
    }
    debug_css_order(this, &order, CssOrderDebugStep::AfterOptimizingRedundantLayerRules);

    // Finally, merge adjacent "@layer" rules with identical conditions together.
    {
        let mut did_clone: i32 = -1;
        for entry in order.slice() {
            if matches!(entry.kind, CssImportKind::Layers(_)) && wip_order.len > 0 {
                let prev_index = wip_order.len - 1;
                let prev = wip_order.at(prev_index as usize);
                if matches!(prev.kind, CssImportKind::Layers(_))
                    && import_conditions_are_equal(
                        prev.conditions.slice_const(),
                        entry.conditions.slice_const(),
                    )
                {
                    let prev_index_i32 = i32::try_from(prev_index).unwrap();
                    if did_clone != prev_index_i32 {
                        did_clone = prev_index_i32;
                    }
                    // need to clone the layers here as they could be references to css ast
                    // TODO(port): direct payload access on enum — depends on Kind layout in Phase B.
                    if let CssImportKind::Layers(prev_layers) =
                        &mut wip_order.at_mut(prev_index as usize).kind
                    {
                        if let CssImportKind::Layers(entry_layers) = &entry.kind {
                            prev_layers
                                .to_owned(temp_allocator)
                                .append_slice(temp_allocator, entry_layers.inner().slice_const());
                        }
                    }
                }
            }
        }
    }
    debug_css_order(this, &order, CssOrderDebugStep::AfterMergingAdjacentLayerRules);

    order
}

fn import_conditions_are_equal(a: &[ImportConditions], b: &[ImportConditions]) -> bool {
    if a.len() != b.len() {
        return false;
    }

    debug_assert_eq!(a.len(), b.len());
    for (ai, bi) in a.iter().zip(b) {
        if !ai.layers_eql(bi) || !ai.supports_eql(bi) || !ai.media.eql(&bi.media) {
            return false;
        }
    }

    true
}

/// Given two "@import" rules for the same source index (an earlier one and a
/// later one), the earlier one is masked by the later one if the later one's
/// condition list is a prefix of the earlier one's condition list.
///
/// For example:
///
///    // entry.css
///    @import "foo.css" supports(display: flex);
///    @import "bar.css" supports(display: flex);
///
///    // foo.css
///    @import "lib.css" screen;
///
///    // bar.css
///    @import "lib.css";
///
/// When we bundle this code we'll get an import order as follows:
///
///  1. lib.css [supports(display: flex), screen]
///  2. foo.css [supports(display: flex)]
///  3. lib.css [supports(display: flex)]
///  4. bar.css [supports(display: flex)]
///  5. entry.css []
///
/// For "lib.css", the entry with the conditions [supports(display: flex)] should
/// make the entry with the conditions [supports(display: flex), screen] redundant.
///
/// Note that all of this deliberately ignores the existence of "@layer" because
/// that is handled separately. All of this is only for handling unlayered styles.
pub fn is_conditional_import_redundant(
    earlier: &BabyList<ImportConditions>,
    later: &BabyList<ImportConditions>,
) -> bool {
    if later.len > earlier.len {
        return false;
    }

    for i in 0..later.len as usize {
        let a = earlier.at(i);
        let b = later.at(i);

        // Only compare "@supports" and "@media" if "@layers" is equal
        if a.layers_eql(b) {
            let same_supports = a.supports_eql(b);
            let same_media = a.media.eql(&b.media);

            // If the import conditions are exactly equal, then only keep
            // the later one. The earlier one is redundant. Example:
            //
            //   @import "foo.css" layer(abc) supports(display: flex) screen;
            //   @import "foo.css" layer(abc) supports(display: flex) screen;
            //
            // The later one makes the earlier one redundant.
            if same_supports && same_media {
                continue;
            }

            // If the media conditions are exactly equal and the later one
            // doesn't have any supports conditions, then the later one will
            // apply in all cases where the earlier one applies. Example:
            //
            //   @import "foo.css" layer(abc) supports(display: flex) screen;
            //   @import "foo.css" layer(abc) screen;
            //
            // The later one makes the earlier one redundant.
            if same_media && b.supports.is_none() {
                continue;
            }

            // If the supports conditions are exactly equal and the later one
            // doesn't have any media conditions, then the later one will
            // apply in all cases where the earlier one applies. Example:
            //
            //   @import "foo.css" layer(abc) supports(display: flex) screen;
            //   @import "foo.css" layer(abc) supports(display: flex);
            //
            // The later one makes the earlier one redundant.
            if same_supports && b.media.media_queries.is_empty() {
                continue;
            }
        }

        return false;
    }

    true
}

#[derive(Clone, Copy, strum::IntoStaticStr)]
#[strum(serialize_all = "SCREAMING_SNAKE_CASE")]
enum CssOrderDebugStep {
    BeforeHoisting,
    AfterHoisting,
    AfterRemovingDuplicates,
    WhileOptimizingRedundantLayerRules,
    AfterOptimizingRedundantLayerRules,
    AfterMergingAdjacentLayerRules,
}

fn debug_css_order(
    this: &LinkerContext,
    order: &BabyList<CssImportOrder>,
    step: CssOrderDebugStep,
) {
    // PERF(port): `step` was a comptime enum param; debug-only so demoted to runtime.
    #[cfg(debug_assertions)]
    {
        // TODO(port): comptime string concat "BUN_DEBUG_CSS_ORDER_" ++ @tagName(step) — runtime concat is fine here (debug-only).
        let tag: &'static str = step.into();
        let env_var = format!("BUN_DEBUG_CSS_ORDER_{}", tag);
        let enable_all = bun_core::env_var::BUN_DEBUG_CSS_ORDER.get();
        if enable_all || bun_core::getenv_truthy(env_var.as_bytes()) {
            debug_css_order_impl(this, order, step);
        }
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = (this, order, step);
    }
}

fn debug_css_order_impl(
    this: &LinkerContext,
    order: &BabyList<CssImportOrder>,
    step: CssOrderDebugStep,
) {
    #[cfg(debug_assertions)]
    {
        let tag: &'static str = step.into();
        debug!("CSS order {}:\n", tag);
        // PERF(port): was arena bulk-free — debug-only, using Vec<u8> directly.
        for (i, entry) in order.slice().iter().enumerate() {
            let conditions_str: Vec<u8> = if entry.conditions.len > 0 {
                'conditions_str: {
                    use std::io::Write as _;
                    let mut arrlist: Vec<u8> = Vec::new();
                    let writer = &mut arrlist;
                    writer.write_all(b"[").expect("unreachable");
                    let mut symbols = Symbol::Map::default();
                    for (j, condition_) in entry.conditions.slice_const().iter().enumerate() {
                        let condition: &ImportConditions = condition_;
                        let scratchbuf: Vec<u8> = Vec::new();
                        // TODO(port): bun_css::Printer::new signature & ImportRecordResolver struct shape.
                        let mut printer = bun_css::Printer::new(
                            scratchbuf,
                            writer,
                            bun_css::PrinterOptions::default(),
                            bun_css::ImportRecordResolver {
                                import_records: &entry.condition_import_records,
                                ast_urls_for_css: this.parse_graph.ast.items().url_for_css,
                                ast_unique_key_for_additional_file: this
                                    .parse_graph
                                    .input_files
                                    .items()
                                    .unique_key_for_additional_file,
                            },
                            &this.mangled_props,
                            &mut symbols,
                        );

                        condition.to_css(&mut printer).expect("unreachable");
                        if j != entry.conditions.len as usize - 1 {
                            writer.write_all(b", ").expect("unreachable");
                        }
                    }
                    writer.write_all(b" ]").expect("unreachable");
                    break 'conditions_str arrlist;
                }
            } else {
                b"[]".to_vec()
            };

            debug!("  {}: {} {}\n", i, entry.fmt(this), BStr::new(&conditions_str));
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/linker_context/findImportedFilesInCSSOrder.zig (679 lines)
//   confidence: medium
//   todos:      8
//   notes:      Heavy borrowck reshaping needed in Phase B (overlapping &mut on order/visitor); CssImportOrder.Kind enum payload access patterns guessed; BabyList Copy semantics (`*entry`) and arena allocator threading need verification.
// ──────────────────────────────────────────────────────────────────────────
