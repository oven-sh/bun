use crate::mal_prelude::*;
use bstr::BStr;
use core::num::NonZeroU32;

use bun_alloc::Arena;
use bun_ast::{ImportKind, ImportRecord, ImportRecordFlags, Range};
use bun_collections::{ArrayHashMap, StringArrayHashMap, VecExt};
use bun_core::{StackCheck, handle_oom};

use crate::Graph::Graph;
use crate::bun_css::css_parser::BundlerCssRule;
use crate::bun_css::{ImportConditions, LayerName};
use crate::chunk::{CssAstRef, CssImportOrder, CssImportOrderKind, ImportConditionsRef, Layers};
use crate::linker_context_mod::debug;
use crate::{Index, LinkerContext};
use bun_ast::Index as AstIndex;

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
/// The traversal recurses once per `@import`. Returns `Err` if the import chain
/// is too deep for the thread's stack, and the caller reports it.
pub(crate) fn find_imported_files_in_css_order<'a>(
    this: &LinkerContext<'_, 'a>,
    entry_points: &[Index],
) -> Result<Vec<CssImportOrder<'a>>, CssImportChainTooDeep> {
    struct Visitor<'v, 'a> {
        arena: &'a Arena,
        all_import_records: &'v [bun_ast::import_record::List<'a>],
        parse_graph: &'v Graph<'a>,

        has_external_import: bool,
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
            wrapping_conditions: &'a [ImportConditionsRef<'a>],
        ) {
            self.order.push(CssImportOrder {
                kind,
                conditions: wrapping_conditions,
            });
        }

        /// An import that loads no style sheet still adds its layer to the layer order.
        fn push_layers_of_unloaded_import(
            &mut self,
            wrapping_conditions: &'a [ImportConditionsRef<'a>],
        ) {
            if wrapping_conditions.iter().any(|c| c.layer.is_some()) {
                self.push_entry(
                    CssImportOrderKind::Layers(Layers::None),
                    wrapping_conditions,
                );
            }
        }

        /// The external import is hoisted out of the anonymous layer that its
        /// neighbours share, so something else must hold the place of its sublayer.
        fn push_sublayer_of_external_import(&mut self, conditions: &'a [ImportConditionsRef<'a>]) {
            let names_a_sublayer = conditions
                .iter()
                .skip_while(|c| c.anonymous_layer_id.is_none())
                .any(|c| c.layer_name().is_some());
            if names_a_sublayer {
                self.push_entry(CssImportOrderKind::Layers(Layers::None), conditions);
            }
        }

        /// Every visit of a bare "layer" makes a new anonymous layer, also when it
        /// is the same rule or its conditions look the same.
        fn fork_conditions(
            &mut self,
            conditions: &[ImportConditionsRef<'a>],
            sheet: CssAstRef<'a>,
            rule_index: usize,
            has_anonymous_layer: bool,
        ) -> &'a [ImportConditionsRef<'a>] {
            let mut appended = ImportConditionsRef {
                sheet,
                rule_index: rule_index as u32,
                anonymous_layer_id: None,
            };
            if has_anonymous_layer {
                self.anonymous_layers += 1;
                appended.anonymous_layer_id = NonZeroU32::new(self.anonymous_layers);
            }
            self.arena.alloc_slice_fill_with(conditions.len() + 1, |i| {
                *conditions.get(i).unwrap_or(&appended)
            })
        }

        /// Returns false if the traversal stopped because the chain is too deep.
        fn visit_import(
            &mut self,
            importer: Index,
            record: &ImportRecord<'a>,
            wrapping_conditions: &'a [ImportConditionsRef<'a>],
        ) -> bool {
            if !self.stack_check.is_safe_to_recurse() {
                self.too_deep = Some(CssImportChainTooDeep {
                    importer,
                    range: record.range,
                    kind: record.kind,
                });
                return false;
            }
            self.visit(record.source_index, wrapping_conditions);
            self.too_deep.is_none()
        }

        fn visit(
            &mut self,
            source_index: Index,
            wrapping_conditions: &'a [ImportConditionsRef<'a>],
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

            // An asset, such as "./icon.svg", is not a style sheet.
            let sheet = self.parse_graph.css_asts[source_index.get() as usize].as_deref();
            let Some(repr) = sheet.map(CssAstRef::new) else {
                self.push_layers_of_unloaded_import(wrapping_conditions);
                return;
            };
            self.visited.push(source_index);
            let top_level_rules = &repr.rules;

            // Any pre-import layers come first.
            if !repr.layers_pre_import.is_empty() {
                self.push_entry(
                    CssImportOrderKind::Layers(Layers::PreImport(repr)),
                    wrapping_conditions,
                );
            }

            // Iterate over the top-level "@import" rules
            for (rule_index, rule) in top_level_rules.v.iter().enumerate() {
                if let BundlerCssRule::Import(import_rule) = rule {
                    let record = &self.all_import_records[source_index.get() as usize]
                        [import_rule.import_record_idx as usize];

                    let is_followed = record.source_index.is_valid();
                    if !is_followed && record.flags.contains(ImportRecordFlags::IS_INTERNAL) {
                        continue;
                    }

                    // The conditions of this import add to those that wrap this file.
                    let conditions = if import_rule.has_conditions() {
                        let is_anonymous = import_rule.conditions.has_anonymous_layer();
                        self.fork_conditions(wrapping_conditions, repr, rule_index, is_anonymous)
                    } else {
                        wrapping_conditions
                    };

                    if is_followed {
                        if !self.visit_import(source_index, record, conditions) {
                            return;
                        }
                    } else {
                        self.push_sublayer_of_external_import(conditions);
                        self.push_entry(CssImportOrderKind::ExternalPath(record.path), conditions);
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
                    && !self.visit_import(source_index, record, wrapping_conditions)
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

    let css_asts = &this.parse_graph().css_asts;
    let all_import_records_slice = this.graph.ast.items_import_records();
    let arena = this.graph.arena();

    let mut visitor = Visitor {
        arena,
        parse_graph: this.parse_graph(),
        visited: Vec::<Index>::init_capacity(16),
        all_import_records: all_import_records_slice,
        has_external_import: false,
        order: Vec::new(),
        anonymous_layers: 0,
        stack_check: StackCheck::init(),
        too_deep: None,
    };
    // Include all files reachable from any entry point
    for entry_point in entry_points {
        visitor.visit(*entry_point, &[]);
        if visitor.too_deep.is_some() {
            break;
        }
    }

    if let Some(too_deep) = visitor.too_deep {
        return Err(too_deep);
    }

    let has_external_import = visitor.has_external_import;
    let mut order = visitor.order;
    let mut wip_order = Vec::<CssImportOrder>::init_capacity(order.len() as usize);

    debug_css_order(this, &order, CssOrderDebugStep::BeforeHoisting);

    // CSS syntax unfortunately only allows "@import" rules at the top of the
    // file. This means we must hoist all external "@import" rules to the top of
    // the file when bundling, even though doing so will change the order of CSS
    // evaluation.
    if has_external_import {
        // Pass 1: Pull out leading "@layer" and external "@import" rules
        let is_statement = |entry: &CssImportOrder| match &entry.kind {
            CssImportOrderKind::Layers(layers) => {
                prints_as_layer_statement(layers.names().is_empty(), entry.conditions)
            }
            _ => false,
        };
        // An entry that declares only the layers of an import that was not loaded must
        // not keep a later statement behind the hoisted imports.
        let continues_prefix = |entry: &CssImportOrder| {
            is_statement(entry)
                || matches!(&entry.kind, CssImportOrderKind::Layers(layers) if layers.names().is_empty())
        };
        let mut is_at_layer_prefix = true;
        for entry in order.slice() {
            if (is_statement(entry) && is_at_layer_prefix)
                || matches!(entry.kind, CssImportOrderKind::ExternalPath(_))
            {
                wip_order.push(*entry);
            }
            is_at_layer_prefix &= continues_prefix(entry);
        }

        // Pass 2: Append everything that we didn't pull out in pass 1
        is_at_layer_prefix = true;
        for entry in order.slice() {
            if (!is_statement(entry) || !is_at_layer_prefix)
                && !matches!(entry.kind, CssImportOrderKind::ExternalPath(_))
            {
                wip_order.push(*entry);
            }
            is_at_layer_prefix &= continues_prefix(entry);
        }

        core::mem::swap(&mut order, &mut wip_order);
        wip_order.clear();
    }
    debug_css_order(this, &order, CssOrderDebugStep::AfterHoisting);

    // Next, optimize import order. If there are duplicate copies of an imported
    // file, replace all but the last copy with just the layers that are in that
    // file. This works because in CSS, the last instance of a declaration
    // overrides all previous instances of that declaration.
    {
        let mut source_index_duplicates: ArrayHashMap<u32, Vec<&[ImportConditionsRef]>> =
            ArrayHashMap::new();
        let mut external_path_duplicates: StringArrayHashMap<Vec<&[ImportConditionsRef]>> =
            StringArrayHashMap::new();

        let mut earlier = order.as_mut_slice();
        'next_backward: while let [rest @ .., entry] = earlier {
            earlier = rest;
            match &entry.kind {
                CssImportOrderKind::SourceIndex(idx) => {
                    let idx = *idx;
                    let gop = handle_oom(source_index_duplicates.get_or_put(idx.get()));
                    if !gop.found_existing {
                        *gop.value_ptr = Vec::new();
                    }
                    for later in gop.value_ptr.slice() {
                        if is_conditional_import_redundant(entry.conditions, later) {
                            // This import is redundant, but it might have @layer rules.
                            // So we should keep the @layer rules so that the cascade ordering of layers
                            // is preserved
                            let sheet = css_asts[idx.get() as usize].as_deref();
                            let sheet = CssAstRef::new(sheet.unwrap());
                            entry.kind = CssImportOrderKind::Layers(Layers::PostImport(sheet));
                            continue 'next_backward;
                        }
                    }
                    gop.value_ptr.push(entry.conditions);
                }
                CssImportOrderKind::ExternalPath(p) => {
                    let gop = handle_oom(external_path_duplicates.get_or_put(p.text));
                    if !gop.found_existing {
                        *gop.value_ptr = Vec::new();
                    }
                    for later in gop.value_ptr.slice() {
                        if is_conditional_import_redundant(entry.conditions, later) {
                            // Don't remove duplicates entirely. The import conditions may
                            // still introduce layers to the layer order. Represent this as a
                            // file with an empty layer list, or keep the "@import" where
                            // nothing else can do that among the hoisted imports.
                            let has_earlier_copy = has_earlier_copy(earlier, entry);
                            if !has_earlier_copy && !can_mask_external_import(earlier, entry) {
                                break;
                            }
                            entry.kind = CssImportOrderKind::Layers(Layers::None);
                            if has_earlier_copy {
                                // The earlier copy declares the layers. Declaring them here
                                // too could print a block ahead of a hoisted "@import".
                                entry.conditions = &[];
                            }
                            continue 'next_backward;
                        }
                    }
                    gop.value_ptr.push(entry.conditions);
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
        struct DuplicateEntry<'r, 'a> {
            layers: &'r [LayerName<'a>],
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
                .iter()
                .any(|c| c.anonymous_layer_id.is_some());
            match &entry.kind {
                // Simplify the conditions since we know they only wrap "@layer"
                CssImportOrderKind::Layers(layers) => {
                    // An external import with these exact conditions already
                    // declares what this entry would.
                    if layers.names().is_empty()
                        && !in_anonymous_layer
                        && wip_order.slice().iter().any(|kept| {
                            matches!(kept.kind, CssImportOrderKind::ExternalPath(_))
                                && import_conditions_are_equal(kept.conditions, entry.conditions)
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
                    if layers.names().len() == 0 {
                        while let [rest @ .., last] = entry.conditions
                            && last.layer.is_none()
                        {
                            entry.conditions = rest;
                        }
                    }

                    // Remove unnecessary entries entirely
                    if entry.conditions.len() == 0 && layers.names().len() == 0 {
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
                CssImportOrderKind::SourceIndex(idx) => css_asts[idx.get() as usize]
                    .as_deref()
                    .unwrap()
                    .layer_names
                    .slice_const(),
                CssImportOrderKind::Layers(layers) => layers.names(),
                CssImportOrderKind::ExternalPath(_) => &[],
            };
            let mut index: usize = 0;
            while index < layer_duplicates.len() as usize {
                let dup_layers: &[LayerName] = layer_duplicates.at(index).layers;
                if layer_lists_are_equal(layers_key, dup_layers) {
                    break;
                }
                index += 1;
            }
            if index == layer_duplicates.len() as usize {
                // This is the first time we've seen this combination of layer names.
                // Allocate a new set of duplicate indices to track this combination.
                layer_duplicates.push(DuplicateEntry {
                    layers: layers_key,
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
                if matches!(entry.kind, CssImportOrderKind::Layers(_))
                    && match wip_order.at(duplicate_index as usize).kind {
                        CssImportOrderKind::Layers(_) => false,
                        CssImportOrderKind::SourceIndex(_) => !layers_key.is_empty(),
                        CssImportOrderKind::ExternalPath(_) => in_anonymous_layer,
                    }
                {
                    continue;
                }
                if is_conditional_import_redundant(
                    entry.conditions,
                    wip_order.at(duplicate_index as usize).conditions,
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
                            if let CssImportOrderKind::Layers(layers) = &other.kind
                                && (layers_key.is_empty()
                                    || core::ptr::eq(layers_key, layers.names()))
                                && import_conditions_are_equal(entry.conditions, other.conditions)
                            {
                                // Remove the previous entry and then overwrite it below
                                wip_order.pop();
                                break;
                            }
                        }

                        // Non-layer entries still need to be present because they have
                        // other side effects beside inserting things in the layer order
                        wip_order.push(*entry);
                    }

                    // Don't add this to the duplicate list below because it's redundant
                    continue 'next_forward;
                }
            }

            layer_duplicates
                .mut_(index)
                .indices
                .push(wip_order.len() as u32);
            wip_order.push(*entry);
        }

        debug_css_order(
            this,
            &wip_order,
            CssOrderDebugStep::WhileOptimizingRedundantLayerRules,
        );
    }
    debug_css_order(
        this,
        &wip_order,
        CssOrderDebugStep::AfterOptimizingRedundantLayerRules,
    );

    Ok(wip_order)
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

fn layer_lists_are_equal(a: &[LayerName], b: &[LayerName]) -> bool {
    a.len() == b.len() && a.iter().zip(b).all(|(a, b)| a.eql(b))
}

/// Whether two import orders print the same CSS. `CssImportOrder::hash` is not enough to tell.
pub(crate) fn css_import_orders_are_equal<'a>(
    a: &[CssImportOrder<'a>],
    b: &[CssImportOrder<'a>],
) -> bool {
    a.len() == b.len()
        && a.iter().zip(b).all(|(a, b)| {
            import_conditions_are_equal(a.conditions, b.conditions)
                && match (&a.kind, &b.kind) {
                    (CssImportOrderKind::Layers(a), CssImportOrderKind::Layers(b)) => {
                        layer_lists_are_equal(a.names(), b.names())
                    }
                    (CssImportOrderKind::ExternalPath(a), CssImportOrderKind::ExternalPath(b)) => {
                        a.text == b.text
                    }
                    (CssImportOrderKind::SourceIndex(a), CssImportOrderKind::SourceIndex(b)) => {
                        a.get() == b.get()
                    }
                    _ => false,
                }
        })
}

/// Whether a list of layer names under these conditions prints only "@layer"
/// statements, which may precede an "@import".
fn prints_as_layer_statement(no_names: bool, conditions: &[ImportConditionsRef]) -> bool {
    match conditions {
        [] => true,
        [only] => {
            no_names
                && only.layer_name().is_some()
                && only.supports.is_none()
                && only.media.media_queries.is_empty()
        }
        _ => false,
    }
}

/// Whether an earlier entry is the same import under the same conditions.
fn has_earlier_copy<'a>(earlier: &[CssImportOrder<'a>], import: &CssImportOrder<'a>) -> bool {
    earlier.iter().any(|e| {
        css_import_orders_are_equal(core::slice::from_ref(e), core::slice::from_ref(import))
    })
}

/// Whether an external "@import" with no earlier copy can give way to a later one.
/// If its conditions have a layer, something at its place must still declare that
/// layer. A statement ahead of all the hoisted imports can.
fn can_mask_external_import(earlier: &[CssImportOrder], import: &CssImportOrder) -> bool {
    let conditions = import.conditions;
    if !conditions.iter().any(|c| c.layer.is_some()) {
        return true;
    }
    let is_external = |e: &CssImportOrder| matches!(e.kind, CssImportOrderKind::ExternalPath(_));
    prints_as_layer_statement(true, conditions) && !earlier.iter().any(is_external)
}

fn import_conditions_are_equal<'a>(
    a: &[ImportConditionsRef<'a>],
    b: &[ImportConditionsRef<'a>],
) -> bool {
    if a.len() != b.len() {
        return false;
    }

    for (ai, bi) in a.iter().zip(b) {
        if !ai.is_same_layer(bi)
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
fn is_conditional_import_redundant<'a>(
    earlier: &[ImportConditionsRef<'a>],
    later: &[ImportConditionsRef<'a>],
) -> bool {
    if later.len() > earlier.len() {
        return false;
    }

    for (a, b) in earlier.iter().zip(later) {
        // Only compare "@supports" and "@media" if "@layers" is equal
        if a.is_same_layer(b) {
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

    earlier[later.len()..]
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
        }
    }
}

fn debug_css_order<'a>(
    this: &LinkerContext<'_, 'a>,
    order: &Vec<CssImportOrder<'a>>,
    step: CssOrderDebugStep,
) {
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
fn debug_css_order_impl<'a>(
    this: &LinkerContext<'_, 'a>,
    order: &Vec<CssImportOrder<'a>>,
    step: CssOrderDebugStep,
) {
    use crate::bun_css::{LocalsResultsMap, Printer, PrinterOptions};

    let tag = step.tag_name();
    debug!("CSS order {}:\n", tag);

    let arena = bun_alloc::Arena::new();
    // `LocalsResultsMap` is the same `ArrayHashMap<Ref, Box<[u8]>>` alias as
    // `bun_js_printer::MangledProps`; no cast needed.
    let local_names: &LocalsResultsMap = &this.mangled_props;
    let symbols = bun_ast::symbol::Map::init_list(Default::default());

    for (i, entry) in order.slice().iter().enumerate() {
        let conditions_str: std::borrow::Cow<'_, str> = if entry.conditions.len() > 0 {
            let mut writer: Vec<u8> = Vec::new();
            writer.extend_from_slice(b"[");
            for (j, condition) in entry.conditions.iter().enumerate() {
                let mut printer = Printer::new(
                    &arena,
                    bun_alloc::ArenaVec::new_in(&arena),
                    &mut writer,
                    &PrinterOptions::default(),
                    None,
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
