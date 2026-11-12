#pragma once

#include "root.h"
#include <JavaScriptCore/DeferGC.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/VM.h>
#include <JavaScriptCore/FrameTracers.h>
#include <JavaScriptCore/VMTrapsInlines.h>

#include "headers-handwritten.h"
#include "BunClientData.h"
#include <JavaScriptCore/CallFrame.h>
#include "node_api.h"
#include <JavaScriptCore/JSWeakValue.h>
#include "JSFFIFunction.h"
#include "ZigGlobalObject.h"
#include "napi_handle_scope.h"
#include "napi_finalizer.h"
#include "wtf/Assertions.h"
#include "napi_macros.h"

#include <wtf/HashSet.h>
#include <wtf/Lock.h>

#include <optional>
#include <unordered_set>
#include <variant>
#include <vector>

extern "C" void Bun__napi_register_cleanup_zig(napi_env env);
extern "C" void Bun__napi_threadsafe_function_env_teardown(void* tsfn);
extern "C" void Bun__napi_run_finalizers_after_teardown_wait(napi_env env);
// False if the VM no longer takes tasks.
extern "C" bool Bun__napi_schedule_pending_finalizers(napi_env env);
// Whether the VM's teardown, with its wait for other threads, follows the exit that runs NapiEnv::cleanup().
extern "C" bool Bun__napi_teardown_follows_exit(napi_env env);
// Whether an addon's uv_close callback was still queued when the VM began to exit.
extern "C" bool Bun__napi_uv_close_was_queued_at_exit(napi_env env);
extern "C" void Bun__napi_suppress_crash_on_abort_if_desired();
extern "C" void Bun__crashHandler(const char* message, size_t message_len);

namespace Zig {
class NapiRef;
}

// What the value constructors/accessors Node gates with CHECK_ENV only run under (NAPI_PREAMBLE_NO_PENDING_CHECK
// in napi.cpp, `ungated!` in napi_body.rs), and the V8 constructors that return a Local: callable with an exception
// pending (stashed for the call; only then, since the restore is unconditional) and never where a worker.terminate()
// / node:vm timeout is delivered (DeferTraps: the next JSC exception check after the call delivers it, as in Node).
// No JS or addon code may run under it.
struct NapiUngatedScope {
    explicit NapiUngatedScope(JSC::VM& vm)
        : deferTraps(vm)
    {
        if (vm.exceptionForInspection()) [[unlikely]]
            suspended.emplace(vm);
    }
    std::optional<JSC::SuspendExceptionScope> suspended;
    JSC::DeferTraps deferTraps;
};

namespace Napi {

static constexpr int DEFAULT_NAPI_VERSION = 10;

struct CleanupHook {
    void* data;
    size_t insertionCounter;

    CleanupHook(void* data, size_t insertionCounter)
        : data(data)
        , insertionCounter(insertionCounter)
    {
    }

    size_t hash() const
    {
        return std::hash<void*> {}(data);
    }
};

struct SyncCleanupHook : CleanupHook {
    void (*function)(void*);

    SyncCleanupHook(void (*function)(void*), void* data, size_t insertionCounter)
        : CleanupHook(data, insertionCounter)
        , function(function)
    {
    }

    bool operator==(const SyncCleanupHook& other) const
    {
        return this == &other || (function == other.function && data == other.data);
    }
};

struct AsyncCleanupHook : CleanupHook {
    napi_async_cleanup_hook function;
    napi_async_cleanup_hook_handle handle = nullptr;

    AsyncCleanupHook(napi_async_cleanup_hook function, napi_async_cleanup_hook_handle handle, void* data, size_t insertionCounter)
        : CleanupHook(data, insertionCounter)
        , function(function)
        , handle(handle)
    {
    }

    bool operator==(const AsyncCleanupHook& other) const
    {
        return this == &other || (function == other.function && data == other.data && handle == other.handle);
    }
};

struct EitherCleanupHook : std::variant<SyncCleanupHook, AsyncCleanupHook> {
    template<typename Self>
    auto& get(this Self& self)
    {
        using Hook = MatchConst<Self, CleanupHook>::type;

        if (auto* sync = std::get_if<SyncCleanupHook>(&self)) {
            return static_cast<Hook&>(*sync);
        }

        return static_cast<Hook&>(std::get<AsyncCleanupHook>(self));
    }

    struct Hash {
        static size_t operator()(const EitherCleanupHook& hook)
        {
            return hook.get().hash();
        }
    };

private:
    template<typename T, typename U>
    struct MatchConst {
        using type = U;
    };

    template<typename T, typename U>
    struct MatchConst<const T, U> {
        using type = const U;
    };
};

using HookSet = std::unordered_set<EitherCleanupHook, EitherCleanupHook::Hash>;

napi_status defineProperty(napi_env env, JSC::JSObject* to, const napi_property_descriptor& property, JSC::ExceptionScope& scope);
}

// Owned by the addon: allocated by napi_add_async_cleanup_hook and freed only
// by napi_remove_async_cleanup_hook, which the addon may call after the hook
// itself has already run (that call is how it signals completion).
struct napi_async_cleanup_hook_handle__ {
    napi_env env;

    explicit napi_async_cleanup_hook_handle__(napi_env env)
        : env(env)
    {
    }
};

#define NAPI_ABORT(message)                                    \
    do {                                                       \
        Bun__napi_suppress_crash_on_abort_if_desired();        \
        Bun__crashHandler(message "", sizeof(message "") - 1); \
    } while (0)

#define NAPI_RELEASE_ASSERT(assertion, ...)                                                                         \
    do {                                                                                                            \
        if (!(assertion)) [[unlikely]] {                                                                            \
            WTFReportAssertionFailureWithMessage(__FILE__, __LINE__, __PRETTY_FUNCTION__, #assertion, __VA_ARGS__); \
            WTFReportBacktrace();                                                                                   \
            NAPI_ABORT("Aborted");                                                                                  \
        }                                                                                                           \
    } while (0)

// Named this way so we can manipulate napi_env values directly (since napi_env is defined as a pointer to struct napi_env__)
struct NapiEnv : public WTF::RefCounted<NapiEnv> {
    WTF_MAKE_STRUCT_TZONE_ALLOCATED(NapiEnv);

public:
    NapiEnv(Zig::GlobalObject* globalObject, const napi_module& napiModule)
        : m_globalObject(globalObject)
        , m_napiModule(napiModule)
        , m_vm(JSC::getVM(globalObject))
        , m_vmHandle(Bun__VmHandle__retainRef(WebCore::clientData(JSC::getVM(globalObject))->vmHandle))
    {
        Bun__napi_register_cleanup_zig(this);
    }

    static Ref<NapiEnv> create(Zig::GlobalObject* globalObject, const napi_module& napiModule)
    {
        return adoptRef(*new NapiEnv(globalObject, napiModule));
    }

    ~NapiEnv()
    {
        // A holder keeps its env alive, so what is left has none: finalizers that were queued and never got a turn.
        while (auto* finalizer = first(m_pendingFinalizers)) {
            ASSERT(!finalizer->hasHolder);
            releaseFinalizer(finalizer);
        }
        ASSERT(m_trackedFinalizers.isEmpty());
        delete[] filename;
        Bun__VmHandle__release(m_vmHandle);
    }

    // This env's own clone of its VM's handle: how a thread holding an env ref
    // (a finalizer fired off the JS thread) posts work to the VM. Lives as long
    // as the env, which can outlive the JSC VM's client data.
    const ::BunVmHandleRef* vmHandle() const { return m_vmHandle; }

    void cleanup()
    {
        // The VM can already have a pending exception when cleanup starts:
        // a Worker torn down via terminate() has JSC's TerminationException
        // set (termination is trap-based, so clearing the exception object
        // does not cancel the termination request -- re-entering JS
        // re-throws it). Cleanup hooks and finalizers are native callbacks
        // with no JS frame above them to catch anything, so, matching
        // Node.js, each starts from a clean exception state. Without this,
        // the first napi call in the first callback that checks the VM
        // (e.g. napi_create_string_utf8 in a node-addon-api ObjectWrap
        // finalizer) fails with napi_pending_exception and the addon's
        // error path escalates to napi_fatal_error. See #30286.
        clearExceptionsBetweenFinalizers();

        m_isCleaningUp = true;
        // Asked before the cleanup hooks run: the close callback of a handle that a hook closes runs after the
        // instance data finalizer, in Node too.
        bool uvCloseQueued = Bun__napi_uv_close_was_queued_at_exit(this);
        // Node runs the finalizers that a collection queued before the env's cleanup hooks: they are immediates,
        // which its environment cleanup runs first.
        drainFinalizers(m_pendingFinalizers);

        while (!m_cleanupHooks.empty()) {
            drain();
        }

        // Threadsafe functions hold a raw pointer to this env's event loop,
        // which a worker's shutdown frees while addon threads keep running.
        // Neutralize them all before that happens (Node: ThreadSafeFunction::Cleanup).
        // Their finalizers are native callbacks like the ones below, so they
        // start from a clean exception state too: a cleanup hook may have left one.
        clearExceptionsBetweenFinalizers();
        abortThreadSafeFunctions();

        // A threadsafe function's finalizer can register a cleanup hook of its
        // own, and the loop above has already run: drain again so it is not
        // dropped on the floor.
        while (!m_cleanupHooks.empty()) {
            drain();
        }
        // erase() above leaves the bucket array allocated; release it here
        // since ~NapiEnv may not run before process exit (late finalizers can
        // hold the last Ref past GlobalObject teardown).
        m_cleanupHooks = Napi::HookSet();
        clearExceptionsBetweenFinalizers();

        // An execute() that is still running can use what a finalizer frees, and a complete() or a uv_close
        // callback that is still queued reads the instance data. The VM's teardown waits for the thread pool and
        // runs the queued callbacks, so the finalizers run after that wait. Node settles its thread pool requests
        // and closes its handles before them too.
        if (m_asyncWorkOnThreadPool.load() || ((m_asyncWorkAwaitingComplete || uvCloseQueued) && Bun__napi_teardown_follows_exit(this))) {
            Bun__napi_run_finalizers_after_teardown_wait(this);
            return;
        }
        runFinalizers();
    }

    // The end of cleanup(): every finalizer the env still has, then the instance data finalizer. Node keeps the
    // instance data on the same list as the values, at the place where napi_set_instance_data was called. Here it
    // is always last, so that no finalizer of the addon finds its instance data freed.
    void runFinalizers()
    {
        // A cleanup hook may itself have leaked an exception; the first
        // finalizer starts clean too.
        clearExceptionsBetweenFinalizers();
        drainFinalizers(m_pendingFinalizers, m_trackedFinalizers);

        instanceDataFinalizer.call(this, instanceData);
        instanceDataFinalizer.clear();
        // napi_get_instance_data is ungated: never hand out the finalized pointer.
        instanceData = nullptr;
        clearExceptionsBetweenFinalizers();

        // What the instance data finalizer posted or registered still runs, as in Node.
        drainFinalizers(m_pendingFinalizers, m_trackedFinalizers);
        m_isTornDown = true;
    }

    // JS thread, when async work goes to the thread pool.
    void asyncWorkEnteredThreadPool()
    {
        m_asyncWorkOnThreadPool++;
        m_asyncWorkAwaitingComplete++;
    }
    // Pool thread, once execute() has returned or the work was cancelled.
    void asyncWorkLeftThreadPool() { m_asyncWorkOnThreadPool--; }
    // JS thread, once complete() has returned.
    void asyncWorkCompleted() { m_asyncWorkAwaitingComplete--; }

    // Threadsafe-function registry. Entries are raw ThreadSafeFunction* owned
    // by the Rust side, added and removed on the JS thread only: at creation,
    // by the destroy path (an event-loop task), and by teardown below. The
    // lock guards the torn-down flag so the "created after teardown" case is
    // decided in one critical section.
    bool registerThreadSafeFunction(void* tsfn)
    {
        WTF::Locker locker { m_threadSafeFunctionsLock };
        if (m_threadSafeFunctionsTornDown) {
            return false;
        }
        m_threadSafeFunctions.add(tsfn);
        return true;
    }

    void unregisterThreadSafeFunction(void* tsfn)
    {
        WTF::Locker locker { m_threadSafeFunctionsLock };
        m_threadSafeFunctions.remove(tsfn);
    }

    void abortThreadSafeFunctions()
    {
        WTF::HashSet<void*> tsfns;
        {
            WTF::Locker locker { m_threadSafeFunctionsLock };
            m_threadSafeFunctionsTornDown = true;
            tsfns = std::exchange(m_threadSafeFunctions, WTF::HashSet<void*> {});
        }
        for (void* tsfn : tsfns) {
            Bun__napi_threadsafe_function_env_teardown(tsfn);
        }
    }

    // The env owns each finalize_cb from the call that registers it until the callback has run, as Node's env
    // does. `m_trackedFinalizers` (Node's finalizing_reflist) has the finalizers of the values that are alive,
    // newest first. When a value is collected its finalizer moves to `m_pendingFinalizers` (Node's
    // pending_finalizers), and the event loop runs one of those per turn. cleanup() runs what both lists still
    // hold before the instance data finalizer. After that nothing of the addon runs.

    // Registers `callback` for a value. The caller is the finalizer's holder: it keeps the pointer, and gives it
    // back through finalizerValueCollected() or releaseFinalizer().
    Bun::NapiTrackedFinalizer* trackFinalizer(napi_finalize callback, void* data, void* hint)
    {
        auto* finalizer = new Bun::NapiTrackedFinalizer(callback, data, hint);
        m_trackedFinalizers.push(finalizer);
        return finalizer;
    }

    enum class FinalizerHolder : bool {
        // The holder is gone, or goes with its value.
        Released,
        // A napi_ref that the addon owns: it still calls releaseFinalizer(), and that cancels a queued finalizer
        // (Node's ~ReferenceWithFinalizer).
        Kept,
    };

    // The holder's value was collected, or its bytes were freed: runs the finalizer now, or on a later turn of the
    // loop, whichever the module's Node-API version asks for. Also called from the collector thread.
    void finalizerValueCollected(Bun::NapiTrackedFinalizer* finalizer, FinalizerHolder holder)
    {
        assertFinalizerListsAreStable();
        finalizer->hasHolder = holder == FinalizerHolder::Kept;
        if (!finalizer->callback || m_isTornDown) {
            // cleanup() has run it, or has finished.
            finalizer->callback = nullptr;
            if (finalizer->isOnList())
                finalizer->remove();
            if (!finalizer->hasHolder)
                delete finalizer;
            return;
        }
        if (mustQueueFinalizer()) {
            if (finalizer->isOnList())
                finalizer->remove();
            m_pendingFinalizers.append(finalizer);
            schedulePendingFinalizers();
            return;
        }
        runFinalizer(*finalizer);
        throwPendingException();
    }

    // The holder goes away while its value is alive (napi_delete_reference), or takes its callback back
    // (napi_remove_wrap). A finalizer that has not run yet does not run.
    static void releaseFinalizer(Bun::NapiTrackedFinalizer* finalizer)
    {
        if (finalizer->isOnList())
            finalizer->remove();
        delete finalizer;
    }

    // Stops cleanup() from running the finalizer of a value that is still alive: it runs only when the value is
    // collected. For a value whose data other threads read for as long as it is alive.
    static void finalizeOnlyWhenCollected(Bun::NapiTrackedFinalizer* finalizer)
    {
        if (finalizer->isOnList())
            finalizer->remove();
    }

    // node_api_post_finalizer, and the deferred finalizer of a value that the env does not track.
    void postFinalizer(napi_finalize callback, void* data, void* hint)
    {
        assertFinalizerListsAreStable();
        if (m_isTornDown)
            return;
        auto* finalizer = new Bun::NapiTrackedFinalizer(callback, data, hint);
        finalizer->hasHolder = false;
        m_pendingFinalizers.append(finalizer);
        schedulePendingFinalizers();
    }

    // The event loop's turn for this env (NapiEnv::run_pending_finalizer in napi_body.rs): one finalizer. The next
    // turn is queued before the call, because the finalizer can do anything, including end the VM.
    void runPendingFinalizerFromLoop()
    {
        m_pendingFinalizersScheduled = false;
        auto* finalizer = first(m_pendingFinalizers);
        if (!finalizer)
            return;
        finalizer->remove();
        if (!m_pendingFinalizers.isEmpty())
            schedulePendingFinalizers();
        runFinalizer(*finalizer);
    }

    // The queued turn was released without running. Its finalizers stay here for cleanup().
    void pendingFinalizersTurnReleased()
    {
        m_pendingFinalizersScheduled = false;
        deref();
    }

    /// Will abort the process if a duplicate entry would be added.
    /// This matches Node.js behavior which always crashes on duplicates.
    void addCleanupHook(void (*function)(void*), void* data)
    {
        // Always check for duplicates like Node.js CHECK_EQ
        // See: node/src/cleanup_queue-inl.h:24 (CHECK_EQ runs in all builds)
        for (const auto& hook : m_cleanupHooks) {
            if (auto* sync = std::get_if<Napi::SyncCleanupHook>(&hook)) {
                NAPI_RELEASE_ASSERT(function != sync->function || data != sync->data, "Attempted to add a duplicate NAPI environment cleanup hook");
            }
        }

        m_cleanupHooks.emplace(Napi::SyncCleanupHook(function, data, ++m_cleanupHookCounter));
    }

    void removeCleanupHook(void (*function)(void*), void* data)
    {
        for (auto iter = m_cleanupHooks.begin(), end = m_cleanupHooks.end(); iter != end; ++iter) {
            if (auto* sync = std::get_if<Napi::SyncCleanupHook>(&*iter)) {
                if (sync->function == function && sync->data == data) {
                    m_cleanupHooks.erase(iter);
                    return;
                }
            }
        }

        // Node.js silently ignores removal of non-existent hooks
        // See: node/src/cleanup_queue-inl.h:27-30
    }

    napi_async_cleanup_hook_handle addAsyncCleanupHook(napi_async_cleanup_hook function, void* data)
    {
        // Always check for duplicates like Node.js CHECK_EQ
        // Node.js async cleanup hooks also use the same CleanupQueue with CHECK_EQ
        for (const auto& hook : m_cleanupHooks) {
            if (auto* async = std::get_if<Napi::AsyncCleanupHook>(&hook)) {
                NAPI_RELEASE_ASSERT(function != async->function || data != async->data, "Attempted to add a duplicate async NAPI environment cleanup hook");
            }
        }

        auto handle = std::make_unique<napi_async_cleanup_hook_handle__>(this);

        bool inserted = m_cleanupHooks.emplace(Napi::AsyncCleanupHook(function, handle.get(), data, ++m_cleanupHookCounter)).second;
        NAPI_RELEASE_ASSERT(inserted, "Attempted to add a duplicate async NAPI environment cleanup hook");
        return handle.release();
    }

    // The caller has already rejected null handles (napi_invalid_arg).
    void removeAsyncCleanupHook(napi_async_cleanup_hook_handle handle)
    {
        for (auto iter = m_cleanupHooks.begin(), end = m_cleanupHooks.end(); iter != end; ++iter) {
            if (auto* async = std::get_if<Napi::AsyncCleanupHook>(&*iter)) {
                if (async->handle == handle) {
                    m_cleanupHooks.erase(iter);
                    break;
                }
            }
        }

        // Freed unconditionally, matching Node: for an already-drained hook
        // this call is the addon's completion signal.
        delete handle;
    }

    bool inGC() const
    {
        return this->vm().isCollectorBusyOnCurrentThread();
    }

    void checkGC() const
    {
        // Only enforce GC checks for experimental NAPI versions, matching Node.js behavior
        // See: https://github.com/nodejs/node/blob/main/src/js_native_api_v8.h#L132-L143
        if (m_napiModule.nm_version == NAPI_VERSION_EXPERIMENTAL) {
            if (inGC()) {
                fprintf(stderr, "FATAL ERROR: Finalizer is calling a function that may affect GC state.\n");
                fprintf(stderr, "The finalizers are run directly from GC and must not affect GC state.\n");
                fprintf(stderr, "Use `node_api_post_finalizer` from inside of the finalizer to work around this issue.\n");
                fprintf(stderr, "It schedules the call as a new task in the event loop.\n");
                fflush(stderr);
                NAPI_ABORT("A Node-API function that may affect GC state was called from a finalizer during garbage collection");
            }
        }
    }

    // The finalizer of a value that the env does not track: an external string.
    void doFinalizer(napi_finalize finalize_cb, void* data, void* finalize_hint)
    {
        if (!finalize_cb) {
            return;
        }

        if (mustQueueFinalizer()) {
            postFinalizer(finalize_cb, data, finalize_hint);
        } else {
            finalize_cb(this, data, finalize_hint);
            throwPendingException();
        }
    }

    void scheduleException(JSC::JSValue exception)
    {
        if (exception.isEmpty()) {
            m_pendingException.clear();
        }

        m_pendingException.set(m_vm, exception);
    }

    bool throwPendingException()
    {
        if (!m_pendingException) {
            return false;
        }

        auto scope = DECLARE_THROW_SCOPE(m_vm);
        JSC::throwException(globalObject(), scope, m_pendingException.get());
        m_pendingException.clear();
        return true;
    }

    void clearPendingException()
    {
        m_pendingException.clear();
    }

    bool hasPendingException() const
    {
        return static_cast<bool>(m_pendingException);
    }

    inline Zig::GlobalObject* globalObject() const { return m_globalObject; }
    // `bun test --isolate` creates a fresh Zig::GlobalObject per file and
    // gcUnprotect()s the previous one. NapiEnv outlives its owning global —
    // the queued turn for its pending finalizers holds a Ref<NapiEnv> and runs
    // on the event loop *after* the swap. It opens a NapiHandleScope via
    // env->globalObject(), which would write m_currentHandleScopeImpl on
    // the now-dead old global and trip a write barrier on an unmarked cell
    // (debug: `ASSERT(isMarked(cell))` in Heap::addToRememberedSet; release:
    // segfault when the marker later walks it). The isolation swap calls this
    // to point surviving envs at the new global before unprotecting the old
    // one.
    inline void retargetGlobalObject(Zig::GlobalObject* newGlobal)
    {
        ASSERT(&JSC::getVM(newGlobal) == &m_vm);
        m_globalObject = newGlobal;
    }
    inline const napi_module& napiModule() const { return m_napiModule; }
    inline JSC::VM& vm() const { return m_vm; }
    inline std::optional<JSC::JSValue> pendingException() const
    {
        if (!m_pendingException) {
            return std::nullopt;
        }
        return m_pendingException.get();
    }

    // Returns true if finalizers from this module need to be scheduled for the next tick after garbage collection, instead of running during garbage collection
    inline bool mustDeferFinalizers() const
    {
        return m_napiModule.nm_version != NAPI_VERSION_EXPERIMENTAL;
    }

    // Whether a finalizer whose value the collector just found has to wait for a turn of the loop. A collection's
    // end phase can run on the collector thread; an addon's finalizer only ever runs on the JS thread.
    inline bool mustQueueFinalizer() const
    {
        return inGC() && (mustDeferFinalizers() || WTF::Thread::mayBeGCThread());
    }

    inline bool isFinishingFinalizers() const { return m_isFinishingFinalizers; }

    // Node's env->can_call_into_js(). False for the whole of cleanup(): on_exit() stops the handle first.
    // And while a completion runs for a Bun.ModuleGraph context that has stopped (see below).
    inline bool canCallIntoJS() const
    {
        return !m_isCompletingForStoppedContext && !WebCore::clientData(m_vm)->isStoppingOrStopped(m_vm);
    }

    // The status of a call that Node refuses because !can_call_into_js().
    inline napi_status cannotCallIntoJSStatus() const
    {
        return m_napiModule.nm_version >= 10 ? napi_cannot_run_js : napi_pending_exception;
    }

    // Node's NAPI_PREAMBLE entry check, in its order. The VM's slot is read raw: a JSC exception check would service
    // the traps and deliver a worker.terminate() under addon frames, where V8 never does. A termination that is
    // already pending answers as the closed gate does.
    inline napi_status entryStatus(JSC::TopExceptionScope& scope) const
    {
        if (m_pendingException) [[unlikely]] {
            return napi_pending_exception;
        }
        if (auto* exception = scope.exception()) [[unlikely]] {
            return m_vm.isTerminationException(exception) ? cannotCallIntoJSStatus() : napi_pending_exception;
        }
        if (!canCallIntoJS()) [[unlikely]] {
            return cannotCallIntoJSStatus();
        }
        return napi_ok;
    }

    // Almost all NAPI functions should set error_code to the status they're returning right before
    // they return it
    napi_extended_error_info m_lastNapiErrorInfo = {
        .error_message = "",
        // Not currently used by Bun -- always nullptr
        .engine_reserved = nullptr,
        // Not currently used by Bun -- always zero
        .engine_error_code = 0,
        .error_code = napi_ok,
    };

    void* instanceData = nullptr;
    Bun::NapiFinalizer instanceDataFinalizer;
    char* filename = nullptr;
    // Running total reported via napi_adjust_external_memory. JSC's
    // deprecatedReportExtraMemory has no decrement path, so we keep a signed
    // accumulator and only forward positive growth to the JSC heap. Tracked
    // per env (per loaded module), not per isolate as in V8; the documented
    // +N/-N addon pattern only observes its own deltas.
    int64_t m_externalMemory = 0;

private:
    Zig::GlobalObject* m_globalObject = nullptr;
    napi_module m_napiModule;
    using FinalizerList = WTF::SentinelLinkedList<Bun::NapiTrackedFinalizer, WTF::BasicRawSentinelNode<Bun::NapiTrackedFinalizer>>;
    FinalizerList m_trackedFinalizers;
    FinalizerList m_pendingFinalizers;
    // A turn of the event loop is queued for `m_pendingFinalizers`. It holds a ref to this env.
    bool m_pendingFinalizersScheduled = false;
    bool m_isFinishingFinalizers = false;
    // cleanup() has started. It runs the pending finalizers itself, so no more turns are queued for them
    // (Node's `destructing`).
    bool m_isCleaningUp = false;
    // cleanup() has run the instance data finalizer.
    bool m_isTornDown = false;

public:
    // Set while a completion (async work's complete, a threadsafe function's call_js) runs for a
    // Bun.ModuleGraph context that has stopped. The addon's callback has to run, since it owns
    // memory only it can free; what it may not do is run that graph's script.
    bool m_isCompletingForStoppedContext = false;

private:
    JSC::VM& m_vm;
    const ::BunVmHandleRef* m_vmHandle;
    Napi::HookSet m_cleanupHooks;
    JSC::Strong<JSC::Unknown> m_pendingException;
    size_t m_cleanupHookCounter = 0;

    WTF::Lock m_threadSafeFunctionsLock;
    WTF::HashSet<void*> m_threadSafeFunctions WTF_GUARDED_BY_LOCK(m_threadSafeFunctionsLock);
    bool m_threadSafeFunctionsTornDown WTF_GUARDED_BY_LOCK(m_threadSafeFunctionsLock) = false;
    std::atomic<unsigned> m_asyncWorkOnThreadPool { 0 };
    // Async work that was queued and whose complete() has not returned yet. JS thread only.
    unsigned m_asyncWorkAwaitingComplete { 0 };

    static Bun::NapiTrackedFinalizer* first(FinalizerList& list)
    {
        return list.isEmpty() ? nullptr : &*list.begin();
    }

    // The collector thread changes the lists too, while it finishes a collection. The JS thread is stopped then,
    // or waits for its access to the heap.
    void assertFinalizerListsAreStable() const
    {
        ASSERT(!WTF::Thread::mayBeGCThread() || m_vm.heap.worldIsStopped());
    }

    void schedulePendingFinalizers()
    {
        if (m_pendingFinalizersScheduled || m_isCleaningUp)
            return;
        m_pendingFinalizersScheduled = true;
        ref();
        if (!Bun__napi_schedule_pending_finalizers(this)) {
            m_pendingFinalizersScheduled = false;
            deref();
        }
    }

    // The finalizer leaves its list before the call. The callback can release it (napi_delete_reference), and can
    // register or post other finalizers.
    void runFinalizer(Bun::NapiTrackedFinalizer& finalizer)
    {
        napi_finalize callback = std::exchange(finalizer.callback, nullptr);
        void* data = finalizer.data;
        void* hint = finalizer.hint;
        if (finalizer.isOnList())
            finalizer.remove();
        if (!finalizer.hasHolder)
            delete &finalizer;
        callback(this, data, hint);
    }

    // cleanup() runs every finalizer of `lists`, and what those finalizers add to them: the first of the first
    // list that has one. For the tracked list that is the newest registration, so children go before parents
    // (Node.js LIFO).
    template<typename... Lists>
    void drainFinalizers(Lists&... lists)
    {
        m_isFinishingFinalizers = true;
        for (;;) {
            Bun::NapiTrackedFinalizer* finalizer = nullptr;
            ((finalizer = first(lists)) || ...);
            if (!finalizer)
                break;
            {
                Bun::NapiHandleScope handle_scope(m_globalObject);
                runFinalizer(*finalizer);
            }
            // Each finalizer starts from a clean exception state: Node.js
            // never propagates one finalizer's throw into the next (there
            // is no JS frame to catch in between). Leaving a pending
            // exception also breaks later finalizers in subtle ways --
            // napi_is_exception_pending skips the VM check during cleanup
            // for safety, so user code thinks there is no exception, but
            // the next napi call with a throw scope sees it. See #30286.
            clearExceptionsBetweenFinalizers();
        }
        m_isFinishingFinalizers = false;
    }

    // Drop any pending exception -- VM-scope or env-scope -- between
    // finalizers run from cleanup(). Used by cleanup() only. Defined
    // out-of-line in napi.cpp so its uses of JSC::TopExceptionScope
    // (which has JS_EXPORT_PRIVATE ctor/dtor under
    // ENABLE_EXCEPTION_SCOPE_VERIFICATION) are confined to one TU.
    void clearExceptionsBetweenFinalizers();

    // Returns a vector of hooks in reverse order of insertion.
    std::vector<Napi::EitherCleanupHook> getHooks() const
    {
        std::vector<Napi::EitherCleanupHook> hooks(m_cleanupHooks.begin(), m_cleanupHooks.end());
        std::sort(hooks.begin(), hooks.end(), [](const Napi::EitherCleanupHook& left, const Napi::EitherCleanupHook& right) {
            return left.get().insertionCounter > right.get().insertionCounter;
        });
        return hooks;
    }

    void drain()
    {
        std::vector<Napi::EitherCleanupHook> hooks = getHooks();

        for (const Napi::EitherCleanupHook& hook : hooks) {
            if (auto set_iter = m_cleanupHooks.find(hook); set_iter != m_cleanupHooks.end()) {
                m_cleanupHooks.erase(set_iter);
            } else {
                // Already removed during removal of a different cleanup hook
                continue;
            }

            if (auto* sync = std::get_if<Napi::SyncCleanupHook>(&hook)) {
                ASSERT(sync->function != nullptr);
                sync->function(sync->data);
            } else {
                auto& async = std::get<Napi::AsyncCleanupHook>(hook);
                ASSERT(async.function != nullptr);
                // The addon owns the handle and frees it via
                // napi_remove_async_cleanup_hook, possibly after this returns (#37201).
                async.function(async.handle, async.data);
            }
            // Same invariant as the finalizer loop in cleanup(): a hook
            // that leaked an exception must not poison the next hook.
            clearExceptionsBetweenFinalizers();
        }
    }
};

extern "C" void Bun__napi_cleanup_env_cpp(napi_env);

namespace Napi {

class NapiRefWeakHandleOwner final : public JSC::WeakHandleOwner {
public:
    // Equivalent to v8impl::Ownership::kUserland
    FinalizeResult finalize(JSC::Handle<JSC::Unknown>, void* context) final;

    static NapiRefWeakHandleOwner& weakValueHandleOwner()
    {
        static NeverDestroyed<NapiRefWeakHandleOwner> jscWeakValueHandleOwner;
        return jscWeakValueHandleOwner;
    }
};

class NapiRefSelfDeletingWeakHandleOwner final : public JSC::WeakHandleOwner {
public:
    // Equivalent to v8impl::Ownership::kRuntime
    FinalizeResult finalize(JSC::Handle<JSC::Unknown>, void* context) final;

    static NapiRefSelfDeletingWeakHandleOwner& weakValueHandleOwner()
    {
        static NeverDestroyed<NapiRefSelfDeletingWeakHandleOwner> jscWeakValueHandleOwner;
        return jscWeakValueHandleOwner;
    }
};

// If a module registered itself by calling napi_module_register in a static constructor, run this
// to run the module's entrypoint with moduleObject as `module`. Throws on failure.
void executePendingNapiModule(Zig::GlobalObject* globalObject, const napi_module& mod, void* dlopenHandle, JSC::JSObject* moduleObject);

}

namespace Zig {
using namespace JSC;

static inline JSValue toJS(napi_value val)
{
    return JSC::JSValue::decode(reinterpret_cast<JSC::EncodedJSValue>(val));
}

static inline Zig::GlobalObject* toJS(napi_env val)
{
    return val->globalObject();
}

static inline napi_value toNapi(JSC::JSValue val, Zig::GlobalObject* globalObject)
{
    if (val.isCell()) {
        if (auto* scope = globalObject->m_currentHandleScopeImpl.get()) {
            scope->append(val);
        }
    }
    return reinterpret_cast<napi_value>(JSC::JSValue::encode(val));
}

// This is essentially JSC::JSWeakValue, except with a JSCell* instead of a
// JSObject*. Sometimes, a napi embedder might want to store a JSC::Exception, a
// JSC::HeapBigInt, JSC::Symbol, etc inside of a NapiRef. So we can't limit it
// to just JSObject*. It has to be JSCell*. It's not clear that we benefit from
// not simply making this JSC::Unknown.
class NapiWeakValue {
public:
    NapiWeakValue() = default;
    ~NapiWeakValue();

    void clear();
    bool isClear() const;

    void setPrimitive(JSValue);
    void setCell(JSCell*, WeakHandleOwner&, void* context);
    void setString(JSString*, WeakHandleOwner&, void* context);
    void set(JSValue, WeakHandleOwner&, void* context);

    JSValue get() const
    {
        switch (m_tag) {
        case WeakTypeTag::Primitive:
            return m_value.primitive;
        case WeakTypeTag::Cell:
            return m_value.cell.get();
        case WeakTypeTag::String:
            return m_value.string.get();
        default:
            return {};
        }
    }

private:
    enum class WeakTypeTag { NotSet,
        Primitive,
        Cell,
        String };

    WeakTypeTag m_tag { WeakTypeTag::NotSet };

    union WeakValueUnion {
        WeakValueUnion()
            : primitive(JSValue())
        {
        }

        ~WeakValueUnion()
        {
            ASSERT(!primitive);
        }

        JSValue primitive;
        JSC::Weak<JSCell> cell;
        JSC::Weak<JSString> string;
    } m_value;
};

class NapiRef {
    WTF_MAKE_TZONE_ALLOCATED(NapiRef);

public:
    void ref();
    void unref();

    NapiRef(Ref<NapiEnv>&& env, uint32_t count)
        : env(env)
        , globalObject(JSC::Weak<JSC::JSGlobalObject>(env->globalObject()))
        , refCount(count)
    {
    }

    JSC::JSValue value() const
    {
        if (refCount == 0 && !m_isEternal) {
            return weakValueRef.get();
        }

        return strongRef.get();
    }

    void setValueInitial(JSC::JSValue value, bool can_be_weak)
    {
        if (refCount > 0) {
            strongRef.set(globalObject->vm(), value);
        }

        // Like Node's Reference::SetWeak(), a value that cannot be held weakly is released once the count reaches zero.
        if (can_be_weak) {
            weakValueRef.set(value, Napi::NapiRefWeakHandleOwner::weakValueHandleOwner(), this);
        }

        if (value.isSymbol()) {
            auto* symbol = dynamicDowncast<JSC::Symbol>(value);
            ASSERT(symbol != nullptr);
            if (symbol->uid().isRegistered()) {
                // Global symbols must always be retrievable,
                // even if garbage collection happens while the ref count is 0.
                m_isEternal = true;
                if (refCount == 0) {
                    strongRef.set(globalObject->vm(), symbol);
                }
            }
        }
    }

    ~NapiRef()
    {
        NAPI_LOG("destruct napi ref %p", this);
        if (finalizer) {
            NapiEnv::releaseFinalizer(finalizer);
        }

        if (!m_isEternal) {
            strongRef.clear();
        }

        // The weak ref can lead to calling the destructor
        // so we must first clear the weak ref before we call the finalizer
        weakValueRef.clear();
    }

    WTF::Ref<NapiEnv> env;
    JSC::Weak<JSC::JSGlobalObject> globalObject;
    NapiWeakValue weakValueRef;
    JSC::Strong<JSC::Unknown> strongRef;
    // The finalize_cb of napi_wrap or napi_add_finalizer. This ref is its holder.
    Bun::NapiTrackedFinalizer* finalizer = nullptr;
    void* nativeObject = nullptr;
    uint32_t refCount = 0;
    bool releaseOnWeaken = false;

private:
    bool m_isEternal = false;
};

static inline napi_ref toNapi(NapiRef* val)
{
    return reinterpret_cast<napi_ref>(val);
}

class NapiClass final : public JSC::JSFunction {
public:
    using Base = JSFunction;

    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = DoesNotNeedDestruction;

    template<typename, SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<NapiClass, WebCore::UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForNapiClass, m_subspaceForNapiClass));
    }

    DECLARE_EXPORT_INFO;

    JS_EXPORT_PRIVATE static NapiClass* create(VM&, napi_env, WTF::String name,
        napi_callback constructor,
        void* data,
        size_t property_count,
        const napi_property_descriptor* properties,
        napi_status* propertyStatus = nullptr);

    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
    {
        ASSERT(globalObject);
        return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(JSFunctionType, StructureFlags), info());
    }

    inline napi_callback constructor() const { return m_constructor; }
    inline void*& dataPtr() { return m_dataPtr; }
    inline void* const& dataPtr() const { return m_dataPtr; }
    inline napi_env env() const { return m_env; }

private:
    NapiClass(VM& vm, NativeExecutable* executable, napi_env env, Structure* structure, void* data)
        : Base(vm, executable, env->globalObject(), structure)
        , m_dataPtr(data)
        , m_env(env)
    {
    }

    napi_status finishCreation(VM&, const String& name, napi_callback constructor,
        void* data,
        size_t property_count,
        const napi_property_descriptor* properties);

    void* m_dataPtr = nullptr;
    napi_callback m_constructor = nullptr;
    napi_env m_env = nullptr;

    DECLARE_VISIT_CHILDREN;
};

class NapiPrototype : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;

    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = NeedsDestruction;

    template<typename CellType, SubspaceAccess>
    static CompleteSubspace* subspaceFor(VM& vm)
    {
        return &vm.destructibleObjectSpace();
    }

    DECLARE_INFO;

    static NapiPrototype* create(VM& vm, Structure* structure)
    {
        NapiPrototype* footprint = new (NotNull, allocateCell<NapiPrototype>(vm)) NapiPrototype(vm, structure);
        footprint->finishCreation(vm);
        return footprint;
    }

    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
    {
        ASSERT(globalObject);
        return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(ObjectType, StructureFlags), info());
    }

    NapiPrototype* subclass(JSC::JSGlobalObject* globalObject, JSC::JSObject* newTarget)
    {
        VM& vm = globalObject->vm();
        Structure* structure = JSC::InternalFunction::createSubclassStructure(globalObject, newTarget, this->structure());
        if (!structure) {
            return nullptr;
        }
        return NapiPrototype::create(vm, structure);
    }

    NapiRef* napiRef = nullptr;

private:
    NapiPrototype(VM& vm, Structure* structure)
        : Base(vm, structure)
    {
    }
};

static inline NapiRef* toJS(napi_ref val)
{
    return reinterpret_cast<NapiRef*>(val);
}

extern "C" napi_status napi_set_last_error(napi_env env, napi_status status);
class NAPICallFrame {
public:
    NAPICallFrame(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame, void* dataPtr, JSValue storedNewTarget)
        : NAPICallFrame(globalObject, callFrame, dataPtr)
    {
        m_storedNewTarget = storedNewTarget;
        m_isConstructorCall = !m_storedNewTarget.isEmpty();
    }

    NAPICallFrame(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame, void* dataPtr)
        : m_callFrame(callFrame)
        , m_dataPtr(dataPtr)
    {
        // Node-API function calls always run in "sloppy mode," even if the JS side is in strict mode.
        // Not a ThrowScope: its simulated throw would reach the addon's first NAPI_PREAMBLE unchecked.
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(JSC::getVM(globalObject));
        JSValue jscThis = m_callFrame->thisValue().toThis(globalObject, JSC::ECMAMode::sloppy());
        scope.assertNoException();
        m_callFrame->setThisValue(jscThis);
    }

    JSValue thisValue() const
    {
        return m_callFrame->thisValue();
    }

    napi_callback_info toNapi()
    {
        return reinterpret_cast<napi_callback_info>(this);
    }

    ALWAYS_INLINE void* dataPtr() const
    {
        return m_dataPtr;
    }

    void extract(size_t* argc, // [in-out] Specifies the size of the provided argv array
                               // and receives the actual count of args.
        napi_value* argv, // [out] Array of values
        napi_value* this_arg, // [out] Receives the JS 'this' arg for the call
        void** data, Zig::GlobalObject* globalObject);

    JSValue newTarget()
    {
        if (!m_isConstructorCall) {
            return JSValue();
        }

        if (m_storedNewTarget.isUndefined()) {
            // napi_get_new_target:
            // "This API returns the new.target of the constructor call. If the current callback
            // is not a constructor call, the result is NULL."
            // they mean a null pointer, not JavaScript null
            return JSValue();
        } else {
            return m_storedNewTarget;
        }
    }

private:
    JSC::CallFrame* m_callFrame;
    void* m_dataPtr;
    JSValue m_storedNewTarget;
    bool m_isConstructorCall = false;
};

}
