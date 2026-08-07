#pragma once

#include "root.h"

#include "BunBuiltinNames.h"
#include "BunClientData.h"
#include "JSEventEmitter.h"

namespace Zig {
class GlobalObject;
}

namespace Bun {
using namespace JSC;

extern "C" int getRSS(size_t* rss);

class Process : public WebCore::JSEventEmitter {
    using Base = WebCore::JSEventEmitter;

    LazyProperty<Process, Structure> m_cpuUsageStructure;
    LazyProperty<Process, Structure> m_resourceUsageStructure;
    LazyProperty<Process, Structure> m_memoryUsageStructure;
    LazyProperty<Process, JSObject> m_bindingUV;
    LazyProperty<Process, JSObject> m_bindingNatives;
    // Function that looks up "emit" on "process" and calls it with the provided arguments
    // Only used by internal code via passing to queueNextTick
    LazyProperty<Process, JSFunction> m_emitHelperFunction;
    // consoleObjectWriteToObservedStream builtin (the console's JS slow path).
    LazyProperty<Process, JSFunction> m_consoleWriteFunction;
    WriteBarrier<Unknown> m_uncaughtExceptionCaptureCallback;
    WriteBarrier<JSObject> m_nextTickFunction;
    // https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/lib/internal/bootstrap/switches/does_own_process_state.js#L113-L116
    WriteBarrier<JSString> m_cachedCwd;
    WriteBarrier<Unknown> m_argv;
    WriteBarrier<Unknown> m_execArgv;

    // ── console ⇄ process.stdout/stderr binding (index 0 = fd 1, 1 = fd 2) ──
    //
    // Node's global console writes through `this._stdout.write(chunk)`, where
    // `_stdout` lazily binds to `process.stdout` on first use and can be
    // reassigned. Bun's console formats natively and writes straight to the
    // per-VM stdio sink *unless doing so would be observable*: the console's
    // stream was reassigned or replaced, its `write` is no longer Bun's, or it
    // is corked / ended. `consoleStream()` answers that per call in O(1).
    enum class ConsoleStreamState : uint8_t {
        Unresolved, // console has not written to this fd yet
        Native, // bound to Bun's own stdio stream (whether or not the JS object exists yet)
        Custom, // bound to m_consoleStream (console._stdout = x, or process.stdout replaced before first use)
    };
    ConsoleStreamState m_consoleStreamState[2] = { ConsoleStreamState::Unresolved, ConsoleStreamState::Unresolved };
    // Bits set from JS while Bun's stdio stream is corked / ended, forcing the
    // JS path so Writable semantics apply. See ProcessObjectInternals.ts.
    uint8_t m_stdioObserved[2] = { 0, 0 };
    WriteBarrier<Unknown> m_consoleStream[2];
    // Bun's own process.stdout / process.stderr object once materialised, and
    // the StructureID it had when pristine (no own `write`).
    WriteBarrier<JSObject> m_stdioStream[2];
    StructureID m_stdioPristineStructureID[2] = {};
    // diagnostics_channel: bit i set while kConsoleChannelNames[i] has
    // subscribers (log, warn, error, debug, info); m_consolePublish(i, args).
    WriteBarrier<JSFunction> m_consolePublish;

public:
    uint8_t m_consoleChannelMask = 0;
    JSFunction* consolePublish() { return m_consolePublish.get(); }
    void setConsoleChannels(JSC::VM& vm, uint8_t mask, JSFunction* publish)
    {
        m_consoleChannelMask = mask;
        m_consolePublish.set(vm, this, publish);
    }
    // fd is 1 or 2 for all of these.
    void setStdioStream(JSC::VM&, int fd, JSObject* stream);
    JSObject* stdioStream(int fd) { return m_stdioStream[fd - 1].get(); }
    void setStdioObserved(int fd, uint8_t bits) { m_stdioObserved[fd - 1] = bits; }
    // `console._stdout = value` / worker stdio rebinding. `value` may be anything.
    void setConsoleStream(JSC::VM&, int fd, JSValue value);
    // The stream the console must deliver through via JS `write()`, or the
    // empty value when the native stdio sink may be used. A structure compare
    // once resolved; the first (Unresolved) call may run — and throw from — a
    // user getter installed on `process.stdout`/`stderr`.
    JSValue consoleStream(JSC::JSGlobalObject*, int fd);
    bool consoleStreamIsResolved(int fd) const { return m_consoleStreamState[fd - 1] != ConsoleStreamState::Unresolved; }
    // What `console._stdout` / `console._stderr` evaluate to (may materialise
    // process.stdout; can throw).
    JSValue consoleStreamForGetter(JSC::JSGlobalObject*, int fd);
    JSFunction* consoleWriteFunction() { return m_consoleWriteFunction.getInitializedOnMainThread(this); }

    Process(JSC::Structure* structure, WebCore::JSDOMGlobalObject& globalObject, Ref<WebCore::EventEmitter>&& impl)
        : Base(structure, globalObject, WTF::move(impl))
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
    // Lazy install guard for the JS onWarning 'warning' listener.
    bool m_warningListenerInstalled = false;
    // Node's per-Environment EmitProcessEnvWarning one-shot for DEP0104.
    bool m_emitEnvNonstringWarning = true;
    // Re-entry guard for dispatchExitInternal. Per-Process (i.e. per-VM): a
    // function-local static would be shared across worker threads, so a
    // worker's exit would suppress the main thread's 'exit' event.
    bool m_isExiting = false;

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

    static JSValue emitWarningErrorInstance(JSC::JSGlobalObject* lexicalGlobalObject, JSValue errorInstance);
    static JSValue emitWarning(JSC::JSGlobalObject* lexicalGlobalObject, JSValue warning, JSValue type, JSValue code, JSValue ctor);

    JSString* cachedCwd() { return m_cachedCwd.get(); }
    void setCachedCwd(JSC::VM& vm, JSString* cwd) { m_cachedCwd.set(vm, this, cwd); }

    JSValue getArgv(JSGlobalObject* globalObject);
    void setArgv(JSGlobalObject* globalObject, JSValue argv);

    JSValue getExecArgv(JSGlobalObject* globalObject);
    void setExecArgv(JSGlobalObject* globalObject, JSValue execArgv);

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject,
        JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype,
            JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static Process* create(WebCore::JSDOMGlobalObject& globalObject, JSC::Structure* structure)
    {
        auto emitter = WebCore::EventEmitter::create(*globalObject.scriptExecutionContext());
        Process* accessor = new (NotNull, JSC::allocateCell<Process>(globalObject.vm())) Process(structure, globalObject, WTF::move(emitter));
        accessor->finishCreation(globalObject.vm());
        return accessor;
    }

    DECLARE_VISIT_CHILDREN;

    template<typename, SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<Process, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForProcessObject.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForProcessObject = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForProcessObject.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForProcessObject = std::forward<decltype(space)>(space); });
    }

    void finishCreation(JSC::VM& vm);

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
// $newCppFunction("BunProcess.cpp", "jsFunctionSetStdioObserved", 2)
JSC_DECLARE_HOST_FUNCTION(jsFunctionSetStdioObserved);
// $newCppFunction("BunProcess.cpp", "jsFunctionSetConsoleStream", 2)
JSC_DECLARE_HOST_FUNCTION(jsFunctionSetConsoleStream);
// $newCppFunction("BunProcess.cpp", "jsFunctionSetConsoleChannels", 2)
JSC_DECLARE_HOST_FUNCTION(jsFunctionSetConsoleChannels);
// $newCppFunction("BunProcess.cpp", "jsFunctionConsoleStream", 1)
JSC_DECLARE_HOST_FUNCTION(jsFunctionConsoleStream);

} // namespace Bun
