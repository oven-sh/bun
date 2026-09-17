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

    /// `key` is a module registry key or a CommonJS filename. A `?` in it starts the import's query string (#8640).
    static ImportMetaObject* create(JSC::JSGlobalObject* globalObject, JSValue key);
    static ImportMetaObject* create(JSC::JSGlobalObject* globalObject, JSString* key);
    /// For a key that is a URL and not a path (`bake://server-runtime.js`).
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

    /// `import.meta.path`. Never a rope.
    JSString* path() const { return m_path.get(); }

    LazyProperty<JSObject, JSCell> requireProperty;
    LazyProperty<JSObject, JSString> urlProperty;
    LazyProperty<JSObject, JSString> dirProperty;
    LazyProperty<JSObject, JSString> fileProperty;

private:
    /// A null `url` means `URL::fileURLWithFileSystemPath(path)`, computed on first access.
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
