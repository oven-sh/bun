#include "root.h"
#include "RejectedPromiseQueue.h"
#include <JavaScriptCore/JSCellInlines.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/SlotVisitorInlines.h>
#include <wtf/Locker.h>

namespace Bun {

// Up to this many promises are cheaper to scan than to hash.
static constexpr unsigned rejectedPromiseScanLimit = 16;

void RejectedPromiseQueue::append(JSC::VM& vm, JSC::JSCell* owner, JSC::JSPromise* promise, JSC::JSObject* rejectionOwner)
{
    WTF::Locker locker { owner->cellLock() };
    // Full and at least half holes: compact instead of growing, for the same amortized cost.
    if (m_holes && m_entries.size() == m_entries.capacity() && m_holes >= m_entries.size() / 2) {
        m_entries.removeAllMatching([](Entry& entry) { return !entry.promise; });
        m_holes = 0;
        m_indices.clear();
        m_indexed = 0;
    }
    m_entries.append({});
    m_entries.last().promise.set(vm, owner, promise);
    m_entries.last().rejectionOwner.set(vm, owner, rejectionOwner ? JSC::JSValue(rejectionOwner) : JSC::jsNull());
}

bool RejectedPromiseQueue::remove(JSC::JSCell* owner, JSC::JSPromise* promise)
{
    WTF::Locker locker { owner->cellLock() };
    // Newest first: the newest rejection is the usual one to be handled.
    unsigned size = m_entries.size();
    unsigned scanFrom = size <= rejectedPromiseScanLimit ? 0 : size - 1;
    unsigned index = size;
    for (unsigned i = size; i-- > scanFrom;) {
        if (m_entries[i].promise.get().asCell() == promise) {
            index = i;
            break;
        }
    }
    if (index < size) {
        if (index < m_indexed)
            m_indices.remove(promise);
    } else {
        if (!scanFrom)
            return false;
        for (; m_indexed < size; ++m_indexed) {
            JSC::JSValue queued = m_entries[m_indexed].promise.get();
            if (!queued)
                continue;
            auto result = m_indices.add(static_cast<JSC::JSPromise*>(queued.asCell()), m_indexed);
            ASSERT_UNUSED(result, result.isNewEntry);
        }
        auto it = m_indices.find(promise);
        if (it == m_indices.end())
            return false;
        index = it->value;
        m_indices.remove(it);
        ASSERT(index + 1 < size);
    }

    if (index + 1 < size) {
        m_entries[index].promise.clear();
        m_entries[index].rejectionOwner.clear();
        ++m_holes;
        return true;
    }
    // The last entry is never a hole, so a reject-then-handle loop reuses one slot.
    m_entries.removeLast();
    while (!m_entries.isEmpty() && !m_entries.last().promise) {
        m_entries.removeLast();
        --m_holes;
    }
    m_indexed = std::min<unsigned>(m_indexed, m_entries.size());
    return true;
}

void RejectedPromiseQueue::drainTo(JSC::JSCell* owner, JSC::MarkedArgumentBuffer& promises, JSC::MarkedArgumentBuffer& rejectionOwners)
{
    WTF::Locker locker { owner->cellLock() };
    size_t count = m_entries.size() - m_holes;
    promises.ensureCapacity(promises.size() + count);
    rejectionOwners.ensureCapacity(rejectionOwners.size() + count);
    for (Entry& entry : m_entries) {
        if (!entry.promise)
            continue;
        promises.append(entry.promise.get());
        rejectionOwners.append(entry.rejectionOwner.get());
    }
    m_entries.clear();
    m_holes = 0;
    m_indices.clear();
    m_indexed = 0;
}

template<typename Visitor>
void RejectedPromiseQueue::visit(JSC::JSCell* owner, Visitor& visitor)
{
    WTF::Locker locker { owner->cellLock() };
    for (auto& entry : m_entries) {
        visitor.append(entry.promise);
        visitor.append(entry.rejectionOwner);
    }
}

template void RejectedPromiseQueue::visit(JSC::JSCell*, JSC::AbstractSlotVisitor&);
template void RejectedPromiseQueue::visit(JSC::JSCell*, JSC::SlotVisitor&);

bool InFlightRejections::tailContains(JSC::JSPromise* promise)
{
    size_t size = buffer->size();
    if (size - index <= rejectedPromiseScanLimit) {
        for (size_t i = index; i < size; ++i) {
            if (buffer->at(i).asCell() == promise)
                return true;
        }
        return false;
    }
    if (positions.isEmpty()) {
        for (size_t i = index; i < size; ++i)
            positions.add(static_cast<JSC::JSPromise*>(buffer->at(i).asCell()), i);
    }
    auto it = positions.find(promise);
    return it != positions.end() && it->value >= index;
}

} // namespace Bun
