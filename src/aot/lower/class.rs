mod accessors;
mod constructor;
mod definition;
mod fields;
mod members;
mod plan;
mod slots;

use std::rc::Rc;

use bun_sema::check::aot::ClassRef;
use bun_sema::hir::{ClassId, ExprId, FnId, MemberId, ParamId};
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

use super::FileLowering;
use super::decorators::Decoration;
use super::member::PropertyName;
use crate::ir::{LayoutId, PropertyKeyId, StringId, ValueId};

pub(in crate::lower) use self::accessors::{AccessorFunction, declare_accessor_function};
pub(crate) use self::fields::static_field_position;
pub(crate) use self::plan::class_slots;
pub(in crate::lower) use self::plan::{
    decorators_of, has_decorators, has_instance_brand, has_private_static_storage,
    is_auto_accessor, is_declaration_only, is_decorated_private_name, is_derived_class,
    runtime_members,
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

impl FileLowering<'_, '_, '_, '_> {
    pub(in crate::lower) fn class_plan(&mut self, class: ClassId) -> Rc<ClassPlan> {
        if let Some(plan) = self.classes.plans.get(&class) {
            return Rc::clone(plan);
        }
        let plan = plan::plan_class(self.hir, self.bound, self.compiled.settings, class);
        let plan = Rc::new(plan);
        self.classes.plans.insert(class, Rc::clone(&plan));
        plan
    }

    pub(in crate::lower) fn own_class(&self, class: ClassId) -> ClassRef {
        let file = self.file;
        ClassRef { file, class }
    }

    pub(in crate::lower) fn own_class_layout(&mut self, class: ClassId) -> LayoutId {
        self.class_layout(self.own_class(class))
    }
}

pub(in crate::lower) fn find_member_value<T: Copy>(
    values: &[(MemberId, T)],
    member: MemberId,
) -> Option<T> {
    let found = values.iter().find(|entry| entry.0 == member);
    found.map(|&(_, value)| value)
}
