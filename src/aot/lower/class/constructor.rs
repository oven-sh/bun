use bun_sema::bind::{Binding, Bound, ClassOwner, CodeUnit, Decl};
use bun_sema::hir::{ClassId, ExprId, ExprKind, FnId, ParamId, PatKind};

use super::{ClassPlan, InitializerCall, InjectionPoint, fields, is_derived_class};
use crate::ir::generated::{
    BlockFrequency, Function, FunctionFlags, FunctionKind, HomeObjectKind, RuntimeErrorKind,
    SourceRange,
};
use crate::ir::{DeclaredType, FunctionId, FunctionKey, StringId, TypeTable, ValueId};
use crate::lower::call::Arguments;
use crate::lower::member::PropertyName;
use crate::lower::scope::ScopeSlot;
use crate::lower::{FileLowering, FunctionLowering, convert, function};

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
            start: self.type_ranges.map_offset(node.text_start),
            end: self.type_ranges.map_offset(end),
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
        if is_derived {
            lowering.lower_parameters(source);
            if plan.injection_point == InjectionPoint::Start && has_injected_steps(&plan) {
                lowering.emit_throw_runtime_error(RuntimeErrorKind::UninitializedThis, None);
            }
        } else {
            let this = lowering.emit_allocation(class);
            // JSC reports what the field initializers do at the parameter list of the constructor.
            lowering.set_position(lowering.file.hir[source].anchor);
            lowering.emit_this_binding_steps(class, &plan, this);
            lowering.lower_parameters(source);
            lowering.emit_injected_steps(class, &plan, this);
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
) -> FunctionId {
    if let Some(function) = plan.constructor {
        return function::declare_source_function(file, function, name);
    }
    let key = FunctionKey::ImplicitConstructor(file.own_class(class));
    file.declare_function(key, |file| {
        let position = file.hir[class].name_pos;
        let mut header =
            function::create_header(file, key, FunctionKind::BaseConstructor, position);
        if is_derived_class(file.hir, class) {
            header.flags |= FunctionFlags::HAS_REST_PARAMETER | FunctionFlags::TAKES_CALLEE;
            let arguments = DeclaredType::from_compiler(TypeTable::ARRAY);
            header.parameters.push(arguments);
        }
        file.finish_constructor_header(class, name, &mut header);
        header
    })
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(crate) fn lower_super_call(&mut self, call: ExprId) -> ValueId {
        let hir = self.file.hir;
        let ExprKind::Call(site) = hir[call].kind else {
            unreachable!("a super call is a call expression");
        };
        let Some(constructor) = self.find_derived_constructor() else {
            self.lower_arguments(hir[site].args);
            self.set_position(hir[call].pos);
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
                self.set_position(hir[call].pos);
                self.builder
                    .super_construct(layout, parent, new_target, &values)
            }
            Arguments::List(list) => {
                self.convert_argument_list(call, list);
                self.set_position(hir[call].pos);
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
        self.builder
            .set_frequency(invalid_result, BlockFrequency::Unlikely);
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
        self.set_position(self.file.hir[class].start);
        let new_target = self.builder.new_target();
        let new_target = new_target.expect("a constructor takes new.target");
        let prototype = self.builder.get_construct_prototype(new_target, layout);
        let this = self.builder.new_object(layout, &[], Some(prototype), &[]);
        self.file.fragment.note_allocation(layout);
        self.bind_constructed_object(class, this)
    }

    // The constructor of the parent can return any object, and the prototype of new.target can select the layout of another class.
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

    fn emit_this_binding_steps(&mut self, class: ClassId, plan: &ClassPlan, this: ValueId) {
        for &element in &plan.this_binding_elements {
            self.emit_class_element(class, element, this);
        }
        if plan.initializer_call == InitializerCall::AtThisBinding {
            self.emit_instance_initializer_call(class, plan, this);
        }
    }

    fn emit_injected_steps(&mut self, class: ClassId, plan: &ClassPlan, this: ValueId) {
        let caller_position = self.position();
        for &parameter in &plan.parameter_properties {
            self.emit_parameter_property(parameter, this);
        }
        self.set_position(caller_position);
        if plan.initializer_call == InitializerCall::AtInjectionPoint {
            self.emit_instance_initializer_call(class, plan, this);
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

fn get_constructor_class(bound: &Bound<'_>, constructor: FnId) -> ClassId {
    let class = bound.function_class(constructor);
    class.expect("a constructor is a class member")
}

fn has_injected_steps(plan: &ClassPlan) -> bool {
    !plan.parameter_properties.is_empty()
        || (plan.initializer_call == InitializerCall::AtInjectionPoint
            && !plan.instance_elements.is_empty())
}
