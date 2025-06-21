#include "root.h"
#include "JSYogaConfig.h"
#include "JSYogaNode.h"
#include "JSYogaPrototype.h"
#include "JSYogaConstructor.h"
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include "ZigGlobalObject.h"

namespace Bun {

// ================ JSYogaConfig Constructor ================

const JSC::ClassInfo JSYogaConfigConstructor::s_info = { "ConfigConstructor"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSYogaConfigConstructor) };

void JSYogaConfigConstructor::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSObject* prototype)
{
    Base::finishCreation(vm, 0, "Config"_s);
    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
}

JSC_DEFINE_HOST_FUNCTION(constructJSYogaConfig, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto* zigGlobal = Bun::defaultGlobalObject(globalObject);
    
    // Get the pre-initialized structure from the global object
    JSC::Structure* structure = zigGlobal->m_JSYogaConfigClassStructure.get(zigGlobal);
    
    // Create new Config instance
    return JSC::JSValue::encode(JSYogaConfig::create(vm, structure));
}

// ================ JSYogaNode Constructor ================

const JSC::ClassInfo JSYogaNodeConstructor::s_info = { "NodeConstructor"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSYogaNodeConstructor) };

void JSYogaNodeConstructor::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSObject* prototype)
{
    Base::finishCreation(vm, 1, "Node"_s);
    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
}

JSC_DEFINE_HOST_FUNCTION(constructJSYogaNode, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* zigGlobal = Bun::defaultGlobalObject(globalObject);
    
    // Get the pre-initialized structure from the global object
    JSC::Structure* structure = zigGlobal->m_JSYogaNodeClassStructure.get(zigGlobal);
    
    // Check if a config was provided as the first argument
    YGConfigRef config = nullptr;
    if (callFrame->argumentCount() > 0) {
        JSC::JSValue configValue = callFrame->argument(0);
        if (!configValue.isUndefinedOrNull()) {
            auto* configObject = jsDynamicCast<JSYogaConfig*>(configValue);
            if (UNLIKELY(!configObject)) {
                return JSC::JSValue::encode(throwTypeError(globalObject, scope, "First argument must be a Yoga.Config instance"_s));
            }
            config = configObject->internal();
        }
    }
    
    // Create new Node instance
    return JSC::JSValue::encode(JSYogaNode::create(vm, structure, config));
}

// ================ Setup Functions ================

void setupJSYogaConfigClassStructure(JSC::LazyClassStructure::Initializer& init)
{
    auto* prototypeStructure = JSYogaConfigPrototype::createStructure(init.vm, init.global, init.global->objectPrototype());
    auto* prototype = JSYogaConfigPrototype::create(init.vm, init.global, prototypeStructure);
    
    auto* constructorStructure = JSYogaConfigConstructor::createStructure(init.vm, init.global, init.global->functionPrototype());
    auto* constructor = JSYogaConfigConstructor::create(init.vm, init.global, constructorStructure, prototype);
    
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
    auto* constructor = JSYogaNodeConstructor::create(init.vm, init.global, constructorStructure, prototype);
    
    auto* structure = JSYogaNode::createStructure(init.vm, init.global, prototype);
    
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

} // namespace Bun