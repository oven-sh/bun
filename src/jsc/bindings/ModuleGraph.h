#pragma once

#include "root.h"
#include <JavaScriptCore/JSMap.h>
#include <JavaScriptCore/JSModuleLoader.h>
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSPromise.h>
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

// Bun.ModuleGraph: a further instance of a program in this global object. It has a
// JSC module loader of its own whose module scope (the "overlay", a lexical environment
// over the global one) holds the host's `globals`, and a CommonJS require cache of its own.
// Code is shared with every other graph whose `globals` have the same names; state is not.
// It owns the context its script's timers and I/O belong to.
class JSModuleGraph final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr JSC::DestructionMode needsDestruction = JSC::NeedsDestruction;
    static void destroy(JSC::JSCell*);

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM&);
    // `maker`: the graph in whose context this one is being made (null: the host's).
    static JSModuleGraph* create(JSC::VM&, Zig::GlobalObject*, JSC::Structure*, JSC::JSModuleLoader*, JSC::JSObject* onError, JSModuleGraph* maker);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);
    DECLARE_EXPORT_INFO;
    DECLARE_VISIT_CHILDREN;

    JSC::JSModuleLoader* loader() const { return m_loader.get(); }
    JSC::JSLexicalEnvironment* overlay() const;
    JSC::JSMap* requireMap() const { return m_requireMap.get(); }
    JSC::JSObject* onError() const { return m_onError.get(); } // null if the host gave none
    // The graph in whose context this one was made (null: the host's). Errors of a graph that was
    // given no onError go to its maker's.
    JSModuleGraph* maker() const { return m_maker.get(); }
    // Key of the first module import()ed: import.meta.main / require.main. Undefined before.
    JSC::JSValue mainPath() const { return m_mainPath ? JSC::JSValue(m_mainPath.get()) : JSC::jsUndefined(); }
    bool disposed() const { return m_context->isStopped(); }
    // The context that owns what the graph's script opens.
    WebCore::ScriptExecutionContext& context() const { return m_context.get(); }
    // A captured async context (AsyncContextSwapScope) that is this graph's context and no
    // AsyncLocalStorage stores: what the graph's modules are evaluated in, and what a callback
    // kept on something long-lived is later called in.
    JSC::JSValue capturedContext() const { return m_loader->asyncContext(); }

    // require.cache of the graph's require(): one object, made on first use.
    JSC::JSValue requireCache() const { return m_requireCache.get(); }
    void setRequireCache(JSC::VM& vm, JSC::JSValue cache) { m_requireCache.set(vm, this, cache); }

    JSC::JSPromise* import(Zig::GlobalObject*, JSC::JSValue specifier);
    void dispose(Zig::GlobalObject*);

private:
    JSModuleGraph(JSC::VM&, JSC::Structure*, Ref<WebCore::ScriptExecutionContext>&&, JSC::JSModuleLoader*, JSC::JSObject* onError, JSModuleGraph* maker);
    void finishCreation(JSC::VM&, JSC::JSGlobalObject*);

    Ref<WebCore::ScriptExecutionContext> m_context;
    JSC::WriteBarrier<JSC::JSModuleLoader> m_loader;
    JSC::WriteBarrier<JSC::JSMap> m_requireMap;
    JSC::WriteBarrier<JSC::Unknown> m_requireCache;
    JSC::WriteBarrier<JSC::JSObject> m_onError;
    JSC::WriteBarrier<JSModuleGraph> m_maker;
    JSC::WriteBarrier<JSC::JSString> m_mainPath;
};

JSC_DECLARE_HOST_FUNCTION(jsFunctionIsDisposedModuleGraph);

// Per-global state that is not a GC object (Zig::GlobalObject::m_moduleGraphs).
struct ModuleGraphState {
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED(ModuleGraphState);

public:
    explicit ModuleGraphState(JSC::VM& vm)
        : overlaySymbolTables(vm)
    {
    }
    // Sorted `globals` names -> the SymbolTable the overlays of the graphs made with that name
    // set share, which is what JSC keys the executables graphs share on (of ES modules, and of
    // CommonJS modules' wrappers). Weak: alive while an overlay uses it.
    JSC::WeakGCMap<WTF::String, JSC::SymbolTable> overlaySymbolTables;
};

void initJSModuleGraphClassStructure(JSC::LazyClassStructure::Initializer&);

// ── Which graph ──────────────────────────────────────────────────────────────────────
// The graph `loader` is the loader of; null for the global object's own.
JSModuleGraph* moduleGraphOfLoader(JSC::JSGlobalObject*, JSC::JSModuleLoader*);
// promiseRejectionTracker: the graph whose onError a promise rejected now is reported to, or null.
JSModuleGraph* moduleGraphRejecting(Zig::GlobalObject*);
// The graph whose context is current; null in the host's.
JSModuleGraph* currentModuleGraph(Zig::GlobalObject*);
// The graph whose context a captured async context (AsyncContextSwapScope::current(): what an
// AsyncContextFrame holds, Exception::asyncContext()) was captured in; null: the host's.
JSModuleGraph* moduleGraphOfCapturedContext(JSC::JSValue);

// ── What a graph's require() and import() use ────────────────────────────────────────
// `graph` null: the global object's.
JSC::JSMap* requireMapOf(Zig::GlobalObject*, JSModuleGraph*);
// Throws ERR_INVALID_STATE once the graph (null: none) is disposed.
void throwIfModuleGraphDisposed(JSC::JSGlobalObject*, JSC::ThrowScope&, JSModuleGraph*);
// As above (and returns null).
JSC::JSModuleLoader* moduleLoaderOf(JSC::JSGlobalObject*, JSC::ThrowScope&, JSModuleGraph*);
// dispose() of the graph `context` was made for (its context is stopped with it); just the stop
// if the graph has been collected.
void disposeModuleGraphOfContext(WebCore::ScriptExecutionContext&);

// ── The graph's context ──────────────────────────────────────────────────────────────
// What runs while this is alive runs in `owner`'s context (null: the realm's own). For a call made
// from wherever an error is being delivered: a handler runs as its owner, not as whoever failed.
// Both halves of "the context that is current" are swapped: the owner next to the async context,
// and the context native code entered (VirtualMachine::entered_context), so a handler called from
// inside a stopped graph's dispatch is not itself called for nobody.
// The async context stays the one that is current where the error is reported: a reporter
// that reports before it restores the failing callback's context (timers, the tick queue) shows
// the handler that callback's AsyncLocalStorage stores, as node does. What the handler leaves in
// the async context (enterWith()) ends with it.
class ErrorHandlerContextScope {
    WTF_MAKE_NONCOPYABLE(ErrorHandlerContextScope);
    WTF_FORBID_HEAP_ALLOCATION;

public:
    ErrorHandlerContextScope(Zig::GlobalObject*, JSModuleGraph* owner);
    ~ErrorHandlerContextScope();

private:
    Zig::GlobalObject* m_globalObject;
    JSC::JSValue m_previousAsyncContext;
    JSC::JSValue m_previousOwner;
    uint32_t m_previousEntered;
};

// What runs while this is alive runs inside a graph's context: the graph is the owner that is
// current, and every continuation captured meanwhile carries it. Nothing for a null graph, or
// when already inside it.
class ModuleGraphContextScope {
    WTF_MAKE_NONCOPYABLE(ModuleGraphContextScope);
    WTF_FORBID_HEAP_ALLOCATION;

public:
    ModuleGraphContextScope(Zig::GlobalObject*, JSModuleGraph*);
    // Listeners of something a graph's script made run in the graph's context; of something the
    // realm's own script made, in the realm's, whoever dispatches.
    explicit ModuleGraphContextScope(WebCore::ScriptExecutionContext&);
    ~ModuleGraphContextScope();

private:
    Zig::GlobalObject* m_globalObject { nullptr };
    JSC::JSValue m_previous;
};

// Whether a callback that captured `capturedContext` when it was handed to native code is not to
// be called: it was handed over inside the context of a graph that has since been disposed.
bool shouldDropCallbackOfStoppedModuleGraph(JSC::JSValue capturedContext);

} // namespace Bun
