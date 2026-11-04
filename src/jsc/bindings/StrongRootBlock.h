#pragma once

#include "root.h"
#include <wtf/BitSet.h>
#include <array>

namespace WebCore {
class JSVMClientData;
}

namespace Bun {

// One fixed-size page of strong GC roots backing bun_jsc::Strong. Each live
// StrongRef (see StrongRef.cpp) occupies one WriteBarrier slot in one of these
// cells instead of a HandleSet strong handle, so the "Sh" strong-handle
// marking constraint does not become O(N Strongs) on every eden collection. A
// barriered slot store dirties only the owning block; blocks untouched since
// the last full GC stay old-gen-marked and are skipped on eden.
//
// Active blocks form a list via m_next whose head is rooted by
// JSVMClientData::m_strongRootBlockHead. One empty block is kept: the cursor,
// or else a spare in JSVMClientData::m_strongRootBlockFree. Further empties
// are unlinked and reclaimed by GC.
//
// Which block takes the next handle is the policy of JSC::StrongSet, so that
// no create and no delete walks the list. New handles go to one block, the
// cursor. When it fills it is retired: it takes no handle until
// reAdmissionWatermark of its slots are free. Then it joins the available
// list, which is where the next cursor comes from. Only m_next is a GC edge.
// The other links are raw, belong to the mutator, and mean something only
// while the block is on the active list.
class StrongRootBlock final : public JSC::JSCell {
public:
    using Base = JSC::JSCell;

    // Sized so the cell fits under MarkedSpace::largeCutoff (half a 16 KB
    // MarkedBlock payload) and the IsoSubspace can allocate it from a block.
    static constexpr unsigned capacity = 960;

    // At 1, a full block that loses a slot and gets it back changes lists on
    // each such pair. The price of more: up to reAdmissionWatermark - 1 free
    // slots of a retired block wait unused.
    static constexpr unsigned reAdmissionWatermark = 3;
    static constexpr unsigned retiredNotifyThreshold = capacity - reAdmissionWatermark;
    static_assert(reAdmissionWatermark && reAdmissionWatermark < capacity);

    static StrongRootBlock* create(JSC::VM& vm, JSC::Structure* structure);

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        return JSC::Structure::create(vm, globalObject, JSC::jsNull(), JSC::TypeInfo(JSC::CellType, StructureFlags), info(), 0, 0);
    }

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }
    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM& vm);

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    void set(JSC::VM& vm, unsigned index, JSC::JSValue value)
    {
        ASSERT(index < capacity);
        ASSERT(!m_occupied.get(index));
        m_slots[index].set(vm, this, value);
        m_occupied.set(index);
        ++m_occupiedCount;
    }

    // Overwrite an already-occupied slot (Bun__StrongRef__set).
    void write(JSC::VM& vm, unsigned index, JSC::JSValue value)
    {
        ASSERT(index < capacity);
        ASSERT(m_occupied.get(index));
        m_slots[index].set(vm, this, value);
    }

    // Returns the occupied count after the clear.
    unsigned clear(unsigned index)
    {
        ASSERT(index < capacity);
        ASSERT(m_occupied.get(index));
        m_slots[index].clear();
        m_occupied.clear(index);
        return --m_occupiedCount;
    }

    bool isFull() const { return m_occupiedCount == capacity; }
    bool isEmpty() const { return !m_occupiedCount; }

    // Returns the lowest free slot index, or `capacity` if full.
    unsigned findFreeSlot() const
    {
        return static_cast<unsigned>(m_occupied.findBit(0, false));
    }

    StrongRootBlock* next() const { return m_next.get(); }

    static StrongRootBlock* acquire(JSC::VM& vm, unsigned& outFreeSlot);

    // A clear() that leaves the occupied count at or below this must call didFreeSlot().
    unsigned freeNotifyThreshold() const { return m_freeNotifyThreshold; }
    static void didFreeSlot(StrongRootBlock* block, unsigned occupiedCount);

    template<typename Functor>
    void forEachOccupiedCell(const Functor& func) const
    {
        m_occupied.forEachSetBit([&](size_t i) {
            JSC::JSValue v = m_slots[i].get();
            if (v && v.isCell())
                func(v.asCell());
        });
    }

    using Slot = JSC::WriteBarrier<JSC::Unknown>;

    ALWAYS_INLINE Slot* slotAt(unsigned index) { return &m_slots[index]; }
    static constexpr ptrdiff_t slotsOffset() { return OBJECT_OFFSETOF(StrongRootBlock, m_slots); }

private:
    static StrongRootBlock* acquireSlow(WebCore::JSVMClientData* clientData, JSC::VM& vm, unsigned& outFreeSlot);
    static StrongRootBlock* acquireWithoutAvailable(WebCore::JSVMClientData* clientData, JSC::VM& vm, unsigned& outFreeSlot);
    static StrongRootBlock* makeCursor(WebCore::JSVMClientData* clientData, StrongRootBlock* block, unsigned& outFreeSlot);
    static void appendAvailable(WebCore::JSVMClientData* clientData, StrongRootBlock* block);
    static StrongRootBlock* takeAvailable(WebCore::JSVMClientData* clientData);
    static void removeAvailable(WebCore::JSVMClientData* clientData, StrongRootBlock* block);
    static void unlink(WebCore::JSVMClientData* clientData, JSC::VM& vm, StrongRootBlock* block);
    static void drainSweepPending(WebCore::JSVMClientData* clientData, JSC::VM& vm, StrongRootBlock* skip);
    static void didFreeSlotSlow(WebCore::JSVMClientData* clientData, JSC::VM& vm, StrongRootBlock* block, unsigned occupiedCount);

    void setNext(JSC::VM& vm, StrongRootBlock* next) { m_next.setMayBeNull(vm, this, next); }

    JSC::WriteBarrier<StrongRootBlock> m_next;
    unsigned m_occupiedCount { 0 };
    // 0 (the cursor, a block on the available list): only an empty block reports.
    // retiredNotifyThreshold (a retired block): it reports when it can take handles again.
    unsigned m_freeNotifyThreshold { 0 };
    WTF::BitSet<capacity> m_occupied;
    std::array<Slot, capacity> m_slots {};

    // After the slots: what follows is read only when a block changes lists.
    StrongRootBlock* m_prev { nullptr };
    // Valid while m_isAvailable, but m_availablePrev not for the head of the available list.
    StrongRootBlock* m_availablePrev { nullptr };
    StrongRootBlock* m_availableNext { nullptr };
    // Valid while m_isSweepPending.
    StrongRootBlock* m_sweepPendingNext { nullptr };
    bool m_isAvailable { false };
    bool m_isSweepPending { false };

    StrongRootBlock(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM& vm)
    {
        Base::finishCreation(vm);
    }
};

} // namespace Bun
