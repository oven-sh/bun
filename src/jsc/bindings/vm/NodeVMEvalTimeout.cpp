#include "NodeVMEvalTimeout.h"

#include "BunClientData.h"

#include <JavaScriptCore/VMTraps.h>
#include <wtf/WorkQueue.h>

namespace Bun {

using namespace JSC;

NodeVMEvalTimeout::NodeVMEvalTimeout(VM& vm, int64_t milliseconds)
    : m_state(adoptRef(*new State))
    , m_vm(vm)
    , m_milliseconds(milliseconds)
{
    // The timer's notifyNeedTermination() needs the singleton
    // TerminationException to exist, and it can only be created on this
    // thread.
    vm.ensureTerminationException();
    WebCore::clientData(vm)->nodeVMEvalTimeoutDepth++;
    {
        WTF::Locker locker { m_state->lock };
        m_state->vm = &vm;
    }
    VMTraps::queue().dispatchAfter(Seconds::fromMilliseconds(milliseconds), [state = m_state.copyRef()] {
        WTF::Locker locker { state->lock };
        if (!state->vm)
            return;
        state->expired = true;
        state->vm->notifyNeedTermination();
    });
}

NodeVMEvalTimeout::~NodeVMEvalTimeout()
{
    disarm();
}

void NodeVMEvalTimeout::disarm()
{
    if (!m_armed)
        return;
    m_armed = false;
    WebCore::clientData(m_vm)->nodeVMEvalTimeoutDepth--;
    {
        WTF::Locker locker { m_state->lock };
        m_state->vm = nullptr;
        m_expired = m_state->expired;
    }
    // If the deadline passed after the evaluation's last trap check, the
    // NeedTermination trap is still pending and would terminate whatever JS
    // runs next. It was raised on behalf of this evaluation, so consume it;
    // the caller reports ERR_SCRIPT_EXECUTION_TIMEOUT either way.
    if (m_expired)
        m_vm.traps().clearTrap(VMTraps::NeedTermination);
}

} // namespace Bun
