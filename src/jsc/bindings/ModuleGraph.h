#pragma once

#include "root.h"
#include "BunClientData.h"
#include <JavaScriptCore/JSModuleLoader.h>
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/LazyClassStructure.h>
#include <JavaScriptCore/Weak.h>
#include <wtf/HashMap.h>
#include <wtf/text/StringHash.h>

namespace JSC {
class JSPromise;
class StackFrame;
class SymbolTable;
}

namespace Bun {

// `Bun.unsafe.ModuleGraph`: another instance of the ES module graph inside one global object.
// It owns an additional JSModuleLoader, so modules imported through it get their own records,
// environments, namespaces, import.meta and top-level-await state. Everything else (globalThis,
// builtin modules, CommonJS, the event loop) is the global object's.
class JSModuleGraph final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSModuleGraph* create(JSC::VM&, JSC::Structure*, JSC::JSModuleLoader*, JSC::JSValue onError);

    // The graph `loader` belongs to, or nullptr for the global object's own loader.
    static JSModuleGraph* forLoader(Zig::GlobalObject*, JSC::JSModuleLoader*);
    // The graph whose module code `callee` (a function, or a module body's callee) was created
    // in: callee -> scope chain -> module environment -> record -> loader -> graph.
    static JSModuleGraph* forCallee(Zig::GlobalObject*, JSC::JSCell* callee);
    // The graph of the innermost frame that belongs to one.
    static JSModuleGraph* forStack(Zig::GlobalObject*, const WTF::Vector<JSC::StackFrame>&);
    // forStack() of where an Error object was created, while it still has its stack trace. The
    // last resort: a frame that made a tail call is in no other stack.
    static JSModuleGraph* forErrorValue(Zig::GlobalObject*, JSC::JSValue error);

    // An unhandled rejection belongs to the graph whose code rejected the promise, if that graph
    // has an onError. Only knowable while it is being rejected (the rejecting code is on the
    // stack, or has just unwound and left its exception in vm.lastException(); forErrorValue()
    // after those), so
    // noteRejection() records it then and reportRejection() uses it once the rejection is
    // reported: true when the graph's onError took it. forgetReportedRejection() is for a promise
    // handled after that: true when it was one of those, which the process never heard about.
    static void noteRejection(Zig::GlobalObject*, JSC::JSPromise*);
    static bool reportRejection(Zig::GlobalObject*, JSC::JSPromise*);
    static bool forgetReportedRejection(Zig::GlobalObject*, JSC::JSPromise*);

    // Hands `error` to onError. False when there is no onError; what onError itself throws is
    // reported process-wide.
    bool reportError(Zig::GlobalObject*, JSC::JSValue error);

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<JSModuleGraph, WebCore::UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForJSModuleGraph, m_subspaceForJSModuleGraph));
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    JSC::JSModuleLoader* loader() const { return m_loader.get(); }
    // A callable, or undefined.
    JSC::JSValue onError() const { return m_onError.get(); }

    bool isDisposed() const { return m_disposed; }
    void dispose();

    // The resolved key of the first module imported through the graph; import.meta.main is
    // true in that module and nowhere else in the graph.
    JSC::JSString* mainModule() const { return m_mainModule.get(); }
    void setMainModuleIfUnset(JSC::VM& vm, JSC::JSString* key)
    {
        if (!m_mainModule)
            m_mainModule.set(vm, this, key);
    }

private:
    JSModuleGraph(JSC::VM& vm, JSC::Structure* structure, JSC::JSModuleLoader* loader, JSC::JSValue onError)
        : Base(vm, structure)
        , m_loader(loader, JSC::WriteBarrierEarlyInit)
        , m_onError(onError, JSC::WriteBarrierEarlyInit)
    {
    }

    JSC::WriteBarrier<JSC::JSModuleLoader> m_loader;
    JSC::WriteBarrier<JSC::Unknown> m_onError;
    JSC::WriteBarrier<JSC::JSString> m_mainModule;
    bool m_disposed { false };
};

// Graphs constructed with the same set of `globals` names get the same SymbolTable object for
// their module scope, which is what JSModuleRecord::getOrMakeExecutable requires before it lets
// their records share an executable. Held weakly: an executable keeps its module scope's symbol
// tables alive, so once a table is collected there is no code left to share with.
class ModuleGraphSymbolTables {
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED(ModuleGraphSymbolTables);
    WTF_MAKE_NONCOPYABLE(ModuleGraphSymbolTables);

public:
    ModuleGraphSymbolTables() = default;
    // `sortedNames` must be sorted and free of duplicates.
    JSC::SymbolTable* getOrCreate(JSC::VM&, const WTF::Vector<JSC::Identifier>& sortedNames);

private:
    WTF::HashMap<WTF::String, JSC::Weak<JSC::SymbolTable>> m_tables;
};

void initJSModuleGraphClassStructure(JSC::LazyClassStructure::Initializer&);

} // namespace Bun
