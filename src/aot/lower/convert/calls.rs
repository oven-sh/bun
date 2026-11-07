use bun_sema::bind::Parent;
use bun_sema::check::aot::{
    FunctionRef, GaveUp, PositionTypes, ShapeKind, SignatureParameter, WrittenType,
};
use bun_sema::hir::{ExprId, ExprKind};

use super::edges::Construct;
use crate::ir::generated::IllTypedCause;
use crate::ir::{DeclaredType, Mapped, PositionFlags, TypeId, ValueId};
use crate::lower::types::lists_int32;
use crate::lower::{FileLowering, FunctionLowering};

#[derive(Copy, Clone)]
struct CallResult {
    position: DeclaredType,
    declaration: Option<FunctionRef>,
    is_instantiated: bool,
    is_type_argument_unwritten: bool,
}

fn find_parameter<P: Copy>(
    parameters: &[P],
    index: usize,
    is_rest: impl Fn(P) -> bool,
) -> Option<(P, Option<usize>)> {
    let (&last, leading) = parameters.split_last()?;
    if let Some(&parameter) = leading.get(index) {
        return (!is_rest(parameter)).then_some((parameter, None));
    }
    if !is_rest(last) {
        return (index == leading.len()).then_some((last, None));
    }
    Some((last, Some(index - leading.len())))
}

impl FileLowering<'_, '_, '_, '_> {
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

    fn create_call_result_position(&mut self, result: PositionTypes) -> DeclaredType {
        let position = self.create_position(result);
        let flags = position.flags.without(PositionFlags::IS_INT32_PROMISE);
        DeclaredType { flags, ..position }
    }

    fn find_int32_result(&mut self, declaration: FunctionRef) -> Option<CallResult> {
        if !self.queries.is_int32_written() {
            return None;
        }
        let written = self.queries.written_result(declaration);
        let ty = written.written()?;
        if !lists_int32(self, ty) {
            return None;
        }
        let checked = Ok(ty);
        Some(CallResult {
            position: self.create_call_result_position(PositionTypes { written, checked }),
            declaration: Some(declaration),
            is_instantiated: false,
            is_type_argument_unwritten: false,
        })
    }

    fn find_call_result(&mut self, call: ExprId) -> Option<CallResult> {
        if !self.is_checked() {
            return None;
        }
        if let Some(function) = self.queries.only_declaration_called(call)
            && matches!(
                self.classify_call_result(Some(function)),
                IllTypedCause::None
            )
        {
            return self.find_int32_result(function);
        }
        let mut target = self.queries.resolved_call(call).ok()??;
        let cause = self.classify_call_result(target.declaration);
        if matches!(cause, IllTypedCause::None) {
            return self.find_int32_result(target.declaration?);
        }
        let is_instantiated = target.declaration.is_some_and(|declaration| {
            let called = self.queries.signature_result(target.signature);
            called != self.queries.function_result(declaration)
        });
        let written_with_receiver = self.find_result_through_written_receiver(call);
        let written = written_with_receiver.unwrap_or(target.result.written);
        let is_type_argument_unwritten = is_instantiated
            && (written.written()).is_some_and(|written| Ok(written) != target.result.checked);
        target.result.written = match written_with_receiver {
            Some(written) => written,
            None if is_instantiated => WrittenType::Unwritten,
            None => target.result.written,
        };
        Some(CallResult {
            position: self.create_call_result_position(target.result),
            declaration: target.declaration,
            is_instantiated,
            is_type_argument_unwritten,
        })
    }

    fn find_objects_expected_of_call(&mut self, call: ExprId) -> Option<TypeId> {
        if !self.is_checked() || !matches!(self.hir[call].kind, ExprKind::Call(_)) {
            return None;
        }
        let mut read = call;
        let is_read_like_an_object = loop {
            match self.bound.parent_of_expr(read) {
                Parent::VarInit(_) => break true,
                Parent::Expr(parent) => match self.hir[parent].kind {
                    ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => break obj == read,
                    ExprKind::NonNull(_) | ExprKind::Await(_) => read = parent,
                    _ => break false,
                },
                _ => break false,
            }
        };
        if !is_read_like_an_object {
            return None;
        }
        let checked = self.queries.expression_type(call);
        let written = WrittenType::Unwritten;
        let expected = self.create_position(PositionTypes { written, checked }).ty;
        let names_layouts = !self.fragment.types.get(expected).layouts.is_empty();
        names_layouts.then_some(expected)
    }

    pub(in crate::lower) fn find_position_of_returned_call(
        &mut self,
        call: ExprId,
    ) -> DeclaredType {
        let Some(result) = self.find_call_result(call) else {
            return DeclaredType::untyped();
        };
        let position = result.position;
        match result.is_type_argument_unwritten {
            true => DeclaredType::new(Mapped::expected(position.ty), None, position.flags),
            false => position,
        }
    }

    fn find_parameter_types(
        &mut self,
        parameters: &[SignatureParameter],
        index: usize,
    ) -> Option<PositionTypes> {
        let (parameter, place) = find_parameter(parameters, index, |it| it.is_rest)?;
        let Some(place) = place else {
            return Some(parameter.types);
        };
        let written = match parameter.types.written {
            WrittenType::Written(ty) => self
                .find_element_type(ty, place)
                .map_or(WrittenType::Unwritten, WrittenType::Written),
            WrittenType::Unwritten | WrittenType::GaveUp(_) => parameter.types.written,
        };
        let checked = parameter
            .types
            .checked
            .and_then(|ty| self.find_element_type(ty, place).ok_or(GaveUp::Unresolved));
        Some(PositionTypes { written, checked })
    }

    fn passes_no_int32(
        &mut self,
        callee: FunctionRef,
        mut arguments: impl Iterator<Item = usize>,
    ) -> bool {
        if !self.queries.is_int32_written() {
            return true;
        }
        let parameters = self.queries.written_parameters(callee);
        !arguments.any(|index| {
            let Some((parameter, place)) = find_parameter(parameters, index, |it| it.is_rest)
            else {
                return false;
            };
            let written = match (parameter.written.written(), place) {
                (Some(list), Some(place)) => self.find_element_type(list, place),
                (written, _) => written,
            };
            written.is_some_and(|written| lists_int32(self, written))
        })
    }

    pub(in crate::lower) fn find_int32_position(
        &mut self,
        types: PositionTypes,
        declared: WrittenType,
        is_optional: bool,
    ) -> Option<DeclaredType> {
        if !lists_int32(self, declared.written()?) {
            return None;
        }
        let declared = self.create_position(types);
        Some(match is_optional {
            true => self.add_undefined(declared),
            false => declared,
        })
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(crate) fn claim_call_result(&mut self, call: ExprId, value: ValueId) -> ValueId {
        let Some(result) = self.file.find_call_result(call) else {
            return match self.file.find_objects_expected_of_call(call) {
                Some(expected) => super::expect_type(self, value, expected),
                None => value,
            };
        };
        let construct = Construct::CallResult {
            declaration: result.declaration,
            is_instantiated: result.is_instantiated,
        };
        self.convert_read(value, result.position, construct)
    }

    pub(crate) fn convert_arguments(&mut self, call: ExprId, arguments: &mut [ValueId]) {
        if !self.file.queries.is_int32_written() {
            return;
        }
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
        if let Some(callee) = self.file.queries.only_declaration_called(call)
            && self.file.passes_no_int32(callee, 0..arguments.len())
        {
            return;
        }
        let Ok(Some(target)) = self.file.queries.resolved_call(call) else {
            return;
        };
        let shape = self.file.queries.signature(target.signature);
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
            let found = self.file.find_int32_position(types, declared, is_optional);
            let Some(declared) = found else {
                continue;
            };
            if let Some(callee) = target.declaration {
                let at = hir[expression].pos;
                self.describe_int32_argument(at, declared, callee, index, Some(expression));
            }
            *value = self.convert_initializer(*value, declared, Some(expression));
        }
    }

    pub(crate) fn convert_argument_list(&mut self, call: ExprId, list: ValueId) {
        if !self.file.queries.is_int32_written() {
            return;
        }
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
        if let Some(callee) = self.file.queries.only_declaration_called(call) {
            let count = self.file.queries.written_parameters(callee).len();
            if self.file.passes_no_int32(callee, first_spread..count) {
                return;
            }
        }
        let Ok(Some(target)) = self.file.queries.resolved_call(call) else {
            return;
        };
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
            let found = self
                .file
                .find_int32_position(types, types.written, is_optional);
            let Some(declared) = found else {
                continue;
            };
            let call_position = self.position();
            self.describe_int32_argument(position, declared, callee, index, None);
            self.set_position(position);
            super::convert(self, list, declared, None);
            self.set_position(call_position);
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::compile::testing::lower_program;
    use crate::ir::generated::Function;
    use crate::ir::{DeclaredType, Opcode, PositionFlags};
    use crate::load::host_platform;
    use crate::lower::LoweringOptions;

    fn count_int32_promises(function: &Function) -> usize {
        let values = function.body.blocks().flat_map(|block| block.values());
        values
            .filter(|value| value.opcode == Opcode::Convert)
            .filter_map(|value| DeclaredType::from_words(&value.fields[1..]))
            .filter(|declared| declared.flags.contains(PositionFlags::IS_INT32_PROMISE))
            .count()
    }

    #[track_caller]
    fn count_int32_promises_in(files: &[(&str, &str)], function_name: &str) -> usize {
        let options = LoweringOptions {
            platform: host_platform(),
            embeds_function_text: false,
            removable: Default::default(),
            minifies_identifiers: false,
            obfuscates: false,
            counts_executions: false,
            runs_tests: false,
        };
        let lowered = lower_program(files, options);
        let count = lowered.iter().find_map(|(_, lowered)| {
            let fragment = &lowered.fragment;
            let tables = fragment.tables.take();
            let mut functions = fragment.functions.iter().map(|(_, function)| function);
            let found = functions.find(|function| {
                let name = function.name.map(|name| tables.strings.get(name));
                name == Some(function_name.as_bytes())
            });
            let count = found.map(|function| count_int32_promises(function));
            fragment.tables.put_back(tables);
            count
        });
        count.expect("the program defines the function")
    }

    #[test]
    fn reading_a_call_result_asks_for_no_int32_proof() {
        let main = "/// <reference path=\"./bun-declarations.d.ts\" />
import type { int32 } from \"bun\";
interface Box<T> { get(): T }
export function read(measure: () => int32, box: Box<int32>) { return [measure() + 1, box.get()]; }
export function stored(measure: () => int32) { const held: int32 = measure() + 1; return [held]; }
";
        let declarations = "declare module \"bun\" {
  type int32 = number & { readonly \"bun.int32\"?: true };
}
";
        let files = [("main.ts", main), ("bun-declarations.d.ts", declarations)];
        assert_eq!(count_int32_promises_in(&files, "read"), 0);
        assert_ne!(count_int32_promises_in(&files, "stored"), 0);
    }

    #[test]
    fn only_reads_of_int32s_owe_no_proof() {
        let main = "/// <reference path=\"./bun-declarations.d.ts\" />
import type { int32 } from \"bun\";
enum Color { Red, Green, Blue }
class Cursor { line: int32 = 0; }
interface Holder { color: Color; next?: Color; level: 1 | 2 | 3; wide: number }
export function field(cursor: Cursor): int32 { return cursor.line; }
export function enumMember(holder: Holder): int32 { return holder.color; }
export function literals(holder: Holder): int32 { const kept: int32 = holder.level; return kept; }
export function arms(first: boolean, holder: Holder | null): int32 { return first ? holder?.next ?? -1 : holder!.color && holder!.level; }
export function castOfRead(holder: Holder): int32 { return holder.color as int32; }
export function result(make: () => Color): int32 { return make(); }
export function anyNumber(holder: Holder): int32 { return holder.wide; }
export function oneWideArm(first: boolean, holder: Holder): int32 { return first ? holder.color : holder.wide; }
export function castOfAnyNumber(holder: Holder): int32 { return holder.wide as int32; }
export function sum(cursor: Cursor): int32 { return cursor.line + 1; }
export function negativeZero(): int32 { return -0; }
";
        let declarations = "declare module \"bun\" {
  type int32 = number & { readonly \"bun.int32\"?: true };
}
";
        let files = [("main.ts", main), ("bun-declarations.d.ts", declarations)];
        let kept = [
            "field",
            "enumMember",
            "literals",
            "arms",
            "castOfRead",
            "result",
        ];
        for function_name in kept {
            let count = count_int32_promises_in(&files, function_name);
            assert_eq!(count, 0, "{function_name}");
        }
        assert_eq!(count_int32_promises_in(&files, "castOfAnyNumber"), 2);
        for function_name in ["anyNumber", "oneWideArm", "sum", "negativeZero"] {
            let count = count_int32_promises_in(&files, function_name);
            assert_eq!(count, 1, "{function_name}");
        }
    }
}
