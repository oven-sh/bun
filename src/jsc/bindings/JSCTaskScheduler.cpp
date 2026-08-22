#include "config.h"
#include <optional>
#include <JavaScriptCore/VM.h>
#include <JavaScriptCore/TopExceptionScope.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include "JSCTaskScheduler.h"
#include "BunClientData.h"
#include "ZigGlobalObject.h"

using Ticket = JSC::DeferredWorkTimer::Ticket;
using Task = JSC::DeferredWorkTimer::Task;

namespace Bun {
using namespace JSC;

extern "C" void Bun__queueJSCDeferredWorkTaskConcurrently(const ::BunVmHandleRef*, void* task, BunLoopKind);

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

// Drop `ticket` from whichever pending map holds it. Caller holds m_lock; the
// event-loop ref (on the returned loop, if it held one) is balanced after the
// caller releases the lock.
static std::optional<BunLoopKind> dropPendingTicketLocked(Bun::JSCTaskScheduler& scheduler, Ticket* ticket) WTF_REQUIRES_LOCK(scheduler.m_lock)
{
    std::optional<BunLoopKind> keepAliveLoopKind;
    scheduler.m_pendingTicketsKeepingEventLoopAlive.removeIf([&](auto& pendingTicket) {
        if (pendingTicket.key.ptr() != ticket)
            return false;
        keepAliveLoopKind = pendingTicket.value;
        return true;
    });
    // -- At this point, ticket may be an invalid pointer.
    if (!keepAliveLoopKind) {
        scheduler.m_pendingTicketsOther.removeIf([ticket](auto& pendingTicket) {
            return pendingTicket.key.ptr() == ticket;
        });
    }
    return keepAliveLoopKind;
}

void JSCTaskScheduler::onAddPendingWork(WebCore::JSVMClientData* clientData, Ref<Ticket>&& ticket, JSC::DeferredWorkTimer::WorkType kind)
{
    // JS thread: the work is being started now, on the loop this thread is running.
    BunLoopKind loopKind = Bun__VM__currentLoopKind(clientData->bunVM);
    auto& scheduler = clientData->deferredWorkTimer;
    Locker<Lock> holder { scheduler.m_lock };
    if (scheduler.m_isShuttingDown) [[unlikely]]
        return;
    if (kind == DeferredWorkTimer::WorkType::ImminentlyScheduled) {
        Bun__VmHandle__refKeepAlive(clientData->vmHandle, loopKind, 1);
        scheduler.m_pendingTicketsKeepingEventLoopAlive.add(WTF::move(ticket), loopKind);
    } else {
        scheduler.m_pendingTicketsOther.add(WTF::move(ticket), loopKind);
    }
}
void JSCTaskScheduler::onScheduleWorkSoon(WebCore::JSVMClientData* clientData, Ref<Ticket>&& ticket, Task&& task)
{
    auto& scheduler = clientData->deferredWorkTimer;
    BunLoopKind loopKind = BunLoopKind::Regular;
    {
        Locker<Lock> holder { scheduler.m_lock };
        // The event loop is past its last tick: don't bother posting. Reached from
        // ~VM -> WaiterListManager::unregister -> Waiter::cancelAndClear for every
        // outstanding Atomics.waitAsync on a terminating worker, and from
        // collectNow -> JSFinalizationRegistry::finalizeUnconditionally. Balance
        // onAddPendingWork so the ticket-map entry and event-loop ref are released.
        if (scheduler.m_isShuttingDown) [[unlikely]] {
            auto keepAliveLoopKind = dropPendingTicketLocked(scheduler, ticket.ptr());
            holder.unlockEarly();
            if (keepAliveLoopKind)
                Bun__VmHandle__refKeepAlive(clientData->vmHandle, *keepAliveLoopKind, -1);
            return;
        }
        if (auto it = scheduler.m_pendingTicketsKeepingEventLoopAlive.find(ticket.ptr()); it != scheduler.m_pendingTicketsKeepingEventLoopAlive.end())
            loopKind = it->value;
        else if (auto it = scheduler.m_pendingTicketsOther.find(ticket.ptr()); it != scheduler.m_pendingTicketsOther.end())
            loopKind = it->value;
    }
    // Outside m_lock (markShuttingDown, on the VM's thread, needs it): a post that
    // still races the shutdown lands on the VM handle, which either queues it for
    // the teardown to release unrun or refuses it and runs the job's release path.
    auto* job = new JSCDeferredWorkTask(WTF::move(ticket), WTF::move(task));
    Bun__queueJSCDeferredWorkTaskConcurrently(clientData->vmHandle, job, loopKind);
}

void JSCTaskScheduler::onCancelPendingWork(WebCore::JSVMClientData* clientData, Ticket& ticket)
{
    auto* vmHandle = clientData->vmHandle;
    auto& scheduler = clientData->deferredWorkTimer;

    Locker<Lock> holder { scheduler.m_lock };
    auto keepAliveLoopKind = dropPendingTicketLocked(scheduler, &ticket);
    holder.unlockEarly();
    if (keepAliveLoopKind)
        Bun__VmHandle__refKeepAlive(vmHandle, *keepAliveLoopKind, -1);
}

static void runPendingWork(const ::BunVmHandleRef* vmHandle, Bun::JSCTaskScheduler& scheduler, JSCDeferredWorkTask* job)
{
    Locker<Lock> holder { scheduler.m_lock };
    bool wasPending = false;
    if (auto it = scheduler.m_pendingTicketsKeepingEventLoopAlive.find(job->ticket.ptr()); it != scheduler.m_pendingTicketsKeepingEventLoopAlive.end()) {
        wasPending = true;
        Bun__VmHandle__refKeepAlive(vmHandle, it->value, -1);
        scheduler.m_pendingTicketsKeepingEventLoopAlive.remove(it);
    } else if (auto it = scheduler.m_pendingTicketsOther.find(job->ticket.ptr()); it != scheduler.m_pendingTicketsOther.end()) {
        wasPending = true;
        scheduler.m_pendingTicketsOther.remove(it);
    }
    holder.unlockEarly();

    // Deferred work runs script (FinalizationRegistry callbacks, wasm
    // completions); not once the VM's stop was requested. Like any other
    // event-loop callback boundary, an exception a task lets escape is
    // reported as uncaught here rather than left on the VM for the next entry.
    if (wasPending && !job->ticket->isCancelled() && Bun__VmHandle__scriptAllowed(vmHandle)) {
        auto& vm = job->vm();
        auto* globalObject = job->ticket->target()->globalObject();
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        job->task(job->ticket.get());
        if (auto* exception = scope.exception(); exception && !vm.hasPendingTerminationException()) {
            scope.clearException();
            Zig::GlobalObject::reportUncaughtExceptionAtEventLoop(globalObject, exception);
        }
    }

    delete job;
}

extern "C" void Bun__runDeferredWork(Bun::JSCDeferredWorkTask* job)
{
    auto& vm = job->vm();
    auto clientData = WebCore::clientData(vm);

    runPendingWork(clientData->vmHandle, clientData->deferredWorkTimer, job);
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
        auto keepAliveLoopKind = dropPendingTicketLocked(scheduler, job->ticket.ptr());
        holder.unlockEarly();
        if (keepAliveLoopKind)
            Bun__VmHandle__refKeepAlive(clientData->vmHandle, *keepAliveLoopKind, -1);
    }
    delete job;
}

}
