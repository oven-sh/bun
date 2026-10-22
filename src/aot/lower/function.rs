mod body;
mod closures;
mod header;
mod this;

use bun_sema::hir::FnId;

use super::member::PropertyName;
use super::{FileLowering, FunctionLowering};
use crate::ir::generated::{Function, FunctionKind, HomeObjectKind};
use crate::ir::{DeclaredType, FunctionId, FunctionKey, StringId, ValueId};

#[derive(Copy, Clone, Default)]
pub(crate) struct EntryArguments<'x> {
    pub(crate) this: Option<ValueId>,
    pub(crate) new_target: Option<ValueId>,
    pub(crate) parameters: &'x [ValueId],
}

pub(crate) fn create_header(
    file: &mut FileLowering<'_, '_, '_, '_>,
    key: FunctionKey,
    kind: FunctionKind,
    position: u32,
) -> Function {
    header::create_header(file, key, kind, position)
}

pub(crate) fn declare_source_function(
    file: &mut FileLowering<'_, '_, '_, '_>,
    function: FnId,
    name: Option<StringId>,
) -> FunctionId {
    header::declare_source_function(file, function, name)
}

pub(crate) fn declare_source_function_with(
    file: &mut FileLowering<'_, '_, '_, '_>,
    function: FnId,
    adjust_header: &mut dyn FnMut(&mut FileLowering<'_, '_, '_, '_>, &mut Function),
) -> FunctionId {
    header::declare_source_function_with(file, function, adjust_header)
}

pub(crate) fn lower_source_function(
    file: &mut FileLowering<'_, '_, '_, '_>,
    function: FunctionId,
    source: FnId,
) {
    body::lower_source_function(file, function, source);
}

pub(crate) fn lower_left_out_function(
    file: &mut FileLowering<'_, '_, '_, '_>,
    function: FunctionId,
) {
    body::lower_left_out_function(file, function);
}

pub(crate) fn lower_function_body(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    source: FnId,
) {
    body::lower_function_body(lowering, source);
}

pub(crate) fn lower_function_expression(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    function: FnId,
    name: Option<PropertyName>,
) -> ValueId {
    closures::lower_function_expression(lowering, function, name)
}

pub(crate) fn lower_method(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    function: FnId,
    name: PropertyName,
    home: ValueId,
) -> ValueId {
    closures::lower_method(lowering, function, name, home)
}

pub(crate) fn captures_home_object(file: &FileLowering<'_, '_, '_, '_>, function: FnId) -> bool {
    closures::captures_home_object(file, function)
}

pub(crate) fn emit_closure(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    function: FunctionId,
    home: Option<ValueId>,
) -> ValueId {
    closures::emit_closure(lowering, function, home)
}

pub(crate) fn emit_direct_call(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    function: FunctionId,
    arguments: EntryArguments<'_>,
) -> ValueId {
    closures::emit_direct_call(lowering, function, arguments)
}

pub(crate) fn get_this(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>) -> ValueId {
    this::get_this(lowering)
}

pub(crate) fn lower_this_expression(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
) -> ValueId {
    this::lower_this_expression(lowering)
}

pub(crate) fn bind_this(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>, value: ValueId) {
    this::bind_this(lowering, value);
}

pub(in crate::lower) fn is_this_of_module(
    lowering: &FunctionLowering<'_, '_, '_, '_, '_>,
) -> bool {
    this::is_this_of_module(lowering)
}

pub(in crate::lower) fn find_this_position(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
) -> Option<DeclaredType> {
    this::find_this_position(lowering)
}

pub(crate) fn get_new_target(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>) -> ValueId {
    this::get_new_target(lowering)
}

pub(crate) fn get_home_object(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
) -> (HomeObjectKind, ValueId) {
    this::get_home_object(lowering)
}

pub(in crate::lower) fn get_entry_this(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
) -> ValueId {
    this::get_entry_this(lowering)
}

pub(in crate::lower) fn is_derived_constructor(
    file: &FileLowering<'_, '_, '_, '_>,
    function: FnId,
) -> bool {
    header::is_derived_constructor(file, function)
}
