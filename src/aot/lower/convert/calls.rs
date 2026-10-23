use bun_sema::check::aot::{
    CallTarget, FunctionRef, GaveUp, PositionTypes, ShapeKind, SignatureParameter, WrittenType,
};
use bun_sema::hir::{ExprId, ExprKind};

use super::edges::Construct;
use super::int32_flows::FlowingValue;
use super::patterns::{collect_element_types_from, find_element_type};
use super::supertypes::ConversionKind;
use super::{Int32FlowDescription, Int32Subject, members, supertypes};
use crate::ir::generated::TypeSiteKind;
use crate::ir::{DeclaredType, ValueId};
use crate::lower::positions::{self, SiteOrigin};
use crate::lower::types::lists_int32;
use crate::lower::{CheckerTypeId, FileLowering, FunctionLowering, layouts};

// `box.get()` with `box: Box<string>` and `get(): T`: the type argument was written with the receiver's type.
fn find_result_through_written_receiver(
    file: &mut FileLowering<'_, '_, '_, '_>,
    call: ExprId,
) -> Option<WrittenType> {
    let ExprKind::Call(site) = file.hir[call].kind else {
        return None;
    };
    let callee = file.hir[site].callee;
    file.hir.member_key(callee)?;
    let method = members::find_written_type(file, callee)?;
    let ShapeKind::Function(&[signature]) = file.queries.type_shape(method).ok()?.kind else {
        return None;
    };
    let shape = file.queries.signature(signature);
    let declared = file.queries.function_signature(shape.declaration?);
    let written = shape.result.written;
    let is_instantiated = !shape.has_type_parameters && written != declared.result.written;
    is_instantiated.then_some(written)
}

fn has_instantiated_result(file: &mut FileLowering<'_, '_, '_, '_>, target: CallTarget) -> bool {
    let Some(declaration) = target.declaration else {
        return false;
    };
    let called = file.queries.signature_result(target.signature);
    called != file.queries.function_signature(declaration).result.checked
}

// The type comes from the call, not from the type of the callee: a function type lists the functions that were converted to it, and says nothing of what they return.
pub(super) fn claim_call_result(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
    value: ValueId,
) -> ValueId {
    if !lowering.file.is_checked() {
        return value;
    }
    let Ok(Some(mut target)) = lowering.file.queries.resolved_call(call) else {
        return value;
    };
    let is_instantiated = has_instantiated_result(lowering.file, target);
    match find_result_through_written_receiver(lowering.file, call) {
        Some(written) => target.result.written = written,
        // What is written is the type parameter. The checker has what this call puts in its place.
        None if is_instantiated => target.result.written = WrittenType::Unwritten,
        None => {}
    }
    let origin = SiteOrigin {
        kind: TypeSiteKind::CallResult,
        position: lowering.file.hir[call].pos,
    };
    let declared = positions::create_position(lowering.file, target.result, origin);
    let construct = Construct::CallResult {
        declaration: target.declaration,
        is_instantiated,
    };
    super::convert_read(lowering, value, declared, construct)
}

pub(super) fn convert_arguments(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
    arguments: &mut [ValueId],
) {
    let hir = lowering.file.hir;
    let (site, first_parameter) = match hir[call].kind {
        ExprKind::Call(site) | ExprKind::New(site) => (site, 0),
        ExprKind::TaggedTemplate(site) => (site, 1),
        _ => return,
    };
    let expressions = hir.ids(hir[site].args);
    if expressions.len() + first_parameter != arguments.len() {
        debug_assert!(false, "each argument expression has one value");
        return;
    }
    let arguments = &mut arguments[first_parameter..];
    let Ok(Some(target)) = lowering.file.queries.resolved_call(call) else {
        return;
    };
    layouts::record_call_type_arguments(lowering.file, call);
    let shape = lowering.file.queries.signature(target.signature);
    // The signature of a call holds the receiver's type arguments, which may be inferred.
    let declared_parameters = match target.declaration {
        Some(declaration) => {
            lowering
                .file
                .queries
                .function_signature(declaration)
                .parameters
        }
        None => shape.parameters,
    };
    for (index, (expression, value)) in (first_parameter..).zip(expressions.zip(arguments)) {
        let Some(types) = find_parameter_types(lowering.file, shape.parameters, index) else {
            continue;
        };
        let declared = find_parameter_types(lowering.file, declared_parameters, index)
            .map_or(WrittenType::Unwritten, |declared| declared.written);
        let is_optional =
            (shape.parameters.get(index)).is_some_and(|parameter| parameter.is_optional);
        let parameter = Parameter {
            callee: target.declaration,
            index,
            types,
            declared,
            is_optional,
        };
        *value = convert_argument(lowering, expression, parameter, *value);
    }
}

#[derive(Copy, Clone)]
struct Parameter {
    callee: Option<FunctionRef>,
    index: usize,
    types: PositionTypes,
    declared: WrittenType,
    is_optional: bool,
}

fn find_int32_position(
    file: &mut FileLowering<'_, '_, '_, '_>,
    parameter: Parameter,
    position: u32,
) -> Option<DeclaredType> {
    let declared = parameter.declared.written()?;
    if !lists_int32(file, declared) {
        return None;
    }
    let origin = SiteOrigin {
        kind: TypeSiteKind::Parameter,
        position,
    };
    let declared = positions::create_position(file, parameter.types, origin);
    Some(match parameter.is_optional {
        true => positions::add_undefined(file, declared),
        false => declared,
    })
}

// The callee tests its parameters where it is entered.
fn convert_argument(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    parameter: Parameter,
    value: ValueId,
) -> ValueId {
    let types = parameter.types;
    let checked = types.checked.ok();
    let written = types.written.written();
    let distinct_written = written.filter(|_| written != checked);
    for parameter_type in checked.into_iter().chain(distinct_written) {
        let kind = ConversionKind::Performed;
        supertypes::record_flow_into_type(lowering.file, expression, parameter_type, kind);
    }
    let position = lowering.file.hir[expression].pos;
    let Some(declared) = find_int32_position(lowering.file, parameter, position) else {
        return value;
    };
    if let Some(callee) = parameter.callee {
        let subject = Int32Subject::Argument {
            callee,
            index: parameter.index,
        };
        super::describe_int32_flow(lowering, declared, subject, Some(expression));
    }
    super::convert_initializer(lowering, value, declared, Some(expression))
}

// No operation holds one element of a spread argument, so the flow into the first `int32` parameter that the spread can reach is a request for the list, which no proof admits.
pub(super) fn convert_argument_list(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
    list: ValueId,
) {
    let hir = lowering.file.hir;
    let (ExprKind::Call(site) | ExprKind::New(site)) = hir[call].kind else {
        return;
    };
    let mut arguments = hir.ids(hir[site].args).enumerate();
    let spread = arguments.find(|&(_, argument)| matches!(hir[argument].kind, ExprKind::Spread(_)));
    let Some((first_spread, spread)) = spread else {
        return;
    };
    let Ok(Some(target)) = lowering.file.queries.resolved_call(call) else {
        return;
    };
    layouts::record_call_type_arguments(lowering.file, call);
    record_listed_arguments(lowering.file, call, target);
    let Some(callee) = target.declaration else {
        return;
    };
    let parameters = lowering.file.queries.function_signature(callee).parameters;
    let position = hir[spread].pos;
    for (index, parameter) in parameters.iter().enumerate().skip(first_spread) {
        if parameter.is_rest {
            return;
        }
        let parameter = Parameter {
            callee: Some(callee),
            index,
            types: parameter.types,
            declared: parameter.types.written,
            is_optional: parameter.is_optional,
        };
        let Some(declared) = find_int32_position(lowering.file, parameter, position) else {
            continue;
        };
        lowering.described_int32_flow = Some(Int32FlowDescription {
            subject: Int32Subject::Argument { callee, index },
            value: FlowingValue::PassedBySpread,
        });
        let call_position = lowering.position();
        lowering.set_position(position);
        super::convert(lowering, list, declared, None);
        lowering.set_position(call_position);
        return;
    }
}

// In front of the first spread each argument has its parameter.
fn record_listed_arguments(
    file: &mut FileLowering<'_, '_, '_, '_>,
    call: ExprId,
    target: CallTarget,
) {
    let hir = file.hir;
    let (ExprKind::Call(site) | ExprKind::New(site)) = hir[call].kind else {
        return;
    };
    let parameters = file.queries.signature(target.signature).parameters;
    let mut first_reached = 0;
    let mut is_behind_spread = false;
    for (index, argument) in hir.ids(hir[site].args).enumerate() {
        let spread = if let ExprKind::Spread(spread) = hir[argument].kind {
            Some(spread)
        } else {
            None
        };
        if !is_behind_spread {
            first_reached = index;
        }
        is_behind_spread |= spread.is_some();
        let (last_reached, kind) = match is_behind_spread {
            true => (
                parameters.len().max(first_reached + 1),
                ConversionKind::Asserted,
            ),
            false => (first_reached + 1, ConversionKind::Performed),
        };
        for reached in first_reached..last_reached {
            let Some(types) = find_parameter_types(file, parameters, reached) else {
                continue;
            };
            let Ok(parameter_type) = types.checked else {
                continue;
            };
            match spread {
                Some(spread) => record_spread_flow(file, spread, parameter_type),
                None => supertypes::record_flow_into_type(file, argument, parameter_type, kind),
            }
        }
    }
}

fn record_spread_flow(
    file: &mut FileLowering<'_, '_, '_, '_>,
    spread: ExprId,
    parameter_type: CheckerTypeId,
) {
    let Ok(list) = file.queries.expression_type(spread) else {
        return;
    };
    let position = file.hir[spread].pos;
    for element in collect_element_types_from(file, list, 0) {
        let kind = ConversionKind::Asserted;
        supertypes::record_conversion(file, element, parameter_type, position, kind);
    }
}

pub(super) fn find_parameter_types(
    file: &mut FileLowering<'_, '_, '_, '_>,
    parameters: &[SignatureParameter],
    index: usize,
) -> Option<PositionTypes> {
    let (last, leading) = parameters.split_last()?;
    if let Some(parameter) = leading.get(index) {
        return (!parameter.is_rest).then_some(parameter.types);
    }
    if !last.is_rest {
        return (index == leading.len()).then_some(last.types);
    }
    let place = index - leading.len();
    let written = match last.types.written {
        WrittenType::Written(ty) => {
            find_element_type(file, ty, place).map_or(WrittenType::Unwritten, WrittenType::Written)
        }
        WrittenType::Unwritten | WrittenType::GaveUp(_) => last.types.written,
    };
    let checked = last
        .types
        .checked
        .and_then(|ty| find_element_type(file, ty, place).ok_or(GaveUp::Unresolved));
    Some(PositionTypes { written, checked })
}
