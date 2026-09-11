#pragma once

#include "root.h"
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/LazyClassStructure.h>
#include <JavaScriptCore/WriteBarrier.h>

namespace Zig {
class GlobalObject;
}

namespace JSC {
class ErrorInstance;
class JSArray;
class StackFrame;
class JSLexicalEnvironment;
class JSMap;
class JSModuleLoader;
class JSPromise;
class ThrowScope;
}

namespace Bun {

class JSModuleGraph;

// Bun.unsafe.ModuleGraph — further instantiations of ES module graphs in THIS
// global object: a JSC module loader of its own whose module scope holds the
// host's `globals` for the graph. Records of the same module in different graphs
// share executables (CodeBlocks, JIT code); each graph has its own module state,
// CommonJS require cache and import() / require routing. See ModuleGraph.cpp.
class JSCommonJSModule;

JSModuleGraph* moduleGraphForLoader(JSC::JSGlobalObject*, JSC::JSModuleLoader*);
// The graph whose code is running (nearest graph frame on the stack), or null.
JSModuleGraph* ambientModuleGraph(JSC::JSGlobalObject*);
// The require cache of a graph's CommonJS modules, or the global one.
JSC::JSMap* requireMapFor(Zig::GlobalObject*, JSModuleGraph*);
// The loader a CommonJS module's require() loads ES modules with: its graph's, or
// the global object's. Null when the graph has been disposed.
JSC::JSModuleLoader* moduleLoaderForRequirer(JSC::JSGlobalObject*, JSCommonJSModule* requirer);
void throwModuleGraphDisposed(JSC::JSGlobalObject*, JSC::ThrowScope&);
JSC_DECLARE_HOST_FUNCTION(functionModuleGraphMainOf);
JSC_DECLARE_HOST_FUNCTION(functionRequireMapOf);
// Rejections of promises by graph code, for attributing unhandled ones (onError).
void moduleGraphNoteRejection(Zig::GlobalObject*, JSC::JSPromise*);
// An ErrorInstance is about to drop its stack frames: remember the graph they attribute it to.
void moduleGraphNoteErrorFrames(Zig::GlobalObject*, JSC::ErrorInstance*, const WTF::Vector<JSC::StackFrame>&);

class JSModuleGraph final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm);
    static JSModuleGraph* create(JSC::VM&, JSC::Structure*, JSC::JSModuleLoader*, JSC::JSLexicalEnvironment* overlay, JSC::JSString* overlaySourceSuffix, JSC::JSMap* requireMap, JSC::JSObject* onError);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);
    DECLARE_EXPORT_INFO;
    DECLARE_VISIT_CHILDREN;

    JSC::JSModuleLoader* loader() const { return m_loader.get(); } // null once disposed
    bool disposed() const { return !m_loader; }
    // The loader's module scope: a lexical environment holding the host's `globals`.
    JSC::JSLexicalEnvironment* overlay() const { return m_overlay.get(); }
    // A comment naming the overlay's names, appended to classic code compiled for this
    // overlay shape (CommonJS wrappers) so the code cache keeps shapes apart.
    JSC::JSString* overlaySourceSuffix() const { return m_overlaySourceSuffix.get(); }
    JSC::JSMap* requireMap() const { return m_requireMap.get(); } // this graph's CommonJS require cache
    JSC::JSObject* onError() const { return m_onError.get(); } // host callback for uncaught errors, or null
    JSC::JSValue mainPath() const { return m_mainPath ? JSC::JSValue(m_mainPath.get()) : JSC::jsUndefined(); } // the first module import()ed (import.meta.main), or undefined
    JSC::JSValue requireCache() const { return m_requireCache.get(); } // require.cache proxy over requireMap(), once created
    JSC::JSArray* pendingImports() const { return m_pendingImports.get(); } // promises import() returned that may be pending; dispose() rejects them

    void setMainPath(JSC::VM& vm, JSC::JSString* path) { m_mainPath.set(vm, this, path); }
    void clearMainPath() { m_mainPath.clear(); }
    void setRequireCache(JSC::VM& vm, JSC::JSValue cache) { m_requireCache.set(vm, this, cache); }
    void setPendingImports(JSC::VM& vm, JSC::JSArray* pending) { m_pendingImports.setMayBeNull(vm, this, pending); }
    // dispose(): the loader goes; everything else stays for code of the graph that is still running.
    void clearLoader() { m_loader.clear(); }

private:
    JSModuleGraph(JSC::VM& vm, JSC::Structure* structure, JSC::JSModuleLoader*, JSC::JSLexicalEnvironment*, JSC::JSString*, JSC::JSMap*, JSC::JSObject* onError);
    void finishCreation(JSC::VM&);

    JSC::WriteBarrier<JSC::JSModuleLoader> m_loader;
    JSC::WriteBarrier<JSC::JSLexicalEnvironment> m_overlay;
    JSC::WriteBarrier<JSC::JSString> m_overlaySourceSuffix;
    JSC::WriteBarrier<JSC::JSMap> m_requireMap;
    JSC::WriteBarrier<JSC::JSObject> m_onError;
    JSC::WriteBarrier<JSC::JSString> m_mainPath;
    JSC::WriteBarrier<JSC::Unknown> m_requireCache;
    JSC::WriteBarrier<JSC::JSArray> m_pendingImports;
};

void initJSModuleGraphClassStructure(JSC::LazyClassStructure::Initializer& init);

} // namespace Bun
