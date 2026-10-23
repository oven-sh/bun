mod array_makers;
mod callee;
mod evaluated_text;
mod intrinsic;
mod intrinsic_call;
mod intrinsic_operation;
mod number_questions;
mod written_operands;

use bun_sema::bind::Parent;
use bun_sema::hir::{Call, Chain, ExprId, ExprKind, IdList};
use smallvec::SmallVec;

use super::expression::{
    Evaluation, Tail, TailCast, lower_argument_list, lower_expression, skip_type_syntax,
};
use super::positions::{self, SiteOrigin};
use super::{
    FileLowering, FunctionLowering, class, commonjs, condition, control, convert, known_call,
    module, private_names, scope, validate,
};
use crate::builtins::id::BuiltinId;
use crate::builtins::{Resolved, builtin_value_of};
use crate::ir::generated::TypeSiteKind;
use crate::ir::{DeclaredType, ExpectedResultId, PropertyKeyId, StringId, ValueId};

pub(in crate::lower) use self::array_makers::try_lower_list_of_indexes;
pub(in crate::lower) use self::callee::{
    last_mapped_position, last_reported_position, lower_callee,
};
pub(in crate::lower) use self::intrinsic::lower_intrinsic_expression;
pub(in crate::lower) use self::number_questions::{
    emit_number_question, find_number_question, lower_operand_of_question,
};

pub(crate) enum Arguments {
    Values(SmallVec<[ValueId; 4]>),
    List(ValueId),
}

// A marked call goes where `bun build` lets it go, and `Removable` decides that.
const IS_ANNOTATED_PURE: bool = false;

#[derive(Copy, Clone, Default, Debug)]
pub(crate) struct CallSite {
    pub(crate) callee_key: Option<PropertyKeyId>,
    pub(crate) callee_name: Option<StringId>,
    pub(crate) expected_result: Option<ExpectedResultId>,
}

#[derive(Copy, Clone, Debug)]
pub(in crate::lower) struct Callee {
    pub(in crate::lower) function: ValueId,
    pub(in crate::lower) this: Option<ValueId>,
    pub(in crate::lower) key: Option<PropertyKeyId>,
    pub(in crate::lower) name: Option<StringId>,
}

#[derive(Copy, Clone)]
pub(in crate::lower) struct CallOptions<'t> {
    pub(in crate::lower) tail: Tail<'t>,
    pub(in crate::lower) expected_result: Option<ExpectedResultId>,
    pub(in crate::lower) is_never_inlined: bool,
}

pub(crate) fn lower_arguments(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    arguments: IdList<ExprId>,
) -> Arguments {
    let arguments: SmallVec<[ExprId; 4]> = lowering.file.hir.ids(arguments).collect();
    lower_argument_slice(lowering, &arguments)
}

pub(crate) fn emit_call(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    callee: ValueId,
    this: Option<ValueId>,
    arguments: Arguments,
    site: CallSite,
) -> ValueId {
    let callee = Callee {
        function: callee,
        this,
        key: site.callee_key,
        name: site.callee_name,
    };
    let options = CallOptions {
        tail: Tail::No,
        expected_result: site.expected_result,
        is_never_inlined: false,
    };
    emit_call_at(lowering, callee, arguments, options)
}

pub(crate) fn emit_construct(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    callee: ValueId,
    new_target: Option<ValueId>,
    arguments: Arguments,
    site: CallSite,
) -> ValueId {
    let builder = &mut lowering.builder;
    match arguments {
        Arguments::Values(values) => builder.construct(
            callee,
            new_target,
            &values,
            site.callee_name,
            IS_ANNOTATED_PURE,
        ),
        Arguments::List(list) => builder.construct_list(callee, new_target, list, site.callee_name),
    }
}

pub(crate) fn emit_builtin_call(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    builtin: BuiltinId,
    arguments: &[ValueId],
) -> ValueId {
    let callee = lowering.builder.builtin(builtin);
    let arguments = Arguments::Values(SmallVec::from_slice(arguments));
    emit_call(lowering, callee, None, arguments, CallSite::default())
}

pub(in crate::lower) fn lower_call(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
    evaluation: Evaluation<'_>,
) -> ValueId {
    let (hir, bound, builtins) = (
        lowering.file.hir,
        lowering.file.bound,
        lowering.file.builtins,
    );
    let site = call_site(lowering.file, call);
    let exit = evaluation.chain_exit;
    let inner = skip_type_syntax(lowering.file, site.callee);
    if bound.eval_scope(call).is_some() {
        return scope::lower_direct_eval(lowering, call);
    }
    if matches!(hir[site.callee].kind, ExprKind::Super) {
        return class::lower_super_call(lowering, call);
    }
    if let Some(value) = module::try_lower_module_call(lowering, call, exit) {
        return value;
    }
    if let Some(value) = commonjs::try_lower_export_definition(lowering, call) {
        return value;
    }
    if let Some(value) = known_call::try_lower_known_call(lowering, call) {
        return value;
    }
    match builtins.of_expr(inner) {
        Some(Resolved::Intrinsic(intrinsic)) => {
            return intrinsic::lower_intrinsic_call(lowering, call, intrinsic, evaluation);
        }
        Some(Resolved::Builtin(_) | Resolved::DynamicGlobal(_)) | None => {}
    }
    if let Some(text) = builtins.evaluated_text(call) {
        return evaluated_text::lower_evaluated_text_call(lowering, call, text, exit);
    }
    if let Some(value) = written_operands::try_lower_call(lowering, call, site) {
        return value;
    }

    let expected = find_callee_by_signature(lowering.file, call, inner);
    let mut callee = callee::lower_expected_callee(lowering, site.callee, exit, expected);
    match site.chain {
        Chain::Start => {
            let exit = exit.expect("an optional call has the exit of its chain");
            let function = callee.function;
            callee.function =
                condition::branch_if_expression_nullish(lowering, site.callee, function, exit);
        }
        Chain::No | Chain::Continue => {}
    }
    let arguments = lower_arguments(lowering, site.args);
    emit_call_expression(lowering, call, callee, arguments, evaluation.tail)
}

pub(in crate::lower) fn lower_new(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
) -> ValueId {
    let builtins = lowering.file.builtins;
    if let Some(text) = builtins.evaluated_text(expression) {
        return evaluated_text::lower_evaluated_text_call(lowering, expression, text, None);
    }
    let site = call_site(lowering.file, expression);
    if let Some(value) = written_operands::try_lower_new(lowering, expression, site) {
        return value;
    }
    let function = lower_expression(lowering, site.callee);
    let callee = Callee {
        function,
        this: None,
        key: None,
        name: callee::find_callee_name(lowering.file, site.callee),
    };
    let arguments = lower_arguments(lowering, site.args);
    convert::record_construction_by_library(lowering.file, expression, site.callee);
    let value = emit_new_expression(lowering, expression, callee, arguments);
    private_names::record_state_creation(lowering, expression, function, value);
    value
}

// Bun's transpiler prints a `new` without arguments without `()`, unless something is read from the result or the result is called.
fn construct_position(file: &FileLowering<'_, '_, '_, '_>, expression: ExprId) -> u32 {
    let site = call_site(file, expression);
    let is_reported_at_callee = !site.args.is_empty()
        || is_base_of_access(file, expression)
        || is_printed_as_call(file, site.callee);
    match is_reported_at_callee {
        true => last_mapped_position(file, site.callee),
        false => file.hir[expression].pos,
    }
}

fn is_base_of_access(file: &FileLowering<'_, '_, '_, '_>, expression: ExprId) -> bool {
    let hir = file.hir;
    let mut child = expression;
    while let Parent::Expr(parent) = file.bound.parent_of_expr(child) {
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
fn is_printed_as_call(file: &FileLowering<'_, '_, '_, '_>, callee: ExprId) -> bool {
    let inner = skip_type_syntax(file, callee);
    if !matches!(file.hir[inner].kind, ExprKind::Ident(_)) {
        return false;
    }
    matches!(
        file.builtins.of_expr(inner),
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

pub(in crate::lower) fn lower_argument_slice(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    arguments: &[ExprId],
) -> Arguments {
    let hir = lowering.file.hir;
    let is_spread = |argument: &ExprId| matches!(hir[*argument].kind, ExprKind::Spread(_));
    if arguments.iter().any(is_spread) {
        let position = hir[arguments[0]].pos;
        return Arguments::List(lower_argument_list(lowering, &[], arguments, position));
    }
    let values = arguments
        .iter()
        .map(|&argument| lower_expression(lowering, argument));
    Arguments::Values(values.collect())
}

pub(in crate::lower) fn emit_call_at(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    callee: Callee,
    arguments: Arguments,
    options: CallOptions<'_>,
) -> ValueId {
    let value = match arguments {
        Arguments::Values(values) => lowering.builder.call(
            callee.function,
            callee.this,
            &values,
            callee.key,
            callee.name,
            options.expected_result,
            IS_ANNOTATED_PURE,
            options.is_never_inlined,
        ),
        Arguments::List(list) => lowering.builder.call_list(
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
            control::emit_return_call(lowering, value, &cast_positions);
            lowering.builder.undefined()
        }
    }
}

pub(in crate::lower) fn emit_call_expression(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
    callee: Callee,
    mut arguments: Arguments,
    tail: Tail<'_>,
) -> ValueId {
    let hir = lowering.file.hir;
    let site = call_site(lowering.file, call);
    convert_argument_values(lowering, call, &mut arguments);
    let options = CallOptions {
        tail: Tail::No,
        expected_result: validate::find_expected_result(lowering, call),
        is_never_inlined: false,
    };
    lowering.set_position(last_mapped_position(lowering.file, site.callee));
    match tail {
        Tail::No => {
            let value = emit_call_at(lowering, callee, arguments, options);
            lowering.set_position(hir[call].pos);
            convert::claim_call_result(lowering, call, value)
        }
        Tail::Yes { casts } => {
            let cast = TailCast {
                position: call_result_position(lowering, call),
                outer: casts,
            };
            let tail = Tail::Yes { casts: Some(&cast) };
            convert::describe_int32_tail_call(lowering, call);
            emit_call_at(lowering, callee, arguments, CallOptions { tail, ..options })
        }
    }
}

fn emit_new_expression(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    callee: Callee,
    mut arguments: Arguments,
) -> ValueId {
    convert_argument_values(lowering, expression, &mut arguments);
    lowering.set_position(construct_position(lowering.file, expression));
    let construct_site = CallSite {
        callee_name: callee.name,
        ..CallSite::default()
    };
    let value = emit_construct(lowering, callee.function, None, arguments, construct_site);
    lowering.set_position(lowering.file.hir[expression].pos);
    convert::claim_call_result(lowering, expression, value)
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

fn convert_argument_values(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
    arguments: &mut Arguments,
) {
    match arguments {
        Arguments::Values(values) => convert::convert_arguments(lowering, call, values),
        Arguments::List(list) => convert::convert_argument_list(lowering, call, *list),
    }
}

fn call_result_position(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
) -> DeclaredType {
    if !lowering.file.is_checked() {
        return DeclaredType::untyped();
    }
    match lowering.file.queries.resolved_call(call) {
        Ok(Some(target)) => {
            let origin = SiteOrigin {
                kind: TypeSiteKind::CallResult,
                position: lowering.file.hir[call].pos,
            };
            positions::create_position(lowering.file, target.result, origin)
        }
        Ok(None) | Err(_) => DeclaredType::untyped(),
    }
}

fn find_callee_by_signature(
    file: &mut FileLowering<'_, '_, '_, '_>,
    call: ExprId,
    inner: ExprId,
) -> Option<BuiltinId> {
    if file.builtins.of_expr(inner).is_some() {
        return None;
    }
    let target = file.queries.resolved_call(call).ok()??;
    let index = file
        .inputs
        .builtin_types
        .value_of_call_signature(target.declaration?)?;
    builtin_value_of(index)
}
