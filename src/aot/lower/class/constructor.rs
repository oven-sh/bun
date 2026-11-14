use bun_sema::atom::Atom;
use bun_sema::bind::{
    Binding, Bound, ClassOwner, CodeUnit, Decl, FnOwner, PrivateNameId, ScopeId, SymbolId,
    has_simple_parameter_list,
};
use bun_sema::hir::{
    self, Chain, ClassId, ExprFlags, ExprId, ExprKind, FnBody, FnId, MemberId, ParamId, PatKind,
    PropKey, PropKind, StmtId, StmtKind, UnOp,
};
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;

use super::{
    AllocatedFields, Birth, ClassElement, ClassPlan, ClassText, ClassTransform, FieldSemantics,
    FieldValue, InitializerCall, InjectionPoint, ObjectAtBirth, StoreAtBirth, fields,
    is_derived_class,
};
use crate::ir::generated::{
    Function, FunctionFlags, FunctionKind, HomeObjectKind, RuntimeErrorKind,
};
use crate::ir::{DeclaredType, Edge, FunctionId, FunctionKey, StringId, TypeTable, ValueId};
use crate::lower::call::Arguments;
use crate::lower::layouts::class_position;
use crate::lower::member::PropertyName;
use crate::lower::parameters::parameter_symbols;
use crate::lower::positions::has_int32_promise;
use crate::lower::scope::{BindingRef, ScopeSlot, Storage};
use crate::lower::{FileLowering, FunctionLowering, convert, dispose, function};

impl FileLowering<'_, '_, '_, '_> {
    pub(crate) fn finish_constructor_header(
        &mut self,
        class: ClassId,
        name: Option<StringId>,
        header: &mut Function,
    ) {
        let hir = self.hir;
        let node = hir[class];
        if node.name.is_some() {
            header.name = Some(self.intern_class_name(class));
            header.flags |= FunctionFlags::HAS_EXPLICIT_NAME;
        } else {
            header.name = name;
            header.flags = header.flags.without(FunctionFlags::HAS_EXPLICIT_NAME);
        }
        let end = match self.bound.class_owner[class.idx()] {
            ClassOwner::Expr(expression) => hir[expression].end,
            ClassOwner::Stmt(statement) => hir[statement].loc.end,
        };
        header.source_range = self.written_range(node.text_start, end);
        header.kind = match is_derived_class(hir, class) {
            true => FunctionKind::DerivedConstructor,
            false => FunctionKind::BaseConstructor,
        };
        header.flags =
            header.flags.without(FunctionFlags::HAS_THIS) | FunctionFlags::HAS_NEW_TARGET;
        header.this_type = DeclaredType::untyped();
        header.results = vec![DeclaredType::from_compiler(TypeTable::OBJECT)];
    }

    pub(crate) fn lower_constructor(&mut self, function: FunctionId, source: FnId) {
        let class = get_constructor_class(self.bound, source);
        let plan = self.class_plan(class);
        let is_derived = is_derived_class(self.hir, class);
        let mut lowering = FunctionLowering::begin(self, function);
        lowering.count_function(source);
        if is_derived {
            lowering.lower_parameters(source);
            if plan.injection_point == InjectionPoint::Start && has_injected_steps(&plan) {
                lowering.emit_throw_runtime_error(RuntimeErrorKind::UninitializedThis, None);
            }
        } else {
            let fields = find_initial_fields(lowering.file.class_text(), &plan, source);
            if let Some(fields) = fields {
                let object = lowering.prepare_birth(class, source, fields.holds_itself);
                lowering.set_position(lowering.file.hir[source].anchor);
                let first = lowering.list_values_evaluated_first(&plan, &fields.evaluated_first);
                let first = lowering.lower_values_evaluated_first(class, &first);
                lowering.lower_parameters(source);
                lowering.begin_birth(class, &plan, fields.stores, first, object);
            } else {
                let this = lowering.emit_allocation(class);
                lowering.set_position(lowering.file.hir[source].anchor);
                lowering.emit_this_binding_steps(class, &plan, this);
                lowering.lower_parameters(source);
                lowering.emit_injected_steps(class, &plan, this);
            }
        }
        lowering.lower_function_body(source);
        let scope = lowering.file.bound.fns[source.idx()].scope;
        lowering.leave_scope(scope);
        lowering.finish();
    }

    pub(crate) fn lower_implicit_constructor(&mut self, function: FunctionId, class: ClassId) {
        let plan = self.class_plan(class);
        let is_derived = is_derived_class(self.hir, class);
        let mut lowering = FunctionLowering::begin(self, function);
        lowering.count_made_constructor(class);
        let this = match is_derived {
            true => lowering.emit_implicit_super_call(class),
            false => lowering.emit_allocation(class),
        };
        lowering.emit_this_binding_steps(class, &plan, this);
        lowering.emit_injected_steps(class, &plan, this);
        lowering.builder.return_value(Some(this));
        lowering.finish();
    }
}

pub(in crate::lower) fn declare_constructor_of_class(
    file: &mut FileLowering<'_, '_, '_, '_>,
    class: ClassId,
    name: Option<StringId>,
    is_under_computed_key: bool,
) -> FunctionId {
    let plan = file.class_plan(class);
    declare_constructor(file, class, &plan, name, is_under_computed_key)
}

pub(super) fn declare_constructor(
    file: &mut FileLowering<'_, '_, '_, '_>,
    class: ClassId,
    plan: &ClassPlan,
    name: Option<StringId>,
    is_under_computed_key: bool,
) -> FunctionId {
    let name_flags = match (name, is_under_computed_key) {
        (Some(_), true) => FunctionFlags::IS_NAMED_BY_COMPUTED_KEY,
        _ => FunctionFlags::default(),
    };
    if let Some(function) = plan.constructor {
        return function::declare_source_function_with(file, function, &mut |_, header| {
            header.name = header.name.or(name);
            header.flags |= name_flags;
        });
    }
    let key = FunctionKey::ImplicitConstructor(file.own_class(class));
    file.declare_function(key, |file| {
        let position = class_position(&file.hir[class]);
        let mut header =
            function::create_header(file, key, FunctionKind::BaseConstructor, position);
        if is_derived_class(file.hir, class) {
            header.flags |= FunctionFlags::HAS_REST_PARAMETER | FunctionFlags::TAKES_CALLEE;
            header.flags = header.flags.without(FunctionFlags::HAS_HIDDEN_REST);
            let arguments = DeclaredType::from_compiler(TypeTable::ARRAY);
            header.parameters.push(arguments);
        }
        file.finish_constructor_header(class, name, &mut header);
        header.flags |= name_flags;
        header
    })
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(crate) fn lower_super_call(&mut self, call: ExprId) -> ValueId {
        let hir = self.file.hir;
        let ExprKind::Call(site) = hir[call].kind else {
            unreachable!("a super call is a call expression");
        };
        let position = self.file.call_position(hir[site]);
        let Some(constructor) = self.find_derived_constructor() else {
            self.lower_arguments(hir[site].args);
            self.set_position(position);
            self.emit_throw_runtime_error(RuntimeErrorKind::UninitializedThis, None);
            return self.builder.undefined();
        };
        let class = get_constructor_class(self.file.bound, constructor);
        let plan = self.file.class_plan(class);
        let layout = self.file.own_class_layout(class);
        let constructor_scope = self.file.bound.fns[constructor.idx()].scope;

        let new_target = self.get_new_target();
        let callee = self.get_slot(constructor_scope, ScopeSlot::Callee);
        let parent = self.builder.get_super_base(HomeObjectKind::Object, callee);
        let this = match self.lower_arguments(hir[site].args) {
            Arguments::Values(mut values) => {
                self.convert_arguments(call, &mut values);
                self.set_position(position);
                self.quote_if_next_fails(call);
                self.builder
                    .super_construct(layout, parent, new_target, &values)
            }
            Arguments::List(list) => {
                self.convert_argument_list(call, list);
                self.set_position(position);
                self.quote_if_next_fails(call);
                self.builder
                    .super_construct_list(layout, parent, new_target, list)
            }
        };
        let this = self.bind_constructed_object(class, this);
        if plan.injection_point == InjectionPoint::AfterSuperCall(call)
            && let Some(stores) = find_stores_after_super(self.file, class, &plan, call)
        {
            self.emit_fields_after_super(class, &plan, stores, this);
            return this;
        }
        self.emit_this_binding_steps(class, &plan, this);
        if plan.injection_point == InjectionPoint::AfterSuperCall(call) {
            self.emit_injected_steps(class, &plan, this);
        }
        this
    }

    pub(in crate::lower) fn get_super_call_parts(
        &mut self,
        class: ClassId,
        constructor_scope: ScopeId,
    ) -> Option<(ValueId, Option<ValueId>)> {
        let plan = self.file.class_plan(class);
        if !plan.this_binding_elements.is_empty() {
            return None;
        }
        let callee = self.get_slot(constructor_scope, ScopeSlot::Callee);
        let is_initialized_at_binding = plan.initializer_call == InitializerCall::AtThisBinding
            && !plan.instance_elements.is_empty();
        let initializer = is_initialized_at_binding.then(|| {
            let initializer = fields::declare_initializer(self.file, class, false);
            self.emit_closure(initializer, None)
        });
        Some((callee, initializer))
    }

    pub(crate) fn emit_constructor_result(&mut self, value: ValueId) -> ValueId {
        let is_derived = match self.builder.function().kind {
            FunctionKind::BaseConstructor => false,
            FunctionKind::DerivedConstructor => true,
            _ => {
                debug_assert!(false, "only a constructor tests its result");
                return value;
            }
        };
        if self.builder.is_undefined(value) {
            return self.get_this();
        }
        let join = self.create_block();
        let result = self.builder.add_parameter(join, None);

        let split = self.split_on_type(value, TypeTable::OBJECT);
        self.builder.switch_to(split.taken);
        self.jump_with(join, &[split.taken_value]);

        self.builder.switch_to(split.not_taken);
        if is_derived {
            self.emit_undefined_result_test(split.not_taken_value);
        }
        let this = self.get_this();
        self.jump_with(join, &[this]);

        self.continue_in(join);
        result
    }

    fn emit_undefined_result_test(&mut self, value: ValueId) {
        let split = self.split_on_type(value, TypeTable::UNDEFINED);
        let invalid_result = split.not_taken;
        self.builder.switch_to(invalid_result);
        let header = self.builder.function();
        let class_name = match header.flags.contains(FunctionFlags::HAS_EXPLICIT_NAME) {
            true => header.name,
            false => None,
        };
        self.emit_throw_runtime_error(RuntimeErrorKind::DerivedConstructorResult, class_name);
        self.builder.switch_to(split.taken);
    }

    fn find_derived_constructor(&self) -> Option<FnId> {
        let innermost = self.innermost_scope();
        let owner = self.file.scopes.lexical_owner(innermost);
        match self.file.bound.code_unit(owner) {
            CodeUnit::Function(function) => self
                .file
                .is_derived_constructor(function)
                .then_some(function),
            CodeUnit::FieldInitializer(_) | CodeUnit::File => None,
        }
    }

    fn emit_allocation(&mut self, class: ClassId) -> ValueId {
        let prototype = self.emit_construct_prototype(class);
        let this = self.emit_object_of_class(class, prototype);
        self.bind_this(this);
        this
    }

    fn emit_construct_prototype(&mut self, class: ClassId) -> ValueId {
        let layout = self.file.own_class_layout(class);
        let new_target = self.builder.new_target();
        let new_target = new_target.expect("a constructor takes new.target");
        self.builder.get_construct_prototype(new_target, layout)
    }

    fn emit_object_of_class(&mut self, class: ClassId, prototype: ValueId) -> ValueId {
        let layout = self.file.own_class_layout(class);
        let this = self.builder.new_object(layout, &[], Some(prototype), &[]);
        self.file.fragment.note_allocation(layout);
        self.convert_constructed_object(class, this)
    }

    fn convert_constructed_object(&mut self, class: ClassId, constructed: ValueId) -> ValueId {
        let class = self.file.own_class(class);
        let position = self.file.class_this_type(class, None);
        convert::convert(self, constructed, position, None)
    }

    fn bind_constructed_object(&mut self, class: ClassId, constructed: ValueId) -> ValueId {
        let this = self.convert_constructed_object(class, constructed);
        self.bind_this(this);
        this
    }

    fn prepare_birth(
        &mut self,
        class: ClassId,
        constructor: FnId,
        holds_itself: bool,
    ) -> ObjectAtBirth {
        let scope = self.file.bound.fns[constructor.idx()].scope;
        let placement = self
            .file
            .scopes
            .placement(BindingRef::Slot(scope, ScopeSlot::This));
        if holds_itself || placement.is_some_and(|it| it.storage != Storage::Local) {
            return ObjectAtBirth::Allocated(self.emit_allocation(class));
        }
        let prototype = self.emit_construct_prototype(class);
        ObjectAtBirth::Pending { prototype, scope }
    }

    fn emit_implicit_super_call(&mut self, class: ClassId) -> ValueId {
        let layout = self.file.own_class_layout(class);
        let new_target = self.builder.new_target();
        let new_target = new_target.expect("a constructor takes new.target");
        let callee = self.builder.callee();
        let callee = callee.expect("an implicit derived constructor takes its callee");
        let parent = self.builder.get_super_base(HomeObjectKind::Object, callee);
        let list = self.builder.parameter(0);
        let this = self
            .builder
            .super_construct_list(layout, parent, new_target, list);
        self.bind_constructed_object(class, this)
    }

    fn begin_birth(
        &mut self,
        class: ClassId,
        plan: &ClassPlan,
        stores: SmallVec<[StoreAtBirth; 8]>,
        evaluated_first: SmallVec<[(MemberId, ValueId); 4]>,
        object: ObjectAtBirth,
    ) {
        let parameters = plan.parameter_properties.iter();
        let parameter_properties = parameters.map(|&it| self.get_parameter_property(it));
        let birth = Birth {
            class,
            object,
            parameter_properties: parameter_properties.collect(),
            stores,
            values: SmallVec::new(),
            evaluated_first,
        };
        match birth.stores.is_empty() {
            true => self.emit_fields_born_with_stores(&birth),
            false => self.birth = Some(birth),
        }
    }

    /// A counted build lowers every initializer, also where the constructor stores over its value.
    fn list_values_evaluated_first(
        &self,
        plan: &ClassPlan,
        evaluated_first: &[MemberId],
    ) -> SmallVec<[MemberId; 4]> {
        if !self.file.counts_executions() {
            return SmallVec::from_slice(evaluated_first);
        }
        let elements = plan.instance_elements.iter();
        let initialized = elements.filter_map(|element| match *element {
            ClassElement::Field {
                member,
                value: FieldValue::Initializer,
            } => Some(member),
            _ => None,
        });
        initialized.collect()
    }

    fn lower_values_evaluated_first(
        &mut self,
        class: ClassId,
        members: &[MemberId],
    ) -> SmallVec<[(MemberId, ValueId); 4]> {
        let constructor_position = self.position();
        self.builder.hold_position(true);
        let values = members.iter().map(|&member| {
            let value = self.lower_value_of_defined_field(class, member);
            (member, value)
        });
        let values = values.collect();
        self.builder.hold_position(false);
        self.set_position(constructor_position);
        values
    }

    pub(in crate::lower) fn lower_store_at_birth(&mut self, statement: StmtId) -> bool {
        if self.statements_lowered_at_super_call.contains(&statement) {
            return true;
        }
        let birth = self.birth.as_ref();
        let next = birth.map(|birth| (birth.class, birth.object, birth.stores[birth.values.len()]));
        let Some((class, object, store)) = next.filter(|next| next.2.statement == statement) else {
            return false;
        };
        self.count_statement(statement);
        let value = self.lower_value_of_store(class, &store, object);
        let is_last = self.birth.as_mut().is_some_and(|birth| {
            birth.values.push(value);
            birth.values.len() == birth.stores.len()
        });
        if is_last && let Some(birth) = self.birth.take() {
            self.emit_fields_born_with_stores(&birth);
        }
        true
    }

    fn lower_value_of_store(
        &mut self,
        class: ClassId,
        store: &StoreAtBirth,
        object: ObjectAtBirth,
    ) -> ValueId {
        let hir = self.file.hir;
        let value = match (hir[hir.skip_type_assertions(store.value)].kind, object) {
            (ExprKind::This, ObjectAtBirth::Allocated(this)) => this,
            _ => self.lower_expression(store.value),
        };
        match hir.runtime_member_key(store.member) {
            PropKey::Private(_) => {
                let position = fields::member_field_position(self.file, class, store.member);
                convert::convert(self, value, position, Some(store.value))
            }
            _ => self.convert_to_member(store.target, value, Some(store.value)),
        }
    }

    // A constructor above may have shown the object to other code, locked it, or return a proxy, whose traps see every definition and store.
    fn emit_fields_after_super(
        &mut self,
        class: ClassId,
        plan: &ClassPlan,
        stores: SmallVec<[StoreAtBirth; 8]>,
        this: ValueId,
    ) {
        let caller_position = self.position();
        let layout = self.file.own_class_layout(class);
        let instance = self.file.fragment.types.intern_layout(layout);
        let test = self.builder.is_unlocked_instance(this, instance);
        let unlocked = self.create_block();
        let other = self.create_block();
        let join = self.create_block();
        self.builder
            .branch(test, Edge::to(unlocked), Edge::to(other));
        self.builder.seal(unlocked);
        self.builder.seal(other);

        self.builder.switch_to(unlocked);
        let first = self.list_values_evaluated_first(plan, &[]);
        let evaluated_first = self.lower_values_evaluated_first(class, &first);
        let parameters = plan.parameter_properties.iter();
        let parameter_properties = parameters.map(|&it| self.get_parameter_property(it));
        let parameter_properties = parameter_properties.collect();
        let mut values = SmallVec::new();
        for store in &stores {
            self.count_statement(store.statement);
            values.push(self.lower_value_of_store(class, store, ObjectAtBirth::Allocated(this)));
        }
        self.set_position(caller_position);
        let birth = Birth {
            class,
            object: ObjectAtBirth::Allocated(this),
            parameter_properties,
            stores,
            values,
            evaluated_first,
        };
        self.emit_fields_born_with_stores(&birth);
        self.jump(join);

        self.builder.switch_to(other);
        for &element in &plan.instance_elements {
            self.emit_class_element(class, element, this);
        }
        for &parameter in &plan.parameter_properties {
            self.emit_parameter_property(parameter, this);
        }
        for store in &birth.stores {
            self.lower_statement(store.statement);
        }
        self.jump(join);

        self.continue_in(join);
        self.set_position(caller_position);
        let lowered = birth.stores.iter().map(|store| store.statement);
        self.statements_lowered_at_super_call = lowered.collect();
    }

    fn emit_fields_born_with_stores(&mut self, birth: &Birth) {
        let class = birth.class;
        let plan = self.file.class_plan(class);
        let caller_position = self.position();
        let mut parameter_properties = birth.parameter_properties.iter();
        let mut values: FxHashMap<MemberId, ValueId> =
            birth.evaluated_first.iter().copied().collect();
        let stored = birth.stores.iter().map(|store| store.member);
        values.extend(stored.zip(birth.values.iter().copied()));
        let this = match birth.object {
            ObjectAtBirth::Allocated(this) => this,
            ObjectAtBirth::Pending { prototype, scope } => {
                self.lower_literal_fields(class, &plan, &mut values);
                let this = self.emit_object_of_class(class, prototype);
                self.set_slot(scope, ScopeSlot::This, this);
                this
            }
        };
        for &element in &plan.instance_elements {
            let member = match element {
                ClassElement::Field { member, .. } => Some(member),
                ClassElement::ParameterPropertyField(_) => {
                    if let Some(&(name, value)) = parameter_properties.next() {
                        self.emit_define(this, name, value);
                    }
                    continue;
                }
                _ => None,
            };
            let value = member.and_then(|member| values.get(&member).copied());
            match (member, value) {
                (Some(member), Some(value)) => {
                    self.emit_field_born_with(class, member, value, this);
                }
                _ => self.emit_class_element(class, element, this),
            }
        }
        self.set_position(caller_position);
    }

    fn lower_literal_fields(
        &mut self,
        class: ClassId,
        plan: &ClassPlan,
        values: &mut FxHashMap<MemberId, ValueId>,
    ) {
        for &element in &plan.instance_elements {
            let ClassElement::Field {
                member,
                value: FieldValue::Initializer,
            } = element
            else {
                continue;
            };
            let hir = self.file.hir;
            if !values.contains_key(&member) && names_nothing(hir, hir[member].init) {
                let value = self.lower_value_of_defined_field(class, member);
                values.insert(member, value);
            }
        }
    }

    fn get_parameter_property(&mut self, parameter: ParamId) -> (PropertyName, ValueId) {
        let hir = self.file.hir;
        let pattern = hir[parameter].pat;
        let PatKind::Ident(name) = hir[pattern].kind else {
            unreachable!("a parameter property binds an identifier");
        };
        self.set_position(hir[parameter].pos);
        let symbol = self.file.bound.declared_symbol(Decl::Param(pattern));
        let value = self.get_binding(Binding::Symbol(symbol), name);
        (PropertyName::Constant(self.file.name_key(name)), value)
    }

    fn emit_this_binding_steps(&mut self, class: ClassId, plan: &ClassPlan, this: ValueId) {
        for &element in &plan.this_binding_elements {
            self.emit_class_element(class, element, this);
        }
        if plan.initializer_call == InitializerCall::AtThisBinding {
            self.emit_instance_initializer_call(class, plan, this);
        }
    }

    fn emit_injected_steps(&mut self, class: ClassId, plan: &ClassPlan, this: ValueId) {
        let (first, last): (&[ClassElement], &[ClassElement]) = match plan.field_semantics {
            FieldSemantics::Define => (&plan.injected_elements, &[]),
            FieldSemantics::Assign => (&[], &plan.injected_elements),
        };
        for &element in first {
            self.emit_class_element(class, element, this);
        }
        let caller_position = self.position();
        for &parameter in &plan.parameter_properties {
            self.emit_parameter_property(parameter, this);
        }
        self.set_position(caller_position);
        if plan.initializer_call == InitializerCall::AtInjectionPoint {
            self.emit_instance_initializer_call(class, plan, this);
        }
        for &element in last {
            self.emit_class_element(class, element, this);
        }
    }

    fn emit_parameter_property(&mut self, parameter: ParamId, this: ValueId) {
        let hir = self.file.hir;
        let pattern = hir[parameter].pat;
        match hir[pattern].kind {
            PatKind::Ident(name) => {
                self.set_position(hir[parameter].pos);
                let symbol = self.file.bound.declared_symbol(Decl::Param(pattern));
                let value = self.get_binding(Binding::Symbol(symbol), name);
                let key = self.file.name_key(name);
                self.emit_set(this, PropertyName::Constant(key), value);
            }
            PatKind::Missing | PatKind::Object(_) | PatKind::Array(_) => {
                debug_assert!(false, "a parameter property binds an identifier");
            }
        }
    }

    fn emit_instance_initializer_call(&mut self, class: ClassId, plan: &ClassPlan, this: ValueId) {
        if plan.instance_elements.is_empty() {
            return;
        }
        let initializer = fields::declare_initializer(self.file, class, false);
        self.emit_call_on(initializer, this);
    }
}

fn names_nothing(hir: &hir::File<'_>, expression: ExprId) -> bool {
    let mut left: SmallVec<[ExprId; 16]> = SmallVec::new();
    left.push(expression);
    while let Some(next) = left.pop() {
        match hir[hir.skip_type_assertions(next)].kind {
            ExprKind::Missing
            | ExprKind::Null
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Number(_)
            | ExprKind::String(_)
            | ExprKind::BigInt(_)
            | ExprKind::Regex { .. } => {}
            ExprKind::Unary {
                op: UnOp::Minus,
                operand,
            } if matches!(hir[operand].kind, ExprKind::Number(_)) => {}
            ExprKind::Template { exprs } if exprs.is_empty() => {}
            ExprKind::Array(elements) => left.extend(hir.ids(elements)),
            ExprKind::Object(properties) => {
                for property in properties.iter() {
                    let property = &hir[property];
                    let is_plain = property.kind == PropKind::Init;
                    if !is_plain || !matches!(property.key, PropKey::Name(_)) {
                        return false;
                    }
                    left.push(property.value);
                }
            }
            _ => return false,
        }
    }
    true
}

#[derive(Default)]
struct UnfilledFields {
    named: FxHashMap<Atom, MemberId>,
    private: FxHashMap<PrivateNameId, MemberId>,
    evaluated_first: SmallVec<[MemberId; 4]>,
}

impl UnfilledFields {
    fn take(&mut self, hir: &hir::File<'_>, bound: &Bound<'_>, target: ExprId) -> Option<MemberId> {
        let ExprKind::Dot {
            obj,
            name,
            chain: Chain::No,
            ..
        } = hir[target].kind
        else {
            return None;
        };
        if !matches!(hir[obj].kind, ExprKind::This) {
            return None;
        }
        match bound.private_name_of_reference(target) {
            Some(private) => self.private.remove(&private),
            None if hir.expr_flags(target).contains(ExprFlags::PRIVATE_NAME) => None,
            None => self.named.remove(&name),
        }
    }
}

fn find_unfilled_fields(text: ClassText<'_, '_>, plan: &ClassPlan) -> Option<UnfilledFields> {
    let hir = text.hir;
    let lays_fields_alone = plan.transform == ClassTransform::None
        && plan.field_semantics == FieldSemantics::Define
        && plan.initializer_call == InitializerCall::AtThisBinding
        && plan.this_binding_elements.is_empty()
        && plan.injected_elements.is_empty();
    if !lays_fields_alone {
        return None;
    }
    let mut names: FxHashSet<(bool, Atom)> = FxHashSet::default();
    let mut fields = UnfilledFields::default();
    let mut has_empty = false;
    let mut parameter_properties = 0;
    for &element in &plan.instance_elements {
        let name = match element {
            ClassElement::Brand => continue,
            ClassElement::ParameterPropertyField(parameter) => {
                let PatKind::Ident(name) = hir[hir[parameter].pat].kind else {
                    return None;
                };
                parameter_properties += 1;
                (false, name)
            }
            ClassElement::Field { member, value } => {
                let name = match hir.runtime_member_key(member) {
                    PropKey::Name(name) => (false, name),
                    PropKey::Private(name) => (true, name),
                    PropKey::Computed(_) | PropKey::None => return None,
                };
                match value {
                    FieldValue::Undefined => {}
                    FieldValue::Initializer if is_allocated_with_field(text, member) => {}
                    FieldValue::Initializer if !text.value_of_field_names_object(member) => {
                        fields.evaluated_first.push(member);
                    }
                    FieldValue::Initializer | FieldValue::Decorated { .. } => return None,
                }
                has_empty = true;
                if !name.0 {
                    fields.named.insert(name.1, member);
                } else if let Some(private) = text.bound.private_name_of_member(member) {
                    fields.private.insert(private, member);
                }
                name
            }
            _ => return None,
        };
        if !names.insert(name) {
            return None;
        }
    }
    if parameter_properties != plan.parameter_properties.len() {
        return None;
    }
    (has_empty || parameter_properties != 0).then_some(fields)
}

struct Assignment {
    target: ExprId,
    value: ExprId,
}

fn find_assignment(hir: &hir::File<'_>, statement: StmtId) -> Option<Assignment> {
    let StmtKind::Expr(expression) = hir[statement].kind else {
        return None;
    };
    match hir[expression].kind {
        ExprKind::Assign {
            op: None,
            target,
            value,
        } => Some(Assignment { target, value }),
        _ => None,
    }
}

fn is_parameter_or_literal(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    parameters: &[SymbolId],
    value: ExprId,
) -> bool {
    match hir[value].kind {
        ExprKind::Ident(_) => match bound.binding(value) {
            Binding::Symbol(symbol) => parameters.contains(&symbol),
            _ => false,
        },
        ExprKind::Array(_) | ExprKind::Object(_) | ExprKind::Regex { .. } => false,
        _ => names_nothing(hir, value),
    }
}

fn find_stores_after_super(
    file: &mut FileLowering<'_, '_, '_, '_>,
    class: ClassId,
    plan: &ClassPlan,
    call: ExprId,
) -> Option<SmallVec<[StoreAtBirth; 8]>> {
    let (hir, bound) = (file.hir, file.bound);
    let constructor = plan.constructor?;
    let FnBody::Block(statements) = hir[constructor].body else {
        return None;
    };
    let derived = file.own_class(class);
    if has_int32_promise(file) {
        return None;
    }
    file.find_base_class(derived)?;
    let has_value = |element: &ClassElement| match *element {
        ClassElement::Field { member, value } => match value {
            FieldValue::Undefined => false,
            FieldValue::Initializer => !names_nothing(hir, hir[member].init),
            FieldValue::Decorated { .. } => true,
        },
        _ => false,
    };
    if plan.instance_elements.iter().any(has_value) {
        return None;
    }
    let mut fields = find_unfilled_fields(file.class_text(), plan)?;
    let parameters = parameter_symbols(hir, bound, constructor);
    let mut stores = SmallVec::new();
    let is_other = |&it: &StmtId| !matches!(hir[it].kind, StmtKind::Expr(made) if made == call);
    for statement in hir.ids(statements).skip_while(is_other).skip(1) {
        if file.decisions().is_dead_stmt(statement) {
            continue;
        }
        let Some(Assignment { target, value }) = find_assignment(hir, statement) else {
            break;
        };
        if hir.skip_type_assertions(value) != value
            || bound.private_name_of_reference(target).is_some()
            || !is_parameter_or_literal(hir, bound, &parameters, value)
        {
            break;
        }
        let Some(member) = fields.take(hir, bound, target) else {
            break;
        };
        stores.push(StoreAtBirth {
            statement,
            member,
            target,
            value,
        });
    }
    (!stores.is_empty() || !plan.parameter_properties.is_empty()).then_some(stores)
}

pub(super) fn find_initial_fields(
    text: ClassText<'_, '_>,
    plan: &ClassPlan,
    constructor: FnId,
) -> Option<AllocatedFields> {
    let (hir, bound) = (text.hir, text.bound);
    let FnBody::Block(statements) = hir[constructor].body else {
        return None;
    };
    let mut fields = find_unfilled_fields(text, plan)?;
    let mut stores = SmallVec::new();
    let owner = bound.fns[constructor.idx()].owner;
    let end_of_head = match (hir.ids(statements).next(), owner) {
        (Some(first), _) => hir[first].loc.pos,
        (None, FnOwner::Member(member)) => hir[member].loc.end,
        (None, _) => return None,
    };
    let head = text.count_this_super_and_return(hir[constructor].anchor, end_of_head);
    if head != 0 {
        return None;
    }
    let parameters = parameter_symbols(hir, bound, constructor);
    let mut is_plain_row = has_simple_parameter_list(hir, constructor);
    let mut holds_itself = false;
    for statement in hir.ids(statements) {
        if text.decisions.is_dead_stmt(statement) {
            continue;
        }
        let place = hir[statement].loc;
        let named = text.count_this_super_and_return(place.pos, place.end);
        if named == 0 && dispose::find_resource_declarations(hir, statement).is_none() {
            if holds_itself {
                break;
            }
            is_plain_row = false;
            continue;
        }
        let Some(Assignment { target, value }) = find_assignment(hir, statement) else {
            break;
        };
        let written = hir.skip_type_assertions(value);
        let is_plain_value = is_parameter_or_literal(hir, bound, &parameters, written);
        let stores_itself = named == 2 && matches!(hir[written].kind, ExprKind::This);
        let is_taken = match stores_itself {
            true => is_plain_row,
            false => named == 1 && (is_plain_value || !holds_itself),
        };
        if !is_taken {
            break;
        }
        let Some(member) = fields.take(hir, bound, target) else {
            break;
        };
        holds_itself |= stores_itself;
        is_plain_row &= stores_itself || is_plain_value;
        stores.push(StoreAtBirth {
            statement,
            member,
            target,
            value,
        });
    }
    (!stores.is_empty() || !plan.parameter_properties.is_empty()).then_some(AllocatedFields {
        stores,
        evaluated_first: fields.evaluated_first,
        holds_itself,
    })
}

fn is_allocated_with_field(text: ClassText<'_, '_>, member: MemberId) -> bool {
    let hir = text.hir;
    let initializer = hir[member].init;
    let written = hir.skip_type_assertions(initializer);
    names_nothing(hir, initializer)
        || (matches!(hir[written].kind, ExprKind::Fn(_))
            && !text.value_of_field_has_direct_eval(member))
}

fn get_constructor_class(bound: &Bound<'_>, constructor: FnId) -> ClassId {
    let class = bound.function_class(constructor);
    class.expect("a constructor is a class member")
}

fn has_injected_steps(plan: &ClassPlan) -> bool {
    !plan.parameter_properties.is_empty()
        || !plan.injected_elements.is_empty()
        || (plan.initializer_call == InitializerCall::AtInjectionPoint
            && !plan.instance_elements.is_empty())
}
