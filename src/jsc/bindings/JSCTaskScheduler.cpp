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

using Pending = JSCTaskScheduler::Pending;

// Drop `ticket` from the pending map. Caller holds m_lock; a keep-alive the entry
// held is released (releaseKeepAlive) after the caller lets go of the lock.
static std::optional<Pending> dropPendingTicketLocked(Bun::JSCTaskScheduler& scheduler, Ticket* ticket) WTF_REQUIRES_LOCK(scheduler.m_lock)
{
    auto it = scheduler.m_pending.find(ticket);
    if (it == scheduler.m_pending.end())
        return std::nullopt;
    Pending pending = it->value;
    scheduler.m_pending.remove(it);
    // -- At this point, ticket may be an invalid pointer.
    return pending;
}

static void releaseKeepAlive(const ::BunVmHandleRef* vmHandle, const std::optional<Pending>& pending)
{
    if (pending && pending->keepsEventLoopAlive)
        Bun__VmHandle__refKeepAlive(vmHandle, pending->loop, -1);
}

void JSCTaskScheduler::onAddPendingWork(WebCore::JSVMClientData* clientData, Ref<Ticket>&& ticket, JSC::DeferredWorkTimer::WorkType kind)
{
    // JS thread (DeferredWorkTimer::addPendingWork holds the API lock): the work is being started
    // now, so its keep-alive and its completion belong to the loop this thread is running.
    Pending pending { kind == DeferredWorkTimer::WorkType::ImminentlyScheduled, Bun__VM__currentLoopKind(clientData->bunVM) };
    auto& scheduler = clientData->deferredWorkTimer;
    Locker<Lock> holder { scheduler.m_lock };
    if (scheduler.m_isShuttingDown) [[unlikely]]
        return;
    if (pending.keepsEventLoopAlive)
        Bun__VmHandle__refKeepAlive(clientData->vmHandle, pending.loop, 1);
    scheduler.m_pending.add(WTF::move(ticket), pending);
}
void JSCTaskScheduler::onScheduleWorkSoon(WebCore::JSVMClientData* clientData, Ref<Ticket>&& ticket, Task&& task)
{
    auto& scheduler = clientData->deferredWorkTimer;
    BunLoopKind loop = BunLoopKind::Regular;
    {
        Locker<Lock> holder { scheduler.m_lock };
        // The event loop is past its last tick: don't bother posting. Reached from
        // ~VM -> WaiterListManager::unregister -> Waiter::cancelAndClear for every
        // outstanding Atomics.waitAsync on a terminating worker, and from
        // collectNow -> JSFinalizationRegistry::finalizeUnconditionally. Balance
        // onAddPendingWork so the pending entry and event-loop ref are released.
        if (scheduler.m_isShuttingDown) [[unlikely]] {
            auto dropped = dropPendingTicketLocked(scheduler, ticket.ptr());
            holder.unlockEarly();
            releaseKeepAlive(clientData->vmHandle, dropped);
            return;
        }
        auto it = scheduler.m_pending.find(ticket.ptr());
        if (it != scheduler.m_pending.end())
            loop = it->value.loop;
    }
    // Outside m_lock (markShuttingDown, on the VM's thread, needs it): a post that
    // still races the shutdown lands on the VM handle, which either queues it for
    // the teardown to release unrun or refuses it and runs the job's release path.
    auto* job = new JSCDeferredWorkTask(WTF::move(ticket), WTF::move(task));
    Bun__queueJSCDeferredWorkTaskConcurrently(clientData->vmHandle, job, loop);
}

void JSCTaskScheduler::onCancelPendingWork(WebCore::JSVMClientData* clientData, Ticket& ticket)
{
    auto* vmHandle = clientData->vmHandle;
    auto& scheduler = clientData->deferredWorkTimer;

    Locker<Lock> holder { scheduler.m_lock };
    auto dropped = dropPendingTicketLocked(scheduler, &ticket);
    holder.unlockEarly();
    releaseKeepAlive(vmHandle, dropped);
}

static void runPendingWork(const ::BunVmHandleRef* vmHandle, Bun::JSCTaskScheduler& scheduler, JSCDeferredWorkTask* job)
{
    Locker<Lock> holder { scheduler.m_lock };
    auto pending = dropPendingTicketLocked(scheduler, job->ticket.ptr());
    holder.unlockEarly();
    releaseKeepAlive(vmHandle, pending);

    // Deferred work runs script (FinalizationRegistry callbacks, wasm
    // completions); not once the VM's stop was requested. Like any other
    // event-loop callback boundary, an exception a task lets escape is
    // reported as uncaught here rather than left on the VM for the next entry.
    if (pending && !job->ticket->isCancelled() && Bun__VmHandle__scriptAllowed(vmHandle)) {
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
// drop so the pending map and event-loop ref stay balanced.
extern "C" void Bun__deleteDeferredWorkTask(Bun::JSCDeferredWorkTask* job)
{
    if (auto* clientData = WebCore::clientData(job->vm())) {
        auto& scheduler = clientData->deferredWorkTimer;
        Locker<Lock> holder { scheduler.m_lock };
        auto dropped = dropPendingTicketLocked(scheduler, job->ticket.ptr());
        holder.unlockEarly();
        releaseKeepAlive(clientData->vmHandle, dropped);
    }
    delete job;
}

}
