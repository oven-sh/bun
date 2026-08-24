#include "config.h"
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
    JSCDeferredWorkTask(WebCore::JSVMClientData* clientData, Ref<Ticket> ticket, Task&& task)
        : clientData(clientData)
        , ticket(WTF::move(ticket))
        , task(WTF::move(task))
    {
    }

    // The ticket's realm can be dead by the time the job runs; the VM comes from
    // here, not from the ticket.
    WebCore::JSVMClientData* clientData;
    Ref<Ticket> ticket;
    Task task;

    WTF_MAKE_TZONE_ALLOCATED(JSCDeferredWorkTask);
};

// Ticket::embedderData(): the loop that was current when JSC registered the work,
// which its completion is posted to, and whether the ticket took an event loop ref.
static constexpr uint8_t loopKindMask = 0x1;
static constexpr uint8_t holdsEventLoopRef = 0x2;
static_assert(static_cast<uint8_t>(BunLoopKind::Macro) <= loopKindMask);

static BunLoopKind loopKindOf(Ticket& ticket)
{
    return static_cast<BunLoopKind>(ticket.embedderData() & loopKindMask);
}

static bool tookEventLoopRef(Ticket& ticket)
{
    return ticket.embedderData() & holdsEventLoopRef;
}

// VM thread only: the ref goes back the way onAddPendingWork took it, so it
// lands whatever state the VM handle is in. Other threads go through the handle.
static void releaseEventLoopRefOnVMThread(WebCore::JSVMClientData* clientData, Ticket& ticket)
{
    if (tookEventLoopRef(ticket))
        Bun__eventLoop__refKeepAlive(clientData->bunVM, -1);
}

void JSCTaskScheduler::onAddPendingWork(WebCore::JSVMClientData* clientData, Ticket& ticket)
{
    uint8_t data = static_cast<uint8_t>(Bun__VM__currentLoopKind(clientData->bunVM));
    // Past the event loop's last tick nothing runs any more, and the release below
    // would be dropped once the VM handle closes, so no ref is taken.
    if (ticket.type() == DeferredWorkTimer::WorkType::ImminentlyScheduled && !clientData->deferredWorkTimer.isShuttingDown()) {
        Bun__eventLoop__refKeepAlive(clientData->bunVM, 1);
        data |= holdsEventLoopRef;
    }
    ticket.setEmbedderData(data);
}

// The ticket stops being pending here or in runPendingWork, never both.
void JSCTaskScheduler::onCancelPendingWork(WebCore::JSVMClientData* clientData, Ticket& ticket)
{
    if (tookEventLoopRef(ticket))
        Bun__VmHandle__refKeepAlive(clientData->vmHandle, BunLoopKind::Regular, -1);
}

void JSCTaskScheduler::onScheduleWorkSoon(WebCore::JSVMClientData* clientData, Ref<Ticket>&& ticket, Task&& task)
{
    // Past the event loop's last tick nothing runs any more; the ticket stays pending
    // until the VM tears the timer down. A post that still races the shutdown lands
    // on the VM handle, which either queues it for the teardown to release unrun or
    // refuses it and runs the job's release path.
    if (clientData->deferredWorkTimer.isShuttingDown()) [[unlikely]]
        return;
    BunLoopKind loopKind = loopKindOf(ticket.get());
    auto* job = new JSCDeferredWorkTask(clientData, WTF::move(ticket), WTF::move(task));
    Bun__queueJSCDeferredWorkTaskConcurrently(clientData->vmHandle, job, loopKind);
}

static void runPendingWork(JSCDeferredWorkTask* job)
{
    auto* clientData = job->clientData;
    auto& vm = clientData->deferredWorkTimer.vm();
    Ticket& ticket = job->ticket.get();

    // False once a collection found the ticket's realm dead, or once an earlier job
    // for the same ticket ran. Nothing the ticket points at may be read then.
    if (vm.deferredWorkTimer->takePendingWork(ticket)) {
        releaseEventLoopRefOnVMThread(clientData, ticket);

        // Deferred work runs script (FinalizationRegistry callbacks, wasm
        // completions); not once the VM's stop was requested. Like any other
        // event-loop callback boundary, an exception a task lets escape is
        // reported as uncaught here rather than left on the VM for the next entry.
        if (Bun__VmHandle__scriptAllowed(clientData->vmHandle)) {
            auto* globalObject = ticket.target()->globalObject();
            auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
            job->task(ticket);
            if (auto* exception = scope.exception(); exception && !vm.hasPendingTerminationException()) {
                scope.clearException();
                Zig::GlobalObject::reportUncaughtExceptionAtEventLoop(globalObject, exception);
            }
        }
    }

    delete job;
}

extern "C" void Bun__runDeferredWork(Bun::JSCDeferredWorkTask* job)
{
    runPendingWork(job);
}

// Release a queued job unrun during the teardown, on the VM's thread while the
// JSC VM and its event loop are alive. The job is consumed like a run one: the
// ticket leaves the pending set and gives its event loop ref back. The VM handle
// may already be closed here (the last pass after Closed), which is why the ref
// does not go through it.
extern "C" void Bun__deleteDeferredWorkTask(Bun::JSCDeferredWorkTask* job)
{
    auto* clientData = job->clientData;
    Ticket& ticket = job->ticket.get();
    if (clientData->deferredWorkTimer.vm().deferredWorkTimer->takePendingWork(ticket))
        releaseEventLoopRefOnVMThread(clientData, ticket);
    delete job;
}

// Drop a job the VM handle refused because it had already closed. Any thread.
// Nothing is left to balance: the loop the ref held open is gone, and the
// ticket is cancelled with the VM.
extern "C" void Bun__discardDeferredWorkTask(Bun::JSCDeferredWorkTask* job)
{
    delete job;
}

}
