#pragma once

#include "root.h"
#include <JavaScriptCore/JSInternalFieldObjectImpl.h>
#include <JavaScriptCore/InternalFunction.h>
#include <JavaScriptCore/LazyClassStructure.h>

namespace Zig {
class GlobalObject;
}

namespace JSC {
class JSModuleLoader;
class JSPromise;
}

namespace Bun {

class JSModuleGraph;

// Bun.unsafe.ModuleGraph — further instantiations of ES module graphs in THIS
// global object: a JSC module loader of its own whose module scope holds the
// host's `globals` for the graph. Records of the same module in different graphs
// share executables (CodeBlocks, JIT code); each graph has its own module state,
// CommonJS require cache and import() / require routing. See ModuleGraph.cpp.
JSModuleGraph* moduleGraphForLoader(JSC::JSGlobalObject*, JSC::JSModuleLoader*);
// Rejections of promises by graph code, for attributing unhandled ones (onError).
void moduleGraphNoteRejection(Zig::GlobalObject*, JSC::JSPromise*);

class JSModuleGraph final : public JSC::JSInternalFieldObjectImpl<7> {
public:
    using Base = JSC::JSInternalFieldObjectImpl<7>;
    enum class Field : unsigned {
        Loader = 0, // JSModuleLoader: the graph's module loader (registry); null once disposed
        Overlay, // JSLexicalEnvironment: the loader's module scope, holding the graph's `globals`
        RequireMap, // JSMap: this graph's CommonJS require cache
        RequireCache, // lazily created require.cache proxy over RequireMap
        OnError, // host callback for uncaught errors / unhandled rejections of the graph's code
        MainPath, // resolved path of the first module import()ed (import.meta.main)
        PendingImports, // JSArray: promises returned by import() that may still be pending; rejected by dispose()
    };

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm);
    static JSModuleGraph* create(JSC::VM&, JSC::Structure*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);
    DECLARE_EXPORT_INFO;
    DECLARE_VISIT_CHILDREN;

    JSC::JSValue field(Field f) const { return internalField(static_cast<unsigned>(f)).get(); }
    void setField(JSC::VM& vm, Field f, JSC::JSValue v) { internalField(static_cast<unsigned>(f)).set(vm, this, v); }
    JSC::JSModuleLoader* loader() const; // null once disposed
    bool disposed() const { return !loader(); }
    JSC::JSScope* overlay() const;
    JSC::JSMap* requireMap() const;

private:
    JSModuleGraph(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }
    void finishCreation(JSC::VM&);
};

void initJSModuleGraphClassStructure(JSC::LazyClassStructure::Initializer& init);

} // namespace Bun
