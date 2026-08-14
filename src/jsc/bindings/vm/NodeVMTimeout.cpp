#include "NodeVMTimeout.h"
#include "BunClientData.h"
#include "ErrorCode.h"
#include <JavaScriptCore/TopExceptionScope.h>
#include <JavaScriptCore/VMTrapsInlines.h>
#include <mutex>
#include <wtf/NeverDestroyed.h>
#include <wtf/WorkQueue.h>

namespace Bun {

static WorkQueue& timerQueue()
{
    static LazyNeverDestroyed<Ref<WorkQueue>> queue;
    static std::once_flag once;
    std::call_once(once, [] { queue.construct(WorkQueue::create("bun: node:vm timeout"_s)); });
    return queue.get();
}

NodeVMTimeout::NodeVMTimeout(JSC::VM& vm, std::optional<double> timeoutMs)
    : m_vm(vm)
    , m_timeoutMs(timeoutMs)
{
    if (!timeoutMs)
        return;
    vm.ensureTerminationException();
    m_state = adoptRef(*new State);
    {
        Locker locker { m_state->lock };
        m_state->vm = &vm;
    }
    WebCore::clientData(vm)->nodeVMTimeoutsArmed++;
    timerQueue().dispatchAfter(Seconds::fromMilliseconds(*timeoutMs), [state = Ref { *m_state }] {
        Locker locker { state->lock };
        if (!state->vm)
            return;
        state->fired = true;
        std::exchange(state->vm, nullptr)->notifyNeedTermination();
    });
}

bool NodeVMTimeout::disarm()
{
    if (!m_state)
        return false;
    bool fired;
    {
        Locker locker { m_state->lock };
        m_state->vm = nullptr;
        fired = m_state->fired;
    }
    m_state = nullptr;
    WebCore::clientData(m_vm)->nodeVMTimeoutsArmed--;
    m_fired = fired;
    return fired;
}

bool NodeVMTimeout::takeOwnTermination(JSC::JSGlobalObject* errorGlobalObject, JSC::JSGlobalObject* drainGlobalObject, JSC::ThrowScope& scope, SigintReceiver& receiver)
{
    JSC::VM& vm = m_vm;
    disarm();
    bool interrupted = receiver.getSigintReceived();
    if (!m_fired && !interrupted)
        return false;
    // The VM is being stopped as well (worker.terminate() / exit): that wins, the caller rethrows.
    if (!Bun__VmHandle__scriptAllowed(WebCore::clientData(vm)->vmHandle))
        return false;

    {
        auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        // Requested but not yet delivered (the script finished in between): deliver it here rather than into
        // whatever the caller runs next.
        if (!vm.hasTerminationRequest())
            std::ignore = vm.hasExceptionsAfterHandlingTraps();
        if (drainGlobalObject)
            vm.drainMicrotasksForGlobalObject(drainGlobalObject);
        catchScope.clearException();
    }
    vm.clearHasTerminationRequest();
    receiver.setSigintReceived(false);

    if (interrupted)
        throwError(errorGlobalObject, scope, ErrorCode::ERR_SCRIPT_EXECUTION_INTERRUPTED, "Script execution was interrupted by `SIGINT`"_s);
    else
        throwError(errorGlobalObject, scope, ErrorCode::ERR_SCRIPT_EXECUTION_TIMEOUT, makeString("Script execution timed out after "_s, *m_timeoutMs, "ms"_s));
    return true;
}

} // namespace Bun

extern "C" bool JSC__VM__hasExecutionTimeLimit(JSC::VM* vm)
{
    return WebCore::clientData(*vm)->nodeVMTimeoutsArmed > 0;
}
