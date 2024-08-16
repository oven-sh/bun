#include "config.h"
#include <JavaScriptCore/VM.h>
#include "JSCTaskScheduler.h"
#include "BunClientData.h"

using Ticket = JSC::DeferredWorkTimer::Ticket;
using Task = JSC::DeferredWorkTimer::Task;
using TicketData = JSC::DeferredWorkTimer::TicketData;

namespace Bun {
using namespace JSC;

extern "C" void Bun__queueJSCDeferredWorkTaskConcurrently(void* bunVM, void* task);
extern "C" void Bun__eventLoop__incrementRefConcurrently(void* bunVM, int delta);

class JSCDeferredWorkTask {
public:
    JSCDeferredWorkTask(Ref<TicketData> ticket, Task&& task)
        : ticket(WTFMove(ticket))
        , task(WTFMove(task))
    {
    }

    Ref<TicketData> ticket;
    Task task;
    ~JSCDeferredWorkTask()
    {
    }

    JSC::VM& vm() const { return ticket->scriptExecutionOwner()->vm(); }

    WTF_MAKE_ISO_ALLOCATED(JSCDeferredWorkTask);
};

WTF_MAKE_ISO_ALLOCATED_IMPL(JSCDeferredWorkTask);

static JSC::VM& getVM(Ticket& ticket)
{
    return ticket->scriptExecutionOwner()->vm();
}

void JSCTaskScheduler::onAddPendingWork(WebCore::JSVMClientData* clientData, Ref<TicketData>&& ticket, JSC::DeferredWorkTimer::WorkType kind)
{
    auto& scheduler = clientData->deferredWorkTimer;
    Locker<Lock> holder { scheduler.m_lock };
    if (kind == DeferredWorkTimer::WorkType::ImminentlyScheduled) {
        Bun__eventLoop__incrementRefConcurrently(clientData->bunVM, 1);
        scheduler.m_pendingTicketsKeepingEventLoopAlive.add(WTFMove(ticket));
    } else {
        scheduler.m_pendingTicketsOther.add(WTFMove(ticket));
    }
}
void JSCTaskScheduler::onScheduleWorkSoon(WebCore::JSVMClientData* clientData, Ticket ticket, Task&& task)
{
    auto* job = new JSCDeferredWorkTask(*ticket, WTFMove(task));
    Bun__queueJSCDeferredWorkTaskConcurrently(clientData->bunVM, job);
}

void JSCTaskScheduler::onCancelPendingWork(WebCore::JSVMClientData* clientData, Ticket ticket)
{
    auto* bunVM = clientData->bunVM;
    auto& scheduler = clientData->deferredWorkTimer;

    Locker<Lock> holder { scheduler.m_lock };
    bool isKeepingEventLoopAlive = scheduler.m_pendingTicketsKeepingEventLoopAlive.removeIf([ticket](auto pendingTicket) {
        return pendingTicket.ptr() == ticket;
    });
    // -- At this point, ticket may be an invalid pointer.

    if (isKeepingEventLoopAlive) {
        holder.unlockEarly();
        Bun__eventLoop__incrementRefConcurrently(bunVM, -1);
    } else {
        scheduler.m_pendingTicketsOther.removeIf([ticket](auto pendingTicket) {
            return pendingTicket.ptr() == ticket;
        });
    }
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
        job->task(job->ticket.ptr());
    }

    delete job;
}

extern "C" void Bun__runDeferredWork(Bun::JSCDeferredWorkTask* job)
{
    auto& vm = job->vm();
    auto clientData = WebCore::clientData(vm);

    runPendingWork(clientData->bunVM, clientData->deferredWorkTimer, job);
}

}
