#include "StrongRootBlock.h"
#include "BunClientData.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/MarkedSpace.h>

namespace Bun {

static_assert(sizeof(StrongRootBlock) <= JSC::MarkedSpace::largeCutoff,
    "StrongRootBlock must fit in a MarkedBlock; lower capacity if this fires");

// for CREATE_METHOD_TABLE
namespace JSCastingHelpers = JSC::JSCastingHelpers;

const JSC::ClassInfo StrongRootBlock::s_info = {
    "StrongRootBlock"_s,
    nullptr,
    nullptr,
    nullptr,
    CREATE_METHOD_TABLE(StrongRootBlock)
};

JSC::GCClient::IsoSubspace* StrongRootBlock::subspaceForImpl(JSC::VM& vm)
{
    return WebCore::subspaceForImpl<StrongRootBlock, WebCore::UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForStrongRootBlock.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForStrongRootBlock = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForStrongRootBlock.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForStrongRootBlock = std::forward<decltype(space)>(space); });
}

StrongRootBlock* StrongRootBlock::create(JSC::VM& vm, JSC::Structure* structure)
{
    StrongRootBlock* block = new (NotNull, JSC::allocateCell<StrongRootBlock>(vm))
        StrongRootBlock(vm, structure);
    block->finishCreation(vm);
    return block;
}

template<typename Visitor>
void StrongRootBlock::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    StrongRootBlock* thisObject = uncheckedDowncast<StrongRootBlock>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);

    visitor.append(thisObject->m_next);
    visitor.append(thisObject->m_slots.begin(), thisObject->m_slots.end());
}

DEFINE_VISIT_CHILDREN(StrongRootBlock);

// Returns a block with at least one free slot. Walks the active list from the
// head, reuses the parked spare if nothing has room, and allocates only as a
// last resort. JSC does not relocate cells, so the returned pointer is stable
// while the block is on the active list.
StrongRootBlock* StrongRootBlock::acquire(Zig::GlobalObject* zigGlobal)
{
    auto& vm = JSC::getVM(zigGlobal);

    for (auto* b = zigGlobal->m_strongRootBlockHead.get(); b; b = b->next()) {
        if (b->findFreeSlot() < capacity)
            return b;
    }

    StrongRootBlock* block = zigGlobal->m_strongRootBlockFree.get();
    if (block)
        zigGlobal->m_strongRootBlockFree.clear();
    else
        block = StrongRootBlock::create(vm, zigGlobal->StrongRootBlockStructure());

    block->setNext(vm, zigGlobal->m_strongRootBlockHead.get());
    zigGlobal->m_strongRootBlockHead.set(vm, zigGlobal, block);
    return block;
}

// Unlink `block` from the active list and either park it in the free slot (one
// block of slack) or leave it unreachable so GC reclaims it.
void StrongRootBlock::release(Zig::GlobalObject* zigGlobal, StrongRootBlock* block)
{
    auto& vm = JSC::getVM(zigGlobal);
    StrongRootBlock* head = zigGlobal->m_strongRootBlockHead.get();
    if (head == block) {
        zigGlobal->m_strongRootBlockHead.setMayBeNull(vm, zigGlobal, block->next());
    } else {
        for (auto* prev = head; prev; prev = prev->next()) {
            if (prev->next() == block) {
                prev->setNext(vm, block->next());
                break;
            }
        }
    }
    block->setNext(vm, nullptr);

    if (!zigGlobal->m_strongRootBlockFree.get())
        zigGlobal->m_strongRootBlockFree.set(vm, zigGlobal, block);
}

} // namespace Bun
