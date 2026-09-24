#pragma once

#include "root.h"
#include <JavaScriptCore/ArgList.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/WriteBarrier.h>
#include <wtf/Locker.h>
#include <wtf/Vector.h>

namespace JSC {
class JSWeakMap;
}

namespace Bun {

// Up to this many promises are cheaper to scan than to look up in a map.
inline constexpr unsigned rejectedPromiseScanLimit = 256;

// Zig::GlobalObject::m_aboutToBeNotifiedRejectedPromises. Only the JS thread writes, under owner->cellLock(); the GC thread visits.
class RejectedPromiseQueue {
public:
    void append(JSC::VM&, JSC::JSCell* owner, JSC::JSPromise*, JSC::JSObject* rejectionOwner);
    bool remove(JSC::JSGlobalObject* owner, JSC::JSPromise*);
    // Move every entry out (index-aligned; jsNull() owner for the global object's) and clear.
    void drainTo(JSC::JSCell* owner, JSC::MarkedArgumentBuffer& promises, JSC::MarkedArgumentBuffer& rejectionOwners);
    template<typename Visitor> void visit(JSC::JSCell* owner, Visitor&);
    bool isEmpty() const { return m_entries.isEmpty(); }

private:
    struct Entry {
        JSC::WriteBarrier<JSC::Unknown> promise; // JSPromise
        JSC::WriteBarrier<JSC::Unknown> rejectionOwner; // JSModuleGraph or null
    };
    static constexpr unsigned notFound = UINT_MAX;
    bool isAt(unsigned index, JSC::JSPromise* promise) const { return m_entries[index].promise.get().asCell() == promise; }
    unsigned find(JSC::JSGlobalObject* owner, JSC::JSPromise*);
    void compact();

    // In rejection order. remove() leaves a hole (an empty promise) unless the entry is the last.
    WTF::Vector<Entry> m_entries;
    unsigned m_holes { 0 };
    // The index after the last hole made: where a caller that handles oldest first looks next.
    unsigned m_next { 0 };
    // promise -> index for m_entries[0..m_indexed). find() makes it to search a queue too long to scan.
    JSC::WriteBarrier<JSC::JSWeakMap> m_indices;
    unsigned m_indexed { 0 };
};

// Zig::GlobalObject::m_rejectedPromisesBeingProcessed: one drained batch, reported from `index` on.
struct InFlightRejections {
    JSC::MarkedArgumentBuffer* buffer;
    size_t index;
    InFlightRejections* outer;
    // promise -> position in `buffer`, made by the first tailContains() of a tail too long to scan.
    JSC::JSWeakMap* positions { nullptr };

    bool tailContains(JSC::JSGlobalObject*, JSC::JSPromise*);
};

// Inlined into promiseRejectionTracker, their one caller. The rare paths (find, compact) are not.
ALWAYS_INLINE void RejectedPromiseQueue::append(JSC::VM& vm, JSC::JSCell* owner, JSC::JSPromise* promise, JSC::JSObject* rejectionOwner)
{
    WTF::Locker locker { owner->cellLock() };
    // Full and at least half holes: compact instead of growing, for the same amortized cost.
    if (m_holes && m_entries.size() == m_entries.capacity() && m_holes >= m_entries.size() / 2) [[unlikely]]
        compact();
    m_entries.append({});
    m_entries.last().promise.set(vm, owner, promise);
    m_entries.last().rejectionOwner.set(vm, owner, rejectionOwner ? JSC::JSValue(rejectionOwner) : JSC::jsNull());
}

ALWAYS_INLINE bool RejectedPromiseQueue::remove(JSC::JSGlobalObject* owner, JSC::JSPromise* promise)
{
    unsigned size = m_entries.size();
    if (!size)
        return false;

    // Newest first (await in a try block), then the entry after the last hit (Promise.all attaches oldest first).
    unsigned index = size - 1;
    if (!isAt(index, promise)) {
        index = m_next;
        if (index >= size || !isAt(index, promise)) {
            index = find(owner, promise);
            if (index == notFound)
                return false;
        }
    }

    WTF::Locker locker { owner->cellLock() };
    if (index + 1 < size) {
        m_entries[index].promise.clear();
        m_entries[index].rejectionOwner.clear();
        ++m_holes;
        m_next = index + 1;
        // A queue that is scanned stays at most half holes, so the scan is about as long as the live entries.
        if (m_holes >= 16 && m_holes >= size / 2 && size <= rejectedPromiseScanLimit) [[unlikely]]
            compact();
        return true;
    }
    // The last entry is never a hole, so a reject-then-handle loop reuses one slot.
    m_entries.removeLast();
    while (!m_entries.isEmpty() && !m_entries.last().promise) {
        m_entries.removeLast();
        --m_holes;
    }
    size = m_entries.size();
    m_indexed = std::min(m_indexed, size);
    m_next = std::min(m_next, size);
    return true;
}

} // namespace Bun
