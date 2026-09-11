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

// Bun.unsafe.ModuleGraph — a module loader of its own in THIS global: the ES
// modules it imports (and the CommonJS modules they require) are fetched, linked
// and evaluated again for the graph, with their own state and the graph's own
// values for `process`, `globalThis`, timers, ... (a lexical environment between
// the graph's modules and the global scope); compiled code is shared with other
// loads of the same files. See ModuleGraph.cpp.
// A graph's own copy of a builtin module's exports object (node:fs, node:http, …):
// own properties copied from the host's object (functions shared, accessors
// kept), so monkey-patching by graph code stays inside the graph and goes
// away with it. Non-object exports are returned as is. `graph` null → host object.
JSC::JSValue graphLocalBuiltin(JSC::JSGlobalObject*, class JSModuleGraph*, const WTF::String& specifier, JSC::JSValue hostExports);
class JSModuleGraph;
// The graph `loader` belongs to; null for the global object's own loader.
JSModuleGraph* moduleGraphForLoader(JSC::JSGlobalObject*, JSC::JSModuleLoader*);
// promiseRejectionTracker hook: remember which graph's code rejected `promise` (no-op without graphs).
void moduleGraphNoteRejection(Zig::GlobalObject*, JSC::JSPromise*);

class JSModuleGraph final : public JSC::JSInternalFieldObjectImpl<13> {
public:
    using Base = JSC::JSInternalFieldObjectImpl<13>;
    enum class Field : unsigned {
        Loader = 0, // JSModuleLoader: the graph's module loader (registry); null once disposed
        Overlay, // JSLexicalEnvironment: per-graph values for the overlaid globals; the loader's module scope
        RequireMap, // JSMap: this graph's CommonJS require cache
        OnExit,
        OnError,
        Process, // the per-graph process object
        PresetDispose, // clears timers the graph armed
        RequireCache, // lazily created require.cache proxy
        DispatchError, // preset: graph process listeners first, then host onError
        MainPath, // resolved path of the first module import()ed (import.meta.main)
        Builtins, // JSMap: builtin specifier → this graph's own copy of the builtin's exports object
        CustomizeBuiltin, // preset: (specifier, copy) → adjusts a fresh builtin copy for this graph (tracked timers, watchers)
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
    JSC::JSMap* builtins() const;

private:
    JSModuleGraph(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }
    void finishCreation(JSC::VM&);
};

void initJSModuleGraphClassStructure(JSC::LazyClassStructure::Initializer& init);

} // namespace Bun
