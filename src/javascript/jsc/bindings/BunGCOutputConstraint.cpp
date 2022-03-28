

#include "BunGCOutputConstraint.h"

#include "BunClientData.h"
#include "JavaScriptCore/BlockDirectoryInlines.h"
#include "JavaScriptCore/HeapInlines.h"
#include "JavaScriptCore/MarkedBlockInlines.h"
#include "JavaScriptCore/MarkingConstraint.h"
#include "JavaScriptCore/SubspaceInlines.h"
#include "JavaScriptCore/VM.h"

namespace WebCore {

using namespace JSC;

BunGCOutputConstraint::BunGCOutputConstraint(VM& vm, WebCore::JSVMClientData& clientData)
    : MarkingConstraint("Domo", "DOM Output", ConstraintVolatility::SeldomGreyed, ConstraintConcurrency::Concurrent, ConstraintParallelism::Parallel)
    , m_vm(vm)
    , m_clientData(clientData)
    , m_lastExecutionVersion(vm.heap.mutatorExecutionVersion())
{
}

template<typename Visitor> void BunGCOutputConstraint::executeImplImpl(Visitor& visitor)
{
    Heap& heap = m_vm.heap;

    if (heap.mutatorExecutionVersion() == m_lastExecutionVersion)
        return;

    m_lastExecutionVersion = heap.mutatorExecutionVersion();

    m_clientData.forEachOutputConstraintSpace([&](Subspace& subspace) {
        auto func = [](Visitor& visitor, HeapCell* heapCell, HeapCell::Kind) {
            SetRootMarkReasonScope rootScope(visitor, RootMarkReason::DOMGCOutput);
            JSCell* cell = static_cast<JSCell*>(heapCell);
            cell->methodTable(visitor.vm())->visitOutputConstraints(cell, visitor);
        };

        RefPtr<SharedTask<void(Visitor&)>> task = subspace.template forEachMarkedCellInParallel<Visitor>(func);
        visitor.addParallelConstraintTask(task);
    });
}

void BunGCOutputConstraint::executeImpl(AbstractSlotVisitor& visitor)
{
    executeImplImpl(visitor);
}
void BunGCOutputConstraint::executeImpl(SlotVisitor& visitor) { executeImplImpl(visitor); }

} // namespace WebCore
