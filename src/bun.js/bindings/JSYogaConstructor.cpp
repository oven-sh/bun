#include "root.h"
#include "JSYogaConstructor.h"
#include "JSYogaConfig.h"
#include "JSYogaNode.h"
#include "JSYogaPrototype.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/JSCInlines.h>
#include <yoga/Yoga.h>

#ifndef UNLIKELY
#define UNLIKELY(x) __builtin_expect(!!(x), 0)
#endif

namespace Bun {

// Forward declarations for constructor functions
static JSC_DECLARE_HOST_FUNCTION(constructJSYogaConfig);
static JSC_DECLARE_HOST_FUNCTION(callJSYogaConfig);
static JSC_DECLARE_HOST_FUNCTION(constructJSYogaNode);
static JSC_DECLARE_HOST_FUNCTION(callJSYogaNode);

// Config Constructor implementation
const JSC::ClassInfo JSYogaConfigConstructor::s_info = { "Config"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSYogaConfigConstructor) };

JSYogaConfigConstructor::JSYogaConfigConstructor(JSC::VM& vm, JSC::Structure* structure)
    : Base(vm, structure, callJSYogaConfig, constructJSYogaConfig)
{
}

void JSYogaConfigConstructor::finishCreation(JSC::VM& vm, JSC::JSObject* prototype)
{
    Base::finishCreation(vm, 0, "Config"_s, PropertyAdditionMode::WithStructureTransition);
    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);

    // Add static methods - create() is an alias for the constructor
    putDirectNativeFunction(vm, this->globalObject(), JSC::Identifier::fromString(vm, "create"_s), 0, constructJSYogaConfig, ImplementationVisibility::Public, NoIntrinsic, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
}

// Node Constructor implementation
const JSC::ClassInfo JSYogaNodeConstructor::s_info = { "Node"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSYogaNodeConstructor) };

JSYogaNodeConstructor::JSYogaNodeConstructor(JSC::VM& vm, JSC::Structure* structure)
    : Base(vm, structure, callJSYogaNode, constructJSYogaNode)
{
}

void JSYogaNodeConstructor::finishCreation(JSC::VM& vm, JSC::JSObject* prototype)
{
    Base::finishCreation(vm, 1, "Node"_s, PropertyAdditionMode::WithStructureTransition); // 1 for optional config parameter
    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);

    // Add static methods - create() is an alias for the constructor
    putDirectNativeFunction(vm, this->globalObject(), JSC::Identifier::fromString(vm, "create"_s), 1, constructJSYogaNode, ImplementationVisibility::Public, NoIntrinsic, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
}

// Constructor functions
JSC_DEFINE_HOST_FUNCTION(constructJSYogaConfig, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    JSC::Structure* structure = zigGlobalObject->m_JSYogaConfigClassStructure.get(zigGlobalObject);

    // Handle subclassing
    JSC::JSValue newTarget = callFrame->newTarget();
    if (UNLIKELY(zigGlobalObject->m_JSYogaConfigClassStructure.constructor(zigGlobalObject) != newTarget)) {
        if (!newTarget) {
            throwTypeError(globalObject, scope, "Class constructor Config cannot be invoked without 'new'"_s);
            return {};
        }

        auto* functionGlobalObject = defaultGlobalObject(getFunctionRealm(globalObject, newTarget.getObject()));
        RETURN_IF_EXCEPTION(scope, {});
        structure = JSC::InternalFunction::createSubclassStructure(
            globalObject, newTarget.getObject(), functionGlobalObject->m_JSYogaConfigClassStructure.get(functionGlobalObject));
        scope.release();
    }

    return JSC::JSValue::encode(JSYogaConfig::create(vm, structure));
}

JSC_DEFINE_HOST_FUNCTION(callJSYogaConfig, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    throwTypeError(globalObject, scope, "Class constructor Config cannot be invoked without 'new'"_s);
    return {};
}

JSC_DEFINE_HOST_FUNCTION(constructJSYogaNode, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    JSC::Structure* structure = zigGlobalObject->m_JSYogaNodeClassStructure.get(zigGlobalObject);

    // Handle subclassing
    JSC::JSValue newTarget = callFrame->newTarget();
    if (UNLIKELY(zigGlobalObject->m_JSYogaNodeClassStructure.constructor(zigGlobalObject) != newTarget)) {
        if (!newTarget) {
            throwTypeError(globalObject, scope, "Class constructor Node cannot be invoked without 'new'"_s);
            return {};
        }

        auto* functionGlobalObject = defaultGlobalObject(getFunctionRealm(globalObject, newTarget.getObject()));
        RETURN_IF_EXCEPTION(scope, {});
        structure = JSC::InternalFunction::createSubclassStructure(
            globalObject, newTarget.getObject(), functionGlobalObject->m_JSYogaNodeClassStructure.get(functionGlobalObject));
        scope.release();
    }

    // Optional config parameter
    YGConfigRef config = nullptr;
    if (callFrame->argumentCount() > 0) {
        JSC::JSValue configArg = callFrame->uncheckedArgument(0);
        if (!configArg.isUndefinedOrNull()) {
            auto* jsConfig = JSC::jsDynamicCast<JSYogaConfig*>(configArg);
            if (!jsConfig) {
                throwTypeError(globalObject, scope, "First argument must be a Yoga.Config instance"_s);
                return {};
            }
            config = jsConfig->internal();
        }
    }

    return JSC::JSValue::encode(JSYogaNode::create(vm, structure, config));
}

JSC_DEFINE_HOST_FUNCTION(callJSYogaNode, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    throwTypeError(globalObject, scope, "Class constructor Node cannot be invoked without 'new'"_s);
    return {};
}

// Setup functions for lazy initialization
void setupJSYogaConfigClassStructure(JSC::LazyClassStructure::Initializer& init)
{
    auto* prototypeStructure = JSYogaConfigPrototype::createStructure(init.vm, init.global, init.global->objectPrototype());
    auto* prototype = JSYogaConfigPrototype::create(init.vm, init.global, prototypeStructure);

    auto* constructorStructure = JSYogaConfigConstructor::createStructure(init.vm, init.global, init.global->functionPrototype());
    auto* constructor = JSYogaConfigConstructor::create(init.vm, constructorStructure, prototype);

    auto* structure = JSYogaConfig::createStructure(init.vm, init.global, prototype);
    
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

void setupJSYogaNodeClassStructure(JSC::LazyClassStructure::Initializer& init)
{
    auto* prototypeStructure = JSYogaNodePrototype::createStructure(init.vm, init.global, init.global->objectPrototype());
    auto* prototype = JSYogaNodePrototype::create(init.vm, init.global, prototypeStructure);

    auto* constructorStructure = JSYogaNodeConstructor::createStructure(init.vm, init.global, init.global->functionPrototype());
    auto* constructor = JSYogaNodeConstructor::create(init.vm, constructorStructure, prototype);

    auto* structure = JSYogaNode::createStructure(init.vm, init.global, prototype);
    
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

} // namespace Bun
