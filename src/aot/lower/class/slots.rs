use bun_sema::bind::{CodeUnit, FnOwner, SymbolId};
use bun_sema::hir::{ClassId, Flags, MemberId, MemberKind};
use bun_sema::program::Sym;

use crate::ir::generated::{HomeObjectKind, Variable, VariableFlags, VariableInitialization};
use crate::ir::{
    ClassSlot, DeclaredType, OpaqueKind, PrivateStatePart, Type, ValueId, VariableId, VariableKey,
};
use crate::lower::scope::{self, ScopeSlot};
use crate::lower::{FileLowering, FunctionLowering};

pub(in crate::lower) fn get_class_slot(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    class: ClassId,
    slot: ClassSlot,
) -> ValueId {
    let class_scope = lowering.file.bound.class_scope[class.idx()];
    scope::get_slot(lowering, class_scope, ScopeSlot::Class(slot))
}

pub(in crate::lower) fn set_class_slot(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    class: ClassId,
    slot: ClassSlot,
    value: ValueId,
) {
    let class_scope = lowering.file.bound.class_scope[class.idx()];
    scope::set_slot(lowering, class_scope, ScopeSlot::Class(slot), value);
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
    scope::ensure_variable(file, VariableKey::PrivateState { state, part })
}

pub(in crate::lower) fn create_private_state_variable(
    file: &mut FileLowering<'_, '_, '_, '_>,
    part: PrivateStatePart,
) -> Variable {
    let (declared, initialization) = match part {
        PrivateStatePart::Collection => {
            (DeclaredType::untyped(), VariableInitialization::Undefined)
        }
        PrivateStatePart::Token => {
            let token = file.fragment.types.intern(Type::opaque(OpaqueKind::ClassToken));
            let declared = DeclaredType::from_compiler(token);
            (declared, VariableInitialization::Uninitialized)
        }
    };
    Variable {
        name: None,
        module: file.module_id(),
        declared,
        initialization,
        function: None,
        owner: None,
        flags: VariableFlags::default(),
    }
}

pub(in crate::lower) fn get_private_state_slot(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    state: SymbolId,
    part: PrivateStatePart,
) -> ValueId {
    let variable = private_state_variable(lowering.file, state, part);
    lowering.builder.get_module_variable(variable)
}

pub(in crate::lower) fn set_private_state_slot(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    state: SymbolId,
    part: PrivateStatePart,
    value: ValueId,
) {
    let variable = private_state_variable(lowering.file, state, part);
    lowering.builder.put_module_variable(variable, value);
}

pub(super) fn find_enclosing_member(
    lowering: &FunctionLowering<'_, '_, '_, '_, '_>,
) -> Option<(ClassId, MemberId)> {
    let bound = lowering.file.bound;
    let innermost = scope::innermost_scope(lowering);
    let owner = lowering.file.scopes.lexical_owner(innermost);
    let member = match bound.code_unit(owner) {
        CodeUnit::Function(function) => match bound.fns[function.idx()].owner {
            FnOwner::Member(member) => member,
            FnOwner::None | FnOwner::Expr(_) | FnOwner::Stmt(_) | FnOwner::Type(_) => return None,
        },
        CodeUnit::FieldInitializer(member) => member,
        CodeUnit::File => return None,
    };
    let class = bound.member_class(member)?;
    Some((class, member))
}

pub(super) fn get_class_home(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
) -> (HomeObjectKind, ValueId) {
    let Some((class, member)) = find_enclosing_member(lowering) else {
        debug_assert!(false, "only code of a class member has a class home object");
        return (HomeObjectKind::Object, lowering.builder.undefined());
    };
    let class_object = get_class_slot(lowering, class, ClassSlot::ClassObject);
    let node = lowering.file.hir[member];
    if node.flags.contains(Flags::STATIC) || node.kind == MemberKind::StaticBlock {
        (HomeObjectKind::Object, class_object)
    } else {
        (HomeObjectKind::ClassPrototype, class_object)
    }
}
