use bun_sema::bind::{Bound, ClassOwner, PrivateMembers, PrivateName};
use bun_sema::hir::{
    self, ClassId, ExprId, Flags, FnId, Member, MemberId, MemberKind, ModifierId, PropKey, Span,
};
use bun_sema::program::{CompiledModule, FileId};
use smallvec::{SmallVec, smallvec};

use super::constructor::find_initial_fields;
use super::{
    ClassElement, ClassPlan, ClassText, ClassTransform, FieldSemantics, FieldValue,
    FieldsInConstructor, InitializerCall, InjectionPoint, KeyThatHoldsDecorators,
    PrintedForEachObject,
};
use crate::ir::ClassSlot;
use crate::lower::decorators::{self, InitializerLists};
use crate::modules::KnownObjects;

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

pub(in crate::lower) fn is_declaration_only(hir: &hir::File<'_>, member: MemberId) -> bool {
    let node = hir[member];
    let is_legacy = hir.has_typescript_semantics() && hir.legacy_decorators;
    let is_private = matches!(node.key, PropKey::Private(_));
    node.flags.intersects(Flags::AMBIENT | Flags::ABSTRACT)
        && (is_legacy || is_private || !hir::has_runtime_member(hir, member))
}

pub(in crate::lower) fn is_auto_accessor(hir: &hir::File<'_>, member: MemberId) -> bool {
    let node = hir[member];
    node.kind == MemberKind::Property && node.flags.contains(Flags::ACCESSOR)
}

pub(in crate::lower) fn is_derived_class(hir: &hir::File<'_>, class: ClassId) -> bool {
    hir[class].extends.is_some()
}

pub(in crate::lower) fn has_private_static_storage(hir: &hir::File<'_>, member: MemberId) -> bool {
    let node = hir[member];
    node.kind == MemberKind::Property
        && node.flags.contains(Flags::STATIC)
        && !is_declaration_only(hir, member)
        && (node.flags.contains(Flags::ACCESSOR)
            || matches!(hir.runtime_member_key(member), PropKey::Private(_)))
}

pub(in crate::lower) fn brand_is_of_methods(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    class: ClassId,
) -> bool {
    let has_private_method = bound.runtime.is_computed()
        && bound
            .private_names_of_class(class)
            .any(|(_, name)| !name.is_static && !matches!(name.members, PrivateMembers::Field(_)));
    has_private_method
        || runtime_members(hir, class).any(|member| {
            let node = hir[member];
            is_auto_accessor(hir, member)
                && !node.flags.contains(Flags::STATIC)
                && !is_declaration_only(hir, member)
        })
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
                && !is_declaration_only(hir, member)
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
        && !is_declaration_only(hir, member)
        && matches!(hir.runtime_member_key(member), PropKey::Computed(_))
}

pub(in crate::lower) fn find_fields_under_signed_members(
    members: KnownObjects<'_, '_>,
    file: FileId,
) -> Vec<MemberId> {
    let hir = members.files.hir(file);
    if hir.enums.is_empty() {
        return Vec::new();
    }
    let classes = (0..hir.classes.len() as u32).map(ClassId);
    let fields = classes.flat_map(|class| runtime_members(hir, class));
    fields
        .filter(|&member| match hir.runtime_member_key(member) {
            PropKey::Computed(key) => members.find_signed_member_in_place(file, key).is_some(),
            _ => false,
        })
        .collect()
}

fn has_key_folded_by_bun_run(
    hir: &hir::File<'_>,
    compiled: &CompiledModule<'_>,
    member: MemberId,
) -> bool {
    let PropKey::Computed(key) = hir.runtime_member_key(member) else {
        return false;
    };
    let (decisions, key) = (&compiled.analysis.decisions, hir.skip_type_assertions(key));
    match compiled.settings.bun_run_assigns_class_fields {
        true => decisions.is_string_or_number_under_minify_syntax(hir, key),
        false => decisions.is_string_or_number_in_bun_run(hir, key),
    }
}

fn find_injection_point(hir: &hir::File<'_>, class: ClassId, constructor: FnId) -> InjectionPoint {
    if !is_derived_class(hir, class) {
        return InjectionPoint::Start;
    }
    match hir::find_super_call_statement(hir, constructor) {
        Some((_, call)) => InjectionPoint::AfterSuperCall(call),
        None => InjectionPoint::Start,
    }
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
    declares_parameter_properties: bool,
    plan: &mut ClassPlan,
) {
    if has_instance_brand(hir, bound, class) {
        plan.instance_elements.push(ClassElement::Brand);
    }
    if let Some(initializers) = plan.instance_method_initializers {
        plan.instance_elements
            .push(ClassElement::RunInitializers { initializers });
    }
    if declares_parameter_properties {
        let parameters = plan.parameter_properties.iter().copied();
        plan.instance_elements
            .extend(parameters.map(ClassElement::ParameterPropertyField));
    }
    for member in runtime_members(hir, class) {
        let node = hir[member];
        match node.kind {
            MemberKind::StaticBlock => plan.static_elements.push(ClassElement::StaticBlock(member)),
            MemberKind::Property if is_declaration_only(hir, member) => {}
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
        ClassElement::ParameterPropertyField(_) | ClassElement::AccessorStorage { .. } => true,
        ClassElement::Field { member, .. } => {
            !has_decorated_private_name(hir, bound, transform, member)
        }
        _ => false,
    });
    let is_at_injection_point = plan.field_semantics == FieldSemantics::Assign
        || (transform == ClassTransform::Standard && !has_defined_field);
    if !is_at_injection_point {
        if let Some(&last @ ClassElement::RunInitializers { .. }) = plan.instance_elements.last() {
            plan.instance_elements.pop();
            plan.injected_elements.push(last);
        }
        return;
    }
    plan.initializer_call = InitializerCall::AtInjectionPoint;
    if plan.instance_elements.first() == Some(&ClassElement::Brand) {
        plan.instance_elements.remove(0);
        plan.this_binding_elements.insert(0, ClassElement::Brand);
    }
    let is_assigned =
        |element: &ClassElement| matches!(element, ClassElement::AssignedField { .. });
    if plan.field_semantics == FieldSemantics::Assign
        && !plan.instance_elements.is_empty()
        && plan.instance_elements.iter().all(is_assigned)
    {
        let assigned = std::mem::take(&mut plan.instance_elements);
        plan.injected_elements.splice(0..0, assigned);
        return;
    }
    if plan.instance_elements.is_empty() {
        plan.initializer_call = InitializerCall::AtThisBinding;
        std::mem::swap(&mut plan.instance_elements, &mut plan.this_binding_elements);
    }
}

pub(super) fn plan_class(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    compiled: &CompiledModule<'_>,
    fields_under_signed_members: &[MemberId],
    class: ClassId,
) -> ClassPlan {
    let transform = compute_class_transform(hir, bound, class);
    let is_asked_to_assign = hir.has_typescript_semantics()
        && compiled.settings.use_define_for_class_fields == Some(false)
        && transform != ClassTransform::Standard;
    let keeps_fields = runtime_members(hir, class).any(|member| {
        has_computed_field_key(hir, member)
            && !hir[member].flags.contains(Flags::STATIC)
            && !has_key_folded_by_bun_run(hir, compiled, member)
            && !fields_under_signed_members.contains(&member)
    });
    let field_semantics = if is_asked_to_assign && !keeps_fields {
        FieldSemantics::Assign
    } else {
        FieldSemantics::Define
    };
    let constructor = hir::find_runtime_constructor(hir, class);
    let mut plan = ClassPlan {
        transform,
        field_semantics,
        constructor: constructor.map(|member| hir[member].func),
        injection_point: InjectionPoint::Start,
        initializer_call: InitializerCall::AtThisBinding,
        parameter_properties: SmallVec::new(),
        this_binding_elements: Vec::new(),
        instance_elements: Vec::new(),
        injected_elements: Vec::new(),
        static_elements: Vec::new(),
        elements_behind_class: Vec::new(),
        decorations: Vec::new(),
        instance_method_initializers: None,
        initializer_list_count: 0,
    };
    if let Some(constructor) = plan.constructor {
        plan.injection_point = find_injection_point(hir, class, constructor);
        plan.parameter_properties = hir::parameter_properties(hir, constructor).collect();
    }
    let no_lists = InitializerLists::default();
    let declares = !is_asked_to_assign;
    match transform {
        ClassTransform::None => plan_elements(hir, bound, class, &no_lists, declares, &mut plan),
        ClassTransform::Legacy => {
            plan_elements(hir, bound, class, &no_lists, declares, &mut plan);
            decorators::move_decorated_fields(hir, &mut plan);
        }
        ClassTransform::Standard => {
            debug_assert_eq!(field_semantics, FieldSemantics::Define);
            let lists = decorators::plan_decorations(hir, class, &mut plan);
            plan_elements(hir, bound, class, &lists, declares, &mut plan);
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

pub(in crate::lower) fn find_fields_evaluated_in_constructor<'t, 's>(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    compiled: &CompiledModule<'_>,
    fields_under_signed_members: &[MemberId],
    class: ClassId,
    get_text: &dyn Fn() -> ClassText<'t, 's>,
) -> FieldsInConstructor {
    let plan = plan_class(hir, bound, compiled, fields_under_signed_members, class);
    let assigned = plan.injected_elements.iter();
    let assigned = assigned.filter_map(|element| match *element {
        ClassElement::AssignedField { member } => Some(member),
        _ => None,
    });
    let with_value = plan.instance_elements.iter();
    let with_value = with_value.filter_map(|element| match *element {
        ClassElement::Field {
            member,
            value: FieldValue::Initializer,
        } => Some(member),
        _ => None,
    });
    let mut defined: SmallVec<[MemberId; 4]> = with_value.collect();
    let is_at_birth = |constructor| {
        !is_derived_class(hir, class)
            && find_initial_fields(get_text(), &plan, constructor).is_some()
    };
    if !defined.is_empty() && !plan.constructor.is_some_and(is_at_birth) {
        defined.clear();
    }
    FieldsInConstructor {
        assigned: assigned.collect(),
        defined,
    }
}

pub(in crate::lower) fn is_printed_as_getter_and_setter(
    hir: &hir::File<'_>,
    member: MemberId,
) -> bool {
    is_auto_accessor(hir, member) && !matches!(hir.runtime_member_key(member), PropKey::Private(_))
}

fn find_what_standard_decorators_print(
    hir: &hir::File<'_>,
    class: ClassId,
) -> PrintedForEachObject {
    let of_objects =
        || runtime_members(hir, class).filter(|&member| !hir[member].flags.contains(Flags::STATIC));
    let is_decorated = |member: MemberId| has_decorators(hir, hir[member].modifiers);
    let is_kept_outside_the_object = |member: MemberId| {
        let is_private = matches!(hir.runtime_member_key(member), PropKey::Private(_));
        is_printed_as_getter_and_setter(hir, member) || (is_private && is_decorated(member))
    };
    let runs_before_first_field = of_objects().any(|member| {
        let is_field = hir[member].kind == MemberKind::Property && !is_auto_accessor(hir, member);
        is_decorated(member) && !is_field
    });
    let mut printed = PrintedForEachObject {
        stands_at_statement: runs_before_first_field,
        ..PrintedForEachObject::default()
    };
    let (mut waits_for_field, mut has_field) = (false, false);
    for member in of_objects().filter(|&member| hir[member].kind == MemberKind::Property) {
        if is_kept_outside_the_object(member) {
            waits_for_field = true;
            printed.stands_at_statement = true;
            continue;
        }
        let takes_what_waits = waits_for_field || (runs_before_first_field && !has_field);
        if takes_what_waits && !is_decorated(member) && hir[member].init.is_none() {
            printed.fields_given_a_value.push(member);
        }
        has_field = true;
        waits_for_field = is_decorated(member);
        printed.stands_at_statement |= waits_for_field;
    }
    printed.makes_constructor = waits_for_field || (runs_before_first_field && !has_field);
    printed
}

pub(in crate::lower) fn find_keys_that_hold_decorators(
    hir: &hir::File<'_>,
    class: ClassId,
    fields_given_a_value: &[MemberId],
) -> SmallVec<[KeyThatHoldsDecorators; 2]> {
    let is_decorated = |member: MemberId| has_decorators(hir, hir[member].modifiers);
    let key_of = |member: MemberId| hir.runtime_member_key(member);
    let is_private = |member: MemberId| matches!(key_of(member), PropKey::Private(_));
    let is_kept_outside_the_class = |member: MemberId| {
        let has_same_name = |&other: &MemberId| key_of(other) == key_of(member);
        let mut of_same_name = runtime_members(hir, class).filter(has_same_name);
        is_private(member) && of_same_name.any(is_decorated)
    };
    let mut keys = SmallVec::<[KeyThatHoldsDecorators; 2]>::new();
    let mut waiting = SmallVec::<[MemberId; 2]>::new();
    let mut stands_behind_text_of_class = true;
    for member in runtime_members(hir, class) {
        let node = hir[member];
        let kind = hir.runtime_member_kind(member);
        let is_static = node.flags.contains(Flags::STATIC);
        if is_private(member) && is_decorated(member) {
            waiting.push(member);
        }
        if !is_private(member) && !matches!(kind, MemberKind::Constructor | MemberKind::StaticBlock)
        {
            keys.push(KeyThatHoldsDecorators {
                member: Some(member),
                lists: waiting.len() + usize::from(is_decorated(member)),
                private_members: core::mem::take(&mut waiting),
                stands_behind_text_of_class,
            });
        }
        let is_storage =
            is_kept_outside_the_class(member) || is_printed_as_getter_and_setter(hir, member);
        stands_behind_text_of_class = match kind {
            MemberKind::Property if is_storage && is_static => {
                is_decorated(member) || node.init.is_none()
            }
            MemberKind::Property if is_storage => {
                !is_private(member) || stands_behind_text_of_class
            }
            MemberKind::Property if node.init.is_none() => {
                is_decorated(member) || fields_given_a_value.contains(&member)
            }
            MemberKind::Property => is_static && is_decorated(member),
            _ => is_kept_outside_the_class(member) && stands_behind_text_of_class,
        };
    }
    match keys.last_mut() {
        Some(last) => {
            last.lists += waiting.len();
            last.private_members.extend(waiting);
        }
        None => keys.push(KeyThatHoldsDecorators {
            member: None,
            lists: waiting.len(),
            private_members: waiting,
            stands_behind_text_of_class,
        }),
    }
    keys.retain(|key| key.lists > 0);
    keys
}

pub(in crate::lower) fn find_what_is_printed_for_each_object(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    compiled: &CompiledModule<'_>,
    fields_under_signed_members: &[MemberId],
    class: ClassId,
) -> PrintedForEachObject {
    let plan = plan_class(hir, bound, compiled, fields_under_signed_members, class);
    let is_assigned =
        |element: &ClassElement| matches!(element, ClassElement::AssignedField { .. });
    let moves_fields = plan.injected_elements.iter().any(is_assigned);
    let is_instance_field = |member: MemberId| {
        let node = hir[member];
        node.kind == MemberKind::Property && !node.flags.intersects(Flags::STATIC | Flags::ACCESSOR)
    };
    let printed = match plan.transform {
        ClassTransform::Standard => find_what_standard_decorators_print(hir, class),
        _ if plan.field_semantics == FieldSemantics::Assign => PrintedForEachObject {
            makes_constructor: runtime_members(hir, class).any(is_instance_field),
            ..PrintedForEachObject::default()
        },
        ClassTransform::Legacy => PrintedForEachObject {
            makes_constructor: moves_fields,
            stands_at_statement: moves_fields && plan.constructor.is_none(),
            ..PrintedForEachObject::default()
        },
        ClassTransform::None => PrintedForEachObject::default(),
    };
    PrintedForEachObject {
        written_constructor: plan.constructor,
        makes_constructor: printed.makes_constructor && plan.constructor.is_none(),
        ..printed
    }
}

pub(in crate::lower) fn class_slots(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    compiled: &CompiledModule<'_>,
    fields_under_signed_members: &[MemberId],
    class: ClassId,
) -> SmallVec<[ClassSlot; 4]> {
    let plan = plan_class(hir, bound, compiled, fields_under_signed_members, class);
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
