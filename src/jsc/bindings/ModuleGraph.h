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
class JSLexicalEnvironment;
class JSModuleLoader;
class JSPromise;
class StackFrame;
class ThrowScope;
}

namespace Bun {

class JSModuleGraph;

// Bun.unsafe.ModuleGraph — further instantiations of ES module graphs in THIS
// global object: a JSC module loader of its own whose module scope holds the
// host's `globals` for the graph. Records of the same module in different graphs
// share executables (CodeBlocks, JIT code); each graph has its own module state
// and import() routing. CommonJS modules, builtins and native addons are the
// global object's single instances. See ModuleGraph.cpp.

JSModuleGraph* moduleGraphForLoader(JSC::JSGlobalObject*, JSC::JSModuleLoader*);
void throwModuleGraphDisposed(JSC::JSGlobalObject*, JSC::ThrowScope&);
// Rejections of promises by graph code, for attributing unhandled ones (onError).
void moduleGraphNoteRejection(Zig::GlobalObject*, JSC::JSPromise*);
// An ErrorInstance is about to drop its stack frames: remember the graph they attribute it to.
void moduleGraphNoteErrorFrames(Zig::GlobalObject*, JSC::ErrorInstance*, const WTF::Vector<JSC::StackFrame>&);

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
    // The loader's module scope: a lexical environment holding the host's `globals`.
    JSC::JSLexicalEnvironment* overlay() const { return m_overlay.get(); }
    JSC::JSObject* onError() const { return m_onError.get(); } // host callback for uncaught errors, or null
    JSC::JSValue mainPath() const { return m_mainPath ? JSC::JSValue(m_mainPath.get()) : JSC::jsUndefined(); } // the first module import()ed (import.meta.main), or undefined
    JSC::JSArray* pendingImports() const { return m_pendingImports.get(); } // promises import() returned that may be pending; dispose() rejects them

    void setMainPath(JSC::VM& vm, JSC::JSString* path) { m_mainPath.set(vm, this, path); }
    void clearMainPath() { m_mainPath.clear(); }
    void setPendingImports(JSC::VM& vm, JSC::JSArray* pending) { m_pendingImports.setMayBeNull(vm, this, pending); }
    // dispose(): the loader goes; everything else stays for code of the graph that is still running.
    void clearLoader() { m_loader.clear(); }

private:
    JSModuleGraph(JSC::VM& vm, JSC::Structure* structure, JSC::JSModuleLoader*, JSC::JSLexicalEnvironment*, JSC::JSObject* onError);
    void finishCreation(JSC::VM&);

    JSC::WriteBarrier<JSC::JSModuleLoader> m_loader;
    JSC::WriteBarrier<JSC::JSLexicalEnvironment> m_overlay;
    JSC::WriteBarrier<JSC::JSObject> m_onError;
    JSC::WriteBarrier<JSC::JSString> m_mainPath;
    JSC::WriteBarrier<JSC::JSArray> m_pendingImports;
};

void initJSModuleGraphClassStructure(JSC::LazyClassStructure::Initializer& init);

} // namespace Bun
