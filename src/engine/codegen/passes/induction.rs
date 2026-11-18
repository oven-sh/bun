//! What holds in every turn of a loop for the parameters of its header that count up or down.

use bun_engine_asm::Cond;

use super::bounds::Bounds;
use super::facts::Facts;
use crate::analysis::{Cfg, Dominators, Loop};
use crate::ir::{Binary, Block, Checked, Edge, Function, Op, Value};

/// A natural loop that is entered by one edge.
pub(super) struct Turns<'a> {
    pub(super) cfg: &'a Cfg,
    pub(super) dominators: &'a Dominators,
    pub(super) id: Loop,
    pub(super) entering: Edge,
    pub(super) returning: &'a [Edge],
}

/// How `subject` compares with another value if the edge is taken.
pub(super) fn comparison_for(
    function: &Function,
    edge: Edge,
    subject: Value,
) -> Option<(Cond, Value)> {
    let source = function.source(edge);
    let Op::Branch(condition) = *function.op(function.last(source)) else {
        return None;
    };
    let Op::Compare(cond, [a, b]) = *function.op(condition) else {
        return None;
    };
    let cond = if function.successor(source, 0) == edge {
        cond
    } else {
        cond.inverted()
    };
    if a == subject {
        Some((cond, b))
    } else {
        (b == subject).then_some((cond.commuted(), a))
    }
}

/// What `next` adds to `counter`, and whether it exits if the sum does not fit.
pub(super) fn step(function: &Function, counter: Value, next: Value) -> Option<(i64, bool)> {
    let ([from, step], is_checked) = match *function.op(next) {
        Op::Binary(Binary::Add, args) => (args, false),
        Op::Checked(Checked::Add, args, _) => (args, true),
        _ => return None,
    };
    let step = function.int_constant(step)?;
    (from == counter && step != 0).then_some((step, is_checked))
}

impl Turns<'_> {
    pub(super) fn learn(&self, function: &Function, facts: &mut Facts<'_>) {
        let header = function.target(self.entering);
        for (position, &param) in function.params(header).iter().enumerate() {
            if function.type_of(param).is_int() {
                self.learn_of_counter(function, facts, param, position);
            }
        }
    }

    fn comes_before(&self, function: &Function, value: Value) -> bool {
        let home = function.block_of(value).expand();
        home.is_none_or(|home| !self.cfg.includes(self.id, home))
    }

    fn learn_of_counter(
        &self,
        function: &Function,
        facts: &mut Facts<'_>,
        counter: Value,
        position: usize,
    ) -> Option<()> {
        let next = |edge| function.args(edge)[position];
        let counts_up = step(function, counter, next(self.returning[0]))?.0 > 0;
        let first = next(self.entering);
        let (width, from) = (
            function.type_of(counter).width(),
            facts.bounds(function, first),
        );
        let onward = if counts_up { Cond::Ge } else { Cond::Le };
        let mut bounds = Bounds::any(width).where_holds(onward, &from);

        let mut kept = None;
        if let [only] = *self.returning
            && let Some((mut cond, limit)) = comparison_for(function, only, next(only))
        {
            let holds_at_first = |cond| {
                self.comes_before(function, limit)
                    && facts.compare(function, cond, first, limit) == Some(true)
            };
            // Steps of one do not miss the limit.
            let toward = if counts_up { Cond::Lt } else { Cond::Gt };
            let (size, _) = step(function, counter, next(only))?;
            if cond == Cond::Ne && size.unsigned_abs() == 1 && holds_at_first(toward) {
                cond = toward;
            }
            let again = bounds.where_holds(cond, &facts.bounds(function, limit));
            bounds = if again.is_empty() {
                from
            } else {
                again.hull(&from)
            };
            kept = holds_at_first(cond).then_some((cond, limit));
        }

        for &edge in self.returning {
            let (size, is_checked) = step(function, counter, next(edge))?;
            let home = function.block_of(next(edge));
            let before = self.after_test_at_top(function, facts, counter, home, bounds);
            let size_bounds = Bounds::constant(width, size);
            if (size > 0) != counts_up
                || !is_checked && !Bounds::always_fits(Checked::Add, &before, &size_bounds)
            {
                return None;
            }
        }

        facts.learn_bounds(function, counter, bounds);
        facts.learn_comparison(function, onward, counter, first);
        if let Some((cond, limit)) = kept {
            facts.learn_comparison(function, cond, counter, limit);
        }
        if let Op::Binary(Binary::Add, [end, back]) | Op::Checked(Checked::Add, [end, back], _) =
            *function.op(first)
            && !counts_up
            && function.int_constant(back).is_some_and(|back| back < 0)
            && (function.op(first).exit().is_some()
                || Bounds::always_fits(
                    Checked::Add,
                    &facts.bounds(function, end),
                    &facts.bounds(function, back),
                ))
        {
            facts.learn_comparison(function, Cond::Lt, counter, end);
        }
        Some(())
    }

    /// The bounds of the counter in a block, to which control may get only if the counter passes a test.
    fn after_test_at_top(
        &self,
        function: &Function,
        facts: &Facts<'_>,
        counter: Value,
        block: Block,
        bounds: Bounds,
    ) -> Bounds {
        let leads_here = |&edge: &Edge| {
            let target = function.target(edge);
            self.cfg.predecessors(target).len() == 1 && self.dominators.dominates(target, block)
        };
        function
            .successors(function.target(self.entering))
            .find(leads_here)
            .and_then(|edge| comparison_for(function, edge, counter))
            .map(|(cond, limit)| bounds.where_holds(cond, &facts.bounds(function, limit)))
            .filter(|narrower| !narrower.is_empty())
            .unwrap_or(bounds)
    }
}
