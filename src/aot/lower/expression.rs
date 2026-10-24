mod array;
mod assignment;
mod builtin_path;
mod chain;
mod expected_type;
mod global_path;
mod logical;
mod unused;

use bun_sema::fold::{Constant, Decision, FoldedValue};
use bun_sema::hir::{BinOp, Chain, ExprId, ExprKind, Keyword, TypeNodeId, TypeNodeKind, UnOp};
use smallvec::SmallVec;

use super::member::{self, PropertyName};
use super::{
    FileLowering, FunctionLowering, async_function, call, control, generator, module, object,
    operator, scope, template,
};
use crate::builtins::Resolved;
use crate::ir::generated::MAX_TRACKED_INTEGER;
use crate::ir::{BlockId, DeclaredType, ValueId};

pub(in crate::lower) use self::assignment::AssignmentTarget;
pub(in crate::lower) use self::chain::ShortCircuit;

#[derive(Copy, Clone)]
pub(in crate::lower) struct TailCast<'t> {
    pub(in crate::lower) position: DeclaredType,
    pub(in crate::lower) outer: Option<&'t TailCast<'t>>,
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
    pub(in crate::lower) name: Option<PropertyName>,
}

impl<'t> Evaluation<'t> {
    pub(in crate::lower) const PLAIN: Evaluation<'static> = Evaluation {
        tail: Tail::No,
        chain_exit: None,
        name: None,
    };

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
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(crate) fn lower_expression(&mut self, expression: ExprId) -> ValueId {
        self.lower_expression_in(expression, Evaluation::PLAIN)
    }

    pub(crate) fn lower_expression_for_effect(&mut self, expression: ExprId) {
        let position = self.file.hir[expression].pos;
        if !self.enter_nesting(position) {
            return;
        }
        self.set_position(position);
        match self.file.decisions().decision(expression) {
            Decision::Constant(_) | Decision::Data(_) | Decision::DeferredData => {}
            Decision::GlobalPath(_) => {
                self.lower_by_decision(expression, Evaluation::PLAIN);
            }
            Decision::Unknown if self.file.decisions().is_truthy_without_effects(expression) => {}
            Decision::Unknown => self.lower_for_effect_by_kind(expression),
        }
        self.leave_nesting();
    }

    pub(crate) fn lower_tail_expression(&mut self, expression: ExprId) -> ValueId {
        let tail = if control::allows_tail_call(self) {
            Tail::Yes { casts: None }
        } else {
            Tail::No
        };
        self.lower_expression_in(expression, Evaluation::at_tail(tail))
    }

    pub(crate) fn lower_named_evaluation(
        &mut self,
        expression: ExprId,
        name: PropertyName,
    ) -> ValueId {
        let evaluation = Evaluation {
            name: Some(name),
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
        if !self.enter_nesting(position) {
            return self.builder.undefined();
        }
        self.set_position(position);
        let value = self.lower_by_decision(expression, evaluation);
        let value = self.finish_expression(expression, value);
        self.leave_nesting();
        value
    }

    pub(in crate::lower) fn finish_expression(
        &mut self,
        expression: ExprId,
        value: ValueId,
    ) -> ValueId {
        // A constant has its own type, and a built-in that the table resolves says more than the type the checker has for it.
        if self.file.is_statically_resolved(expression) || self.enum_constants.contains(&value) {
            return value;
        }
        let mut finished = self.convert_narrowed_reference(expression, value);
        if finished == value {
            finished = self.expect_inferred_type(expression, value);
        }
        self.rebind_if_local(expression, value, finished);
        finished
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
        // The local has its own type again where the claim ends, and a closure takes it at that type.
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
        if let Some(value) = self.try_lower_mention(expression) {
            return value;
        }
        match self.file.builtins.of_expr(expression) {
            Some(Resolved::Builtin(path)) if path.locked_builtin().is_some() => {
                self.emit_locked_builtin(path.id)
            }
            Some(Resolved::Builtin(path))
                if !matches!(self.file.hir[expression].kind, ExprKind::Ident(_)) =>
            {
                if let Some(builtin) = path.locked_builtin() {
                    return self.emit_locked_builtin(builtin);
                }
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
            ExprKind::Ident(_) => self.lower_identifier(expression),
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
            ExprKind::Array(_) | ExprKind::Object(_)
                if self.file.decisions().is_data_literal(expression)
                    && !self.file.holds_dictionary_literal(expression) =>
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
            ExprKind::Dot { chain: link, .. } | ExprKind::Index { chain: link, .. } => {
                let exit = match link {
                    Chain::No => None,
                    Chain::Start | Chain::Continue => evaluation.chain_exit,
                };
                member::lower_member(self, expression, exit)
            }
            ExprKind::Call(site) => match hir[site].chain {
                Chain::No => self.lower_call(expression, Evaluation::at_tail(evaluation.tail)),
                Chain::Start | Chain::Continue => self.lower_call(expression, evaluation),
            },
            ExprKind::New(_) => self.lower_new(expression),
            ExprKind::Unary { op, .. } => match op {
                UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec => {
                    assignment::lower_update(self, expression, ResultUsage::Value)
                }
                _ => self.lower_unless_constant(expression, operator::lower_unary),
            },
            ExprKind::Binary { op, .. } => match op {
                BinOp::And | BinOp::Or | BinOp::Nullish => {
                    self.lower_logical(expression, ResultUsage::Value, evaluation.tail)
                }
                BinOp::Comma => {
                    let last = logical::lower_comma_prefix(self, expression);
                    self.lower_expression_in(last, Evaluation::at_tail(evaluation.tail))
                }
                _ => self.lower_unless_constant(expression, operator::lower_binary),
            },
            ExprKind::Assign { .. } => {
                assignment::lower_assignment(self, expression, ResultUsage::Value)
            }
            ExprKind::Cond { .. } => {
                self.lower_conditional(expression, ResultUsage::Value, evaluation.tail)
            }
            ExprKind::Spread(operand) => self.lower_expression(operand),
            ExprKind::Await(_) => async_function::lower_await(self, expression),
            ExprKind::Yield { .. } => generator::lower_yield(self, expression),
            ExprKind::Jsx(_) => self.lower_jsx(expression),
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

    fn lower_unless_constant(
        &mut self,
        expression: ExprId,
        lower: fn(&mut FunctionLowering<'_, '_, '_, '_, '_>, ExprId) -> ValueId,
    ) -> ValueId {
        let inner = self.file.skip_type_syntax(expression);
        let (constant, has_dead_zone) = match self.file.decisions().constant(self.file.hir, inner) {
            FoldedValue::Constant(constant) => (constant, false),
            // Such an expression throws for a variable in its dead zone or has this value, and does nothing else: behind its operations the value is known.
            FoldedValue::ConstantOutsideDeadZone(constant) => (constant, true),
            FoldedValue::Unknown => return lower(self, expression),
        };
        if !self.file.passes_every_assertion(expression, constant) {
            return lower(self, expression);
        }
        if has_dead_zone {
            lower(self, expression);
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
        let cast;
        let tail = match evaluation.tail {
            Tail::Yes { casts } if self.file.is_checked() => {
                let position = self.file.assertion_position(ty);
                cast = TailCast {
                    position,
                    outer: casts,
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

    fn lower_for_effect_by_kind(&mut self, expression: ExprId) {
        if self.file.is_simplified(expression) {
            return self.lower_simplified_expression(expression);
        }
        match self.file.hir[expression].kind {
            ExprKind::Assign { .. } => {
                assignment::lower_assignment(self, expression, ResultUsage::Effect);
            }
            ExprKind::Cond { .. } => {
                self.lower_conditional(expression, ResultUsage::Effect, Tail::No);
            }
            ExprKind::Binary { op, .. } => match op {
                BinOp::And | BinOp::Or | BinOp::Nullish => {
                    self.lower_logical(expression, ResultUsage::Effect, Tail::No);
                }
                BinOp::Comma => {
                    let last = logical::lower_comma_prefix(self, expression);
                    self.lower_expression_for_effect(last);
                }
                _ => {
                    self.lower_by_decision(expression, Evaluation::PLAIN);
                }
            },
            ExprKind::Unary { op, operand } => match op {
                UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec => {
                    assignment::lower_update(self, expression, ResultUsage::Effect);
                }
                UnOp::Void | UnOp::Not => self.lower_expression_for_effect(operand),
                UnOp::Plus | UnOp::Minus | UnOp::BitNot | UnOp::Typeof | UnOp::Delete => {
                    self.lower_by_decision(expression, Evaluation::PLAIN);
                }
            },
            ExprKind::Satisfies { expr: operand, .. }
            | ExprKind::AsConst(operand)
            | ExprKind::NonNull(operand)
            | ExprKind::Instantiation { expr: operand, .. } => {
                self.lower_expression_for_effect(operand);
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
    pub(crate) fn skip_type_syntax(&self, expression: ExprId) -> ExprId {
        self.hir.skip_type_assertions(expression)
    }

    pub(in crate::lower) fn is_statically_resolved(&self, expression: ExprId) -> bool {
        is_decided(self, expression) || self.builtins.of_expr(expression).is_some()
    }

    // An `as` is a test at run time, so a constant stands for the whole expression only where the syntax alone shows that each test passes.
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
