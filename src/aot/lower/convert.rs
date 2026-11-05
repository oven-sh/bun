mod calls;
mod edges;
mod family_facts;
mod flows;
mod int32_flows;
mod members;
mod patterns;

use bun_sema::hir::{ExprId, ExprKind, TypeNodeId};
use rustc_hash::FxHashMap;

use self::edges::Construct;
use super::{CheckerTypeId, FileLowering, FunctionLowering};
use crate::ir::generated::IllTypedCause;
use crate::ir::{DeclaredType, FunctionId, Id, Mapped, PositionFlags, TypeId, TypeTable, ValueId};

pub(crate) use self::family_facts::FamilyFacts;

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
    converted_values: ConvertedValues,
    /// How many levels of parts were followed below a source and a target.
    followed_parts: FxHashMap<(CheckerTypeId, CheckerTypeId), u8>,
    recorded_flows: flows::RecordedFlows,
}

pub(crate) fn establishes_type(position: DeclaredType) -> bool {
    !position.is_expected()
}

// A type goes out where the program declares one: at a parameter, a result, a field, a variable with an annotation and a cast, and at a call of code that is not in the program.
// The engine types every other expression by flow, so nobody asks the checker what flows into a position: `source` serves the proof of an `int32` alone.
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

    // What an assertion claims for a value can lie outside the type of the variable that holds it.
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

    fn convert_as(
        &mut self,
        value: ValueId,
        position: DeclaredType,
        source: Option<ExprId>,
        construct: Construct,
    ) -> ValueId {
        // What is read out of a position enters none. Whoever builds the program cannot change what a dependency asserts.
        let flags = position.flags;
        let is_promise = flags.contains(PositionFlags::IS_INT32_PROMISE);
        let owes_proof = match construct {
            Construct::Flow => true,
            Construct::Assertion => !flags.contains(PositionFlags::IS_DECLARED_BY_DEPENDENCY),
            Construct::CallResult { .. } => false,
        };
        let breaks_no_promise = is_promise
            && (!owes_proof
                || source.is_some_and(|source| self.file.breaks_no_int32_promise(source)));
        let position = match breaks_no_promise {
            true => {
                let flags = flags.without(PositionFlags::IS_INT32_PROMISE);
                DeclaredType { flags, ..position }
            }
            false => position,
        };
        if position.ty == TypeTable::ANYTHING {
            return value;
        }
        if self.is_converted(value, position) {
            return value;
        }
        let is_assertion = matches!(construct, Construct::Assertion);
        let cause = self.file.find_cause(position, source, construct);
        self.describe_int32_flow(position, source, is_assertion);
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

    pub(crate) fn convert_assertion(&mut self, assertion: ExprId, value: ValueId) -> ValueId {
        let ExprKind::As { expr, ty } = self.file.hir[assertion].kind else {
            debug_assert!(false, "a type assertion was expected");
            return value;
        };
        let position = self.file.assertion_position(ty);
        if let Some(written) = self.file.queries.written_type(ty).written() {
            self.file.record_flow_into_written_type(expr, written);
        }
        // A cast begins where its operand does, and so does the flow that takes it: `{ lane: n as int32 }`. Each owes a proof of its own and has an error of its own, so the cast stands at its type.
        let at = self.position();
        if position.flags.contains(PositionFlags::IS_INT32_PROMISE) {
            self.set_position(self.file.hir[ty].pos);
        }
        let converted = self.convert_as(value, position, Some(expr), Construct::Assertion);
        self.set_position(at);
        converted
    }

    // `for (let i: int32 = 0; i < point[key]; i++)`, `return Math.max(point.x, point.y)`: what is read out of a position whose numbers are all `int32`s was judged where it entered (breaks_no_int32_promise()).
    // Where the read itself flows into a promise the conversion there says so. AS AN OPERAND IT ENTERS NO POSITION, and the proof of what is made of it had only what the engine finds by itself: nothing of a read under one of two names,
    // `number` of a field whose layout a type with the same names and other numbers shares. So the type goes out behind the read: it serves the proof of an `int32`, as `source` does. The old front end laid the checker's type behind every expression.
    pub(in crate::lower) fn state_int32_of_read(
        &mut self,
        read: ExprId,
        value: ValueId,
    ) -> ValueId {
        match self.file.position_of_int32_read(read) {
            Some(position) => self.convert_read(value, position, Construct::Flow),
            None => value,
        }
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
    pub(crate) fn assertion_position(&mut self, ty: TypeNodeId) -> DeclaredType {
        self.annotation_position(ty)
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
