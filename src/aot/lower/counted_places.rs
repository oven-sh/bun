use bun_ast::Loader;
use bun_ast::coverage::{Event, Placement};
use bun_code_coverage::{Target, describe_compiled_file, find_anchors, mark_nodes};
use bun_sema::fold::{Decision, Decisions, FoldedValue};
use bun_sema::hir::{self, BinOp, Chain, ExprId, ExprKind, Node, NodeData, StmtId};
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;

use super::{FileLowering, FunctionLowering};
use crate::ir::{BlockId, StringId};

#[cfg(test)]
mod tests;

pub(in crate::lower) struct CountedPlaces {
    description: Vec<u8>,
    interned_description: Option<StringId>,
    counters: FxHashMap<(Target, Event), SmallVec<[u32; 2]>>,
    links_counted: u32,
    /// By the base of a `?.`: `links_counted` when it was counted last.
    last_counted: FxHashMap<ExprId, u32>,
}

/// Type syntax is not always lowered.
fn without_type_syntax(hir: &hir::File<'_>, target: Target) -> Target {
    match target {
        Target::Expression(e) | Target::FirstOperandOf(e) => {
            Target::Expression(hir.skip_type_assertions(e))
        }
        _ => target,
    }
}

fn as_link(hir: &hir::File<'_>, e: ExprId) -> Option<(ExprId, Chain)> {
    match hir[e].kind {
        ExprKind::Dot { obj, chain, .. } | ExprKind::Index { obj, chain, .. } => Some((obj, chain)),
        ExprKind::Call(call) => Some((hir[call].callee, hir[call].chain)),
        _ => None,
    }
}

/// An operator that is folded may not be lowered. The way that it goes is counted with the code around it.
struct FoldedOperators<'a, 's> {
    hir: &'a hir::File<'s>,
    decisions: &'a Decisions<'s>,
    counted_expressions: FxHashSet<ExprId>,
}

impl FoldedOperators<'_, '_> {
    fn is_folded(&self, e: ExprId) -> bool {
        self.decisions.constant(self.hir, e) != FoldedValue::Unknown
    }

    fn find_operator_of(&self, operand: ExprId) -> Option<ExprId> {
        let hir = self.hir;
        let NodeData::Expr(operator) = hir.data(hir.parent(hir.child(operand))) else {
            return None;
        };
        let (ExprKind::Cond { test, .. }
        | ExprKind::Binary {
            op: BinOp::And | BinOp::Or | BinOp::Nullish,
            left: test,
            ..
        }) = hir[operator].kind
        else {
            return None;
        };
        // In `this && this.helper` the `this` of a CommonJS file may be lowered as `undefined`.
        (self.is_folded(operator) || self.decisions.is_truthy_without_effects(test))
            .then_some(operator)
    }

    /// The base of the `?.` that decides whether `part` of `link` is evaluated.
    fn find_optional_base(&self, mut link: ExprId, part: Node) -> Option<ExprId> {
        let hir = self.hir;
        loop {
            let (base, chain) = as_link(hir, link)?;
            match chain {
                _ if hir.child(base) == part => return None,
                Chain::No => return None,
                Chain::Start => return Some(base),
                Chain::Continue => link = hir.skip_type_assertions(base),
            }
        }
    }

    /// `None` if it is dead.
    fn find_code_around(&self, operator: ExprId) -> Option<Target> {
        let hir = self.hir;
        let (mut part, mut node) = (Node::NONE, hir.node(operator));
        loop {
            if let Some(function) = hir.function_of(node).some() {
                return Some(Target::Function(function));
            }
            match hir.data(node) {
                NodeData::Expr(e) if self.decisions.is_dead_expr(e) => return None,
                NodeData::Expr(e) => {
                    if let Some(base) = self.find_optional_base(e, part) {
                        return Some(Target::Chain(base));
                    }
                    if self.counted_expressions.contains(&e) && self.find_operator_of(e).is_none() {
                        return Some(Target::Expression(e));
                    }
                }
                NodeData::Stmt(s) => return Some(Target::Statement(s)),
                NodeData::None | NodeData::File => return Some(Target::File),
                _ => {}
            }
            (part, node) = (node, hir.parent(node));
        }
    }

    /// `None` if it is dead.
    fn move_out(&self, target: Target) -> Option<Target> {
        match target {
            Target::FirstOperandOf(operator) if self.is_folded(operator) => {
                self.find_code_around(operator)
            }
            Target::Expression(e) if let Some(operator) = self.find_operator_of(e) => {
                (self.find_code_around(operator)).filter(|_| !self.decisions.is_dead_expr(e))
            }
            _ => Some(target),
        }
    }
}

impl CountedPlaces {
    pub(in crate::lower) fn find<'s>(
        hir: &hir::File<'s>,
        decisions: &Decisions<'s>,
        path: &[u8],
        loader: Loader,
    ) -> CountedPlaces {
        let mut placement = Placement::new(find_anchors(loader, &hir.text).unwrap_or_default());
        let is_replaced = |e| !matches!(decisions.decision(e), Decision::Unknown);
        mark_nodes(hir, &is_replaced, &mut |role, loc, target| {
            placement.mark(role, loc, target);
        });
        let placed = placement.finish();
        let counted_expressions = placed.places.iter().filter_map(|it| match it.0 {
            Target::Expression(e) => Some(e),
            _ => None,
        });
        let folded = FoldedOperators {
            hir,
            decisions,
            counted_expressions: counted_expressions.collect(),
        };
        let mut counters = FxHashMap::<_, SmallVec<_>>::default();
        for &(target, event, counter) in &placed.places {
            if let Some(target) = folded.move_out(target) {
                let place = (without_type_syntax(hir, target), event);
                counters.entry(place).or_default().push(counter);
            }
        }
        CountedPlaces {
            description: describe_compiled_file(path, loader, &hir.text, &placed),
            interned_description: None,
            counters,
            links_counted: 0,
            last_counted: FxHashMap::default(),
        }
    }
}

impl FileLowering<'_, '_, '_, '_> {
    pub(in crate::lower) fn counts_executions(&self) -> bool {
        self.counted_places.is_some()
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(in crate::lower) fn count(&mut self, target: Target) {
        self.count_event(target, Event::Reached);
    }

    pub(in crate::lower) fn count_skipped(&mut self, guarded: StmtId) {
        self.count_event(Target::Statement(guarded), Event::Skipped);
    }

    fn count_event(&mut self, target: Target, event: Event) {
        let module = self.file.module_id();
        let file = &mut *self.file;
        let Some(places) = file.counted_places.as_mut() else {
            return;
        };
        let place = (without_type_syntax(file.hir, target), event);
        for &counter in places.counters.get(&place).into_iter().flatten() {
            let description = *(places.interned_description)
                .get_or_insert_with(|| file.fragment.strings.intern(&places.description));
            self.builder.count_execution(module, description, counter);
        }
    }

    pub(in crate::lower) fn count_statement(&mut self, statement: StmtId) {
        self.count(Target::Statement(statement));
    }

    pub(in crate::lower) fn count_rest_of_chain(&mut self, base: ExprId) {
        self.count(Target::Chain(base));
        if let Some(places) = &mut self.file.counted_places {
            places.links_counted += 1;
            places.last_counted.insert(base, places.links_counted);
        }
    }

    pub(in crate::lower) fn links_counted(&self) -> u32 {
        (self.file.counted_places.as_ref()).map_or(0, |it| it.links_counted)
    }

    /// What the build knows to be there is not tested. `before`: `links_counted` before `link` was lowered.
    pub(in crate::lower) fn count_untested_links(&mut self, mut link: ExprId, before: u32) {
        let hir = self.file.hir;
        while let Some(places) = &self.file.counted_places
            && let Some((base, chain)) = as_link(hir, link)
        {
            match chain {
                Chain::No => return,
                Chain::Start if places.last_counted.get(&base) > Some(&before) => return,
                Chain::Start => self.count_rest_of_chain(base),
                Chain::Continue => {}
            }
            link = hir.skip_type_assertions(base);
        }
    }

    /// `branch` gets the block to jump to in order to skip what an `if` runs.
    pub(in crate::lower) fn branch_past(
        &mut self,
        guarded: StmtId,
        destination: BlockId,
        branch: impl FnOnce(&mut Self, BlockId),
    ) {
        let skipped = self.file.counts_executions().then(|| self.create_block());
        branch(self, skipped.unwrap_or(destination));
        if let Some(skipped) = skipped {
            self.continue_in(skipped);
            self.count_skipped(guarded);
            self.jump(destination);
        }
    }

    pub(in crate::lower) fn enter_counted_expression(&mut self, expression: ExprId) -> ExprId {
        let outer = self.counted_expression;
        if self.file.counts_executions() {
            self.counted_expression = self.file.skip_type_syntax(expression);
            if self.counted_expression != outer {
                self.count(Target::Expression(expression));
            }
        }
        outer
    }

    pub(in crate::lower) fn leave_counted_expression(&mut self, outer: ExprId) {
        self.counted_expression = outer;
    }
}
