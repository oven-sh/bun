#include "engine/Engine.h"

namespace JSC {

extern "C" void engine_host_did_run_microtask(VM* vm)
{
    vm->callOnEachMicrotaskTick();
}

extern "C" void engine_host_report_error_of_microtask(JSGlobalObject* globalObject, Exception* exception)
{
    globalObject->vm().clientData->reportErrorOfMicrotask(globalObject, exception);
}

struct DestroyDeferredTask {
    void operator()(Engine::DeferredTask* task) const { Engine::deferred_task_destroy(task); }
};

extern "C" void engine_host_add_pending_work(void* timer, const DeferredWorkTicket* ticket, uint8_t kind)
{
    static_cast<DeferredWorkTimer*>(timer)->onAddPendingWork(adoptRef(*const_cast<DeferredWorkTicket*>(ticket)), static_cast<DeferredWorkTimer::WorkType>(kind));
}

extern "C" void engine_host_schedule_work(void* timer, const DeferredWorkTicket* ticket, Engine::DeferredTask* task)
{
    auto run = [task = std::unique_ptr<Engine::DeferredTask, DestroyDeferredTask>(task)](DeferredWorkTicket& ticket) mutable {
        Engine::deferred_task_run(task.release(), ticket.target()->realm(), ticket);
    };
    static_cast<DeferredWorkTimer*>(timer)->onScheduleWorkSoon(adoptRef(*const_cast<DeferredWorkTicket*>(ticket)), WTF::move(run));
}

extern "C" void engine_host_cancel_pending_work(void* timer, DeferredWorkTicket* ticket)
{
    static_cast<DeferredWorkTimer*>(timer)->onCancelPendingWork(*ticket);
}

extern "C" void engine_host_set_timer(void* timer, bool isArmed, double seconds)
{
    static_cast<DeferredWorkTimer*>(timer)->onSetTimer(isArmed ? std::optional(Seconds(seconds)) : std::nullopt);
}

} // namespace JSC
