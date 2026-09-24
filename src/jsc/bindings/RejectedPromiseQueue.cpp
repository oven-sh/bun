#include "root.h"
#include "RejectedPromiseQueue.h"
#include <JavaScriptCore/JSCellInlines.h>
#include <JavaScriptCore/JSGlobalObjectInlines.h>
#include <JavaScriptCore/JSWeakSet.h>
#include <JavaScriptCore/SlotVisitorInlines.h>
#include <JavaScriptCore/WeakMapImplInlines.h>

namespace Bun {

NEVER_INLINE bool RejectedPromiseQueue::wasReported(JSC::JSPromise* promise)
{
    return m_reported->has(promise);
}

// Vector full, cell lock held. Handled promises go first, or a turn that never handles its newest rejection keeps them all until the drain.
NEVER_INLINE void RejectedPromiseQueue::makeRoom()
{
    size_t capacity = m_entries.capacity();
    if (capacity >= 64)
        m_entries.removeAllMatching([](const Entry& entry) { return isHandled(entry); });
    if (!capacity || m_entries.size() > capacity / 2)
        m_entries.reserveCapacity(std::max<size_t>(16, capacity * 2));
}

void RejectedPromiseQueue::markReported(JSC::JSGlobalObject* owner, JSC::JSPromise* promise)
{
    JSC::VM& vm = owner->vm();
    JSC::JSWeakSet* reported = m_reported.get();
    if (!reported) {
        reported = JSC::JSWeakSet::create(vm, owner->weakSetStructure());
        WTF::Locker locker { owner->cellLock() };
        m_reported.set(vm, owner, reported);
    }
    reported->add(vm, promise);
}

void RejectedPromiseQueue::drainTo(JSC::JSCell* owner, JSC::MarkedArgumentBuffer& promises, JSC::MarkedArgumentBuffer& rejectionOwners)
{
    WTF::Locker locker { owner->cellLock() };
    for (Entry& entry : m_entries) {
        if (isHandled(entry))
            continue;
        promises.append(entry.promise.get());
        rejectionOwners.append(entry.rejectionOwner.get());
    }
    m_entries.clear();
}

template<typename Visitor>
void RejectedPromiseQueue::visit(JSC::JSCell* owner, Visitor& visitor)
{
    WTF::Locker locker { owner->cellLock() };
    for (auto& entry : m_entries) {
        visitor.append(entry.promise);
        visitor.append(entry.rejectionOwner);
    }
    visitor.append(m_reported);
}

template void RejectedPromiseQueue::visit(JSC::JSCell*, JSC::AbstractSlotVisitor&);
template void RejectedPromiseQueue::visit(JSC::JSCell*, JSC::SlotVisitor&);

} // namespace Bun
