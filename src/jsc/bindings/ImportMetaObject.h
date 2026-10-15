#pragma once

#include "root.h"

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

namespace Bun {
class JSModuleGraph;
}

namespace Zig {

using namespace JSC;
using namespace WebCore;

class ImportMetaObject final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;

    static constexpr unsigned StructureFlags = Base::StructureFlags | OverridesGetPrototype;

    static void destroy(JSC::JSCell* cell)
    {
        static_cast<ImportMetaObject*>(cell)->ImportMetaObject::~ImportMetaObject();
    }

    /// Must be called with a valid url string (for `import.meta.url`)
    static ImportMetaObject* create(JSC::JSGlobalObject* globalObject, const String& url);

    /// Creates an ImportMetaObject from a specifier or URL JSValue
    /// - URL object -> use that url
    /// - string -> see the below method for how the string is processed
    /// - other -> assertion failure
    static ImportMetaObject* create(JSC::JSGlobalObject* globalObject, JSValue specifierOrURL, JSC::SourceProvider* source);

    /// `specifier` is a module key, `<path>` or `<path>?<query>` (not URL encoded), and the URL of `source` (or null) is the `<path>` the module was read from.
    static ImportMetaObject* createFromSpecifier(JSC::JSGlobalObject* globalObject, const String& specifier, JSC::SourceProvider* source);

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

    WTF::String url;
    LazyProperty<JSObject, JSCell> requireProperty;
    LazyProperty<JSObject, JSString> dirProperty;
    LazyProperty<JSObject, JSString> urlProperty;
    LazyProperty<JSObject, JSString> fileProperty;
    LazyProperty<JSObject, JSString> pathProperty;

    // The Bun.ModuleGraph the module belongs to: import.meta.main is whether it is the
    // graph's first import, and import.meta.require requires into the graph. Null otherwise.
    Bun::JSModuleGraph* moduleGraph() const { return m_moduleGraph.get(); }
    void setModuleGraph(JSC::VM&, Bun::JSModuleGraph*);

private:
    static ImportMetaObject* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, const WTF::String& url);

    JSC::WriteBarrier<Bun::JSModuleGraph> m_moduleGraph;

    ImportMetaObject(JSC::VM& vm, JSC::Structure* structure, const WTF::String& url)
        : Base(vm, structure)
        , url(url)
    {
    }

    void finishCreation(JSC::VM&);
};

}
