#include "config.h"
#include <JavaScriptCore/VM.h>
#include <JavaScriptCore/HeapInlines.h>
#include <JavaScriptCore/TopExceptionScope.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/GlobalObjectMethodTable.h>
#include "JSCTaskScheduler.h"
#include "BunClientData.h"
#include "ZigGlobalObject.h"
#include "ScriptExecutionContext.h"
#include "ModuleGraph.h"
#include <JavaScriptCore/JSFinalizationRegistry.h>

using Ticket = JSC::DeferredWorkTimer::Ticket;
using Task = JSC::DeferredWorkTimer::Task;

namespace Bun {
using namespace JSC;

extern "C" void Bun__eventLoop__refKeepAlive(void* bunVM);
extern "C" bool Bun__queueJSCDeferredWorkTaskConcurrently(const ::BunVmHandleRef*, void* task);

class JSCDeferredWorkTask {
public:
    JSCDeferredWorkTask(WebCore::JSVMClientData* clientData, Ref<Ticket> ticket, Task&& task)
        : clientData(clientData)
        , ticket(WTF::move(ticket))
        , task(WTF::move(task))
    {
    }

    // Not reached through the ticket: a cancelled one's cells may be freed.
    WebCore::JSVMClientData* clientData;
    Ref<Ticket> ticket;
    Task task;
    ~JSCDeferredWorkTask()
    {
    }

    WTF_MAKE_TZONE_ALLOCATED(JSCDeferredWorkTask);
};

extern "C" void Bun__deleteDeferredWorkTask(JSCDeferredWorkTask*);
using UnqueuedJob = std::unique_ptr<JSCDeferredWorkTask, decltype([](JSCDeferredWorkTask* job) { Bun__deleteDeferredWorkTask(job); })>;

std::optional<JSCTaskScheduler::PendingWork> JSCTaskScheduler::takePendingWork(WebCore::JSVMClientData* clientData, Ticket* ticket)
{
    auto& scheduler = clientData->deferredWorkTimer;
    auto takeFrom = [ticket](auto& pendingTickets) -> std::optional<PendingWork> {
        auto it = pendingTickets.find(ticket);
        if (it == pendingTickets.end())
            return std::nullopt;
        return pendingTickets.take(it);
    };
    Locker<Lock> holder { scheduler.m_lock };
    auto pending = takeFrom(scheduler.m_pendingTicketsKeepingEventLoopAlive);
    if (!pending)
        return takeFrom(scheduler.m_pendingTicketsOther);
    holder.unlockEarly();
    Bun__VmHandle__refKeepAlive(clientData->vmHandle.get(), -1);
    return pending;
}

void JSCTaskScheduler::onAddPendingWork(WebCore::JSVMClientData* clientData, Ref<Ticket>&& ticket, JSC::DeferredWorkTimer::WorkType kind)
{
    auto& scheduler = clientData->deferredWorkTimer;
    JSCTaskScheduler::PendingWork pending;
    // Script asked for this work (WebAssembly.compile, Atomics.waitAsync): it is the asking
    // graph's, and is dropped with it. A FinalizationRegistry's cleanup is the collector's doing,
    // for a registry that may be anybody's: it always runs.
    if (!ticket->target()->inherits<JSC::JSFinalizationRegistry>()) {
        auto* context = defaultGlobalObject(ticket->target()->globalObject())->currentScriptExecutionContext();
        if (context->isForModuleGraph())
            pending.graphContext = context->identifier();
    }
    Locker<Lock> holder { scheduler.m_lock };
    if (scheduler.m_isShuttingDown) [[unlikely]]
        return;
    if (kind == DeferredWorkTimer::WorkType::ImminentlyScheduled) {
        Bun__eventLoop__refKeepAlive(clientData->bunVM);
        scheduler.m_pendingTicketsKeepingEventLoopAlive.add(WTF::move(ticket), pending);
    } else {
        scheduler.m_pendingTicketsOther.add(WTF::move(ticket), pending);
    }
}
void JSCTaskScheduler::onScheduleWorkSoon(WebCore::JSVMClientData* clientData, Ref<Ticket>&& ticket, Task&& task)
{
    auto& scheduler = clientData->deferredWorkTimer;
    {
        Locker<Lock> holder { scheduler.m_lock };
        // The event loop is past its last tick: don't bother posting. Reached from
        // ~VM -> WaiterListManager::unregister -> Waiter::cancelAndClear for every
        // outstanding Atomics.waitAsync on a terminating worker, and from
        // collectNow -> JSFinalizationRegistry::finalizeUnconditionally. Balance
        // onAddPendingWork so the ticket-set entry and event-loop ref are released.
        if (scheduler.m_isShuttingDown) [[unlikely]] {
            holder.unlockEarly();
            takePendingWork(clientData, ticket.ptr());
            return;
        }
    }
    // Outside m_lock (markShuttingDown, on the VM's thread, needs it): a post that
    // still races the shutdown lands on the VM handle, which either queues it for
    // the teardown to release unrun or refuses it.
    UnqueuedJob job { new JSCDeferredWorkTask(clientData, WTF::move(ticket), WTF::move(task)) };
    if (Bun__queueJSCDeferredWorkTaskConcurrently(clientData->vmHandle.get(), job.get()))
        job.release();
}

void JSCTaskScheduler::onCancelPendingWork(WebCore::JSVMClientData* clientData, Ticket& ticket)
{
    takePendingWork(clientData, &ticket);
}

void JSCTaskScheduler::cancelWorkOfDeadRealms(WebCore::JSVMClientData* clientData, JSC::VM& vm)
{
    auto& scheduler = clientData->deferredWorkTimer;
    UncheckedKeyHashSet<JSGlobalObject*> deadRealms;
    {
        Locker<Lock> holder { scheduler.m_lock };
        auto collect = [&](auto& pendingTickets) {
            for (auto& ticket : pendingTickets.keys()) {
                if (ticket->isCancelled())
                    continue;
                auto* realm = ticket->target()->globalObject();
                if (!vm.heap.isMarked(realm))
                    deadRealms.add(realm);
            }
        };
        collect(scheduler.m_pendingTicketsKeepingEventLoopAlive);
        collect(scheduler.m_pendingTicketsOther);
    }
    // What ~JSGlobalObject does, too late for a global that is swept lazily. Reaches
    // onCancelPendingWork, which takes m_lock.
    for (auto* realm : deadRealms)
        realm->clearWeakTickets();
}

static void runPendingWork(std::unique_ptr<JSCDeferredWorkTask> job)
{
    auto pending = JSCTaskScheduler::takePendingWork(job->clientData, job->ticket.ptr());
    bool wasPending = !!pending;
    uint32_t graphContext = pending ? pending->graphContext : 0;

    // The Bun.ModuleGraph whose script asked for the work was disposed (or collected) since: like its
    // other callbacks, this one is not called.
    if (graphContext) {
        RefPtr context = WebCore::ScriptExecutionContext::getScriptExecutionContext(graphContext);
        if (!context || context->isStopped())
            wasPending = false;
    }

    // Deferred work runs script (FinalizationRegistry callbacks, wasm
    // completions); not once the VM's stop was requested. Like any other
    // event-loop callback boundary, an exception a task lets escape is
    // reported as uncaught here rather than left on the VM for the next entry.
    if (wasPending && !job->ticket->isCancelled() && Bun__VmHandle__scriptAllowed(job->clientData->vmHandle.get())) {
        auto* globalObject = job->ticket->target()->globalObject();
        auto& vm = globalObject->vm();
        // The realm's own status, as DeferredWorkTimer::doWork asks it before it runs a
        // task. A realm that `bun test --isolate` retired reports Stopped, so the
        // finished file's leftover work is dropped instead of running under the next
        // file. doWork re-queues a Suspended realm's task; no Bun realm reports that.
        auto status = globalObject->globalObjectMethodTable()->scriptExecutionStatus(globalObject, job->ticket->scriptExecutionOwner());
        ASSERT(status != ScriptExecutionStatus::Suspended);
        // The GC schedules this work, so `graphContext` isn't set. Use the callback's graph instead.
        if (auto* registry = dynamicDowncast<JSFinalizationRegistry>(job->ticket->target())) {
            if (auto* graph = Bun::moduleGraphForFunction(registry->callback()); graph && graph->disposed())
                status = ScriptExecutionStatus::Stopped;
        }
        if (status == ScriptExecutionStatus::Running) {
            auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
            job->task(job->ticket.get());
            if (auto* exception = scope.exception(); exception && !vm.hasPendingTerminationException()) {
                scope.clearException();
                Zig::GlobalObject::reportUncaughtExceptionAtEventLoop(globalObject, exception);
            }
        }
    }
}

extern "C" void Bun__runDeferredWork(Bun::JSCDeferredWorkTask* job)
{
    runPendingWork(std::unique_ptr<JSCDeferredWorkTask> { job });
}

// Reclaim a queued-but-never-dispatched job during shutdown. Called while the
// JSC VM is still alive, so ~Ref<Ticket> and the captured Task lambda may
// safely touch TZone-allocated / JSC-owned state. Mirrors runPendingWork's
// ticket take() so the pending set and event-loop ref stay balanced.
extern "C" void Bun__deleteDeferredWorkTask(Bun::JSCDeferredWorkTask* ownedJob)
{
    std::unique_ptr<JSCDeferredWorkTask> job { ownedJob };
    JSCTaskScheduler::takePendingWork(job->clientData, job->ticket.ptr());
}

}

// Atomics.waitAsync() and WebAssembly.compileStreaming() can still settle a promise but don't keep the event loop alive.
extern "C" [[ZIG_EXPORT(nothrow)]] bool Bun__hasDeferredWorkNotKeepingEventLoopAlive(Zig::GlobalObject* globalObject)
{
    return WebCore::clientData(globalObject->vm())->deferredWorkTimer.hasWorkNotKeepingEventLoopAlive();
}

extern "C" [[ZIG_EXPORT(nothrow)]] bool Bun__hasDeferredWorkKeepingEventLoopAlive(Zig::GlobalObject* globalObject)
{
    return WebCore::clientData(globalObject->vm())->deferredWorkTimer.hasWorkKeepingEventLoopAlive();
}
