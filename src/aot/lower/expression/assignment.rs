use bun_sema::atom::Atom;
use bun_sema::bind::Binding;
use bun_sema::fold::Decision;
use bun_sema::hir::{BinOp, ExprFlags, ExprId, ExprKind, IdList, PropId, Span, UnOp};

use super::ResultUsage;
use super::logical::LogicalOperator;
use crate::ir::ValueId;
use crate::lower::member::KeyConversion;
use crate::lower::scope::BindingForm;
use crate::lower::{FileLowering, FunctionLowering};

#[derive(Copy, Clone, Debug)]
pub(in crate::lower) enum AssignmentTarget {
    Elision,
    Identifier { identifier: ExprId, name: Atom },
    ArrayPattern(IdList<ExprId>),
    ObjectPattern(Span<PropId>),
    Expression,
}

impl FileLowering<'_, '_, '_, '_> {
    pub(in crate::lower) fn names_assigned_function(&self, target: ExprId) -> bool {
        self.find_assigned_function_name(target).is_some()
    }

    // `(a) = function () {}` names nothing. Nor does `a = function () {}` where a namespace exports `a`: it is the store `N.a = function () {}`.
    fn find_assigned_function_name(&self, target: ExprId) -> Option<(Binding, Atom)> {
        if self
            .hir
            .expr_flags(target)
            .contains(ExprFlags::PARENTHESIZED)
        {
            return None;
        }
        let AssignmentTarget::Identifier { identifier, name } =
            self.classify_assignment_target(target)
        else {
            return None;
        };
        let binding = self.bound.binding(identifier);
        let is_container_member = match binding {
            Binding::Symbol(symbol) => {
                matches!(
                    self.scopes.form(symbol),
                    BindingForm::ContainerMember { .. }
                )
            }
            Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => false,
        };
        (!is_container_member).then_some((binding, name))
    }

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
        None => lowering.lower_plain_assignment(target, value),
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
        ) => {
            let reference = lowering.lower_reference(target, KeyConversion::Once);
            let old = lowering.get_reference(&reference);
            let old = lowering.convert_through_assertions(target, old);
            let right = lowering.lower_expression(value);
            let updated = lowering.emit_binary(op, old, right);
            lowering.set_position(lowering.file.hir[target].pos);
            lowering.put_reference(&reference, updated, Some(expression))
        }
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
            lowering.lower_plain_assignment(target, value)
        }
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    fn lower_plain_assignment(&mut self, target: ExprId, value: ExprId) -> ValueId {
        match self.file.classify_assignment_target(target) {
            AssignmentTarget::ArrayPattern(_) | AssignmentTarget::ObjectPattern(_) => {
                let assigned = self.lower_expression(value);
                self.assign_pattern(target, assigned, Some(value));
                assigned
            }
            _ => {
                let reference = self.lower_reference(target, KeyConversion::AtAccess);
                let assigned = self.lower_assigned_value(target, value);
                self.set_position(self.file.hir[target].pos);
                self.put_reference(&reference, assigned, Some(value))
            }
        }
    }

    fn lower_assigned_value(&mut self, target: ExprId, value: ExprId) -> ValueId {
        match self.file.find_assigned_function_name(target) {
            Some((binding, name)) => {
                let name = self.file.name_given_by_binding(binding, name);
                self.lower_named_evaluation(value, name)
            }
            None => self.lower_expression(value),
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
    let result = (usage == ResultUsage::Value).then(|| lowering.builder.create_variable(None));
    let assign = lowering.create_block();
    let join = lowering.create_block();
    lowering.set_position(hir[expression].pos);
    lowering.branch_on_logical_operator(old, operator, result, assign, join);

    lowering.continue_in(assign);
    let assigned = lowering.lower_assigned_value(target, value);
    lowering.set_position(hir[target].pos);
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
    let old = lowering.convert_through_assertions(operand, old);
    let (is_increment, is_postfix) = match op {
        UnOp::PreInc => (true, false),
        UnOp::PreDec => (false, false),
        UnOp::PostInc => (true, true),
        UnOp::PostDec => (false, true),
        _ => {
            debug_assert!(false, "not an update operator");
            return old;
        }
    };
    let is_old_kept = is_postfix && usage == ResultUsage::Value;
    let old = match is_old_kept {
        true => lowering.builder.to_numeric(old),
        false => old,
    };
    let updated = match is_increment {
        true => lowering.builder.increment(old),
        false => lowering.builder.decrement(old),
    };
    let stored = lowering.put_reference(&reference, updated, Some(expression));
    if is_old_kept { old } else { stored }
}
