#pragma once

#include "root.h"

#include "BunBuiltinNames.h"
#include "BunClientData.h"
#include "ZigGlobalObject.h"

#include "JSDOMWrapperCache.h"

extern "C" JSC_DECLARE_HOST_FUNCTION(functionImportMeta__resolveSync);
extern "C" JSC_DECLARE_HOST_FUNCTION(functionImportMeta__resolveSyncPrivate);
extern "C" JSC::EncodedJSValue Bun__resolve(JSC::JSGlobalObject* global, JSC::EncodedJSValue specifier, JSC::EncodedJSValue from, bool is_esm);
extern "C" JSC::EncodedJSValue Bun__resolveSync(JSC::JSGlobalObject* global, JSC::EncodedJSValue specifier, JSC::EncodedJSValue from, bool is_esm);
extern "C" JSC::EncodedJSValue Bun__resolveSyncWithSource(JSC::JSGlobalObject* global, JSC::EncodedJSValue specifier, BunString* from, bool is_esm);

namespace Zig {

using namespace JSC;
using namespace WebCore;

JSC_DECLARE_CUSTOM_GETTER(jsRequireCacheGetter);
JSC_DECLARE_CUSTOM_SETTER(jsRequireCacheSetter);

class ImportMetaObject final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    static ImportMetaObject* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, const WTF::String& url);

    static JSC::JSObject* createRequireFunctionUnbound(JSC::VM& vm, JSGlobalObject* globalObject);
    static JSC::JSObject* createRequireResolveFunctionUnbound(JSC::VM& vm, JSGlobalObject* globalObject);
    static JSObject* createRequireFunction(VM& vm, JSGlobalObject* lexicalGlobalObject, const WTF::String& pathString);

    static ImportMetaObject* create(JSC::JSGlobalObject* globalObject, JSC::JSString* keyString);
    static ImportMetaObject* create(JSC::JSGlobalObject* globalObject, JSValue keyString);

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;

        return WebCore::subspaceForImpl<ImportMetaObject, UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForImportMeta.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForImportMeta = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForImportMeta.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForImportMeta = std::forward<decltype(space)>(space); });
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject);
    static void analyzeHeap(JSCell*, JSC::HeapAnalyzer&);

    WTF::String url;
    LazyProperty<JSObject, JSFunction> requireProperty;
    LazyProperty<JSObject, JSString> dirProperty;
    LazyProperty<JSObject, JSString> urlProperty;
    LazyProperty<JSObject, JSString> fileProperty;
    LazyProperty<JSObject, JSString> pathProperty;

private:
    ImportMetaObject(JSC::VM& vm, JSC::Structure* structure, const WTF::String& url)
        : Base(vm, structure)
        , url(url)
    {
    }

    void finishCreation(JSC::VM&);
};

}