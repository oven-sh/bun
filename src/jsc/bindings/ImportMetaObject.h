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
    /// `graph` is the Bun.unsafe.ModuleGraph the module belongs to, or nullptr for the global object's own loader.
    static ImportMetaObject* create(JSC::JSGlobalObject* globalObject, const String& url, Bun::JSModuleGraph* graph = nullptr);

    /// Creates an ImportMetaObject from a specifier or URL JSValue
    /// - URL object -> use that url
    /// - string -> see the below method for how the string is processed
    /// - other -> assertion failure
    static ImportMetaObject* create(JSC::JSGlobalObject* globalObject, JSValue specifierOrURL, Bun::JSModuleGraph* graph = nullptr);

    /// TODO:
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
    static ImportMetaObject* createFromSpecifier(JSC::JSGlobalObject* globalObject, const String& specifier, Bun::JSModuleGraph* graph = nullptr);

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

    Bun::JSModuleGraph* graph() const { return m_graph.get(); }

    WTF::String url;
    LazyProperty<JSObject, JSCell> requireProperty;
    LazyProperty<JSObject, JSString> dirProperty;
    LazyProperty<JSObject, JSString> urlProperty;
    LazyProperty<JSObject, JSString> fileProperty;
    LazyProperty<JSObject, JSString> pathProperty;

private:
    static ImportMetaObject* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, const WTF::String& url, Bun::JSModuleGraph* graph);

    ImportMetaObject(JSC::VM& vm, JSC::Structure* structure, const WTF::String& url, Bun::JSModuleGraph* graph)
        : Base(vm, structure)
        , url(url)
        , m_graph(graph, JSC::WriteBarrierEarlyInit)
    {
    }

    JSC::WriteBarrier<Bun::JSModuleGraph> m_graph;

    void finishCreation(JSC::VM&);
};

}
