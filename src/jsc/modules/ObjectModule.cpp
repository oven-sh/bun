#include "ObjectModule.h"

#include "../bindings/JSCommonJSModule.h"
#include <JavaScriptCore/InternalFieldTuple.h>
#include <JavaScriptCore/JSMapInlines.h>
#include <JavaScriptCore/JSSourceCode.h>
#include <JavaScriptCore/WeakHandleOwner.h>
#include <JavaScriptCore/WeakInlines.h>
#include <wtf/NeverDestroyed.h>

namespace Zig {

class SyntheticSourceOwner final : public JSC::WeakHandleOwner {
public:
    bool isReachableFromOpaqueRoots(JSC::Handle<JSC::Unknown>, void* sourceCode, JSC::AbstractSlotVisitor& visitor, ASCIILiteral* reason) final
    {
        if (reason) [[unlikely]]
            *reason = "JSSourceCode is alive"_s;
        return visitor.isMarked(sourceCode);
    }
};

JSC::JSSourceCode* createSyntheticSourceCode(JSC::VM& vm, JSC::JSValue source, SyntheticModuleGenerator generator, const WTF::String& moduleKey, bool hasLiveExports)
{
    static NeverDestroyed<SyntheticSourceOwner> owner;
    JSC::EnsureStillAliveScope stillAlive(source);

    auto handle = makeUniqueRefWithoutFastMallocCheck<JSC::Weak<JSC::JSCell>>();
    JSC::Weak<JSC::JSCell>& weak = handle.get();
    Ref provider = JSC::SyntheticSourceProvider::createWithLazyExports(
        [source, generator, handle = WTF::move(handle)](JSC::JSGlobalObject* globalObject, JSC::Identifier moduleKey, Vector<JSC::Identifier, 4>& exportNames, JSC::MarkedArgumentBuffer& exportValues) -> JSC::JSObject* {
            RELEASE_ASSERT(!source.isCell() || handle->get() == source.asCell());
            return generator(source, globalObject, moduleKey, exportNames, exportValues);
        },
        JSC::SourceOrigin(), moduleKey);
    if (hasLiveExports)
        provider->setModuleHasLiveExports();

    auto* sourceCode = JSC::JSSourceCode::create(vm, JSC::SourceCode(WTF::move(provider)));
    // `sourceCode` is the provider's only owner, so its destructor destroys this Weak before the cell's memory is reused.
    // That wouldn't hold for createDeferred(): SyntheticModuleRecord keeps that provider.
    if (source.isCell())
        weak = JSC::Weak<JSC::JSCell>(source.asCell(), &owner.get(), sourceCode);
    return sourceCode;
}

JSC::JSSourceCode* createObjectModuleSourceCode(JSC::VM& vm, JSC::JSObject* object, const WTF::String& moduleKey)
{
    return createSyntheticSourceCode(vm, object, [](JSC::JSValue source, JSC::JSGlobalObject* lexicalGlobalObject, const JSC::Identifier&, Vector<JSC::Identifier, 4>& exportNames, JSC::MarkedArgumentBuffer& exportValues) -> JSC::JSObject* {
        auto& vm = JSC::getVM(lexicalGlobalObject);
        auto throwScope = DECLARE_THROW_SCOPE(vm);
        GlobalObject* globalObject = defaultGlobalObject(lexicalGlobalObject);
        JSC::JSObject* object = source.getObject();

        PropertyNameArrayBuilder properties(vm, PropertyNameMode::Strings,
            PrivateSymbolMode::Exclude);
        object->methodTable()->getOwnPropertyNames(object, globalObject, properties, DontEnumPropertiesMode::Exclude);
        RETURN_IF_EXCEPTION(throwScope, nullptr);

        for (auto& entry : properties.releaseData()->propertyNameVector()) {
            JSValue value = object->get(globalObject, entry);
            RETURN_IF_EXCEPTION(throwScope, nullptr);
            exportNames.append(entry);
            exportValues.append(value);
        }
        return nullptr; }, moduleKey);
}

static JSC::JSObject* generateDefaultExport(JSC::JSValue value, JSC::JSGlobalObject* globalObject, const JSC::Identifier&, Vector<JSC::Identifier, 4>& exportNames, JSC::MarkedArgumentBuffer& exportValues)
{
    auto& vm = JSC::getVM(globalObject);
    exportNames.append(vm.propertyNames->defaultKeyword);
    exportValues.append(value);
    exportNames.append(vm.propertyNames->__esModule);
    exportValues.append(jsBoolean(true));
    return nullptr;
}

template<NamedExports namedExports>
static JSC::JSObject* generateDataModule(JSC::JSValue source, JSC::JSGlobalObject* globalObject, const JSC::Identifier& moduleKey, Vector<JSC::Identifier, 4>& exportNames, JSC::MarkedArgumentBuffer& exportValues)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* fields = uncheckedDowncast<JSC::InternalFieldTuple>(source);
    JSValue parsed = fields->getInternalField(0);

    JSValue required;
    if (auto* requireMap = dynamicDowncast<JSC::JSMap>(fields->getInternalField(1))) {
        JSValue entry = requireMap->get(globalObject, jsString(vm, moduleKey.string()));
        RETURN_IF_EXCEPTION(scope, nullptr);
        if (auto* module = dynamicDowncast<Bun::JSCommonJSModule>(entry); module && module->hasEvaluated) {
            required = module->exportsObject();
            RETURN_IF_EXCEPTION(scope, nullptr);
        }
    }
    JSValue value = required ? required : parsed;
    if (namedExports == NamedExports::No || !parsed.isObject() || JSC::isJSArray(parsed))
        RELEASE_AND_RETURN(scope, generateDefaultExport(value, globalObject, moduleKey, exportNames, exportValues));

    JSC::JSObject* object = parsed.getObject();
    PropertyNameArrayBuilder properties(vm, PropertyNameMode::Strings,
        PrivateSymbolMode::Exclude);
    object->getPropertyNames(globalObject, properties, DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(scope, nullptr);

    exportNames.append(vm.propertyNames->defaultKeyword);
    exportValues.append(value);

    for (auto& entry : properties) {
        if (entry == vm.propertyNames->defaultKeyword) {
            continue;
        }

        exportNames.append(entry);

        JSValue member = object->get(globalObject, entry);
        RETURN_IF_EXCEPTION(scope, nullptr);
        // The names hold what the file says, as if the import had come first.
        if (required && required.isObject() && member.isObject()) [[unlikely]] {
            JSValue handedOut = required.get(globalObject, entry);
            RETURN_IF_EXCEPTION(scope, nullptr);
            if (handedOut.isObject())
                member = handedOut;
        }
        exportValues.append(member);
    }
    return nullptr;
}

JSC::JSSourceCode* createDataModuleSourceCode(GlobalObject* globalObject, JSC::JSValue value, NamedExports namedExports, JSC::JSMap* requireMap, const WTF::String& moduleKey)
{
    auto& vm = globalObject->vm();
    auto* source = JSC::InternalFieldTuple::create(vm, globalObject->internalFieldTupleStructure(), value, requireMap ? JSValue(requireMap) : jsUndefined());
    return createSyntheticSourceCode(vm, source, namedExports == NamedExports::No ? generateDataModule<NamedExports::No> : generateDataModule<NamedExports::OfObject>, moduleKey);
}

JSC::JSSourceCode* createJSValueExportDefaultObjectSourceCode(JSC::VM& vm, JSC::JSValue value, const WTF::String& moduleKey)
{
    return createSyntheticSourceCode(vm, value, generateDefaultExport, moduleKey);
}

JSC::JSSourceCode* createJSValueExportDefaultOnlySourceCode(GlobalObject* globalObject, JSC::JSValue value, WTF::String&& sourceURL)
{
    return createSyntheticSourceCode(globalObject->vm(), value, [](JSC::JSValue source, JSC::JSGlobalObject* globalObject, const JSC::Identifier&, Vector<JSC::Identifier, 4>& exportNames, JSC::MarkedArgumentBuffer& exportValues) -> JSC::JSObject* {
        exportNames.append(JSC::getVM(globalObject).propertyNames->defaultKeyword);
        exportValues.append(source);
        return nullptr; }, sourceURL);
}
} // namespace Zig
