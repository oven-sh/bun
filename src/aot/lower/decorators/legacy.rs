use bun_sema::bind::decorator_metadata::{
    is_field_moved_by_legacy_decorators, is_legacy_decorated_member,
};
use bun_sema::hir::{self, ClassId, Flags, FnId, MemberId, MemberKind, ModifierId, Span};
use smallvec::SmallVec;

use crate::builtins::id::BuiltinId;
use crate::ir::{TypeTable, ValueId};
use crate::lower::FunctionLowering;
use crate::lower::class::{
    ClassElement, ClassEvaluation, ClassPlan, FieldValue, decorators_of, find_member_value,
    has_decorators,
};

type DecoratorList = SmallVec<[ValueId; 8]>;

fn take_decorated_fields(
    hir: &hir::File<'_>,
    elements: &mut Vec<ClassElement>,
) -> Vec<ClassElement> {
    let mut assigned = Vec::new();
    elements.retain(|element| {
        let ClassElement::Field { member, value } = *element else {
            return true;
        };
        if !is_field_moved_by_legacy_decorators(hir, member) {
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
    assigned
}

pub(in crate::lower) fn move_decorated_fields(hir: &hir::File<'_>, plan: &mut ClassPlan) {
    plan.injected_elements = take_decorated_fields(hir, &mut plan.instance_elements);
    plan.elements_behind_class = take_decorated_fields(hir, &mut plan.static_elements);
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

fn emit_key_as_written(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    evaluation: &ClassEvaluation,
    member: MemberId,
) -> ValueId {
    if let Some(unconverted) = find_member_value(&evaluation.unconverted_keys, member) {
        return unconverted;
    }
    if let Some(constant) = lowering.file.find_constant_written_as_key(member) {
        return lowering.emit_constant(constant);
    }
    let name = match find_member_value(&evaluation.member_names, member) {
        Some(name) => name,
        None => lowering.lower_property_name(lowering.file.hir.runtime_member_key(member)),
    };
    lowering.emit_name_value(name)
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
    let key = emit_key_as_written(lowering, evaluation, member);
    let helper = if is_method_or_accessor {
        BuiltinId::CompilerHelpersDecorateMethod
    } else {
        BuiltinId::CompilerHelpersDecorateProperty
    };
    lowering.emit_builtin_call(helper, &[decorators, target, key]);
}
