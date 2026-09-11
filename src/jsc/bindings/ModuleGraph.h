#pragma once

#include "root.h"
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/LazyClassStructure.h>
#include <JavaScriptCore/SymbolTable.h>
#include <JavaScriptCore/WeakGCMap.h>
#include <JavaScriptCore/WriteBarrier.h>

namespace Zig {
class GlobalObject;
}

namespace JSC {
class ErrorInstance;
class JSFunction;
class JSLexicalEnvironment;
class JSModuleLoader;
class JSPromise;
class JSSet;
class StackFrame;
class ThrowScope;
}

namespace Bun {

class JSModuleGraph;

// Bun.unsafe.ModuleGraph: a further instantiation of ES module graphs in this global
// object — a JSC module loader whose module scope (the "overlay") holds the host's
// `globals` for the graph.
JSModuleGraph* moduleGraphForLoader(JSC::JSGlobalObject*, JSC::JSModuleLoader*);
// Throws ERR_INVALID_STATE if `loader` belongs to a disposed graph; returns whether it threw.
bool throwIfModuleGraphDisposed(JSC::JSGlobalObject*, JSC::ThrowScope&, JSC::JSModuleLoader*);
// Rejections of promises while a graph exists, for attributing unhandled ones (onError).
void moduleGraphNoteRejection(Zig::GlobalObject*, JSC::JSPromise*);
// An ErrorInstance is about to drop its stack frames: remember the graph they attribute it to.
void moduleGraphNoteErrorFrames(Zig::GlobalObject*, JSC::ErrorInstance*, const WTF::Vector<JSC::StackFrame>&);
JSC::JSValue createModuleGraphConstructor(Zig::GlobalObject*);
void initJSModuleGraphClassStructure(JSC::LazyClassStructure::Initializer&);

class JSModuleGraph final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

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
};

} // namespace Bun
