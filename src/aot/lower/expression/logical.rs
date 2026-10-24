use bun_sema::hir::{BinOp, Branches, ExprId, ExprKind};
use smallvec::SmallVec;

use super::{Evaluation, ResultUsage, Tail, is_decided};
use crate::ir::{BlockId, LocalVariable, TypeTable, ValueId};
use crate::lower::FunctionLowering;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum LogicalOperator {
    And,
    Or,
    Nullish,
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(super) fn branch_on_logical_operator(
        &mut self,
        left: ValueId,
        operator: LogicalOperator,
        tested: Option<ExprId>,
        result: Option<LocalVariable>,
        right: BlockId,
        join: BlockId,
    ) {
        let split = match operator {
            LogicalOperator::And | LogicalOperator::Or => {
                self.split_expression_on_truthiness(tested, left)
            }
            LogicalOperator::Nullish => {
                self.split_expression_on_type(tested, left, TypeTable::NULLISH)
            }
        };
        let (right_edge, short_circuit_edge, short_circuit_value) = match operator {
            LogicalOperator::And | LogicalOperator::Nullish => {
                (split.taken, split.not_taken, split.not_taken_value)
            }
            LogicalOperator::Or => (split.not_taken, split.taken, split.taken_value),
        };
        self.builder.switch_to(right_edge);
        self.jump(right);
        self.builder.switch_to(short_circuit_edge);
        if let Some(result) = result {
            self.builder.write_variable(result, short_circuit_value);
        }
        self.jump(join);
    }

    pub(super) fn lower_logical(
        &mut self,
        expression: ExprId,
        usage: ResultUsage,
        tail: Tail<'_>,
    ) -> ValueId {
        let hir = self.file.hir;
        let decisions = self.file.decisions();
        let mut spine: SmallVec<[(ExprId, LogicalOperator, ExprId); 4]> = SmallVec::new();
        let mut innermost = expression;
        while let ExprKind::Binary { op, left, right } = hir[innermost].kind {
            let operator = match op {
                BinOp::And => LogicalOperator::And,
                BinOp::Or => LogicalOperator::Or,
                BinOp::Nullish => LogicalOperator::Nullish,
                _ => break,
            };
            if innermost != expression && is_decided(self.file, innermost) {
                break;
            }
            spine.push((innermost, operator, right));
            innermost = left;
        }

        // `module && ..`: the left side is never the result, and nothing is read for the test, so that it makes no module object.
        let is_left_only_tested = decisions.is_truthy_without_effects(innermost)
            && spine.last().is_some_and(|&(_, operator, right)| {
                operator == LogicalOperator::And && !decisions.is_dead_expr(right)
            });
        let (mut value, mut tested) = match is_left_only_tested {
            true => (self.builder.boolean(true), None),
            false => (self.lower_expression(innermost), Some(innermost)),
        };
        for &(node, operator, right) in spine.iter().rev() {
            if decisions.is_dead_expr(right) {
                continue;
            }
            self.set_position(hir[node].pos);
            let is_outermost = node == expression;
            let needs_result = usage == ResultUsage::Value || !is_outermost;
            let result = needs_result.then(|| self.builder.create_variable(None));
            let rhs = self.create_block();
            let join = self.create_block();
            self.branch_on_logical_operator(value, operator, tested, result, rhs, join);
            self.continue_in(rhs);
            let right_tail = if is_outermost { tail } else { Tail::No };
            self.lower_arm(right, result, right_tail);
            self.jump(join);
            self.continue_in(join);
            if let Some(result) = result {
                value = self.builder.read_variable(result);
            }
            tested = None;
        }
        value
    }

    pub(super) fn lower_conditional(
        &mut self,
        expression: ExprId,
        usage: ResultUsage,
        tail: Tail<'_>,
    ) -> ValueId {
        let join = self.create_block();
        let result = (usage == ResultUsage::Value).then(|| self.builder.create_variable(None));
        self.lower_conditional_arms(expression, true, &mut |lowering, arm| {
            lowering.lower_arm(arm, result, tail);
            lowering.jump(join);
        });
        self.continue_in(join);
        match result {
            Some(result) => self.builder.read_variable(result),
            None => self.builder.undefined(),
        }
    }

    /// Tests `a ? b : c ? d : e` in turn: `lower_arm` gets each arm that can run, in the block where it runs.
    pub(in crate::lower) fn lower_conditional_arms(
        &mut self,
        expression: ExprId,
        stops_at_simplified: bool,
        lower_arm: &mut dyn FnMut(&mut FunctionLowering<'_, '_, '_, '_, '_>, ExprId),
    ) {
        let hir = self.file.hir;
        let decisions = self.file.decisions();
        let mut current = expression;
        while let ExprKind::Cond { test, branches } = hir[current].kind {
            if current != expression
                && (self.file.is_statically_resolved(current)
                    || (stops_at_simplified && self.file.is_simplified(current)))
            {
                break;
            }
            let Branches { yes, no } = hir.branches(branches);
            if decisions.is_dead_expr(yes) {
                self.lower_expression_for_effect(test);
                current = no;
                continue;
            }
            if decisions.is_dead_expr(no) {
                self.lower_expression_for_effect(test);
                current = yes;
                break;
            }
            let if_true = self.create_block();
            let if_false = self.create_block();
            self.lower_condition(test, if_true, if_false);
            self.continue_in(if_true);
            lower_arm(self, yes);
            self.continue_in(if_false);
            current = no;
        }
        lower_arm(self, current);
    }

    fn lower_arm(&mut self, arm: ExprId, result: Option<LocalVariable>, tail: Tail<'_>) {
        match result {
            Some(result) => {
                let value = self.lower_expression_in(arm, Evaluation::at_tail(tail));
                self.builder.write_variable(result, value);
            }
            None => self.lower_expression_for_effect(arm),
        }
    }
}

pub(super) fn lower_comma_prefix(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
) -> ExprId {
    let hir = lowering.file.hir;
    let mut rights: SmallVec<[ExprId; 8]> = SmallVec::new();
    let mut innermost = expression;
    while let ExprKind::Binary {
        op: BinOp::Comma,
        left,
        right,
    } = hir[innermost].kind
    {
        if innermost != expression && is_decided(lowering.file, innermost) {
            break;
        }
        rights.push(right);
        innermost = left;
    }
    let Some((&last, earlier)) = rights.split_first() else {
        unreachable!("lower_comma_prefix takes a comma expression");
    };
    lowering.lower_expression_for_effect(innermost);
    for &right in earlier.iter().rev() {
        lowering.lower_expression_for_effect(right);
    }
    last
}
