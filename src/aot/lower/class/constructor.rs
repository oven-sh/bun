use bun_sema::bind::{Binding, Bound, ClassOwner, CodeUnit, Decl};
use bun_sema::check::aot::ClassRef;
use bun_sema::hir::{self, ClassId, ExprId, ExprKind, FnId, ParamId, PatKind};

use super::{ClassPlan, InitializerCall, InjectionPoint, class_plan, fields, is_derived_class};
use crate::ir::generated::{
    BlockFrequency, Function, FunctionFlags, FunctionKind, HomeObjectKind, RuntimeErrorKind,
    SourceRange,
};
use crate::ir::{DeclaredType, FunctionId, FunctionKey, LayoutId, StringId, TypeTable, ValueId};
use crate::lower::call::{self, Arguments};
use crate::lower::function::{self, EntryArguments};
use crate::lower::member::{self, PropertyName};
use crate::lower::scope::{self, ScopeSlot};
use crate::lower::{
    FileLowering, FunctionLowering, condition, convert, exception, layouts, parameters, positions,
};

pub(crate) fn finish_constructor_header(
    file: &mut FileLowering<'_, '_, '_, '_>,
    class: ClassId,
    name: Option<StringId>,
    header: &mut Function,
) {
    let hir = file.hir;
    let node = hir[class];
    if node.name.is_some() {
        header.name = Some(layouts::intern_class_name(file, class));
        header.flags |= FunctionFlags::HAS_EXPLICIT_NAME;
    } else {
        header.name = name;
        header.flags = header.flags.without(FunctionFlags::HAS_EXPLICIT_NAME);
    }
    header.text = match file.compiled.installed_text {
        Some(installed) => {
            let (start, end) = (installed.classes.get(class.idx()).copied()).unwrap_or_default();
            SourceRange { start, end }
        }
        None => SourceRange {
            start: file.type_ranges.map_offset(node.text_start),
            end: (file.type_ranges).map_offset(compute_class_text_end(hir, file.bound, class)),
        },
    };
    header.kind = match is_derived_class(hir, class) {
        true => FunctionKind::DerivedConstructor,
        false => FunctionKind::BaseConstructor,
    };
    header.flags = header.flags.without(FunctionFlags::HAS_THIS) | FunctionFlags::HAS_NEW_TARGET;
    header.this_type = DeclaredType::untyped();
    header.results = vec![DeclaredType::from_compiler(TypeTable::OBJECT)];
}

pub(super) fn declare_constructor(
    file: &mut FileLowering<'_, '_, '_, '_>,
    class: ClassId,
    plan: &ClassPlan,
    name: Option<StringId>,
) -> FunctionId {
    match plan.constructor {
        Some(function) => function::declare_source_function(file, function, name),
        None => {
            let key = FunctionKey::ImplicitConstructor(ClassRef {
                file: file.file,
                class,
            });
            file.declare_function(key, |file| create_implicit_header(file, key, class, name))
        }
    }
}

pub(crate) fn lower_constructor(
    file: &mut FileLowering<'_, '_, '_, '_>,
    function: FunctionId,
    source: FnId,
) {
    let class = get_constructor_class(file.bound, source);
    let plan = class_plan(file, class);
    let is_derived = is_derived_class(file.hir, class);
    let mut lowering = FunctionLowering::begin(file, function);
    if is_derived {
        parameters::lower_parameters(&mut lowering, source);
        if plan.injection_point == InjectionPoint::Start && has_injected_steps(&plan) {
            let error = RuntimeErrorKind::UninitializedThis;
            exception::emit_throw_runtime_error(&mut lowering, error, None);
        }
    } else {
        let this = emit_allocation(&mut lowering, class);
        // JSC reports what the field initializers do at the parameter list of the constructor.
        lowering.set_position(lowering.file.hir[source].anchor);
        emit_this_binding_steps(&mut lowering, class, &plan, this);
        parameters::lower_parameters(&mut lowering, source);
        emit_injected_steps(&mut lowering, class, &plan, this);
    }
    function::lower_function_body(&mut lowering, source);
    let scope = lowering.file.bound.fns[source.idx()].scope;
    scope::leave_scope(&mut lowering, scope);
    lowering.finish();
}

pub(crate) fn lower_implicit_constructor(
    file: &mut FileLowering<'_, '_, '_, '_>,
    function: FunctionId,
    class: ClassId,
) {
    let plan = class_plan(file, class);
    let is_derived = is_derived_class(file.hir, class);
    let mut lowering = FunctionLowering::begin(file, function);
    let this = match is_derived {
        true => emit_implicit_super_call(&mut lowering, class),
        false => emit_allocation(&mut lowering, class),
    };
    emit_this_binding_steps(&mut lowering, class, &plan, this);
    emit_injected_steps(&mut lowering, class, &plan, this);
    lowering.builder.return_value(Some(this));
    lowering.finish();
}

pub(crate) fn lower_super_call(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
) -> ValueId {
    let hir = lowering.file.hir;
    let ExprKind::Call(site) = hir[call].kind else {
        unreachable!("a super call is a call expression");
    };
    let Some(constructor) = find_derived_constructor(lowering) else {
        call::lower_arguments(lowering, hir[site].args);
        lowering.set_position(hir[call].pos);
        exception::emit_throw_runtime_error(lowering, RuntimeErrorKind::UninitializedThis, None);
        return lowering.builder.undefined();
    };
    let class = get_constructor_class(lowering.file.bound, constructor);
    let plan = class_plan(lowering.file, class);
    let layout = get_class_layout(lowering.file, class);
    let constructor_scope = lowering.file.bound.fns[constructor.idx()].scope;

    let new_target = function::get_new_target(lowering);
    let callee = scope::get_slot(lowering, constructor_scope, ScopeSlot::Callee);
    let parent = lowering
        .builder
        .get_super_base(HomeObjectKind::Object, callee);
    let this = match call::lower_arguments(lowering, hir[site].args) {
        Arguments::Values(mut values) => {
            convert::convert_arguments(lowering, call, &mut values);
            lowering.set_position(hir[call].pos);
            lowering
                .builder
                .super_construct(layout, parent, new_target, &values)
        }
        Arguments::List(list) => {
            convert::convert_argument_list(lowering, call, list);
            lowering.set_position(hir[call].pos);
            lowering
                .builder
                .super_construct_list(layout, parent, new_target, list)
        }
    };
    let this = convert_constructed_object(lowering, class, this);
    function::bind_this(lowering, this);
    emit_this_binding_steps(lowering, class, &plan, this);
    if plan.injection_point == InjectionPoint::AfterSuperCall(call) {
        emit_injected_steps(lowering, class, &plan, this);
    }
    this
}

pub(crate) fn emit_constructor_result(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    value: ValueId,
) -> ValueId {
    let is_derived = match lowering.builder.function().kind {
        FunctionKind::BaseConstructor => false,
        FunctionKind::DerivedConstructor => true,
        _ => {
            debug_assert!(false, "only a constructor tests its result");
            return value;
        }
    };
    let join = lowering.create_block();
    let result = lowering.builder.add_parameter(join, None);

    let split = condition::split_on_type(lowering, value, TypeTable::OBJECT);
    lowering.builder.switch_to(split.taken);
    lowering.jump_with(join, &[split.taken_value]);

    lowering.builder.switch_to(split.not_taken);
    if is_derived {
        emit_undefined_result_test(lowering, split.not_taken_value);
    }
    let this = function::get_this(lowering);
    lowering.jump_with(join, &[this]);

    lowering.continue_in(join);
    result
}

fn emit_undefined_result_test(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>, value: ValueId) {
    let split = condition::split_on_type(lowering, value, TypeTable::UNDEFINED);
    let invalid_result = split.not_taken;
    lowering
        .builder
        .set_frequency(invalid_result, BlockFrequency::Unlikely);
    lowering.builder.switch_to(invalid_result);
    let header = lowering.builder.function();
    let class_name = match header.flags.contains(FunctionFlags::HAS_EXPLICIT_NAME) {
        true => header.name,
        false => None,
    };
    let error = RuntimeErrorKind::DerivedConstructorResult;
    exception::emit_throw_runtime_error(lowering, error, class_name);
    lowering.builder.switch_to(split.taken);
}

fn create_implicit_header(
    file: &mut FileLowering<'_, '_, '_, '_>,
    key: FunctionKey,
    class: ClassId,
    name: Option<StringId>,
) -> Function {
    let position = file.hir[class].name_pos;
    let mut header = function::create_header(file, key, FunctionKind::BaseConstructor, position);
    if is_derived_class(file.hir, class) {
        header.flags |= FunctionFlags::HAS_REST_PARAMETER | FunctionFlags::TAKES_CALLEE;
        let arguments = DeclaredType::from_compiler(TypeTable::ARRAY);
        header.parameters.push(arguments);
    }
    finish_constructor_header(file, class, name, &mut header);
    header
}

fn compute_class_text_end(hir: &hir::File<'_>, bound: &Bound<'_>, class: ClassId) -> u32 {
    match bound.class_owner[class.idx()] {
        ClassOwner::Expr(expression) => hir[expression].end,
        ClassOwner::Stmt(statement) => hir[statement].loc.end,
    }
}

fn get_constructor_class(bound: &Bound<'_>, constructor: FnId) -> ClassId {
    let class = bound.function_class(constructor);
    class.expect("a constructor is a class member")
}

fn get_class_layout(file: &mut FileLowering<'_, '_, '_, '_>, class: ClassId) -> LayoutId {
    let class = ClassRef {
        file: file.file,
        class,
    };
    layouts::class_layout(file, class)
}

fn find_derived_constructor(lowering: &FunctionLowering<'_, '_, '_, '_, '_>) -> Option<FnId> {
    let innermost = scope::innermost_scope(lowering);
    let owner = lowering.file.scopes.lexical_owner(innermost);
    match lowering.file.bound.code_unit(owner) {
        CodeUnit::Function(function) => {
            function::is_derived_constructor(lowering.file, function).then_some(function)
        }
        CodeUnit::FieldInitializer(_) | CodeUnit::File => None,
    }
}

fn has_injected_steps(plan: &ClassPlan) -> bool {
    !plan.parameter_properties.is_empty()
        || (plan.initializer_call == InitializerCall::AtInjectionPoint
            && !plan.instance_elements.is_empty())
}

fn emit_allocation(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>, class: ClassId) -> ValueId {
    let layout = get_class_layout(lowering.file, class);
    lowering.set_position(lowering.file.hir[class].start);
    let new_target = lowering.builder.new_target();
    let new_target = new_target.expect("a constructor takes new.target");
    let prototype = lowering.builder.get_construct_prototype(new_target, layout);
    let this = lowering
        .builder
        .new_object(layout, &[], Some(prototype), &[]);
    lowering.file.fragment.note_allocation(layout);
    let this = convert_constructed_object(lowering, class, this);
    function::bind_this(lowering, this);
    this
}

// The constructor of the parent can return any object, and the prototype of new.target can select the layout of another class.
fn convert_constructed_object(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    class: ClassId,
    constructed: ValueId,
) -> ValueId {
    let class = ClassRef {
        file: lowering.file.file,
        class,
    };
    let position = positions::class_this_type(lowering.file, class, None);
    convert::convert(lowering, constructed, position, None)
}

fn emit_implicit_super_call(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    class: ClassId,
) -> ValueId {
    let layout = get_class_layout(lowering.file, class);
    let new_target = lowering.builder.new_target();
    let new_target = new_target.expect("a constructor takes new.target");
    let callee = lowering.builder.callee();
    let callee = callee.expect("an implicit derived constructor takes its callee");
    let parent = lowering
        .builder
        .get_super_base(HomeObjectKind::Object, callee);
    let list = lowering.builder.parameter(0);
    let this = lowering
        .builder
        .super_construct_list(layout, parent, new_target, list);
    let this = convert_constructed_object(lowering, class, this);
    function::bind_this(lowering, this);
    this
}

fn emit_this_binding_steps(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    class: ClassId,
    plan: &ClassPlan,
    this: ValueId,
) {
    for &element in &plan.this_binding_elements {
        fields::emit_class_element(lowering, class, element, this);
    }
    if plan.initializer_call == InitializerCall::AtThisBinding {
        emit_instance_initializer_call(lowering, class, plan, this);
    }
}

fn emit_injected_steps(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    class: ClassId,
    plan: &ClassPlan,
    this: ValueId,
) {
    let caller_position = lowering.position();
    for &parameter in &plan.parameter_properties {
        emit_parameter_property(lowering, parameter, this);
    }
    lowering.set_position(caller_position);
    if plan.initializer_call == InitializerCall::AtInjectionPoint {
        emit_instance_initializer_call(lowering, class, plan, this);
    }
}

fn emit_parameter_property(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    parameter: ParamId,
    this: ValueId,
) {
    let hir = lowering.file.hir;
    let pattern = hir[parameter].pat;
    match hir[pattern].kind {
        PatKind::Ident(name) => {
            lowering.set_position(hir[parameter].pos);
            let symbol = lowering.file.bound.declared_symbol(Decl::Param(pattern));
            let value = scope::get_binding(lowering, Binding::Symbol(symbol), name);
            let key = member::name_key(lowering.file, name);
            member::emit_set(lowering, this, PropertyName::Constant(key), value);
        }
        PatKind::Missing | PatKind::Object(_) | PatKind::Array(_) => {
            debug_assert!(false, "a parameter property binds an identifier");
        }
    }
}

fn emit_instance_initializer_call(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    class: ClassId,
    plan: &ClassPlan,
    this: ValueId,
) {
    if plan.instance_elements.is_empty() {
        return;
    }
    let initializer = fields::declare_instance_initializer(lowering.file, class);
    let arguments = EntryArguments {
        this: Some(this),
        ..EntryArguments::default()
    };
    function::emit_direct_call(lowering, initializer, arguments);
}
