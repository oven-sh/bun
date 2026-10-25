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

use self::edges::Construct;
use self::int32_flows::FlowingValue;
use self::supertypes::{AssertionSide, ComparedPair, ConversionKind};
use super::positions::{self, SiteOrigin};
use super::{CheckerTypeId, FileLowering, FunctionLowering};
use crate::ir::generated::{IllTypedCause, TypeSiteKind};
use crate::ir::{
    DeclaredType, FunctionId, Id, Mapped, PositionFlags, Primitives, Type, TypeFlags, TypeId,
    TypeTable, ValueId,
};

pub(crate) use self::family_facts::FamilyFacts;
pub(in crate::lower) use self::int32_flows::{
    FlowDescription as Int32FlowDescription, Subject as Int32Subject,
};
pub(in crate::lower) use self::literals::record_spread_flow;

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

    fn get(&mut self, function: FunctionId, value: ValueId) -> Option<ConvertedValue> {
        self.enter(function);
        self.values.get(value.index()).copied().flatten()
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

impl FunctionLowering<'_, '_, '_, '_, '_> {
    fn emit_convert(
        &mut self,
        value: ValueId,
        position: DeclaredType,
        cause: IllTypedCause,
    ) -> ValueId {
        let converted = self.builder.convert(value, position, cause);
        let function = self.function;
        let values = &mut self.file.types.conversions.converted_values;
        values.record(function, converted, position);
        converted
    }

    // The build proves a promise of an `int32` at each request for it.
    fn is_converted(&mut self, value: ValueId, position: DeclaredType) -> bool {
        let function = self.function;
        let values = &mut self.file.types.conversions.converted_values;
        !position.flags.contains(PositionFlags::IS_INT32_PROMISE)
            && values.get(function, value).is_some_and(|converted| {
                converted.ty == position.ty && (converted.is_checked || position.is_expected())
            })
    }

    // What a type guard or an assertion claims for a value can lie outside the type of the variable that holds it.
    pub(in crate::lower) fn is_converted_within(
        &mut self,
        value: ValueId,
        position: DeclaredType,
    ) -> bool {
        if position.is_expected() || position.ty == TypeTable::ANYTHING {
            return true;
        }
        let function = self.function;
        let values = &mut self.file.types.conversions.converted_values;
        match values.get(function, value) {
            Some(converted) => {
                self.file.fragment.types.union(position.ty, converted.ty) == position.ty
            }
            None => false,
        }
    }

    // What the checker has concluded of the value was not sent where the value was read, and the position does not take all that the value may be without it.
    fn rests_on_unclaimed_narrowing(&mut self, value: ValueId, position: DeclaredType) -> bool {
        let Some(&before) = self.unclaimed_narrowings.get(&value) else {
            return false;
        };
        !position.is_expected()
            && self.file.fragment.types.union(position.ty, before) != position.ty
    }

    fn convert_as(
        &mut self,
        value: ValueId,
        position: DeclaredType,
        source: Option<ExprId>,
        construct: Construct,
    ) -> ValueId {
        let description = self.described_int32_flow.take();
        // A value with no number in its type cannot break the promise of an `int32`.
        let is_promise = position.flags.contains(PositionFlags::IS_INT32_PROMISE);
        let position = match source {
            Some(source) if is_promise && self.file.has_no_number(source) => {
                let flags = position.flags.without(PositionFlags::IS_INT32_PROMISE);
                DeclaredType { flags, ..position }
            }
            _ => position,
        };
        let target = self.file.find_target_type(position);
        if let (Some(source), Some(target)) = (source, target) {
            let kind = match construct {
                Construct::Assertion => ConversionKind::Asserted,
                _ => ConversionKind::Performed,
            };
            self.file.record_flow_into_type(source, target, kind);
        }
        if position.ty == TypeTable::ANYTHING {
            return value;
        }
        if let Some(description) = description {
            self.record_flow(position, description);
        }
        if self.is_converted(value, position) {
            return value;
        }
        let cause = match self.file.find_cause(position, source, target, construct) {
            IllTypedCause::None if self.rests_on_unclaimed_narrowing(value, position) => {
                IllTypedCause::Assertion
            }
            cause => cause,
        };
        self.emit_convert(value, position, cause)
    }

    // The conversion of a declaration or a literal is at the value. That of an assignment is at the assignment.
    pub(crate) fn convert_initializer(
        &mut self,
        value: ValueId,
        position: DeclaredType,
        initializer: Option<ExprId>,
    ) -> ValueId {
        let target_position = self.position();
        if let Some(initializer) = initializer {
            self.set_position(self.file.hir[initializer].pos);
        }
        let converted = convert(self, value, position, initializer);
        self.set_position(target_position);
        converted
    }

    pub(in crate::lower) fn convert_narrowed(
        &mut self,
        value: ValueId,
        before: TypeId,
        narrowed: Mapped,
        origin: Option<SiteOrigin>,
    ) -> ValueId {
        let says_nothing = narrowed.ty == TypeTable::ANYTHING || narrowed.ty == TypeTable::NEVER;
        if says_nothing || narrowed.ty == before {
            return value;
        }
        if is_literal_type(self.file.fragment.types.get(narrowed.ty)) {
            self.unclaimed_narrowings.insert(value, before);
            return value;
        }
        let site = origin
            .filter(|_| narrowed.is_checked)
            .map(|origin| positions::add_type_site(self.file, origin, None));
        let position = DeclaredType::new(narrowed, site, PositionFlags::default());
        if self.is_converted(value, position) {
            return value;
        }
        let cause = match position.is_expected() {
            true => IllTypedCause::None,
            false => IllTypedCause::Assertion,
        };
        self.emit_convert(value, position, cause)
    }

    /// Says what the position of the next `convert` is, for the message about an `int32` that is not proven.
    pub(in crate::lower) fn describe_int32_flow(
        &mut self,
        position: DeclaredType,
        subject: Int32Subject,
        source: Option<ExprId>,
    ) {
        if position.flags.contains(PositionFlags::IS_INT32_PROMISE) {
            let value = source.map_or(FlowingValue::AssignedByPattern, FlowingValue::Expression);
            self.described_int32_flow = Some(Int32FlowDescription { subject, value });
        }
    }

    /// The casts of a tail call are at the position of the call.
    pub(in crate::lower) fn describe_int32_tail_call(&mut self, call: ExprId) {
        let description = Int32FlowDescription {
            subject: Int32Subject::Result,
            value: FlowingValue::Expression(call),
        };
        let returned = self.returned;
        self.record_flow(returned, description);
    }

    pub(crate) fn convert_assertion(&mut self, assertion: ExprId, value: ValueId) -> ValueId {
        let ExprKind::As { expr, ty } = self.file.hir[assertion].kind else {
            debug_assert!(false, "a type assertion was expected");
            return value;
        };
        let position = self.file.assertion_position(ty);
        self.describe_int32_flow(position, Int32Subject::Assertion, Some(expr));
        self.convert_as(value, position, Some(expr), Construct::Assertion)
    }

    // No container says what it holds, so what is read out of one is tested where it is read.
    pub(crate) fn claim_contents_read(
        &mut self,
        contents: CheckedType,
        kind: TypeSiteKind,
        value: ValueId,
    ) -> ValueId {
        if !self.file.is_checked() {
            return value;
        }
        let types = PositionTypes {
            written: WrittenType::Unwritten,
            checked: contents,
        };
        let origin = SiteOrigin {
            kind,
            position: self.position(),
        };
        let position = self.file.create_position(types, origin);
        self.convert_read(value, position, Construct::ContentsRead)
    }

    fn convert_read(
        &mut self,
        value: ValueId,
        position: DeclaredType,
        construct: Construct,
    ) -> ValueId {
        if position.ty == TypeTable::NEVER {
            return value;
        }
        self.convert_as(value, position, None, construct)
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
    if lowering.is_converted(value, position) {
        return value;
    }
    lowering.emit_convert(value, position, IllTypedCause::None)
}

impl FileLowering<'_, '_, '_, '_> {
    pub(crate) fn record_type_flow(
        &mut self,
        source: CheckerTypeId,
        target: CheckerTypeId,
        position: u32,
    ) {
        self.record_conversion(source, target, position, ConversionKind::Performed);
    }

    pub(crate) fn record_heritage_flow(
        &mut self,
        instance: CheckerTypeId,
        inherited: CheckerTypeId,
        position: u32,
    ) {
        self.record_type_flow(instance, inherited, position);
    }

    pub(crate) fn assertion_position(&mut self, ty: TypeNodeId) -> DeclaredType {
        self.annotation_position(ty, TypeSiteKind::Assertion)
    }
}

pub(crate) fn convert(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    value: ValueId,
    position: DeclaredType,
    source: Option<ExprId>,
) -> ValueId {
    lowering.convert_as(value, position, source, Construct::Flow)
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
