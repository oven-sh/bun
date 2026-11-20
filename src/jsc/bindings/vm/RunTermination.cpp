#include "RunTermination.h"

#include "BunClientData.h"
#include "NodeVMRunTermination.h"
#include "TestCallbackDeadline.h"

#include <JavaScriptCore/VM.h>

namespace Bun {

using namespace JSC;

static thread_local RunTermination* s_innermostRunOnThisThread = nullptr;

RunTermination::RunTermination(VM& vm, Kind kind)
    : m_vm(vm)
    , m_kind(kind)
    , m_enclosing(std::exchange(s_innermostRunOnThisThread, this))
{
}

RunTermination::~RunTermination()
{
    ASSERT(s_innermostRunOnThisThread == this);
    s_innermostRunOnThisThread = m_enclosing;
}

bool RunTermination::wasCutShort() const
{
    switch (m_kind) {
    case Kind::NodeVMRun:
        return static_cast<const NodeVMRunTermination*>(this)->timedOutOrInterrupted();
    case Kind::TestCallback:
        return static_cast<const TestCallbackDeadline*>(this)->fired();
    }
    RELEASE_ASSERT_NOT_REACHED();
}

const RunTermination* RunTermination::enclosingRunCutShort() const
{
    for (auto* run = m_enclosing; run; run = run->m_enclosing) {
        if (run->wasCutShort())
            return run;
    }
    return nullptr;
}

bool RunTermination::withdrawTermination()
{
    VM& vm = m_vm;
    if (!WebCore::clientData(vm)->scriptAllowed())
        return false;

    vm.cancelTermination();
    // A stop requested between the check above and the withdrawal went with it.
    if (!WebCore::clientData(vm)->scriptAllowed()) [[unlikely]] {
        vm.notifyNeedTermination();
        return false;
    }
    return true;
}

} // namespace Bun
