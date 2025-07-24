#include "root.h"
#include "JSYogaModule.h"
#include "JSYogaConstants.h"
#include "JSYogaConstructor.h"
#include "JSYogaPrototype.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSCInlines.h>

namespace Bun {

const JSC::ClassInfo JSYogaModule::s_info = { "Yoga"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSYogaModule) };

JSYogaModule* JSYogaModule::create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
{
    JSYogaModule* module = new (NotNull, allocateCell<JSYogaModule>(vm)) JSYogaModule(vm, structure);
    module->finishCreation(vm, globalObject);
    return module;
}

void JSYogaModule::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);

    // Create Config constructor and prototype
    auto* configPrototype = JSYogaConfigPrototype::create(vm, globalObject,
        JSYogaConfigPrototype::createStructure(vm, globalObject, globalObject->objectPrototype()));

    auto* configConstructor = JSYogaConfigConstructor::create(vm,
        JSYogaConfigConstructor::createStructure(vm, globalObject, globalObject->functionPrototype()),
        configPrototype);

    // Create Node constructor and prototype
    auto* nodePrototype = JSYogaNodePrototype::create(vm, globalObject,
        JSYogaNodePrototype::createStructure(vm, globalObject, globalObject->objectPrototype()));

    auto* nodeConstructor = JSYogaNodeConstructor::create(vm,
        JSYogaNodeConstructor::createStructure(vm, globalObject, globalObject->functionPrototype()),
        nodePrototype);

    // Add constructors to module
    putDirect(vm, vm.propertyNames->Config, configConstructor, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
    putDirect(vm, JSC::Identifier::fromString(vm, "Node"_s), nodeConstructor, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);

    // Add all constants directly to the Yoga object
    auto* constants = JSYogaConstants::create(vm, JSYogaConstants::createStructure(vm, globalObject, JSC::jsNull()));

    // Copy all properties from constants object to this module
    JSC::PropertyNameArray properties(vm, JSC::PropertyNameMode::StringsAndSymbols, JSC::PrivateSymbolMode::Exclude);
    constants->getPropertyNames(globalObject, properties, JSC::DontEnumPropertiesMode::Exclude);

    for (const auto& propertyName : properties) {
        JSC::PropertySlot slot(constants, JSC::PropertySlot::InternalMethodType::Get);
        if (constants->getPropertySlot(globalObject, propertyName, slot)) {
            putDirect(vm, propertyName, slot.getValue(globalObject, propertyName), JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
        }
    }
}

// Export function for Zig integration
extern "C" JSC::EncodedJSValue Bun__createYogaModule(Zig::GlobalObject* globalObject)
{
    JSC::VM& vm = globalObject->vm();
    auto* structure = JSYogaModule::createStructure(vm, globalObject, globalObject->objectPrototype());
    auto* module = JSYogaModule::create(vm, globalObject, structure);
    return JSC::JSValue::encode(module);
}

} // namespace Bun
