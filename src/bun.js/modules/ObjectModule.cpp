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

        PropertyNameArray properties(vm, PropertyNameMode::Strings,
            PrivateSymbolMode::Exclude);
        object->methodTable()->getOwnPropertyNames(object, globalObject, properties, DontEnumPropertiesMode::Exclude);
        RETURN_IF_EXCEPTION(throwScope, void());
        gcUnprotectNullTolerant(object);

        for (auto& entry : properties) {
            exportNames.append(entry);

            auto scope = DECLARE_CATCH_SCOPE(vm);
            JSValue value = object->get(globalObject, entry);
            if (scope.exception()) {
                scope.clearException();
                value = jsUndefined();
            }
            exportValues.append(value);
        }
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
        GlobalObject* globalObject = reinterpret_cast<GlobalObject*>(lexicalGlobalObject);
        JSC::EnsureStillAliveScope stillAlive(object);

        PropertyNameArray properties(vm, PropertyNameMode::Strings,
            PrivateSymbolMode::Exclude);
        object->getPropertyNames(globalObject, properties,
            DontEnumPropertiesMode::Exclude);
        gcUnprotectNullTolerant(object);

        for (auto& entry : properties) {
            if (entry == vm.propertyNames->defaultKeyword) {
                continue;
            }

            exportNames.append(entry);

            auto scope = DECLARE_CATCH_SCOPE(vm);
            JSValue value = object->get(globalObject, entry);
            if (scope.exception()) {
                scope.clearException();
                value = jsUndefined();
            }
            exportValues.append(value);
        }

        exportNames.append(vm.propertyNames->defaultKeyword);
        exportValues.append(object);
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
