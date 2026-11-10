use crate::mal_prelude::*;
use bstr::BStr;

use bun_alloc::Arena;
use bun_ast::{ImportKind, ImportRecord, ImportRecordFlags, Range};
use bun_collections::{ArrayHashMap, StringArrayHashMap, VecExt};
use bun_core::{StackCheck, handle_oom};

use crate::Graph::Graph;
use crate::bun_css::css_parser::{BundlerCssRule, ImportRule};
use crate::bun_css::css_rules::import::Layer;
use crate::bun_css::{BundlerStyleSheet, ImportConditions, LayerName, SmallList};
use crate::chunk::{CssImportOrder, CssImportOrderKind, Layers};
use crate::linker_context_mod::debug;
use crate::{Index, LinkerContext};
use bun_ast::Index as AstIndex;

// `CssImportOrder` values are arena-backed (the inner `Vec`s point into bump
// arenas and are never individually freed). Rust's `Vec` has `Drop`, so a
// literal `*entry` is not `Copy`; we duplicate the values bitwise instead.
// `conditions` slabs come from `fork_conditions`, which allocates them
// from the `LinkerGraph` arena (`graph.heap`). Each `ImportConditions` in a slab
// is a bitwise copy of the conditions of an `ImportRule`. The rule's stylesheet
// owns their heap and outlives the link. The `Vec` headers aliasing a
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
fn memcpy_and_reset<'a>(order: &mut Vec<CssImportOrder<'a>>, wip: &mut Vec<CssImportOrder<'a>>) {
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
/// ```text
///   A
///  / \
/// B   C
///  \ /
///   D
/// ```
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
///
/// For that, a list of the layer names of the file stands for the earlier copy.
/// esbuild prints such a list for every file. A file that declares a layer under
/// "@media" or "@supports" gets `CssImportOrderKind::LayersOf` here, which keeps
/// the condition.
///
/// The traversal recurses once per `@import`. Returns `Err` if the import chain
/// is too deep for the thread's stack, and the caller reports it.
pub(crate) fn find_imported_files_in_css_order<'a>(
    this: &LinkerContext<'a>,
    temp_arena: &Arena,
    entry_points: &[Index],
    layer_lists: &mut LayerLists,
) -> Result<Vec<CssImportOrder<'a>>, CssImportChainTooDeep> {
    let _ = temp_arena;

    struct Visitor<'v, 'a> {
        arena: &'v Arena,
        // `BundledAst.css` SoA column.
        css_asts: &'v [crate::bundled_ast::CssCol],
        all_import_records: &'v [bun_ast::import_record::List<'a>],
        parse_graph: &'v Graph<'a>,

        has_external_import: bool,
        /// Whether an external import has a layer. Then it matters which layers it moves ahead of.
        has_layered_external_import: bool,
        visited: Vec<Index>,
        order: Vec<CssImportOrder<'a>>,
        anonymous_layers: u32,

        stack_check: StackCheck,
        /// Set when the stack is nearly exhausted. The traversal then unwinds
        /// without visiting anything else.
        too_deep: Option<CssImportChainTooDeep>,
    }

    impl<'v, 'a> Visitor<'v, 'a> {
        #[inline]
        fn input_file_pretty(&self, source_index: Index) -> &BStr {
            let sources = self.parse_graph.input_files.items_source();
            BStr::new(&sources[source_index.get() as usize].path.pretty)
        }

        fn push_entry(
            &mut self,
            kind: CssImportOrderKind<'a>,
            wrapping_conditions: &Vec<ImportConditions>,
        ) {
            self.order.push(CssImportOrder {
                kind,
                // SAFETY: arena-backed `Vec` header; `CssImportOrder` suppresses
                // `Drop` on it (see the note at `bitwise_copy`), so the aliased
                // buffer is freed once with the arena.
                conditions: unsafe { bitwise_copy(wrapping_conditions) },
                condition_import_records: Vec::new(),
            });
        }

        /// An import that loads no style sheet still adds its layer to the layer order.
        fn push_layers_of_unloaded_import(&mut self, wrapping_conditions: &Vec<ImportConditions>) {
            if wrapping_conditions.iter().any(|c| c.layer.is_some()) {
                self.push_entry(
                    CssImportOrderKind::Layers(Layers::Owned(Vec::new())),
                    wrapping_conditions,
                );
            }
        }

        /// The external import is hoisted out of the anonymous layer that its
        /// neighbours share, so something else must hold the place of its sublayer.
        fn push_sublayer_of_external_import(&mut self, conditions: &Vec<ImportConditions>) {
            let names_a_sublayer = conditions
                .iter()
                .skip_while(|c| !c.has_anonymous_layer())
                .any(|c| c.layer.as_ref().is_some_and(|layer| layer.v.is_some()));
            if names_a_sublayer {
                self.push_entry(
                    CssImportOrderKind::Layers(Layers::Owned(Vec::new())),
                    conditions,
                );
            }
        }

        /// Every visit of a bare "layer" makes a new anonymous layer, also when it
        /// is the same rule or its conditions look the same.
        fn append_conditions(
            &mut self,
            conditions: &mut Vec<ImportConditions>,
            import_rule: &ImportRule,
        ) {
            // SAFETY: never dropped (see the note at `bitwise_copy`).
            let mut appended = unsafe { bitwise_copy(&import_rule.conditions) };
            if appended.has_anonymous_layer()
                && let Some(layer) = &mut appended.layer
            {
                self.anonymous_layers += 1;
                layer.anonymous_id = self.anonymous_layers;
            }
            conditions.append_assume_capacity(appended);
        }

        /// Returns false if the traversal stopped because the chain is too deep.
        fn visit_import(
            &mut self,
            importer: Index,
            record: &ImportRecord<'a>,
            wrapping_conditions: &mut Vec<ImportConditions>,
            wrapping_import_records: &mut Vec<ImportRecord<'a>>,
        ) -> bool {
            if !self.stack_check.is_safe_to_recurse() {
                self.too_deep = Some(CssImportChainTooDeep {
                    importer,
                    range: record.range,
                    kind: record.kind,
                });
                return false;
            }
            self.visit(
                record.source_index,
                wrapping_conditions,
                wrapping_import_records,
            );
            self.too_deep.is_none()
        }

        fn visit(
            &mut self,
            source_index: Index,
            wrapping_conditions: &mut Vec<ImportConditions>,
            wrapping_import_records: &mut Vec<ImportRecord<'a>>,
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
                    self.push_layers_of_unloaded_import(wrapping_conditions);
                    return;
                }
            }

            // A file that did not load as a style sheet. `scan_css_imports` has the error for
            // it, and only the dev server goes on.
            let Some(repr): Option<&BundlerStyleSheet> =
                self.css_asts[source_index.get() as usize].as_deref()
            else {
                self.push_layers_of_unloaded_import(wrapping_conditions);
                return;
            };
            self.visited.push(source_index);
            let top_level_rules = &repr.rules;

            // Any pre-import layers come first.
            if !repr.layers_pre_import.is_empty() {
                self.push_entry(
                    CssImportOrderKind::Layers(Layers::borrow(&repr.layers_pre_import)),
                    wrapping_conditions,
                );
            }

            // Iterate over the top-level "@import" rules
            for rule in top_level_rules.v.iter() {
                if let BundlerCssRule::Import(import_rule) = rule {
                    let record = &self.all_import_records[source_index.get() as usize]
                        [import_rule.import_record_idx as usize];

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
                                fork_conditions(wrapping_conditions, self.arena),
                            );

                            // Append these import conditions to the state
                            self.append_conditions(&mut nested_conditions, import_rule);
                            let followed = self.visit_import(
                                source_index,
                                record,
                                &mut nested_conditions,
                                wrapping_import_records,
                            );
                            if !followed {
                                return;
                            }
                            continue;
                        }
                        if !self.visit_import(
                            source_index,
                            record,
                            wrapping_conditions,
                            wrapping_import_records,
                        ) {
                            return;
                        }
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
                                fork_conditions(wrapping_conditions, self.arena);
                            let all_import_records = shallow_clone_records(wrapping_import_records);
                            self.append_conditions(&mut all_conditions, import_rule);
                            self.has_layered_external_import |=
                                all_conditions.iter().any(|c| c.layer.is_some());
                            self.push_sublayer_of_external_import(&all_conditions);
                            self.order.push(CssImportOrder {
                                kind: CssImportOrderKind::ExternalPath(record.path),
                                conditions: all_conditions,
                                condition_import_records: all_import_records,
                            });
                        } else {
                            self.has_layered_external_import |=
                                wrapping_conditions.iter().any(|c| c.layer.is_some());
                            self.push_sublayer_of_external_import(wrapping_conditions);
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
                }
            }

            // Iterate over the "composes" directives. Note that the order doesn't
            // matter for these because the output order is explicitly undfened
            // in the specification.
            for record in self.all_import_records[source_index.get() as usize].as_slice() {
                if record.kind == ImportKind::Composes
                    && record.source_index.is_valid()
                    && !self.visit_import(
                        source_index,
                        record,
                        wrapping_conditions,
                        wrapping_import_records,
                    )
                {
                    return;
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
            // `crate::Index` (= `bun_ast::Index`) and the
            // `bun_ast::Index` carried by `CssImportOrderKind::SourceIndex`
            // are the same underlying index type;
            // both are `#[repr(transparent)]` over `u32`.
            self.push_entry(
                CssImportOrderKind::SourceIndex(AstIndex(source_index.get())),
                wrapping_conditions,
            );

            let _ = self.visited.pop();
        }
    }

    let css_asts_slice: &[crate::bundled_ast::CssCol] = this.graph.ast.items_css();
    let all_import_records_slice = this.graph.ast.items_import_records();
    let arena = this.graph.arena();

    let mut visitor = Visitor {
        arena,
        parse_graph: this.parse_graph(),
        visited: Vec::<Index>::init_capacity(16),
        css_asts: css_asts_slice,
        all_import_records: all_import_records_slice,
        has_external_import: false,
        has_layered_external_import: false,
        order: Vec::new(),
        anonymous_layers: 0,
        stack_check: StackCheck::init(),
        too_deep: None,
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
        if visitor.too_deep.is_some() {
            break;
        }
    }

    if let Some(too_deep) = visitor.too_deep {
        return Err(too_deep);
    }

    let has_external_import = visitor.has_external_import;
    let has_layered_external_import = visitor.has_layered_external_import;
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
        let is_statement = |entry: &CssImportOrder| match &entry.kind {
            CssImportOrderKind::Layers(layers) => {
                prints_as_layer_statement(layers.inner().is_empty(), entry.conditions.slice())
            }
            _ => false,
        };
        // An import with a layer must not declare that layer ahead of a layer that an entry
        // behind the imports declares first. So that layer gets a declaration ahead of it.
        let mut stand_ins = has_layered_external_import.then(LayerStandIns::default);
        let mut is_at_layer_prefix = true;
        for (i, entry) in order.slice().iter().enumerate() {
            let is_external = matches!(entry.kind, CssImportOrderKind::ExternalPath(_));
            let is_hoisted = is_external || (is_statement(entry) && is_at_layer_prefix);
            if let Some(stand_ins) = &mut stand_ins {
                if is_external {
                    stand_ins.declare_ahead_of(
                        entry,
                        order.slice(),
                        css_asts,
                        arena,
                        &mut wip_order,
                    );
                } else if is_hoisted {
                    stand_ins.add_statement(entry);
                } else {
                    stand_ins.add(i);
                }
            }
            if is_hoisted {
                // SAFETY: `entry` is moved back into `order` via
                // `memcpy_and_reset` (which `set_len(0)`s without dropping), so
                // each `CssImportOrder` value is dropped at most once.
                wip_order.push(unsafe { bitwise_copy(entry) });
            }
            is_at_layer_prefix &= is_statement(entry);
        }
        drop(stand_ins);

        // Pass 2: Append everything that we didn't pull out in pass 1
        is_at_layer_prefix = true;
        for entry in order.slice() {
            if (!is_statement(entry) || !is_at_layer_prefix)
                && !matches!(entry.kind, CssImportOrderKind::ExternalPath(_))
            {
                // SAFETY: `entry` is moved back into `order` via
                // `memcpy_and_reset` (which `set_len(0)`s without dropping), so
                // each `CssImportOrder` value is dropped at most once.
                wip_order.push(unsafe { bitwise_copy(entry) });
            }
            is_at_layer_prefix &= is_statement(entry);
        }

        // The stand-ins are more entries than `order` had.
        order.reserve(wip_order.len().saturating_sub(order.len()));
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
        // pointers into the Vec buffer; `order.mut_(i)` never reallocates, and
        // `entry` is not read after it.
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
                            let later = &order.slice()[i as usize + 1..];
                            let layers =
                                layers_of_redundant_copy(idx, css_asts, later, layer_lists);
                            order.mut_(i as usize).kind = layers;
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
                            // file with an empty layer list, or keep the "@import" where
                            // nothing else can do that among the hoisted imports.
                            let earlier = &order.slice()[..i as usize];
                            let has_earlier_copy = has_earlier_copy(earlier, entry);
                            if !has_earlier_copy && !can_mask_external_import(earlier, entry) {
                                break;
                            }
                            let masked = order.mut_(i as usize);
                            masked.kind = CssImportOrderKind::Layers(Layers::Owned(Vec::new()));
                            if has_earlier_copy {
                                // The earlier copy declares the layers. Declaring them here
                                // too could print a block ahead of a hoisted "@import".
                                // SAFETY: 0 <= capacity. The truncated tail is arena-owned
                                // (`fork_conditions`) and bulk-freed with the arena.
                                unsafe { masked.conditions.set_len(0) };
                            }
                            continue 'next_backward;
                        }
                    }
                    gop.value_ptr.push(i);
                }
                CssImportOrderKind::Layers(_) | CssImportOrderKind::LayersOf(_) => {}
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
            // `css_asts[..].layer_names` or `Layers::inner()`.
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
            // An external import prints an anonymous layer of its own, apart
            // from the one that its neighbours share.
            let in_anonymous_layer = entry
                .conditions
                .slice_const()
                .iter()
                .any(ImportConditions::has_anonymous_layer);
            match &mut entry.kind {
                // Simplify the conditions since we know they only wrap "@layer"
                CssImportOrderKind::Layers(layers) => {
                    // An external import with these exact conditions already
                    // declares what this entry would.
                    if layers.inner().is_empty()
                        && !in_anonymous_layer
                        && wip_order.slice().iter().any(|kept| {
                            matches!(kept.kind, CssImportOrderKind::ExternalPath(_))
                                && !is_layer_stand_in(kept)
                                && import_conditions_are_equal(
                                    kept.conditions.slice_const(),
                                    entry.conditions.slice_const(),
                                )
                        })
                    {
                        continue 'next_forward;
                    }

                    // If there are no layer names for this file, trim all conditions
                    // after the last named layer because we know they have no effect.
                    // An anonymous layer ahead of a named one stays, as it holds the
                    // place of that name among the sublayers of the anonymous layer.
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
                            // is arena-owned (`fork_conditions`) and
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
            let layers_key: &[LayerName] = match &entry.kind {
                CssImportOrderKind::SourceIndex(idx) | CssImportOrderKind::LayersOf(idx) => {
                    css_asts[idx.get() as usize]
                        .as_deref()
                        .unwrap()
                        .layer_names
                        .slice_const()
                }
                CssImportOrderKind::Layers(layers) => layers.inner().slice_const(),
                CssImportOrderKind::ExternalPath(_) => &[][..],
            };
            let mut index: usize = 0;
            while index < layer_duplicates.len() as usize {
                let dup_layers: &[LayerName] = layer_duplicates.at(index).layers.slice();
                if layer_lists_are_equal(layers_key, dup_layers) {
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
                // A file may have these names under "@media", which is no proof
                // that it declares them for this list.
                let declares_no_more =
                    match (&entry.kind, &wip_order.at(duplicate_index as usize).kind) {
                        (CssImportOrderKind::Layers(_), CssImportOrderKind::Layers(_)) => true,
                        (CssImportOrderKind::Layers(_), CssImportOrderKind::SourceIndex(_)) => {
                            layers_key.is_empty()
                        }
                        (CssImportOrderKind::Layers(_), CssImportOrderKind::ExternalPath(_)) => {
                            !in_anonymous_layer
                        }
                        (CssImportOrderKind::Layers(_), CssImportOrderKind::LayersOf(_)) => false,
                        // A list has each name of the file with no condition of its own.
                        (CssImportOrderKind::LayersOf(_), CssImportOrderKind::Layers(_)) => true,
                        (
                            CssImportOrderKind::LayersOf(file),
                            CssImportOrderKind::LayersOf(earlier),
                        ) => file.get() == earlier.get(),
                        (
                            CssImportOrderKind::LayersOf(_),
                            CssImportOrderKind::SourceIndex(_)
                            | CssImportOrderKind::ExternalPath(_),
                        ) => false,
                        (
                            CssImportOrderKind::SourceIndex(_)
                            | CssImportOrderKind::ExternalPath(_),
                            _,
                        ) => true,
                    };
                if !declares_no_more {
                    continue;
                }
                if is_conditional_import_redundant(
                    &entry.conditions,
                    &wip_order.at(duplicate_index as usize).conditions,
                ) {
                    if !matches!(
                        entry.kind,
                        CssImportOrderKind::Layers(_) | CssImportOrderKind::LayersOf(_)
                    ) {
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
                            let is_of_this_file = match (&other.kind, &entry.kind) {
                                (CssImportOrderKind::Layers(layers), _) => {
                                    layers_key.is_empty()
                                        || core::ptr::eq(layers_key, layers.inner().slice())
                                }
                                (
                                    CssImportOrderKind::LayersOf(earlier),
                                    CssImportOrderKind::SourceIndex(file),
                                ) => earlier.get() == file.get(),
                                _ => false,
                            };
                            if is_of_this_file
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

            // The entry that a stand-in stands for stays: a style sheet that is applied with no
            // "@import" rules, as a hot update of the dev server is, has only that entry.
            if !is_layer_stand_in(entry) {
                layer_duplicates
                    .mut_(index)
                    .indices
                    .push(wip_order.len() as u32);
            }
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
    }
    debug_css_order(
        this,
        &order,
        CssOrderDebugStep::AfterMergingAdjacentLayerRules,
    );

    Ok(order)
}

/// Error for an `@import` (or cross-file `composes`) chain that's too deep for
/// the thread's stack.
pub(crate) struct CssImportChainTooDeep {
    importer: Index,
    range: Range,
    kind: ImportKind,
}

impl CssImportChainTooDeep {
    pub(crate) fn add_to_log(&self, sources: &[bun_ast::Source], log: &mut bun_ast::Log) {
        log.add_range_error_fmt(
            Some(&sources[self.importer.get() as usize]),
            self.range,
            format_args!(
                "Maximum call stack size exceeded while following this \"{}\" chain",
                if self.kind == ImportKind::Composes {
                    "composes"
                } else {
                    "@import"
                }
            ),
        );
    }
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
fn fork_conditions(list: &Vec<ImportConditions>, arena: &Arena) -> Vec<ImportConditions> {
    let cap = list.len() as usize + 1;
    let slab = arena.alloc_uninit_slice::<ImportConditions>(cap);
    for (dst, src) in slab.iter_mut().zip(list.slice_const()) {
        // SAFETY: never dropped (see the note at `bitwise_copy`).
        dst.write(unsafe { bitwise_copy(src) });
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
fn shallow_clone_records<'a>(list: &Vec<ImportRecord<'a>>) -> Vec<ImportRecord<'a>> {
    let mut out = Vec::<ImportRecord>::init_capacity(list.len() as usize);
    for r in list.slice_const() {
        // `ImportRecord` is plain-old-data; its `Path` slices borrow
        // resolver storage.
        // SAFETY: `ImportRecord` is POD (borrowed slices, no owning `Drop`); a
        // bitwise duplicate aliasing the same resolver storage is sound and
        // neither copy frees it.
        out.append_assume_capacity(unsafe { bitwise_copy(r) });
    }
    out
}

fn layer_lists_are_equal(a: &[LayerName], b: &[LayerName]) -> bool {
    a.len() == b.len() && a.iter().zip(b).all(|(a, b)| a.eql(b))
}

/// Whether two import orders print the same CSS. `CssImportOrder::hash` is not enough to tell.
pub(crate) fn css_import_orders_are_equal(a: &[CssImportOrder], b: &[CssImportOrder]) -> bool {
    a.len() == b.len()
        && a.iter().zip(b).all(|(a, b)| {
            import_conditions_are_equal(a.conditions.slice_const(), b.conditions.slice_const())
                && match (&a.kind, &b.kind) {
                    (CssImportOrderKind::Layers(a), CssImportOrderKind::Layers(b)) => {
                        layer_lists_are_equal(a.inner().slice(), b.inner().slice())
                    }
                    (CssImportOrderKind::ExternalPath(a), CssImportOrderKind::ExternalPath(b)) => {
                        a.text == b.text
                    }
                    (CssImportOrderKind::SourceIndex(a), CssImportOrderKind::SourceIndex(b))
                    | (CssImportOrderKind::LayersOf(a), CssImportOrderKind::LayersOf(b)) => {
                        a.get() == b.get()
                    }
                    _ => false,
                }
        })
}

/// For each style sheet that `layers_of_redundant_copy` had to walk: whether one "@layer"
/// statement of its layer names declares what its rules declare. One per build, so that a
/// style sheet with many importers is walked once.
#[derive(Default)]
pub(crate) struct LayerLists(Vec<(u32, bool)>);

/// What stands for a copy of a file that a later copy makes redundant: the layers that the
/// copy would declare. A flat list of the names is right unless the file declares a layer only
/// under a condition, or in another order than the list.
fn layers_of_redundant_copy<'a>(
    file: AstIndex,
    css_asts: &[crate::bundled_ast::CssCol],
    later: &[CssImportOrder],
    layer_lists: &mut LayerLists,
) -> CssImportOrderKind<'a> {
    let sheet: &BundlerStyleSheet = css_asts[file.get() as usize].as_deref().unwrap();
    let names = sheet.layer_names.slice_const();
    let flat = || CssImportOrderKind::Layers(Layers::borrow(&sheet.layer_names));
    if names.is_empty()
        || sheet
            .rules
            .top_level_layers_are(names, !sheet.layers_pre_import.is_empty())
    {
        return flat();
    }
    let known = layer_lists.0.iter().find(|(index, _)| *index == file.get());
    let is_flat = match known {
        Some((_, is_flat)) => *is_flat,
        None => {
            let is_flat = sheet
                .rules
                .layers_are_in_order_of(names, sheet.layers_pre_import.slice_const());
            layer_lists.0.push((file.get(), is_flat));
            is_flat
        }
    };
    if is_flat || is_ahead_of_namespace(later, css_asts) {
        return flat();
    }
    CssImportOrderKind::LayersOf(file)
}

/// Whether the next rule that is not an "@layer" statement is the "@namespace" of a file. A
/// block ahead of "@namespace" makes that rule invalid, and a statement does not.
fn is_ahead_of_namespace(
    later: &[CssImportOrder],
    css_asts: &[crate::bundled_ast::CssCol],
) -> bool {
    for entry in later {
        match &entry.kind {
            CssImportOrderKind::Layers(layers)
                if prints_as_layer_statement(
                    layers.inner().is_empty(),
                    entry.conditions.slice(),
                ) => {}
            CssImportOrderKind::SourceIndex(file) if entry.conditions.len() == 0 => {
                let sheet: &BundlerStyleSheet = css_asts[file.get() as usize].as_deref().unwrap();
                let first = sheet.rules.v.iter().find(|rule| {
                    !matches!(
                        rule,
                        BundlerCssRule::Import(_)
                            | BundlerCssRule::Ignored
                            | BundlerCssRule::LayerStatement(_)
                    )
                });
                return matches!(first, Some(BundlerCssRule::Namespace(_)));
            }
            _ => return false,
        }
    }
    false
}

/// The style sheet that an import stand-in loads. It has no rules: the "@import" rule itself
/// declares the layer, also where a content security policy blocks the URL.
const EMPTY_STYLE_SHEET: &[u8] = b"data:text/css,";

/// Whether the entry is an "@import" that `LayerStandIns` made to declare a layer.
fn is_layer_stand_in(entry: &CssImportOrder) -> bool {
    matches!(&entry.kind, CssImportOrderKind::ExternalPath(path) if path.text == EMPTY_STYLE_SHEET)
}

/// A layer that an entry behind the hoisted imports adds to the layer order.
struct LayerDeclaration<'o> {
    /// The name, with the names of the layers around it.
    path: Vec<&'static [u8]>,
    /// The import conditions whose media query list it is under.
    media: Option<&'o ImportConditions>,
    /// The import conditions whose "supports()" it is under.
    supports: Option<&'o ImportConditions>,
}

impl LayerDeclaration<'_> {
    /// Whether this declaration leaves nothing for `other` to declare.
    fn covers(&self, other: &Self) -> bool {
        self.path.starts_with(&other.path)
            && ((self.media.is_none() && self.supports.is_none())
                || self.has_same_conditions(other))
    }

    fn has_same_conditions(&self, other: &Self) -> bool {
        let same =
            |a: Option<&ImportConditions>,
             b: Option<&ImportConditions>,
             eql: fn(&ImportConditions, &ImportConditions) -> bool| match (a, b) {
                (None, None) => true,
                (Some(a), Some(b)) => core::ptr::eq(a, b) || eql(a, b),
                _ => false,
            };
        same(self.media, other.media, |a, b| a.media.eql(&b.media))
            && same(
                self.supports,
                other.supports,
                ImportConditions::supports_eql,
            )
    }
}

/// Adds the layers that `entry` declares to `out`, in the order of the source. Returns false
/// at the first layer that neither an "@layer" statement nor one "@import" can declare: an
/// anonymous layer, a layer under two media query lists or two "supports()" conditions, or
/// a layer that the rules of a file declare (`declares_layers`).
fn visible_layers<'o>(
    entry: &'o CssImportOrder,
    declares_layers: impl FnOnce(AstIndex) -> bool,
    out: &mut Vec<LayerDeclaration<'o>>,
) -> bool {
    let first = out.len();
    let mut path: Vec<&'static [u8]> = Vec::new();
    let mut media: Option<&ImportConditions> = None;
    let mut supports: Option<&ImportConditions> = None;
    let add = |out: &mut Vec<LayerDeclaration<'o>>,
               path: &[&'static [u8]],
               media: Option<&'o ImportConditions>,
               supports: Option<&'o ImportConditions>| {
        let declaration = LayerDeclaration {
            path: path.to_vec(),
            media,
            supports,
        };
        // A name also declares the layers around it.
        match out[first..].last_mut() {
            Some(last)
                if path.starts_with(&last.path) && last.has_same_conditions(&declaration) =>
            {
                *last = declaration
            }
            _ => out.push(declaration),
        }
    };
    for conditions in entry.conditions.slice() {
        if !conditions.media.media_queries.is_empty() {
            if media.is_some() {
                return false;
            }
            media = Some(conditions);
        }
        if conditions.supports.is_some() {
            if supports.is_some() {
                return false;
            }
            supports = Some(conditions);
        }
        if let Some(layer) = &conditions.layer {
            let Some(name) = &layer.v else {
                return false;
            };
            path.extend_from_slice(name.v.slice());
            add(out, &path, media, supports);
        }
    }
    match &entry.kind {
        CssImportOrderKind::Layers(layers) => {
            for name in layers.inner().slice() {
                let depth = path.len();
                path.extend_from_slice(name.v.slice());
                add(out, &path, media, supports);
                path.truncate(depth);
            }
            true
        }
        CssImportOrderKind::SourceIndex(file) => !declares_layers(*file),
        CssImportOrderKind::ExternalPath(_) | CssImportOrderKind::LayersOf(_) => true,
    }
}

/// The hoist moves an external "@import" ahead of the entries that came before it. If the
/// import has a layer, that layer would come first in the layer order. So each layer that
/// those entries declare gets a stand-in ahead of the import: an "@layer" statement while no
/// "@import" is out, and after that an "@import" of an empty style sheet with the layer and
/// its conditions, because only an "@import" is valid between two "@import" rules.
///
/// The entries stay where they are. The stand-ins only add to the import order.
#[derive(Default)]
struct LayerStandIns<'o> {
    /// The entries behind the imports that have no stand-in yet, as indexes into the order.
    pending: Vec<u32>,
    /// A pending entry declares a layer that nothing ahead of an import can declare. A
    /// stand-in for a later layer would move that layer ahead of it, so there is none.
    is_closed: bool,
    has_import: bool,
    declared: Vec<LayerDeclaration<'o>>,
    /// For each file that was asked about: whether its rules declare a layer.
    files: Vec<(u32, bool)>,
}

impl<'o> LayerStandIns<'o> {
    fn add(&mut self, index: usize) {
        if !self.is_closed {
            self.pending.push(index as u32);
        }
    }

    /// An "@layer" statement that is ahead of every import.
    fn add_statement(&mut self, statement: &'o CssImportOrder) {
        visible_layers(statement, |_| false, &mut self.declared);
    }

    /// Called ahead of each external import, in the order of the source.
    fn declare_ahead_of<'a>(
        &mut self,
        import: &CssImportOrder,
        order: &'o [CssImportOrder<'a>],
        css_asts: &[crate::bundled_ast::CssCol],
        arena: &Arena,
        hoisted: &mut Vec<CssImportOrder<'a>>,
    ) {
        let had_import = core::mem::replace(&mut self.has_import, true);
        if self.pending.is_empty() {
            return;
        }
        // The layer of the import, as far as it has a name. An import with no layer declares
        // none, so it passes none.
        let mut import_path: Vec<&'static [u8]> = Vec::new();
        let mut has_layer = false;
        for layer in import.conditions.iter().filter_map(|c| c.layer.as_ref()) {
            has_layer = true;
            let Some(name) = &layer.v else { break };
            import_path.extend_from_slice(name.v.slice());
        }
        if !has_layer {
            return;
        }

        let mut declarations: Vec<LayerDeclaration<'o>> = Vec::new();
        let files = &mut self.files;
        for (pending, &index) in self.pending.iter().enumerate() {
            let is_visible = visible_layers(
                &order[index as usize],
                |file| {
                    let known = files.iter().find(|(index, _)| *index == file.get());
                    known.map(|(_, declares)| *declares).unwrap_or_else(|| {
                        let sheet: &BundlerStyleSheet =
                            css_asts[file.get() as usize].as_deref().unwrap();
                        let declares =
                            sheet.layer_names.len() != 0 || sheet.rules.has_anonymous_layer();
                        files.push((file.get(), declares));
                        declares
                    })
                },
                &mut declarations,
            );
            if !is_visible {
                self.is_closed = true;
                self.pending.truncate(pending + 1);
                break;
            }
        }
        // The import declares its own layer and the layers around it where it is now, which
        // is where the entries declared them.
        if declarations
            .iter()
            .all(|declaration| import_path.starts_with(&declaration.path))
        {
            return;
        }
        self.pending.clear();

        let mut has_import = had_import;
        let mut statement: Vec<LayerName> = Vec::new();
        let end_statement = |statement: &mut Vec<LayerName>,
                             hoisted: &mut Vec<CssImportOrder<'a>>| {
            if statement.is_empty() {
                return;
            }
            let names = arena.alloc_slice_fill_iter(statement.drain(..));
            // SAFETY: the list and its header are in the arena, which outlives the chunks.
            // Neither is dropped or grown.
            let names: &Vec<LayerName> = arena.alloc(unsafe {
                Vec::from_raw_parts(names.as_mut_ptr(), names.len(), names.len())
            });
            hoisted.push(CssImportOrder {
                kind: CssImportOrderKind::Layers(Layers::borrow(names)),
                conditions: Vec::new(),
                condition_import_records: Vec::new(),
            });
        };
        for declaration in declarations {
            if self
                .declared
                .iter()
                .any(|earlier| earlier.covers(&declaration))
            {
                continue;
            }
            let name = LayerName {
                v: SmallList::from_arena_iter(arena, declaration.path.iter().copied()),
            };
            if !has_import && declaration.media.is_none() && declaration.supports.is_none() {
                statement.push(name);
            } else {
                end_statement(&mut statement, hoisted);
                has_import = true;
                let conditions = arena.alloc_uninit_slice::<ImportConditions>(1);
                conditions[0].write(ImportConditions {
                    layer: Some(Layer {
                        v: Some(name),
                        anonymous_id: 0,
                    }),
                    // SAFETY: never dropped (see the note at `bitwise_copy`).
                    supports: declaration
                        .supports
                        .and_then(|c| c.supports.as_ref())
                        .map(|supports| unsafe { bitwise_copy(supports) }),
                    media: match declaration.media {
                        // SAFETY: never dropped (see the note at `bitwise_copy`).
                        Some(c) => unsafe { bitwise_copy(&c.media) },
                        None => Default::default(),
                    },
                });
                hoisted.push(CssImportOrder {
                    kind: CssImportOrderKind::ExternalPath(crate::bun_fs::Path::init(
                        EMPTY_STYLE_SHEET,
                    )),
                    // SAFETY: the slab was just initialized and is arena-owned, as the slabs
                    // of `fork_conditions` are. `CssImportOrder` never drops it.
                    conditions: unsafe {
                        Vec::from_raw_parts(
                            conditions.as_mut_ptr().cast::<ImportConditions>(),
                            1,
                            1,
                        )
                    },
                    condition_import_records: Vec::new(),
                });
            }
            self.declared.push(declaration);
        }
        end_statement(&mut statement, hoisted);
    }
}

/// Whether a list of layer names under these conditions prints only "@layer"
/// statements, which may precede an "@import".
fn prints_as_layer_statement(no_names: bool, conditions: &[ImportConditions]) -> bool {
    match conditions {
        [] => true,
        [only] => {
            no_names
                && only.layer.as_ref().is_some_and(|layer| layer.v.is_some())
                && only.supports.is_none()
                && only.media.media_queries.is_empty()
        }
        _ => false,
    }
}

/// Whether an earlier entry is the same import under the same conditions.
fn has_earlier_copy(earlier: &[CssImportOrder], import: &CssImportOrder) -> bool {
    earlier.iter().any(|e| {
        css_import_orders_are_equal(core::slice::from_ref(e), core::slice::from_ref(import))
    })
}

/// Whether an external "@import" with no earlier copy can give way to a later one.
/// If its conditions have a layer, something at its place must still declare that
/// layer. A statement ahead of all the hoisted imports can.
fn can_mask_external_import(earlier: &[CssImportOrder], import: &CssImportOrder) -> bool {
    let conditions = import.conditions.slice();
    if !conditions.iter().any(|c| c.layer.is_some()) {
        return true;
    }
    let is_external = |e: &CssImportOrder| matches!(e.kind, CssImportOrderKind::ExternalPath(_));
    prints_as_layer_statement(true, conditions) && !earlier.iter().any(is_external)
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
/// A "@layer" condition that only the earlier one has means the two apply in
/// different layers, so neither can stand for the other.
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

    earlier.slice()[later.len()..]
        .iter()
        .all(|conditions| conditions.layer.is_none())
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
    use crate::bun_css::{ImportInfo, LocalsResultsMap, Printer, PrinterOptions};

    let tag = step.tag_name();
    debug!("CSS order {}:\n", tag);

    let arena = bun_alloc::Arena::new();
    let parse_graph = this.parse_graph();
    let ast_urls_for_css = parse_graph.ast.items_url_for_css();
    let unique_keys = parse_graph
        .input_files
        .items_unique_key_for_additional_file();
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
