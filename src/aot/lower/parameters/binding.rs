use bun_sema::bind::{Binding, CodeUnit, Decl, has_simple_parameter_list};
use bun_sema::hir::{FnId, ParamId, PatKind};
use smallvec::SmallVec;

use super::arguments;
use crate::ir::{DeclaredType, ValueId};
use crate::lower::member::PropertyName;
use crate::lower::scope::{BindingForm, BindingRef, ScopeSlot};
use crate::lower::{
    FunctionLowering, condition, convert, expression, member, pattern, positions, scope,
};

type InitialBindings = SmallVec<[(BindingRef, ValueId); 4]>;

pub(crate) fn lower_parameters(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>, source: FnId) {
    let hir = lowering.file.hir;
    let top = lowering.file.bound.fns[source.idx()].scope;
    let positions = positions::function_positions(lowering.file, source);
    let parameters = hir[source].params;
    let count = lowering.builder.function().parameters.len() as u32;
    let get_parameter = |index| lowering.builder.parameter(index);
    let values: SmallVec<[ValueId; 4]> = (0..count).map(get_parameter).collect();
    let mut initial = InitialBindings::new();
    let unit = CodeUnit::Function(source);
    if let Some(object) = arguments::create_arguments_object(lowering, unit, &values) {
        initial.push((BindingRef::Slot(top, ScopeSlot::Arguments), object));
    }
    if has_simple_parameter_list(hir, source) {
        collect_simple_parameters(lowering, source, &values, &mut initial);
        scope::allocate_scope(lowering, top, &initial);
    } else {
        scope::allocate_scope(lowering, top, &initial);
        for (index, parameter) in parameters.iter().enumerate() {
            bind_parameter(
                lowering,
                parameter,
                values[index],
                positions.parameters[index],
            );
        }
    }
    emit_parameter_var_copies(lowering, source);
    scope::instantiate_functions(lowering, top);
}

fn collect_simple_parameters(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    source: FnId,
    values: &[ValueId],
    initial: &mut InitialBindings,
) {
    let hir = lowering.file.hir;
    let bound = lowering.file.bound;
    for (index, parameter) in hir[source].params.iter().enumerate() {
        let node = hir[parameter];
        lowering.set_position(node.pos);
        let symbol = bound.declared_symbol(Decl::Param(node.pat));
        match lowering.file.scopes.form(symbol) {
            BindingForm::Stored => initial.push((BindingRef::Symbol(symbol), values[index])),
            BindingForm::NotAValue
            | BindingForm::Import
            | BindingForm::Callee { .. }
            | BindingForm::MappedArgument { .. }
            | BindingForm::ContainerMember { .. } => {}
        }
    }
    initial.reverse();
    initial.sort_by_key(|entry| entry.0);
    initial.dedup_by_key(|entry| entry.0);
}

fn bind_parameter(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    parameter: ParamId,
    mut value: ValueId,
    position: DeclaredType,
) {
    let hir = lowering.file.hir;
    let node = hir[parameter];
    lowering.set_position(node.pos);
    if node.default.is_some() {
        value = apply_default(lowering, parameter, value, position);
    }
    match hir[node.pat].kind {
        PatKind::Ident(name) => {
            let symbol = lowering.file.bound.declared_symbol(Decl::Param(node.pat));
            scope::initialize_converted_symbol(lowering, symbol, name, value);
        }
        PatKind::Object(_) | PatKind::Array(_) => {
            pattern::bind_pattern(lowering, node.pat, value, None);
        }
        PatKind::Missing => {}
    }
}

fn apply_default(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    parameter: ParamId,
    value: ValueId,
    position: DeclaredType,
) -> ValueId {
    let hir = lowering.file.hir;
    let node = hir[parameter];
    let result = lowering.builder.create_variable(None);
    let use_default = lowering.create_block();
    let join = lowering.create_block();
    let present = condition::branch_if_undefined(lowering, value, use_default);
    lowering.builder.write_variable(result, present);
    lowering.jump(join);
    lowering.continue_in(use_default);
    let default = match hir[node.pat].kind {
        PatKind::Ident(name) => {
            let binding = lowering.file.bound.initialized_binding(node.pat);
            let key = member::function_name_key(lowering.file, binding, name);
            expression::lower_named_evaluation(lowering, node.default, PropertyName::Constant(key))
        }
        PatKind::Object(_) | PatKind::Array(_) | PatKind::Missing => {
            expression::lower_expression(lowering, node.default)
        }
    };
    let subject = convert::Int32Subject::Parameter(parameter);
    convert::describe_int32_flow(lowering, position, subject, Some(node.default));
    // The parameter takes `undefined` for an argument that is left out. The binding behind the default does not.
    let initialized = match hir[node.pat].kind {
        PatKind::Ident(_) => {
            let symbol = lowering.file.bound.declared_symbol(Decl::Param(node.pat));
            positions::binding_position(lowering.file, symbol)
        }
        PatKind::Object(_) | PatKind::Array(_) | PatKind::Missing => position,
    };
    let default = convert::convert_initializer(lowering, default, initialized, Some(node.default));
    lowering.builder.write_variable(result, default);
    lowering.jump(join);
    lowering.continue_in(join);
    lowering.builder.read_variable(result)
}

fn emit_parameter_var_copies(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>, source: FnId) {
    let bound = lowering.file.bound;
    let copies = bound.runtime.parameter_var_copies();
    let start = copies.partition_point(|copy| copy.function < source);
    let end = copies.partition_point(|copy| copy.function <= source);
    for copy in &copies[start..end] {
        let name = bound.symbol(copy.variable).name;
        let value = scope::get_binding(lowering, Binding::Symbol(copy.parameter), name);
        scope::initialize_binding(lowering, Binding::Symbol(copy.variable), name, value);
    }
}
