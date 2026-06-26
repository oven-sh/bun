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
    auto* clientData = WebCore::clientData(vm);
    m_enclosing = clientData->nodeVMEvalTimeouts;
    clientData->nodeVMEvalTimeouts = this;
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

bool NodeVMEvalTimeout::hasExpired() const
{
    WTF::Locker locker { m_state->lock };
    return m_state->expired;
}

void NodeVMEvalTimeout::disarm()
{
    if (!m_armed)
        return;
    m_armed = false;
    // Evaluations nest strictly, so this is the innermost armed deadline.
    auto* clientData = WebCore::clientData(m_vm);
    ASSERT(clientData->nodeVMEvalTimeouts == this);
    clientData->nodeVMEvalTimeouts = m_enclosing;
    {
        WTF::Locker locker { m_state->lock };
        m_state->vm = nullptr;
        m_expired = m_state->expired;
    }
    if (!m_expired)
        return;
    // If the deadline passed after the evaluation's last trap check, the
    // NeedTermination trap is still pending and would terminate whatever JS
    // runs next. It was raised on behalf of this evaluation, so consume it;
    // the caller reports ERR_SCRIPT_EXECUTION_TIMEOUT either way.
    m_vm.traps().clearTrap(VMTraps::NeedTermination);
}

void NodeVMEvalTimeout::raiseExpiredDeadline(VM& vm)
{
    // The evaluation that just finished has already been popped (disarm()),
    // so this walks only the still-armed enclosing deadlines. One that
    // expires after this check raises the request from its own timer, so
    // nothing is lost by only checking deadlines that have already expired.
    for (NodeVMEvalTimeout* armed = WebCore::clientData(vm)->nodeVMEvalTimeouts; armed; armed = armed->m_enclosing) {
        if (armed->hasExpired()) {
            vm.notifyNeedTermination();
            return;
        }
    }
}

} // namespace Bun
