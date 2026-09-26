#pragma once

namespace WebCore {
class JSVMClientData;
}

#include <JavaScriptCore/DeferredWorkTimer.h>
#include "BunLoopKind.h"

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

    // Set once the owning VM's event loop has taken its last tick. After this,
    // onScheduleWorkSoon drops the task up front instead of posting it (~VM ->
    // WaiterListManager::unregister reaches it for every still-pending
    // Atomics.waitAsync ticket). An early-out, not a fence: a post that races
    // this is handled by the VM handle (released unrun by the teardown, or refused).
    void markShuttingDown()
    {
        Locker<Lock> holder { m_lock };
        m_isShuttingDown = true;
    }

public:
    // What was current when JSC registered the work.
    struct PendingWork {
        // Its completion is posted to this loop, and the keep-alive it took there is released on it.
        BunLoopKind loopKind { BunLoopKind::Regular };
        // The identifier of the Bun.ModuleGraph context whose script asked for the work, or 0 for
        // the realm's own: the completion of a stopped one is dropped.
        uint32_t graphContext { 0 };
    };

    Lock m_lock;
    bool m_isShuttingDown WTF_GUARDED_BY_LOCK(m_lock) { false };
    UncheckedKeyHashMap<Ref<JSC::DeferredWorkTimer::Ticket>, PendingWork> m_pendingTicketsKeepingEventLoopAlive;
    UncheckedKeyHashMap<Ref<JSC::DeferredWorkTimer::Ticket>, PendingWork> m_pendingTicketsOther;
};

}
