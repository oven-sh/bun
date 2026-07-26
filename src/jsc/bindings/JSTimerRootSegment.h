#pragma once

#include "BunClientData.h"
#include "root.h"
#include <wtf/BitSet.h>

namespace Bun {

// One fixed-size page of GC roots for armed setTimeout/setInterval/setImmediate
// wrappers. The per-VM timer heap roots each armed wrapper via a slot in one of
// these segments instead of allocating a HandleSet strong handle per timer, so
// the "Sh" strong-handle marking constraint does not become O(N armed timers)
// on every eden collection. A barriered slot store dirties only the owning
// segment; segments that have not been touched since the last full GC remain
// old-gen-marked and are skipped on eden.
//
// Active segments form a singly-linked list via m_next whose head lives in
// ZigGlobalObject::m_timerRootSegmentHead. One spare empty segment is kept in
// ZigGlobalObject::m_timerRootSegmentFree; further empties are unlinked and
// reclaimed by GC.
class JSTimerRootSegment final : public JSC::JSCell {
public:
    using Base = JSC::JSCell;

    static constexpr unsigned capacity = 4096;

    static JSTimerRootSegment* create(JSC::VM& vm, JSC::Structure* structure);

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        return JSC::Structure::create(vm, globalObject, JSC::jsNull(), JSC::TypeInfo(JSC::CellType, StructureFlags), info(), 0, 0);
    }

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<JSTimerRootSegment, WebCore::UseCustomHeapCellType::Yes>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForJSTimerRootSegment.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSTimerRootSegment = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForJSTimerRootSegment.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForJSTimerRootSegment = std::forward<decltype(space)>(space); },
            [](auto& server) -> JSC::HeapCellType& { return server.m_heapCellTypeForJSTimerRootSegment; });
    }

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    static constexpr JSC::DestructionMode needsDestruction = JSC::DestructionMode::NeedsDestruction;
    static void destroy(JSC::JSCell* cell)
    {
        static_cast<JSTimerRootSegment*>(cell)->~JSTimerRootSegment();
    }
    ~JSTimerRootSegment() = default;

    unsigned set(unsigned index, JSC::JSValue value)
    {
        ASSERT(index < capacity);
        ASSERT(!m_occupied.get(index));
        m_slots[index].set(vm(), this, value);
        m_occupied.set(index);
        return ++m_occupiedCount;
    }

    unsigned clear(unsigned index)
    {
        ASSERT(index < capacity);
        ASSERT(m_occupied.get(index));
        m_slots[index].clear();
        m_occupied.clear(index);
        return --m_occupiedCount;
    }

    // Returns the lowest free slot index, or `capacity` if full.
    unsigned findFreeSlot() const
    {
        if (m_occupiedCount == capacity)
            return capacity;
        return static_cast<unsigned>(m_occupied.findBit(0, false));
    }

    JSTimerRootSegment* next() const { return m_next.get(); }
    void setNext(JSC::VM& vm, JSTimerRootSegment* next) { m_next.setMayBeNull(vm, this, next); }

private:
    using Slot = JSC::WriteBarrier<JSC::Unknown>;

    JSC::WriteBarrier<JSTimerRootSegment> m_next;
    // Fixed-size, never resized: set()/clear() and visitChildren may run
    // concurrently on JS and GC threads without a cellLock.
    WTF::Vector<Slot> m_slots;
    WTF::BitSet<capacity> m_occupied;
    unsigned m_occupiedCount { 0 };

    JSTimerRootSegment(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM& vm)
    {
        Base::finishCreation(vm);
        m_slots.grow(capacity);
    }
};

} // namespace Bun
