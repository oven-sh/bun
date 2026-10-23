mod delete;
mod type_of;

use bun_sema::atom::known;
use bun_sema::hir::{BinOp, ExprId, ExprKind, UnOp};
use bun_sema::module_format::main_module_operand;
use smallvec::SmallVec;

use super::expression::{
    find_constant, is_statically_resolved, lower_expression, lower_expression_for_effect,
};
use super::member::{self, PropertyName};
use super::{FileLowering, FunctionLowering, condition, module, private_names};
use crate::ir::ValueId;

pub(in crate::lower) use self::type_of::lower_typeof_operand;

#[derive(Copy, Clone, Debug)]
pub(in crate::lower) struct Comparison {
    pub(in crate::lower) test: ValueId,
    pub(in crate::lower) is_negated: bool,
}

#[derive(Copy, Clone)]
enum OperatorClass {
    Plain,
    Ordering,
    Equality { is_negated: bool },
    In,
    ControlFlow,
}

fn classify_operator(op: BinOp) -> OperatorClass {
    match op {
        BinOp::Add
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
        | BinOp::BitXor
        | BinOp::Instanceof => OperatorClass::Plain,
        BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge => OperatorClass::Ordering,
        BinOp::EqEq | BinOp::EqEqEq => OperatorClass::Equality { is_negated: false },
        BinOp::NotEq | BinOp::NotEqEq => OperatorClass::Equality { is_negated: true },
        BinOp::In => OperatorClass::In,
        BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma => OperatorClass::ControlFlow,
    }
}

pub(in crate::lower) fn lower_unary(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
) -> ValueId {
    let hir = lowering.file.hir;
    let ExprKind::Unary { op, operand } = hir[expression].kind else {
        debug_assert!(false, "lower_unary takes a unary expression");
        return lowering.builder.undefined();
    };
    match op {
        UnOp::Plus => {
            let value = lower_unary_operand(lowering, expression, operand);
            lowering.builder.to_number(value)
        }
        UnOp::Minus => {
            let value = lower_unary_operand(lowering, expression, operand);
            lowering.builder.negate(value)
        }
        UnOp::BitNot => {
            let value = lower_unary_operand(lowering, expression, operand);
            lowering.builder.bit_not(value)
        }
        UnOp::Not => {
            let value = lower_unary_operand(lowering, expression, operand);
            let boolean = lowering.builder.to_boolean(value);
            lowering.builder.logical_not(boolean)
        }
        UnOp::Typeof => {
            let value = lower_typeof_operand(lowering, operand);
            lowering.set_position(hir[expression].pos);
            lowering.builder.type_of(value)
        }
        UnOp::Void => {
            lower_expression_for_effect(lowering, operand);
            lowering.builder.undefined()
        }
        UnOp::Delete => delete::lower_delete(lowering, operand),
        UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec => {
            debug_assert!(false, "updates are lowered by expression/assignment.rs");
            lower_expression(lowering, operand)
        }
    }
}

pub(in crate::lower) fn lower_binary(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
) -> ValueId {
    let ExprKind::Binary { op, left, right } = lowering.file.hir[expression].kind else {
        debug_assert!(false, "lower_binary takes a binary expression");
        return lowering.builder.undefined();
    };
    match classify_operator(op) {
        OperatorClass::Equality { .. } => {
            if main_module_operand(lowering.file.hir, lowering.file.bound, expression).is_some() {
                return lower_main_module_comparison(lowering, expression, op);
            }
            if let Some(test) = condition::try_lower_test_value(lowering, expression) {
                return test;
            }
        }
        OperatorClass::In => return lower_in(lowering, expression, left, right),
        OperatorClass::Plain | OperatorClass::Ordering | OperatorClass::ControlFlow => {}
    }
    lower_binary_spine(lowering, expression, op, left, right)
}

pub(in crate::lower) fn emit_binary(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    op: BinOp,
    left: ValueId,
    right: ValueId,
) -> ValueId {
    match op {
        BinOp::Add => lowering.builder.add(left, right),
        BinOp::Sub => lowering.builder.sub(left, right),
        BinOp::Mul => lowering.builder.mul(left, right),
        BinOp::Div => lowering.builder.div(left, right),
        BinOp::Rem => lowering.builder.mod_value(left, right),
        BinOp::Pow => lowering.builder.pow(left, right),
        BinOp::Shl => lowering.builder.l_shift(left, right),
        BinOp::Shr => lowering.builder.r_shift(left, right),
        BinOp::UShr => lowering.builder.ur_shift(left, right),
        BinOp::BitAnd => lowering.builder.bit_and(left, right),
        BinOp::BitOr => lowering.builder.bit_or(left, right),
        BinOp::BitXor => lowering.builder.bit_xor(left, right),
        BinOp::Instanceof => lowering.builder.instance_of(left, right),
        BinOp::In => lowering.builder.elem_has(right, left),
        BinOp::Lt
        | BinOp::Le
        | BinOp::Gt
        | BinOp::Ge
        | BinOp::EqEq
        | BinOp::NotEq
        | BinOp::EqEqEq
        | BinOp::NotEqEq => {
            let comparison = emit_comparison(lowering, op, left, right);
            if comparison.is_negated {
                lowering.builder.logical_not(comparison.test)
            } else {
                comparison.test
            }
        }
        BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma => {
            debug_assert!(
                false,
                "the caller evaluates logical operators and the comma"
            );
            right
        }
    }
}

pub(in crate::lower) fn is_comparison(op: BinOp) -> bool {
    match classify_operator(op) {
        OperatorClass::Ordering | OperatorClass::Equality { .. } => true,
        OperatorClass::Plain | OperatorClass::In | OperatorClass::ControlFlow => false,
    }
}

pub(in crate::lower) fn emit_comparison(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    op: BinOp,
    left: ValueId,
    right: ValueId,
) -> Comparison {
    let builder = &mut lowering.builder;
    let test = match op {
        BinOp::Lt => builder.less(left, right),
        BinOp::Le => builder.less_eq(left, right),
        BinOp::Gt => builder.greater(left, right),
        BinOp::Ge => builder.greater_eq(left, right),
        BinOp::EqEq | BinOp::NotEq => builder.eq(left, right),
        BinOp::EqEqEq | BinOp::NotEqEq => builder.strict_eq(left, right),
        BinOp::Add
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
        | BinOp::BitXor
        | BinOp::In
        | BinOp::Instanceof
        | BinOp::And
        | BinOp::Or
        | BinOp::Nullish
        | BinOp::Comma => {
            debug_assert!(false, "emit_comparison takes a comparison operator");
            builder.strict_eq(left, right)
        }
    };
    let is_negated = match classify_operator(op) {
        OperatorClass::Equality { is_negated } => is_negated,
        OperatorClass::Plain
        | OperatorClass::Ordering
        | OperatorClass::In
        | OperatorClass::ControlFlow => false,
    };
    Comparison { test, is_negated }
}

fn lower_unary_operand(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    operand: ExprId,
) -> ValueId {
    let value = lower_expression(lowering, operand);
    lowering.set_position(lowering.file.hir[expression].pos);
    value
}

fn lower_main_module_comparison(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    op: BinOp,
) -> ValueId {
    lowering.set_position(lowering.file.hir[expression].pos);
    let meta = module::lower_import_meta(lowering);
    let key = lowering.file.atom_key(known::main);
    let is_main = member::emit_get(lowering, meta, PropertyName::Constant(key));
    match classify_operator(op) {
        OperatorClass::Equality { is_negated: false } => is_main,
        OperatorClass::Equality { is_negated: true } => {
            let boolean = lowering.builder.to_boolean(is_main);
            lowering.builder.logical_not(boolean)
        }
        OperatorClass::Plain
        | OperatorClass::Ordering
        | OperatorClass::In
        | OperatorClass::ControlFlow => {
            debug_assert!(false, "the caller passes an equality operator");
            is_main
        }
    }
}

fn lower_binary_spine(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    op: BinOp,
    left: ExprId,
    right: ExprId,
) -> ValueId {
    let hir = lowering.file.hir;
    let mut spine: SmallVec<[(ExprId, BinOp, ExprId); 8]> = SmallVec::new();
    spine.push((expression, op, right));
    let mut innermost = left;
    while let Some((inner_op, inner_left, inner_right)) =
        find_spine_operands(lowering.file, innermost)
    {
        spine.push((innermost, inner_op, inner_right));
        innermost = inner_left;
    }
    let mut value = lower_expression(lowering, innermost);
    for &(node, node_op, node_right) in spine.iter().rev() {
        let right_value = lower_expression(lowering, node_right);
        // JSC reports `instanceof`, like `in`, where the right operand starts.
        lowering.set_position(match node_op {
            BinOp::Instanceof => hir[node_right].pos,
            _ => hir[node].pos,
        });
        value = emit_binary(lowering, node_op, value, right_value);
    }
    value
}

fn find_spine_operands(
    file: &FileLowering<'_, '_, '_, '_>,
    expression: ExprId,
) -> Option<(BinOp, ExprId, ExprId)> {
    let ExprKind::Binary { op, left, right } = file.hir[expression].kind else {
        return None;
    };
    let is_spine_operator = match classify_operator(op) {
        OperatorClass::Plain | OperatorClass::Ordering => true,
        OperatorClass::Equality { .. } | OperatorClass::In | OperatorClass::ControlFlow => false,
    };
    let is_spine_node = is_spine_operator
        && !is_statically_resolved(file, expression)
        && find_constant(file, expression).is_none();
    is_spine_node.then_some((op, left, right))
}

fn lower_in(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    left: ExprId,
    right: ExprId,
) -> ValueId {
    let hir = lowering.file.hir;
    if matches!(hir[left].kind, ExprKind::PrivateIdentifier(_)) {
        return private_names::lower_private_in(lowering, expression);
    }
    let name = member::lower_computed_key(lowering, left);
    let object = lower_expression(lowering, right);
    lowering.set_position(hir[right].pos);
    member::emit_has(lowering, object, name)
}
