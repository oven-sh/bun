
namespace Zig {
void generateNativeModule_BunTest(
    JSC::JSGlobalObject* lexicalGlobalObject,
    JSC::Identifier moduleKey,
    Vector<JSC::Identifier, 4>& exportNames,
    JSC::MarkedArgumentBuffer& exportValues)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto catchScope = DECLARE_CATCH_SCOPE(vm);

    JSObject* object = globalObject->lazyTestModuleObject();

    // Export as default
    exportNames.append(vm.propertyNames->defaultKeyword);
    exportValues.append(object);

    // Also export all properties as named exports
    JSC::PropertyNameArray properties(vm, JSC::PropertyNameMode::Strings, JSC::PrivateSymbolMode::Exclude);
    object->methodTable()->getOwnPropertyNames(object, lexicalGlobalObject, properties, JSC::DontEnumPropertiesMode::Exclude);
    if (catchScope.exception()) [[unlikely]] {
        catchScope.clearException();
        return;
    }

    for (auto& property : properties) {
        JSC::PropertySlot slot(object, JSC::PropertySlot::InternalMethodType::Get);
        auto ownPropertySlot = object->methodTable()->getOwnPropertySlot(object, lexicalGlobalObject, property, slot);
        if (catchScope.exception()) [[unlikely]] {
            catchScope.clearException();
        }
        if (ownPropertySlot) {
            exportNames.append(property);
            exportValues.append(slot.getValue(lexicalGlobalObject, property));
        }
    }
}

} // namespace Zig
