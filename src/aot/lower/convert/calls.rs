use bun_sema::check::aot::{
    CallTarget, GaveUp, PositionTypes, ShapeKind, SignatureParameter, WrittenType,
};
use bun_sema::hir::{ExprId, ExprKind};

use super::edges::Construct;
use super::int32_flows::FlowingValue;
use super::supertypes::ConversionKind;
use super::{Int32FlowDescription, Int32Subject};
use crate::ir::generated::TypeSiteKind;
use crate::ir::{DeclaredType, ValueId};
use crate::lower::positions::SiteOrigin;
use crate::lower::types::lists_int32;
use crate::lower::{FileLowering, FunctionLowering};

impl FileLowering<'_, '_, '_, '_> {
    // `box.get()` with `box: Box<string>` and `get(): T`: the type argument was written with the receiver's type.
    fn find_result_through_written_receiver(&mut self, call: ExprId) -> Option<WrittenType> {
        let ExprKind::Call(site) = self.hir[call].kind else {
            return None;
        };
        let callee = self.hir[site].callee;
        self.hir.member_key(callee)?;
        let method = self.find_written_type(callee)?;
        let ShapeKind::Function(&[signature]) = self.queries.type_shape(method).ok()?.kind else {
            return None;
        };
        let shape = self.queries.signature(signature);
        let declared = self.queries.function_signature(shape.declaration?);
        let written = shape.result.written;
        let is_instantiated = !shape.has_type_parameters && written != declared.result.written;
        is_instantiated.then_some(written)
    }

    fn record_listed_arguments(&mut self, call: ExprId, target: CallTarget) {
        let hir = self.hir;
        let (ExprKind::Call(site) | ExprKind::New(site)) = hir[call].kind else {
            return;
        };
        let parameters = self.queries.signature(target.signature).parameters;
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
                let Some(types) = self.find_parameter_types(parameters, reached) else {
                    continue;
                };
                let Ok(parameter_type) = types.checked else {
                    continue;
                };
                match spread {
                    Some(spread) => self.record_spread_elements(spread, &[parameter_type]),
                    None => self.record_flow_into_type(argument, parameter_type, kind),
                }
            }
        }
    }

    pub(super) fn find_parameter_types(
        &mut self,
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
            WrittenType::Written(ty) => self
                .find_element_type(ty, place)
                .map_or(WrittenType::Unwritten, WrittenType::Written),
            WrittenType::Unwritten | WrittenType::GaveUp(_) => last.types.written,
        };
        let checked = last
            .types
            .checked
            .and_then(|ty| self.find_element_type(ty, place).ok_or(GaveUp::Unresolved));
        Some(PositionTypes { written, checked })
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    // The type comes from the call, not from the type of the callee: a function type lists the functions that were converted to it, and says nothing of what they return.
    pub(crate) fn claim_call_result(&mut self, call: ExprId, value: ValueId) -> ValueId {
        if !self.file.is_checked() {
            return value;
        }
        let Ok(Some(mut target)) = self.file.queries.resolved_call(call) else {
            return value;
        };
        let queries = &mut *self.file.queries;
        let is_instantiated = target.declaration.is_some_and(|declaration| {
            let called = queries.signature_result(target.signature);
            called != queries.function_signature(declaration).result.checked
        });
        match self.file.find_result_through_written_receiver(call) {
            Some(written) => target.result.written = written,
            // What is written is the type parameter. The checker has what this call puts in its place.
            None if is_instantiated => target.result.written = WrittenType::Unwritten,
            None => {}
        }
        let origin = SiteOrigin {
            kind: TypeSiteKind::CallResult,
            position: self.file.hir[call].pos,
        };
        let declared = self.file.create_position(target.result, origin);
        let construct = Construct::CallResult {
            declaration: target.declaration,
            is_instantiated,
        };
        self.convert_read(value, declared, construct)
    }

    pub(crate) fn convert_arguments(&mut self, call: ExprId, arguments: &mut [ValueId]) {
        let hir = self.file.hir;
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
        let Ok(Some(target)) = self.file.queries.resolved_call(call) else {
            return;
        };
        self.file.record_call_type_arguments(call);
        let shape = self.file.queries.signature(target.signature);
        // The signature of a call holds the receiver's type arguments, which may be inferred.
        let declared_parameters = match target.declaration {
            Some(declaration) => self.file.queries.function_signature(declaration).parameters,
            None => shape.parameters,
        };
        for (index, (expression, value)) in (first_parameter..).zip(expressions.zip(arguments)) {
            let Some(types) = self.file.find_parameter_types(shape.parameters, index) else {
                continue;
            };
            let declared = self
                .file
                .find_parameter_types(declared_parameters, index)
                .map_or(WrittenType::Unwritten, |declared| declared.written);
            let is_optional =
                (shape.parameters.get(index)).is_some_and(|parameter| parameter.is_optional);
            // The callee tests its parameters where it is entered.
            let checked = types.checked.ok();
            let written = types.written.written();
            let distinct_written = written.filter(|_| written != checked);
            for parameter_type in checked.into_iter().chain(distinct_written) {
                let kind = ConversionKind::Performed;
                self.file
                    .record_flow_into_type(expression, parameter_type, kind);
            }
            let position = hir[expression].pos;
            let found = find_int32_position(self.file, types, declared, is_optional, position);
            let Some(declared) = found else {
                continue;
            };
            if let Some(callee) = target.declaration {
                let subject = Int32Subject::Argument { callee, index };
                self.describe_int32_flow(declared, subject, Some(expression));
            }
            *value = self.convert_initializer(*value, declared, Some(expression));
        }
    }

    // No operation holds one element of a spread argument, so the flow into the first `int32` parameter that the spread can reach is a request for the list, which no proof admits.
    pub(crate) fn convert_argument_list(&mut self, call: ExprId, list: ValueId) {
        let hir = self.file.hir;
        let (ExprKind::Call(site) | ExprKind::New(site)) = hir[call].kind else {
            return;
        };
        let mut arguments = hir.ids(hir[site].args).enumerate();
        let spread =
            arguments.find(|&(_, argument)| matches!(hir[argument].kind, ExprKind::Spread(_)));
        let Some((first_spread, spread)) = spread else {
            return;
        };
        let Ok(Some(target)) = self.file.queries.resolved_call(call) else {
            return;
        };
        self.file.record_call_type_arguments(call);
        self.file.record_listed_arguments(call, target);
        let Some(callee) = target.declaration else {
            return;
        };
        let parameters = self.file.queries.function_signature(callee).parameters;
        let position = hir[spread].pos;
        for (index, parameter) in parameters.iter().enumerate().skip(first_spread) {
            if parameter.is_rest {
                return;
            }
            let (types, is_optional) = (parameter.types, parameter.is_optional);
            let found = find_int32_position(self.file, types, types.written, is_optional, position);
            let Some(declared) = found else {
                continue;
            };
            self.described_int32_flow = Some(Int32FlowDescription {
                subject: Int32Subject::Argument { callee, index },
                value: FlowingValue::PassedBySpread,
            });
            let call_position = self.position();
            self.set_position(position);
            super::convert(self, list, declared, None);
            self.set_position(call_position);
            return;
        }
    }
}

fn find_int32_position(
    file: &mut FileLowering<'_, '_, '_, '_>,
    types: PositionTypes,
    declared: WrittenType,
    is_optional: bool,
    position: u32,
) -> Option<DeclaredType> {
    if !lists_int32(file, declared.written()?) {
        return None;
    }
    let origin = SiteOrigin {
        kind: TypeSiteKind::Parameter,
        position,
    };
    let declared = file.create_position(types, origin);
    Some(match is_optional {
        true => file.add_undefined(declared),
        false => declared,
    })
}
