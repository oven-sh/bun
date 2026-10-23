mod accessors;
mod constructor;
mod definition;
mod fields;
mod members;
mod plan;
mod slots;

use std::rc::Rc;

use bun_sema::bind::Bound;
use bun_sema::hir::{self, ClassId, ExprId, FnId, MemberId, ParamId};
use bun_sema::resolve::TranspileSettings;
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

use super::decorators::Decoration;
use super::member::PropertyName;
use super::{FileLowering, FunctionLowering};
use crate::ir::generated::{Function, HomeObjectKind, MethodKind};
use crate::ir::{ClassSlot, DeclaredType, FunctionId, LayoutId, PropertyKeyId, StringId, ValueId};

pub(in crate::lower) use self::accessors::{AccessorFunction, declare_accessor_function};
pub(in crate::lower) use self::fields::{find_private_state_field, private_state_fields};
pub(in crate::lower) use self::plan::{
    decorators_of, has_decorators, has_instance_brand, has_private_static_storage,
    is_auto_accessor, is_declaration_only, is_decorated_private_name, is_derived_class,
    runtime_members,
};
pub(in crate::lower) use self::slots::{
    create_private_state_variable, get_class_slot, get_private_state_slot, set_class_slot,
    set_private_state_slot,
};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(in crate::lower) enum ClassTransform {
    None,
    Standard,
    Legacy,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(in crate::lower) enum FieldSemantics {
    Define,
    Assign,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(in crate::lower) enum InjectionPoint {
    Start,
    AfterSuperCall(ExprId),
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(in crate::lower) enum InitializerCall {
    AtThisBinding,
    AtInjectionPoint,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(in crate::lower) enum FieldValue {
    Undefined,
    Initializer,
    Decorated { initializers: u32 },
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(in crate::lower) enum ClassElement {
    Brand,
    ParameterPropertyField(ParamId),
    Field { member: MemberId, value: FieldValue },
    AssignedField { member: MemberId },
    AccessorStorage { member: MemberId, value: FieldValue },
    RunInitializers { initializers: u32 },
    StaticBlock(MemberId),
}

pub(in crate::lower) struct ClassPlan {
    pub(in crate::lower) transform: ClassTransform,
    pub(in crate::lower) field_semantics: FieldSemantics,
    pub(in crate::lower) constructor: Option<FnId>,
    pub(in crate::lower) injection_point: InjectionPoint,
    pub(in crate::lower) initializer_call: InitializerCall,
    pub(in crate::lower) parameter_properties: SmallVec<[ParamId; 4]>,
    pub(in crate::lower) this_binding_elements: Vec<ClassElement>,
    pub(in crate::lower) instance_elements: Vec<ClassElement>,
    pub(in crate::lower) static_elements: Vec<ClassElement>,
    pub(in crate::lower) decorations: Vec<Decoration>,
    pub(in crate::lower) instance_method_initializers: Option<u32>,
    pub(in crate::lower) initializer_list_count: u32,
}

pub(in crate::lower) struct ClassEvaluation {
    pub(in crate::lower) class: ClassId,
    pub(in crate::lower) layout: LayoutId,
    pub(in crate::lower) class_object: ValueId,
    pub(in crate::lower) heritage: Option<ValueId>,
    pub(in crate::lower) name: StringId,
    pub(in crate::lower) class_decorators: Option<ValueId>,
    pub(in crate::lower) member_decorators: SmallVec<[(MemberId, ValueId); 4]>,
    pub(in crate::lower) member_names: SmallVec<[(MemberId, PropertyName); 4]>,
}

#[derive(Default)]
pub(crate) struct ClassState {
    plans: FxHashMap<ClassId, Rc<ClassPlan>>,
    constant_keys: FxHashMap<MemberId, PropertyKeyId>,
}

pub(crate) fn class_slots(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    settings: &TranspileSettings,
    class: ClassId,
) -> SmallVec<[ClassSlot; 4]> {
    plan::class_slots(hir, bound, settings, class)
}

pub(crate) fn static_field_position(
    file: &mut FileLowering<'_, '_, '_, '_>,
    class: ClassId,
    member: MemberId,
) -> DeclaredType {
    fields::static_field_position(file, class, member)
}

pub(crate) fn finish_constructor_header(
    file: &mut FileLowering<'_, '_, '_, '_>,
    class: ClassId,
    name: Option<StringId>,
    header: &mut Function,
) {
    constructor::finish_constructor_header(file, class, name, header);
}

pub(crate) fn lower_constructor(
    file: &mut FileLowering<'_, '_, '_, '_>,
    function: FunctionId,
    source: FnId,
) {
    constructor::lower_constructor(file, function, source);
}

pub(crate) fn lower_implicit_constructor(
    file: &mut FileLowering<'_, '_, '_, '_>,
    function: FunctionId,
    class: ClassId,
) {
    constructor::lower_implicit_constructor(file, function, class);
}

pub(crate) fn lower_instance_initializer(
    file: &mut FileLowering<'_, '_, '_, '_>,
    function: FunctionId,
    class: ClassId,
) {
    fields::lower_instance_initializer(file, function, class);
}

pub(crate) fn lower_static_initializer(
    file: &mut FileLowering<'_, '_, '_, '_>,
    function: FunctionId,
    class: ClassId,
) {
    fields::lower_static_initializer(file, function, class);
}

pub(crate) fn lower_accessor_function(
    file: &mut FileLowering<'_, '_, '_, '_>,
    function: FunctionId,
    member: MemberId,
    kind: MethodKind,
) {
    accessors::lower_accessor_function(file, function, member, kind);
}

pub(crate) fn lower_private_name_test(
    file: &mut FileLowering<'_, '_, '_, '_>,
    function: FunctionId,
    member: MemberId,
) {
    accessors::lower_private_name_test(file, function, member);
}

pub(crate) fn lower_class_expression(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    class: ClassId,
    name: Option<PropertyName>,
) -> ValueId {
    definition::lower_class_expression(lowering, class, name)
}

pub(crate) fn lower_class_declaration(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    class: ClassId,
) {
    definition::lower_class_declaration(lowering, class);
}

pub(crate) fn lower_super_call(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
) -> ValueId {
    constructor::lower_super_call(lowering, call)
}

pub(crate) fn emit_constructor_result(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    value: ValueId,
) -> ValueId {
    constructor::emit_constructor_result(lowering, value)
}

pub(crate) fn get_class_home(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
) -> (HomeObjectKind, ValueId) {
    slots::get_class_home(lowering)
}

pub(in crate::lower) fn class_plan(
    file: &mut FileLowering<'_, '_, '_, '_>,
    class: ClassId,
) -> Rc<ClassPlan> {
    if let Some(plan) = file.classes.plans.get(&class) {
        return Rc::clone(plan);
    }
    let plan = plan::plan_class(file.hir, file.bound, file.compiled.settings, class);
    let plan = Rc::new(plan);
    file.classes.plans.insert(class, Rc::clone(&plan));
    plan
}

pub(in crate::lower) fn find_member_value<T: Copy>(
    values: &[(MemberId, T)],
    member: MemberId,
) -> Option<T> {
    let found = values.iter().find(|entry| entry.0 == member);
    found.map(|&(_, value)| value)
}
