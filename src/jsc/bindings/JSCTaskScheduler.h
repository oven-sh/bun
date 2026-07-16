#pragma once

namespace WebCore {
class JSVMClientData;
}

#include <JavaScriptCore/DeferredWorkTimer.h>

namespace Bun {

class JSCTaskScheduler {
public:
    JSCTaskScheduler()
        : m_pendingTicketsKeepingEventLoopAlive()
        , m_pendingTicketsOther()
    {
    }

    static void onAddPendingWork(WebCore::JSVMClientData* clientData, Ref<JSC::DeferredWorkTimer::TicketData>&& ticket, JSC::DeferredWorkTimer::WorkType kind);
    static void onScheduleWorkSoon(WebCore::JSVMClientData* clientData, JSC::DeferredWorkTimer::Ticket ticket, JSC::DeferredWorkTimer::Task&& task);
    static void onCancelPendingWork(WebCore::JSVMClientData* clientData, JSC::DeferredWorkTimer::Ticket ticket);

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
    UncheckedKeyHashSet<Ref<JSC::DeferredWorkTimer::TicketData>> m_pendingTicketsKeepingEventLoopAlive;
    UncheckedKeyHashSet<Ref<JSC::DeferredWorkTimer::TicketData>> m_pendingTicketsOther;
};

}
