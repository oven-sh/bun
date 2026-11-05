use bun_sema::hir::{BinOp, Branches, ExprId, ExprKind, UnOp};
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

#[derive(Copy, Clone)]
struct Level {
    operator: LogicalOperator,
    result: Option<LocalVariable>,
    rhs: BlockId,
    join: BlockId,
}

fn where_left_side_goes_at_once(
    levels: &[Level],
    number: usize,
) -> (Option<LocalVariable>, BlockId) {
    let is_truthy = match levels[number].operator {
        LogicalOperator::And => false,
        LogicalOperator::Or => true,
        LogicalOperator::Nullish => return (levels[number].result, levels[number].join),
    };
    for outer in number + 1..levels.len() {
        match (levels[outer].operator, is_truthy) {
            (LogicalOperator::And, false)
            | (LogicalOperator::Or | LogicalOperator::Nullish, true) => {}
            (LogicalOperator::And, true) | (LogicalOperator::Or, false) => {
                return (None, levels[outer].rhs);
            }
            (LogicalOperator::Nullish, false) => {
                return (levels[outer - 1].result, levels[outer - 1].join);
            }
        }
    }
    let last = levels[levels.len() - 1];
    (last.result, last.join)
}

fn is_written_as_boolean(kind: ExprKind) -> bool {
    match kind {
        ExprKind::True | ExprKind::False | ExprKind::Unary { op: UnOp::Not, .. } => true,
        ExprKind::Binary { op, .. } => matches!(
            op,
            BinOp::Lt
                | BinOp::Le
                | BinOp::Gt
                | BinOp::Ge
                | BinOp::EqEq
                | BinOp::NotEq
                | BinOp::EqEqEq
                | BinOp::NotEqEq
                | BinOp::In
                | BinOp::Instanceof
        ),
        _ => false,
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(super) fn branch_on_logical_operator(
        &mut self,
        left: ValueId,
        operator: LogicalOperator,
        result: Option<LocalVariable>,
        right: BlockId,
        join: BlockId,
    ) {
        let split = match operator {
            LogicalOperator::And | LogicalOperator::Or => self.split_on_truthiness(left),
            LogicalOperator::Nullish => self.split_on_type(left, TypeTable::NULLISH),
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

    // `left ?? ..`, where the lowering itself writes the right side.
    pub(in crate::lower) fn lower_unless_nullish(
        &mut self,
        left: ValueId,
        make: impl FnOnce(&mut Self) -> ValueId,
    ) -> ValueId {
        let result = self.builder.create_variable(None);
        let right = self.create_block();
        let join = self.create_block();
        self.branch_on_logical_operator(left, LogicalOperator::Nullish, Some(result), right, join);
        self.continue_in(right);
        let made = make(self);
        self.builder.write_variable(result, made);
        self.jump(join);
        self.continue_in(join);
        self.builder.read_variable(result)
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

        spine.retain(|&mut (_, _, right)| !decisions.is_dead_expr(right));
        spine.reverse();
        let passes_by_operators = spine.len() > 1
            && std::iter::once(innermost)
                .chain(spine[..spine.len() - 1].iter().map(|&(_, _, right)| right))
                .any(|tested| !is_written_as_boolean(hir[tested].kind));
        let levels: SmallVec<[Level; 4]> = spine
            .iter()
            .map(|&(node, operator, _)| {
                let needs_result = usage == ResultUsage::Value || node != expression;
                Level {
                    operator,
                    result: needs_result.then(|| self.builder.create_variable(None)),
                    rhs: self.create_block(),
                    join: self.create_block(),
                }
            })
            .collect();

        let mut exit_of_chain =
            (!spine.is_empty() && self.file.is_chain_root(innermost)).then(|| self.create_block());
        let mut value = match exit_of_chain {
            Some(exit) => self.lower_expression_in(innermost, Evaluation::in_chain(exit, Tail::No)),
            None => self.lower_expression(innermost),
        };
        for (number, &(node, operator, right)) in spine.iter().enumerate() {
            self.set_position(hir[node].pos);
            let is_outermost = node == expression;
            let Level {
                result, rhs, join, ..
            } = levels[number];
            let (result_at_once, at_once) = match passes_by_operators {
                true => where_left_side_goes_at_once(&levels, number),
                false => (result, join),
            };
            self.branch_on_logical_operator(value, operator, result_at_once, rhs, at_once);
            if let Some(exit) = exit_of_chain.take() {
                self.continue_in(exit);
                match (operator, result_at_once) {
                    (LogicalOperator::And, Some(result)) => {
                        let skipped = self.builder.undefined();
                        self.builder.write_variable(result, skipped);
                        self.jump(at_once);
                    }
                    (LogicalOperator::And, None) => self.jump(at_once),
                    (LogicalOperator::Or | LogicalOperator::Nullish, _) => self.jump(rhs),
                }
            }
            self.continue_in(rhs);
            let right_tail = if is_outermost { tail } else { Tail::No };
            self.lower_arm(right, result, usage, right_tail);
            self.jump(join);
            self.continue_in(join);
            if let Some(result) = result {
                value = self.builder.read_variable(result);
            }
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
            lowering.lower_arm(arm, result, usage, tail);
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
        let in_bun_run = decisions.as_folded_by_bun_run();
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
                self.lower_test_with_known_answer(test, in_bun_run.is_dead_expr(yes));
                current = no;
                continue;
            }
            if decisions.is_dead_expr(no) {
                self.lower_test_with_known_answer(test, in_bun_run.is_dead_expr(no));
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

    fn lower_arm(
        &mut self,
        arm: ExprId,
        result: Option<LocalVariable>,
        usage: ResultUsage,
        tail: Tail<'_>,
    ) {
        match result {
            Some(result) => {
                let value = self.lower_expression_in(arm, Evaluation::at_tail(tail));
                self.builder.write_variable(result, value);
            }
            None => self.lower_for_effect(arm, usage),
        }
    }
}

// `bun build` leaves the left of a comma out of a value that is taken only where it minifies, so a name is read there.
// A name of the top level has no dead zone in what it writes.
fn lower_part_of_comma(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    part: ExprId,
    usage: ResultUsage,
) {
    let file = &*lowering.file;
    let reads_name = usage == ResultUsage::Value
        && file.reads_only_what_bun_run_leaves_out(part, true)
        && !file.reads_only_what_bun_run_leaves_out(part, false);
    match reads_name {
        true => lowering.lower_taken_value_for_effect(part),
        false => lowering.lower_expression_for_effect(part),
    }
}

/// `usage`: of the value of the whole.
pub(super) fn lower_comma_prefix(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    usage: ResultUsage,
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
    lower_part_of_comma(lowering, innermost, usage);
    for &right in earlier.iter().rev() {
        lower_part_of_comma(lowering, right, usage);
    }
    last
}
