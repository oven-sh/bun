use bun_sema::atom::written_name;
use bun_sema::bind::PrivateMembers;
use bun_sema::hir::{MemberId, PropKey};
use bun_sema::program::FileId;

use super::is_auto_accessor;
use crate::ir::generated::{FunctionFlags, FunctionKind, MethodKind};
use crate::ir::{DeclaredType, FunctionId, FunctionKey, StringId};
use crate::lower::private_names::StoredValue;
use crate::lower::{FileLowering, FunctionLowering, function};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(in crate::lower) enum AccessorFunction {
    Getter,
    Setter,
    PrivateNameTest,
}

pub(in crate::lower) fn declare_accessor_function(
    file: &mut FileLowering<'_, '_, '_, '_>,
    member: MemberId,
    function: AccessorFunction,
) -> FunctionId {
    let key = get_function_key(file.file, member, function);
    file.declare_function(key, |file| {
        let position = file.hir[member].name_pos;
        let kind = match function {
            AccessorFunction::Getter => FunctionKind::Getter,
            AccessorFunction::Setter => FunctionKind::Setter,
            AccessorFunction::PrivateNameTest => FunctionKind::Method,
        };
        let mut header = function::create_header(file, key, kind, position);
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
            MethodKind::Getter => match lowering.file.find_member_storage(member) {
                Some(stored) => lowering.emit_stored_read(stored, this),
                None => {
                    debug_assert!(false, "the member is an accessor field or a private field");
                    lowering.builder.undefined()
                }
            },
            MethodKind::Setter => {
                let value = lowering.builder.parameter(0);
                match lowering.file.find_member_storage(member) {
                    Some(stored) => lowering.emit_stored_write(stored, this, value, None),
                    None => {
                        debug_assert!(false, "the member is an accessor field or a private field");
                    }
                }
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

    fn find_member_storage(&mut self, member: MemberId) -> Option<StoredValue> {
        if is_auto_accessor(self.hir, member) {
            return Some(self.resolve_accessor_storage(member));
        }
        let name = self.bound.private_name_of_member(member)?;
        match self.bound.private_name(name).members {
            PrivateMembers::Field(field) => {
                Some(StoredValue::of_name(self.resolve_private_name(name), field))
            }
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
