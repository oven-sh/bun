mod array;
mod assignment;
mod builtin_path;
mod chain;
mod global_path;
mod logical;
#[cfg(test)]
mod tests;
mod unused;

use bun_sema::fold::{Constant, Decision, FoldedValue, TreeNode, push_children};
use bun_sema::hir::{
    BinOp, Call, Chain, ExprId, ExprKind, Keyword, PropKey, PropKind, TypeNodeId, TypeNodeKind,
    UnOp,
};
use smallvec::SmallVec;

use super::member::{self, GivenName};
use super::{
    FileLowering, FunctionLowering, async_function, call, control, generator, module, object,
    operator, scope, template,
};
use crate::builtins::{BuiltinId, Mutability, Resolved, table};
use crate::compile::removable::{is_name_left_out_by_bun_run, is_read_left_out_by_bun_run};
use crate::ir::generated::MAX_TRACKED_INTEGER;
use crate::ir::{BlockId, DeclaredType, ValueId};

pub(in crate::lower) use self::assignment::AssignmentTarget;
pub(in crate::lower) use self::chain::{ShortCircuit, is_link_in_brackets};

#[derive(Copy, Clone)]
pub(in crate::lower) struct TailCast<'t> {
    pub(in crate::lower) positions: &'t [DeclaredType],
    pub(in crate::lower) outer: Option<&'t TailCast<'t>>,
    pub(in crate::lower) breaks_no_int32_promise: bool,
}

#[derive(Copy, Clone)]
pub(in crate::lower) enum Tail<'t> {
    No,
    Yes { casts: Option<&'t TailCast<'t>> },
}

#[derive(Copy, Clone)]
pub(in crate::lower) struct Evaluation<'t> {
    pub(in crate::lower) tail: Tail<'t>,
    pub(in crate::lower) chain_exit: Option<BlockId>,
    pub(in crate::lower) name: Option<GivenName>,
}

impl<'t> Evaluation<'t> {
    pub(in crate::lower) const PLAIN: Evaluation<'static> = Evaluation {
        tail: Tail::No,
        chain_exit: None,
        name: None,
    };

    #[inline]
    pub(in crate::lower) fn at_tail(tail: Tail<'t>) -> Evaluation<'t> {
        Evaluation {
            tail,
            ..Evaluation::PLAIN
        }
    }

    pub(in crate::lower) fn in_chain(chain_exit: BlockId, tail: Tail<'t>) -> Evaluation<'t> {
        Evaluation {
            tail,
            chain_exit: Some(chain_exit),
            name: None,
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(in crate::lower) enum ResultUsage {
    Value,
    Effect,
    EffectOfTakenValue,
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(crate) fn lower_expression(&mut self, expression: ExprId) -> ValueId {
        self.lower_expression_in(expression, Evaluation::PLAIN)
    }

    pub(crate) fn lower_expression_for_effect(&mut self, expression: ExprId) {
        self.lower_for_effect(expression, ResultUsage::Effect);
    }

    pub(in crate::lower) fn lower_taken_value_for_effect(&mut self, expression: ExprId) {
        self.lower_for_effect(expression, ResultUsage::EffectOfTakenValue);
    }

    pub(in crate::lower) fn lower_operand_of_taken_void(&mut self, operand: ExprId) {
        if !(self.file).reads_only_what_bun_run_leaves_out(operand, true) {
            self.lower_taken_value_for_effect(operand);
        }
    }

    fn lower_for_effect(&mut self, expression: ExprId, usage: ResultUsage) {
        let position = self.file.hir[expression].pos;
        debug_assert!(
            !self.file.hir.is_in_jsdoc(position),
            "an expression synthesized from a JSDoc tag is never lowered"
        );
        if !self.enter_nesting(position) {
            return;
        }
        self.set_position(position);
        let counted = self.enter_counted_expression(expression);
        match self.file.decisions().decision(expression) {
            Decision::Constant(_) | Decision::Data(_) | Decision::DeferredData => {}
            Decision::GlobalPath(_) => {
                self.lower_by_decision(expression, Evaluation::PLAIN);
            }
            Decision::Unknown
                if usage == ResultUsage::Effect
                    && (self.file).reads_only_what_bun_run_leaves_out(expression, true) => {}
            Decision::Unknown if self.file.decisions().is_truthy_without_effects(expression) => {
                self.lower_member_reads(expression);
            }
            Decision::Unknown => self.lower_for_effect_by_kind(expression, usage),
        }
        self.leave_counted_expression(counted);
        self.leave_nesting();
    }

    pub(in crate::lower) fn lower_member_reads(&mut self, expression: ExprId) {
        let hir = self.file.hir;
        let decisions = self.file.decisions();
        if expression.is_none()
            || decisions.is_dead_expr(expression)
            || !decisions.reads_member(expression)
            || !self.enter_nesting(hir[expression].pos)
        {
            return;
        }
        match hir[expression].kind {
            ExprKind::Dot { .. } | ExprKind::Index { .. }
                if self.file.hangs_below_builtin(expression) =>
            {
                self.lower_read_of_locked_path(expression);
            }
            ExprKind::Dot { .. } | ExprKind::Index { .. } | ExprKind::Call(_) => {
                self.lower_expression(expression);
            }
            ExprKind::Binary {
                op: BinOp::In,
                left,
                right,
            } => {
                match self.file.find_member_looked_for(left, right) {
                    Some(member) => self.emit_locked_builtin(member),
                    None => operator::lower_binary(self, expression),
                };
            }
            ExprKind::Unary {
                op: UnOp::Void,
                operand,
            } => self.lower_expression_for_effect(operand),
            ExprKind::Binary {
                op: BinOp::Comma,
                left,
                right,
            } => {
                self.lower_expression_for_effect(left);
                self.lower_member_reads(right);
            }
            _ => {
                let mut parts = Vec::new();
                push_children(hir, TreeNode::Expr(expression), &mut parts);
                for part in parts {
                    if let TreeNode::Expr(part) = part {
                        self.lower_member_reads(part);
                    }
                }
            }
        }
        self.leave_nesting();
    }

    pub(in crate::lower) fn lower_read_of_locked_path(&mut self, path: ExprId) {
        let member = match self.file.builtins.of_pure_expr(path) {
            Some(Resolved::Builtin(member)) => member,
            Some(Resolved::DynamicGlobal(_) | Resolved::Intrinsic(_)) => return,
            None => {
                match self.file.hir[path].kind {
                    ExprKind::Dot { obj, .. } => self.lower_member_reads(obj),
                    ExprKind::Index { obj, index, .. } => {
                        self.lower_member_reads(obj);
                        self.lower_member_reads(index);
                    }
                    _ => {}
                }
                return;
            }
        };
        if let Some(builtin) = member.locked_builtin() {
            self.emit_locked_builtin(builtin);
            return;
        }
        let entry = table::entry(member.id);
        if let Some(holder) = entry.holder
            && entry.mutability == Mutability::AlwaysLocked
            && !table::is_legal_builtin_constant(member.id)
            && table::is_legal_builtin_constant(holder)
            && !table::is_symbol_name(entry.name)
        {
            let object = self.emit_locked_builtin(holder);
            let key = self.file.text_key_of_name(entry.name);
            self.builder.prop_get(object, key, false, false);
        }
    }

    pub(crate) fn lower_tail_expression(&mut self, expression: ExprId) -> ValueId {
        let tail = if control::allows_tail_call_of(self, expression) {
            Tail::Yes { casts: None }
        } else {
            Tail::No
        };
        self.lower_expression_in(expression, Evaluation::at_tail(tail))
    }

    pub(crate) fn lower_named_evaluation(
        &mut self,
        expression: ExprId,
        name: impl Into<GivenName>,
    ) -> ValueId {
        let evaluation = Evaluation {
            name: Some(name.into()),
            ..Evaluation::PLAIN
        };
        self.lower_expression_in(expression, evaluation)
    }

    pub(crate) fn emit_constant(&mut self, constant: Constant) -> ValueId {
        match constant {
            Constant::Undefined => self.builder.undefined(),
            Constant::Null => self.builder.null(),
            Constant::Boolean(value) => self.builder.boolean(value),
            Constant::Number(number) => self.emit_number(number),
            Constant::String(text) => self.builder.string(self.file.intern_atom(text)),
            Constant::BigInt(digits) => self.builder.big_int(self.file.intern_atom(digits)),
        }
    }

    pub(crate) fn emit_number(&mut self, number: f64) -> ValueId {
        let is_tracked_integer = number == number.trunc()
            && number.abs() < MAX_TRACKED_INTEGER as f64
            && number.to_bits() != (-0.0f64).to_bits();
        if is_tracked_integer {
            self.builder.integer(number as i64)
        } else {
            self.builder.double(number)
        }
    }

    pub(in crate::lower) fn lower_expression_in(
        &mut self,
        expression: ExprId,
        evaluation: Evaluation<'_>,
    ) -> ValueId {
        let position = self.file.hir[expression].pos;
        debug_assert!(
            !self.file.hir.is_in_jsdoc(position),
            "an expression synthesized from a JSDoc tag is never lowered"
        );
        if !self.enter_nesting(position) {
            return self.builder.undefined();
        }
        self.set_position(position);
        let counted = match self.file.counted_places.is_some() {
            true => self.enter_counted_expression(expression),
            false => self.counted_expression,
        };
        let value = self.lower_by_decision(expression, evaluation);
        let is_read = matches!(
            self.file.hir[expression].kind,
            ExprKind::Dot { .. } | ExprKind::Index { .. }
        );
        let value = match is_read
            && super::positions::has_int32_promise(self.file)
            && matches!(evaluation.tail, Tail::No)
            && !self.file.is_statically_resolved(expression)
        {
            true => self.state_int32_of_read(expression, value),
            false => value,
        };
        self.leave_counted_expression(counted);
        self.leave_nesting();
        value
    }

    pub(in crate::lower) fn convert_through_assertions(
        &mut self,
        expression: ExprId,
        innermost: ValueId,
    ) -> ValueId {
        let hir = self.file.hir;
        let mut assertions: SmallVec<[ExprId; 2]> = SmallVec::new();
        let mut current = expression;
        while let Some(operand) = hir.type_assertion_operand(current) {
            if matches!(hir[current].kind, ExprKind::As { .. }) {
                assertions.push(current);
            }
            current = operand;
        }
        let mut value = innermost;
        for &assertion in assertions.iter().rev() {
            self.set_position(hir[assertion].pos);
            value = self.convert_assertion(assertion, value);
        }
        self.rebind_if_local(expression, innermost, value);
        value
    }

    fn rebind_if_local(&mut self, expression: ExprId, before: ValueId, after: ValueId) {
        if before == after {
            return;
        }
        let Some(symbol) = scope::find_tested_local(self, expression) else {
            return;
        };
        let position = self.local_position(symbol);
        if self.is_converted_within(after, position) {
            self.rebind_local(symbol, after);
        }
    }

    fn lower_by_decision(&mut self, expression: ExprId, evaluation: Evaluation<'_>) -> ValueId {
        match self.file.decisions().decision(expression) {
            Decision::Constant(constant) => return self.emit_constant(constant),
            Decision::Data(_) | Decision::DeferredData => {
                return self.lower_decided_data(expression);
            }
            Decision::GlobalPath(path) => return self.lower_global_path(expression, path),
            Decision::Unknown => {}
        }
        let may_be_mention = matches!(
            self.file.hir[expression].kind,
            ExprKind::Ident(_) | ExprKind::Dot { .. } | ExprKind::Index { .. }
        ) || !self.file.builtins.module_object_mentions().is_empty();
        if may_be_mention && let Some(value) = self.try_lower_mention(expression) {
            return value;
        }
        let resolved = self.file.builtins.of_expr(expression);
        if resolved.is_some()
            && let Some(Resolved::Builtin(path)) = self.file.builtins.of_pure_expr(expression)
            && let Some(builtin) = path.locked_builtin()
            && !self.file.names_source_path(expression)
        {
            return self.emit_locked_builtin(builtin);
        }
        match resolved {
            Some(Resolved::Builtin(path))
                if !matches!(self.file.hir[expression].kind, ExprKind::Ident(_)) =>
            {
                let value = self.lower_by_kind(expression, evaluation);
                self.expect_path(path, value)
            }
            Some(Resolved::Intrinsic(intrinsic)) => {
                let exit = evaluation.chain_exit;
                call::lower_intrinsic_expression(self, expression, intrinsic, exit)
            }
            Some(Resolved::Builtin(_) | Resolved::DynamicGlobal(_)) | None => {
                self.lower_by_kind(expression, evaluation)
            }
        }
    }

    fn lower_by_kind(&mut self, expression: ExprId, evaluation: Evaluation<'_>) -> ValueId {
        let hir = self.file.hir;
        match hir[expression].kind {
            ExprKind::Missing | ExprKind::Super | ExprKind::PrivateIdentifier(_) => {
                self.builder.undefined()
            }
            ExprKind::Ident(_) => self.lower_unless_constant(expression, |lowering, read| {
                lowering.lower_identifier(read)
            }),
            ExprKind::This => self.lower_this_expression(),
            ExprKind::NewTarget(_) => self.get_new_target(),
            ExprKind::Null => self.emit_constant(Constant::Null),
            ExprKind::True => self.emit_constant(Constant::Boolean(true)),
            ExprKind::False => self.emit_constant(Constant::Boolean(false)),
            ExprKind::Number(index) => self.emit_number(hir.numbers[index as usize]),
            ExprKind::String(text) | ExprKind::JsxText(text) => {
                self.emit_constant(Constant::String(text))
            }
            ExprKind::BigInt(digits) => self.emit_constant(Constant::BigInt(digits)),
            ExprKind::Regex { .. } => array::lower_regexp_literal(self, expression),
            ExprKind::Template { .. } => {
                self.lower_unless_constant(expression, template::lower_template_literal)
            }
            ExprKind::TaggedTemplate(_) => {
                template::lower_tagged_template(self, expression, evaluation.tail)
            }
            ExprKind::Object(properties) if properties.len() == 0 => {
                match self.file.find_emitted_enum_born_at(expression) {
                    Some(found) => self.lower_object_of_emitted_enum(&found),
                    None if self.file.decisions().is_data_literal(expression)
                        && !self.file.is_built_by_code(expression) =>
                    {
                        self.lower_decided_data(expression)
                    }
                    None => object::lower_object_literal(self, expression),
                }
            }
            ExprKind::Array(_) | ExprKind::Object(_)
                if self.file.decisions().is_data_literal(expression)
                    && !object::is_born_level_by_level(self, expression)
                    && !self.file.is_built_by_code(expression) =>
            {
                self.lower_decided_data(expression)
            }
            ExprKind::Array(_) => array::lower_array_literal(self, expression),
            ExprKind::Object(_) => object::lower_object_literal(self, expression),
            ExprKind::Fn(function) => self.lower_function_expression(function, evaluation.name),
            ExprKind::Class(class) => self.lower_class_expression(class, evaluation.name),
            ExprKind::Dot { .. } | ExprKind::Index { .. } | ExprKind::Call(_)
                if evaluation.chain_exit.is_none() && self.file.is_chain_root(expression) =>
            {
                self.lower_in_chain(ShortCircuit::Undefined, &mut |lowering, exit| {
                    lowering.lower_by_kind(expression, Evaluation::in_chain(exit, evaluation.tail))
                })
            }
            ExprKind::Dot { .. }
                if let Some(read) =
                    (self.file.decisions()).length_of_named_text(self.file.hir, expression) =>
            {
                if read.name_runs_for_its_check {
                    self.lower_taken_value_for_effect(read.name);
                }
                self.emit_constant(read.length)
            }
            ExprKind::Dot { chain: link, .. } | ExprKind::Index { chain: link, .. } => {
                let exit = match link {
                    Chain::No => None,
                    Chain::Start | Chain::Continue => evaluation.chain_exit,
                };
                member::lower_member(self, expression, exit)
            }
            ExprKind::Call(site) => match hir[site].chain {
                Chain::No => match self.file.find_emitted_enum(expression) {
                    Some(found) => self.lower_call_of_emitted_enum(&found),
                    None => self.lower_call_unless_constant(expression, hir[site], evaluation.tail),
                },
                Chain::Start | Chain::Continue => self.lower_call(expression, evaluation),
            },
            ExprKind::New(_) => self.lower_new(expression, evaluation.tail),
            ExprKind::Unary { op, .. } => match op {
                UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec => {
                    assignment::lower_update(self, expression, ResultUsage::Value)
                }
                _ => self.lower_unless_constant(expression, operator::lower_unary),
            },
            ExprKind::Binary { op, .. } => match op {
                BinOp::And | BinOp::Or | BinOp::Nullish => {
                    match self.find_operand_named_in_place_of(expression, evaluation) {
                        Some(operand) => self.lower_expression_in(operand, evaluation),
                        None => self.lower_logical(expression, ResultUsage::Value, evaluation.tail),
                    }
                }
                BinOp::Comma => {
                    let last = logical::lower_comma_prefix(self, expression, ResultUsage::Value);
                    self.lower_expression_in(last, Evaluation::at_tail(evaluation.tail))
                }
                _ => self.lower_unless_constant(expression, operator::lower_binary),
            },
            ExprKind::Assign { .. } => {
                assignment::lower_assignment(self, expression, ResultUsage::Value)
            }
            ExprKind::Cond { .. } => {
                match self.find_operand_named_in_place_of(expression, evaluation) {
                    Some(operand) => self.lower_expression_in(operand, evaluation),
                    None => self.lower_conditional(expression, ResultUsage::Value, evaluation.tail),
                }
            }
            ExprKind::Spread(operand) => self.lower_expression(operand),
            ExprKind::Await(_) => async_function::lower_await(self, expression),
            ExprKind::Yield { .. } => generator::lower_yield(self, expression),
            ExprKind::Jsx(_) => self.lower_jsx(expression, evaluation.tail),
            ExprKind::ImportCall { .. } => module::lower_import_call(self, expression),
            ExprKind::ImportMeta => self.lower_import_meta(),
            ExprKind::As { expr: operand, ty } => {
                self.lower_assertion(expression, operand, ty, evaluation)
            }
            ExprKind::Satisfies { expr: operand, .. }
            | ExprKind::AsConst(operand)
            | ExprKind::NonNull(operand)
            | ExprKind::Instantiation { expr: operand, .. } => {
                let operand_evaluation = Evaluation {
                    chain_exit: None,
                    ..evaluation
                };
                self.lower_expression_in(operand, operand_evaluation)
            }
        }
    }

    fn find_operand_named_in_place_of(
        &self,
        operator: ExprId,
        evaluation: Evaluation<'_>,
    ) -> Option<ExprId> {
        evaluation.name?;
        if self.file.counts_executions() {
            return None;
        }
        let decisions = self.file.decisions();
        decisions.find_operand_alone_in_bun_run(self.file.hir, operator)
    }

    fn lower_unless_constant(
        &mut self,
        expression: ExprId,
        lower: fn(&mut FunctionLowering<'_, '_, '_, '_, '_>, ExprId) -> ValueId,
    ) -> ValueId {
        let inner = self.file.skip_type_syntax(expression);
        let (constant, has_dead_zone) = match self.file.decisions().constant(self.file.hir, inner) {
            FoldedValue::Constant(constant) => (constant, false),
            FoldedValue::ConstantOutsideDeadZone(constant) => (constant, true),
            FoldedValue::Unknown => return lower(self, expression),
        };
        if !self.file.passes_every_assertion(expression, constant) {
            return lower(self, expression);
        }
        if let Constant::String(text) = constant
            && self
                .file
                .queries
                .atom_bytes(text)
                .iter()
                .any(|&byte| byte > 0xc3)
        {
            return lower(self, expression);
        }
        let runs_for_its_checks = has_dead_zone && !self.file.decisions().reads_member(inner);
        if runs_for_its_checks {
            let lowered = lower(self, expression);
            if self.builder.is_constant(lowered) {
                return lowered;
            }
        } else {
            self.lower_member_reads(inner);
        }
        self.emit_constant(constant)
    }

    fn lower_call_unless_constant(&mut self, call: ExprId, site: Call, tail: Tail<'_>) -> ValueId {
        let hir = self.file.hir;
        let (constant, has_dead_zone) = match self.file.decisions().constant(hir, call) {
            FoldedValue::Constant(constant) => (constant, false),
            FoldedValue::ConstantOutsideDeadZone(constant) => (constant, true),
            FoldedValue::Unknown => return self.lower_call(call, Evaluation::at_tail(tail)),
        };
        if has_dead_zone {
            if let Some((receiver, _)) = hir.member_key(self.file.skip_type_syntax(site.callee)) {
                self.lower_taken_value_for_effect(receiver);
            }
            for argument in hir.ids(site.args) {
                self.lower_taken_value_for_effect(argument);
            }
        }
        self.emit_constant(constant)
    }

    fn lower_assertion(
        &mut self,
        assertion: ExprId,
        operand: ExprId,
        ty: TypeNodeId,
        evaluation: Evaluation<'_>,
    ) -> ValueId {
        let position;
        let cast;
        let tail = match evaluation.tail {
            Tail::Yes { casts } if self.file.is_checked() => {
                position = self.file.assertion_position(ty);
                cast = TailCast {
                    positions: std::slice::from_ref(&position),
                    outer: casts,
                    breaks_no_int32_promise: false,
                };
                Tail::Yes { casts: Some(&cast) }
            }
            tail @ (Tail::Yes { .. } | Tail::No) => tail,
        };
        let operand_evaluation = Evaluation {
            tail,
            chain_exit: None,
            name: evaluation.name,
        };
        let inner = self.lower_expression_in(operand, operand_evaluation);
        self.set_position(self.file.hir[assertion].pos);
        let converted = self.convert_assertion(assertion, inner);
        self.rebind_if_local(operand, inner, converted);
        converted
    }

    fn lower_for_effect_by_kind(&mut self, expression: ExprId, usage: ResultUsage) {
        if usage == ResultUsage::Effect && self.file.is_simplified(expression) {
            return self.lower_simplified_expression(expression);
        }
        match self.file.hir[expression].kind {
            ExprKind::Assign { .. } => {
                assignment::lower_assignment(self, expression, ResultUsage::Effect);
            }
            ExprKind::Cond { .. } => {
                self.lower_conditional(expression, usage, Tail::No);
            }
            ExprKind::Binary { op, left, right } => match op {
                BinOp::And | BinOp::Or | BinOp::Nullish => {
                    self.lower_logical(expression, usage, Tail::No);
                }
                BinOp::Comma => {
                    let last = logical::lower_comma_prefix(self, expression, usage);
                    self.lower_for_effect(last, usage);
                }
                BinOp::EqEqEq | BinOp::NotEqEq if usage == ResultUsage::Effect => {
                    self.lower_expression_for_effect(left);
                    self.lower_expression_for_effect(right);
                }
                _ => {
                    self.lower_by_decision(expression, Evaluation::PLAIN);
                }
            },
            ExprKind::Unary { op, operand } => match op {
                UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec => {
                    assignment::lower_update(self, expression, ResultUsage::Effect);
                }
                UnOp::Void if usage == ResultUsage::Effect => {
                    self.lower_expression_for_effect(operand);
                }
                UnOp::Void => self.lower_operand_of_taken_void(operand),
                UnOp::Not => self.lower_for_effect(operand, usage),
                UnOp::Typeof
                    if usage == ResultUsage::Effect && !self.file.is_name_below_typeof(operand) =>
                {
                    self.lower_expression_for_effect(operand);
                }
                UnOp::Plus | UnOp::Minus | UnOp::BitNot | UnOp::Typeof | UnOp::Delete => {
                    self.lower_by_decision(expression, Evaluation::PLAIN);
                }
            },
            ExprKind::Satisfies { expr: operand, .. }
            | ExprKind::AsConst(operand)
            | ExprKind::NonNull(operand)
            | ExprKind::Instantiation { expr: operand, .. } => {
                self.lower_for_effect(operand, usage);
            }
            ExprKind::Null
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Number(_)
            | ExprKind::String(_)
            | ExprKind::BigInt(_)
            | ExprKind::JsxText(_) => {}
            _ => {
                self.lower_by_decision(expression, Evaluation::PLAIN);
            }
        }
    }
}

impl FileLowering<'_, '_, '_, '_> {
    #[inline]
    pub(crate) fn skip_type_syntax(&self, expression: ExprId) -> ExprId {
        self.hir.skip_type_assertions(expression)
    }

    pub(in crate::lower) fn is_statically_resolved(&self, expression: ExprId) -> bool {
        is_decided(self, expression) || self.builtins.of_expr(expression).is_some()
    }

    fn is_read_left_out_by_bun_run(&self, expression: ExprId) -> bool {
        self.builtins
            .global_path(self.hir, self.bound, expression)
            .is_some_and(|steps| is_read_left_out_by_bun_run(steps[0].id))
    }

    pub(in crate::lower) fn reads_only_what_bun_run_leaves_out(
        &self,
        expression: ExprId,
        names_below_top_level: bool,
    ) -> bool {
        if self.counts_executions() {
            return false;
        }
        let hir = self.hir;
        let top_scope = self.bound.top_scope(hir, bun_sema::bind::CodeUnit::File);
        let decisions = self.decisions();
        let mut reads_member = false;
        let mut parts: SmallVec<[ExprId; 4]> = SmallVec::new();
        parts.push(expression);
        while let Some(part) = parts.pop() {
            match decisions.decision(part) {
                Decision::Constant(_) | Decision::Data(_) => continue,
                Decision::GlobalPath(_) | Decision::DeferredData => return false,
                Decision::Unknown => {}
            }
            if let FoldedValue::Constant(_) = decisions.constant(hir, part) {
                continue;
            }
            match hir[part].kind {
                ExprKind::Unary {
                    op: UnOp::Void | UnOp::Not,
                    operand,
                } => parts.push(operand),
                ExprKind::Unary {
                    op: UnOp::Typeof,
                    operand,
                } => parts.push(operand),
                ExprKind::Binary {
                    op:
                        BinOp::EqEqEq
                        | BinOp::NotEqEq
                        | BinOp::Comma
                        | BinOp::And
                        | BinOp::Or
                        | BinOp::Nullish,
                    left,
                    right,
                } => parts.extend([left, right]),
                ExprKind::Cond { test, branches } => {
                    let branches = hir.branches(branches);
                    parts.extend([test, branches.yes, branches.no]);
                }
                ExprKind::Satisfies { expr: operand, .. }
                | ExprKind::AsConst(operand)
                | ExprKind::NonNull(operand)
                | ExprKind::Instantiation { expr: operand, .. } => parts.push(operand),
                ExprKind::Array(elements) => {
                    for element in hir.ids(elements) {
                        match hir[element].kind {
                            ExprKind::Missing => {}
                            ExprKind::Spread(_) => return false,
                            _ => parts.push(element),
                        }
                    }
                }
                ExprKind::Object(properties) => {
                    for property in properties.iter().map(|property| &hir[property]) {
                        match (property.kind, property.key) {
                            (PropKind::Init | PropKind::Shorthand, PropKey::Name(_)) => {
                                parts.push(property.value);
                            }
                            (
                                PropKind::Method | PropKind::Getter | PropKind::Setter,
                                PropKey::Name(_),
                            ) => {}
                            _ => return false,
                        }
                    }
                }
                ExprKind::Ident(_)
                    if matches!(self.bound.binding(part), bun_sema::bind::Binding::Symbol(symbol)
                        if self.bound.binding_kind(symbol) != bun_sema::bind::BindingKind::Import
                            && (names_below_top_level || self.bound.symbol_scope(symbol) == top_scope))
                        && self
                            .bound
                            .dynamic_lookup_scope(bun_sema::hir::NodeData::Expr(part))
                            .is_none() =>
                {
                    reads_member = true
                }
                ExprKind::Ident(name)
                    if self.bound.is_evaluated_ident(part)
                        && self.bound.binding(part) == bun_sema::bind::Binding::Free
                        && self
                            .bound
                            .dynamic_lookup_scope(bun_sema::hir::NodeData::Expr(part))
                            .is_none()
                        && is_name_left_out_by_bun_run(self.queries.atom_bytes(name))
                        && names_below_top_level =>
                {
                    reads_member = true
                }
                _ if self.is_read_left_out_by_bun_run(part) => reads_member = true,
                _ => return false,
            }
        }
        reads_member
    }

    fn is_name_below_typeof(&self, operand: ExprId) -> bool {
        let name = self.skip_type_syntax(operand);
        matches!(self.hir[name].kind, ExprKind::Ident(_)) || is_decided(self, name)
    }

    fn hangs_below_builtin(&self, path: ExprId) -> bool {
        let mut current = self.skip_type_syntax(path);
        loop {
            if self.builtins.of_pure_expr(current).is_some() {
                return true;
            }
            let (ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. }) = self.hir[current].kind
            else {
                return false;
            };
            current = self.skip_type_syntax(obj);
        }
    }

    fn find_member_looked_for(&self, name: ExprId, object: ExprId) -> Option<BuiltinId> {
        let Constant::String(name) = find_constant(self, name)? else {
            return None;
        };
        let holder = self.builtins.of_pure_expr(self.skip_type_syntax(object));
        let Some(Resolved::Builtin(holder)) = holder else {
            return None;
        };
        let name = table::find_name(self.queries.atom_bytes(name))?;
        let member = table::own_member(table::canonical_id(holder.id), name)?;
        table::is_legal_builtin_constant(member).then_some(member)
    }

    pub(in crate::lower) fn passes_every_assertion(
        &self,
        expression: ExprId,
        constant: Constant,
    ) -> bool {
        if !self.is_checked() {
            return true;
        }
        let hir = self.hir;
        let mut current = expression;
        while let Some(operand) = hir.type_assertion_operand(current) {
            if let ExprKind::As { ty, .. } = hir[current].kind {
                let TypeNodeKind::Keyword(keyword) = hir[ty].kind else {
                    return false;
                };
                if !keyword_accepts(keyword, constant) {
                    return false;
                }
            }
            current = operand;
        }
        true
    }
}

pub(in crate::lower) fn is_decided(
    file: &FileLowering<'_, '_, '_, '_>,
    expression: ExprId,
) -> bool {
    !matches!(file.decisions().decision(expression), Decision::Unknown)
}

pub(in crate::lower) fn find_constant(
    file: &FileLowering<'_, '_, '_, '_>,
    expression: ExprId,
) -> Option<Constant> {
    let inner = file.skip_type_syntax(expression);
    match file.decisions().constant(file.hir, inner) {
        FoldedValue::Constant(constant) => file
            .passes_every_assertion(expression, constant)
            .then_some(constant),
        FoldedValue::ConstantOutsideDeadZone(_) | FoldedValue::Unknown => None,
    }
}

pub(in crate::lower) fn find_constant_outside_dead_zone(
    file: &FileLowering<'_, '_, '_, '_>,
    expression: ExprId,
) -> Option<Constant> {
    let inner = file.skip_type_syntax(expression);
    match file.decisions().constant(file.hir, inner) {
        FoldedValue::ConstantOutsideDeadZone(constant) => file
            .passes_every_assertion(expression, constant)
            .then_some(constant),
        FoldedValue::Constant(_) | FoldedValue::Unknown => None,
    }
}

pub(in crate::lower) fn is_printed_as_number_or_text(
    file: &FileLowering<'_, '_, '_, '_>,
    expression: ExprId,
) -> bool {
    let inner = file.skip_type_syntax(expression);
    let minifies_syntax = file.inputs.options.removable.minifies_syntax();
    if !minifies_syntax && holds_written_numbers_alone(file, inner) {
        return true;
    }
    let decisions = file.decisions();
    let is_number_or_text = match decisions.constant(file.hir, inner) {
        FoldedValue::Constant(constant) | FoldedValue::ConstantOutsideDeadZone(constant) => {
            match constant {
                Constant::String(_) => true,
                Constant::Number(number) => !number.is_nan(),
                Constant::Undefined
                | Constant::Null
                | Constant::Boolean(_)
                | Constant::BigInt(_) => false,
            }
        }
        FoldedValue::Unknown => false,
    };
    is_number_or_text
        && match minifies_syntax {
            true => decisions.is_constant_under_minify_syntax(file.hir, inner),
            false => decisions.is_constant_in_bun_run(file.hir, inner),
        }
}

fn holds_written_numbers_alone(file: &FileLowering<'_, '_, '_, '_>, expression: ExprId) -> bool {
    match file.hir[file.skip_type_syntax(expression)].kind {
        ExprKind::Number(_) => true,
        ExprKind::Unary {
            op: UnOp::Plus | UnOp::Minus | UnOp::BitNot,
            operand,
        } => holds_written_numbers_alone(file, operand),
        ExprKind::Binary { op, left, right } => {
            let is_arithmetic = matches!(
                op,
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
            );
            is_arithmetic
                && holds_written_numbers_alone(file, left)
                && holds_written_numbers_alone(file, right)
        }
        _ => false,
    }
}

fn keyword_accepts(keyword: Keyword, constant: Constant) -> bool {
    match (keyword, constant) {
        (Keyword::Any | Keyword::Unknown, _)
        | (_, Constant::Undefined | Constant::Null)
        | (Keyword::String, Constant::String(_))
        | (Keyword::Number, Constant::Number(_))
        | (Keyword::Boolean, Constant::Boolean(_))
        | (Keyword::BigInt, Constant::BigInt(_)) => true,
        (
            Keyword::Never
            | Keyword::Void
            | Keyword::Undefined
            | Keyword::Null
            | Keyword::String
            | Keyword::Number
            | Keyword::Boolean
            | Keyword::BigInt
            | Keyword::Symbol
            | Keyword::Object
            | Keyword::This
            | Keyword::Intrinsic,
            _,
        ) => false,
    }
}
