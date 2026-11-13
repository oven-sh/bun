mod accessors;
mod constructor;
mod definition;
mod fields;
mod members;
mod plan;
mod slots;

use std::cell::RefCell;
use std::rc::Rc;

use bun_sema::bind::{Bound, CodeUnit, ScopeId};
use bun_sema::check::aot::ClassRef;
use bun_sema::fold::Decisions;
use bun_sema::hir::{
    self, ClassId, ExprId, ExprKind, FnId, FnKind, MemberId, ParamId, StmtId, StmtKind,
};
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

use super::FileLowering;
use super::decorators::Decoration;
use super::member::PropertyName;
use crate::ir::{LayoutId, PropertyKeyId, StringId, ValueId};

pub(in crate::lower) use self::accessors::{AccessorFunction, declare_accessor_function};
pub(in crate::lower) use self::constructor::declare_constructor_of_class;
pub(crate) use self::fields::static_field_position;
pub(in crate::lower) use self::fields::{declare_initializer, is_called_by_evaluated_text};
pub(in crate::lower) use self::plan::{
    brand_is_of_methods, class_slots, decorators_of, find_fields_evaluated_in_constructor,
    find_fields_under_signed_members, find_keys_that_hold_decorators,
    find_what_is_printed_for_each_object, has_decorators, has_instance_brand,
    has_private_static_storage, is_auto_accessor, is_declaration_only, is_decorated_private_name,
    is_derived_class, is_printed_as_getter_and_setter, runtime_members,
};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(in crate::lower) enum ClassTransform {
    None,
    Standard,
    Legacy,
}

#[derive(Default)]
pub(in crate::lower) struct PrintedForEachObject {
    pub(in crate::lower) written_constructor: Option<FnId>,
    pub(in crate::lower) makes_constructor: bool,
    pub(in crate::lower) stands_at_statement: bool,
    pub(in crate::lower) fields_given_a_value: SmallVec<[MemberId; 2]>,
}

pub(in crate::lower) struct KeyThatHoldsDecorators {
    pub(in crate::lower) member: Option<MemberId>,
    pub(in crate::lower) private_members: SmallVec<[MemberId; 2]>,
    pub(in crate::lower) lists: usize,
    pub(in crate::lower) stands_behind_text_of_class: bool,
}

impl KeyThatHoldsDecorators {
    pub(in crate::lower) fn shows_place_of_class(&self) -> bool {
        self.lists > 1 || !self.stands_behind_text_of_class
    }
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
    pub(in crate::lower) injected_elements: Vec<ClassElement>,
    pub(in crate::lower) static_elements: Vec<ClassElement>,
    pub(in crate::lower) elements_behind_class: Vec<ClassElement>,
    pub(in crate::lower) decorations: Vec<Decoration>,
    pub(in crate::lower) instance_method_initializers: Option<u32>,
    pub(in crate::lower) initializer_list_count: u32,
}

#[derive(Copy, Clone)]
pub(in crate::lower) struct StoreAtBirth {
    pub(in crate::lower) statement: StmtId,
    pub(in crate::lower) member: MemberId,
    pub(in crate::lower) target: ExprId,
    pub(in crate::lower) value: ExprId,
}

pub(in crate::lower) struct AllocatedFields {
    pub(in crate::lower) stores: SmallVec<[StoreAtBirth; 8]>,
    pub(in crate::lower) evaluated_first: SmallVec<[MemberId; 4]>,
    pub(in crate::lower) holds_itself: bool,
}

pub(in crate::lower) struct FieldsInConstructor {
    pub(in crate::lower) assigned: SmallVec<[MemberId; 4]>,
    pub(in crate::lower) defined: SmallVec<[MemberId; 4]>,
}

#[derive(Copy, Clone)]
pub(in crate::lower) struct ClassText<'t, 's> {
    pub(in crate::lower) hir: &'t hir::File<'s>,
    pub(in crate::lower) bound: &'t Bound<'s>,
    pub(in crate::lower) decisions: &'t Decisions<'s>,
    pub(in crate::lower) places_of_this_super_and_return: &'t [u32],
}

#[derive(Copy, Clone)]
pub(in crate::lower) enum ObjectAtBirth {
    Allocated(ValueId),
    /// Nothing names the object before its fields are defined, so it is allocated there.
    Pending {
        prototype: ValueId,
        scope: ScopeId,
    },
}

pub(in crate::lower) struct Birth {
    pub(in crate::lower) class: ClassId,
    pub(in crate::lower) object: ObjectAtBirth,
    pub(in crate::lower) parameter_properties: SmallVec<[(PropertyName, ValueId); 4]>,
    pub(in crate::lower) stores: SmallVec<[StoreAtBirth; 8]>,
    pub(in crate::lower) values: SmallVec<[ValueId; 8]>,
    pub(in crate::lower) evaluated_first: SmallVec<[(MemberId, ValueId); 4]>,
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
    pub(in crate::lower) unconverted_keys: SmallVec<[(MemberId, ValueId); 4]>,
}

#[derive(Default)]
pub(crate) struct ClassState {
    plans: RefCell<FxHashMap<ClassId, Rc<ClassPlan>>>,
    constant_keys: FxHashMap<MemberId, PropertyKeyId>,
    entries_of_members: FxHashMap<ClassId, FxHashMap<MemberId, u32>>,
    pub(in crate::lower) fields_under_signed_members: Vec<MemberId>,
}

impl ClassText<'_, '_> {
    fn count_this_super_and_return(&self, start: u32, end: u32) -> usize {
        let places = self.places_of_this_super_and_return;
        let count_in_front_of = |end| places.partition_point(|&place| place < end);
        count_in_front_of(end) - count_in_front_of(start)
    }

    fn value_of_field_names_object(&self, member: MemberId) -> bool {
        let node = self.hir[member];
        self.count_this_super_and_return(node.name_pos, node.loc.end) != 0
    }

    fn value_of_field_has_direct_eval(&self, member: MemberId) -> bool {
        let node = self.hir[member];
        let mut evals = self.bound.runtime.eval_scopes().iter();
        evals.any(|entry| (node.name_pos..node.loc.end).contains(&self.hir[entry.0].pos))
    }
}

pub(in crate::lower) fn find_this_super_returns(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
) -> Vec<u32> {
    let names_object = |kind| matches!(kind, ExprKind::This | ExprKind::Super | ExprKind::Jsx(_));
    let expressions = hir.exprs.iter().filter(|it| names_object(it.kind));
    let ends_constructor = |&id: &StmtId| {
        let unit = bound.code_unit(bound.scope_of_stmt(id));
        let is_of_other_function = match unit {
            CodeUnit::Function(it) => hir.runtime_function_kind(it) != FnKind::Constructor,
            CodeUnit::File | CodeUnit::FieldInitializer(_) => false,
        };
        matches!(hir[id].kind, StmtKind::Return(_)) && !is_of_other_function
    };
    let returns = (0..hir.stmts.len() as u32).map(StmtId::from);
    let returns = returns.filter(ends_constructor);
    let mut places: Vec<u32> = expressions.map(|it| it.pos).collect();
    places.extend(returns.map(|id| hir[id].loc.pos));
    let evals = bound.runtime.eval_scopes().iter();
    places.extend(evals.map(|entry| hir[entry.0].pos));
    places.sort_unstable();
    places
}

impl ClassState {
    pub(in crate::lower) fn new(fields_under_signed_members: Vec<MemberId>) -> ClassState {
        ClassState {
            fields_under_signed_members,
            ..ClassState::default()
        }
    }
}

impl<'s> FileLowering<'_, '_, '_, 's> {
    pub(in crate::lower) fn class_text(&self) -> ClassText<'_, 's> {
        let (hir, bound) = (self.hir, self.bound);
        let places = &self.lists.places_of_this_super_and_return;
        ClassText {
            hir,
            bound,
            decisions: self.decisions(),
            places_of_this_super_and_return: places
                .get_or_init(|| find_this_super_returns(hir, bound)),
        }
    }

    pub(in crate::lower) fn class_plan(&self, class: ClassId) -> Rc<ClassPlan> {
        if let Some(plan) = self.classes.plans.borrow().get(&class) {
            return Rc::clone(plan);
        }
        let signed = &self.classes.fields_under_signed_members;
        let plan = plan::plan_class(self.hir, self.bound, self.compiled, signed, class);
        let plan = Rc::new(plan);
        let mut plans = self.classes.plans.borrow_mut();
        plans.insert(class, Rc::clone(&plan));
        plan
    }

    pub(in crate::lower) fn has_standard_class_decorators(&mut self, class: ClassId) -> bool {
        has_decorators(self.hir, self.hir[class].modifiers)
            && self.class_plan(class).transform == ClassTransform::Standard
    }

    pub(in crate::lower) fn is_class_named_by_its_declaration(&mut self, value: ExprId) -> bool {
        let hir = self.hir;
        match hir[self.skip_type_syntax(value)].kind {
            ExprKind::Class(class) => self.has_standard_class_decorators(class),
            _ => false,
        }
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
