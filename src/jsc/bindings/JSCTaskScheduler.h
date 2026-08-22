#pragma once

namespace WebCore {
class JSVMClientData;
}

#include <JavaScriptCore/DeferredWorkTimer.h>
#include "BunLoopKind.h"

namespace Bun {

class JSCTaskScheduler {
public:
    JSCTaskScheduler() = default;

    // Recorded on the JS thread when JSC registers the work (onAddPendingWork): whether it holds a
    // keep-alive, and the loop that keep-alive and the eventual completion belong to.
    struct Pending {
        bool keepsEventLoopAlive { false };
        BunLoopKind loopKind { BunLoopKind::Regular };
    };

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
    Lock m_lock;
    bool m_isShuttingDown WTF_GUARDED_BY_LOCK(m_lock) { false };
    UncheckedKeyHashMap<Ref<JSC::DeferredWorkTimer::Ticket>, Pending> m_pending WTF_GUARDED_BY_LOCK(m_lock);
};

}
