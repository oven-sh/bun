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

// `CssImportOrder` values are arena-backed (the inner `Vec`s point into bump
// arenas and are never individually freed). Rust's `Vec` has `Drop`, so a
// literal `*entry` is not `Copy`; we duplicate the values bitwise instead.
// `conditions` slabs come from `deep_clone_conditions`, which allocates them
// from the `LinkerGraph` arena (`graph.heap`). The `Vec` headers aliasing a
// slab are `mem::forget`'d everywhere (`CssImportOrder::drop` + the
// post-`visit()` forget below); the slab itself is bulk-freed with the arena.
// `wip_order`/`order` shuffles use `len`-truncation rather than
// `clear_retaining_capacity` so moved-from slots are never dropped.
#[inline(always)]
unsafe fn bitwise_copy<T>(src: &T) -> T {
    // SAFETY: `src` is a valid aligned `&T`; the `unsafe fn` contract requires
    // the caller to ensure the duplicated value's `Drop` is suppressed (arena
    // ownership, see the bitwise-copy note above) so the aliased buffer is never freed twice.
    unsafe { core::ptr::read(src) }
}

/// Bitwise move of arena-backed entries from `wip` back into `order`'s
/// buffer (which always has `cap >= wip.len`).
#[inline]
fn memcpy_and_reset(order: &mut Vec<CssImportOrder>, wip: &mut Vec<CssImportOrder>) {
    debug_assert!(order.capacity() >= wip.len());
    // Do not Drop `order`'s prior entries — they were already
    // bitwise-copied into `wip` (see `bitwise_copy` callers above), so dropping
    // here would double-free their `conditions` buffers.
    // SAFETY: `set_len(0)` is unconditionally sound (0 ≤ capacity; shrinking
    // exposes no uninitialized range).
    unsafe { order.set_len(0) };
    // `Vec::append` = reserve (no-op given the debug_assert) +
    // `copy_nonoverlapping` into `order[0..]` + `wip.set_len(0)` — exactly the
    // bitwise move described above.
    order.append(wip);
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
    temp_arena: &'a Arena,
    entry_points: &[Index],
) -> Vec<CssImportOrder> {
    let _ = temp_arena;

    struct Visitor<'a> {
        arena: &'a Arena,
        // `BundledAst.css` SoA column.
        css_asts: &'a [crate::bundled_ast::CssCol],
        all_import_records: &'a [bun_ast::import_record::List<'a>],

        // No `graph` field — `visit()` never reads it, and holding one would
        // create an aliasing `&mut this.graph` borrow against
        // `arena`/`css_asts` (which already borrow `this.graph`).
        // `BackRef` (not `&'a Graph`) so the visitor's `'a` borrow stays
        // disjoint from `LinkerContext` (constructed from the raw `parse_graph`
        // backref, valid for the link step).
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

        fn visit(
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
            // The CSS specification strangely does not describe what to do when there
            // is a cycle. So we are left with reverse-engineering the behavior from a
            // real browser. Here's what the WebKit code base has to say about this:
            //
            //   "Check for a cycle in our import chain. If we encounter a stylesheet
            //   in our parent chain with the same URL, then just bail."
            //
            // So that's what we do here. See "StyleRuleImport::requestStyleSheet()" in
            // WebKit for more information.
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

            // `visited.pop()` happens at the end of this function; the early
            // return above intentionally skips it.

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
                            // Fork our state. `visit` stores a bitwise copy of
                            // `nested_conditions` into `self.order`; the slab is
                            // arena-owned, so wrap the local header in
                            // `ManuallyDrop` to avoid a double-free.
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
                        // If this import has conditions, append it to the list of overall
                        // conditions for this external import. Note that an external import
                        // may actually have multiple sets of conditions that can't be
                        // merged. When this happens we need to generate a nested imported
                        // CSS file using a data URL.
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
                                // SAFETY: arena-backed `Vec` header; the pushed
                                // `CssImportOrder` never drops it (see the note at
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
                // `crate::Index` (= `bun_ast::Index`) and the
                // `bun_ast::Index` carried by `CssImportOrderKind::SourceIndex`
                // are the same underlying index type;
                // both are `#[repr(transparent)]` over `u32`.
                kind: CssImportOrderKind::SourceIndex(AstIndex(source_index.get())),
                // SAFETY: arena-backed `Vec` header; `CssImportOrder` suppresses
                // `Drop` on it (see the note at `bitwise_copy`), so the aliased
                // buffer is freed once with the arena.
                conditions: unsafe { bitwise_copy(wrapping_conditions) },
                condition_import_records: Vec::new(),
            });

            let _ = self.visited.pop();
        }
    }

    // Read MultiArrayList columns before constructing the visitor (borrowck).
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

    // CSS syntax unfortunately only allows "@import" rules at the top of the
    // file. This means we must hoist all external "@import" rules to the top of
    // the file when bundling, even though doing so will change the order of CSS
    // evaluation.
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

    // Next, optimize import order. If there are duplicate copies of an imported
    // file, replace all but the last copy with just the layers that are in that
    // file. This works because in CSS, the last instance of a declaration
    // overrides all previous instances of that declaration.
    {
        let mut source_index_duplicates: ArrayHashMap<u32, Vec<u32>> = ArrayHashMap::new();
        let mut external_path_duplicates: StringArrayHashMap<Vec<u32>> = StringArrayHashMap::new();

        let mut i: u32 = order.len() as u32;
        // Borrowck: `order.at(i)` and `order.mut_(i)`
        // cannot overlap, and `is_conditional_import_redundant` needs to read
        // both `entry.conditions` and `order.at(j).conditions`. Hold raw
        // pointers into the Vec buffer; `order.mut_(i)` only writes `.kind` and
        // never reallocates, so the conditions pointer stays valid.
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
                            // This import is redundant, but it might have @layer rules.
                            // So we should keep the @layer rules so that the cascade ordering of layers
                            // is preserved
                            //
                            // `crate::bun_css::LayerName` (lifetime-erased
                            // shadow) and `::bun_css::LayerName` are distinct nominal
                            // types; cast through `NonNull` to satisfy
                            // `Layers::borrow`.
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
            // Lifetime-erased slice header — borrows either
            // `css_asts[..].layer_names` (real `::bun_css::LayerName`) or
            // `Layers::inner()` (shadow `LayerName`). Both nominal types should
            // be reconciled; until then we compare via
            // `LayerName::eql` on the shadow type and cast at the boundary.
            // `RawSlice` (vs raw `*const [_]`) so reads go through safe
            // `.slice()` under the back-reference invariant: the borrowed
            // storage (`css_asts` arena / `Layers` Vec) outlives this loop.
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
                            // SAFETY: `i < entry.conditions.len() <= capacity`;
                            // shrinking exposes no uninitialized range. The
                            // truncated tail is arena-owned (`deep_clone_conditions`)
                            // and bulk-freed with the arena, so skipping `Drop` is sound.
                            unsafe { entry.conditions.set_len((i as u32) as usize) };
                            layers.replace(Vec::new());
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

            // Omit redundant "@layer" rules with the same set of layer names. Note
            // that this tests all import order entries (not just layer ones) because
            // sometimes non-layer ones can make following layer ones redundant.
            // layers_post_import
            let layers_key: *const [LayerName] = match &entry.kind {
                CssImportOrderKind::SourceIndex(idx) => {
                    // See the LayerName nominal-type note above.
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
            // shadows (see the note above). Valid for this loop iteration.
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

/// The returned list is later bitwise-copied into `CssImportOrder` entries via
/// `bitwise_copy(wrapping_conditions)`, so callers `mem::forget` the local after
/// the recursive `visit()` to keep the aliased buffer alive. The slab is
/// allocated from `arena` (`LinkerGraph::arena()` = `graph.heap`, which
/// outlives every chunk) and is bulk-freed with the arena — every `Vec` header
/// aliasing it must be `mem::forget`'d (see `CssImportOrder::drop`). Reserves
/// one extra slot for the single `append_assume_capacity` each call site
/// performs, so the header never reallocates.
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

/// Shallow copy of `ImportRecord` values into a fresh allocation.
#[inline]
fn shallow_clone_records(list: &Vec<ImportRecord>) -> Vec<ImportRecord> {
    let mut out = Vec::<ImportRecord>::init_capacity(list.len() as usize);
    for r in list.slice_const() {
        // `ImportRecord` is plain-old-data; its `Path<'static>` slices borrow
        // resolver storage.
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
fn is_conditional_import_redundant(
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
    // `step` is a runtime param; this path is debug-only.
    #[cfg(debug_assertions)]
    {
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
                bstr::BStr::new(&writer).to_string().into()
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
