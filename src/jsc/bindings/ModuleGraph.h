#pragma once

#include "root.h"
#include <JavaScriptCore/JSMap.h>
#include <JavaScriptCore/JSModuleLoader.h>
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSSet.h>
#include <JavaScriptCore/LazyClassStructure.h>
#include <JavaScriptCore/SymbolTable.h>
#include <JavaScriptCore/WeakGCMap.h>
#include <JavaScriptCore/WriteBarrier.h>
#include "ScriptExecutionContext.h"

namespace Zig {
class GlobalObject;
}

namespace JSC {
class JSLexicalEnvironment;
class JSPromise;
class ThrowScope;
}

namespace Bun {

class JSIsolatedModuleGraph;

// Bun.ModuleGraph: a further instance of a program in this global object. It has a
// JSC module loader of its own whose module scope (the "overlay", a lexical environment
// over the global one) holds the host's `globals`, and a CommonJS require cache of its own.
// Code is shared with every other graph whose `globals` have the same names; state is not.
class JSModuleGraph : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM&);
    static JSModuleGraph* create(JSC::VM&, JSC::JSGlobalObject*, JSC::Structure*, JSC::JSModuleLoader*, JSC::JSObject* onError);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);
    DECLARE_EXPORT_INFO;
    DECLARE_VISIT_CHILDREN;

    JSC::JSModuleLoader* loader() const { return m_loader.get(); }
    JSC::JSLexicalEnvironment* overlay() const;
    JSC::JSMap* requireMap() const { return m_requireMap.get(); }
    JSC::JSObject* onError() const { return m_onError.get(); } // null if the host gave none
    // Key of the first module import()ed: import.meta.main / require.main. Undefined before.
    JSC::JSValue mainPath() const { return m_mainPath ? JSC::JSValue(m_mainPath.get()) : JSC::jsUndefined(); }
    bool disposed() const { return m_disposed; }
    // The context that owns what the graph's script opens: a JSIsolatedModuleGraph's, else null.
    inline WebCore::ScriptExecutionContext* context() const;

    // require.cache of the graph's require(): one object, made on first use.
    JSC::JSValue requireCache() const { return m_requireCache.get(); }
    void setRequireCache(JSC::VM& vm, JSC::JSValue cache) { m_requireCache.set(vm, this, cache); }

    JSC::JSPromise* import(Zig::GlobalObject*, JSC::JSValue specifier);
    void dispose(Zig::GlobalObject*);
    // The loader's promise for a graph.import() of `key` settled: `result` follows.
    void importSettled(Zig::GlobalObject*, JSC::JSPromise* result, JSC::JSValue key, JSC::JSValue settlement, bool rejected);

protected:
    JSModuleGraph(JSC::VM&, JSC::Structure*, JSC::JSModuleLoader*, JSC::JSObject* onError);
    void finishCreation(JSC::VM&, JSC::JSGlobalObject*);

private:
    JSC::WriteBarrier<JSC::JSModuleLoader> m_loader;
    JSC::WriteBarrier<JSC::JSMap> m_requireMap;
    JSC::WriteBarrier<JSC::Unknown> m_requireCache;
    JSC::WriteBarrier<JSC::JSObject> m_onError;
    JSC::WriteBarrier<JSC::JSString> m_mainPath;
    // Promises graph.import() returned that have not settled: dispose() rejects them.
    JSC::WriteBarrier<JSC::JSSet> m_pendingImports;
    bool m_disposed { false };
};

// A graph made with `isolateIO`: it owns the context its script's timers and I/O belong to.
class JSIsolatedModuleGraph final : public JSModuleGraph {
public:
    using Base = JSModuleGraph;
    static constexpr JSC::DestructionMode needsDestruction = JSC::NeedsDestruction;
    static void destroy(JSC::JSCell*);

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM&);
    static JSIsolatedModuleGraph* create(JSC::VM&, Zig::GlobalObject*, JSC::Structure*, JSC::JSModuleLoader*, JSC::JSObject* onError);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);
    DECLARE_EXPORT_INFO;

    WebCore::ScriptExecutionContext& context() const { return m_context.get(); }

private:
    JSIsolatedModuleGraph(JSC::VM&, JSC::Structure*, Ref<WebCore::ScriptExecutionContext>&&, JSC::JSModuleLoader*, JSC::JSObject* onError);
    void finishCreation(JSC::VM&, JSC::JSGlobalObject*);

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
    {
    }
    // Sorted `globals` names -> the SymbolTable the overlays of the graphs made with that name
    // set share, which is what JSC keys shared module executables on. Weak: alive while an
    // overlay uses it.
    JSC::WeakGCMap<WTF::String, JSC::SymbolTable> overlaySymbolTables;
    // Some graph of the global has (had) a context of its own.
    bool hasIsolatedGraphs { false };
    // A graph's onError is running: what it throws synchronously is the host's.
    bool inOnError { false };
    // graph.import() / dispose() is rejecting an import() promise: the caller's to handle,
    // not the graph's whose module threw.
    bool rejectingImport { false };
    // Native code is telling a graph that something of its own closed.
    unsigned teardownNotificationDepth { 0 };
    // The async context native code entered from the top of the event loop
    // (VirtualMachine::enter_context): what a microtask checkpoint there goes back to.
    JSC::Strong<JSC::Unknown> enteredFromEventLoop;
};

void initJSModuleGraphClassStructure(JSC::LazyClassStructure::Initializer&);

// ── Which graph ──────────────────────────────────────────────────────────────────────
// The graph `loader` is the loader of; null for the global object's own.
JSModuleGraph* moduleGraphOfLoader(JSC::JSGlobalObject*, JSC::JSModuleLoader*);
// The graph whose module or CommonJS code is running (the innermost frame that says), or null.
JSModuleGraph* moduleGraphOfRunningCode(JSC::JSGlobalObject*);
// promiseRejectionTracker: the graph whose code is rejecting `promise` right now, or null.
JSModuleGraph* moduleGraphRejecting(Zig::GlobalObject*, JSC::JSPromise*);
// The innermost graph with a context of its own that the current async context is inside of.
JSIsolatedModuleGraph* currentIsolatedModuleGraph(Zig::GlobalObject*);

// ── What a graph's require() and import() use ────────────────────────────────────────
// `graph` null: the global object's.
JSC::JSMap* requireMapOf(Zig::GlobalObject*, JSModuleGraph*);
// Throws ERR_INVALID_STATE (and returns null) once the graph is disposed.
JSC::JSModuleLoader* moduleLoaderOf(JSC::JSGlobalObject*, JSC::ThrowScope&, JSModuleGraph*);
JSC::JSObject* createModuleGraphDisposedError(JSC::JSGlobalObject*);
bool throwIfModuleGraphDisposed(JSC::JSGlobalObject*, JSC::ThrowScope&, JSC::JSModuleLoader*);

// ── The graph's context ──────────────────────────────────────────────────────────────
// What runs while this is alive runs inside a graph's context: an async context frame naming
// the graph is current, and every continuation captured meanwhile carries it. Nothing for a
// null graph, a graph without a context of its own, or when already inside it.
class ModuleGraphContextScope {
    WTF_MAKE_NONCOPYABLE(ModuleGraphContextScope);
    WTF_FORBID_HEAP_ALLOCATION;

public:
    ModuleGraphContextScope(Zig::GlobalObject*, JSModuleGraph*);
    // The graph `context` was made for, if any: an event dispatched to something the graph's
    // script made runs its listeners in the graph's context.
    explicit ModuleGraphContextScope(WebCore::ScriptExecutionContext&);
    ~ModuleGraphContextScope();

private:
    Zig::GlobalObject* m_globalObject { nullptr };
    JSC::JSValue m_previous;
};

// Whether a callback that captured `asyncContext` when it was handed to native code is not to
// be called: it was handed over inside the context of a graph that has since been disposed,
// and what is calling is not a close notification (bun_jsc::TeardownNotification).
bool shouldDropCallbackOfStoppedModuleGraph(Zig::GlobalObject*, JSC::JSValue asyncContext);

// What GlobalObject::drainMicrotasks resets the async context to when no script is on the stack:
// undefined, or what native code entered with VirtualMachine::enter_context.
JSC::JSValue moduleGraphAsyncContextAtEventLoop(Zig::GlobalObject*);

} // namespace Bun
