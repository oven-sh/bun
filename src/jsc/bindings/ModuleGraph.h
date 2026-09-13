#pragma once

#include "root.h"
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/LazyClassStructure.h>
#include <JavaScriptCore/SymbolTable.h>
#include <JavaScriptCore/WeakGCMap.h>
#include <JavaScriptCore/WriteBarrier.h>
#include <JavaScriptCore/JSDestructibleObject.h>
#include "ScriptExecutionContext.h"

namespace Zig {
class GlobalObject;
}

namespace JSC {
class JSFunction;
class JSLexicalEnvironment;
class JSModuleLoader;
class JSPromise;
class JSSet;
class ThrowScope;
}

namespace Bun {

class JSModuleGraph;

// Bun.unsafe.ModuleGraph: a further instantiation of ES module graphs in this global
// object — a JSC module loader whose module scope (the "overlay") holds the host's
// `globals` for the graph.
JSModuleGraph* moduleGraphForLoader(JSC::JSGlobalObject*, JSC::JSModuleLoader*);
// Whether `loader` belongs to a disposed graph; the throwing form throws ERR_INVALID_STATE then.
bool isDisposedModuleGraphLoader(JSC::JSGlobalObject*, JSC::JSModuleLoader*);
bool throwIfModuleGraphDisposed(JSC::JSGlobalObject*, JSC::ThrowScope&, JSC::JSModuleLoader*);
// The loader whose instances of ES modules a require() bound to `graph` returns: the graph's,
// or the global object's for null. Throws ERR_INVALID_STATE (nullptr) once the graph is disposed.
JSC::JSModuleLoader* moduleLoaderForRequire(JSC::JSGlobalObject*, JSC::ThrowScope&, JSModuleGraph*);
// promiseRejectionTracker: the graph whose module code is rejecting `promise` right now,
// or null (the global object's code, or no graph exists).
JSModuleGraph* moduleGraphRejecting(Zig::GlobalObject*, JSC::JSPromise*);
void initJSModuleGraphClassStructure(JSC::LazyClassStructure::Initializer&);
// The innermost graph with a context of its own (`isolateIO`) that the current async context
// is inside of: what script opens now belongs to that graph's context. Null: the global's.
JSModuleGraph* currentModuleGraph(Zig::GlobalObject*);

// What runs while this is alive runs inside a graph's context: an async context frame naming
// the graph is current, and every continuation captured meanwhile (promise reactions, timers,
// socket handlers) carries it. Nothing for a null graph, a graph without a context of its
// own, or when already inside it.
class ModuleGraphContextScope {
    WTF_MAKE_NONCOPYABLE(ModuleGraphContextScope);
    WTF_FORBID_HEAP_ALLOCATION;

public:
    ModuleGraphContextScope(Zig::GlobalObject*, JSModuleGraph*);
    // The graph `context` was made for, when it is a graph's and the graph is alive: an event
    // dispatched to something the graph's script made runs its listeners in the graph's context.
    ModuleGraphContextScope(WebCore::ScriptExecutionContext& context);
    ~ModuleGraphContextScope();

private:
    Zig::GlobalObject* m_globalObject { nullptr };
    JSC::JSValue m_previous;
};

class JSModuleGraph final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr JSC::DestructionMode needsDestruction = JSC::NeedsDestruction;
    static void destroy(JSC::JSCell*);

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm);
    static JSModuleGraph* create(JSC::VM&, JSC::Structure*, JSC::JSModuleLoader*, JSC::JSLexicalEnvironment* overlay, JSC::JSObject* onError);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);
    DECLARE_EXPORT_INFO;
    DECLARE_VISIT_CHILDREN;

    JSC::JSModuleLoader* loader() const { return m_loader.get(); } // null once disposed
    bool disposed() const { return !m_loader; }
    JSC::JSLexicalEnvironment* overlay() const { return m_overlay.get(); }
    JSC::JSObject* onError() const { return m_onError.get(); } // null if the host gave none
    JSC::JSValue mainPath() const { return m_mainPath ? JSC::JSValue(m_mainPath.get()) : JSC::jsUndefined(); } // key of the first module import()ed (import.meta.main)
    JSC::JSSet* pendingImports() const { return m_pendingImports.get(); } // promises import() returned that have not settled; dispose() rejects them
    JSC::JSFunction* importSettledHandler(bool rejected) const { return rejected ? m_importRejected.get() : m_importFulfilled.get(); }
    // The context that owns what the graph's script opens; null unless `isolateIO`.
    WebCore::ScriptExecutionContext* context() const { return m_context.get(); }
    void setContext(Ref<WebCore::ScriptExecutionContext>&& context) { m_context = WTF::move(context); }

    void setMainPath(JSC::VM& vm, JSC::JSString* path) { m_mainPath.set(vm, this, path); }
    void clearMainPath() { m_mainPath.clear(); }
    void setPendingImports(JSC::VM& vm, JSC::JSSet* pending) { m_pendingImports.setMayBeNull(vm, this, pending); }
    void setImportSettledHandlers(JSC::VM&, JSC::JSFunction* fulfilled, JSC::JSFunction* rejected);
    // dispose(): the loader goes; everything else stays for code of the graph that is still running.
    void clearLoader() { m_loader.clear(); }

private:
    JSModuleGraph(JSC::VM& vm, JSC::Structure* structure, JSC::JSModuleLoader*, JSC::JSLexicalEnvironment*, JSC::JSObject* onError);
    void finishCreation(JSC::VM&);

    JSC::WriteBarrier<JSC::JSModuleLoader> m_loader;
    JSC::WriteBarrier<JSC::JSLexicalEnvironment> m_overlay;
    JSC::WriteBarrier<JSC::JSObject> m_onError;
    JSC::WriteBarrier<JSC::JSString> m_mainPath;
    JSC::WriteBarrier<JSC::JSSet> m_pendingImports;
    JSC::WriteBarrier<JSC::JSFunction> m_importFulfilled;
    JSC::WriteBarrier<JSC::JSFunction> m_importRejected;
    RefPtr<WebCore::ScriptExecutionContext> m_context;
};

// Per-global state that is not a GC object (Zig::GlobalObject::m_moduleGraphs).
struct ModuleGraphState {
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED(ModuleGraphState);

public:
    explicit ModuleGraphState(JSC::VM& vm)
        : overlaySymbolTables(vm)
    {
    }
    // Sorted `globals` names -> the overlay SymbolTable that graphs with that name set share
    // (one set of module executables per shape); weak: alive while an overlay uses it.
    JSC::WeakGCMap<WTF::String, JSC::SymbolTable> overlaySymbolTables;
    // Set while a graph's onError runs: what it throws synchronously is the host's.
    bool inOnError { false };
    // Set while graph.import() / dispose() reject an import() promise: the caller's, not
    // the graph whose module threw.
    bool rejectingImport { false };
};

} // namespace Bun
