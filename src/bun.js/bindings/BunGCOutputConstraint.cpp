/*
 * Copyright (C) 2017-2022 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"

#include <JavaScriptCore/WeakInlines.h>
#include <JavaScriptCore/AbstractSlotVisitorInlines.h>

#include <JavaScriptCore/VM.h>
#include <JavaScriptCore/MarkingConstraint.h>

// namespace JSC {

// class VisitCounter {
// public:
//     VisitCounter() {}

//     VisitCounter(AbstractSlotVisitor& visitor)
//         : m_visitor(&visitor)
//         , m_initialVisitCount(visitor.visitCount())
//     {
//     }

//     AbstractSlotVisitor& visitor() const { return *m_visitor; }

//     size_t visitCount() const
//     {
//         return m_visitor->visitCount() - m_initialVisitCount;
//     }

// private:
//     AbstractSlotVisitor* m_visitor { nullptr };
//     size_t m_initialVisitCount { 0 };
// };

// static constexpr bool verboseMarkingConstraint = false;

// MarkingConstraint::MarkingConstraint(CString abbreviatedName, CString name, ConstraintVolatility volatility, ConstraintConcurrency concurrency, ConstraintParallelism parallelism)
//     : m_abbreviatedName(abbreviatedName)
//     , m_name(WTFMove(name))
//     , m_volatility(volatility)
//     , m_concurrency(concurrency)
//     , m_parallelism(parallelism)
// {
// }

// MarkingConstraint::~MarkingConstraint()
// {
// }

// void MarkingConstraint::resetStats()
// {
//     m_lastVisitCount = 0;
// }

// void MarkingConstraint::execute(SlotVisitor& visitor)
// {
//     ASSERT(!visitor.heap()->isMarkingForGCVerifier());
//     VisitCounter visitCounter(visitor);
//     executeImpl(visitor);
//     m_lastVisitCount += visitCounter.visitCount();
//     if (verboseMarkingConstraint && visitCounter.visitCount())
//         dataLog("(", abbreviatedName(), " visited ", visitCounter.visitCount(), " in execute)");
// }

// void MarkingConstraint::executeSynchronously(AbstractSlotVisitor& visitor)
// {
//     prepareToExecuteImpl(NoLockingNecessary, visitor);
//     executeImpl(visitor);
// }

// double MarkingConstraint::quickWorkEstimate(SlotVisitor&)
// {
//     return 0;
// }

// double MarkingConstraint::workEstimate(SlotVisitor& visitor)
// {
//     return lastVisitCount() + quickWorkEstimate(visitor);
// }

// void MarkingConstraint::prepareToExecute(const AbstractLocker& constraintSolvingLocker, SlotVisitor& visitor)
// {
//     ASSERT(!visitor.heap()->isMarkingForGCVerifier());
//     dataLogIf(Options::logGC(), abbreviatedName());
//     VisitCounter visitCounter(visitor);
//     prepareToExecuteImpl(constraintSolvingLocker, visitor);
//     m_lastVisitCount = visitCounter.visitCount();
//     if (verboseMarkingConstraint && visitCounter.visitCount())
//         dataLog("(", abbreviatedName(), " visited ", visitCounter.visitCount(), " in prepareToExecute)");
// }

// void MarkingConstraint::doParallelWork(SlotVisitor& visitor, SharedTask<void(SlotVisitor&)>& task)
// {
//     ASSERT(!visitor.heap()->isMarkingForGCVerifier());
//     VisitCounter visitCounter(visitor);
//     task.run(visitor);
//     if (verboseMarkingConstraint && visitCounter.visitCount())
//         dataLog("(", abbreviatedName(), " visited ", visitCounter.visitCount(), " in doParallelWork)");
//     {
//         Locker locker { m_lock };
//         m_lastVisitCount += visitCounter.visitCount();
//     }
// }

// void MarkingConstraint::prepareToExecuteImpl(const AbstractLocker&, AbstractSlotVisitor&)
// {
// }

// } // namespace JSC

#include "BunGCOutputConstraint.h"

#include "WebCoreJSClientData.h"
#include <JavaScriptCore/BlockDirectoryInlines.h>
#include <JavaScriptCore/HeapInlines.h>
#include <JavaScriptCore/MarkedBlockInlines.h>
#include <JavaScriptCore/SubspaceInlines.h>

namespace WebCore {

using namespace JSC;

DOMGCOutputConstraint::DOMGCOutputConstraint(VM& vm, JSHeapData& heapData)
    : MarkingConstraint("Domo", "DOM Output", ConstraintVolatility::SeldomGreyed, ConstraintConcurrency::Concurrent, ConstraintParallelism::Parallel)
    , m_vm(vm)
    , m_heapData(heapData)
    , m_lastExecutionVersion(vm.heap.mutatorExecutionVersion())
{
}

DOMGCOutputConstraint::~DOMGCOutputConstraint()
{
}

template<typename Visitor>
void DOMGCOutputConstraint::executeImplImpl(Visitor& visitor)
{
    Heap& heap = m_vm.heap;

    if (heap.mutatorExecutionVersion() == m_lastExecutionVersion)
        return;

    m_lastExecutionVersion = heap.mutatorExecutionVersion();

    m_heapData.forEachOutputConstraintSpace(
        [&](Subspace& subspace) {
            auto func = [](Visitor& visitor, HeapCell* heapCell, HeapCell::Kind) {
                SetRootMarkReasonScope rootScope(visitor, RootMarkReason::DOMGCOutput);
                JSCell* cell = static_cast<JSCell*>(heapCell);
                cell->methodTable()->visitOutputConstraints(cell, visitor);
            };

            RefPtr<SharedTask<void(Visitor&)>> task = subspace.template forEachMarkedCellInParallel<Visitor>(func);
            visitor.addParallelConstraintTask(task);
        });
}

void DOMGCOutputConstraint::executeImpl(AbstractSlotVisitor& visitor) { executeImplImpl(visitor); }
void DOMGCOutputConstraint::executeImpl(SlotVisitor& visitor) { executeImplImpl(visitor); }

} // namespace WebCore
