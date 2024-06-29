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
    JSCDeferredWorkTask(Ticket ticket, Task&& task)
        : ticket(ticket)
        , task(WTFMove(task))
    {
    }

    Ticket ticket;
    Task task;

    WTF_MAKE_ISO_ALLOCATED(JSCDeferredWorkTask);
};

WTF_MAKE_ISO_ALLOCATED_IMPL(JSCDeferredWorkTask);

static JSC::VM& getVM(Ref<TicketData> ticket)
{
    return ticket->scriptExecutionOwner()->vm();
}

static JSC::VM& getVM(Ticket& ticket)
{
    return ticket->scriptExecutionOwner()->vm();
}

void JSCTaskScheduler::onAddPendingWork(Ref<TicketData> ticket, JSC::DeferredWorkTimer::WorkKind kind)
{
    JSC::VM& vm = getVM(ticket);
    auto clientData = WebCore::clientData(vm);
    auto& scheduler = clientData->deferredWorkTimer;
    Locker<Lock> holder { scheduler.m_lock };
    if (kind != DeferredWorkTimer::WorkKind::Other) {

        Bun__eventLoop__incrementRefConcurrently(clientData->bunVM, 1);
        scheduler.m_pendingTicketsKeepingEventLoopAlive.add(WTFMove(ticket));
    } else {
        scheduler.m_pendingTicketsOther.add(WTFMove(ticket));
    }
}
void JSCTaskScheduler::onScheduleWorkSoon(Ticket ticket, Task&& task)
{
    auto* job = new JSCDeferredWorkTask(ticket, WTFMove(task));
    Bun__queueJSCDeferredWorkTaskConcurrently(WebCore::clientData(getVM(ticket))->bunVM, job);
}

void JSCTaskScheduler::onCancelPendingWork(Ticket ticket)
{
    auto& scheduler = WebCore::clientData(getVM(ticket))->deferredWorkTimer;

    Locker<Lock> holder { scheduler.m_lock };
    bool isKeepingEventLoopAlive = scheduler.m_pendingTicketsKeepingEventLoopAlive.removeIf([ticket](auto pendingTicket) {
        return pendingTicket.ptr() == ticket;
    });

    if (isKeepingEventLoopAlive) {
        holder.unlockEarly();
        JSC::VM& vm = getVM(ticket);
        Bun__eventLoop__incrementRefConcurrently(WebCore::clientData(vm)->bunVM, -1);
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
        job->task(job->ticket);
    }

    delete job;
}

extern "C" void Bun__runDeferredWork(Bun::JSCDeferredWorkTask* job)
{
    auto& vm = getVM(job->ticket);
    auto clientData = WebCore::clientData(vm);

    runPendingWork(clientData->bunVM, clientData->deferredWorkTimer, job);
}

}
