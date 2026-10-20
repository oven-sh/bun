#include "ObjectModule.h"
#include <JavaScriptCore/JSSourceCode.h>
#include <JavaScriptCore/JSWeakMapInlines.h>

namespace Zig {
using SyntheticSourceGenerator = JSC::SyntheticSourceProvider::SyntheticSourceGenerator;

// `generator` points at `value`, where the collector cannot see it. A root would never go: the
// value reaches its own source through the module registry of its global object.
static JSC::JSSourceCode* createSourceCodeOfValue(GlobalObject* globalObject, JSC::JSValue value, SyntheticSourceGenerator&& generator, WTF::String&& sourceURL)
{
    auto& vm = JSC::getVM(globalObject);
    JSC::EnsureStillAliveScope stillAlive(value);
    auto* sourceCode = JSC::JSSourceCode::create(vm,
        JSC::SourceCode(JSC::SyntheticSourceProvider::create(WTF::move(generator), JSC::SourceOrigin(), WTF::move(sourceURL))));
    if (value.isCell())
        globalObject->objectModuleValues()->set(vm, sourceCode, value);
    return sourceCode;
}

JSC::JSSourceCode* createObjectModuleSourceCode(GlobalObject* globalObject, JSC::JSObject* object, WTF::String&& sourceURL)
{
    SyntheticSourceGenerator generator = [object](JSC::JSGlobalObject* lexicalGlobalObject,
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

        for (auto& entry : properties.releaseData()->propertyNameVector()) {
            JSValue value = object->get(globalObject, entry);
            RETURN_IF_EXCEPTION(throwScope, void());
            exportNames.append(entry);
            exportValues.append(value);
        }
    };
    return createSourceCodeOfValue(globalObject, object, WTF::move(generator), WTF::move(sourceURL));
}

static JSC::JSSourceCode* createObjectModuleSourceCodeForJSON(GlobalObject* globalObject, JSC::JSObject* object, WTF::String&& sourceURL)
{
    SyntheticSourceGenerator generator = [object](JSC::JSGlobalObject* lexicalGlobalObject,
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
    };
    return createSourceCodeOfValue(globalObject, object, WTF::move(generator), WTF::move(sourceURL));
}

JSC::JSSourceCode* createJSValueModuleSourceCode(GlobalObject* globalObject, JSC::JSValue value, WTF::String&& sourceURL)
{
    if (value.isObject() && !JSC::isJSArray(value))
        return createObjectModuleSourceCodeForJSON(globalObject, value.getObject(), WTF::move(sourceURL));

    return createJSValueExportDefaultObjectSourceCode(globalObject, value, WTF::move(sourceURL));
}

JSC::JSSourceCode* createJSValueExportDefaultObjectSourceCode(GlobalObject* globalObject, JSC::JSValue value, WTF::String&& sourceURL)
{
    SyntheticSourceGenerator generator = [value](JSC::JSGlobalObject* lexicalGlobalObject,
                                             JSC::Identifier moduleKey,
                                             Vector<JSC::Identifier, 4>& exportNames,
                                             JSC::MarkedArgumentBuffer& exportValues) -> void {
        auto& vm = JSC::getVM(lexicalGlobalObject);
        exportNames.append(vm.propertyNames->defaultKeyword);
        exportValues.append(value);
        const Identifier& esModuleMarker = vm.propertyNames->__esModule;
        exportNames.append(esModuleMarker);
        exportValues.append(jsBoolean(true));
    };
    return createSourceCodeOfValue(globalObject, value, WTF::move(generator), WTF::move(sourceURL));
}
} // namespace Zig
