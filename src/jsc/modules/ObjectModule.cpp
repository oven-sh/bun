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

        const JSC::Identifier moduleDotExports = JSC::Identifier::fromString(vm, "module.exports"_s);
        bool hasESModuleMarker = false;
        bool hasModuleDotExports = false;
        JSValue defaultValue;

        for (auto& entry : properties.releaseData()->propertyNameVector()) {
            exportNames.append(entry);

            auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
            JSValue value = object->get(globalObject, entry);
            if (scope.exception()) [[unlikely]] {
                (void)scope.tryClearException();
                value = jsUndefined();
            }
            exportValues.append(value);

            if (entry == vm.propertyNames->__esModule)
                hasESModuleMarker = value.toBoolean(globalObject);
            else if (entry == vm.propertyNames->defaultKeyword)
                defaultValue = value;
            else if (entry == moduleDotExports)
                hasModuleDotExports = true;
        }

        // Transpilers define __esModule with Object.defineProperty, which leaves it
        // non-enumerable and therefore absent from the loop above. Fall back to a lookup
        // so the marker is found wherever handleVirtualModuleResult would have found it.
        if (!hasESModuleMarker) {
            JSValue esModuleValue = object->getIfPropertyExists(globalObject, vm.propertyNames->__esModule);
            RETURN_IF_EXCEPTION(throwScope, void());
            if (esModuleValue)
                hasESModuleMarker = esModuleValue.toBoolean(globalObject);
        }
        if (hasESModuleMarker && !defaultValue) {
            defaultValue = object->getIfPropertyExists(globalObject, vm.propertyNames->defaultKeyword);
            RETURN_IF_EXCEPTION(throwScope, void());
        }

        // require() of this module unwraps `default` when __esModule is set (see the
        // commonJSModule branch of handleVirtualModuleResult). Publish it under the
        // name the CJS bridge reads so require() agrees whether or not import() ran
        // first and already populated the module registry.
        if (hasESModuleMarker && !hasModuleDotExports && defaultValue && !defaultValue.isUndefined()) {
            exportNames.append(moduleDotExports);
            exportValues.append(defaultValue);
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
