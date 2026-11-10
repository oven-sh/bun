use bun_sema::atom::Atom;
use bun_sema::bind::{
    Binding, Bound, ClassOwner, CodeUnit, Decl, FnOwner, PrivateNameId, ScopeId,
    has_simple_parameter_list,
};
use bun_sema::hir::{
    self, Chain, ClassId, ExprFlags, ExprId, ExprKind, FnBody, FnId, MemberId, ParamId, PatKind,
    PropKey, PropKind, StmtId, StmtKind, UnOp,
};
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;

use super::{
    Birth, ClassElement, ClassPlan, ClassTransform, FieldSemantics, FieldValue, InitializerCall,
    InjectionPoint, StoreAtBirth, fields, is_derived_class,
};
use crate::ir::generated::{
    Function, FunctionFlags, FunctionKind, HomeObjectKind, RuntimeErrorKind, SourceRange,
};
use crate::ir::{DeclaredType, FunctionId, FunctionKey, StringId, TypeTable, ValueId};
use crate::lower::call::Arguments;
use crate::lower::layouts::class_position;
use crate::lower::member::PropertyName;
use crate::lower::parameters::parameter_symbols;
use crate::lower::scope::ScopeSlot;
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
        header.text = SourceRange {
            start: node.text_start,
            end,
        };
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
            let this = lowering.emit_allocation(class);
            lowering.set_position(lowering.file.hir[source].anchor);
            if let Some(stores) = find_fields_born_with_stores(lowering.file, &plan, source) {
                lowering.lower_parameters(source);
                lowering.begin_birth(class, &plan, stores, this);
            } else {
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
        let layout = self.file.own_class_layout(class);
        let new_target = self.builder.new_target();
        let new_target = new_target.expect("a constructor takes new.target");
        let prototype = self.builder.get_construct_prototype(new_target, layout);
        let this = self.builder.new_object(layout, &[], Some(prototype), &[]);
        self.file.fragment.note_allocation(layout);
        self.bind_constructed_object(class, this)
    }

    fn bind_constructed_object(&mut self, class: ClassId, constructed: ValueId) -> ValueId {
        let class = self.file.own_class(class);
        let position = self.file.class_this_type(class, None);
        let this = convert::convert(self, constructed, position, None);
        self.bind_this(this);
        this
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
        this: ValueId,
    ) {
        let parameters = plan.parameter_properties.iter();
        let parameter_properties = parameters.map(|&it| self.get_parameter_property(it));
        let birth = Birth {
            class,
            this,
            parameter_properties: parameter_properties.collect(),
            stores,
            values: SmallVec::new(),
        };
        match birth.stores.is_empty() {
            true => self.emit_fields_born_with_stores(&birth),
            false => self.birth = Some(birth),
        }
    }

    pub(in crate::lower) fn lower_store_at_birth(&mut self, statement: StmtId) -> bool {
        let birth = self.birth.as_ref();
        let next = birth.map(|birth| (birth.class, birth.this, birth.stores[birth.values.len()]));
        let Some((class, this, store)) = next.filter(|next| next.2.statement == statement) else {
            return false;
        };
        self.count_statement(statement);
        let hir = self.file.hir;
        let value = match hir[hir.skip_type_assertions(store.value)].kind {
            ExprKind::This => this,
            _ => self.lower_expression(store.value),
        };
        let value = match self.file.hir.runtime_member_key(store.member) {
            PropKey::Private(_) => {
                let position = fields::member_field_position(self.file, class, store.member);
                convert::convert(self, value, position, Some(store.value))
            }
            _ => self.convert_to_member(store.target, value, Some(store.value)),
        };
        let is_last = self.birth.as_mut().is_some_and(|birth| {
            birth.values.push(value);
            birth.values.len() == birth.stores.len()
        });
        if is_last && let Some(birth) = self.birth.take() {
            self.emit_fields_born_with_stores(&birth);
        }
        true
    }

    fn emit_fields_born_with_stores(&mut self, birth: &Birth) {
        let (class, this) = (birth.class, birth.this);
        let plan = self.file.class_plan(class);
        let caller_position = self.position();
        let mut parameter_properties = birth.parameter_properties.iter();
        let stores = birth.stores.iter().enumerate();
        let places: FxHashMap<MemberId, usize> =
            stores.map(|(place, store)| (store.member, place)).collect();
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
            let place = member.and_then(|member| places.get(&member).copied());
            match (member, place) {
                (Some(member), Some(place)) => {
                    self.emit_field_born_with(class, member, birth.values[place], this);
                }
                _ => self.emit_class_element(class, element, this),
            }
        }
        self.set_position(caller_position);
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

fn find_fields_born_with_stores(
    file: &mut FileLowering<'_, '_, '_, '_>,
    plan: &ClassPlan,
    constructor: FnId,
) -> Option<SmallVec<[StoreAtBirth; 8]>> {
    let hir = file.hir;
    let mut born = SmallVec::new();
    let lays_fields_alone = plan.transform == ClassTransform::None
        && plan.field_semantics == FieldSemantics::Define
        && plan.initializer_call == InitializerCall::AtThisBinding
        && plan.this_binding_elements.is_empty()
        && plan.injected_elements.is_empty();
    let FnBody::Block(statements) = hir[constructor].body else {
        return None;
    };
    if !lays_fields_alone {
        return None;
    }
    let mut names: FxHashSet<(bool, Atom)> = FxHashSet::default();
    let mut empty: FxHashMap<Atom, MemberId> = FxHashMap::default();
    let mut empty_private: FxHashMap<PrivateNameId, MemberId> = FxHashMap::default();
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
                    FieldValue::Initializer if names_nothing(hir, hir[member].init) => {}
                    FieldValue::Initializer | FieldValue::Decorated { .. } => return None,
                }
                has_empty = true;
                if !name.0 {
                    empty.insert(name.1, member);
                } else if let Some(private) = file.bound.private_name_of_member(member) {
                    empty_private.insert(private, member);
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
    if !has_empty && parameter_properties == 0 {
        return None;
    }
    let owner = file.bound.fns[constructor.idx()].owner;
    let end_of_head = match (hir.ids(statements).next(), owner) {
        (Some(first), _) => hir[first].loc.pos,
        (None, FnOwner::Member(member)) => hir[member].loc.end,
        (None, _) => return None,
    };
    let head = file.count_this_super_and_return(hir[constructor].anchor, end_of_head);
    if head != 0 {
        return None;
    }
    let parameters = parameter_symbols(hir, file.bound, constructor);
    let mut is_plain_row = has_simple_parameter_list(hir, constructor);
    let mut holds_itself = false;
    for statement in hir.ids(statements) {
        if file.decisions().is_dead_stmt(statement) {
            continue;
        }
        let place = hir[statement].loc;
        let named = file.count_this_super_and_return(place.pos, place.end);
        if named == 0 && dispose::find_resource_declarations(hir, statement).is_none() {
            if holds_itself {
                break;
            }
            is_plain_row = false;
            continue;
        }
        let StmtKind::Expr(expression) = hir[statement].kind else {
            break;
        };
        let ExprKind::Assign {
            op: None,
            target,
            value,
        } = hir[expression].kind
        else {
            break;
        };
        let ExprKind::Dot {
            obj,
            name,
            chain: Chain::No,
            ..
        } = hir[target].kind
        else {
            break;
        };
        let bound = file.bound;
        let private = bound.private_name_of_reference(target);
        let is_written_private = hir.expr_flags(target).contains(ExprFlags::PRIVATE_NAME);
        let written = hir.skip_type_assertions(value);
        let is_plain_value = match hir[written].kind {
            ExprKind::Ident(_) => match bound.binding(written) {
                Binding::Symbol(symbol) => parameters.contains(&symbol),
                _ => false,
            },
            ExprKind::Array(_) | ExprKind::Object(_) | ExprKind::Regex { .. } => false,
            _ => names_nothing(hir, written),
        };
        let stores_itself = named == 2 && matches!(hir[written].kind, ExprKind::This);
        let is_taken = match stores_itself {
            true => is_plain_row,
            false => named == 1 && (is_plain_value || !holds_itself),
        };
        if !is_taken || !matches!(hir[obj].kind, ExprKind::This) {
            break;
        }
        let member = match private {
            Some(private) => empty_private.remove(&private),
            None if is_written_private => None,
            None => empty.remove(&name),
        };
        let Some(member) = member else {
            break;
        };
        holds_itself |= stores_itself;
        is_plain_row &= stores_itself || is_plain_value;
        born.push(StoreAtBirth {
            statement,
            member,
            target,
            value,
        });
    }
    (!born.is_empty() || parameter_properties != 0).then_some(born)
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
