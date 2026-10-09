#include "ObjectModule.h"

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
        [source, generator, handle = WTF::move(handle)](JSC::JSGlobalObject* globalObject, JSC::Identifier, Vector<JSC::Identifier, 4>& exportNames, JSC::MarkedArgumentBuffer& exportValues) -> JSC::JSObject* {
            RELEASE_ASSERT(!source.isCell() || handle->get() == source.asCell());
            return generator(source, globalObject, exportNames, exportValues);
        },
        JSC::SourceOrigin(), moduleKey);
    if (hasLiveExports)
        provider->setModuleHasLiveExports();

    auto* sourceCode = JSC::JSSourceCode::create(vm, JSC::SourceCode(WTF::move(provider)));
    if (source.isCell())
        weak = JSC::Weak<JSC::JSCell>(source.asCell(), &owner.get(), sourceCode);
    return sourceCode;
}

JSC::JSSourceCode* createObjectModuleSourceCode(JSC::VM& vm, JSC::JSObject* object, const WTF::String& moduleKey)
{
    return createSyntheticSourceCode(vm, object, [](JSC::JSValue source, JSC::JSGlobalObject* lexicalGlobalObject, Vector<JSC::Identifier, 4>& exportNames, JSC::MarkedArgumentBuffer& exportValues) -> JSC::JSObject* {
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

static JSC::JSSourceCode* createObjectModuleSourceCodeForJSON(JSC::VM& vm, JSC::JSObject* object, const WTF::String& moduleKey)
{
    return createSyntheticSourceCode(vm, object, [](JSC::JSValue source, JSC::JSGlobalObject* globalObject, Vector<JSC::Identifier, 4>& exportNames, JSC::MarkedArgumentBuffer& exportValues) -> JSC::JSObject* {
        auto& vm = JSC::getVM(globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        JSC::JSObject* object = source.getObject();

        PropertyNameArrayBuilder properties(vm, PropertyNameMode::Strings,
            PrivateSymbolMode::Exclude);
        object->getPropertyNames(globalObject, properties, DontEnumPropertiesMode::Exclude);
        RETURN_IF_EXCEPTION(scope, nullptr);

        exportNames.append(vm.propertyNames->defaultKeyword);
        exportValues.append(object);

        for (auto& entry : properties.releaseData()->propertyNameVector()) {
            if (entry == vm.propertyNames->defaultKeyword) {
                continue;
            }

            exportNames.append(entry);

            JSValue value = object->get(globalObject, entry);
            RETURN_IF_EXCEPTION(scope, nullptr);
            exportValues.append(value);
        }
        return nullptr; }, moduleKey);
}

JSC::JSSourceCode* createJSValueModuleSourceCode(JSC::VM& vm, JSC::JSValue value, const WTF::String& moduleKey)
{
    if (value.isObject() && !JSC::isJSArray(value))
        return createObjectModuleSourceCodeForJSON(vm, value.getObject(), moduleKey);
    return createJSValueExportDefaultObjectSourceCode(vm, value, moduleKey);
}

JSC::JSSourceCode* createJSValueExportDefaultObjectSourceCode(JSC::VM& vm, JSC::JSValue value, const WTF::String& moduleKey)
{
    return createSyntheticSourceCode(vm, value, [](JSC::JSValue source, JSC::JSGlobalObject* globalObject, Vector<JSC::Identifier, 4>& exportNames, JSC::MarkedArgumentBuffer& exportValues) -> JSC::JSObject* {
        auto& vm = JSC::getVM(globalObject);
        exportNames.append(vm.propertyNames->defaultKeyword);
        exportValues.append(source);
        exportNames.append(vm.propertyNames->__esModule);
        exportValues.append(jsBoolean(true));
        return nullptr; }, moduleKey);
}
} // namespace Zig
