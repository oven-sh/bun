use bun_sema::bind::Bound;
use bun_sema::hir::{self, ClassId, Flags, MemberId, MemberKind, PropKey};
use rustc_hash::FxHashMap;

use super::{DecoratedKind, Decoration, DecorationGroup, ValueInitializers};
use crate::lower::class::{
    ClassElement, ClassPlan, FieldValue, has_decorators, has_instance_brand, is_auto_accessor,
    is_declaration_only, runtime_members,
};

type InitializerLists = FxHashMap<MemberId, ValueInitializers>;

pub(in crate::lower) fn plan_standard_elements(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    class: ClassId,
    plan: &mut ClassPlan,
) {
    let mut decorations: Vec<Decoration> = runtime_members(hir, class)
        .filter_map(|member| create_decoration(hir, member))
        .collect();
    decorations.sort_by_key(|decoration| decoration.group());
    let lists = number_initializer_lists(&mut decorations, plan);
    plan.decorations = decorations;
    plan.instance_elements = plan_instance_elements(hir, bound, class, plan, &lists);
    plan.static_elements = plan_static_elements(hir, class, &lists);
}

fn decorated_kind(hir: &hir::File<'_>, member: MemberId) -> Option<DecoratedKind> {
    match hir.runtime_member_kind(member) {
        MemberKind::Method => Some(DecoratedKind::Method),
        MemberKind::Getter => Some(DecoratedKind::Getter),
        MemberKind::Setter => Some(DecoratedKind::Setter),
        MemberKind::Property if is_auto_accessor(hir, member) => Some(DecoratedKind::Accessor),
        MemberKind::Property => Some(DecoratedKind::Field),
        MemberKind::Constructor
        | MemberKind::CallSignature
        | MemberKind::ConstructSignature
        | MemberKind::IndexSignature
        | MemberKind::StaticBlock => None,
    }
}

fn create_decoration(hir: &hir::File<'_>, member: MemberId) -> Option<Decoration> {
    let node = hir[member];
    if !has_decorators(hir, node.modifiers) {
        return None;
    }
    let is_private = match hir.runtime_member_key(member) {
        PropKey::Private(_) => true,
        PropKey::None | PropKey::Name(_) | PropKey::Computed(_) => false,
    };
    Some(Decoration {
        member,
        kind: decorated_kind(hir, member)?,
        is_static: node.flags.contains(Flags::STATIC),
        is_private,
        initializers: None,
    })
}

fn number_initializer_lists(
    decorations: &mut [Decoration],
    plan: &mut ClassPlan,
) -> InitializerLists {
    let mut next = 0;
    let has_instance_methods = decorations
        .iter()
        .any(|decoration| decoration.group() == DecorationGroup::InstanceMethod);
    if has_instance_methods {
        plan.instance_method_initializers = Some(next);
        next += 1;
    }
    let mut lists = InitializerLists::default();
    for decoration in decorations {
        match decoration.kind {
            DecoratedKind::Accessor | DecoratedKind::Field => {
                let initializers = ValueInitializers {
                    value: next,
                    extra: next + 1,
                };
                next += 2;
                decoration.initializers = Some(initializers);
                lists.insert(decoration.member, initializers);
            }
            DecoratedKind::Method | DecoratedKind::Getter | DecoratedKind::Setter => {}
        }
    }
    plan.initializer_list_count = next;
    lists
}

fn plan_instance_elements(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    class: ClassId,
    plan: &ClassPlan,
    lists: &InitializerLists,
) -> Vec<ClassElement> {
    let mut elements = Vec::new();
    if has_instance_brand(hir, bound, class) {
        elements.push(ClassElement::Brand);
    }
    if let Some(initializers) = plan.instance_method_initializers {
        elements.push(ClassElement::RunInitializers { initializers });
    }
    for &parameter in &plan.parameter_properties {
        elements.push(ClassElement::ParameterPropertyField(parameter));
    }
    for member in runtime_members(hir, class) {
        let node = hir[member];
        if node.kind == MemberKind::Property && !node.flags.contains(Flags::STATIC) {
            push_property_elements(&mut elements, hir, lists, member);
        }
    }
    elements
}

fn plan_static_elements(
    hir: &hir::File<'_>,
    class: ClassId,
    lists: &InitializerLists,
) -> Vec<ClassElement> {
    let mut elements = Vec::new();
    for member in runtime_members(hir, class) {
        let node = hir[member];
        match node.kind {
            MemberKind::StaticBlock => elements.push(ClassElement::StaticBlock(member)),
            MemberKind::Property if node.flags.contains(Flags::STATIC) => {
                push_property_elements(&mut elements, hir, lists, member);
            }
            MemberKind::Property
            | MemberKind::Method
            | MemberKind::Getter
            | MemberKind::Setter
            | MemberKind::Constructor
            | MemberKind::CallSignature
            | MemberKind::ConstructSignature
            | MemberKind::IndexSignature => {}
        }
    }
    elements
}

fn push_property_elements(
    elements: &mut Vec<ClassElement>,
    hir: &hir::File<'_>,
    lists: &InitializerLists,
    member: MemberId,
) {
    if is_declaration_only(hir[member]) {
        return;
    }
    let initializers = lists.get(&member).copied();
    let value = match initializers {
        Some(initializers) => FieldValue::Decorated {
            initializers: initializers.value,
        },
        None if hir[member].init.is_some() => FieldValue::Initializer,
        None => FieldValue::Undefined,
    };
    if is_auto_accessor(hir, member) {
        elements.push(ClassElement::AccessorStorage { member, value });
    } else {
        elements.push(ClassElement::Field { member, value });
    }
    if let Some(initializers) = initializers {
        elements.push(ClassElement::RunInitializers {
            initializers: initializers.extra,
        });
    }
}
