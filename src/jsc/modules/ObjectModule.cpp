#include "ObjectModule.h"
#include <JavaScriptCore/InternalFieldTuple.h>
#include <JavaScriptCore/JSWeakMapInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>

namespace Zig {

// `generator` references `value` without rooting it. A root would leak the realm, because the value can reach the
// module registry, which references the source. The weak map keeps the value alive only as long as the source.
static JSC::JSSourceCode* createSourceCode(GlobalObject* globalObject, JSC::JSValue value, JSC::SyntheticSourceProvider::SyntheticSourceGenerator&& generator, WTF::String&& sourceURL)
{
    auto& vm = JSC::getVM(globalObject);
    auto* sourceCode = JSC::JSSourceCode::create(vm,
        JSC::SourceCode(JSC::SyntheticSourceProvider::create(WTF::move(generator), JSC::SourceOrigin(), WTF::move(sourceURL))));
    if (value.isCell())
        globalObject->moduleSourceValueMap()->set(vm, sourceCode, value);
    return sourceCode;
}

JSC::JSSourceCode* createObjectModuleSourceCode(GlobalObject* globalObject, JSC::JSObject* object, WTF::String&& sourceURL)
{
    JSC::SyntheticSourceProvider::SyntheticSourceGenerator generator = [object](JSC::JSGlobalObject* lexicalGlobalObject, JSC::Identifier moduleKey, Vector<JSC::Identifier, 4>& exportNames, JSC::MarkedArgumentBuffer& exportValues) -> void {
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
    return createSourceCode(globalObject, object, WTF::move(generator), WTF::move(sourceURL));
}

static JSC::JSSourceCode* createObjectModuleSourceCodeForJSON(GlobalObject* globalObject, JSC::JSObject* object, WTF::String&& sourceURL)
{
    JSC::SyntheticSourceProvider::SyntheticSourceGenerator generator = [object](JSC::JSGlobalObject* lexicalGlobalObject, JSC::Identifier moduleKey, Vector<JSC::Identifier, 4>& exportNames, JSC::MarkedArgumentBuffer& exportValues) -> void {
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
    return createSourceCode(globalObject, object, WTF::move(generator), WTF::move(sourceURL));
}

JSC::JSSourceCode* createJSValueModuleSourceCode(GlobalObject* globalObject, JSC::JSValue value, WTF::String&& sourceURL)
{
    if (value.isObject() && !JSC::isJSArray(value))
        return createObjectModuleSourceCodeForJSON(globalObject, value.getObject(), WTF::move(sourceURL));

    return createJSValueExportDefaultObjectSourceCode(globalObject, value, WTF::move(sourceURL));
}

JSC::JSSourceCode* createJSValueModuleSourceCode(GlobalObject* globalObject, JSC::JSValue value, JSC::JSValue file, WTF::String&& sourceURL)
{
    if (value == file)
        return createJSValueModuleSourceCode(globalObject, value, WTF::move(sourceURL));
    if (!file.isObject() || JSC::isJSArray(file))
        return createJSValueExportDefaultObjectSourceCode(globalObject, value, WTF::move(sourceURL));

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSArray* names = JSC::ownPropertyKeys(globalObject, file.getObject(), PropertyNameMode::Strings, DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(scope, nullptr);
    auto* exports = JSC::InternalFieldTuple::create(vm, globalObject->internalFieldTupleStructure(), value, names);

    JSC::SyntheticSourceProvider::SyntheticSourceGenerator generator = [exports](JSC::JSGlobalObject* lexicalGlobalObject, JSC::Identifier moduleKey, Vector<JSC::Identifier, 4>& exportNames, JSC::MarkedArgumentBuffer& exportValues) -> void {
        auto& vm = JSC::getVM(lexicalGlobalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        JSC::EnsureStillAliveScope stillAlive(exports);
        JSValue value = exports->getInternalField(0);
        auto* names = uncheckedDowncast<JSC::JSArray>(exports->getInternalField(1));

        exportNames.append(vm.propertyNames->defaultKeyword);
        exportValues.append(value);

        JSC::JSObject* object = value.getObject();
        for (unsigned i = 0, length = names->length(); i < length; i++) {
            JSValue key = names->getIndex(lexicalGlobalObject, i);
            RETURN_IF_EXCEPTION(scope, void());
            Identifier name = asString(key)->toIdentifier(lexicalGlobalObject);
            RETURN_IF_EXCEPTION(scope, void());
            if (name == vm.propertyNames->defaultKeyword)
                continue;

            JSValue property = object ? object->get(lexicalGlobalObject, name) : jsUndefined();
            RETURN_IF_EXCEPTION(scope, void());
            exportNames.append(name);
            exportValues.append(property);
        }
    };
    RELEASE_AND_RETURN(scope, createSourceCode(globalObject, exports, WTF::move(generator), WTF::move(sourceURL)));
}

JSC::JSSourceCode* createJSValueExportDefaultObjectSourceCode(GlobalObject* globalObject, JSC::JSValue value, WTF::String&& sourceURL)
{
    JSC::SyntheticSourceProvider::SyntheticSourceGenerator generator = [value](JSC::JSGlobalObject* lexicalGlobalObject, JSC::Identifier moduleKey, Vector<JSC::Identifier, 4>& exportNames, JSC::MarkedArgumentBuffer& exportValues) -> void {
        auto& vm = JSC::getVM(lexicalGlobalObject);
        exportNames.append(vm.propertyNames->defaultKeyword);
        exportValues.append(value);
        const Identifier& esModuleMarker = vm.propertyNames->__esModule;
        exportNames.append(esModuleMarker);
        exportValues.append(jsBoolean(true));
    };
    return createSourceCode(globalObject, value, WTF::move(generator), WTF::move(sourceURL));
}
} // namespace Zig
