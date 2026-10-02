#pragma once

#include "root.h"

#include "BunBuiltinNames.h"
#include "BunClientData.h"
#include <JavaScriptCore/JSDestructibleObject.h>

namespace Zig {
class GlobalObject;
}

namespace Bun {
using namespace JSC;

// Bytes. phys_footprint (Activity Monitor's number) on macOS, the resident set size elsewhere.
extern "C" int getRSS(size_t* rss);
extern "C" int getPeakRSS(size_t* peak);

// `process` is a node:events EventEmitter: the methods come from EventEmitter.prototype, and the listeners are in
// its own `_events`, as for any other emitter.
class Process : public JSC::JSDestructibleObject {
    using Base = JSC::JSDestructibleObject;

    LazyProperty<Process, Structure> m_cpuUsageStructure;
    LazyProperty<Process, Structure> m_resourceUsageStructure;
    LazyProperty<Process, Structure> m_memoryUsageStructure;
    LazyProperty<Process, JSObject> m_bindingUV;
    LazyProperty<Process, JSObject> m_bindingNatives;
    // Function that looks up "emit" on "process" and calls it with the provided arguments
    // Only used by internal code via passing to queueNextTick
    LazyProperty<Process, JSFunction> m_emitHelperFunction;
    WriteBarrier<Unknown> m_uncaughtExceptionCaptureCallback;
    WriteBarrier<JSObject> m_nextTickFunction;
    // https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/lib/internal/bootstrap/switches/does_own_process_state.js#L113-L116
    WriteBarrier<JSString> m_cachedCwd;
    WriteBarrier<Unknown> m_argv;
    WriteBarrier<Unknown> m_execArgv;
    // The JS warning printer (ProcessObjectInternals createOnWarning), built on the first warning.
    WriteBarrier<JSObject> m_onWarning;
    // EventEmitter.prototype of node:events, which is created with `process`, and the two symbols that are keys
    // of every emitter (src/js/node/events.ts).
    WriteBarrier<JSObject> m_eventEmitterPrototype;
    WriteBarrier<Symbol> m_shapeModeSymbol;
    WriteBarrier<Symbol> m_captureSymbol;

    // What `_events` holds for an event: a function, an array of functions, or nothing.
    JSValue listenersOf(const JSC::Identifier& eventName);
    // Whether `process.emit` is the `emit` that EventEmitter.prototype starts with. Runs no JavaScript, and is
    // false when it cannot tell.
    bool hasEmitOfNodeEvents(JSC::VM&, Zig::GlobalObject*, const JSC::Identifier& emitName);

public:
    Process(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    DECLARE_EXPORT_INFO;
    bool m_reportOnUncaughtException = false;

    static void destroy(JSC::JSCell* cell)
    {
        static_cast<Process*>(cell)->Process::~Process();
    }

    ~Process();

    bool m_isExitCodeObservable = false;
    bool m_sourceMapsEnabled = false;
    // Node's per-Environment EmitProcessEnvWarning one-shot for DEP0104.
    bool m_emitEnvNonstringWarning = true;
    // Re-entry guard for dispatchExitInternal. Per-Process (i.e. per-VM): a
    // function-local static would be shared across worker threads, so a
    // worker's exit would suppress the main thread's 'exit' event.
    bool m_isExiting = false;
    // The functions of Process_functionAddExitCallback.
    WriteBarrier<JSArray> m_exitCallbacks;
    // DEP0111/DEP0119 latches. Node's deprecate() closures live in each
    // Environment's own JS, so every worker warns once itself.
    bool m_warnedProcessBinding = false;
    bool m_warnedErrname = false;

    static constexpr unsigned StructureFlags = Base::StructureFlags | HasStaticPropertyTable;

    JSValue constructNextTickFn(JSC::VM& vm, Zig::GlobalObject* globalObject);
    void queueNextTick(JSC::JSGlobalObject* globalObject, const ArgList& args);
    void queueNextTick(JSC::JSGlobalObject* globalObject, JSValue);
    void queueNextTick(JSC::JSGlobalObject* globalObject, JSValue, JSValue);

    template<size_t NumArgs>
    void queueNextTick(JSC::JSGlobalObject* globalObject, JSValue func, const JSValue (&args)[NumArgs]);

    // Some Node.js events want to be emitted on the next tick rather than synchronously.
    // This is equivalent to `process.nextTick(() => process.emit(eventName, event))` from JavaScript.
    void emitOnNextTick(Zig::GlobalObject* globalObject, ASCIILiteral eventName, JSValue event);

    JSObject* ensureOnWarning(Zig::GlobalObject*);

    JSObject* eventEmitterPrototype() const { return m_eventEmitterPrototype.get(); }
    Symbol* shapeModeSymbol() const { return m_shapeModeSymbol.get(); }
    Symbol* captureSymbol() const { return m_captureSymbol.get(); }

    // `process.emit(eventName, ...args)`, as node emits the events of `process`: an `emit` that a program put on
    // `process` or on a prototype of it gets every event. Without one, an event with no listener calls nothing.
    // Returns true when it called `emit`. What that throws is pending on return: for a caller that JavaScript
    // called.
    bool emit(const JSC::Identifier& eventName, const JSC::MarkedArgumentBuffer& args);
    // The same for an event that the runtime starts (a signal, an IPC message, the end of the event loop). What a
    // listener throws is an uncaught exception, and the listeners after it are not called, as in node.
    bool emitFromRuntime(const JSC::Identifier& eventName, const JSC::MarkedArgumentBuffer& args);
    // Both read `_events` and run no JavaScript.
    bool hasListeners(const JSC::Identifier& eventName);
    unsigned listenerCount(const JSC::Identifier& eventName);

    static JSValue emitWarningErrorInstance(JSC::JSGlobalObject* lexicalGlobalObject, JSValue errorInstance);
    static JSValue emitWarning(JSC::JSGlobalObject* lexicalGlobalObject, JSValue warning, JSValue type, JSValue code, JSValue ctor);

    JSString* cachedCwd() { return m_cachedCwd.get(); }
    void setCachedCwd(JSC::VM& vm, JSString* cwd) { m_cachedCwd.set(vm, this, cwd); }
    void clearCachedCwd() { m_cachedCwd.clear(); }

    JSValue getArgv(JSGlobalObject* globalObject);
    void setArgv(JSGlobalObject* globalObject, JSValue argv);

    JSValue getExecArgv(JSGlobalObject* globalObject);
    void setExecArgv(JSGlobalObject* globalObject, JSValue execArgv);

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject,
        JSC::JSValue prototype)
    {
        auto* structure = Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
        // The static table has accessors with setters (exitCode, title, argv). Without this flag an assignment
        // does not look for a setter. JavaScriptCore takes the flag from the generated table, and
        // src/codegen/create_hash_table does not write the attributes of the properties there.
        structure->setHasAnyKindOfGetterSetterPropertiesWithProtoCheck(false);
        return structure;
    }

    // With its prototype: an object that has `constructor` and inherits from EventEmitter.prototype.
    static Process* create(Zig::GlobalObject*);

    DECLARE_VISIT_CHILDREN;

    template<typename, SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<Process, WebCore::UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForProcessObject, m_subspaceForProcessObject));
    }

    void finishCreation(JSC::VM&, JSObject* eventEmitterPrototype, Symbol* shapeModeSymbol, Symbol* captureSymbol);

    inline void setUncaughtExceptionCaptureCallback(JSC::JSValue callback)
    {
        m_uncaughtExceptionCaptureCallback.set(vm(), this, callback);
    }

    inline JSC::JSValue getUncaughtExceptionCaptureCallback()
    {
        return m_uncaughtExceptionCaptureCallback.get();
    }

    inline Structure* cpuUsageStructure() { return m_cpuUsageStructure.getInitializedOnMainThread(this); }
    inline Structure* resourceUsageStructure() { return m_resourceUsageStructure.getInitializedOnMainThread(this); }
    inline Structure* memoryUsageStructure() { return m_memoryUsageStructure.getInitializedOnMainThread(this); }
    inline JSObject* bindingUV() { return m_bindingUV.getInitializedOnMainThread(this); }
    inline JSObject* bindingNatives() { return m_bindingNatives.getInitializedOnMainThread(this); }
};

JSC_DECLARE_HOST_FUNCTION(Process_functionDlopen);

// Routes its argument onto the uncaught-exception path. Used, via $newCppFunction, by the
// node-style callback shims in src/js.
JSC_DECLARE_HOST_FUNCTION(jsFunctionReportUncaughtException);

// For src/js, via $newCppFunction: the function is called when 'exit' was emitted, also when a listener of it
// threw. Node does this work (the trace file) in native code at the end of a process or a worker.
JSC_DECLARE_HOST_FUNCTION(Process_functionAddExitCallback);

// process.cwd() as a JSString, cached on the process object until it changes.
JSC::JSValue getCachedCwd(JSC::JSGlobalObject*);

} // namespace Bun
