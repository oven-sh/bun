use bun_sema::bind::Binding;
use bun_sema::check::aot::{
    AnythingReason, CallTarget, FunctionRef, GaveUp, ShapeKind, WrittenType,
};
use bun_sema::hir::{Call, Chain, ExprId, ExprKind, FnBody, MemberKey, NodeData};
use bun_sema::util::SharedSort;

use super::ValidationError;
use super::nodes::validation_nodes;
use crate::builtins::id::BuiltinId;
use crate::builtins::table::{self, BuiltinName, MemberLookup};
use crate::builtins::{builtin_class_of, builtin_value_of};
use crate::diagnostic_codes::Code;
use crate::ir::generated::{
    ExpectedResult, LimitId, TypeSiteKind, ValidationNode, ValidationShape,
};
use crate::ir::{ExpectedResultId, Primitives, TypeId, TypeTable};
use crate::lower::positions::{self, SiteOrigin};
use crate::lower::{CheckerTypeId, FileLowering, expression, layouts, types};
use crate::modules::ImportBinding;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum ValidatingFunction {
    Parse,
    Validate,
}

pub(super) fn find_validating_function(builtin: BuiltinId) -> Option<ValidatingFunction> {
    match builtin {
        BuiltinId::JSONParse => Some(ValidatingFunction::Parse),
        BuiltinId::BunBundleValidate => Some(ValidatingFunction::Validate),
        _ => None,
    }
}

// `const config: Config = JSON.parse(text)`, `JSON.parse(text) as Order`: the parse may build its answer with the layouts of the type that it is written under.
fn note_what_a_parse_may_build(file: &mut FileLowering<'_, '_, '_, '_>, answer: ExprId) {
    let Ok(Some(written)) = file.queries.contextual_type(answer) else {
        return;
    };
    let position = file.hir[answer].pos;
    let ty = result_type(file, written, position);
    if ty != TypeTable::ANYTHING {
        layouts::note_what_is_built(file, ty, LimitId::MaxExpectedResultLayouts);
    }
}

fn has_parser_under(
    file: &mut FileLowering<'_, '_, '_, '_>,
    receiver: CheckerTypeId,
    name: BuiltinName,
) -> bool {
    let class = match file.queries.type_shape(receiver).map(|shape| shape.kind) {
        Ok(ShapeKind::Builtin { class, .. }) => class,
        Ok(ShapeKind::Union(members)) => {
            return members
                .iter()
                .any(|&member| has_parser_under(file, member, name));
        }
        Ok(_) | Err(_) => return false,
    };
    let prototype =
        builtin_class_of(class.class).and_then(|class| table::class_data(class).prototype);
    prototype.is_some_and(|prototype| match table::member(prototype, name) {
        MemberLookup::Found(method) => table::is_parser(table::canonical_id(method)),
        MemberLookup::Unknown | MemberLookup::Absent => false,
    })
}

// The type of the receiver says which class it is of, and the table what the prototype of the class holds under the name.
fn calls_parser_of_receiver(file: &mut FileLowering<'_, '_, '_, '_>, callee: ExprId) -> bool {
    let Some((receiver, MemberKey::Name(name))) = file.hir.member_key(callee) else {
        return false;
    };
    let Some(name) = file.inputs.builtin_names.get(name) else {
        return false;
    };
    match file.queries.expression_type(receiver) {
        Ok(receiver) => has_parser_under(file, receiver, name),
        Err(_) => false,
    }
}

// `(await request.json()) as Order`, `const order: Order = await response.json()`: the type is written over the await.
pub(super) fn note_what_an_awaited_parse_may_build(
    file: &mut FileLowering<'_, '_, '_, '_>,
    awaiting: ExprId,
    operand: ExprId,
) {
    let hir = file.hir;
    let ExprKind::Call(id) = hir[expression::skip_type_syntax(file, operand)].kind else {
        return;
    };
    let callee = expression::skip_type_syntax(file, hir[id].callee);
    if hir.list_at(hir[id].type_args).is_empty() && calls_parser_of_receiver(file, callee) {
        note_what_a_parse_may_build(file, awaiting);
    }
}

pub(super) fn find_expected_result(
    file: &mut FileLowering<'_, '_, '_, '_>,
    call: ExprId,
) -> Option<ExpectedResultId> {
    let hir = file.hir;
    let (ExprKind::Call(id) | ExprKind::TaggedTemplate(id)) = hir[call].kind else {
        return None;
    };
    let site = hir[id];
    let callee = expression::skip_type_syntax(file, site.callee);
    let resolved = file.builtins.builtin_of_expression(callee);
    let resolved = resolved.and_then(find_validating_function);
    let has_type_arguments = !hir.list_at(site.type_args).is_empty();
    match resolved {
        Some(ValidatingFunction::Validate) => {
            return find_validated_result(file, call, &site, ValidatingFunction::Validate);
        }
        Some(ValidatingFunction::Parse) if !has_type_arguments => {
            note_what_a_parse_may_build(file, call);
            return find_validated_result(file, call, &site, ValidatingFunction::Parse);
        }
        None if !has_type_arguments => return None,
        Some(ValidatingFunction::Parse) | None => {}
    }
    let target = match file.queries.resolved_call(call) {
        Ok(Some(target)) => target,
        Ok(None) => return None,
        Err(_) => {
            let function = resolved?;
            return find_validated_result(file, call, &site, function);
        }
    };
    let builtin_types = file.inputs.builtin_types;
    let declared = target
        .declaration
        .and_then(|declaration| builtin_types.value_of_call_signature(declaration))
        .and_then(builtin_value_of)
        .and_then(find_validating_function);
    let Some(function) = declared else {
        return find_written_result(file, call, &target);
    };
    let expected = find_validated_result(file, call, &site, function);
    if expected.is_some() && resolved.is_none() {
        report_at(file, call, Code::TypedParseCalleeIsNotResolved, &[]);
    }
    expected
}

fn find_validated_result(
    file: &mut FileLowering<'_, '_, '_, '_>,
    call: ExprId,
    site: &Call,
    function: ValidatingFunction,
) -> Option<ExpectedResultId> {
    match function {
        ValidatingFunction::Validate => {
            if let Err(code) = check_validate_call(file, site) {
                report_at(file, call, code, &[]);
                return None;
            }
        }
        ValidatingFunction::Parse if file.hir.list_at(site.type_args).is_empty() => {
            if is_imported_json(file, site.callee) {
                report_at(file, call, Code::TypedParseNeedsTypeArgument, &[]);
            }
            return None;
        }
        ValidatingFunction::Parse => {}
    }
    let checked = match file.queries.resolved_call(call) {
        Ok(Some(target)) => target.result.checked,
        Ok(None) => return None,
        Err(reason) => Err(reason),
    };
    let ty = match checked {
        Ok(ty) => ty,
        Err(reason) => {
            let error = ValidationError::GaveUp(reason);
            report_validation_error(file, call, function, None, &error);
            return None;
        }
    };
    let shape = file.queries.type_shape(ty).map(|shape| shape.kind);
    if let Ok(ShapeKind::Anything(AnythingReason::Any | AnythingReason::Unknown)) = shape {
        return None;
    }
    let position = file.hir[call].pos;
    let written = file.hir.ids(file.hir.list_at(site.type_args)).next()?;
    let expected = match validation_nodes(file, ty, written, position) {
        Ok(nodes) => add_expected_result(file, call, ty, nodes.to_vec()),
        Err(error) => Err(error),
    };
    match expected {
        Ok(expected) => Some(expected),
        Err(error) => {
            report_validation_error(file, call, function, Some(ty), &error);
            None
        }
    }
}

fn callee_text(function: ValidatingFunction) -> &'static [u8] {
    match function {
        ValidatingFunction::Parse => b"JSON.parse",
        ValidatingFunction::Validate => b"validate",
    }
}

fn check_validate_call(file: &FileLowering<'_, '_, '_, '_>, site: &Call) -> Result<(), Code> {
    let hir = file.hir;
    if hir.is_js {
        return Err(Code::ValidateNeedsTypeScript);
    }
    if hir.list_at(site.type_args).is_empty() {
        return Err(Code::ValidateNeedsTypeArgument);
    }
    if site.chain == Chain::Start {
        return Err(Code::ValidateOptionalCall);
    }
    match hir.ids(site.args).next() {
        Some(argument)
            if site.args.len() == 1 && !matches!(hir[argument].kind, ExprKind::Spread(_)) =>
        {
            Ok(())
        }
        Some(_) | None => Err(Code::ValidateArgumentCount),
    }
}

fn is_imported_json(file: &FileLowering<'_, '_, '_, '_>, callee: ExprId) -> bool {
    let callee = expression::skip_type_syntax(file, callee);
    let Some((object, _)) = file.hir.member_key(callee) else {
        return false;
    };
    let object = expression::skip_type_syntax(file, object);
    let ExprKind::Ident(_) = file.hir[object].kind else {
        return false;
    };
    let Binding::Symbol(symbol) = file.bound.binding(object) else {
        return false;
    };
    matches!(
        file.inputs.modules.import_binding(file.file, symbol),
        ImportBinding::Builtin(_) | ImportBinding::CapturedBuiltin { .. }
    )
}

pub(super) fn result_type(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
    position: u32,
) -> TypeId {
    let mapped = types::map_type_at(file, ty, position);
    if !mapped.is_checked || mapped.ty == TypeTable::ANYTHING {
        return TypeTable::ANYTHING;
    }
    // Every mapped type admits `undefined` and `null`.
    match file.queries.without_nullish(ty) {
        Ok(listed) if listed == ty => file
            .fragment
            .types
            .without_primitives(mapped.ty, Primitives::NULLISH),
        Ok(_) | Err(_) => mapped.ty,
    }
}

fn has_body(file: &FileLowering<'_, '_, '_, '_>, declaration: FunctionRef) -> bool {
    match file.queries.files().hir(declaration.file)[declaration.function].body {
        FnBody::None => false,
        FnBody::Block(_) | FnBody::Expr(_) => true,
    }
}

fn find_written_result(
    file: &mut FileLowering<'_, '_, '_, '_>,
    call: ExprId,
    target: &CallTarget,
) -> Option<ExpectedResultId> {
    let written = match target.result.written {
        WrittenType::Written(written) => written,
        WrittenType::Unwritten | WrittenType::GaveUp(_) => return None,
    };
    // The record says what code that the engine cannot see creates. It sees a body.
    if target
        .declaration
        .is_some_and(|declaration| has_body(file, declaration))
    {
        return None;
    }
    let position = file.hir[call].pos;
    let ty = result_type(file, written, position);
    if ty == TypeTable::ANYTHING {
        return None;
    }
    let limit = LimitId::MaxExpectedResultLayouts;
    let Some(layouts) = layouts::collect_reached_layouts(file, ty, limit) else {
        file.gave_up(limit, position);
        return None;
    };
    let expected = ExpectedResult {
        ty,
        layouts,
        site: None,
        validation: Vec::new(),
    };
    // A built-in may build what its type argument says: `response.json<T>()`.
    let builtin_types = file.inputs.builtin_types;
    let is_builtin = target
        .declaration
        .and_then(|declaration| builtin_types.value_of_call_signature(declaration))
        .and_then(builtin_value_of)
        .is_some();
    Some(match is_builtin {
        true => file.fragment.add_expected_result(expected),
        false => file.fragment.add_described_result(expected),
    })
}

fn add_expected_result(
    file: &mut FileLowering<'_, '_, '_, '_>,
    call: ExprId,
    ty: CheckerTypeId,
    validation: Vec<ValidationNode>,
) -> Result<ExpectedResultId, ValidationError> {
    let position = file.hir[call].pos;
    let result = result_type(file, ty, position);
    let limit = LimitId::MaxValidationNodes;
    let Some(mut layouts) = layouts::collect_reached_layouts(file, result, limit) else {
        file.gave_up(limit, position);
        return Err(ValidationError::TooLarge);
    };
    for node in &validation {
        if let ValidationShape::Object {
            layout: Some(layout),
            ..
        } = &node.shape
        {
            layouts.push(*layout);
        }
    }
    layouts.shared_sort_unstable();
    layouts.dedup();
    let origin = SiteOrigin {
        kind: TypeSiteKind::CallResult,
        position,
    };
    let site = Some(positions::add_type_site(file, origin, Some(ty)));
    Ok(file.fragment.add_expected_result(ExpectedResult {
        ty: result,
        layouts,
        site,
        validation,
    }))
}

fn report_validation_error(
    file: &mut FileLowering<'_, '_, '_, '_>,
    call: ExprId,
    function: ValidatingFunction,
    ty: Option<CheckerTypeId>,
    error: &ValidationError,
) {
    let described = match error {
        ValidationError::TypeParameter { text } => {
            report_at(
                file,
                call,
                Code::ValidationTypeParameter,
                &[text.as_slice()],
            );
            return;
        }
        ValidationError::GaveUp(GaveUp::ErrorType) => return,
        ValidationError::Unsupported { described } => Some(described.as_slice()),
        ValidationError::TooLarge
        | ValidationError::GaveUp(
            GaveUp::Unresolved | GaveUp::FlowAnalysisDisabled | GaveUp::UnreachedNode,
        ) => None,
    };
    let type_text = find_type_text(file, call, ty);
    let described = described.unwrap_or(type_text.as_slice());
    let arguments = [callee_text(function), type_text.as_slice(), described];
    report_at(file, call, Code::UnsupportedValidationType, &arguments);
}

fn find_type_text(
    file: &mut FileLowering<'_, '_, '_, '_>,
    call: ExprId,
    ty: Option<CheckerTypeId>,
) -> Vec<u8> {
    if let Some(ty) = ty {
        return file.queries.type_text(ty);
    }
    let hir = file.hir;
    let (ExprKind::Call(id) | ExprKind::TaggedTemplate(id)) = hir[call].kind else {
        return Vec::new();
    };
    let Some(argument) = hir.ids(hir.list_at(hir[id].type_args)).next() else {
        return Vec::new();
    };
    let range = hir[argument].pos as usize..hir[argument].end as usize;
    hir.text.get(range).unwrap_or_default().to_vec()
}

pub(super) fn report_at(
    file: &mut FileLowering<'_, '_, '_, '_>,
    expression: ExprId,
    code: Code,
    arguments: &[&[u8]],
) {
    let span = file.span_of(NodeData::Expr(expression));
    file.diagnostics.report(code, span, arguments);
}
