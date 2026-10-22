use bun_sema::atom::Atom;
use bun_sema::fold::Decision;
use bun_sema::hir::{BinOp, ExprFlags, ExprId, ExprKind, IdList, PropId, Span, UnOp};

use super::logical::{LogicalBranch, LogicalOperator, branch_on_logical_operator};
use super::{
    ResultUsage, convert_through_assertions, lower_expression, lower_named_evaluation,
    skip_type_syntax,
};
use crate::ir::ValueId;
use crate::lower::member::{self, KeyConversion, PropertyName};
use crate::lower::{FileLowering, FunctionLowering, call, operator, pattern};

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

pub(in crate::lower) fn classify_assignment_target(
    file: &FileLowering<'_, '_, '_, '_>,
    target: ExprId,
) -> AssignmentTarget {
    let hir = file.hir;
    let mut erased = target;
    let mut is_parenthesized = hir.expr_flags(erased).contains(ExprFlags::PARENTHESIZED);
    while let Some(operand) = hir.type_assertion_operand(erased) {
        erased = operand;
        is_parenthesized |= hir.expr_flags(erased).contains(ExprFlags::PARENTHESIZED);
    }
    match hir[erased].kind {
        ExprKind::Missing => AssignmentTarget::Elision,
        ExprKind::Ident(name) => classify_identifier_target(file, erased, name),
        ExprKind::Array(elements) if !is_parenthesized => AssignmentTarget::ArrayPattern(elements),
        ExprKind::Object(properties) if !is_parenthesized => {
            AssignmentTarget::ObjectPattern(properties)
        }
        ExprKind::Array(_)
        | ExprKind::Object(_)
        | ExprKind::PrivateIdentifier(_)
        | ExprKind::This
        | ExprKind::Super
        | ExprKind::Null
        | ExprKind::True
        | ExprKind::False
        | ExprKind::Number(_)
        | ExprKind::String(_)
        | ExprKind::BigInt(_)
        | ExprKind::Regex { .. }
        | ExprKind::Template { .. }
        | ExprKind::TaggedTemplate(_)
        | ExprKind::Fn(_)
        | ExprKind::Class(_)
        | ExprKind::Dot { .. }
        | ExprKind::Index { .. }
        | ExprKind::Call(_)
        | ExprKind::New(_)
        | ExprKind::Unary { .. }
        | ExprKind::Binary { .. }
        | ExprKind::Assign { .. }
        | ExprKind::Cond { .. }
        | ExprKind::Spread(_)
        | ExprKind::Await(_)
        | ExprKind::Yield { .. }
        | ExprKind::As { .. }
        | ExprKind::Satisfies { .. }
        | ExprKind::AsConst(_)
        | ExprKind::NonNull(_)
        | ExprKind::Instantiation { .. }
        | ExprKind::Jsx(_)
        | ExprKind::ImportCall { .. }
        | ExprKind::ImportMeta
        | ExprKind::NewTarget(_)
        | ExprKind::JsxText(_) => AssignmentTarget::Expression,
    }
}

fn classify_identifier_target(
    file: &FileLowering<'_, '_, '_, '_>,
    identifier: ExprId,
    name: Atom,
) -> AssignmentTarget {
    match file.decisions().decision(identifier) {
        Decision::GlobalPath(&[defined_name]) => AssignmentTarget::Identifier {
            identifier,
            name: defined_name,
        },
        Decision::GlobalPath(_) => AssignmentTarget::Expression,
        Decision::Unknown | Decision::Constant(_) | Decision::Data(_) | Decision::DeferredData => {
            AssignmentTarget::Identifier { identifier, name }
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
        None => lower_plain_assignment(lowering, expression, target, value),
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
        ) => lower_compound_assignment(lowering, expression, target, value, op),
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
            lower_plain_assignment(lowering, expression, target, value)
        }
    }
}

fn lower_plain_assignment(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    target: ExprId,
    value: ExprId,
) -> ValueId {
    match classify_assignment_target(lowering.file, target) {
        AssignmentTarget::ArrayPattern(_) | AssignmentTarget::ObjectPattern(_) => {
            let assigned = lower_expression(lowering, value);
            pattern::assign_pattern(lowering, target, assigned, Some(value));
            assigned
        }
        AssignmentTarget::Elision
        | AssignmentTarget::Identifier { .. }
        | AssignmentTarget::Expression => {
            let reference = member::lower_reference(lowering, target, KeyConversion::AtAccess);
            let assigned = lower_assigned_value(lowering, target, value);
            lowering.set_position(plain_store_position(lowering.file, expression, target));
            member::put_reference(lowering, &reference, assigned, Some(value))
        }
    }
}

// JSC reports a plain store to a member at the end of the object, and every other store at the end of the target.
fn plain_store_position(
    file: &FileLowering<'_, '_, '_, '_>,
    expression: ExprId,
    target: ExprId,
) -> u32 {
    match file.hir.member_key(skip_type_syntax(file, target)) {
        Some((object, _)) => call::last_mapped_position(file, object),
        None => file.hir[expression].pos,
    }
}

fn lower_compound_assignment(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    target: ExprId,
    value: ExprId,
    op: BinOp,
) -> ValueId {
    let reference = member::lower_reference(lowering, target, KeyConversion::Once);
    let old = member::get_reference(lowering, &reference);
    let old = convert_through_assertions(lowering, target, old);
    let right = lower_expression(lowering, value);
    lowering.set_position(lowering.file.hir[expression].pos);
    let updated = operator::emit_binary(lowering, op, old, right);
    lowering.set_position(call::last_mapped_position(lowering.file, target));
    member::put_reference(lowering, &reference, updated, Some(expression))
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
    let reference = member::lower_reference(lowering, target, KeyConversion::Once);
    let old = member::get_reference(lowering, &reference);
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
    branch_on_logical_operator(lowering, old, branch);

    lowering.continue_in(assign);
    let assigned = lower_assigned_value(lowering, target, value);
    lowering.set_position(call::last_mapped_position(lowering.file, target));
    let stored = member::put_reference(lowering, &reference, assigned, Some(value));
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

fn lower_assigned_value(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    target: ExprId,
    value: ExprId,
) -> ValueId {
    match classify_assignment_target(lowering.file, target) {
        AssignmentTarget::Identifier { name, .. } => {
            let key = member::name_key(lowering.file, name);
            lower_named_evaluation(lowering, value, PropertyName::Constant(key))
        }
        AssignmentTarget::Elision
        | AssignmentTarget::ArrayPattern(_)
        | AssignmentTarget::ObjectPattern(_)
        | AssignmentTarget::Expression => lower_expression(lowering, value),
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
    let reference = member::lower_reference(lowering, operand, KeyConversion::Once);
    let old = member::get_reference(lowering, &reference);
    let (update, is_postfix) = match op {
        UnOp::PreInc => (UpdateOperator::Increment, false),
        UnOp::PreDec => (UpdateOperator::Decrement, false),
        UnOp::PostInc => (UpdateOperator::Increment, true),
        UnOp::PostDec => (UpdateOperator::Decrement, true),
        UnOp::Plus
        | UnOp::Minus
        | UnOp::BitNot
        | UnOp::Not
        | UnOp::Typeof
        | UnOp::Void
        | UnOp::Delete => {
            debug_assert!(false, "not an update operator");
            return old;
        }
    };
    lowering.set_position(hir[expression].pos);
    let store_position = match is_postfix {
        true => call::last_mapped_position(lowering.file, operand),
        false => hir[operand].pos,
    };
    if is_postfix && usage == ResultUsage::Value {
        let numeric = lowering.builder.to_numeric(old);
        let updated = emit_update(lowering, update, numeric);
        lowering.set_position(store_position);
        member::put_reference(lowering, &reference, updated, Some(expression));
        numeric
    } else {
        let updated = emit_update(lowering, update, old);
        lowering.set_position(store_position);
        member::put_reference(lowering, &reference, updated, Some(expression))
    }
}

fn emit_update(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    update: UpdateOperator,
    operand: ValueId,
) -> ValueId {
    match update {
        UpdateOperator::Increment => lowering.builder.increment(operand),
        UpdateOperator::Decrement => lowering.builder.decrement(operand),
    }
}
