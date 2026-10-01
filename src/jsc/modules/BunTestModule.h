
namespace Zig {
void generateNativeModule_BunTest(
    JSC::JSGlobalObject* lexicalGlobalObject,
    JSC::Identifier moduleKey,
    Vector<JSC::Identifier, 4>& exportNames,
    JSC::MarkedArgumentBuffer& exportValues)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto globalObject = uncheckedDowncast<Zig::GlobalObject>(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSObject* object = globalObject->lazyTestModuleObject();
    RETURN_IF_EXCEPTION(scope, );

    // Export as default
    exportNames.append(vm.propertyNames->defaultKeyword);
    exportValues.append(object);

    // Also export all properties as named exports
    JSC::PropertyNameArrayBuilder properties(vm, JSC::PropertyNameMode::Strings, JSC::PrivateSymbolMode::Exclude);
    object->methodTable()->getOwnPropertyNames(object, lexicalGlobalObject, properties, JSC::DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(scope, );

    for (auto& property : properties.releaseData()->propertyNameVector()) {
        JSC::PropertySlot slot(object, JSC::PropertySlot::InternalMethodType::Get);
        auto ownPropertySlot = object->methodTable()->getOwnPropertySlot(object, lexicalGlobalObject, property, slot);
        RETURN_IF_EXCEPTION(scope, );
        if (ownPropertySlot) {
            JSValue value = slot.getValue(lexicalGlobalObject, property);
            RETURN_IF_EXCEPTION(scope, );
            exportNames.append(property);
            exportValues.append(value);
        }
    }
}

} // namespace Zig
