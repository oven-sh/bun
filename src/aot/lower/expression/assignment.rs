use bun_sema::atom::Atom;
use bun_sema::fold::Decision;
use bun_sema::hir::{BinOp, ExprFlags, ExprId, ExprKind, IdList, PropId, Span, UnOp};

use super::ResultUsage;
use super::logical::{LogicalBranch, LogicalOperator};
use crate::ir::ValueId;
use crate::lower::member::{KeyConversion, PropertyName};
use crate::lower::{FileLowering, FunctionLowering};

#[derive(Copy, Clone, Debug)]
pub(in crate::lower) enum AssignmentTarget {
    Elision,
    Identifier { identifier: ExprId, name: Atom },
    ArrayPattern(IdList<ExprId>),
    ObjectPattern(Span<PropId>),
    Expression,
}

#[derive(Copy, Clone)]
enum UpdateOperator {
    Increment,
    Decrement,
}

impl FileLowering<'_, '_, '_, '_> {
    pub(in crate::lower) fn classify_assignment_target(&self, target: ExprId) -> AssignmentTarget {
        let hir = self.hir;
        let mut erased = target;
        let mut is_parenthesized = hir.expr_flags(erased).contains(ExprFlags::PARENTHESIZED);
        while let Some(operand) = hir.type_assertion_operand(erased) {
            erased = operand;
            is_parenthesized |= hir.expr_flags(erased).contains(ExprFlags::PARENTHESIZED);
        }
        match hir[erased].kind {
            ExprKind::Missing => AssignmentTarget::Elision,
            ExprKind::Ident(name) => self.classify_identifier_target(erased, name),
            ExprKind::Array(elements) if !is_parenthesized => {
                AssignmentTarget::ArrayPattern(elements)
            }
            ExprKind::Object(properties) if !is_parenthesized => {
                AssignmentTarget::ObjectPattern(properties)
            }
            _ => AssignmentTarget::Expression,
        }
    }

    fn classify_identifier_target(&self, identifier: ExprId, name: Atom) -> AssignmentTarget {
        match self.decisions().decision(identifier) {
            Decision::GlobalPath(&[defined_name]) => AssignmentTarget::Identifier {
                identifier,
                name: defined_name,
            },
            Decision::GlobalPath(_) => AssignmentTarget::Expression,
            Decision::Unknown
            | Decision::Constant(_)
            | Decision::Data(_)
            | Decision::DeferredData => AssignmentTarget::Identifier { identifier, name },
        }
    }

    // JSC reports a plain store to a member at the end of the object, and every other store at the end of the target.
    fn plain_store_position(&self, expression: ExprId, target: ExprId) -> u32 {
        match self.hir.member_key(self.skip_type_syntax(target)) {
            Some((object, _)) => self.last_mapped_position(object),
            None => self.hir[expression].pos,
        }
    }
}

pub(super) fn lower_assignment(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    usage: ResultUsage,
) -> ValueId {
    let ExprKind::Assign { op, target, value } = lowering.file.hir[expression].kind else {
        unreachable!("lower_assignment takes an Assign expression");
    };
    match op {
        None => lowering.lower_plain_assignment(expression, target, value),
        Some(BinOp::And) => {
            lower_logical_assignment(lowering, expression, LogicalOperator::And, usage)
        }
        Some(BinOp::Or) => {
            lower_logical_assignment(lowering, expression, LogicalOperator::Or, usage)
        }
        Some(BinOp::Nullish) => {
            lower_logical_assignment(lowering, expression, LogicalOperator::Nullish, usage)
        }
        Some(
            op @ (BinOp::Add
            | BinOp::Sub
            | BinOp::Mul
            | BinOp::Div
            | BinOp::Rem
            | BinOp::Pow
            | BinOp::Shl
            | BinOp::Shr
            | BinOp::UShr
            | BinOp::BitAnd
            | BinOp::BitOr
            | BinOp::BitXor),
        ) => lowering.lower_compound_assignment(expression, target, value, op),
        Some(
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
            | BinOp::Comma,
        ) => {
            debug_assert!(false, "not an assignment operator");
            lowering.lower_plain_assignment(expression, target, value)
        }
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    fn lower_plain_assignment(
        &mut self,
        expression: ExprId,
        target: ExprId,
        value: ExprId,
    ) -> ValueId {
        match self.file.classify_assignment_target(target) {
            AssignmentTarget::ArrayPattern(_) | AssignmentTarget::ObjectPattern(_) => {
                let assigned = self.lower_expression(value);
                self.assign_pattern(target, assigned, Some(value));
                assigned
            }
            _ => {
                let reference = self.lower_reference(target, KeyConversion::AtAccess);
                let assigned = self.lower_assigned_value(target, value);
                self.set_position(self.file.plain_store_position(expression, target));
                self.put_reference(&reference, assigned, Some(value))
            }
        }
    }

    fn lower_compound_assignment(
        &mut self,
        expression: ExprId,
        target: ExprId,
        value: ExprId,
        op: BinOp,
    ) -> ValueId {
        let reference = self.lower_reference(target, KeyConversion::Once);
        let old = self.get_reference(&reference);
        let old = self.convert_through_assertions(target, old);
        let right = self.lower_expression(value);
        self.set_position(self.file.hir[expression].pos);
        let updated = self.emit_binary(op, old, right);
        self.set_position(self.file.last_mapped_position(target));
        self.put_reference(&reference, updated, Some(expression))
    }

    fn lower_assigned_value(&mut self, target: ExprId, value: ExprId) -> ValueId {
        match self.file.classify_assignment_target(target) {
            AssignmentTarget::Identifier { identifier, name } => {
                let binding = self.file.bound.binding(identifier);
                let key = self.file.function_name_key(binding, name);
                self.lower_named_evaluation(value, PropertyName::Constant(key))
            }
            _ => self.lower_expression(value),
        }
    }

    fn emit_update(&mut self, update: UpdateOperator, operand: ValueId) -> ValueId {
        match update {
            UpdateOperator::Increment => self.builder.increment(operand),
            UpdateOperator::Decrement => self.builder.decrement(operand),
        }
    }
}

fn lower_logical_assignment(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    operator: LogicalOperator,
    usage: ResultUsage,
) -> ValueId {
    let hir = lowering.file.hir;
    let ExprKind::Assign { target, value, .. } = hir[expression].kind else {
        unreachable!("lower_logical_assignment takes an Assign expression");
    };
    let reference = lowering.lower_reference(target, KeyConversion::Once);
    let old = lowering.get_reference(&reference);
    let result = match usage {
        ResultUsage::Value => Some(lowering.builder.create_variable(None)),
        ResultUsage::Effect => None,
    };
    let assign = lowering.create_block();
    let join = lowering.create_block();
    lowering.set_position(hir[expression].pos);
    let branch = LogicalBranch {
        operator,
        tested: Some(target),
        result,
        right: assign,
        join,
    };
    lowering.branch_on_logical_operator(old, branch);

    lowering.continue_in(assign);
    let assigned = lowering.lower_assigned_value(target, value);
    lowering.set_position(lowering.file.last_mapped_position(target));
    let stored = lowering.put_reference(&reference, assigned, Some(value));
    if let Some(result) = result {
        lowering.builder.write_variable(result, stored);
    }
    lowering.jump(join);

    lowering.continue_in(join);
    match result {
        Some(result) => lowering.builder.read_variable(result),
        None => old,
    }
}

pub(super) fn lower_update(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    usage: ResultUsage,
) -> ValueId {
    let hir = lowering.file.hir;
    let ExprKind::Unary { op, operand } = hir[expression].kind else {
        unreachable!("lower_update takes a Unary expression");
    };
    let reference = lowering.lower_reference(operand, KeyConversion::Once);
    let old = lowering.get_reference(&reference);
    let (update, is_postfix) = match op {
        UnOp::PreInc => (UpdateOperator::Increment, false),
        UnOp::PreDec => (UpdateOperator::Decrement, false),
        UnOp::PostInc => (UpdateOperator::Increment, true),
        UnOp::PostDec => (UpdateOperator::Decrement, true),
        _ => {
            debug_assert!(false, "not an update operator");
            return old;
        }
    };
    lowering.set_position(hir[expression].pos);
    let store_position = match is_postfix {
        true => lowering.file.last_mapped_position(operand),
        false => hir[operand].pos,
    };
    if is_postfix && usage == ResultUsage::Value {
        let numeric = lowering.builder.to_numeric(old);
        let updated = lowering.emit_update(update, numeric);
        lowering.set_position(store_position);
        lowering.put_reference(&reference, updated, Some(expression));
        numeric
    } else {
        let updated = lowering.emit_update(update, old);
        lowering.set_position(store_position);
        lowering.put_reference(&reference, updated, Some(expression))
    }
}
