use bun_sema::bind::{CodeUnit, FnOwner, SymbolId};
use bun_sema::hir::{ClassId, Flags, MemberId, MemberKind};
use bun_sema::program::Sym;

use crate::ir::generated::{HomeObjectKind, Variable, VariableFlags, VariableInitialization};
use crate::ir::{
    ClassSlot, DeclaredType, OpaqueKind, PrivateStatePart, Type, ValueId, VariableId, VariableKey,
};
use crate::lower::scope::ScopeSlot;
use crate::lower::{FileLowering, FunctionLowering};

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(in crate::lower) fn get_class_slot(&mut self, class: ClassId, slot: ClassSlot) -> ValueId {
        let class_scope = self.file.bound.class_scope[class.idx()];
        self.get_slot(class_scope, ScopeSlot::Class(slot))
    }

    pub(in crate::lower) fn set_class_slot(
        &mut self,
        class: ClassId,
        slot: ClassSlot,
        value: ValueId,
    ) {
        let class_scope = self.file.bound.class_scope[class.idx()];
        self.set_slot(class_scope, ScopeSlot::Class(slot), value);
    }

    pub(in crate::lower) fn get_private_state_slot(
        &mut self,
        state: SymbolId,
        part: PrivateStatePart,
    ) -> ValueId {
        let variable = private_state_variable(self.file, state, part);
        self.builder.get_module_variable(variable)
    }

    pub(in crate::lower) fn set_private_state_slot(
        &mut self,
        state: SymbolId,
        part: PrivateStatePart,
        value: ValueId,
    ) {
        let variable = private_state_variable(self.file, state, part);
        self.builder.put_module_variable(variable, value);
    }

    pub(super) fn find_enclosing_member(&self) -> Option<(ClassId, MemberId)> {
        let bound = self.file.bound;
        let innermost = self.innermost_scope();
        let owner = self.file.scopes.lexical_owner(innermost);
        let member = match bound.code_unit(owner) {
            CodeUnit::Function(function) => match bound.fns[function.idx()].owner {
                FnOwner::Member(member) => member,
                FnOwner::None | FnOwner::Expr(_) | FnOwner::Stmt(_) | FnOwner::Type(_) => {
                    return None;
                }
            },
            CodeUnit::FieldInitializer(member) => member,
            CodeUnit::File => return None,
        };
        let class = bound.member_class(member)?;
        Some((class, member))
    }

    pub(crate) fn get_class_home(&mut self) -> (HomeObjectKind, ValueId) {
        let Some((class, member)) = self.find_enclosing_member() else {
            debug_assert!(false, "only code of a class member has a class home object");
            return (HomeObjectKind::Object, self.builder.undefined());
        };
        let class_object = self.get_class_slot(class, ClassSlot::ClassObject);
        let node = self.file.hir[member];
        if node.flags.contains(Flags::STATIC) || node.kind == MemberKind::StaticBlock {
            (HomeObjectKind::Object, class_object)
        } else {
            (HomeObjectKind::ClassPrototype, class_object)
        }
    }
}

// The text has no place for what belongs to private state, and the code that uses it stands inside and outside the class.
fn private_state_variable(
    file: &mut FileLowering<'_, '_, '_, '_>,
    state: SymbolId,
    part: PrivateStatePart,
) -> VariableId {
    let state = Sym {
        file: file.file,
        id: state,
    };
    file.ensure_variable(VariableKey::PrivateState { state, part })
}

impl FileLowering<'_, '_, '_, '_> {
    pub(in crate::lower) fn create_private_state_variable(
        &mut self,
        part: PrivateStatePart,
    ) -> Variable {
        let (declared, initialization) = match part {
            PrivateStatePart::Collection => {
                (DeclaredType::untyped(), VariableInitialization::Undefined)
            }
            PrivateStatePart::Token => {
                let token = self
                    .fragment
                    .types
                    .intern(Type::opaque(OpaqueKind::ClassToken));
                let declared = DeclaredType::from_compiler(token);
                (declared, VariableInitialization::Uninitialized)
            }
        };
        Variable {
            name: None,
            module: self.module_id(),
            declared,
            initialization,
            function: None,
            owner: None,
            flags: VariableFlags::default(),
        }
    }
}
