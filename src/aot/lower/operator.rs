mod delete;
mod type_of;

use bun_sema::atom::known;
use bun_sema::hir::{BinOp, ExprId, ExprKind, UnOp};
use bun_sema::module_format::main_module_operand;
use smallvec::SmallVec;

use super::FunctionLowering;
use super::expression::find_constant;
use super::member::PropertyName;
use crate::ir::ValueId;

#[derive(Copy, Clone)]
pub(in crate::lower) enum OperatorClass {
    Plain,
    Ordering,
    Equality { is_loose: bool, is_negated: bool },
    In,
    ControlFlow,
}

pub(in crate::lower) fn classify_operator(op: BinOp) -> OperatorClass {
    let equality = |is_loose, is_negated| OperatorClass::Equality {
        is_loose,
        is_negated,
    };
    match op {
        BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge => OperatorClass::Ordering,
        BinOp::EqEq => equality(true, false),
        BinOp::NotEq => equality(true, true),
        BinOp::EqEqEq => equality(false, false),
        BinOp::NotEqEq => equality(false, true),
        BinOp::In => OperatorClass::In,
        BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma => OperatorClass::ControlFlow,
        _ => OperatorClass::Plain,
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
            let value = lowering.lower_unary_operand(expression, operand);
            lowering.builder.to_number(value)
        }
        UnOp::Minus => {
            let value = lowering.lower_unary_operand(expression, operand);
            lowering.builder.negate(value)
        }
        UnOp::BitNot => {
            let value = lowering.lower_unary_operand(expression, operand);
            lowering.builder.bit_not(value)
        }
        UnOp::Not => {
            let value = lowering.lower_unary_operand(expression, operand);
            let boolean = lowering.builder.to_boolean(value);
            lowering.builder.logical_not(boolean)
        }
        UnOp::Typeof => {
            let value = lowering.lower_typeof_operand(operand);
            lowering.set_position(hir[expression].pos);
            lowering.builder.type_of(value)
        }
        UnOp::Void => {
            lowering.lower_expression_for_effect(operand);
            lowering.builder.undefined()
        }
        UnOp::Delete => delete::lower_delete(lowering, operand),
        UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec => {
            debug_assert!(false, "updates are lowered by expression/assignment.rs");
            lowering.lower_expression(operand)
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
                return lowering.lower_main_module_comparison(expression, op);
            }
            if let Some(test) = lowering.try_lower_test_value(expression) {
                return test;
            }
        }
        OperatorClass::In => return lowering.lower_in(expression, left, right),
        OperatorClass::Plain | OperatorClass::Ordering | OperatorClass::ControlFlow => {}
    }
    lowering.lower_binary_spine(expression, op, left, right)
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(in crate::lower) fn emit_binary(
        &mut self,
        op: BinOp,
        left: ValueId,
        right: ValueId,
    ) -> ValueId {
        match op {
            BinOp::Add => self.builder.add(left, right),
            BinOp::Sub => self.builder.sub(left, right),
            BinOp::Mul => self.builder.mul(left, right),
            BinOp::Div => self.builder.div(left, right),
            BinOp::Rem => self.builder.mod_value(left, right),
            BinOp::Pow => self.builder.pow(left, right),
            BinOp::Shl => self.builder.l_shift(left, right),
            BinOp::Shr => self.builder.r_shift(left, right),
            BinOp::UShr => self.builder.ur_shift(left, right),
            BinOp::BitAnd => self.builder.bit_and(left, right),
            BinOp::BitOr => self.builder.bit_or(left, right),
            BinOp::BitXor => self.builder.bit_xor(left, right),
            BinOp::Instanceof => self.builder.instance_of(left, right),
            BinOp::In => self.builder.elem_has(right, left),
            BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma => {
                debug_assert!(
                    false,
                    "the caller evaluates logical operators and the comma"
                );
                right
            }
            _ => {
                let (test, is_negated) = emit_comparison(self, op, left, right);
                if is_negated {
                    self.builder.logical_not(test)
                } else {
                    test
                }
            }
        }
    }

    fn lower_unary_operand(&mut self, expression: ExprId, operand: ExprId) -> ValueId {
        let value = self.lower_expression(operand);
        self.set_position(self.file.hir[expression].pos);
        value
    }

    fn lower_main_module_comparison(&mut self, expression: ExprId, op: BinOp) -> ValueId {
        self.set_position(self.file.hir[expression].pos);
        let meta = self.lower_import_meta();
        let key = self.file.atom_key(known::main);
        let is_main = self.emit_get(meta, PropertyName::Constant(key));
        let OperatorClass::Equality { is_negated, .. } = classify_operator(op) else {
            debug_assert!(false, "the caller passes an equality operator");
            return is_main;
        };
        if !is_negated {
            return is_main;
        }
        let boolean = self.builder.to_boolean(is_main);
        self.builder.logical_not(boolean)
    }

    fn lower_binary_spine(
        &mut self,
        expression: ExprId,
        op: BinOp,
        left: ExprId,
        right: ExprId,
    ) -> ValueId {
        let hir = self.file.hir;
        let mut spine: SmallVec<[(ExprId, BinOp, ExprId); 8]> = SmallVec::new();
        spine.push((expression, op, right));
        let mut innermost = left;
        while let ExprKind::Binary { op, left, right } = hir[innermost].kind {
            let is_spine_operator = match classify_operator(op) {
                OperatorClass::Plain | OperatorClass::Ordering => true,
                OperatorClass::Equality { .. } | OperatorClass::In | OperatorClass::ControlFlow => {
                    false
                }
            };
            if !is_spine_operator
                || self.file.is_statically_resolved(innermost)
                || find_constant(self.file, innermost).is_some()
            {
                break;
            }
            spine.push((innermost, op, right));
            innermost = left;
        }
        let mut value = self.lower_expression(innermost);
        for &(node, node_op, node_right) in spine.iter().rev() {
            let right_value = self.lower_expression(node_right);
            // JSC reports `instanceof`, like `in`, where the right operand starts.
            self.set_position(match node_op {
                BinOp::Instanceof => hir[node_right].pos,
                _ => hir[node].pos,
            });
            value = self.emit_binary(node_op, value, right_value);
        }
        value
    }

    fn lower_in(&mut self, expression: ExprId, left: ExprId, right: ExprId) -> ValueId {
        let hir = self.file.hir;
        if matches!(hir[left].kind, ExprKind::PrivateIdentifier(_)) {
            return self.lower_private_in(expression);
        }
        let name = self.lower_computed_key(left);
        let object = self.lower_expression(right);
        self.set_position(hir[right].pos);
        self.emit_has(object, name)
    }
}

/// The test, and whether the operator asks for its opposite.
pub(in crate::lower) fn emit_comparison(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    op: BinOp,
    left: ValueId,
    right: ValueId,
) -> (ValueId, bool) {
    let builder = &mut lowering.builder;
    match op {
        BinOp::Lt => (builder.less(left, right), false),
        BinOp::Le => (builder.less_eq(left, right), false),
        BinOp::Gt => (builder.greater(left, right), false),
        BinOp::Ge => (builder.greater_eq(left, right), false),
        BinOp::EqEq => (builder.eq(left, right), false),
        BinOp::NotEq => (builder.eq(left, right), true),
        BinOp::EqEqEq => (builder.strict_eq(left, right), false),
        BinOp::NotEqEq => (builder.strict_eq(left, right), true),
        _ => {
            debug_assert!(false, "emit_comparison takes a comparison operator");
            (builder.strict_eq(left, right), false)
        }
    }
}
