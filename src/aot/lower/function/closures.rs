use bun_sema::bind::CodeUnit;
use bun_sema::hir::{FnId, FnKind, Func};
use smallvec::SmallVec;

use super::EntryArguments;
use crate::ir::generated::{EntryParameter, FunctionFlags, MethodKind};
use crate::ir::{DeclaredType, FunctionId, StringId, TypeTable, ValueId};
use crate::lower::member::{self, PropertyName};
use crate::lower::{FileLowering, FunctionLowering, captures, convert};

type EntryOperands = SmallVec<[ValueId; 8]>;

pub(super) fn lower_function_expression(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    function: FnId,
    name: Option<PropertyName>,
) -> ValueId {
    create_named_closure(lowering, function, name, None)
}

pub(super) fn lower_method(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    function: FnId,
    name: PropertyName,
    home: ValueId,
) -> ValueId {
    create_named_closure(lowering, function, Some(name), Some(home))
}

pub(super) fn captures_home_object(file: &FileLowering<'_, '_, '_, '_>, function: FnId) -> bool {
    let key = file.scopes.function_key(CodeUnit::Function(function));
    captures::captures_home_object(file, key)
}

pub(super) fn emit_closure(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    function: FunctionId,
    home: Option<ValueId>,
) -> ValueId {
    let key = lowering.file.function_key(function);
    let values = captures::collect_capture_values(lowering, key, home);
    lowering.builder.new_closure(function, &values)
}

pub(super) fn emit_direct_call(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    function: FunctionId,
    arguments: EntryArguments<'_>,
) -> ValueId {
    let key = lowering.file.function_key(function);
    let header = lowering.file.function_header(function);
    let flags = header.flags;
    let this_type = header.this_type;
    let parameters: SmallVec<[DeclaredType; 4]> = SmallVec::from_slice(&header.parameters);
    let values = arguments.parameters;

    let has_rest_parameter = flags.contains(FunctionFlags::HAS_REST_PARAMETER);
    let mut operands: EntryOperands = SmallVec::new();
    for kind in EntryParameter::ALL {
        if !flags.contains(kind.present_with()) {
            continue;
        }
        match kind {
            EntryParameter::Capture => {
                operands.extend(captures::collect_capture_values(lowering, key, None));
            }
            EntryParameter::This => {
                let this = arguments.this.unwrap_or_else(|| lowering.builder.undefined());
                operands.push(convert::convert(lowering, this, this_type, None));
            }
            EntryParameter::Callee => operands.push(emit_closure(lowering, function, None)),
            EntryParameter::NewTarget => {
                let new_target = arguments.new_target;
                operands.push(new_target.unwrap_or_else(|| lowering.builder.undefined()));
            }
            EntryParameter::ArgumentCount => {
                operands.push(lowering.builder.integer(values.len() as i64));
            }
            EntryParameter::Parameter => add_parameter_operands(
                lowering,
                &parameters,
                has_rest_parameter,
                values,
                &mut operands,
            ),
            EntryParameter::HiddenRest => {
                let rest = values.get(parameters.len()..).unwrap_or(&[]);
                operands.push(emit_argument_list(lowering, rest));
            }
        }
    }
    lowering.builder.call_direct(function, &operands)
}

fn add_parameter_operands(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    parameters: &[DeclaredType],
    has_rest_parameter: bool,
    values: &[ValueId],
    operands: &mut EntryOperands,
) {
    debug_assert!(
        !has_rest_parameter || !parameters.is_empty(),
        "a rest parameter is a declared parameter"
    );
    let positional = parameters.len().saturating_sub(usize::from(has_rest_parameter));
    for (index, &position) in parameters[..positional].iter().enumerate() {
        let value = match values.get(index) {
            Some(&value) => value,
            None => lowering.builder.undefined(),
        };
        operands.push(convert::convert(lowering, value, position, None));
    }
    if let Some(&position) = parameters.get(positional) {
        let rest = emit_argument_list(lowering, values.get(positional..).unwrap_or(&[]));
        operands.push(convert::convert(lowering, rest, position, None));
    }
}

fn create_named_closure(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    function: FnId,
    name: Option<PropertyName>,
    home: Option<ValueId>,
) -> ValueId {
    let func = lowering.file.hir[function];
    let inferred_name = name.filter(|_| !has_own_name(&func));
    let header_name = inferred_name.and_then(|name| find_header_name(lowering.file, name));
    if let (Some(PropertyName::Constant(key)), None) = (inferred_name, header_name)
        && let Some(name) = member::find_name_under_symbol(lowering.file, key)
    {
        let id = super::declare_source_function_with(lowering.file, function, &mut |_, header| {
            header.name = Some(name);
            header.flags |= FunctionFlags::IS_NAMED_BY_SYMBOL;
        });
        return emit_closure(lowering, id, home);
    }
    let id = super::declare_source_function(lowering.file, function, header_name);
    let closure = emit_closure(lowering, id, home);
    if let (Some(name), None) = (inferred_name, header_name) {
        let key = member::emit_name_value(lowering, name);
        let kind = method_kind(func.kind);
        lowering.builder.set_function_name(closure, key, kind);
    }
    closure
}

fn has_own_name(func: &Func) -> bool {
    match func.kind {
        FnKind::Decl | FnKind::Expr => func.name.is_some(),
        FnKind::Arrow
        | FnKind::Method
        | FnKind::Getter
        | FnKind::Setter
        | FnKind::Constructor
        | FnKind::StaticBlock
        | FnKind::CallSignature
        | FnKind::ConstructSignature
        | FnKind::FunctionType
        | FnKind::ConstructorType
        | FnKind::IndexSignature => false,
    }
}

fn find_header_name(
    file: &FileLowering<'_, '_, '_, '_>,
    name: PropertyName,
) -> Option<StringId> {
    match name {
        PropertyName::Constant(key) => member::find_function_name(file, key),
        PropertyName::Computed(_) => None,
    }
}

fn method_kind(kind: FnKind) -> MethodKind {
    match kind {
        FnKind::Getter => MethodKind::Getter,
        FnKind::Setter => MethodKind::Setter,
        FnKind::Decl
        | FnKind::Expr
        | FnKind::Arrow
        | FnKind::Method
        | FnKind::Constructor
        | FnKind::StaticBlock
        | FnKind::CallSignature
        | FnKind::ConstructSignature
        | FnKind::FunctionType
        | FnKind::ConstructorType
        | FnKind::IndexSignature => MethodKind::Method,
    }
}

fn emit_argument_list(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    values: &[ValueId],
) -> ValueId {
    lowering.builder.new_array(TypeTable::ANYTHING, &[], values)
}
