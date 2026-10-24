use bun_sema::atom::known;
use bun_sema::hir::{ClassId, Flags, Member, MemberId, MemberKind, ModifierId, PropKey, Span};
use smallvec::SmallVec;

use super::{
    AccessorFunction, ClassPlan, ClassTransform, declare_accessor_function, decorators_of,
    has_decorators, is_declaration_only, runtime_members,
};
use crate::ir::generated::{ClassSide, MethodKind, RuntimeErrorKind};
use crate::ir::{ClassSlot, Edge, LayoutId, TypeTable, ValueId};
use crate::lower::member::PropertyName;
use crate::lower::{FunctionLowering, layouts};

#[derive(Default)]
pub(super) struct MemberValues {
    pub(super) decorators: SmallVec<[(MemberId, ValueId); 4]>,
    pub(super) names: SmallVec<[(MemberId, PropertyName); 4]>,
}

#[derive(Copy, Clone)]
pub(super) struct ClassHead {
    pub(super) class: ClassId,
    pub(super) layout: LayoutId,
    pub(super) value: ValueId,
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(super) fn emit_decorator_array(&mut self, modifiers: Span<ModifierId>) -> ValueId {
        let mut decorators: SmallVec<[ValueId; 4]> = SmallVec::new();
        for decorator in decorators_of(self.file.hir, modifiers) {
            decorators.push(self.lower_expression(decorator));
        }
        self.builder
            .new_array(TypeTable::ANYTHING, &[], &decorators)
    }

    pub(super) fn define_members(&mut self, head: ClassHead, plan: &ClassPlan) -> MemberValues {
        let hir = self.file.hir;
        let is_standard = plan.transform == ClassTransform::Standard;
        let mut values = MemberValues::default();
        let mut next_method_index = 0;
        for member in runtime_members(hir, head.class) {
            let modifiers = hir[member].modifiers;
            if is_standard && has_decorators(hir, modifiers) {
                let decorators = self.emit_decorator_array(modifiers);
                values.decorators.push((member, decorators));
            }
            if let Some(name) = self.lower_member_name(head, member, &mut values) {
                define_member(self, head, plan, member, name, &mut next_method_index);
            }
        }
        values
    }

    fn lower_member_name(
        &mut self,
        head: ClassHead,
        member: MemberId,
        values: &mut MemberValues,
    ) -> Option<PropertyName> {
        let key = self.file.hir.runtime_member_key(member);
        match key {
            PropKey::Name(name) => {
                let key = self.file.name_key(name);
                Some(PropertyName::Constant(key))
            }
            PropKey::Computed(_) => {
                let name = self.lower_property_name(key);
                values.names.push((member, name));
                Some(name)
            }
            PropKey::Private(name) => {
                let key = layouts::private_key(self.file, head.layout, name);
                Some(PropertyName::Constant(key))
            }
            PropKey::None => None,
        }
    }

    fn check_static_field_key(&mut self, name: PropertyName) {
        match name {
            PropertyName::Constant(key) => {
                if key == self.file.name_key(known::prototype) {
                    self.emit_throw_runtime_error(RuntimeErrorKind::StaticPrototypeKey, None);
                }
            }
            PropertyName::Computed(value) => {
                let prototype = self.file.intern_atom(known::prototype);
                let prototype = self.builder.string(prototype);
                let is_prototype = self.builder.strict_eq(value, prototype);
                let invalid = self.create_unlikely_block();
                let valid = self.create_block();
                self.builder
                    .branch(is_prototype, Edge::to(invalid), Edge::to(valid));
                self.continue_in(invalid);
                self.emit_throw_runtime_error(RuntimeErrorKind::StaticPrototypeKey, None);
                self.continue_in(valid);
            }
        }
    }

    fn emit_method_definition(
        &mut self,
        head: ClassHead,
        side: ClassSide,
        kind: MethodKind,
        name: PropertyName,
        closure: ValueId,
        next_method_index: &mut u32,
    ) {
        let (computed, constant) = name.key_operands();
        if let Some(key) = constant {
            self.file.fragment.note_write(key);
        }
        self.builder.define_method(
            head.value,
            closure,
            computed,
            head.layout,
            side,
            kind,
            *next_method_index,
            constant,
        );
        *next_method_index += 1;
    }

    fn define_method(
        &mut self,
        head: ClassHead,
        member: MemberId,
        name: PropertyName,
        next_method_index: &mut u32,
    ) {
        let node = self.file.hir[member];
        let kind = match self.file.hir.runtime_member_kind(member) {
            MemberKind::Method => MethodKind::Method,
            MemberKind::Getter => MethodKind::Getter,
            MemberKind::Setter => MethodKind::Setter,
            _ => {
                debug_assert!(false, "only a method, getter or setter is a method piece");
                return;
            }
        };
        self.set_position(node.name_pos);
        let closure = self.lower_method(node.func, name, head.value);
        let side = class_side(node);
        self.emit_method_definition(head, side, kind, name, closure, next_method_index);
    }

    fn define_accessor_pair(
        &mut self,
        head: ClassHead,
        member: MemberId,
        name: PropertyName,
        next_method_index: &mut u32,
    ) {
        let hir = self.file.hir;
        let node = hir[member];
        self.set_position(node.name_pos);
        let computed_name = match hir.runtime_member_key(member) {
            PropKey::Computed(_) => Some(self.emit_name_value(name)),
            PropKey::Name(_) | PropKey::Private(_) | PropKey::None => None,
        };
        let halves = [
            (AccessorFunction::Getter, MethodKind::Getter),
            (AccessorFunction::Setter, MethodKind::Setter),
        ];
        for (accessor, kind) in halves {
            let id = declare_accessor_function(self.file, member, accessor);
            let closure = self.emit_closure(id, None);
            if let Some(key) = computed_name {
                self.builder.set_function_name(closure, key, kind);
            }
            let side = class_side(node);
            self.emit_method_definition(head, side, kind, name, closure, next_method_index);
        }
    }
}

fn define_member(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    head: ClassHead,
    plan: &ClassPlan,
    member: MemberId,
    name: PropertyName,
    next_method_index: &mut u32,
) {
    let hir = lowering.file.hir;
    let node = hir[member];
    let key = hir.runtime_member_key(member);
    let is_private = matches!(key, PropKey::Private(_));
    match hir.runtime_member_kind(member) {
        MemberKind::Property if is_declaration_only(node) => {}
        MemberKind::Property if node.flags.contains(Flags::ACCESSOR) => {
            if !is_private {
                lowering.define_accessor_pair(head, member, name, next_method_index);
            }
        }
        MemberKind::Property => {
            lowering.set_position(node.name_pos);
            if node.flags.contains(Flags::STATIC) {
                lowering.check_static_field_key(name);
            }
            if matches!(key, PropKey::Computed(_)) {
                match name {
                    PropertyName::Constant(key) => {
                        lowering.file.classes.constant_keys.insert(member, key);
                    }
                    PropertyName::Computed(_) => {}
                }
                let value = lowering.emit_name_value(name);
                lowering.set_class_slot(head.class, ClassSlot::ComputedKey(member), value);
            }
        }
        MemberKind::Method | MemberKind::Getter | MemberKind::Setter => {
            let is_standard = plan.transform == ClassTransform::Standard;
            if !is_private {
                lowering.define_method(head, member, name, next_method_index);
            } else if !(is_standard && has_decorators(hir, node.modifiers)) {
                lowering.set_position(node.name_pos);
                let closure = lowering.lower_method(node.func, name, head.value);
                lowering.set_class_slot(head.class, ClassSlot::PrivateMethod(member), closure);
            }
        }
        MemberKind::Constructor
        | MemberKind::StaticBlock
        | MemberKind::CallSignature
        | MemberKind::ConstructSignature
        | MemberKind::IndexSignature => {}
    }
}

fn class_side(node: Member) -> ClassSide {
    if node.flags.contains(Flags::STATIC) {
        ClassSide::Static
    } else {
        ClassSide::Prototype
    }
}
