use bun_sema::atom::written_name;
use bun_sema::bind::{PrivateMembers, PrivateNameId};
use bun_sema::hir::{MemberId, PropKey};
use bun_sema::program::FileId;

use super::is_auto_accessor;
use crate::ir::generated::{Function, FunctionFlags, FunctionKind, MethodKind};
use crate::ir::{DeclaredType, FunctionId, FunctionKey, StringId, ValueId};
use crate::lower::{FileLowering, FunctionLowering, control, function, private_names};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(in crate::lower) enum AccessorFunction {
    Getter,
    Setter,
    PrivateNameTest,
}

#[derive(Copy, Clone)]
enum MemberStorage {
    AutoAccessor,
    PrivateField(PrivateNameId),
}

pub(in crate::lower) fn declare_accessor_function(
    file: &mut FileLowering<'_, '_, '_, '_>,
    member: MemberId,
    function: AccessorFunction,
) -> FunctionId {
    let key = get_function_key(file.file, member, function);
    file.declare_function(key, |file| {
        create_accessor_header(file, key, member, function)
    })
}

pub(super) fn lower_accessor_function(
    file: &mut FileLowering<'_, '_, '_, '_>,
    function: FunctionId,
    member: MemberId,
    kind: MethodKind,
) {
    let position = file.hir[member].name_pos;
    let mut lowering = FunctionLowering::begin(file, function);
    let this = lowering.builder.this_value();
    let this = this.expect("an accessor function takes this");
    lowering.set_position(position);
    let result = match kind {
        MethodKind::Getter => emit_storage_read(&mut lowering, member, this),
        MethodKind::Setter => {
            let value = lowering.builder.parameter(0);
            emit_storage_write(&mut lowering, member, this, value);
            lowering.builder.undefined()
        }
        MethodKind::Method => {
            debug_assert!(false, "an accessor function is a getter or a setter");
            lowering.builder.undefined()
        }
    };
    control::emit_return(&mut lowering, result, None);
    lowering.finish();
}

pub(super) fn lower_private_name_test(
    file: &mut FileLowering<'_, '_, '_, '_>,
    function: FunctionId,
    member: MemberId,
) {
    let position = file.hir[member].name_pos;
    let name = file.bound.private_name_of_member(member);
    let name = name.expect("the tested member has a private name");
    let mut lowering = FunctionLowering::begin(file, function);
    let this = lowering.builder.this_value();
    let this = this.expect("a private name test takes this");
    lowering.set_position(position);
    let result = private_names::emit_name_test(&mut lowering, this, name);
    control::emit_return(&mut lowering, result, None);
    lowering.finish();
}

fn get_function_key(file: FileId, member: MemberId, function: AccessorFunction) -> FunctionKey {
    match function {
        AccessorFunction::Getter => FunctionKey::AccessorGetter { file, member },
        AccessorFunction::Setter => FunctionKey::AccessorSetter { file, member },
        AccessorFunction::PrivateNameTest => FunctionKey::PrivateNameTest { file, member },
    }
}

fn get_function_kind(function: AccessorFunction) -> FunctionKind {
    match function {
        AccessorFunction::Getter => FunctionKind::Getter,
        AccessorFunction::Setter => FunctionKind::Setter,
        AccessorFunction::PrivateNameTest => FunctionKind::Method,
    }
}

fn create_accessor_header(
    file: &mut FileLowering<'_, '_, '_, '_>,
    key: FunctionKey,
    member: MemberId,
    function: AccessorFunction,
) -> Function {
    let position = file.hir[member].name_pos;
    let mut header = function::create_header(file, key, get_function_kind(function), position);
    header.flags |= FunctionFlags::HAS_THIS;
    header.name = find_function_name(file, member);
    match function {
        AccessorFunction::Setter => {
            header.parameters.push(DeclaredType::untyped());
            header.length = 1;
        }
        AccessorFunction::Getter | AccessorFunction::PrivateNameTest => {}
    }
    header
}

fn find_function_name(
    file: &mut FileLowering<'_, '_, '_, '_>,
    member: MemberId,
) -> Option<StringId> {
    match file.hir.runtime_member_key(member) {
        PropKey::Name(name) => Some(file.intern_atom(name)),
        PropKey::Private(name) => {
            let text = written_name(file.queries.atom_bytes(name));
            Some(file.intern_bytes(text))
        }
        PropKey::Computed(_) => None,
        PropKey::None => {
            debug_assert!(false, "a member with an accessor function has a key");
            None
        }
    }
}

fn find_member_storage(
    file: &FileLowering<'_, '_, '_, '_>,
    member: MemberId,
) -> Option<MemberStorage> {
    if is_auto_accessor(file.hir, member) {
        return Some(MemberStorage::AutoAccessor);
    }
    let name = file.bound.private_name_of_member(member)?;
    match file.bound.private_name(name).members {
        PrivateMembers::Field(_) => Some(MemberStorage::PrivateField(name)),
        PrivateMembers::Method(_)
        | PrivateMembers::Accessor { .. }
        | PrivateMembers::AutoAccessor(_) => None,
    }
}

fn emit_storage_read(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    member: MemberId,
    this: ValueId,
) -> ValueId {
    match find_member_storage(lowering.file, member) {
        Some(MemberStorage::AutoAccessor) => {
            private_names::emit_storage_get(lowering, this, member)
        }
        Some(MemberStorage::PrivateField(name)) => {
            private_names::emit_name_get(lowering, this, name)
        }
        None => {
            debug_assert!(false, "the member is an accessor field or a private field");
            lowering.builder.undefined()
        }
    }
}

fn emit_storage_write(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    member: MemberId,
    this: ValueId,
    value: ValueId,
) {
    match find_member_storage(lowering.file, member) {
        Some(MemberStorage::AutoAccessor) => {
            private_names::emit_storage_set(lowering, this, member, value);
        }
        Some(MemberStorage::PrivateField(name)) => {
            private_names::emit_name_set(lowering, this, name, value, None);
        }
        None => debug_assert!(false, "the member is an accessor field or a private field"),
    }
}
