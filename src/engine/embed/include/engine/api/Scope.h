#pragma once

// The scopes between code and its global object. They are cells without properties.

#include "engine/api/GlobalObject.h"

namespace JSC {

inline JSScope* JSScope::next() { return type() == GlobalObjectType ? nullptr : Engine::fieldAt<JSScope*>(this, Engine::Layout::Environment_parent); }

// The names of the variables of a scope. Scopes that have one together can run the same code.
class ScopeTemplate final : public JSCell {
public:
    ENGINE_DECLARE_CLASS(ScopeTemplate)

    // For a scope right inside the global one.
    static ScopeTemplate* create(VM& vm, std::span<const Identifier> names) { return Engine::scope_template_of_names(vm, names); }
};

class JSLexicalEnvironment : public JSScope {
public:
    ENGINE_DECLARE_CLASS(Environment)

    // The variables are undefined.
    static JSLexicalEnvironment* create(JSGlobalObject* globalObject, ScopeTemplate* scopeTemplate) { return Engine::environment_create_in_global_scope(globalObject, scopeTemplate); }

    // Empty if there is no such variable, or it has no value yet.
    JSValue variable(PropertyName name) const { return Engine::environment_get_variable(this, name); }
    void setVariable(VM& vm, PropertyName name, JSValue value) { Engine::environment_set_variable(this, vm, name, value); }
};
ENGINE_CLASS_HAS_TYPES(JSLexicalEnvironment, LexicalEnvironmentType, ModuleEnvironmentType);

class JSModuleEnvironment final : public JSLexicalEnvironment {
public:
    ENGINE_DECLARE_CLASS(ModuleEnvironment)

    // By the local name of a resolved export.
    bool hasBinding(PropertyName name) const { return Engine::module_environment_has_binding(this, name); }
    // Empty before it is initialized.
    JSValue readBinding(VM& vm, PropertyName name) { return Engine::module_environment_read_binding(this, vm, name); }
};
ENGINE_CLASS_HAS_TYPE(JSModuleEnvironment, ModuleEnvironmentType);

class JSWithScope final : public JSScope {
public:
    static JSWithScope* create(VM& vm, JSGlobalObject*, JSScope* next, JSObject* object) { return reinterpret_cast<JSWithScope*>(Engine::environment_create_for_object(vm, next, object)); }
};

// Whether the code was compiled for functions that are made in that scope.
inline bool canCloseOver(FunctionExecutable* executable, JSScope* scope) { return Engine::function_executable_can_close_over(executable, scope); }

// Runs a script in the global scope. If the result is a function at its top level that has not run, it closes over `scope`.
inline JSValue evaluateToFunctionInScope(JSGlobalObject* globalObject, const SourceCode& source, JSLexicalEnvironment* scope) { return Engine::evaluate_to_function_in_scope(globalObject, source, scope); }

// Runs a script of which the free names are looked up in `scope` first.
inline JSValue evaluateInScope(JSGlobalObject* globalObject, const SourceCode& source, JSScope* scope) { return Engine::evaluate_in_scope(globalObject, source, scope); }

} // namespace JSC
