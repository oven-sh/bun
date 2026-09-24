#include "root.h"
#include "RejectedPromiseQueue.h"
#include <JavaScriptCore/JSCellInlines.h>
#include <JavaScriptCore/JSGlobalObjectInlines.h>
#include <JavaScriptCore/JSWeakMap.h>
#include <JavaScriptCore/SlotVisitorInlines.h>
#include <JavaScriptCore/WeakMapImplInlines.h>

namespace Bun {

// Called under the cell lock.
NEVER_INLINE void RejectedPromiseQueue::compact()
{
    unsigned live = 0;
    unsigned next = 0;
    for (unsigned i = 0, size = m_entries.size(); i < size; ++i) {
        if (i == m_next)
            next = live;
        if (!m_entries[i].promise)
            continue;
        if (live != i)
            m_entries[live] = m_entries[i];
        ++live;
    }
    m_next = m_next < m_entries.size() ? next : live;
    m_entries.shrink(live);
    m_holes = 0;
    m_indices.clear();
    m_indexed = 0;
}

// Called without the cell lock: it only reads m_entries, and it allocates the map.
NEVER_INLINE unsigned RejectedPromiseQueue::find(JSC::JSGlobalObject* owner, JSC::JSPromise* promise)
{
    unsigned size = m_entries.size();
    if (size <= rejectedPromiseScanLimit) {
        for (unsigned i = size; i--;) {
            if (isAt(i, promise))
                return i;
        }
        return notFound;
    }

    JSC::VM& vm = owner->vm();
    JSC::JSWeakMap* indices = m_indices.get();
    if (!indices) {
        indices = JSC::JSWeakMap::create(vm, owner->weakMapStructure());
        WTF::Locker locker { owner->cellLock() };
        m_indices.set(vm, owner, indices);
    }
    for (; m_indexed < size; ++m_indexed) {
        if (JSC::JSValue queued = m_entries[m_indexed].promise.get())
            indices->add(vm, queued.asCell(), JSC::jsNumber(m_indexed));
    }
    // An entry removed without this lookup stays in the map until its promise dies, so check what was found.
    JSC::JSValue found = indices->get(promise);
    if (found.isUInt32() && found.asUInt32() < size && isAt(found.asUInt32(), promise))
        return found.asUInt32();
    return notFound;
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
    m_next = 0;
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
    visitor.append(m_indices);
}

template void RejectedPromiseQueue::visit(JSC::JSCell*, JSC::AbstractSlotVisitor&);
template void RejectedPromiseQueue::visit(JSC::JSCell*, JSC::SlotVisitor&);

bool InFlightRejections::tailContains(JSC::JSGlobalObject* globalObject, JSC::JSPromise* promise)
{
    size_t size = buffer->size();
    if (size - index <= rejectedPromiseScanLimit) {
        for (size_t i = index; i < size; ++i) {
            if (buffer->at(i).asCell() == promise)
                return true;
        }
        return false;
    }
    if (!positions) {
        JSC::VM& vm = globalObject->vm();
        positions = JSC::JSWeakMap::create(vm, globalObject->weakMapStructure());
        for (size_t i = index; i < size; ++i)
            positions->add(vm, buffer->at(i).asCell(), JSC::jsNumber(static_cast<uint32_t>(i)));
    }
    JSC::JSValue found = positions->get(promise);
    return found.isUInt32() && found.asUInt32() >= index;
}

} // namespace Bun
