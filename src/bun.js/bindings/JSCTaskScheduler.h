#pragma once

#include <JavaScriptCore/DeferredWorkTimer.h>

namespace Bun {

class JSCTaskScheduler {
public:
    JSCTaskScheduler()
        : m_pendingTicketsKeepingEventLoopAlive()
        , m_pendingTicketsOther()
    {
    }

    static void onAddPendingWork(Ref<JSC::DeferredWorkTimer::TicketData> ticket, JSC::DeferredWorkTimer::WorkKind kind);
    static void onScheduleWorkSoon(JSC::DeferredWorkTimer::Ticket ticket, JSC::DeferredWorkTimer::Task&& task);
    static void onCancelPendingWork(JSC::DeferredWorkTimer::Ticket ticket);

public:
    Lock m_lock;
    HashSet<Ref<JSC::DeferredWorkTimer::TicketData>> m_pendingTicketsKeepingEventLoopAlive;
    HashSet<Ref<JSC::DeferredWorkTimer::TicketData>> m_pendingTicketsOther;
};

}