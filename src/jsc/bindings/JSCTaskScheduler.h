#pragma once

namespace WebCore {
class JSVMClientData;
}

#include <JavaScriptCore/DeferredWorkTimer.h>
#include "BunLoopKind.h"

namespace Bun {

class JSCTaskScheduler {
    WTF_MAKE_NONCOPYABLE(JSCTaskScheduler);

public:
    explicit JSCTaskScheduler(JSC::VM& vm)
        : m_vm(vm)
    {
    }

    // A posted job reaches its VM through here, never through its ticket. The
    // realm that owns the ticket can be destructed before the job runs (a global
    // that `bun test --isolate` retired, a dead node:vm context). ~JSGlobalObject
    // only cancels the ticket; its scriptExecutionOwner() still points at the
    // destructed realm.
    JSC::VM& vm() const { return m_vm; }

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
    // Value: the loop that was current when JSC registered the work; its completion is posted there.
    UncheckedKeyHashMap<Ref<JSC::DeferredWorkTimer::Ticket>, BunLoopKind> m_pendingTicketsKeepingEventLoopAlive;
    UncheckedKeyHashMap<Ref<JSC::DeferredWorkTimer::Ticket>, BunLoopKind> m_pendingTicketsOther;

private:
    JSC::VM& m_vm;
};

}
