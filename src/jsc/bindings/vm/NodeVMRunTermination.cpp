#include "NodeVMRunTermination.h"

#include "BunClientData.h"
#include "ErrorCode.h"

#include <JavaScriptCore/TopExceptionScope.h>
#include <JavaScriptCore/VM.h>
#include <JavaScriptCore/VMTrapsInlines.h>

namespace Bun {

using namespace JSC;

static thread_local NodeVMRunTermination* s_innermostRunOnThisThread = nullptr;

NodeVMRunTermination::NodeVMRunTermination(JSGlobalObject* sigintRealm, std::optional<Seconds> timeout, bool breakOnSigint)
    : m_vm(sigintRealm->vm())
    , m_timeout(timeout)
    , m_enclosing(std::exchange(s_innermostRunOnThisThread, this))
{
    if (breakOnSigint) {
        // Requested from the signal thread by then: the exception object it needs must exist.
        m_vm.ensureTerminationException();
        // Receiver before realm: a SIGINT landing between the two must not notify the VM unrecorded.
        m_sigintHold.emplace(static_cast<SigintReceiver*>(this), sigintRealm);
    }
    if (m_timeout)
        m_deadline = m_vm.addTerminationDeadline(MonotonicTime::now() + *m_timeout);
}

NodeVMRunTermination::~NodeVMRunTermination()
{
    withdraw();
    ASSERT(s_innermostRunOnThisThread == this);
    s_innermostRunOnThisThread = m_enclosing;
}

void NodeVMRunTermination::withdraw()
{
    if (std::exchange(m_withdrawn, true))
        return;
    // Unregister first, then read: after this either the watcher has already flagged us (and notified the
    // VM), or it never will for this run.
    m_sigintHold.reset();
    if (m_deadline) {
        m_deadline->cancel(m_vm);
        m_timedOut = m_deadline->didFire();
    }
}

bool NodeVMRunTermination::wasCutShort() const
{
    return (m_deadline && m_deadline->didFire()) || m_sigintReceived;
}

void NodeVMRunTermination::finish(JSGlobalObject* errorRealm, ThrowScope& scope, JSGlobalObject* microtaskContext)
{
    ASSERT(!m_withdrawn);
    withdraw();
    bool interrupted = m_sigintReceived;
    if (!m_timedOut && !interrupted)
        return;
    VM& vm = m_vm;
    // The VM has been asked to stop as a whole meanwhile: that request is indistinguishable from ours and wins.
    if (!WebCore::clientData(vm)->scriptAllowed())
        return;

    vm.cancelTermination();
    {
        // Whatever else the cut-short run may have left pending: the timeout / interrupt error replaces it.
        auto top = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        if (top.exception())
            top.clearException();
    }
    if (microtaskContext)
        vm.drainMicrotasksForGlobalObject(microtaskContext);

    if (m_timedOut)
        throwError(errorRealm, scope, ErrorCode::ERR_SCRIPT_EXECUTION_TIMEOUT, makeString("Script execution timed out after "_s, m_timeout->milliseconds(), "ms"_s));
    else
        throwError(errorRealm, scope, ErrorCode::ERR_SCRIPT_EXECUTION_INTERRUPTED, "Script execution was interrupted by `SIGINT`"_s);

    // A run this one is nested in may have been cut short as well by now (its own deadline, its own SIGINT); its
    // request went with ours, so make it again — after building the error above, which a pending trap would
    // have cut short. That error is then just what the enclosing script sees while it unwinds.
    for (auto* run = m_enclosing; run; run = run->m_enclosing) {
        if (run->wasCutShort()) {
            vm.notifyNeedTermination();
            break;
        }
    }
}

} // namespace Bun
