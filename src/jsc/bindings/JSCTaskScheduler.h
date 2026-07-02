#pragma once

namespace WebCore {
class JSVMClientData;
}

#include <JavaScriptCore/DeferredWorkTimer.h>

namespace Bun {

class JSCTaskScheduler {
public:
    JSCTaskScheduler()
        : m_pendingTicketsKeepingEventLoopAlive()
        , m_pendingTicketsOther()
    {
    }

    static void onAddPendingWork(WebCore::JSVMClientData* clientData, Ref<JSC::DeferredWorkTimer::TicketData>&& ticket, JSC::DeferredWorkTimer::WorkType kind);
    static void onScheduleWorkSoon(WebCore::JSVMClientData* clientData, JSC::DeferredWorkTimer::Ticket ticket, JSC::DeferredWorkTimer::Task&& task);
    static void onCancelPendingWork(WebCore::JSVMClientData* clientData, JSC::DeferredWorkTimer::Ticket ticket);

    // Pending work added with WorkType::AtSomePoint does not hold an event loop
    // ref because it may never be scheduled (e.g. Atomics.waitAsync). Call this
    // once such work is guaranteed to get scheduled (the wasm streaming compiler
    // received its last byte): the ticket targeting `target` then keeps the
    // event loop alive until it is scheduled or cancelled.
    static void refEventLoopForPendingWork(WebCore::JSVMClientData* clientData, JSC::JSObject* target);

public:
    Lock m_lock;
    UncheckedKeyHashSet<Ref<JSC::DeferredWorkTimer::TicketData>> m_pendingTicketsKeepingEventLoopAlive;
    UncheckedKeyHashSet<Ref<JSC::DeferredWorkTimer::TicketData>> m_pendingTicketsOther;
};

}
