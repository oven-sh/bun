use bun_sema::atom::written_name;
use bun_sema::bind::{PrivateMembers, PrivateNameId};
use bun_sema::hir::{MemberId, PropKey};
use bun_sema::program::FileId;

use super::is_auto_accessor;
use crate::ir::generated::{Function, FunctionFlags, FunctionKind, MethodKind};
use crate::ir::{DeclaredType, FunctionId, FunctionKey, StringId, ValueId};
use crate::lower::{FileLowering, FunctionLowering, function};

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
        file.create_accessor_header(key, member, function)
    })
}

impl FileLowering<'_, '_, '_, '_> {
    pub(crate) fn lower_accessor_function(
        &mut self,
        function: FunctionId,
        member: MemberId,
        kind: MethodKind,
    ) {
        let position = self.hir[member].name_pos;
        let mut lowering = FunctionLowering::begin(self, function);
        let this = lowering.builder.this_value();
        let this = this.expect("an accessor function takes this");
        lowering.set_position(position);
        let result = match kind {
            MethodKind::Getter => lowering.emit_storage_read(member, this),
            MethodKind::Setter => {
                let value = lowering.builder.parameter(0);
                lowering.emit_storage_write(member, this, value);
                lowering.builder.undefined()
            }
            MethodKind::Method => {
                debug_assert!(false, "an accessor function is a getter or a setter");
                lowering.builder.undefined()
            }
        };
        lowering.emit_return(result, None);
        lowering.finish();
    }

    pub(crate) fn lower_private_name_test(&mut self, function: FunctionId, member: MemberId) {
        let position = self.hir[member].name_pos;
        let name = self.bound.private_name_of_member(member);
        let name = name.expect("the tested member has a private name");
        let mut lowering = FunctionLowering::begin(self, function);
        let this = lowering.builder.this_value();
        let this = this.expect("a private name test takes this");
        lowering.set_position(position);
        let result = lowering.emit_name_test(this, name);
        lowering.emit_return(result, None);
        lowering.finish();
    }

    fn create_accessor_header(
        &mut self,
        key: FunctionKey,
        member: MemberId,
        function: AccessorFunction,
    ) -> Function {
        let position = self.hir[member].name_pos;
        let mut header = function::create_header(self, key, get_function_kind(function), position);
        header.flags |= FunctionFlags::HAS_THIS;
        header.name = find_function_name(self, member);
        match function {
            AccessorFunction::Setter => {
                header.parameters.push(DeclaredType::untyped());
                header.length = 1;
            }
            AccessorFunction::Getter | AccessorFunction::PrivateNameTest => {}
        }
        header
    }

    fn find_member_storage(&self, member: MemberId) -> Option<MemberStorage> {
        if is_auto_accessor(self.hir, member) {
            return Some(MemberStorage::AutoAccessor);
        }
        let name = self.bound.private_name_of_member(member)?;
        match self.bound.private_name(name).members {
            PrivateMembers::Field(_) => Some(MemberStorage::PrivateField(name)),
            _ => None,
        }
    }
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

impl FunctionLowering<'_, '_, '_, '_, '_> {
    fn emit_storage_read(&mut self, member: MemberId, this: ValueId) -> ValueId {
        match self.file.find_member_storage(member) {
            Some(MemberStorage::AutoAccessor) => self.emit_storage_get(this, member),
            Some(MemberStorage::PrivateField(name)) => self.emit_name_get(this, name),
            None => {
                debug_assert!(false, "the member is an accessor field or a private field");
                self.builder.undefined()
            }
        }
    }

    fn emit_storage_write(&mut self, member: MemberId, this: ValueId, value: ValueId) {
        match self.file.find_member_storage(member) {
            Some(MemberStorage::AutoAccessor) => {
                self.emit_storage_set(this, member, value);
            }
            Some(MemberStorage::PrivateField(name)) => {
                self.emit_name_set(this, name, value, None);
            }
            None => debug_assert!(false, "the member is an accessor field or a private field"),
        }
    }
}
