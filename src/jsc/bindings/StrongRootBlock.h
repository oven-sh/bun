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
// Active blocks form a singly-linked list via m_next whose head is rooted by
// JSVMClientData::m_strongRootBlockHead. One spare empty block is kept in
// JSVMClientData::m_strongRootBlockFree; further empties are unlinked and
// reclaimed by GC.
class StrongRootBlock final : public JSC::JSCell {
public:
    using Base = JSC::JSCell;

    // Sized so the cell fits under MarkedSpace::largeCutoff (half a 16 KB
    // MarkedBlock payload) and the IsoSubspace can allocate it from a block.
    static constexpr unsigned capacity = 960;

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

    bool clear(unsigned index)
    {
        ASSERT(index < capacity);
        ASSERT(m_occupied.get(index));
        m_slots[index].clear();
        m_occupied.clear(index);
        return !--m_occupiedCount;
    }

    bool isFull() const { return m_occupiedCount == capacity; }
    bool isEmpty() const { return !m_occupiedCount; }

    // Returns the lowest free slot index, or `capacity` if full.
    unsigned findFreeSlot() const
    {
        return static_cast<unsigned>(m_occupied.findBit(0, false));
    }

    StrongRootBlock* next() const { return m_next.get(); }

    // Not setMayBeNull(): its GC validation reads next->classInfo(), which JSC forbids during the sweep that finalizers release Strongs from.
    void setNext(JSC::VM& vm, StrongRootBlock* next)
    {
        m_next.setWithoutWriteBarrier(next);
        vm.writeBarrier(this, next);
    }

    static StrongRootBlock* acquire(WebCore::JSVMClientData* clientData, JSC::VM& vm, unsigned& outFreeSlot);
    static void release(WebCore::JSVMClientData* clientData, JSC::VM& vm, StrongRootBlock* block);

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
    JSC::WriteBarrier<StrongRootBlock> m_next;
    unsigned m_occupiedCount { 0 };
    WTF::BitSet<capacity> m_occupied;
    std::array<Slot, capacity> m_slots {};

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
