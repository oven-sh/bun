// checker/symboltracker.go: the tracker that a node builder context owns. `this.context` is always the context that holds the tracker, so each method takes that context.
use crate::ast::{Ast, NodeId, SymbolFlags, SymbolId};
use crate::checker::nodebuilderimpl::{NodeBuilderContext, TrackedSymbolArgs};
use crate::nodebuilder::SymbolTracker;

#[derive(Default)]
pub struct SymbolTrackerImpl {
    pub inner: Option<Box<dyn SymbolTracker>>,
    pub disable_track_symbol: bool,
}

// Upstream unwraps nested SymbolTrackerImpl values here: SymbolTrackerImpl is not a SymbolTracker in this port, so there is nothing to unwrap.
pub fn new_symbol_tracker_impl(tracker: Option<Box<dyn SymbolTracker>>) -> SymbolTrackerImpl {
    SymbolTrackerImpl {
        inner: tracker,
        disable_track_symbol: false,
    }
}

impl SymbolTrackerImpl {
    pub fn track_symbol(
        a: Ast<'_>,
        context: &mut NodeBuilderContext,
        symbol: SymbolId,
        enclosing_declaration: NodeId,
        meaning: SymbolFlags,
    ) -> bool {
        if !context.tracker.disable_track_symbol {
            let tracked = match context.tracker.inner.as_deref_mut() {
                Some(inner) => inner.track_symbol(symbol, enclosing_declaration, meaning),
                None => false,
            };
            if tracked {
                Self::on_diagnostic_reported(context);
                return true;
            }
            // Skip recording type parameters as they dont contribute to late painted statements
            if !a.sym(symbol).flags.intersects(SymbolFlags::TYPE_PARAMETER) {
                context.tracked_symbols.push(TrackedSymbolArgs {
                    symbol,
                    enclosing_declaration,
                    meaning,
                });
            }
        }
        false
    }

    pub fn report_inaccessible_this_error(context: &mut NodeBuilderContext) {
        Self::on_diagnostic_reported(context);
        let Some(inner) = context.tracker.inner.as_deref_mut() else {
            return;
        };
        inner.report_inaccessible_this_error();
    }

    pub fn report_private_in_base_of_class_expression(
        context: &mut NodeBuilderContext,
        property_name: &[u8],
    ) {
        Self::on_diagnostic_reported(context);
        let Some(inner) = context.tracker.inner.as_deref_mut() else {
            return;
        };
        inner.report_private_in_base_of_class_expression(property_name);
    }

    pub fn report_inaccessible_unique_symbol_error(context: &mut NodeBuilderContext) {
        Self::on_diagnostic_reported(context);
        let Some(inner) = context.tracker.inner.as_deref_mut() else {
            return;
        };
        inner.report_inaccessible_unique_symbol_error();
    }

    pub fn report_cyclic_structure_error(context: &mut NodeBuilderContext) {
        Self::on_diagnostic_reported(context);
        let Some(inner) = context.tracker.inner.as_deref_mut() else {
            return;
        };
        inner.report_cyclic_structure_error();
    }

    pub fn report_likely_unsafe_import_required_error(
        context: &mut NodeBuilderContext,
        specifier: &[u8],
        symbol_name: &[u8],
    ) {
        Self::on_diagnostic_reported(context);
        let Some(inner) = context.tracker.inner.as_deref_mut() else {
            return;
        };
        inner.report_likely_unsafe_import_required_error(specifier, symbol_name);
    }

    pub fn report_truncation_error(context: &mut NodeBuilderContext) {
        Self::on_diagnostic_reported(context);
        let Some(inner) = context.tracker.inner.as_deref_mut() else {
            return;
        };
        inner.report_truncation_error();
    }

    pub fn report_non_serializable_property(
        context: &mut NodeBuilderContext,
        property_name: &[u8],
    ) {
        Self::on_diagnostic_reported(context);
        let Some(inner) = context.tracker.inner.as_deref_mut() else {
            return;
        };
        inner.report_non_serializable_property(property_name);
    }

    fn on_diagnostic_reported(context: &mut NodeBuilderContext) {
        context.reported_diagnostic = true;
    }

    pub fn report_inference_fallback(context: &mut NodeBuilderContext, node: NodeId) {
        let Some(inner) = context.tracker.inner.as_deref_mut() else {
            return;
        };
        inner.report_inference_fallback(node);
    }
}
