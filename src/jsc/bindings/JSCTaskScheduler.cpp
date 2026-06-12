#include "config.h"
#include <JavaScriptCore/VM.h>
#include "JSCTaskScheduler.h"
#include "BunClientData.h"

using Ticket = JSC::DeferredWorkTimer::Ticket;
using Task = JSC::DeferredWorkTimer::Task;
using TicketData = JSC::DeferredWorkTimer::TicketData;

namespace Bun {
using namespace JSC;

extern "C" void Bun__queueJSCDeferredWorkTaskConcurrently(void* bunVM, void* task, uint64_t bunVMGeneration);
extern "C" void Bun__eventLoop__incrementRefConcurrently(void* bunVM, int delta, uint64_t bunVMGeneration);

class JSCDeferredWorkTask {
public:
    JSCDeferredWorkTask(Ref<TicketData> ticket, Task&& task)
        : ticket(WTF::move(ticket))
        , task(WTF::move(task))
    {
    }

    Ref<TicketData> ticket;
    Task task;
    ~JSCDeferredWorkTask()
    {
    }

    JSC::VM& vm() const { return ticket->scriptExecutionOwner()->vm(); }

    WTF_MAKE_TZONE_ALLOCATED(JSCDeferredWorkTask);
};

static JSC::VM& getVM(Ticket& ticket)
{
    return ticket->scriptExecutionOwner()->vm();
}

void JSCTaskScheduler::onAddPendingWork(WebCore::JSVMClientData* clientData, Ref<TicketData>&& ticket, JSC::DeferredWorkTimer::WorkType kind)
{
    auto& scheduler = clientData->deferredWorkTimer;
    Locker<Lock> holder { scheduler.m_lock };
    if (kind == DeferredWorkTimer::WorkType::ImminentlyScheduled) {
        Bun__eventLoop__incrementRefConcurrently(clientData->bunVM, 1, clientData->bunVMGeneration);
        scheduler.m_pendingTicketsKeepingEventLoopAlive.add(WTF::move(ticket));
    } else {
        scheduler.m_pendingTicketsOther.add(WTF::move(ticket));
    }
}
void JSCTaskScheduler::onScheduleWorkSoon(WebCore::JSVMClientData* clientData, Ticket ticket, Task&& task)
{
    auto* job = new JSCDeferredWorkTask(*ticket, WTF::move(task));
    Bun__queueJSCDeferredWorkTaskConcurrently(clientData->bunVM, job, clientData->bunVMGeneration);
}

void JSCTaskScheduler::onCancelPendingWork(WebCore::JSVMClientData* clientData, Ticket ticket)
{
    auto* bunVM = clientData->bunVM;
    auto bunVMGeneration = clientData->bunVMGeneration;
    auto& scheduler = clientData->deferredWorkTimer;

    Locker<Lock> holder { scheduler.m_lock };
    bool isKeepingEventLoopAlive = scheduler.m_pendingTicketsKeepingEventLoopAlive.removeIf([ticket](auto pendingTicket) {
        return pendingTicket.ptr() == ticket;
    });
    // -- At this point, ticket may be an invalid pointer.

    if (isKeepingEventLoopAlive) {
        holder.unlockEarly();
        Bun__eventLoop__incrementRefConcurrently(bunVM, -1, bunVMGeneration);
    } else {
        scheduler.m_pendingTicketsOther.removeIf([ticket](auto pendingTicket) {
            return pendingTicket.ptr() == ticket;
        });
    }
}

static void runPendingWork(void* bunVM, uint64_t bunVMGeneration, Bun::JSCTaskScheduler& scheduler, JSCDeferredWorkTask* job)
{
    Locker<Lock> holder { scheduler.m_lock };
    auto pendingTicket = scheduler.m_pendingTicketsKeepingEventLoopAlive.take(job->ticket);
    if (!pendingTicket) {
        pendingTicket = scheduler.m_pendingTicketsOther.take(job->ticket);
    } else {
        Bun__eventLoop__incrementRefConcurrently(bunVM, -1, bunVMGeneration);
    }
    holder.unlockEarly();

    if (pendingTicket && !pendingTicket->isCancelled()) {
        job->task(job->ticket.ptr());
    }

    delete job;
}

extern "C" void Bun__runDeferredWork(Bun::JSCDeferredWorkTask* job)
{
    auto& vm = job->vm();
    auto clientData = WebCore::clientData(vm);

    runPendingWork(clientData->bunVM, clientData->bunVMGeneration, clientData->deferredWorkTimer, job);
}

}
