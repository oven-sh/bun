use bun_sema::bind::decorator_metadata::is_legacy_decorated_member;
use bun_sema::hir::{self, ClassId, Flags, FnId, MemberId, MemberKind, ModifierId, PropKey, Span};
use smallvec::SmallVec;

use crate::builtins::id::BuiltinId;
use crate::ir::{TypeTable, ValueId};
use crate::lower::FunctionLowering;
use crate::lower::class::{
    ClassElement, ClassEvaluation, ClassPlan, FieldValue, decorators_of, find_member_value,
    has_decorators, is_auto_accessor,
};

type DecoratorList = SmallVec<[ValueId; 8]>;

fn is_moved_field(hir: &hir::File<'_>, member: MemberId) -> bool {
    let field = hir[member];
    let has_private_key = match hir.runtime_member_key(member) {
        PropKey::Private(_) => true,
        PropKey::None | PropKey::Name(_) | PropKey::Computed(_) => false,
    };
    field.kind == MemberKind::Property
        && !is_auto_accessor(hir, member)
        && !has_private_key
        && has_decorators(hir, field.modifiers)
}

pub(in crate::lower) fn move_decorated_fields(hir: &hir::File<'_>, plan: &mut ClassPlan) {
    for elements in [&mut plan.instance_elements, &mut plan.static_elements] {
        let mut assigned = SmallVec::<[ClassElement; 4]>::new();
        elements.retain(|element| {
            let ClassElement::Field { member, value } = *element else {
                return true;
            };
            if !is_moved_field(hir, member) {
                return true;
            }
            match value {
                FieldValue::Initializer => assigned.push(ClassElement::AssignedField { member }),
                FieldValue::Undefined => {}
                FieldValue::Decorated { .. } => {
                    unreachable!("only standard decorators plan a decorated field")
                }
            }
            false
        });
        elements.extend(assigned);
    }
}

pub(in crate::lower) fn has_legacy_decorators(hir: &hir::File<'_>, class: ClassId) -> bool {
    let mut members = hir[class].members.iter();
    has_decorators(hir, hir[class].modifiers)
        || members.any(|member| is_legacy_decorated_member(hir, member))
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(in crate::lower) fn apply_legacy_decorators(
        &mut self,
        plan: &ClassPlan,
        evaluation: &ClassEvaluation,
    ) -> Option<ValueId> {
        let hir = self.file.hir;
        let class = evaluation.class;
        let is_static = |member: &MemberId| hir[*member].flags.contains(Flags::STATIC);
        let decorated_members = hir[class].members.iter().filter(|&member| {
            is_legacy_decorated_member(hir, member)
                && hir.runtime_member_kind(member) != MemberKind::Constructor
        });
        for on_class_object in [false, true] {
            let members = decorated_members.clone();
            for member in members.filter(|member| is_static(member) == on_class_object) {
                decorate_member(self, evaluation, member);
            }
        }

        let mut list = DecoratorList::new();
        self.lower_decorator_list(hir[class].modifiers, &mut list);
        if let Some(constructor) = plan.constructor {
            self.lower_parameter_decorators(constructor, &mut list);
        }
        if list.is_empty() {
            return None;
        }
        self.set_position(hir[class].name_pos);
        if let Some(constructor) = plan.constructor
            && self.file.compiled.settings.emits_decorator_metadata
        {
            list.push(self.emit_constructor_metadata(class, constructor));
        }
        let decorators = self.builder.new_array(TypeTable::ANYTHING, &[], &list);
        let arguments = [decorators, evaluation.class_object];
        Some(self.emit_builtin_call(BuiltinId::CompilerHelpersDecorateClass, &arguments))
    }

    fn lower_decorator_list(&mut self, modifiers: Span<ModifierId>, list: &mut DecoratorList) {
        for decorator in decorators_of(self.file.hir, modifiers) {
            list.push(self.lower_expression(decorator));
        }
    }

    fn lower_parameter_decorators(&mut self, function: FnId, list: &mut DecoratorList) {
        let hir = self.file.hir;
        for (index, parameter) in hir[function].params.iter().enumerate() {
            for decorator in decorators_of(hir, hir.param_modifiers(parameter)) {
                let index = self.builder.integer(index as i64);
                let decorator = self.lower_expression(decorator);
                let helper = BuiltinId::CompilerHelpersDecorateParameter;
                list.push(self.emit_builtin_call(helper, &[index, decorator]));
            }
        }
    }
}

fn decorate_member(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    evaluation: &ClassEvaluation,
    member: MemberId,
) {
    let hir = lowering.file.hir;
    let node = hir[member];
    let is_method_or_accessor = matches!(
        node.kind,
        MemberKind::Method | MemberKind::Getter | MemberKind::Setter
    );

    let mut list = DecoratorList::new();
    lowering.lower_decorator_list(node.modifiers, &mut list);
    if is_method_or_accessor {
        lowering.lower_parameter_decorators(node.func, &mut list);
    }
    debug_assert!(!list.is_empty(), "decorate_member takes a decorated member");
    lowering.set_position(node.name_pos);
    if lowering.file.compiled.settings.emits_decorator_metadata {
        lowering.emit_member_metadata(evaluation.class, member, &mut list);
    }

    let decorators = lowering.builder.new_array(TypeTable::ANYTHING, &[], &list);
    let is_static = node.flags.contains(Flags::STATIC);
    let target = lowering.emit_holder(evaluation.class_object, is_static);
    let name = match find_member_value(&evaluation.member_names, member) {
        Some(name) => name,
        None => lowering.lower_property_name(hir.runtime_member_key(member)),
    };
    let key = lowering.emit_name_value(name);
    let helper = if is_method_or_accessor {
        BuiltinId::CompilerHelpersDecorateMethod
    } else {
        BuiltinId::CompilerHelpersDecorateProperty
    };
    lowering.emit_builtin_call(helper, &[decorators, target, key]);
}
