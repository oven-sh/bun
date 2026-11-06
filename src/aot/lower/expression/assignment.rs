use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, Decl, PatParent};
use bun_sema::fold::Decision;
use bun_sema::hir::{
    BinOp, ExprFlags, ExprId, ExprKind, Flags, IdList, MemberKey, PropId, Span, UnOp, end_of_expr,
};

use super::ResultUsage;
use super::logical::LogicalOperator;
use crate::ir::ValueId;
use crate::ir::generated::{ECMAMode, FunctionFlags};
use crate::lower::member::{KeyConversion, PropertyName, Reference};
use crate::lower::module::file_scope;
use crate::lower::scope::{BindingRef, Storage};
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
    // An expression that makes an object wherever it is evaluated.
    fn is_written_as_object(&self, expression: ExprId) -> bool {
        matches!(
            self.hir[self.skip_type_syntax(expression)].kind,
            ExprKind::New(_)
                | ExprKind::Object(_)
                | ExprKind::Array(_)
                | ExprKind::Fn(_)
                | ExprKind::Class(_)
                | ExprKind::Regex { .. }
        )
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

    // Where JSC records, and where it reports, the operator of `name += value` and `name++`. The source map takes the first back to the name and the second to the start of the expression.
    fn update_positions(&self, expression: ExprId, name: ExprId) -> (u32, u32) {
        let hir = self.hir;
        if !self.runs_as_written() {
            return (hir[name].pos, hir[expression].pos);
        }
        let position = match hir[expression].kind {
            ExprKind::Assign { target, .. } => self.updating_store_position(target),
            _ => self.updated_read_position(expression, name),
        };
        (position, position)
    }

    // JSC records the read of `name += value` and `name++` where the name ends, and the one of `++name` where it starts. The source map takes both to the start.
    fn updated_read_position(&self, expression: ExprId, name: ExprId) -> u32 {
        let is_prefix = matches!(
            self.hir[expression].kind,
            ExprKind::Unary {
                op: UnOp::PreInc | UnOp::PreDec,
                ..
            }
        );
        match is_prefix {
            true => self.hir[name].pos,
            false => self.recorded_name_position(name),
        }
    }

    // JSC reports a plain store to a member at the end of the object, and every other store at the end of the target.
    fn plain_store_position(&self, expression: ExprId, target: ExprId) -> u32 {
        match self.hir.member_key(self.skip_type_syntax(target)) {
            Some((object, _)) => self.member_position(object),
            None if self.runs_as_written() => end_of_expr(self.hir, target),
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
        ) => {
            let reference = lowering.lower_reference(target, KeyConversion::Once);
            lowering.set_position_of_updated_read(expression, target);
            let old = lowering.get_reference(&reference);
            let old = lowering.convert_through_assertions(target, old);
            let right = lowering.lower_expression(value);
            lowering.set_update_position(expression, target);
            let updated = lowering.emit_binary(op, old, right);
            lowering.set_position(lowering.file.updating_store_position(target));
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
            lowering.lower_plain_assignment(expression, target, value)
        }
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    // JSC records a position for the operator of `x += v` only where `x` lives in a scope object. Elsewhere the operator is reported at the last position recorded before it.
    // Nor does it record one for the read of `x` there, or for the test of `o` in `o[k] += v`, which follows a `k` that is no literal.
    // JSC keeps a variable in a register unless a closure or `eval` sees it, an ES module exports it, or it is a parameter of a generator, whose body
    // is a function of its own. Bun's transpiler prints an enum as a function, which sees what the members read.
    pub(in crate::lower) fn is_kept_in_register(&self, binding: Binding) -> bool {
        let Binding::Symbol(symbol) = binding else {
            return false;
        };
        let file = &*self.file;
        let Some(placement) = file.scopes.placement(BindingRef::Symbol(symbol)) else {
            return false;
        };
        let is_declared_exported = |declaration: &Decl| match *declaration {
            Decl::Var(pattern) => match file.bound.pat_parent[pattern.idx()] {
                PatParent::Var(declaration) => file.hir[declaration].flags.contains(Flags::EXPORT),
                _ => false,
            },
            Decl::Class(class) => file.hir[class].flags.contains(Flags::EXPORT),
            _ => false,
        };
        let mut declarations = file.bound.symbol(symbol).decls.iter();
        let is_exported = file.bound.symbol_scope(symbol) == file_scope(file)
            && (matches!(placement.storage, Storage::Variable(_))
                || file.scopes.is_in_export_list(symbol)
                || declarations.clone().any(is_declared_exported));
        let is_parameter = declarations.any(|declaration| matches!(declaration, Decl::Param(_)));
        let flags = self.builder.function().flags;
        let is_seen_by_no_printed_closure = !file.bound.is_visible_to_eval(symbol)
            && file
                .scopes
                .is_named_elsewhere_only_in_unprinted_statements(symbol);
        (!placement.is_shared || is_seen_by_no_printed_closure)
            && !file.scopes.is_read_by_enum(symbol)
            && !(is_exported && !file.is_commonjs_module())
            && !(is_parameter && flags.contains(FunctionFlags::IS_GENERATOR))
    }

    // JSC records the store to a variable that lives in a scope object at the `=`, which the source map takes back to the name: behind the value, and in strict code ahead of it too.
    pub(in crate::lower) fn record_store_ahead_of_value(&mut self, binding: Binding, name: u32) {
        if !self.is_kept_in_register(binding) && self.mode() == ECMAMode::Strict {
            self.builder.record_position(name);
        }
    }

    pub(in crate::lower) fn record_store_behind_value(&mut self, binding: Binding, name: u32) {
        if !self.is_kept_in_register(binding) {
            self.builder.record_position(name);
        }
    }

    fn set_position_of_updated_read(&mut self, expression: ExprId, target: ExprId) {
        let has_no_record = match self.file.classify_assignment_target(target) {
            AssignmentTarget::Identifier { identifier, .. } => {
                let is_in_register = self.is_kept_in_register(self.file.bound.binding(identifier));
                if !is_in_register {
                    let position = self.file.updated_read_position(expression, identifier);
                    self.builder.record_position(position);
                    if self.file.runs_as_written() {
                        self.set_position(position);
                    }
                }
                is_in_register
            }
            _ => match self.file.hir.member_key(self.file.skip_type_syntax(target)) {
                // `o` was tested ahead of the conversion of a key that is an object.
                Some((object, MemberKey::Computed(key))) if self.file.is_written_as_object(key) => {
                    self.set_position(self.file.member_position(object));
                    return;
                }
                // JSC tests `o` by an operation of its own, which the read stands for. The test is reported there. A getter or a trap that the read calls has its caller at `o`.
                Some((object, MemberKey::Computed(key)))
                    if !self.file.is_printed_as_number_or_text(key) =>
                {
                    if let Some(name) = self.file.find_position_of_printed_nan(key) {
                        self.builder.record_position(name);
                    }
                    self.set_position_to_last_recorded();
                    let position = self.file.member_position(object);
                    self.builder.set_position_for_callers(position);
                    return;
                }
                _ => false,
            },
        };
        if has_no_record {
            self.set_position_to_last_recorded();
        }
    }

    fn set_update_position(&mut self, expression: ExprId, target: ExprId) {
        match self.file.classify_assignment_target(target) {
            AssignmentTarget::Identifier { identifier, .. }
                if !self.is_kept_in_register(self.file.bound.binding(identifier)) =>
            {
                let (recorded, reported) = self.file.update_positions(expression, identifier);
                self.builder.record_position(recorded);
                self.set_position(reported);
            }
            _ => self.set_position_to_last_recorded(),
        }
    }

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

    fn lower_assigned_value(&mut self, target: ExprId, value: ExprId) -> ValueId {
        match self.file.classify_assignment_target(target) {
            AssignmentTarget::Identifier { identifier, name } => {
                let binding = self.file.bound.binding(identifier);
                let key = self
                    .file
                    .function_name_key(binding, name, self.file.hir[identifier].pos);
                let position = self.file.recorded_name_position(identifier);
                self.record_store_ahead_of_value(binding, position);
                let assigned = self.lower_named_evaluation(value, PropertyName::Constant(key));
                self.record_store_behind_value(binding, position);
                assigned
            }
            _ => self.lower_expression(value),
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
    lowering.set_position_of_updated_read(expression, target);
    let old = lowering.get_reference(&reference);
    let result = match usage {
        ResultUsage::Value => Some(lowering.builder.create_variable(None)),
        ResultUsage::Effect => None,
    };
    let assign = lowering.create_block();
    let join = lowering.create_block();
    lowering.set_position(hir[expression].pos);
    lowering.branch_on_logical_operator(old, operator, Some(target), result, assign, join);

    lowering.continue_in(assign);
    let assigned = lowering.lower_assigned_value(target, value);
    let position = lowering.file.updating_store_position(target);
    lowering.set_position(position);
    if let AssignmentTarget::Identifier { identifier, .. } =
        lowering.file.classify_assignment_target(target)
        && lowering.file.runs_as_written()
    {
        lowering.record_store_behind_value(lowering.file.bound.binding(identifier), position);
    }
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
    // Where the result is used, the update of a name is reported at the update.
    let is_name = matches!(reference, Reference::Identifier { .. });
    let has_own_position = is_name && usage == ResultUsage::Value;
    if !has_own_position {
        lowering.set_position_of_updated_read(expression, operand);
    } else if lowering.file.runs_as_written() {
        lowering.set_position(lowering.file.updated_read_position(expression, operand));
    }
    let old = lowering.get_reference(&reference);
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
    match has_own_position {
        true if lowering.file.runs_as_written() => {
            lowering.set_position(lowering.file.updated_read_position(expression, operand));
        }
        true => lowering.set_position(hir[expression].pos),
        false => lowering.set_update_position(expression, operand),
    }
    let store_position = match is_postfix {
        true => lowering.file.last_mapped_position(operand),
        false => hir[operand].pos,
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
    lowering.set_position(store_position);
    let stored = lowering.put_reference(&reference, updated, Some(expression));
    if is_old_kept { old } else { stored }
}
