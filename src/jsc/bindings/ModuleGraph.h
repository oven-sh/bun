#pragma once

#include "root.h"
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/LazyClassStructure.h>
#include <JavaScriptCore/SymbolTable.h>
#include <JavaScriptCore/WeakGCMap.h>
#include <JavaScriptCore/WriteBarrier.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/JSLexicalEnvironment.h>
#include <JavaScriptCore/JSMap.h>
#include <JavaScriptCore/JSModuleLoader.h>
#include <JavaScriptCore/JSSet.h>
#include "ScriptExecutionContext.h"

namespace Zig {
class GlobalObject;
}

namespace JSC {
class JSFunction;
class JSLexicalEnvironment;
class JSModuleLoader;
class JSPromise;
class JSMap;
class JSSet;
class ThrowScope;
}

namespace Bun {

class JSModuleGraph;
class JSIsolatedModuleGraph;

// Bun.unsafe.ModuleGraph: a further instantiation of ES module graphs in this global
// object — a JSC module loader whose module scope (the "overlay") holds the host's
// `globals` for the graph.
JSModuleGraph* moduleGraphForLoader(JSC::JSGlobalObject*, JSC::JSModuleLoader*);
JSC::JSObject* createModuleGraphDisposedError(JSC::JSGlobalObject*);
// Whether `loader` belongs to a disposed graph; the throwing form throws ERR_INVALID_STATE then.
bool isDisposedModuleGraphLoader(JSC::JSGlobalObject*, JSC::JSModuleLoader*);
bool throwIfModuleGraphDisposed(JSC::JSGlobalObject*, JSC::ThrowScope&, JSC::JSModuleLoader*);
// The loader whose instances of ES modules a require() bound to `graph` returns: the graph's,
// or the global object's for null. Throws ERR_INVALID_STATE (nullptr) once the graph is disposed.
JSC::JSModuleLoader* moduleLoaderForRequire(JSC::JSGlobalObject*, JSC::ThrowScope&, JSModuleGraph*);
// The graph whose module or CommonJS code is running (the innermost frame on the stack that
// says), or null: createRequire() called from graph code returns the graph's require.
JSModuleGraph* ambientModuleGraph(JSC::JSGlobalObject*);
// The require cache of a graph's CommonJS modules, or the global one.
JSC::JSMap* requireMapFor(Zig::GlobalObject*, JSModuleGraph*);
// require.main of a require() that belongs to a graph: the graph's first import, from its cache.
JSC::JSValue moduleGraphRequireMain(Zig::GlobalObject*, JSModuleGraph*);
// promiseRejectionTracker: the graph whose module code is rejecting `promise` right now,
// or null (the global object's code, or no graph exists).
JSModuleGraph* moduleGraphRejecting(Zig::GlobalObject*, JSC::JSPromise*);
void initJSModuleGraphClassStructure(JSC::LazyClassStructure::Initializer&);
// The innermost graph with a context of its own (`isolateIO`) that the current async context
// is inside of: what script opens now belongs to that graph's context. Null: the global's.
JSIsolatedModuleGraph* currentModuleGraph(Zig::GlobalObject*);
// Whether `asyncContext` (what a callback captured when it was handed to native code) is inside
// the context of a graph that has since been disposed: nothing of such a graph is called back.
bool isStoppedModuleGraphContext(JSC::VM&, JSC::JSValue asyncContext);

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

class JSModuleGraph : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm);
    static JSModuleGraph* create(JSC::VM&, JSC::Structure*, JSC::JSModuleLoader*, JSC::JSLexicalEnvironment* overlay, JSC::JSString* overlaySourceSuffix, JSC::JSMap* requireMap, JSC::JSObject* onError);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);
    DECLARE_EXPORT_INFO;
    DECLARE_VISIT_CHILDREN;

    JSC::JSModuleLoader* loader() const { return m_loader.get(); } // null once disposed
    bool disposed() const { return !m_loader; }
    JSC::JSLexicalEnvironment* overlay() const { return m_overlay.get(); }
    // A comment naming the overlay's names, appended to classic code compiled for this
    // overlay shape (CommonJS wrappers) so the code cache keeps shapes apart.
    JSC::JSString* overlaySourceSuffix() const { return m_overlaySourceSuffix.get(); }
    JSC::JSMap* requireMap() const { return m_requireMap.get(); } // the graph's CommonJS require cache
    JSC::JSValue requireCache() const { return m_requireCache.get(); } // require.cache proxy over requireMap(), once created
    void setRequireCache(JSC::VM& vm, JSC::JSValue cache) { m_requireCache.set(vm, this, cache); }
    JSC::JSObject* onError() const { return m_onError.get(); } // null if the host gave none
    JSC::JSValue mainPath() const { return m_mainPath ? JSC::JSValue(m_mainPath.get()) : JSC::jsUndefined(); } // key of the first module import()ed (import.meta.main)
    JSC::JSSet* pendingImports() const { return m_pendingImports.get(); } // promises import() returned that have not settled; dispose() rejects them
    JSC::JSFunction* importSettledHandler(bool rejected) const { return rejected ? m_importRejected.get() : m_importFulfilled.get(); }
    // The context that owns what the graph's script opens: a JSIsolatedModuleGraph's, else null.
    inline WebCore::ScriptExecutionContext* context() const;

    void setMainPath(JSC::VM& vm, JSC::JSString* path) { m_mainPath.set(vm, this, path); }
    void clearMainPath() { m_mainPath.clear(); }
    void setPendingImports(JSC::VM& vm, JSC::JSSet* pending) { m_pendingImports.setMayBeNull(vm, this, pending); }
    void setImportSettledHandlers(JSC::VM&, JSC::JSFunction* fulfilled, JSC::JSFunction* rejected);
    // dispose(): the loader goes; everything else stays for code of the graph that is still running.
    void clearLoader() { m_loader.clear(); }

protected:
    JSModuleGraph(JSC::VM& vm, JSC::Structure* structure, JSC::JSModuleLoader*, JSC::JSLexicalEnvironment*, JSC::JSString*, JSC::JSMap*, JSC::JSObject* onError);
    void finishCreation(JSC::VM&);

private:
    JSC::WriteBarrier<JSC::JSModuleLoader> m_loader;
    JSC::WriteBarrier<JSC::JSLexicalEnvironment> m_overlay;
    JSC::WriteBarrier<JSC::JSString> m_overlaySourceSuffix;
    JSC::WriteBarrier<JSC::JSMap> m_requireMap;
    JSC::WriteBarrier<JSC::Unknown> m_requireCache;
    JSC::WriteBarrier<JSC::JSObject> m_onError;
    JSC::WriteBarrier<JSC::JSString> m_mainPath;
    JSC::WriteBarrier<JSC::JSSet> m_pendingImports;
    JSC::WriteBarrier<JSC::JSFunction> m_importFulfilled;
    JSC::WriteBarrier<JSC::JSFunction> m_importRejected;
};

// A graph made with `isolateIO`: it owns the context its script's timers and I/O belong to,
// which lives exactly as long as it does.
class JSIsolatedModuleGraph final : public JSModuleGraph {
public:
    using Base = JSModuleGraph;
    static constexpr JSC::DestructionMode needsDestruction = JSC::NeedsDestruction;
    static void destroy(JSC::JSCell*);

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm);
    static JSIsolatedModuleGraph* create(JSC::VM&, JSC::Structure*, Ref<WebCore::ScriptExecutionContext>&&, JSC::JSModuleLoader*, JSC::JSLexicalEnvironment* overlay, JSC::JSString* overlaySourceSuffix, JSC::JSMap* requireMap, JSC::JSObject* onError);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);
    DECLARE_EXPORT_INFO;

    WebCore::ScriptExecutionContext& context() const { return m_context.get(); }

private:
    JSIsolatedModuleGraph(JSC::VM& vm, JSC::Structure* structure, Ref<WebCore::ScriptExecutionContext>&&, JSC::JSModuleLoader*, JSC::JSLexicalEnvironment*, JSC::JSString*, JSC::JSMap*, JSC::JSObject* onError);
    void finishCreation(JSC::VM&);

    Ref<WebCore::ScriptExecutionContext> m_context;
};

inline WebCore::ScriptExecutionContext* JSModuleGraph::context() const
{
    auto* isolated = dynamicDowncast<JSIsolatedModuleGraph>(const_cast<JSModuleGraph*>(this));
    return isolated ? &isolated->context() : nullptr;
}

// Per-global state that is not a GC object (Zig::GlobalObject::m_moduleGraphs).
struct ModuleGraphState {
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED(ModuleGraphState);

public:
    explicit ModuleGraphState(JSC::VM& vm)
        : overlaySymbolTables(vm)
        , commonJSWrapperExecutables(vm)
    {
    }
    // Sorted `globals` names -> the overlay SymbolTable that graphs with that name set share
    // (one set of module executables per shape); weak: alive while an overlay uses it.
    JSC::WeakGCMap<WTF::String, JSC::SymbolTable> overlaySymbolTables;
    // The FunctionExecutable of a CommonJS wrapper evaluated for a graph, by (file name,
    // overlay symbol table): every graph with that overlay shape that loads the file gets a
    // function of its own over it, so they share CodeBlocks and JIT code. The name's impl is not
    // kept alive by the map — a hit is verified against the source URL and text before use
    // (JSCommonJSModule.cpp). Weak: alive while a module made from it is.
    using CommonJSWrapperKey = std::pair<UniquedStringImpl*, JSC::SymbolTable*>;
    JSC::WeakGCMap<CommonJSWrapperKey, JSC::FunctionExecutable> commonJSWrapperExecutables;
    // Set while a graph's onError runs: what it throws synchronously is the host's.
    bool inOnError { false };
    // Set while graph.import() / dispose() reject an import() promise: the caller's, not
    // the graph whose module threw.
    bool rejectingImport { false };
};

ModuleGraphState& moduleGraphState(Zig::GlobalObject*);

} // namespace Bun
