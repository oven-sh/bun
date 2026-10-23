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
    FileLowering, FunctionLowering, async_function, call, class, commonjs, control, convert, data,
    function, generator, jsx, module, object, operator, scope, template,
};
use crate::builtins::Resolved;
use crate::ir::generated::MAX_TRACKED_INTEGER;
use crate::ir::{BlockId, DeclaredType, ValueId};

pub(in crate::lower) use self::array::lower_argument_list;
pub(in crate::lower) use self::assignment::{AssignmentTarget, classify_assignment_target};
pub(in crate::lower) use self::builtin_path::{emit_locked_builtin, expect_resolved_path};
pub(in crate::lower) use self::chain::{
    ShortCircuit, is_chain_root, lower_chain_base, lower_in_chain,
};
pub(in crate::lower) use self::global_path::{
    emit_free_name_delete, emit_free_name_get, emit_free_name_set, lower_global_path_holder,
};

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
            chain_exit: None,
            name: None,
        }
    }

    pub(in crate::lower) fn in_chain(chain_exit: BlockId, tail: Tail<'t>) -> Evaluation<'t> {
        Evaluation {
            tail,
            chain_exit: Some(chain_exit),
            name: None,
        }
    }

    pub(in crate::lower) fn named(name: PropertyName) -> Evaluation<'static> {
        Evaluation {
            tail: Tail::No,
            chain_exit: None,
            name: Some(name),
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(in crate::lower) enum ResultUsage {
    Value,
    Effect,
}

#[derive(Copy, Clone)]
enum BinaryForm {
    Logical,
    Comma,
    Operator,
}

fn binary_form(op: BinOp) -> BinaryForm {
    match op {
        BinOp::And | BinOp::Or | BinOp::Nullish => BinaryForm::Logical,
        BinOp::Comma => BinaryForm::Comma,
        _ => BinaryForm::Operator,
    }
}

pub(crate) fn lower_expression(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
) -> ValueId {
    lower_expression_in(lowering, expression, Evaluation::PLAIN)
}

pub(crate) fn lower_expression_for_effect(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
) {
    let position = lowering.file.hir[expression].pos;
    if !lowering.enter_nesting(position) {
        return;
    }
    lowering.set_position(position);
    match lowering.file.decisions().decision(expression) {
        Decision::Constant(_) | Decision::Data(_) | Decision::DeferredData => {}
        Decision::GlobalPath(_) => {
            lower_by_decision(lowering, expression, Evaluation::PLAIN);
        }
        Decision::Unknown
            if lowering
                .file
                .decisions()
                .is_truthy_without_effects(expression) => {}
        Decision::Unknown => lower_for_effect_by_kind(lowering, expression),
    }
    lowering.leave_nesting();
}

pub(crate) fn lower_tail_expression(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
) -> ValueId {
    let tail = if control::allows_tail_call(lowering) {
        Tail::Yes { casts: None }
    } else {
        Tail::No
    };
    lower_expression_in(lowering, expression, Evaluation::at_tail(tail))
}

pub(crate) fn lower_named_evaluation(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    name: PropertyName,
) -> ValueId {
    lower_expression_in(lowering, expression, Evaluation::named(name))
}

pub(crate) fn emit_constant(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    constant: Constant,
) -> ValueId {
    match constant {
        Constant::Undefined => lowering.builder.undefined(),
        Constant::Null => lowering.builder.null(),
        Constant::Boolean(value) => lowering.builder.boolean(value),
        Constant::Number(number) => emit_number(lowering, number),
        Constant::String(text) => {
            let string = lowering.file.intern_atom(text);
            lowering.builder.string(string)
        }
        Constant::BigInt(digits) => {
            let digits = lowering.file.intern_atom(digits);
            lowering.builder.big_int(digits)
        }
    }
}

pub(crate) fn emit_number(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    number: f64,
) -> ValueId {
    let is_tracked_integer = number == number.trunc()
        && number.abs() < MAX_TRACKED_INTEGER as f64
        && number.to_bits() != (-0.0f64).to_bits();
    if is_tracked_integer {
        lowering.builder.integer(number as i64)
    } else {
        lowering.builder.double(number)
    }
}

pub(crate) fn skip_type_syntax(file: &FileLowering<'_, '_, '_, '_>, expression: ExprId) -> ExprId {
    file.hir.skip_type_assertions(expression)
}

pub(in crate::lower) fn lower_expression_in(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    evaluation: Evaluation<'_>,
) -> ValueId {
    let position = lowering.file.hir[expression].pos;
    if !lowering.enter_nesting(position) {
        return lowering.builder.undefined();
    }
    lowering.set_position(position);
    let value = lower_by_decision(lowering, expression, evaluation);
    let value = finish_expression(lowering, expression, value);
    lowering.leave_nesting();
    value
}

pub(in crate::lower) fn finish_expression(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    value: ValueId,
) -> ValueId {
    // A constant has its own type, and a built-in that the table resolves says more than the type the checker has for it.
    if is_statically_resolved(lowering.file, expression) || lowering.enum_constants.contains(&value)
    {
        return value;
    }
    let mut finished = convert::convert_narrowed_reference(lowering, expression, value);
    if finished == value {
        finished = expected_type::expect_inferred_type(lowering, expression, value);
    }
    rebind_if_local(lowering, expression, value, finished);
    finished
}

pub(in crate::lower) fn is_decided(
    file: &FileLowering<'_, '_, '_, '_>,
    expression: ExprId,
) -> bool {
    !matches!(file.decisions().decision(expression), Decision::Unknown)
}

pub(in crate::lower) fn is_statically_resolved(
    file: &FileLowering<'_, '_, '_, '_>,
    expression: ExprId,
) -> bool {
    is_decided(file, expression) || file.builtins.of_expr(expression).is_some()
}

pub(in crate::lower) fn find_constant(
    file: &FileLowering<'_, '_, '_, '_>,
    expression: ExprId,
) -> Option<Constant> {
    let inner = skip_type_syntax(file, expression);
    match file.decisions().constant(file.hir, inner) {
        FoldedValue::Constant(constant) => {
            passes_every_assertion(file, expression, constant).then_some(constant)
        }
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

// An `as` is a test at run time, so a constant stands for the whole expression only where the syntax alone shows that each test passes.
pub(in crate::lower) fn passes_every_assertion(
    file: &FileLowering<'_, '_, '_, '_>,
    expression: ExprId,
    constant: Constant,
) -> bool {
    if !file.is_checked() {
        return true;
    }
    let hir = file.hir;
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

pub(in crate::lower) fn convert_through_assertions(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    innermost: ValueId,
) -> ValueId {
    let hir = lowering.file.hir;
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
        lowering.set_position(hir[assertion].pos);
        value = convert::convert_assertion(lowering, assertion, value);
    }
    rebind_if_local(lowering, expression, innermost, value);
    value
}

fn rebind_if_local(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    before: ValueId,
    after: ValueId,
) {
    if before == after {
        return;
    }
    let Some(symbol) = scope::find_tested_local(lowering, expression) else {
        return;
    };
    // The local has its own type again where the claim ends, and a closure takes it at that type.
    let position = scope::local_position(lowering, symbol);
    if convert::is_converted_within(lowering, after, position) {
        scope::rebind_local(lowering, symbol, after);
    }
}

fn lower_by_decision(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    evaluation: Evaluation<'_>,
) -> ValueId {
    match lowering.file.decisions().decision(expression) {
        Decision::Constant(constant) => emit_constant(lowering, constant),
        Decision::Data(_) | Decision::DeferredData => {
            data::lower_decided_data(lowering, expression)
        }
        Decision::GlobalPath(path) => global_path::lower_global_path(lowering, expression, path),
        Decision::Unknown => lower_by_resolution(lowering, expression, evaluation),
    }
}

fn lower_by_resolution(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    evaluation: Evaluation<'_>,
) -> ValueId {
    let hir = lowering.file.hir;
    if let Some(value) = commonjs::try_lower_mention(lowering, expression) {
        return value;
    }
    match lowering.file.builtins.of_expr(expression) {
        Some(Resolved::Builtin(path)) if path.locked_builtin().is_some() => {
            emit_locked_builtin(lowering, path.id)
        }
        Some(Resolved::Builtin(path)) if !matches!(hir[expression].kind, ExprKind::Ident(_)) => {
            builtin_path::lower_builtin_path(lowering, expression, path, evaluation)
        }
        Some(Resolved::Intrinsic(intrinsic)) => {
            let exit = evaluation.chain_exit;
            call::lower_intrinsic_expression(lowering, expression, intrinsic, exit)
        }
        Some(Resolved::Builtin(_) | Resolved::DynamicGlobal(_)) | None => {
            lower_by_kind(lowering, expression, evaluation)
        }
    }
}

fn lower_by_kind(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    evaluation: Evaluation<'_>,
) -> ValueId {
    let hir = lowering.file.hir;
    match hir[expression].kind {
        ExprKind::Missing | ExprKind::Super | ExprKind::PrivateIdentifier(_) => {
            lowering.builder.undefined()
        }
        ExprKind::Ident(_) => scope::lower_identifier(lowering, expression),
        ExprKind::This => function::lower_this_expression(lowering),
        ExprKind::NewTarget(_) => function::get_new_target(lowering),
        ExprKind::Null => emit_constant(lowering, Constant::Null),
        ExprKind::True => emit_constant(lowering, Constant::Boolean(true)),
        ExprKind::False => emit_constant(lowering, Constant::Boolean(false)),
        ExprKind::Number(index) => emit_number(lowering, hir.numbers[index as usize]),
        ExprKind::String(text) | ExprKind::JsxText(text) => {
            emit_constant(lowering, Constant::String(text))
        }
        ExprKind::BigInt(digits) => emit_constant(lowering, Constant::BigInt(digits)),
        ExprKind::Regex { .. } => array::lower_regexp_literal(lowering, expression),
        ExprKind::Template { .. } => {
            lower_unless_constant(lowering, expression, template::lower_template_literal)
        }
        ExprKind::TaggedTemplate(_) => {
            template::lower_tagged_template(lowering, expression, evaluation.tail)
        }
        ExprKind::Array(_) | ExprKind::Object(_)
            if lowering.file.decisions().is_data_literal(expression)
                && !object::holds_dictionary_literal(lowering.file, expression) =>
        {
            data::lower_decided_data(lowering, expression)
        }
        ExprKind::Array(_) => array::lower_array_literal(lowering, expression),
        ExprKind::Object(_) => object::lower_object_literal(lowering, expression),
        ExprKind::Fn(function) => {
            function::lower_function_expression(lowering, function, evaluation.name)
        }
        ExprKind::Class(class) => class::lower_class_expression(lowering, class, evaluation.name),
        ExprKind::Dot { chain: link, .. } | ExprKind::Index { chain: link, .. } => {
            lower_access(lowering, expression, link, evaluation)
        }
        ExprKind::Call(site) => lower_call_link(lowering, expression, hir[site].chain, evaluation),
        ExprKind::New(_) => call::lower_new(lowering, expression),
        ExprKind::Unary { op, .. } => lower_unary_kind(lowering, expression, op),
        ExprKind::Binary { op, .. } => lower_binary_kind(lowering, expression, op, evaluation.tail),
        ExprKind::Assign { .. } => {
            assignment::lower_assignment(lowering, expression, ResultUsage::Value)
        }
        ExprKind::Cond { .. } => {
            logical::lower_conditional(lowering, expression, ResultUsage::Value, evaluation.tail)
        }
        ExprKind::Spread(operand) => lower_expression(lowering, operand),
        ExprKind::Await(_) => async_function::lower_await(lowering, expression),
        ExprKind::Yield { .. } => generator::lower_yield(lowering, expression),
        ExprKind::Jsx(_) => jsx::lower_jsx(lowering, expression),
        ExprKind::ImportCall { .. } => module::lower_import_call(lowering, expression),
        ExprKind::ImportMeta => module::lower_import_meta(lowering),
        ExprKind::As { expr: operand, ty } => {
            lower_assertion(lowering, expression, operand, ty, evaluation)
        }
        ExprKind::Satisfies { expr: operand, .. }
        | ExprKind::AsConst(operand)
        | ExprKind::NonNull(operand)
        | ExprKind::Instantiation { expr: operand, .. } => {
            let operand_evaluation = Evaluation {
                chain_exit: None,
                ..evaluation
            };
            lower_expression_in(lowering, operand, operand_evaluation)
        }
    }
}

fn lower_unless_constant(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    lower: fn(&mut FunctionLowering<'_, '_, '_, '_, '_>, ExprId) -> ValueId,
) -> ValueId {
    match find_constant(lowering.file, expression) {
        Some(constant) => emit_constant(lowering, constant),
        None => lower(lowering, expression),
    }
}

fn lower_access(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    access: ExprId,
    link: Chain,
    evaluation: Evaluation<'_>,
) -> ValueId {
    match (link, evaluation.chain_exit) {
        (Chain::No, _) => member::lower_member(lowering, access, None),
        (Chain::Start | Chain::Continue, Some(exit)) => {
            member::lower_member(lowering, access, Some(exit))
        }
        (Chain::Start | Chain::Continue, None) => {
            chain::lower_whole_chain(lowering, access, evaluation.tail)
        }
    }
}

fn lower_call_link(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
    link: Chain,
    evaluation: Evaluation<'_>,
) -> ValueId {
    match (link, evaluation.chain_exit) {
        (Chain::No, _) => call::lower_call(lowering, call, Evaluation::at_tail(evaluation.tail)),
        (Chain::Start | Chain::Continue, Some(_)) => call::lower_call(lowering, call, evaluation),
        (Chain::Start | Chain::Continue, None) => {
            chain::lower_whole_chain(lowering, call, evaluation.tail)
        }
    }
}

fn lower_unary_kind(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    op: UnOp,
) -> ValueId {
    match op {
        UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec => {
            assignment::lower_update(lowering, expression, ResultUsage::Value)
        }
        _ => lower_unless_constant(lowering, expression, operator::lower_unary),
    }
}

fn lower_binary_kind(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    op: BinOp,
    tail: Tail<'_>,
) -> ValueId {
    match binary_form(op) {
        BinaryForm::Logical => {
            logical::lower_logical(lowering, expression, ResultUsage::Value, tail)
        }
        BinaryForm::Comma => {
            let last = logical::lower_comma_prefix(lowering, expression);
            lower_expression_in(lowering, last, Evaluation::at_tail(tail))
        }
        BinaryForm::Operator => lower_unless_constant(lowering, expression, operator::lower_binary),
    }
}

fn lower_assertion(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    assertion: ExprId,
    operand: ExprId,
    ty: TypeNodeId,
    evaluation: Evaluation<'_>,
) -> ValueId {
    let inner = match evaluation.tail {
        Tail::Yes { casts } if lowering.file.is_checked() => {
            let position = convert::assertion_position(lowering.file, ty);
            let cast = TailCast {
                position,
                outer: casts,
            };
            let operand_evaluation = Evaluation {
                tail: Tail::Yes { casts: Some(&cast) },
                chain_exit: None,
                name: evaluation.name,
            };
            lower_expression_in(lowering, operand, operand_evaluation)
        }
        Tail::Yes { .. } | Tail::No => {
            let operand_evaluation = Evaluation {
                chain_exit: None,
                ..evaluation
            };
            lower_expression_in(lowering, operand, operand_evaluation)
        }
    };
    lowering.set_position(lowering.file.hir[assertion].pos);
    let converted = convert::convert_assertion(lowering, assertion, inner);
    rebind_if_local(lowering, operand, inner, converted);
    converted
}

fn lower_for_effect_by_kind(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
) {
    if lowering.file.is_simplified(expression) {
        return unused::lower_simplified_expression(lowering, expression);
    }
    match lowering.file.hir[expression].kind {
        ExprKind::Assign { .. } => {
            assignment::lower_assignment(lowering, expression, ResultUsage::Effect);
        }
        ExprKind::Cond { .. } => {
            logical::lower_conditional(lowering, expression, ResultUsage::Effect, Tail::No);
        }
        ExprKind::Binary { op, .. } => match binary_form(op) {
            BinaryForm::Logical => {
                logical::lower_logical(lowering, expression, ResultUsage::Effect, Tail::No);
            }
            BinaryForm::Comma => {
                let last = logical::lower_comma_prefix(lowering, expression);
                lower_expression_for_effect(lowering, last);
            }
            BinaryForm::Operator => {
                lower_by_decision(lowering, expression, Evaluation::PLAIN);
            }
        },
        ExprKind::Unary { op, operand } => match op {
            UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec => {
                assignment::lower_update(lowering, expression, ResultUsage::Effect);
            }
            UnOp::Void | UnOp::Not => lower_expression_for_effect(lowering, operand),
            UnOp::Plus | UnOp::Minus | UnOp::BitNot | UnOp::Typeof | UnOp::Delete => {
                lower_by_decision(lowering, expression, Evaluation::PLAIN);
            }
        },
        ExprKind::Satisfies { expr: operand, .. }
        | ExprKind::AsConst(operand)
        | ExprKind::NonNull(operand)
        | ExprKind::Instantiation { expr: operand, .. } => {
            lower_expression_for_effect(lowering, operand);
        }
        ExprKind::Null
        | ExprKind::True
        | ExprKind::False
        | ExprKind::Number(_)
        | ExprKind::String(_)
        | ExprKind::BigInt(_)
        | ExprKind::JsxText(_) => {}
        _ => {
            lower_by_decision(lowering, expression, Evaluation::PLAIN);
        }
    }
}
