#include "NodeVMRunTermination.h"

#include "BunClientData.h"
#include "ErrorCode.h"
#include "NodeVMModule.h"
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
}

void NodeVMRunTermination::addCheckpointCutShort(JSValue context)
{
    if (!m_checkpointsCutShort)
        m_checkpointsCutShort.emplace();
    m_checkpointsCutShort->append(context);
}

void NodeVMRunTermination::handCheckpointsCutShortToEnclosingRun()
{
    if (!m_checkpointsCutShort || !m_enclosing) [[likely]]
        return;
    for (size_t i = 0; i < m_checkpointsCutShort->size(); ++i)
        m_enclosing->addCheckpointCutShort(m_checkpointsCutShort->at(i));
}

void NodeVMRunTermination::noteCheckpointCutShort(NodeVMGlobalObject* context)
{
    if (auto* run = s_innermostRunOnThisThread)
        run->addCheckpointCutShort(context);
}

void NodeVMRunTermination::disarm()
{
    if (std::exchange(m_listeningForSigint, false))
        SigintWatcher::get().unregisterReceiver(this);
    if (m_deadline)
        m_deadline->cancel(m_vm);
    // From here m_sigintReceived and didFire() are final.
}

void NodeVMRunTermination::finish(ThrowScope& scope, CyclicModuleRecord* moduleOfRun)
{
    ASSERT(!std::exchange(m_finished, true));
    // The caller has observed whatever the run left on `scope` (this satisfies the exception-check validator
    // for it); what happens to it is decided below.
    std::ignore = scope.exception();
    disarm();
    // The run is over. A run that starts from here on is not nested in it.
    ASSERT(s_innermostRunOnThisThread == this);
    s_innermostRunOnThisThread = m_enclosing;
    if (!wasCutShort()) {
        handCheckpointsCutShortToEnclosingRun();
        return;
    }
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

    JSObject* error = timedOut()
        ? createError(m_realm, ErrorCode::ERR_SCRIPT_EXECUTION_TIMEOUT, makeString("Script execution timed out after "_s, m_timeout->milliseconds(), "ms"_s))
        : createError(m_realm, ErrorCode::ERR_SCRIPT_EXECUTION_INTERRUPTED, "Script execution was interrupted by `SIGINT`"_s);
    // This can run jobs of a context. A termination that arrives in them is of an enclosing run, and wins.
    NodeVMModule::errorModulesCutShort(vm, error, m_checkpointsCutShort ? ArgList(*m_checkpointsCutShort) : ArgList(), moduleOfRun);
    if (scope.exception()) [[unlikely]] {
        handCheckpointsCutShortToEnclosingRun();
        return;
    }
    scope.throwException(m_realm, error);

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

} // namespace Bun
