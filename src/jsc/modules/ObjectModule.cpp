#include "ObjectModule.h"

namespace Zig {
JSC::SyntheticSourceProvider::SyntheticSourceGenerator
generateObjectModuleSourceCode(JSC::JSGlobalObject* globalObject,
    JSC::JSObject* object)
{
    gcProtectNullTolerant(object);
    return [object](JSC::JSGlobalObject* lexicalGlobalObject,
               JSC::Identifier moduleKey,
               Vector<JSC::Identifier, 4>& exportNames,
               JSC::MarkedArgumentBuffer& exportValues) -> void {
        auto& vm = JSC::getVM(lexicalGlobalObject);
        auto throwScope = DECLARE_THROW_SCOPE(vm);
        GlobalObject* globalObject = defaultGlobalObject(lexicalGlobalObject);
        JSC::EnsureStillAliveScope stillAlive(object);

        PropertyNameArrayBuilder properties(vm, PropertyNameMode::Strings,
            PrivateSymbolMode::Exclude);
        object->methodTable()->getOwnPropertyNames(object, globalObject, properties, DontEnumPropertiesMode::Exclude);
        RETURN_IF_EXCEPTION(throwScope, void());
        gcUnprotectNullTolerant(object);

        bool hasAccessor = false;
        for (auto& entry : properties.releaseData()->propertyNameVector()) {
            exportNames.append(entry);

            auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
            PropertySlot slot(object, PropertySlot::InternalMethodType::GetOwnProperty);
            bool has = object->methodTable()->getOwnPropertySlot(object, globalObject, entry, slot);
            if (scope.exception()) [[unlikely]] {
                (void)scope.tryClearException();
                exportValues.append(jsUndefined());
                continue;
            }
            if (has && slot.isAccessor())
                hasAccessor = true;
            JSValue value = has ? slot.getValue(globalObject, entry) : object->get(globalObject, entry);
            if (scope.exception()) [[unlikely]] {
                (void)scope.tryClearException();
                value = jsUndefined();
            }
            exportValues.append(value);
        }

        // When the factory object exposes accessor exports, pass the object as a
        // trailing value (no matching name) so SyntheticModuleRecord can back the
        // namespace with it and keep reads live. The environment slots still hold
        // the snapshots above for static `import { x }` consumers.
        if (hasAccessor)
            exportValues.append(object);
    };
}

JSC::SyntheticSourceProvider::SyntheticSourceGenerator
generateObjectModuleSourceCodeForJSON(JSC::JSGlobalObject* globalObject,
    JSC::JSObject* object)
{
    gcProtectNullTolerant(object);
    return [object](JSC::JSGlobalObject* lexicalGlobalObject,
               JSC::Identifier moduleKey,
               Vector<JSC::Identifier, 4>& exportNames,
               JSC::MarkedArgumentBuffer& exportValues) -> void {
        auto& vm = JSC::getVM(lexicalGlobalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        GlobalObject* globalObject = reinterpret_cast<GlobalObject*>(lexicalGlobalObject);
        JSC::EnsureStillAliveScope stillAlive(object);

        PropertyNameArrayBuilder properties(vm, PropertyNameMode::Strings,
            PrivateSymbolMode::Exclude);
        object->getPropertyNames(globalObject, properties, DontEnumPropertiesMode::Exclude);
        RETURN_IF_EXCEPTION(scope, {});
        gcUnprotectNullTolerant(object);

        exportNames.append(vm.propertyNames->defaultKeyword);
        exportValues.append(object);

        for (auto& entry : properties.releaseData()->propertyNameVector()) {
            if (entry == vm.propertyNames->defaultKeyword) {
                continue;
            }

            exportNames.append(entry);

            JSValue value = object->get(globalObject, entry);
            RETURN_IF_EXCEPTION(scope, {});
            exportValues.append(value);
        }
    };
}

JSC::SyntheticSourceProvider::SyntheticSourceGenerator
generateJSValueModuleSourceCode(JSC::JSGlobalObject* globalObject,
    JSC::JSValue value)
{

    if (value.isObject() && !JSC::isJSArray(value)) {
        return generateObjectModuleSourceCodeForJSON(globalObject,
            value.getObject());
    }

    return generateJSValueExportDefaultObjectSourceCode(globalObject, value);
}

JSC::SyntheticSourceProvider::SyntheticSourceGenerator
generateJSValueExportDefaultObjectSourceCode(JSC::JSGlobalObject* globalObject,
    JSC::JSValue value)
{
    if (value.isCell())
        gcProtectNullTolerant(value.asCell());
    return [value](JSC::JSGlobalObject* lexicalGlobalObject,
               JSC::Identifier moduleKey,
               Vector<JSC::Identifier, 4>& exportNames,
               JSC::MarkedArgumentBuffer& exportValues) -> void {
        auto& vm = JSC::getVM(lexicalGlobalObject);
        exportNames.append(vm.propertyNames->defaultKeyword);
        exportValues.append(value);
        const Identifier& esModuleMarker = vm.propertyNames->__esModule;
        exportNames.append(esModuleMarker);
        exportValues.append(jsBoolean(true));

        if (value.isCell())
            gcUnprotectNullTolerant(value.asCell());
    };
}
} // namespace Zig
