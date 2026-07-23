#pragma once

namespace WebCore {
class JSVMClientData;
}

#include <JavaScriptCore/DeferredWorkTimer.h>
#include <JavaScriptCore/Strong.h>

namespace JSC {
class JSFinalizationRegistry;
}

namespace Bun {

class JSCTaskScheduler {
public:
    JSCTaskScheduler()
        : m_pendingTicketsKeepingEventLoopAlive()
        , m_pendingTicketsOther()
    {
    }

    static void onAddPendingWork(WebCore::JSVMClientData* clientData, Ref<JSC::DeferredWorkTimer::Ticket>&& ticket, JSC::DeferredWorkTimer::WorkType kind);
    static void onScheduleWorkSoon(WebCore::JSVMClientData* clientData, Ref<JSC::DeferredWorkTimer::Ticket>&& ticket, JSC::DeferredWorkTimer::Task&& task);
    static void onCancelPendingWork(WebCore::JSVMClientData* clientData, JSC::DeferredWorkTimer::Ticket& ticket);

    // JavaScriptCore's async bytecode generator only preserves locals that are
    // read after an `await`, so a `const fr = new FinalizationRegistry(...)`
    // whose last use is `fr.register(...)` is collected at the next suspend
    // point along with its pending registrations. V8 preserves every async
    // local, so Node.js users never observe this. Root a registry on its first
    // successful register() and release it once both its live and dead lists
    // are empty so cleanup callbacks for already-registered targets still run.
    void rootFinalizationRegistry(JSC::VM&, JSC::JSFinalizationRegistry*);
    void unrootFinalizationRegistryIfDrained(JSC::JSFinalizationRegistry*);

    // Set once the owning VM's event loop has taken its last tick. After this,
    // onScheduleWorkSoon drops the task instead of enqueueing a ConcurrentTask
    // that can never be drained (~VM -> WaiterListManager::unregister reaches
    // it for every still-pending Atomics.waitAsync ticket). Guarded by m_lock
    // so the check+enqueue in onScheduleWorkSoon is atomic with respect to this
    // transition (a cross-thread Atomics.notify may race a worker's shutdown).
    void markShuttingDown()
    {
        Locker<Lock> holder { m_lock };
        m_isShuttingDown = true;
    }

public:
    Lock m_lock;
    bool m_isShuttingDown WTF_GUARDED_BY_LOCK(m_lock) { false };
    UncheckedKeyHashSet<Ref<JSC::DeferredWorkTimer::Ticket>> m_pendingTicketsKeepingEventLoopAlive;
    UncheckedKeyHashSet<Ref<JSC::DeferredWorkTimer::Ticket>> m_pendingTicketsOther;

    // JS-thread only; see rootFinalizationRegistry above.
    UncheckedKeyHashMap<JSC::JSCell*, JSC::Strong<JSC::JSObject>> m_rootedFinalizationRegistries;
};

void installFinalizationRegistryPrototypeHooks(JSC::JSGlobalObject*);

}
