#include "ObjectModule.h"

namespace Zig {

static void generateObjectModuleSourceCode(JSC::JSGlobalObject* lexicalGlobalObject,
    JSC::Identifier,
    JSC::JSValue payload,
    Vector<JSC::Identifier, 4>& exportNames,
    JSC::MarkedArgumentBuffer& exportValues)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    GlobalObject* globalObject = defaultGlobalObject(lexicalGlobalObject);
    JSC::JSObject* object = payload.getObject();
    JSC::EnsureStillAliveScope stillAlive(object);

    PropertyNameArrayBuilder properties(vm, PropertyNameMode::Strings,
        PrivateSymbolMode::Exclude);
    object->methodTable()->getOwnPropertyNames(object, globalObject, properties, DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(throwScope, void());

    for (auto& entry : properties.releaseData()->propertyNameVector()) {
        JSValue value = object->get(globalObject, entry);
        RETURN_IF_EXCEPTION(throwScope, void());
        exportNames.append(entry);
        exportValues.append(value);
    }
}

static void generateObjectModuleSourceCodeForJSON(JSC::JSGlobalObject* lexicalGlobalObject,
    JSC::Identifier,
    JSC::JSValue payload,
    Vector<JSC::Identifier, 4>& exportNames,
    JSC::MarkedArgumentBuffer& exportValues)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    GlobalObject* globalObject = reinterpret_cast<GlobalObject*>(lexicalGlobalObject);
    JSC::JSObject* object = payload.getObject();
    JSC::EnsureStillAliveScope stillAlive(object);

    PropertyNameArrayBuilder properties(vm, PropertyNameMode::Strings,
        PrivateSymbolMode::Exclude);
    object->getPropertyNames(globalObject, properties, DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(scope, void());

    exportNames.append(vm.propertyNames->defaultKeyword);
    exportValues.append(object);

    for (auto& entry : properties.releaseData()->propertyNameVector()) {
        if (entry == vm.propertyNames->defaultKeyword) {
            continue;
        }

        exportNames.append(entry);

        JSValue value = object->get(globalObject, entry);
        RETURN_IF_EXCEPTION(scope, void());
        exportValues.append(value);
    }
}

static void generateJSValueExportDefaultObjectSourceCode(JSC::JSGlobalObject* lexicalGlobalObject,
    JSC::Identifier,
    JSC::JSValue payload,
    Vector<JSC::Identifier, 4>& exportNames,
    JSC::MarkedArgumentBuffer& exportValues)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    exportNames.append(vm.propertyNames->defaultKeyword);
    exportValues.append(payload);
    const Identifier& esModuleMarker = vm.propertyNames->__esModule;
    exportNames.append(esModuleMarker);
    exportValues.append(jsBoolean(true));
}

JSC::JSSourceCode* createObjectModuleSourceCode(JSC::VM& vm, JSC::JSObject* exports, WTF::String&& sourceURL)
{
    return JSC::JSSourceCode::createWithPayload(vm, generateObjectModuleSourceCode, exports, JSC::SourceOrigin(), WTF::move(sourceURL));
}

JSC::JSSourceCode* createJSValueModuleSourceCode(JSC::VM& vm, JSC::JSValue value, WTF::String&& sourceURL)
{
    if (value.isObject() && !JSC::isJSArray(value))
        return JSC::JSSourceCode::createWithPayload(vm, generateObjectModuleSourceCodeForJSON, value, JSC::SourceOrigin(), WTF::move(sourceURL));

    return createJSValueExportDefaultObjectSourceCode(vm, value, WTF::move(sourceURL));
}

JSC::JSSourceCode* createJSValueExportDefaultObjectSourceCode(JSC::VM& vm, JSC::JSValue value, WTF::String&& sourceURL)
{
    return JSC::JSSourceCode::createWithPayload(vm, generateJSValueExportDefaultObjectSourceCode, value, JSC::SourceOrigin(), WTF::move(sourceURL));
}

} // namespace Zig
