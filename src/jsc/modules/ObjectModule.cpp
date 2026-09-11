#include "ObjectModule.h"
#include <JavaScriptCore/JSONObject.h>
#include <JavaScriptCore/StrongInlines.h>

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

        for (auto& entry : properties.releaseData()->propertyNameVector()) {
            JSValue value = object->get(globalObject, entry);
            RETURN_IF_EXCEPTION(throwScope, void());
            exportNames.append(entry);
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
static void appendDataModuleExports(JSC::JSGlobalObject* globalObject, JSC::JSValue value, Vector<JSC::Identifier, 4>& exportNames, JSC::MarkedArgumentBuffer& exportValues)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    exportNames.append(vm.propertyNames->defaultKeyword);
    exportValues.append(value);
    JSC::JSObject* object = value.isObject() && !JSC::isJSArray(value) ? value.getObject() : nullptr;
    if (!object) {
        exportNames.append(vm.propertyNames->__esModule);
        exportValues.append(JSC::jsBoolean(true));
        return;
    }
    JSC::PropertyNameArrayBuilder properties(vm, JSC::PropertyNameMode::Strings, JSC::PrivateSymbolMode::Exclude);
    object->getPropertyNames(globalObject, properties, JSC::DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(scope, void());
    for (auto& entry : properties.releaseData()->propertyNameVector()) {
        if (entry == vm.propertyNames->defaultKeyword)
            continue;
        JSC::JSValue property = object->get(globalObject, entry);
        RETURN_IF_EXCEPTION(scope, void());
        exportNames.append(entry);
        exportValues.append(property);
    }
}

JSC::SyntheticSourceProvider::SyntheticSourceGenerator
generateDataModuleSourceCode(JSC::JSGlobalObject* globalObject,
    JSC::JSValue value)
{
    auto& vm = JSC::getVM(globalObject);
    return [value = JSC::Strong<JSC::Unknown>(vm, value), json = String(), first = true](JSC::JSGlobalObject* lexicalGlobalObject,
               JSC::Identifier,
               Vector<JSC::Identifier, 4>& exportNames,
               JSC::MarkedArgumentBuffer& exportValues) mutable -> void {
        auto& vm = JSC::getVM(lexicalGlobalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        JSC::JSValue current = value.get();
        // Snapshot before the value is first handed out (module code may
        // mutate it); every later generation (another graph) parses a fresh
        // copy from the snapshot. The source was JSON/TOML/JSONC, so the round
        // trip loses nothing.
        if (json.isNull()) {
            json = JSC::JSONStringify(lexicalGlobalObject, current, 0);
            RETURN_IF_EXCEPTION(scope, void());
        }
        if (!std::exchange(first, false) && !json.isNull()) {
            current = JSC::JSONParse(lexicalGlobalObject, json);
            RETURN_IF_EXCEPTION(scope, void());
            if (!current)
                current = value.get();
        }
        RELEASE_AND_RETURN(scope, appendDataModuleExports(lexicalGlobalObject, current, exportNames, exportValues));
    };
}
} // namespace Zig
