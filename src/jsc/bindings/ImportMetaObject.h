#pragma once

#include "root.h"

#include <wtf/URL.h>

#include "BunBuiltinNames.h"
#include "BunClientData.h"
#include "ZigGlobalObject.h"

#include "JSDOMWrapperCache.h"

extern "C" JSC_DECLARE_HOST_FUNCTION(functionImportMeta__resolveSync);
extern "C" JSC_DECLARE_HOST_FUNCTION(functionImportMeta__resolveSyncPrivate);
extern "C" JSC::EncodedJSValue Bun__resolveSync(JSC::JSGlobalObject* global, JSC::EncodedJSValue specifier, JSC::EncodedJSValue from, bool is_esm, bool isUserRequireResolve);
extern "C" JSC::EncodedJSValue Bun__resolveSyncWithPaths(JSC::JSGlobalObject* global, JSC::EncodedJSValue specifier, JSC::EncodedJSValue from, bool is_esm, bool isUserRequireResolve, const BunString* paths, size_t paths_len);
extern "C" JSC::EncodedJSValue Bun__resolveSyncWithSourceIfExists(JSC::JSGlobalObject* global, JSC::EncodedJSValue specifier, BunString* from, bool is_esm);
extern "C" JSC::EncodedJSValue Bun__resolveSyncWithStrings(JSC::JSGlobalObject* global, BunString* specifier, BunString* from, bool is_esm);

namespace Zig {

using namespace JSC;
using namespace WebCore;

class ImportMetaObject final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    static constexpr unsigned StructureFlags = Base::StructureFlags | OverridesGetPrototype;

    /// `key` is a module registry key or a CommonJS filename. For a file that is its absolute
    /// path as the resolver produced it, with the `?query` of the import (if any) appended, and
    /// that JSString becomes `import.meta.path` as is. Any other key (one with a query, a plugin's
    /// virtual module id, `data:`, `blob:`, `vm:module(n)`) goes through a `file:` URL round trip.
    ///
    /// Caveats of that format: the `?` is not a literal `?` in a file name but the start of
    /// the query string, and nothing is URL encoded despite that. So a module with a `?` in
    /// its file name cannot be represented. Fixing this means making the module resolver
    /// operate on URLs, see https://github.com/oven-sh/bun/issues/8640 and
    /// https://github.com/oven-sh/bun/pull/9399.
    static ImportMetaObject* create(JSC::JSGlobalObject* globalObject, JSValue key);
    static ImportMetaObject* create(JSC::JSGlobalObject* globalObject, JSString* key);

    /// For a module whose key is a URL and not a file path (`bake://server-runtime.js`).
    static ImportMetaObject* createFromURL(JSC::JSGlobalObject* globalObject, const WTF::URL& url);

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;

        return WebCore::subspaceForImpl<ImportMetaObject, UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForImportMeta, m_subspaceForImportMeta));
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, bool isBake = false);
    static void analyzeHeap(JSCell*, JSC::HeapAnalyzer&);
    static JSValue getPrototype(JSObject*, JSC::JSGlobalObject* globalObject);

    /// `import.meta.path`: the file system path of the module, without the query string.
    /// Never a rope. `url`, `dir`, `file` and `require` derive from it on first access.
    JSString* path() const { return m_path.get(); }

    LazyProperty<JSObject, JSCell> requireProperty;
    LazyProperty<JSObject, JSString> urlProperty;
    LazyProperty<JSObject, JSString> dirProperty;
    LazyProperty<JSObject, JSString> fileProperty;

private:
    /// `url` may be null, in which case it is `URL::fileURLWithFileSystemPath(path)` computed on first access.
    static ImportMetaObject* create(JSC::VM& vm, JSC::Structure* structure, JSString* path, JSString* url);

    ImportMetaObject(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM&, JSString* path, JSString* url);

    WriteBarrier<JSString> m_path;
};

// Swept without a destructor, so every member must be GC-managed or plain data.
static_assert(std::is_trivially_destructible_v<ImportMetaObject>);

}
