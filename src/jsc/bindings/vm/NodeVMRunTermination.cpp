#include "NodeVMRunTermination.h"

#include "BunClientData.h"
#include "ErrorCode.h"

#include <JavaScriptCore/TopExceptionScope.h>
#include <JavaScriptCore/VM.h>
#include <JavaScriptCore/VMTrapsInlines.h>
#include <wtf/NeverDestroyed.h>
#include <wtf/WorkQueue.h>
#include <wtf/text/MakeString.h>

namespace Bun {

static thread_local unsigned s_timeoutsArmedOnThisThread = 0;

static WorkQueue& timerQueue()
{
    static LazyNeverDestroyed<Ref<WorkQueue>> queue;
    static std::once_flag once;
    std::call_once(once, [] {
        queue.construct(WorkQueue::create("node:vm timeout"_s));
    });
    return queue.get();
}

NodeVMRunTermination::NodeVMRunTermination(JSC::VM& vm, std::optional<double> timeoutMs, SigintReceiver* sigintReceiver)
    : m_vm(vm)
    , m_timeoutMs(timeoutMs)
    , m_sigintReceiver(sigintReceiver)
{
    if (m_sigintReceiver)
        m_sigintReceiver->setSigintReceived(false);
    if (!m_timeoutMs)
        return;
    // A terminated worker's script must find the TerminationException object already made.
    vm.ensureTerminationException();
    m_timer = adoptRef(*new TimerState);
    {
        Locker locker { m_timer->lock };
        m_timer->vm = &vm;
    }
    ++s_timeoutsArmedOnThisThread;
    timerQueue().dispatchAfter(Seconds::fromMilliseconds(*m_timeoutMs), [timer = m_timer] {
        Locker locker { timer->lock };
        if (!timer->vm)
            return;
        timer->fired = true;
        timer->vm->notifyNeedTermination();
    });
}

NodeVMRunTermination::~NodeVMRunTermination()
{
    // An early return that skipped finish() must still not leave the timer aimed at the VM.
    if (!m_finished)
        disarm();
}

bool NodeVMRunTermination::disarm()
{
    if (!m_timer)
        return false;
    bool fired;
    {
        Locker locker { m_timer->lock };
        m_timer->vm = nullptr;
        fired = m_timer->fired;
    }
    m_timer = nullptr;
    --s_timeoutsArmedOnThisThread;
    return fired;
}

bool NodeVMRunTermination::timeoutArmedOnCurrentThread()
{
    return s_timeoutsArmedOnThisThread;
}

bool NodeVMRunTermination::finish(JSC::JSGlobalObject* errorGlobalObject, JSC::ThrowScope& scope, JSC::JSGlobalObject* contextGlobalObject)
{
    ASSERT(!m_finished);
    m_finished = true;
    JSC::VM& vm = m_vm;

    bool timedOut = disarm();
    bool interrupted = m_sigintReceiver && m_sigintReceiver->getSigintReceived();
    if (m_sigintReceiver)
        m_sigintReceiver->setSigintReceived(false);
    if (!timedOut && !interrupted)
        return false;

    // We asked for the termination that is pending in one of its three forms (trap not yet acted on;
    // acted on: request set and TerminationException thrown; exception meanwhile taken by a catch
    // scope). Take all of it back...
    vm.traps().clearTrap(JSC::VMTraps::NeedTermination);
    // ...unless the VM has meanwhile been asked to stop as a whole, whose request this equally is.
    if (!WebCore::clientData(vm)->scriptAllowed()) {
        vm.notifyNeedTermination();
        return false;
    }
    if (contextGlobalObject)
        vm.drainMicrotasksForGlobalObject(contextGlobalObject);
    {
        // The TerminationException if it is still pending, or whatever the cut-short run threw
        // instead: the timeout / interrupt error replaces it, as in Node.
        auto top = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        if (top.exception())
            top.clearException();
    }
    vm.clearHasTerminationRequest();

    if (interrupted)
        throwError(errorGlobalObject, scope, ErrorCode::ERR_SCRIPT_EXECUTION_INTERRUPTED, "Script execution was interrupted by `SIGINT`"_s);
    else
        throwError(errorGlobalObject, scope, ErrorCode::ERR_SCRIPT_EXECUTION_TIMEOUT, makeString("Script execution timed out after "_s, *m_timeoutMs, "ms"_s));
    return true;
}

} // namespace Bun
