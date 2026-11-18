use bun_engine_bytecode::{FunctionInfo, ScopeKind, StaticScope};
use bun_engine_macros::export;
use bun_engine_text::{Identifier, PropertyName};
use bun_engine_vm::scope::is_instance_of;
use bun_engine_vm::{
    Cx, Environment, FunctionExecutable, Gc, JsCell, JsObject, JsResult, ModuleEnvironment,
    ScopeTemplate, SourceCode, Value, Vm, evaluate_script_in_scope, evaluate_script_to_function_in,
};

#[export]
fn scope_template_of_names(vm: &Vm, names: &[Identifier]) -> Gc<ScopeTemplate> {
    let scope = StaticScope::of_names(ScopeKind::Block, None, names.into());
    ScopeTemplate::create(vm, scope)
}

#[export]
fn environment_create_in_global_scope(cx: &Cx, template: Gc<ScopeTemplate>) -> Gc<Environment> {
    assert!(template.scope().parent().is_none());
    // SAFETY: nothing is around it.
    unsafe { Environment::create(cx, &cx.global(), cx.global().cell(), template) }
}

#[export]
fn environment_create_for_object(
    vm: &Vm,
    parent: Gc<JsCell>,
    object: Gc<JsObject>,
) -> Gc<Environment> {
    Environment::create_for_object(vm, parent, object)
}

#[export]
fn environment_get_variable(environment: &Environment, name: PropertyName<'_>) -> Option<Value> {
    environment.get(environment.template().scope().find(name)?.index)
}

#[export]
fn environment_set_variable(
    environment: &Environment,
    vm: &Vm,
    name: PropertyName<'_>,
    value: Value,
) {
    assert!(environment.overwrite(vm, name, value));
}

#[export]
fn module_environment_has_binding(environment: &ModuleEnvironment, name: PropertyName<'_>) -> bool {
    environment.slot_of_binding(name).is_some()
}

#[export]
fn module_environment_read_binding(
    environment: &ModuleEnvironment,
    vm: &Vm,
    name: PropertyName<'_>,
) -> Option<Value> {
    environment.read_variable(vm, environment.slot_of_binding(name)?)
}

pub(super) fn can_close_over(function: &FunctionInfo, scope: Gc<JsCell>) -> bool {
    is_instance_of(scope, function.outer_scope())
}

#[export]
fn function_executable_can_close_over(executable: &FunctionExecutable, scope: Gc<JsCell>) -> bool {
    can_close_over(executable.info(), scope)
}

#[export]
fn evaluate_to_function_in_scope(
    cx: &mut Cx,
    source: &SourceCode,
    scope: Gc<Environment>,
) -> JsResult<Value> {
    evaluate_script_to_function_in(cx, source, scope)
}

#[export]
fn evaluate_in_scope(cx: &mut Cx, source: &SourceCode, scope: Gc<JsCell>) -> JsResult<Value> {
    evaluate_script_in_scope(cx, source, scope, cx.global_this().into())
}
