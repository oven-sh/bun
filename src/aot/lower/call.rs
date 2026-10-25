mod array_makers;
mod callee;
mod evaluated_text;
mod intrinsic;
mod intrinsic_call;
mod intrinsic_operation;
mod number_questions;
mod written_operands;

use bun_sema::bind::Parent;
use bun_sema::hir::{Call, ExprId, ExprKind, IdList};
use smallvec::SmallVec;

use super::expression::{Evaluation, Tail, TailCast};
use super::positions::SiteOrigin;
use super::{FileLowering, FunctionLowering, scope};
use crate::builtins::id::BuiltinId;
use crate::builtins::{Resolved, builtin_value_of};
use crate::ir::generated::TypeSiteKind;
use crate::ir::{DeclaredType, ExpectedResultId, PropertyKeyId, StringId, ValueId};

pub(in crate::lower) use self::intrinsic::lower_intrinsic_expression;

pub(crate) enum Arguments {
    Values(SmallVec<[ValueId; 4]>),
    List(ValueId),
}

// A marked call goes where `bun build` lets it go, and `Removable` decides that.
const IS_ANNOTATED_PURE: bool = false;

#[derive(Copy, Clone, Debug)]
pub(in crate::lower) struct Callee {
    pub(in crate::lower) function: ValueId,
    pub(in crate::lower) this: Option<ValueId>,
    pub(in crate::lower) key: Option<PropertyKeyId>,
    pub(in crate::lower) name: Option<StringId>,
}

impl Callee {
    pub(in crate::lower) fn without_key(
        function: ValueId,
        this: Option<ValueId>,
        name: Option<StringId>,
    ) -> Callee {
        Callee {
            function,
            this,
            key: None,
            name,
        }
    }
}

#[derive(Copy, Clone)]
pub(in crate::lower) struct CallOptions<'t> {
    pub(in crate::lower) tail: Tail<'t>,
    pub(in crate::lower) expected_result: Option<ExpectedResultId>,
    pub(in crate::lower) is_never_inlined: bool,
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(crate) fn lower_arguments(&mut self, arguments: IdList<ExprId>) -> Arguments {
        let arguments: SmallVec<[ExprId; 4]> = self.file.hir.ids(arguments).collect();
        self.lower_argument_slice(&arguments)
    }

    pub(crate) fn emit_construct(
        &mut self,
        callee: ValueId,
        arguments: Arguments,
        name: Option<StringId>,
    ) -> ValueId {
        let builder = &mut self.builder;
        match arguments {
            Arguments::Values(values) => {
                builder.construct(callee, None, &values, name, IS_ANNOTATED_PURE)
            }
            Arguments::List(list) => builder.construct_list(callee, None, list, name),
        }
    }

    pub(crate) fn emit_builtin_call(
        &mut self,
        builtin: BuiltinId,
        arguments: &[ValueId],
    ) -> ValueId {
        let callee = self.builder.builtin(builtin);
        emit_call(self, callee, None, arguments)
    }

    fn emit_locked_call(
        &mut self,
        builtin: BuiltinId,
        this: Option<ValueId>,
        arguments: &[ValueId],
    ) -> ValueId {
        let callee = self.emit_locked_builtin(builtin);
        emit_call(self, callee, this, arguments)
    }

    pub(in crate::lower) fn lower_call(
        &mut self,
        call: ExprId,
        evaluation: Evaluation<'_>,
    ) -> ValueId {
        let (hir, bound, builtins) = (self.file.hir, self.file.bound, self.file.builtins);
        let site = call_site(self.file, call);
        let exit = evaluation.chain_exit;
        let inner = self.file.skip_type_syntax(site.callee);
        if bound.eval_scope(call).is_some() {
            return scope::lower_direct_eval(self, call);
        }
        if matches!(hir[site.callee].kind, ExprKind::Super) {
            return self.lower_super_call(call);
        }
        if let Some(value) = self.try_lower_module_call(call, exit) {
            return value;
        }
        if let Some(value) = self.try_lower_export_definition(call) {
            return value;
        }
        if let Some(value) = self.try_lower_known_call(call) {
            return value;
        }
        match builtins.of_expr(inner) {
            Some(Resolved::Intrinsic(intrinsic)) => {
                return intrinsic::lower_intrinsic_call(self, call, intrinsic, evaluation);
            }
            Some(Resolved::Builtin(_) | Resolved::DynamicGlobal(_)) | None => {}
        }
        if let Some(text) = builtins.evaluated_text(call) {
            return self.lower_evaluated_text_call(call, text, exit);
        }
        if let Some(value) = self.try_lower_call(call, site) {
            return value;
        }

        let expected = self.file.find_callee_by_signature(call, inner);
        let mut callee = self.lower_callee(site.callee, exit, expected);
        callee.function = self.leave_chain_if_nullish(site, callee.function, exit);
        let arguments = self.lower_arguments(site.args);
        self.emit_call_expression(call, callee, arguments, evaluation.tail)
    }

    pub(in crate::lower) fn lower_new(&mut self, expression: ExprId) -> ValueId {
        let builtins = self.file.builtins;
        if let Some(text) = builtins.evaluated_text(expression) {
            return self.lower_evaluated_text_call(expression, text, None);
        }
        let site = call_site(self.file, expression);
        if let Some(value) = self.try_lower_new(expression, site) {
            return value;
        }
        let function = self.lower_expression(site.callee);
        let callee = Callee::without_key(function, None, self.file.find_callee_name(site.callee));
        let arguments = self.lower_arguments(site.args);
        self.file
            .record_construction_by_library(expression, site.callee);
        let value = self.emit_new_expression(expression, callee, arguments);
        self.record_state_creation(expression, function, value);
        value
    }

    pub(in crate::lower) fn lower_argument_slice(&mut self, arguments: &[ExprId]) -> Arguments {
        if intrinsic::has_spread(self.file.hir, arguments) {
            let position = self.file.hir[arguments[0]].pos;
            return Arguments::List(self.lower_argument_list(&[], arguments, position));
        }
        let values = arguments
            .iter()
            .map(|&argument| self.lower_expression(argument));
        Arguments::Values(values.collect())
    }

    pub(in crate::lower) fn emit_call_at(
        &mut self,
        callee: Callee,
        arguments: Arguments,
        options: CallOptions<'_>,
    ) -> ValueId {
        let value = match arguments {
            Arguments::Values(values) => self.builder.call(
                callee.function,
                callee.this,
                &values,
                callee.key,
                callee.name,
                options.expected_result,
                IS_ANNOTATED_PURE,
                options.is_never_inlined,
            ),
            Arguments::List(list) => self.builder.call_list(
                callee.function,
                callee.this,
                list,
                callee.key,
                callee.name,
                options.expected_result,
            ),
        };
        match options.tail {
            Tail::No => value,
            Tail::Yes { casts } => {
                let mut cast_positions: SmallVec<[DeclaredType; 4]> = SmallVec::new();
                let mut next = casts;
                while let Some(cast) = next {
                    cast_positions.push(cast.position);
                    next = cast.outer;
                }
                self.emit_return_call(value, &cast_positions);
                self.builder.undefined()
            }
        }
    }

    pub(in crate::lower) fn emit_call_expression(
        &mut self,
        call: ExprId,
        callee: Callee,
        mut arguments: Arguments,
        tail: Tail<'_>,
    ) -> ValueId {
        let hir = self.file.hir;
        let site = call_site(self.file, call);
        self.convert_argument_values(call, &mut arguments);
        let options = CallOptions {
            tail: Tail::No,
            expected_result: self.find_expected_result(call),
            is_never_inlined: false,
        };
        self.set_position(self.file.last_mapped_position(site.callee));
        match tail {
            Tail::No => {
                let value = self.emit_call_at(callee, arguments, options);
                self.set_position(hir[call].pos);
                self.claim_call_result(call, value)
            }
            Tail::Yes { casts } => {
                let cast = TailCast {
                    position: self.call_result_position(call),
                    outer: casts,
                };
                let tail = Tail::Yes { casts: Some(&cast) };
                self.describe_int32_tail_call(call);
                self.emit_call_at(callee, arguments, CallOptions { tail, ..options })
            }
        }
    }

    fn emit_new_expression(
        &mut self,
        expression: ExprId,
        callee: Callee,
        mut arguments: Arguments,
    ) -> ValueId {
        self.convert_argument_values(expression, &mut arguments);
        self.set_position(self.file.construct_position(expression));
        let value = self.emit_construct(callee.function, arguments, callee.name);
        self.set_position(self.file.hir[expression].pos);
        self.claim_call_result(expression, value)
    }

    fn convert_argument_values(&mut self, call: ExprId, arguments: &mut Arguments) {
        match arguments {
            Arguments::Values(values) => self.convert_arguments(call, values),
            Arguments::List(list) => self.convert_argument_list(call, *list),
        }
    }

    fn call_result_position(&mut self, call: ExprId) -> DeclaredType {
        if !self.file.is_checked() {
            return DeclaredType::untyped();
        }
        match self.file.queries.resolved_call(call) {
            Ok(Some(target)) => {
                let origin = SiteOrigin {
                    kind: TypeSiteKind::CallResult,
                    position: self.file.hir[call].pos,
                };
                self.file.create_position(target.result, origin)
            }
            Ok(None) | Err(_) => DeclaredType::untyped(),
        }
    }
}

pub(crate) fn emit_call(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    function: ValueId,
    this: Option<ValueId>,
    arguments: &[ValueId],
) -> ValueId {
    let callee = Callee::without_key(function, this, None);
    let arguments = Arguments::Values(SmallVec::from_slice(arguments));
    emit_call_of(lowering, callee, arguments)
}

pub(in crate::lower) fn emit_call_of(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    callee: Callee,
    arguments: Arguments,
) -> ValueId {
    let options = CallOptions {
        tail: Tail::No,
        expected_result: None,
        is_never_inlined: false,
    };
    lowering.emit_call_at(callee, arguments, options)
}

impl FileLowering<'_, '_, '_, '_> {
    // Bun's transpiler prints a `new` without arguments without `()`, unless something is read from the result or the result is called.
    fn construct_position(&self, expression: ExprId) -> u32 {
        let site = call_site(self, expression);
        let is_reported_at_callee = !site.args.is_empty()
            || self.is_base_of_access(expression)
            || self.is_printed_as_call(site.callee);
        match is_reported_at_callee {
            true => self.last_mapped_position(site.callee),
            false => self.hir[expression].pos,
        }
    }

    fn is_base_of_access(&self, expression: ExprId) -> bool {
        let hir = self.hir;
        let mut child = expression;
        while let Parent::Expr(parent) = self.bound.parent_of_expr(child) {
            match hir[parent].kind {
                ExprKind::As { .. }
                | ExprKind::Satisfies { .. }
                | ExprKind::AsConst(_)
                | ExprKind::NonNull(_)
                | ExprKind::Instantiation { .. } => child = parent,
                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => return obj == child,
                ExprKind::Call(site) | ExprKind::New(site) | ExprKind::TaggedTemplate(site) => {
                    return hir[site].callee == child;
                }
                _ => return false,
            }
        }
        false
    }

    // A native error constructor does the same with and without `new`, and Bun's transpiler prints the call, so a stack trace shows the position of a call.
    fn is_printed_as_call(&self, callee: ExprId) -> bool {
        let inner = self.skip_type_syntax(callee);
        if !matches!(self.hir[inner].kind, ExprKind::Ident(_)) {
            return false;
        }
        matches!(
            self.builtins.of_expr(inner),
            Some(Resolved::Builtin(path) | Resolved::DynamicGlobal(path)) if matches!(
                path.id,
                BuiltinId::Error
                    | BuiltinId::TypeError
                    | BuiltinId::SyntaxError
                    | BuiltinId::RangeError
                    | BuiltinId::ReferenceError
                    | BuiltinId::EvalError
                    | BuiltinId::URIError
                    | BuiltinId::AggregateError
            )
        )
    }

    fn find_callee_by_signature(&mut self, call: ExprId, inner: ExprId) -> Option<BuiltinId> {
        if self.builtins.of_expr(inner).is_some() {
            return None;
        }
        let target = self.queries.resolved_call(call).ok()??;
        let types = self.inputs.builtin_types;
        let index = types.value_of_call_signature(target.declaration?)?;
        builtin_value_of(index)
    }
}

fn call_site(file: &FileLowering<'_, '_, '_, '_>, call: ExprId) -> Call {
    let hir = file.hir;
    let (ExprKind::Call(site) | ExprKind::New(site) | ExprKind::TaggedTemplate(site)) =
        hir[call].kind
    else {
        unreachable!("call_site takes a Call, a New or a TaggedTemplate expression");
    };
    hir[site]
}
