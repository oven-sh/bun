#include "NodeVMRunTermination.h"

#include "BunClientData.h"
#include "ErrorCode.h"
#include "SigintWatcher.h"

#include <JavaScriptCore/TopExceptionScope.h>
#include <JavaScriptCore/VM.h>

namespace Bun {

using namespace JSC;

static thread_local NodeVMRunTermination* s_innermostRunOnThisThread = nullptr;

NodeVMRunTermination::NodeVMRunTermination(JSGlobalObject* realm, std::optional<Seconds> timeout, bool breakOnSigint)
    : m_vm(realm->vm())
    , m_realm(realm)
    , m_timeout(timeout)
    , m_enclosing(std::exchange(s_innermostRunOnThisThread, this))
{
    if (breakOnSigint) {
        // Requested from the signal thread by then: the exception object it needs must exist.
        m_vm.ensureTerminationException();
        SigintWatcher::get().registerReceiver(this);
        m_listeningForSigint = true;
    }
    if (m_timeout)
        m_deadline = m_vm.addTerminationDeadline(MonotonicTime::now() + *m_timeout);
}

NodeVMRunTermination::~NodeVMRunTermination()
{
    ASSERT(m_finished);
    ASSERT(s_innermostRunOnThisThread == this);
    s_innermostRunOnThisThread = m_enclosing;
}

void NodeVMRunTermination::disarm()
{
    if (std::exchange(m_listeningForSigint, false))
        SigintWatcher::get().unregisterReceiver(this);
    if (m_deadline)
        m_deadline->cancel(m_vm);
    // From here m_sigintReceived and didFire() are final.
}

void NodeVMRunTermination::finish(ThrowScope& scope)
{
    ASSERT(!std::exchange(m_finished, true));
    // The caller has observed whatever the run left on `scope` (this satisfies the exception-check validator
    // for it); what happens to it is decided below.
    std::ignore = scope.exception();
    disarm();
    if (!wasCutShort())
        return;
    VM& vm = m_vm;
    // The VM has been asked to stop as a whole meanwhile: that request is indistinguishable from ours and wins.
    if (!WebCore::clientData(vm)->scriptAllowed())
        return;

    vm.cancelTermination();
    // A stop requested between the check above and the withdrawal went with it: re-request, the stop wins.
    if (!WebCore::clientData(vm)->scriptAllowed()) [[unlikely]] {
        vm.notifyNeedTermination();
        return;
    }
    {
        // Whatever else the cut-short run may have left pending: the timeout / interrupt error replaces it.
        auto top = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        if (top.exception())
            top.clearException();
    }

    if (timedOut())
        throwError(m_realm, scope, ErrorCode::ERR_SCRIPT_EXECUTION_TIMEOUT, makeString("Script execution timed out after "_s, m_timeout->milliseconds(), "ms"_s));
    else
        throwError(m_realm, scope, ErrorCode::ERR_SCRIPT_EXECUTION_INTERRUPTED, "Script execution was interrupted by `SIGINT`"_s);

    // A run this one is nested in may have been cut short as well by now (its own deadline); its request went
    // with ours, so make it again — after building the error above, which a pending trap would have cut short.
    // That error is then just what the enclosing script sees while it unwinds.
    if (enclosingRunCutShort())
        vm.notifyNeedTermination();
}

const NodeVMRunTermination* NodeVMRunTermination::enclosingRunCutShort() const
{
    for (auto* run = m_enclosing; run; run = run->m_enclosing) {
        if (run->wasCutShort())
            return run;
    }
    return nullptr;
}

JSObject* NodeVMRunTermination::errorForEnclosingRunCutShort() const
{
    ASSERT(m_finished);
    if (wasCutShort() || !m_vm.hasPendingTermination())
        return nullptr;
    const auto* run = enclosingRunCutShort();
    if (!run)
        return nullptr;
    if (run->timedOut())
        return createError(m_realm, ErrorCode::ERR_SCRIPT_EXECUTION_TIMEOUT, makeString("Script execution timed out after "_s, run->m_timeout->milliseconds(), "ms"_s));
    return createError(m_realm, ErrorCode::ERR_SCRIPT_EXECUTION_INTERRUPTED, "Script execution was interrupted by `SIGINT`"_s);
}

} // namespace Bun
