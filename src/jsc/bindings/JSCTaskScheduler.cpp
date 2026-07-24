#include "config.h"
#include <JavaScriptCore/VM.h>
#include <JavaScriptCore/Exception.h>
#include <JavaScriptCore/GlobalObjectMethodTable.h>
#include <JavaScriptCore/TopExceptionScope.h>
#include "JSCTaskScheduler.h"
#include "BunClientData.h"

using Ticket = JSC::DeferredWorkTimer::Ticket;
using Task = JSC::DeferredWorkTimer::Task;

namespace Bun {
using namespace JSC;

extern "C" void Bun__queueJSCDeferredWorkTaskConcurrently(void* bunVM, void* task);
extern "C" void Bun__eventLoop__incrementRefConcurrently(void* bunVM, int delta);

class JSCDeferredWorkTask {
public:
    JSCDeferredWorkTask(Ref<Ticket> ticket, Task&& task)
        : ticket(WTF::move(ticket))
        , task(WTF::move(task))
    {
    }

    Ref<Ticket> ticket;
    Task task;
    ~JSCDeferredWorkTask()
    {
    }

    JSC::VM& vm() const { return ticket->scriptExecutionOwner()->vm(); }

    WTF_MAKE_TZONE_ALLOCATED(JSCDeferredWorkTask);
};

// Drop `ticket` from whichever pending set holds it. Caller holds m_lock; the
// event-loop ref is balanced after the caller releases the lock.
static bool dropPendingTicketLocked(Bun::JSCTaskScheduler& scheduler, Ticket* ticket) WTF_REQUIRES_LOCK(scheduler.m_lock)
{
    bool isKeepingEventLoopAlive = scheduler.m_pendingTicketsKeepingEventLoopAlive.removeIf([ticket](auto pendingTicket) {
        return pendingTicket.ptr() == ticket;
    });
    // -- At this point, ticket may be an invalid pointer.
    if (!isKeepingEventLoopAlive) {
        scheduler.m_pendingTicketsOther.removeIf([ticket](auto pendingTicket) {
            return pendingTicket.ptr() == ticket;
        });
    }
    return isKeepingEventLoopAlive;
}

void JSCTaskScheduler::onAddPendingWork(WebCore::JSVMClientData* clientData, Ref<Ticket>&& ticket, JSC::DeferredWorkTimer::WorkType kind)
{
    auto& scheduler = clientData->deferredWorkTimer;
    Locker<Lock> holder { scheduler.m_lock };
    if (scheduler.m_isShuttingDown) [[unlikely]]
        return;
    if (kind == DeferredWorkTimer::WorkType::ImminentlyScheduled) {
        Bun__eventLoop__incrementRefConcurrently(clientData->bunVM, 1);
        scheduler.m_pendingTicketsKeepingEventLoopAlive.add(WTF::move(ticket));
    } else {
        scheduler.m_pendingTicketsOther.add(WTF::move(ticket));
    }
}
void JSCTaskScheduler::onScheduleWorkSoon(WebCore::JSVMClientData* clientData, Ref<Ticket>&& ticket, Task&& task)
{
    auto& scheduler = clientData->deferredWorkTimer;
    Locker<Lock> holder { scheduler.m_lock };
    // The event loop is past its last tick; a JSCDeferredWorkTask enqueued now
    // would never run and its ConcurrentTask wrapper would leak once the Bun
    // VirtualMachine box is dealloc'd. Reached from ~VM -> WaiterListManager::
    // unregister -> Waiter::cancelAndClear for every outstanding
    // Atomics.waitAsync on a terminating worker, and from collectNow ->
    // JSFinalizationRegistry::finalizeUnconditionally. Balance onAddPendingWork
    // so the ticket-set entry and event-loop ref are released. The lock is held
    // across the check and the enqueue so the transition in markShuttingDown
    // cannot race a cross-thread Atomics.notify.
    if (scheduler.m_isShuttingDown) [[unlikely]] {
        bool wasKeepingAlive = dropPendingTicketLocked(scheduler, ticket.ptr());
        holder.unlockEarly();
        if (wasKeepingAlive)
            Bun__eventLoop__incrementRefConcurrently(clientData->bunVM, -1);
        return;
    }
    auto* job = new JSCDeferredWorkTask(WTF::move(ticket), WTF::move(task));
    Bun__queueJSCDeferredWorkTaskConcurrently(clientData->bunVM, job);
}

void JSCTaskScheduler::onCancelPendingWork(WebCore::JSVMClientData* clientData, Ticket& ticket)
{
    auto* bunVM = clientData->bunVM;
    auto& scheduler = clientData->deferredWorkTimer;

    Locker<Lock> holder { scheduler.m_lock };
    bool wasKeepingAlive = dropPendingTicketLocked(scheduler, &ticket);
    holder.unlockEarly();
    if (wasKeepingAlive)
        Bun__eventLoop__incrementRefConcurrently(bunVM, -1);
}

static void runPendingWork(void* bunVM, Bun::JSCTaskScheduler& scheduler, JSCDeferredWorkTask* job)
{
    Locker<Lock> holder { scheduler.m_lock };
    auto pendingTicket = scheduler.m_pendingTicketsKeepingEventLoopAlive.take(job->ticket);
    if (!pendingTicket) {
        pendingTicket = scheduler.m_pendingTicketsOther.take(job->ticket);
    } else {
        Bun__eventLoop__incrementRefConcurrently(bunVM, -1);
    }
    holder.unlockEarly();

    if (pendingTicket && !pendingTicket->isCancelled()) {
        auto& vm = job->vm();
        auto* globalObject = pendingTicket->scriptExecutionOwner()->globalObject();
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        job->task(job->ticket.get());
        if (auto* exception = scope.exception()) {
            if (scope.clearExceptionExceptTermination())
                globalObject->globalObjectMethodTable()->reportUncaughtExceptionAtEventLoop(globalObject, exception);
        }
    }

    delete job;
}

extern "C" void Bun__runDeferredWork(Bun::JSCDeferredWorkTask* job)
{
    auto& vm = job->vm();
    auto clientData = WebCore::clientData(vm);

    runPendingWork(clientData->bunVM, clientData->deferredWorkTimer, job);
}

// Flip m_isShuttingDown from the owning JS thread before the final concurrent-
// task drain. Any onScheduleWorkSoon that serializes before this under m_lock
// has its enqueue visible to the drain; any that serializes after drops.
extern "C" void Bun__JSCTaskScheduler__markShuttingDown(JSC::JSGlobalObject* globalObject)
{
    if (auto* clientData = WebCore::clientData(JSC::getVM(globalObject)))
        clientData->deferredWorkTimer.markShuttingDown();
}

// Reclaim a queued-but-never-dispatched job during shutdown. Called while the
// JSC VM is still alive, so ~Ref<Ticket> and the captured Task lambda may
// safely touch TZone-allocated / JSC-owned state. Mirrors runPendingWork's
// ticket take() so the pending set and event-loop ref stay balanced.
extern "C" void Bun__deleteDeferredWorkTask(Bun::JSCDeferredWorkTask* job)
{
    if (auto* clientData = WebCore::clientData(job->vm())) {
        auto& scheduler = clientData->deferredWorkTimer;
        Locker<Lock> holder { scheduler.m_lock };
        bool wasKeepingAlive = dropPendingTicketLocked(scheduler, job->ticket.ptr());
        holder.unlockEarly();
        if (wasKeepingAlive)
            Bun__eventLoop__incrementRefConcurrently(clientData->bunVM, -1);
    }
    delete job;
}

}
