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
    // it for every still-pending Atomics.waitAsync ticket).
    void markShuttingDown() { m_isShuttingDown.store(true, std::memory_order_release); }

public:
    Lock m_lock;
    std::atomic<bool> m_isShuttingDown { false };
    UncheckedKeyHashSet<Ref<JSC::DeferredWorkTimer::TicketData>> m_pendingTicketsKeepingEventLoopAlive;
    UncheckedKeyHashSet<Ref<JSC::DeferredWorkTimer::TicketData>> m_pendingTicketsOther;
};

}
