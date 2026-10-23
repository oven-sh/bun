mod calls;
mod edges;
mod family_facts;
mod int32_flows;
mod literals;
mod members;
mod narrowed;
mod patterns;
mod supertypes;

use bun_sema::check::aot::{CheckedType, PositionTypes, WrittenType};
use bun_sema::hir::{ExprId, ExprKind, TypeNodeId};
use rustc_hash::{FxHashMap, FxHashSet};
use std::rc::Rc;

use self::edges::{Construct, Edge, classify_edge};
use self::int32_flows::FlowingValue;
use self::supertypes::{AssertionSide, ComparedPair, ConversionKind};
use super::positions::{self, SiteOrigin};
use super::types::map_type_at;
use super::{CheckerTypeId, FileLowering, FunctionLowering};
use crate::ir::generated::{IllTypedCause, TypeSiteKind};
use crate::ir::{
    ContentsSlot, DeclaredType, FunctionId, Id, Mapped, PositionFlags, Primitives, Type, TypeFlags,
    TypeId, TypeTable, ValueId,
};

pub(crate) use self::family_facts::FamilyFacts;
pub(in crate::lower) use self::int32_flows::{
    FlowDescription as Int32FlowDescription, Subject as Int32Subject,
};
pub(in crate::lower) use self::literals::{
    record_array_literal_flow, record_list_flow, record_spread_flow,
};
pub(in crate::lower) use self::members::find_array_element_type;
pub(in crate::lower) use self::narrowed::{convert_narrowed_reference, convert_pattern_element};
pub(in crate::lower) use self::patterns::{
    record_assigned_type_flow, record_assignment_pattern_flow, record_binding_pattern_flow,
};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
struct ConvertedValue {
    ty: TypeId,
    is_checked: bool,
}

#[derive(Default)]
struct ConvertedValues {
    function: Option<FunctionId>,
    values: Vec<Option<ConvertedValue>>,
}

impl ConvertedValues {
    fn enter(&mut self, function: FunctionId) {
        if self.function != Some(function) {
            self.function = Some(function);
            self.values.clear();
        }
    }

    fn has_type_of(
        &mut self,
        function: FunctionId,
        value: ValueId,
        position: DeclaredType,
    ) -> bool {
        self.enter(function);
        match self.values.get(value.index()).copied().flatten() {
            Some(converted) => {
                converted.ty == position.ty && (converted.is_checked || position.is_expected())
            }
            None => false,
        }
    }

    fn type_of(&mut self, function: FunctionId, value: ValueId) -> Option<TypeId> {
        self.enter(function);
        let converted = self.values.get(value.index()).copied().flatten()?;
        Some(converted.ty)
    }

    fn record(&mut self, function: FunctionId, value: ValueId, position: DeclaredType) {
        self.enter(function);
        if self.values.len() <= value.index() {
            self.values.resize(value.index() + 1, None);
        }
        self.values[value.index()] = Some(ConvertedValue {
            ty: position.ty,
            is_checked: !position.is_expected(),
        });
    }
}

#[derive(Default)]
pub(in crate::lower) struct ConversionState {
    written_expressions: FxHashMap<ExprId, Option<CheckerTypeId>>,
    compared_types: FxHashMap<ComparedPair, u8>,
    types_with_layout: FxHashMap<(CheckerTypeId, AssertionSide), Rc<[CheckerTypeId]>>,
    admitted_assertions: FxHashSet<(CheckerTypeId, CheckerTypeId, u8)>,
    loose_types: FxHashMap<CheckerTypeId, bool>,
    converted_values: ConvertedValues,
}

pub(crate) fn establishes_type(position: DeclaredType) -> bool {
    !position.is_expected()
}

fn emit_convert(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    value: ValueId,
    position: DeclaredType,
    cause: IllTypedCause,
) -> ValueId {
    let converted = lowering.builder.convert(value, position, cause);
    let function = lowering.function;
    let values = &mut lowering.file.types.conversions.converted_values;
    values.record(function, converted, position);
    converted
}

// The build proves a promise of an `int32` at each request for it.
fn is_converted(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    value: ValueId,
    position: DeclaredType,
) -> bool {
    let function = lowering.function;
    let values = &mut lowering.file.types.conversions.converted_values;
    !position.flags.contains(PositionFlags::IS_INT32_PROMISE)
        && values.has_type_of(function, value, position)
}

// What a type guard or an assertion claims for a value can lie outside the type of the variable that holds it.
pub(in crate::lower) fn is_converted_within(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    value: ValueId,
    position: DeclaredType,
) -> bool {
    if position.is_expected() || position.ty == TypeTable::ANYTHING {
        return true;
    }
    let function = lowering.function;
    let values = &mut lowering.file.types.conversions.converted_values;
    match values.type_of(function, value) {
        Some(converted) => {
            lowering.file.fragment.types.union(position.ty, converted) == position.ty
        }
        None => false,
    }
}

pub(in crate::lower) fn expect_type(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    value: ValueId,
    expected: TypeId,
) -> ValueId {
    if expected == TypeTable::ANYTHING || expected == TypeTable::NEVER {
        return value;
    }
    let position = DeclaredType::new(Mapped::expected(expected), None, PositionFlags::default());
    if is_converted(lowering, value, position) {
        return value;
    }
    emit_convert(lowering, value, position, IllTypedCause::None)
}

fn is_non_null_assertion(file: &FileLowering<'_, '_, '_, '_>, mut expression: ExprId) -> bool {
    while let ExprKind::Satisfies { expr: operand, .. } = file.hir[expression].kind {
        expression = operand;
    }
    matches!(file.hir[expression].kind, ExprKind::NonNull(_))
}

fn find_cause(
    file: &mut FileLowering<'_, '_, '_, '_>,
    position: DeclaredType,
    source: Option<ExprId>,
    target: Option<CheckerTypeId>,
    construct: Construct,
) -> IllTypedCause {
    if position.is_expected() {
        return IllTypedCause::None;
    }
    // `x!` takes the programmer's word for what the checker could not show.
    if source.is_some_and(|source| is_non_null_assertion(file, source)) {
        return IllTypedCause::Assertion;
    }
    let source_position = source.map_or(0, |source| file.hir[source].pos);
    let source = source.and_then(|source| file.queries.expression_type(source).ok());
    if let (Some(source), Construct::Flow) = (source, construct) {
        let source = map_type_at(file, source, source_position).ty;
        file.fragment
            .family_facts
            .record_conversion(source, position.ty);
    }
    classify_edge(
        file,
        Edge {
            source,
            target,
            position,
            construct,
        },
    )
}

// What the checker has concluded of the value was not sent where the value was read, and the position does not take all that the value may be without it.
fn rests_on_unclaimed_narrowing(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    value: ValueId,
    position: DeclaredType,
) -> bool {
    let Some(&before) = lowering.unclaimed_narrowings.get(&value) else {
        return false;
    };
    !position.is_expected()
        && lowering.file.fragment.types.union(position.ty, before) != position.ty
}

fn convert_as(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    value: ValueId,
    position: DeclaredType,
    source: Option<ExprId>,
    construct: Construct,
) -> ValueId {
    let description = lowering.described_int32_flow.take();
    let target = supertypes::find_target_type(lowering.file, position);
    if let (Some(source), Some(target)) = (source, target) {
        let kind = match construct {
            Construct::Assertion => ConversionKind::Asserted,
            Construct::Flow
            | Construct::ContentsRead
            | Construct::IndexSignatureRead
            | Construct::CallResult { .. } => ConversionKind::Performed,
        };
        supertypes::record_flow_into_type(lowering.file, source, target, kind);
    }
    if position.ty == TypeTable::ANYTHING {
        return value;
    }
    if let Some(description) = description {
        int32_flows::record_flow(lowering, position, description);
    }
    if is_converted(lowering, value, position) {
        return value;
    }
    let cause = match find_cause(lowering.file, position, source, target, construct) {
        IllTypedCause::None if rests_on_unclaimed_narrowing(lowering, value, position) => {
            IllTypedCause::Assertion
        }
        cause => cause,
    };
    emit_convert(lowering, value, position, cause)
}

pub(crate) fn convert(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    value: ValueId,
    position: DeclaredType,
    source: Option<ExprId>,
) -> ValueId {
    convert_as(lowering, value, position, source, Construct::Flow)
}

// The conversion of a declaration or a literal is at the value. That of an assignment is at the assignment.
pub(crate) fn convert_initializer(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    value: ValueId,
    position: DeclaredType,
    initializer: Option<ExprId>,
) -> ValueId {
    let target_position = lowering.position();
    if let Some(initializer) = initializer {
        lowering.set_position(lowering.file.hir[initializer].pos);
    }
    let converted = convert(lowering, value, position, initializer);
    lowering.set_position(target_position);
    converted
}

// `false`, `"a"`, `undefined` and unions of them.
fn is_literal_type(ty: &Type) -> bool {
    let any_object = TypeFlags::ANY_OBJECT_OR_FUNCTION | TypeFlags::HAS_MEMBERS_WITHOUT_LAYOUT;
    let has_objects = ty.flags.intersects(any_object)
        || !(ty.layouts.is_empty()
            && ty.classes.is_empty()
            && ty.builtins.is_empty()
            && ty.functions.is_empty());
    if has_objects || ty.is_internal() {
        return false;
    }
    let has_whole_kind = !ty
        .primitives
        .without(Primitives::NULLISH | Primitives::BOOLEAN)
        .is_empty();
    ty.integer_range().is_none() && !has_whole_kind && !ty.primitives.contains(Primitives::BOOLEAN)
}

// `before` is the type of what the reference names, `narrowed` what the checker says of the reference at this place.
pub(in crate::lower) fn convert_narrowed(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    value: ValueId,
    before: TypeId,
    narrowed: Mapped,
    origin: Option<SiteOrigin>,
) -> ValueId {
    let says_nothing = narrowed.ty == TypeTable::ANYTHING || narrowed.ty == TypeTable::NEVER;
    if says_nothing || narrowed.ty == before {
        return value;
    }
    if is_literal_type(lowering.file.fragment.types.get(narrowed.ty)) {
        lowering.unclaimed_narrowings.insert(value, before);
        return value;
    }
    let site = origin
        .filter(|_| narrowed.is_checked)
        .map(|origin| positions::add_type_site(lowering.file, origin, None));
    let position = DeclaredType::new(narrowed, site, PositionFlags::default());
    if is_converted(lowering, value, position) {
        return value;
    }
    let cause = match position.is_expected() {
        true => IllTypedCause::None,
        false => IllTypedCause::Assertion,
    };
    emit_convert(lowering, value, position, cause)
}

/// Says what the position of the next `convert` is, for the message about an `int32` that is not proven.
pub(in crate::lower) fn describe_int32_flow(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    position: DeclaredType,
    subject: Int32Subject,
    source: Option<ExprId>,
) {
    if position.flags.contains(PositionFlags::IS_INT32_PROMISE) {
        let value = source.map_or(FlowingValue::AssignedByPattern, FlowingValue::Expression);
        lowering.described_int32_flow = Some(Int32FlowDescription { subject, value });
    }
}

/// The casts of a tail call are at the position of the call.
pub(in crate::lower) fn describe_int32_tail_call(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
) {
    let description = Int32FlowDescription {
        subject: Int32Subject::Result,
        value: FlowingValue::Expression(call),
    };
    let returned = lowering.returned;
    int32_flows::record_flow(lowering, returned, description);
}

pub(crate) fn record_contents_flow(
    file: &mut FileLowering<'_, '_, '_, '_>,
    container: ExprId,
    slot: ContentsSlot,
    position: DeclaredType,
) {
    supertypes::record_contents_flow(file, container, slot, position);
}

pub(crate) fn record_construction_by_library(
    file: &mut FileLowering<'_, '_, '_, '_>,
    expression: ExprId,
    callee: ExprId,
) {
    supertypes::record_construction_by_library(file, expression, callee);
}

pub(crate) fn record_type_flow(
    file: &mut FileLowering<'_, '_, '_, '_>,
    source: CheckerTypeId,
    target: CheckerTypeId,
    position: u32,
) {
    supertypes::record_conversion(file, source, target, position, ConversionKind::Performed);
}

pub(crate) fn record_heritage_flow(
    file: &mut FileLowering<'_, '_, '_, '_>,
    instance: CheckerTypeId,
    inherited: CheckerTypeId,
    position: u32,
) {
    record_type_flow(file, instance, inherited, position);
}

pub(crate) fn convert_assertion(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    assertion: ExprId,
    value: ValueId,
) -> ValueId {
    let ExprKind::As { expr, ty } = lowering.file.hir[assertion].kind else {
        debug_assert!(false, "a type assertion was expected");
        return value;
    };
    let position = assertion_position(lowering.file, ty);
    describe_int32_flow(lowering, position, Int32Subject::Assertion, Some(expr));
    convert_as(lowering, value, position, Some(expr), Construct::Assertion)
}

pub(crate) fn assertion_position(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: TypeNodeId,
) -> DeclaredType {
    positions::annotation_position(file, ty, TypeSiteKind::Assertion)
}

pub(crate) fn convert_to_member(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    access: ExprId,
    value: ValueId,
    source: Option<ExprId>,
) -> ValueId {
    members::convert_to_member(lowering, access, value, source)
}

pub(crate) fn convert_arguments(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
    arguments: &mut [ValueId],
) {
    calls::convert_arguments(lowering, call, arguments);
}

pub(crate) fn convert_argument_list(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
    list: ValueId,
) {
    calls::convert_argument_list(lowering, call, list);
}

pub(crate) fn claim_member_read(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    access: ExprId,
    value: ValueId,
) -> ValueId {
    members::claim_member_read(lowering, access, value)
}

// No container says what it holds, so what is read out of one is tested where it is read.
pub(crate) fn claim_contents_read(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    contents: CheckedType,
    kind: TypeSiteKind,
    value: ValueId,
) -> ValueId {
    if !lowering.file.is_checked() {
        return value;
    }
    let types = PositionTypes {
        written: WrittenType::Unwritten,
        checked: contents,
    };
    let origin = SiteOrigin {
        kind,
        position: lowering.position(),
    };
    let position = positions::create_position(lowering.file, types, origin);
    convert_read(lowering, value, position, Construct::ContentsRead)
}

fn convert_read(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    value: ValueId,
    position: DeclaredType,
    construct: Construct,
) -> ValueId {
    if position.ty == TypeTable::NEVER {
        return value;
    }
    convert_as(lowering, value, position, None, construct)
}

pub(crate) fn claim_call_result(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
    value: ValueId,
) -> ValueId {
    calls::claim_call_result(lowering, call, value)
}
