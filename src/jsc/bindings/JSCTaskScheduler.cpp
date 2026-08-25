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

// Any thread. The VM's own thread gives the ref back the way onAddPendingWork
// took it, which lands in any state of the VM handle (the teardown cancels
// what is still pending after the handle has closed). Another thread, such as
// a collector thread at the end of a collection, goes through the handle.
static void releaseEventLoopRef(WebCore::JSVMClientData* clientData, Ticket& ticket)
{
    if (!tookEventLoopRef(ticket))
        return;
    if (Bun__VM__isCurrentThread(clientData->bunVM))
        Bun__eventLoop__refKeepAlive(clientData->bunVM, -1);
    else
        Bun__VmHandle__refKeepAlive(clientData->vmHandle, loopKindOf(ticket), -1);
}

void JSCTaskScheduler::onAddPendingWork(WebCore::JSVMClientData* clientData, Ticket& ticket)
{
    uint8_t data = static_cast<uint8_t>(Bun__VM__currentLoopKind(clientData->bunVM));
    if (ticket.type() == DeferredWorkTimer::WorkType::ImminentlyScheduled) {
        Bun__eventLoop__refKeepAlive(clientData->bunVM, 1);
        data |= holdsEventLoopRef;
    }
    ticket.setEmbedderData(data);
}

// The ticket stops being pending here or in runPendingWork, never both.
void JSCTaskScheduler::onCancelPendingWork(WebCore::JSVMClientData* clientData, Ticket& ticket)
{
    releaseEventLoopRef(clientData, ticket);
}

void JSCTaskScheduler::onScheduleWorkSoon(WebCore::JSVMClientData* clientData, Ref<Ticket>&& ticket, Task&& task)
{
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
        releaseEventLoopRef(clientData, ticket);

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
// JSC VM and its event loop are alive. The job is consumed like a run one.
extern "C" void Bun__deleteDeferredWorkTask(Bun::JSCDeferredWorkTask* job)
{
    auto* clientData = job->clientData;
    Ticket& ticket = job->ticket.get();
    if (clientData->deferredWorkTimer.vm().deferredWorkTimer->takePendingWork(ticket))
        releaseEventLoopRef(clientData, ticket);
    delete job;
}

// Drop a job the VM handle refused because it had already closed. Any thread.
// The ticket stays pending, and the teardown cancels it with the VM.
extern "C" void Bun__discardDeferredWorkTask(Bun::JSCDeferredWorkTask* job)
{
    delete job;
}

}
