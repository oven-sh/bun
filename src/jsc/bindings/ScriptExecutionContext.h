#pragma once

#include "root.h"

struct BunVmHandleRef;
#include "BunLoopKind.h"
#include "SharedEnvStore.h"
#include <wtf/Function.h>
#include <wtf/HashSet.h>
#include <wtf/ObjectIdentifier.h>
#include <wtf/WeakHashSet.h>
#include <wtf/WeakPtr.h>
#include <wtf/text/WTFString.h>
#include <wtf/CompletionHandler.h>
#include "CachedScript.h"
#include "wtf/ThreadSafeWeakPtr.h"
#include <wtf/URL.h>

namespace uWS {
template<bool isServer, bool isClient, typename UserData>
struct WebSocketContext;
}

struct us_socket_t;
struct us_socket_group_t;
struct us_loop_t;

namespace Zig {
class GlobalObject;
}

namespace WebCore {

class WebSocket;

class ScriptExecutionContext;
class EventLoopTask;

class ActiveDOMObject;
class ContextDestructionObserver;

using ScriptExecutionContextIdentifier = uint32_t;

#if ENABLE(MALLOC_BREAKDOWN)
DECLARE_ALLOCATOR_WITH_HEAP_IDENTIFIER(ScriptExecutionContext);
#endif
class ScriptExecutionContext : public CanMakeWeakPtr<ScriptExecutionContext>, public RefCounted<ScriptExecutionContext> {
#if ENABLE(MALLOC_BREAKDOWN)
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED_WITH_HEAP_IDENTIFIER(ScriptExecutionContext, ScriptExecutionContext);
#else
    WTF_MAKE_TZONE_ALLOCATED(ScriptExecutionContext);
#endif

public:
    ScriptExecutionContext(JSC::VM* vm, Zig::GlobalObject* globalObject);
    ScriptExecutionContext(JSC::VM* vm, Zig::GlobalObject* globalObject, ScriptExecutionContextIdentifier identifier);

    ~ScriptExecutionContext();

    static ScriptExecutionContextIdentifier generateIdentifier();

    JSC::JSGlobalObject* jsGlobalObject();

    static ScriptExecutionContext* getScriptExecutionContext(ScriptExecutionContextIdentifier identifier);
    void refEventLoop();
    void unrefEventLoop();
    using RefCounted::deref;
    using RefCounted::ref;

    const WTF::URL& url() const
    {
        return m_url;
    }
    bool isMainThread() const { return m_identifier == 1; }
    bool isContextThread();

    // Active objects are not garbage collected even if inaccessible, e.g. because their activity may result in callbacks being invoked.
    void stopActiveDOMObjects();
    // Also read on the GC thread (isContextStopped() from isReachableFromOpaqueRoots).
    bool activeDOMObjectsAreStopped() const { return m_activeDOMObjectsAreStopped.load(std::memory_order_relaxed); }

    // Called from the constructor and destructors of ActiveDOMObject.
    void didCreateActiveDOMObject(ActiveDOMObject&);
    void willDestroyActiveDOMObject(ActiveDOMObject&);

    // Called once after an ActiveDOMObject is constructed: stops it if this context already stopped.
    void suspendActiveDOMObjectIfNeeded(ActiveDOMObject&);

    enum class ShouldContinue : bool { No,
        Yes };
    void forEachActiveDOMObject(NOESCAPE const Function<ShouldContinue(ActiveDOMObject&)>&) const;

    // WorkerOrWorkletGlobalScope::prepareForDestruction(): the one point, while script may still
    // run, where every ActiveDOMObject is stopped and every listener on context-owned targets is
    // removed. Runs before VM teardown, and when a live VM retires this context's global.
    void prepareForDestruction();
    void removeAllEventListeners();
    // The owning Zig::GlobalObject cell is being destroyed; from here on there is no global/VM.
    void globalObjectDestroyed();

    bool isJSExecutionForbidden();
    void reportException(const String& errorMessage, int lineNumber, int columnNumber, const String& sourceURL, JSC::Exception* exception, RefPtr<void*>&&, CachedScript* = nullptr, bool = false)
    {
    }
    // `loopKind`: which of the target VM's loops the task joins — currentLoopKind() captured on the
    // target's thread when the work whose completion this is was initiated, or Regular for work no
    // script there initiated.
    WEBCORE_EXPORT static bool postTaskTo(ScriptExecutionContextIdentifier identifier, BunLoopKind loopKind, Function<void(ScriptExecutionContext&)>&& task);
    WEBCORE_EXPORT static bool ensureOnContextThread(ScriptExecutionContextIdentifier, Function<void(ScriptExecutionContext&)>&& task);

    WEBCORE_EXPORT JSC::JSGlobalObject* globalObject();

    void didCreateDestructionObserver(ContextDestructionObserver&);
    void willDestroyDestructionObserver(ContextDestructionObserver&);

    void checkConsistency() const;

    void regenerateIdentifier();
    void addToContextsMap();
    void removeFromContextsMap();

    void postTaskConcurrently(Function<void(ScriptExecutionContext&)>&& lambda);
    // Executes the task on context's thread asynchronously.
    void postTask(Function<void(ScriptExecutionContext&)>&& lambda);
    // Executes the task on context's thread asynchronously.
    void postTask(EventLoopTask* task);
    void postTaskAfterYield(Function<void(ScriptExecutionContext&)>&& lambda);

    JSC::VM& vm() { return *m_vm; }
    ScriptExecutionContextIdentifier identifier() const { return m_identifier; }
    // This thread only: the loop the VM is running now. What an object that will later be posted to
    // from another thread records alongside identifier() when script here sets it up.
    BunLoopKind currentLoopKind()
    {
        ASSERT(isContextThread());
        return Bun__VM__currentLoopKind(m_bunVM);
    }

    // Set once when the context is permanently shutting down (WebWorker__teardownJSCVM).
    // Unlike VM::hasTerminationRequest(), never set transiently (node:vm {timeout}).
    // Takes allScriptExecutionContextsMapLock so it serializes with postTaskTo's
    // check-then-enqueue; a caller that drains the concurrent queue after this
    // returns will observe every task enqueued before the flag flipped.
    void markTerminating();
    bool isTerminating() const { return m_isTerminating.load(std::memory_order_acquire); }

    // Non-null once this thread joins a `worker_threads` SHARE_ENV tree; every
    // thread in the tree holds a ref to the same store.
    Bun::SharedEnvStore* sharedEnvStore() const { return m_sharedEnvStore.get(); }
    void setSharedEnvStore(Bun::SharedEnvStore& store) { m_sharedEnvStore = &store; }

    static ScriptExecutionContext* getMainThreadScriptExecutionContext();

private:
    std::atomic<bool> m_isTerminating { false };
    RefPtr<Bun::SharedEnvStore> m_sharedEnvStore;
    JSC::VM* m_vm = nullptr;
    Zig::GlobalObject* m_globalObject = nullptr;
    // The thread's Bun VM; outlives every global created on it and, during teardown, the JSC::VM.
    void* const m_bunVM;
    // What other threads use to reach the VM (see JSVMClientData::vmHandle).
    const ::BunVmHandleRef* const m_vmHandle;
    WTF::URL m_url = WTF::URL();
    ScriptExecutionContextIdentifier m_identifier;
    // Snapshot of the creating thread's UID; used by isContextThread() so the
    // check stays valid after VM clientData / VMHolder are torn down on exit.
    uint32_t m_contextThreadUID;

    WeakHashSet<ActiveDOMObject> m_activeDOMObjects;
    // Registered in the observer's constructor, removed in its destructor, both
    // on this context's thread: plain pointers, nothing allocated per observer.
    HashSet<ContextDestructionObserver*> m_destructionObservers;

    std::atomic<bool> m_activeDOMObjectsAreStopped { false };
    mutable bool m_activeDOMObjectAdditionForbidden { false };

public:
#if ASSERT_ENABLED
    bool m_inScriptExecutionContextDestructor = false;
#endif
};

}
