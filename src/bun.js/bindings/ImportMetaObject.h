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
extern "C" JSC::EncodedJSValue Bun__resolveSyncWithStrings(JSC::JSGlobalObject* global, BunString* specifier, BunString* from, bool is_esm);

namespace Zig {

using namespace JSC;
using namespace WebCore;

class ImportMetaObject final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    /// Must be called with a valid url string (for `import.meta.url`)
    static ImportMetaObject* create(JSC::JSGlobalObject* globalObject, const String& url);

    /// Creates an ImportMetaObject from a specifier or URL JSValue
    /// - URL object -> use that url
    /// - string -> see the below method for how the string is processed
    /// - other -> assertion failure
    static ImportMetaObject* create(JSC::JSGlobalObject* globalObject, JSValue specifierOrURL);

    /// TODO(@paperdave):
    /// The rules for this function's input is a bit weird. `specifier` is an import path specifier aka a file path.
    ///
    /// - Should be an absolute path or name of a plugin module
    /// - A '?' is handled not as a literal '?' in a file, but rather as the query string
    /// - The string is not URL encoded, despite having a query string.
    ///
    /// caveat: It is impossible to have a module with a `?` in it's file name.
    ///
    /// Fixing this means adjusting a lot of how the module resolver works to operate and handle URL
    /// escaping, see https://github.com/oven-sh/bun/issues/8640 for more details.
    ///
    /// The above rules get a best estimate bandage to solve the problems
    /// stated in https://github.com/oven-sh/bun/pull/9399
    static ImportMetaObject* createFromSpecifier(JSC::JSGlobalObject* globalObject, const String& specifier);

    static ImportMetaObject* createRequireFunction(VM& vm, JSGlobalObject* lexicalGlobalObject, const WTF::String& pathString);

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
    static ImportMetaObject* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, const WTF::String& url);

    ImportMetaObject(JSC::VM& vm, JSC::Structure* structure, const WTF::String& url)
        : Base(vm, structure)
        , url(url)
    {
    }

    void finishCreation(JSC::VM&);
};

}
