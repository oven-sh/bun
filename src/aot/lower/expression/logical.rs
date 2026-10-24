use bun_sema::hir::{BinOp, Branches, ExprId, ExprKind};
use smallvec::SmallVec;

use super::{
    Evaluation, ResultUsage, Tail, is_decided, is_statically_resolved, lower_expression,
    lower_expression_for_effect, lower_expression_in,
};
use crate::ir::{BlockId, LocalVariable, TypeTable, ValueId};
use crate::lower::{FunctionLowering, condition};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum LogicalOperator {
    And,
    Or,
    Nullish,
}

#[derive(Copy, Clone)]
pub(super) struct LogicalBranch {
    pub(super) operator: LogicalOperator,
    pub(super) tested: Option<ExprId>,
    pub(super) result: Option<LocalVariable>,
    pub(super) right: BlockId,
    pub(super) join: BlockId,
}

pub(super) fn branch_on_logical_operator(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    left: ValueId,
    branch: LogicalBranch,
) {
    let split = match branch.operator {
        LogicalOperator::And | LogicalOperator::Or => {
            condition::split_expression_on_truthiness(lowering, branch.tested, left)
        }
        LogicalOperator::Nullish => {
            condition::split_expression_on_type(lowering, branch.tested, left, TypeTable::NULLISH)
        }
    };
    let (right_edge, short_circuit_edge, short_circuit_value) = match branch.operator {
        LogicalOperator::And | LogicalOperator::Nullish => {
            (split.taken, split.not_taken, split.not_taken_value)
        }
        LogicalOperator::Or => (split.not_taken, split.taken, split.taken_value),
    };
    lowering.builder.switch_to(right_edge);
    lowering.jump(branch.right);
    lowering.builder.switch_to(short_circuit_edge);
    if let Some(result) = branch.result {
        lowering.builder.write_variable(result, short_circuit_value);
    }
    lowering.jump(branch.join);
}

pub(super) fn lower_logical(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    usage: ResultUsage,
    tail: Tail<'_>,
) -> ValueId {
    let hir = lowering.file.hir;
    let decisions = lowering.file.decisions();
    let mut spine: SmallVec<[(ExprId, LogicalOperator, ExprId); 4]> = SmallVec::new();
    let mut innermost = expression;
    while let ExprKind::Binary { op, left, right } = hir[innermost].kind {
        let Some(operator) = logical_operator(op) else {
            break;
        };
        if innermost != expression && is_decided(lowering.file, innermost) {
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
        true => (lowering.builder.boolean(true), None),
        false => (lower_expression(lowering, innermost), Some(innermost)),
    };
    for &(node, operator, right) in spine.iter().rev() {
        if decisions.is_dead_expr(right) {
            continue;
        }
        lowering.set_position(hir[node].pos);
        let is_outermost = node == expression;
        let needs_result = usage == ResultUsage::Value || !is_outermost;
        let result = needs_result.then(|| lowering.builder.create_variable(None));
        let rhs = lowering.create_block();
        let join = lowering.create_block();
        let branch = LogicalBranch {
            operator,
            tested,
            result,
            right: rhs,
            join,
        };
        branch_on_logical_operator(lowering, value, branch);
        lowering.continue_in(rhs);
        let right_tail = if is_outermost { tail } else { Tail::No };
        lower_arm(lowering, right, result, right_tail);
        lowering.jump(join);
        lowering.continue_in(join);
        if let Some(result) = result {
            value = lowering.builder.read_variable(result);
        }
        tested = None;
    }
    value
}

pub(super) fn lower_conditional(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    usage: ResultUsage,
    tail: Tail<'_>,
) -> ValueId {
    let hir = lowering.file.hir;
    let decisions = lowering.file.decisions();
    let join = lowering.create_block();
    let result = (usage == ResultUsage::Value).then(|| lowering.builder.create_variable(None));
    let mut current = expression;
    while let ExprKind::Cond { test, branches } = hir[current].kind {
        if current != expression
            && (is_statically_resolved(lowering.file, current)
                || lowering.file.is_simplified(current))
        {
            break;
        }
        let Branches { yes, no } = hir.branches(branches);
        if decisions.is_dead_expr(yes) {
            lower_expression_for_effect(lowering, test);
            current = no;
            continue;
        }
        if decisions.is_dead_expr(no) {
            lower_expression_for_effect(lowering, test);
            current = yes;
            break;
        }
        let if_true = lowering.create_block();
        let if_false = lowering.create_block();
        condition::lower_condition(lowering, test, if_true, if_false);
        lowering.continue_in(if_true);
        lower_arm(lowering, yes, result, tail);
        lowering.jump(join);
        lowering.continue_in(if_false);
        current = no;
    }
    lower_arm(lowering, current, result, tail);
    lowering.jump(join);
    lowering.continue_in(join);
    match result {
        Some(result) => lowering.builder.read_variable(result),
        None => lowering.builder.undefined(),
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
    lower_expression_for_effect(lowering, innermost);
    for &right in earlier.iter().rev() {
        lower_expression_for_effect(lowering, right);
    }
    last
}

fn lower_arm(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    arm: ExprId,
    result: Option<LocalVariable>,
    tail: Tail<'_>,
) {
    match result {
        Some(result) => {
            let value = lower_expression_in(lowering, arm, Evaluation::at_tail(tail));
            lowering.builder.write_variable(result, value);
        }
        None => lower_expression_for_effect(lowering, arm),
    }
}

fn logical_operator(op: BinOp) -> Option<LogicalOperator> {
    match op {
        BinOp::And => Some(LogicalOperator::And),
        BinOp::Or => Some(LogicalOperator::Or),
        BinOp::Nullish => Some(LogicalOperator::Nullish),
        _ => None,
    }
}
