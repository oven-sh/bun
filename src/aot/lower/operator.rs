mod concatenation;
mod delete;
mod type_of;

use bun_sema::atom::known;
use bun_sema::bind::Parent;
use bun_sema::fold::FoldedValue;
use bun_sema::hir::{BinOp, ExprId, ExprKind, IdList, StmtId, StmtKind, UnOp, is_parenthesized};
use bun_sema::module_format::main_module_operand;
use smallvec::{SmallVec, smallvec};

pub(in crate::lower) use self::concatenation::PrintedOperand;
use self::concatenation::SumOperator;
use super::FunctionLowering;
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

fn get_precedence(op: BinOp) -> u8 {
    match op {
        BinOp::Comma => 0,
        BinOp::Nullish => 1,
        BinOp::Or => 2,
        BinOp::And => 3,
        BinOp::BitOr => 4,
        BinOp::BitXor => 5,
        BinOp::BitAnd => 6,
        BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq => 7,
        BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge | BinOp::In | BinOp::Instanceof => 8,
        BinOp::Shl | BinOp::Shr | BinOp::UShr => 9,
        BinOp::Add | BinOp::Sub => 10,
        BinOp::Mul | BinOp::Div | BinOp::Rem => 11,
        BinOp::Pow => 12,
    }
}

pub(in crate::lower) fn needs_parentheses(
    outer: BinOp,
    inner: BinOp,
    is_left_operand: bool,
) -> bool {
    let is_and_or = |op| matches!(op, BinOp::And | BinOp::Or);
    if (outer == BinOp::Nullish && is_and_or(inner))
        || (inner == BinOp::Nullish && is_and_or(outer))
    {
        return true;
    }
    match is_left_operand == (outer != BinOp::Pow) {
        true => get_precedence(inner) < get_precedence(outer),
        false => get_precedence(inner) <= get_precedence(outer),
    }
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
            BinOp::Instanceof => self.builder.instance_of(left, right, None),
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
        let position = self.file.hir[expression].pos;
        self.set_position(position);
        self.builder.record_position(position);
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

    // The binary expression that has `expression` as an operand, if Bun's transpiler prints the operand without parentheses.
    fn find_operator_around(&self, expression: ExprId) -> Option<ExprId> {
        let hir = self.file.hir;
        let ExprKind::Binary { op: inner, .. } = hir[expression].kind else {
            return None;
        };
        if self.file.runs_as_written() {
            return match self.file.bound.parent_of_expr(expression) {
                Parent::Expr(parent) if !is_parenthesized(hir, expression) => {
                    let is_operator = matches!(hir[parent].kind, ExprKind::Binary { op, .. } if op != BinOp::Comma);
                    is_operator.then_some(parent)
                }
                _ => None,
            };
        }
        let mut operand = expression;
        while let Parent::Expr(parent) = self.file.bound.parent_of_expr(operand) {
            match hir[parent].kind {
                ExprKind::Binary {
                    op: BinOp::Comma, ..
                } => {
                    if self.file.find_operand_printed_alone(parent) != Some(operand) {
                        return None;
                    }
                    operand = parent;
                }
                ExprKind::Binary { op, .. } => {
                    let is_left_operand = self.file.printed_operands(parent).0 == operand;
                    return (!needs_parentheses(op, inner, is_left_operand)).then_some(parent);
                }
                _ if hir.type_assertion_operand(parent).is_some() => operand = parent,
                _ => return None,
            }
        }
        None
    }

    // `(a + b) * c`, `(a + b).x * c`: the first token that Bun's transpiler prints is a parenthesis, which its source map does not know.
    fn is_printed_in_parentheses_first(&self, expression: ExprId) -> bool {
        let hir = self.file.hir;
        if self.file.runs_as_written() {
            return false;
        }
        let mut first = expression;
        loop {
            let (next, outer) = match hir[first].kind {
                ExprKind::Binary { op, .. } => (self.file.printed_operands(first).0, Some(op)),
                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => (obj, None),
                ExprKind::Call(site) => (hir[site].callee, None),
                _ => return false,
            };
            let next = self.file.skip_unprinted_syntax(next);
            if self.file.is_literal_operand(next) {
                return false;
            }
            match (hir[next].kind, outer) {
                (ExprKind::Binary { op: inner, .. }, Some(outer)) => {
                    if inner == BinOp::Comma || needs_parentheses(outer, inner, true) {
                        return true;
                    }
                }
                (ExprKind::Binary { .. }, None)
                | (ExprKind::Cond { .. } | ExprKind::Assign { .. }, _) => return true,
                _ => {}
            }
            first = next;
        }
    }

    // The operand, argument or element that stands in front of `expression` in a list whose members stand in the order of the text.
    fn find_member_in_front_of(
        &self,
        members: IdList<ExprId>,
        expression: ExprId,
    ) -> Option<ExprId> {
        let hir = self.file.hir;
        let members = &hir.ids[members.range()];
        let position = hir[expression].pos;
        let index = members.partition_point(|&member| hir[ExprId::from(member)].pos < position);
        let is_found = members
            .get(index)
            .is_some_and(|&member| ExprId::from(member) == expression);
        (is_found && index > 0).then(|| ExprId::from(members[index - 1]))
    }

    // The last position that the source map knows in front of an expression.
    fn find_position_in_front_of(&self, expression: ExprId) -> Option<u32> {
        let hir = self.file.hir;
        let file = &*self.file;
        let mut first = expression;
        loop {
            let parent = match file.bound.parent_of_expr(first) {
                Parent::Stmt(statement) => {
                    return match hir[statement].kind {
                        StmtKind::Return(_)
                        | StmtKind::Throw(_)
                        | StmtKind::If { .. }
                        | StmtKind::While { .. }
                        | StmtKind::Switch { .. } => Some(hir[statement].start),
                        StmtKind::Expr(_) => self.find_brace_in_front_of(statement),
                        _ => None,
                    };
                }
                Parent::FnBody(function) => return Some(file.parameters_position(function)),
                Parent::VarInit(declaration) => {
                    let position = file.find_return_printed_with(declaration);
                    return Some(position.unwrap_or(hir[hir[declaration].pat].pos));
                }
                Parent::Prop(property) => return Some(hir[property].pos),
                Parent::Expr(parent) => parent,
                _ => return None,
            };
            match hir[parent].kind {
                ExprKind::Assign { target, value, .. } if value == first => {
                    return Some(file.last_mapped_position(target));
                }
                ExprKind::Binary { .. } => {
                    let printed_left = file.printed_operands(parent).0;
                    let is_dropped = file.find_operand_printed_alone(parent).is_some();
                    if printed_left != first && !is_dropped {
                        return Some(file.last_mapped_position(printed_left));
                    }
                }
                ExprKind::Call(site) | ExprKind::New(site) if hir[site].callee != first => {
                    let before = self.find_member_in_front_of(hir[site].args, first);
                    return Some(file.last_mapped_position(before.unwrap_or(hir[site].callee)));
                }
                ExprKind::Array(elements) => {
                    return Some(match self.find_member_in_front_of(elements, first) {
                        Some(before) => file.last_mapped_position(before),
                        None => hir[parent].pos,
                    });
                }
                ExprKind::Template { exprs } => {
                    return Some(match self.find_member_in_front_of(exprs, first) {
                        Some(before) => file.last_mapped_position(before),
                        None => hir[parent].pos,
                    });
                }
                // Bun's transpiler drops a `void` whose value nobody uses.
                ExprKind::Unary { op: UnOp::Void, .. }
                    if matches!(file.bound.parent_of_expr(parent), Parent::Stmt(_)) => {}
                ExprKind::Unary {
                    op:
                        UnOp::Void | UnOp::Plus | UnOp::Minus | UnOp::BitNot | UnOp::Not | UnOp::Typeof,
                    ..
                } => return Some(hir[parent].pos),
                _ if hir.type_assertion_operand(parent).is_some() => {}
                _ => return None,
            }
            first = parent;
        }
    }

    // The `{` of a function's body, if the statement is the first one there.
    fn find_brace_in_front_of(&self, statement: StmtId) -> Option<u32> {
        let hir = self.file.hir;
        let Parent::FnBody(_) = self.file.bound.parent_of_stmt(statement) else {
            return None;
        };
        let text: &[u8] = &hir.text;
        let text_in_front = text.get(..hir[statement].start as usize)?;
        let last = text_in_front
            .iter()
            .rposition(|byte| !byte.is_ascii_whitespace())?;
        (text_in_front[last] == b'{').then_some(last as u32)
    }

    // JSC's parser gives all operators of an expression the position of its first token, up to the next parentheses.
    fn find_operator_position(&mut self, expression: ExprId) -> u32 {
        let mut operands: SmallVec<[ExprId; 8]> = SmallVec::new();
        let mut outermost = expression;
        let position = loop {
            if let Some(&position) = self.operator_positions.get(&outermost) {
                break position;
            }
            match self.find_operator_around(outermost) {
                Some(parent) => {
                    operands.push(parent);
                    outermost = parent;
                }
                None => {
                    let before = match self.is_printed_in_parentheses_first(outermost) {
                        true => self.find_position_in_front_of(outermost),
                        false => None,
                    };
                    break before.unwrap_or_else(|| self.file.first_position(outermost));
                }
            }
        };
        for operand in operands {
            self.operator_positions.insert(operand, position);
        }
        position
    }

    fn lower_binary_spine(
        &mut self,
        expression: ExprId,
        op: BinOp,
        left: ExprId,
        right: ExprId,
    ) -> ValueId {
        let hir = self.file.hir;
        let mut spine: SmallVec<[(BinOp, ExprId); 8]> = SmallVec::new();
        spine.push((op, right));
        let mut innermost_operator = expression;
        let mut innermost = left;
        let outer_position = self.find_operator_position(expression);
        // In a text that runs as written, each operator stands where the operators between its parentheses start.
        let is_written = self.file.runs_as_written();
        let mut written_position = outer_position;
        let mut written_positions: SmallVec<[u32; 8]> = smallvec![outer_position];
        // The operators from here on stand in parentheses that Bun's transpiler prints.
        let mut first_in_parentheses = None;
        while let ExprKind::Binary { op, left, right } = hir[innermost].kind {
            let is_spine_operator = match classify_operator(op) {
                OperatorClass::Plain | OperatorClass::Ordering => true,
                OperatorClass::Equality { .. } | OperatorClass::In | OperatorClass::ControlFlow => {
                    false
                }
            };
            if !is_spine_operator
                || self.file.is_statically_resolved(innermost)
                || self.file.decisions().constant(hir, innermost) != FoldedValue::Unknown
            {
                break;
            }
            let outer = spine[spine.len() - 1].0;
            if is_written {
                if is_parenthesized(hir, innermost) {
                    written_position = hir[innermost].pos;
                }
                written_positions.push(written_position);
            } else if first_in_parentheses.is_none() && needs_parentheses(outer, op, true) {
                first_in_parentheses = Some(spine.len());
            }
            spine.push((op, right));
            innermost_operator = innermost;
            innermost = left;
        }
        let first_in_parentheses = first_in_parentheses.unwrap_or(spine.len());
        let (mut inner_position, mut position_in_front) = (outer_position, outer_position);
        if first_in_parentheses < spine.len() {
            inner_position = self.file.first_position(innermost);
            position_in_front = self
                .find_position_in_front_of(expression)
                .unwrap_or(inner_position);
            if self.is_printed_in_parentheses_first(innermost_operator) {
                inner_position = position_in_front;
            }
        }
        let sums = self.plan_sums(expression, &spine, innermost);
        // JSC records the position of a concatenation in front of its first operand.
        let is_concatenated = |&sum: &SumOperator| sum == SumOperator::Concatenated;
        if let Some(index) = sums
            .as_ref()
            .and_then(|sums| sums.iter().rposition(is_concatenated))
        {
            self.builder
                .record_position(match index < first_in_parentheses {
                    _ if is_written => written_positions[index],
                    true => outer_position,
                    false => inner_position,
                });
        }
        let mut value = self.lower_expression(innermost);
        // The first value of the last concatenation. The transpiler joins the operands that follow with its right operand.
        let mut concatenation = None;
        for (index, &(node_op, node_right)) in spine.iter().enumerate().rev() {
            let right_value = self.lower_expression(node_right);
            if index + 1 < spine.len() && needs_parentheses(node_op, spine[index + 1].0, true) {
                inner_position = position_in_front;
            }
            let written = match index < first_in_parentheses {
                _ if is_written => written_positions[index],
                true => outer_position,
                false => inner_position,
            };
            let sum = sums
                .as_ref()
                .map_or(SumOperator::Separate, |sums| sums[index]);
            match (node_op, sum) {
                // JSC reports `instanceof`, like `in`, where the right operand starts.
                (BinOp::Instanceof, _) => {
                    let left = match index + 1 == spine.len() {
                        true => innermost,
                        false => spine[index + 1].1,
                    };
                    self.set_position(self.file.right_operand_position(left, node_right));
                }
                (BinOp::EqEq, _) | (_, SumOperator::Concatenated | SumOperator::Joined) => {
                    self.set_position_to_last_recorded();
                }
                _ => self.set_position(written),
            }
            match sum {
                SumOperator::Concatenated => concatenation = Some(self.builder.number_of_values()),
                SumOperator::Joined => {
                    if let Some(first) = concatenation {
                        self.builder.move_to_last_recorded_position(first);
                    }
                }
                SumOperator::Separate => concatenation = None,
            }
            value = match node_op {
                BinOp::Instanceof if index + 1 == spine.len() => {
                    let written = self.file.find_written_instanceof(innermost, node_right);
                    self.builder.instance_of(value, right_value, written)
                }
                _ => self.emit_binary(node_op, value, right_value),
            };
        }
        value
    }

    // JSC records no position for `==`, which is reported at the last position recorded before it.
    pub(in crate::lower) fn set_comparison_position(&mut self, expression: ExprId, op: BinOp) {
        match op {
            BinOp::EqEq => self.set_position_to_last_recorded(),
            _ => {
                let position = self.find_operator_position(expression);
                self.set_position(position);
            }
        }
    }

    fn lower_in(&mut self, expression: ExprId, left: ExprId, right: ExprId) -> ValueId {
        let hir = self.file.hir;
        if matches!(hir[left].kind, ExprKind::PrivateIdentifier(_)) {
            return self.lower_private_in(expression);
        }
        let name = self.lower_computed_key(left);
        let object = self.lower_expression(right);
        self.set_position(self.file.right_operand_position(left, right));
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
