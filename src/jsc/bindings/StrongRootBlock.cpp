#include "StrongRootBlock.h"
#include "BunClientData.h"
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
    return WebCore::subspaceForImpl<StrongRootBlock, WebCore::UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForStrongRootBlock, m_subspaceForStrongRootBlock));
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

// Returns a block with at least one free slot. Tries the allocation cursor
// first, walks the active list only when that block is full, reuses the parked
// spare if nothing has room, and allocates only as a last resort. JSC does not
// relocate cells, so the returned pointer is stable while the block is on the
// active list.
//
// The head/free pointers on JSVMClientData are raw (no WriteBarrier): they are
// rooted by a SimpleMarkingConstraint (BunClientData.cpp) that runs on every
// return to Fixpoint, so a freshly-prepended block is always appended before
// marking converges.
StrongRootBlock* StrongRootBlock::acquire(WebCore::JSVMClientData* clientData, JSC::VM& vm, unsigned& outFreeSlot)
{
    if (auto* cursor = clientData->m_strongRootBlockCursor) {
        if (!cursor->isFull()) {
            outFreeSlot = cursor->findFreeSlot();
            return cursor;
        }
    }

    // Blocks emptied by sweep-time deletes stay linked (see Bun__StrongRef__delete); keep one, release the rest here.
    StrongRootBlock* found = nullptr;
    for (auto* b = clientData->m_strongRootBlockHead; b;) {
        auto* next = b->next();
        if (b->isEmpty() && found)
            release(clientData, vm, b);
        else if (!b->isFull() && !found)
            found = b;
        b = next;
    }
    if (found) {
        clientData->m_strongRootBlockCursor = found;
        outFreeSlot = found->findFreeSlot();
        return found;
    }

    StrongRootBlock* block = clientData->m_strongRootBlockFree;
    if (block) {
        clientData->m_strongRootBlockFree = nullptr;
    } else {
        if (!clientData->m_strongRootBlockStructure)
            clientData->m_strongRootBlockStructure = StrongRootBlock::createStructure(vm, nullptr);
        block = StrongRootBlock::create(vm, clientData->m_strongRootBlockStructure);
    }

    block->setNext(vm, clientData->m_strongRootBlockHead);
    clientData->m_strongRootBlockHead = block;
    clientData->m_strongRootBlockCursor = block;
    outFreeSlot = 0;
    return block;
}

// Unlink `block` from the active list and either park it in the free slot (one
// block of slack) or leave it unreachable so GC reclaims it.
void StrongRootBlock::release(WebCore::JSVMClientData* clientData, JSC::VM& vm, StrongRootBlock* block)
{
    if (clientData->m_strongRootBlockCursor == block)
        clientData->m_strongRootBlockCursor = nullptr;
    StrongRootBlock* head = clientData->m_strongRootBlockHead;
    if (head == block) {
        clientData->m_strongRootBlockHead = block->next();
    } else {
        for (auto* prev = head; prev; prev = prev->next()) {
            if (prev->next() == block) {
                prev->setNext(vm, block->next());
                break;
            }
        }
    }
    block->setNext(vm, nullptr);

    if (!clientData->m_strongRootBlockFree)
        clientData->m_strongRootBlockFree = block;
}

} // namespace Bun
