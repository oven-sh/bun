use bun_sema::bind::{Bound, ClassOwner, PrivateMembers, PrivateName};
use bun_sema::hir::{
    self, ClassId, ExprId, ExprKind, Flags, FnBody, FnId, Member, MemberId, MemberKind, ModifierId,
    ParamId, PatKind, PropKey, Span, StmtKind,
};
use bun_sema::resolve::TranspileSettings;
use smallvec::{SmallVec, smallvec};

use super::{
    ClassElement, ClassPlan, ClassTransform, FieldSemantics, FieldValue, InitializerCall,
    InjectionPoint,
};
use crate::ir::ClassSlot;
use crate::lower::decorators::{self, InitializerLists};

pub(in crate::lower) fn runtime_members(
    hir: &hir::File<'_>,
    class: ClassId,
) -> impl Iterator<Item = MemberId> {
    let members = hir[class].members.iter();
    members.filter(move |&member| hir::has_runtime_member(hir, member))
}

pub(in crate::lower) fn decorators_of<'h>(
    hir: &'h hir::File<'_>,
    modifiers: Span<ModifierId>,
) -> impl Iterator<Item = ExprId> + 'h {
    modifiers
        .iter()
        .filter_map(move |modifier| match hir[modifier].kind {
            hir::ModifierKind::Decorator(expression) => Some(expression),
            hir::ModifierKind::Keyword(_) => None,
        })
}

pub(in crate::lower) fn has_decorators(hir: &hir::File<'_>, modifiers: Span<ModifierId>) -> bool {
    decorators_of(hir, modifiers).next().is_some()
}

pub(in crate::lower) fn is_declaration_only(node: Member) -> bool {
    node.flags.intersects(Flags::AMBIENT | Flags::ABSTRACT)
}

pub(in crate::lower) fn is_auto_accessor(hir: &hir::File<'_>, member: MemberId) -> bool {
    let node = hir[member];
    node.kind == MemberKind::Property && node.flags.contains(Flags::ACCESSOR)
}

pub(in crate::lower) fn is_derived_class(hir: &hir::File<'_>, class: ClassId) -> bool {
    hir[class].extends.is_some()
}

// No property of the class object holds this value, so each evaluation of the class needs a location of its own for it.
pub(in crate::lower) fn has_private_static_storage(hir: &hir::File<'_>, member: MemberId) -> bool {
    let node = hir[member];
    node.kind == MemberKind::Property
        && node.flags.contains(Flags::STATIC)
        && !is_declaration_only(node)
        && (node.flags.contains(Flags::ACCESSOR)
            || matches!(hir.runtime_member_key(member), PropKey::Private(_)))
}

pub(in crate::lower) fn has_instance_brand(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    class: ClassId,
) -> bool {
    let has_private_name = bound.runtime.is_computed()
        && bound
            .private_names_of_class(class)
            .any(|(_, name)| !name.is_static);
    has_private_name
        || runtime_members(hir, class).any(|member| {
            let node = hir[member];
            is_auto_accessor(hir, member)
                && !node.flags.contains(Flags::STATIC)
                && !is_declaration_only(node)
        })
}

pub(in crate::lower) fn is_decorated_private_name(
    hir: &hir::File<'_>,
    transform: ClassTransform,
    name: &PrivateName,
) -> bool {
    let is_decorated = |member: MemberId| has_decorators(hir, hir[member].modifiers);
    match transform {
        ClassTransform::None | ClassTransform::Legacy => false,
        ClassTransform::Standard => match name.members {
            PrivateMembers::Field(member)
            | PrivateMembers::Method(member)
            | PrivateMembers::AutoAccessor(member) => is_decorated(member),
            PrivateMembers::Accessor { getter, setter } => {
                getter.into_iter().chain(setter).any(is_decorated)
            }
        },
    }
}

fn has_decorated_private_name(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    transform: ClassTransform,
    member: MemberId,
) -> bool {
    let name = bound.private_name_of_member(member);
    name.is_some_and(|name| is_decorated_private_name(hir, transform, bound.private_name(name)))
}

fn compute_class_transform(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    class: ClassId,
) -> ClassTransform {
    if hir.has_typescript_semantics() && hir.legacy_decorators {
        return match bound.class_owner[class.idx()] {
            ClassOwner::Stmt(_) if decorators::has_legacy_decorators(hir, class) => {
                ClassTransform::Legacy
            }
            ClassOwner::Stmt(_) | ClassOwner::Expr(_) => ClassTransform::None,
        };
    }
    let has_standard_syntax =
        |node: Member| node.flags.contains(Flags::ACCESSOR) || has_decorators(hir, node.modifiers);
    let is_standard = has_decorators(hir, hir[class].modifiers)
        || runtime_members(hir, class).any(|member| has_standard_syntax(hir[member]));
    if is_standard {
        ClassTransform::Standard
    } else {
        ClassTransform::None
    }
}

fn has_computed_field_key(hir: &hir::File<'_>, member: MemberId) -> bool {
    let node = hir[member];
    node.kind == MemberKind::Property
        && !node.flags.contains(Flags::ACCESSOR)
        && !is_declaration_only(node)
        && matches!(hir.runtime_member_key(member), PropKey::Computed(_))
}

fn find_injection_point(hir: &hir::File<'_>, class: ClassId, constructor: FnId) -> InjectionPoint {
    let FnBody::Block(statements) = hir[constructor].body else {
        return InjectionPoint::Start;
    };
    if !is_derived_class(hir, class) {
        return InjectionPoint::Start;
    }
    for statement in hir.ids(statements) {
        if let StmtKind::Expr(expression) = hir[statement].kind
            && let ExprKind::Call(call) = hir[expression].kind
            && matches!(hir[hir[call].callee].kind, ExprKind::Super)
        {
            return InjectionPoint::AfterSuperCall(expression);
        }
    }
    InjectionPoint::Start
}

fn create_field_element(hir: &hir::File<'_>, member: MemberId, value: FieldValue) -> ClassElement {
    if is_auto_accessor(hir, member) {
        ClassElement::AccessorStorage { member, value }
    } else {
        ClassElement::Field { member, value }
    }
}

fn push_defined_field(
    hir: &hir::File<'_>,
    lists: &InitializerLists,
    elements: &mut Vec<ClassElement>,
    member: MemberId,
) {
    let initializers = lists.get(&member).copied();
    let value = match initializers {
        Some(initializers) => FieldValue::Decorated {
            initializers: initializers.value,
        },
        None if hir[member].init.is_some() => FieldValue::Initializer,
        None => FieldValue::Undefined,
    };
    elements.push(create_field_element(hir, member, value));
    if let Some(initializers) = initializers {
        elements.push(ClassElement::RunInitializers {
            initializers: initializers.extra,
        });
    }
}

fn plan_instance_field(
    hir: &hir::File<'_>,
    lists: &InitializerLists,
    member: MemberId,
    plan: &mut ClassPlan,
) {
    let is_private = matches!(hir.runtime_member_key(member), PropKey::Private(_));
    let is_public_accessor = is_auto_accessor(hir, member) && !is_private;
    if plan.field_semantics == FieldSemantics::Define || is_public_accessor {
        push_defined_field(hir, lists, &mut plan.instance_elements, member);
        return;
    }
    if is_private {
        let value = FieldValue::Undefined;
        plan.this_binding_elements
            .push(create_field_element(hir, member, value));
    }
    if hir[member].init.is_some() {
        plan.instance_elements
            .push(ClassElement::AssignedField { member });
    }
}

fn plan_elements(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    class: ClassId,
    lists: &InitializerLists,
    plan: &mut ClassPlan,
) {
    if has_instance_brand(hir, bound, class) {
        plan.instance_elements.push(ClassElement::Brand);
    }
    if let Some(initializers) = plan.instance_method_initializers {
        plan.instance_elements
            .push(ClassElement::RunInitializers { initializers });
    }
    if plan.field_semantics == FieldSemantics::Define {
        let parameters = plan.parameter_properties.iter().copied();
        plan.instance_elements
            .extend(parameters.map(ClassElement::ParameterPropertyField));
    }
    for member in runtime_members(hir, class) {
        let node = hir[member];
        match node.kind {
            MemberKind::StaticBlock => plan.static_elements.push(ClassElement::StaticBlock(member)),
            MemberKind::Property if is_declaration_only(node) => {}
            MemberKind::Property if node.flags.contains(Flags::STATIC) => {
                push_defined_field(hir, lists, &mut plan.static_elements, member);
            }
            MemberKind::Property => plan_instance_field(hir, lists, member, plan),
            MemberKind::Method
            | MemberKind::Getter
            | MemberKind::Setter
            | MemberKind::Constructor
            | MemberKind::CallSignature
            | MemberKind::ConstructSignature
            | MemberKind::IndexSignature => {}
        }
    }
}

fn plan_initializer_call(hir: &hir::File<'_>, bound: &Bound<'_>, plan: &mut ClassPlan) {
    let transform = plan.transform;
    let has_defined_field = plan.instance_elements.iter().any(|element| match *element {
        ClassElement::ParameterPropertyField(_) => true,
        ClassElement::Field { member, .. } | ClassElement::AccessorStorage { member, .. } => {
            let is_moved_to_constructor_body = match hir.runtime_member_key(member) {
                PropKey::Private(_) => has_decorated_private_name(hir, bound, transform, member),
                PropKey::Name(_) | PropKey::Computed(_) | PropKey::None => {
                    is_auto_accessor(hir, member)
                }
            };
            !is_moved_to_constructor_body
        }
        _ => false,
    });
    let is_at_injection_point = plan.field_semantics == FieldSemantics::Assign
        || (transform == ClassTransform::Standard && !has_defined_field);
    if !is_at_injection_point {
        return;
    }
    plan.initializer_call = InitializerCall::AtInjectionPoint;
    if plan.instance_elements.first() == Some(&ClassElement::Brand) {
        plan.instance_elements.remove(0);
        plan.this_binding_elements.insert(0, ClassElement::Brand);
    }
}

pub(super) fn plan_class(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    settings: &TranspileSettings,
    class: ClassId,
) -> ClassPlan {
    let transform = compute_class_transform(hir, bound, class);
    let assigns_fields = hir.has_typescript_semantics()
        && settings.use_define_for_class_fields == Some(false)
        && transform != ClassTransform::Standard
        && !runtime_members(hir, class).any(|member| {
            has_computed_field_key(hir, member) && !hir[member].flags.contains(Flags::STATIC)
        });
    let field_semantics = if assigns_fields {
        FieldSemantics::Assign
    } else {
        FieldSemantics::Define
    };
    let constructor = runtime_members(hir, class)
        .find(|&member| hir.runtime_member_kind(member) == MemberKind::Constructor);
    let mut plan = ClassPlan {
        transform,
        field_semantics,
        constructor: constructor.map(|member| hir[member].func),
        injection_point: InjectionPoint::Start,
        initializer_call: InitializerCall::AtThisBinding,
        parameter_properties: SmallVec::new(),
        this_binding_elements: Vec::new(),
        instance_elements: Vec::new(),
        static_elements: Vec::new(),
        decorations: Vec::new(),
        instance_method_initializers: None,
        initializer_list_count: 0,
    };
    if let Some(constructor) = plan.constructor {
        plan.injection_point = find_injection_point(hir, class, constructor);
        let is_property = |parameter: &ParamId| {
            let node = hir[*parameter];
            node.flags.contains(Flags::PARAMETER_PROPERTY)
                && matches!(hir[node.pat].kind, PatKind::Ident(_))
        };
        plan.parameter_properties = hir[constructor].params.iter().filter(is_property).collect();
    }
    let no_lists = InitializerLists::default();
    match transform {
        ClassTransform::None => plan_elements(hir, bound, class, &no_lists, &mut plan),
        ClassTransform::Legacy => {
            plan_elements(hir, bound, class, &no_lists, &mut plan);
            decorators::move_decorated_fields(hir, &mut plan);
        }
        ClassTransform::Standard => {
            debug_assert_eq!(field_semantics, FieldSemantics::Define);
            let lists = decorators::plan_decorations(hir, class, &mut plan);
            plan_elements(hir, bound, class, &lists, &mut plan);
        }
    }
    plan_initializer_call(hir, bound, &mut plan);
    plan
}

fn find_member_slot(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    transform: ClassTransform,
    member: MemberId,
) -> Option<ClassSlot> {
    match hir[member].kind {
        MemberKind::Property if has_computed_field_key(hir, member) => {
            Some(ClassSlot::ComputedKey(member))
        }
        MemberKind::Property => {
            let has_decorated_pair = is_auto_accessor(hir, member)
                && has_decorated_private_name(hir, bound, transform, member);
            has_decorated_pair.then_some(ClassSlot::PrivateMethod(member))
        }
        MemberKind::Method | MemberKind::Getter | MemberKind::Setter => {
            match hir.runtime_member_key(member) {
                PropKey::Private(_) => Some(ClassSlot::PrivateMethod(member)),
                PropKey::Name(_) | PropKey::Computed(_) | PropKey::None => None,
            }
        }
        _ => None,
    }
}

pub(crate) fn class_slots(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    settings: &TranspileSettings,
    class: ClassId,
) -> SmallVec<[ClassSlot; 4]> {
    let plan = plan_class(hir, bound, settings, class);
    let mut slots: SmallVec<[ClassSlot; 4]> = smallvec![ClassSlot::ClassObject];
    if has_instance_brand(hir, bound, class) {
        slots.push(ClassSlot::ClassToken);
    }
    for member in runtime_members(hir, class) {
        slots.extend(find_member_slot(hir, bound, plan.transform, member));
        if has_private_static_storage(hir, member) {
            slots.push(ClassSlot::StaticField(member));
        }
    }
    if plan.initializer_list_count > 0 {
        slots.push(ClassSlot::DecoratorState);
    }
    slots
}
