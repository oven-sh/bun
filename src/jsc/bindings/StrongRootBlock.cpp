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

// Hot-path clientData lookup without the `downcast<JSVMClientData>`
// RELEASE_ASSERT virtual call; vm.clientData is unconditionally a
// JSVMClientData* in bun (set in JSVMClientData::create).
static ALWAYS_INLINE WebCore::JSVMClientData* clientDataFast(JSC::VM& vm)
{
    ASSERT(WebCore::clientData(vm));
    return static_cast<WebCore::JSVMClientData*>(vm.clientData);
}

// Returns a block with at least one free slot: the cursor, or else the block
// acquireSlow() makes the cursor. JSC does not relocate cells, so the returned
// pointer is stable while the block is on the active list.
//
// The head/free pointers on JSVMClientData are raw (no WriteBarrier): they are
// rooted by a SimpleMarkingConstraint (BunClientData.cpp) that runs on every
// return to Fixpoint, so a freshly-prepended block is always appended before
// marking converges.
StrongRootBlock* StrongRootBlock::acquire(JSC::VM& vm, unsigned& outFreeSlot)
{
    auto* clientData = clientDataFast(vm);
    if (auto* cursor = clientData->m_strongRootBlockCursor) {
        if (!cursor->isFull()) {
            outFreeSlot = cursor->findFreeSlot();
            return cursor;
        }
    }
    return acquireSlow(clientData, vm, outFreeSlot);
}

ALWAYS_INLINE void StrongRootBlock::appendAvailable(WebCore::JSVMClientData* clientData, StrongRootBlock* block)
{
    ASSERT(!block->m_isAvailable);
    ASSERT(!block->isFull());
    ASSERT(block != clientData->m_strongRootBlockCursor);
    auto* tail = clientData->m_strongRootBlockAvailableTail;
    block->m_freeNotifyThreshold = 0;
    block->m_isAvailable = true;
    block->m_availablePrev = tail;
    block->m_availableNext = nullptr;
    if (tail)
        tail->m_availableNext = block;
    else
        clientData->m_strongRootBlockAvailableHead = block;
    clientData->m_strongRootBlockAvailableTail = block;
}

ALWAYS_INLINE StrongRootBlock* StrongRootBlock::takeAvailable(WebCore::JSVMClientData* clientData)
{
    auto* block = clientData->m_strongRootBlockAvailableHead;
    if (!block)
        return nullptr;
    ASSERT(block->m_isAvailable);
    auto* next = block->m_availableNext;
    // The m_availablePrev of the new head is left as it is. To clear it would load that block only for this store.
    clientData->m_strongRootBlockAvailableHead = next;
    if (!next)
        clientData->m_strongRootBlockAvailableTail = nullptr;
    block->m_isAvailable = false;
    return block;
}

void StrongRootBlock::removeAvailable(WebCore::JSVMClientData* clientData, StrongRootBlock* block)
{
    ASSERT(block->m_isAvailable);
    auto* prev = clientData->m_strongRootBlockAvailableHead == block ? nullptr : block->m_availablePrev;
    auto* next = block->m_availableNext;
    ASSERT(!prev || prev->m_availableNext == block);
    ASSERT(next ? next->m_isAvailable : clientData->m_strongRootBlockAvailableTail == block);
    if (prev)
        prev->m_availableNext = next;
    else
        clientData->m_strongRootBlockAvailableHead = next;
    if (next)
        next->m_availablePrev = prev;
    else
        clientData->m_strongRootBlockAvailableTail = prev;
    block->m_isAvailable = false;
}

// `block` takes the new handles from here on. The block that did so until now
// is retired. If it already has reAdmissionWatermark free slots, it goes on
// the available list at once (only a collection inside create() leaves it so).
ALWAYS_INLINE StrongRootBlock* StrongRootBlock::makeCursor(WebCore::JSVMClientData* clientData, StrongRootBlock* block, unsigned& outFreeSlot)
{
    ASSERT(!block->m_isAvailable && !block->m_freeNotifyThreshold);
    if (auto* previous = std::exchange(clientData->m_strongRootBlockCursor, block)) {
        ASSERT(!previous->m_isAvailable && !previous->m_freeNotifyThreshold);
        if (previous->m_occupiedCount > retiredNotifyThreshold)
            previous->m_freeNotifyThreshold = retiredNotifyThreshold;
        else
            appendAvailable(clientData, previous);
    }
    outFreeSlot = block->findFreeSlot();
    return block;
}

// The cursor is full, or there is none: the oldest block on the available list is the next one.
NEVER_INLINE StrongRootBlock* StrongRootBlock::acquireSlow(WebCore::JSVMClientData* clientData, JSC::VM& vm, unsigned& outFreeSlot)
{
    if (auto* block = takeAvailable(clientData)) [[likely]]
        return makeCursor(clientData, block, outFreeSlot);
    return acquireWithoutAvailable(clientData, vm, outFreeSlot);
}

// The available list is empty: the parked spare is next, else a new block.
NEVER_INLINE StrongRootBlock* StrongRootBlock::acquireWithoutAvailable(WebCore::JSVMClientData* clientData, JSC::VM& vm, unsigned& outFreeSlot)
{
    // A block that reported mid-sweep can have room. Not when a finalizer creates this handle: the drain
    // unlinks blocks, which it must not do mid-sweep (see didFreeSlotSlow).
    if (clientData->m_strongRootBlockSweepPending && vm.heap.mutatorState() != JSC::MutatorState::Sweeping) {
        drainSweepPending(clientData, vm, nullptr);
        if (auto* block = takeAvailable(clientData))
            return makeCursor(clientData, block, outFreeSlot);
    }

    StrongRootBlock* block = clientData->m_strongRootBlockFree;
    if (block) {
        clientData->m_strongRootBlockFree = nullptr;
    } else {
        if (!clientData->m_strongRootBlockStructure)
            clientData->m_strongRootBlockStructure = StrongRootBlock::createStructure(vm, nullptr);
        // This allocation can run a collection, and its finalizers delete handles. So the list head
        // is read after it, and the old cursor stays the cursor until makeCursor().
        block = StrongRootBlock::create(vm, clientData->m_strongRootBlockStructure);
    }
    auto* head = clientData->m_strongRootBlockHead;
    ASSERT(block != head && !block->m_prev && !block->next());
    ASSERT(!head || !head->m_prev);
    block->setNext(vm, head);
    if (head)
        head->m_prev = block;
    clientData->m_strongRootBlockHead = block;
    return makeCursor(clientData, block, outFreeSlot);
}

// Takes the empty `block` off the active list. One empty block is kept as
// slack: the cursor if it is empty, else the block parked in the free slot.
// So `block` is parked if there is neither, and else left unreachable so GC
// reclaims it.
void StrongRootBlock::unlink(WebCore::JSVMClientData* clientData, JSC::VM& vm, StrongRootBlock* block)
{
    ASSERT(block->isEmpty());
    ASSERT(!block->m_isAvailable && !block->m_isSweepPending);
    ASSERT(block != clientData->m_strongRootBlockCursor);
    auto* prev = block->m_prev;
    auto* next = block->next();
    ASSERT(prev ? prev->next() == block : clientData->m_strongRootBlockHead == block);
    ASSERT(!next || next->m_prev == block);
    if (prev)
        prev->setNext(vm, next);
    else
        clientData->m_strongRootBlockHead = next;
    if (next)
        next->m_prev = prev;
    block->m_prev = nullptr;
    block->setNext(vm, nullptr);
    block->m_freeNotifyThreshold = 0;

    auto* cursor = clientData->m_strongRootBlockCursor;
    if (!clientData->m_strongRootBlockFree && !(cursor && cursor->isEmpty()))
        clientData->m_strongRootBlockFree = block;
}

// Does for each block that reported mid-sweep what didFreeSlotSlow() could not
// do then. `skip` is the block whose report the caller handles itself.
NEVER_INLINE void StrongRootBlock::drainSweepPending(WebCore::JSVMClientData* clientData, JSC::VM& vm, StrongRootBlock* skip)
{
    auto* next = std::exchange(clientData->m_strongRootBlockSweepPending, nullptr);
    while (auto* block = next) {
        ASSERT(block->m_isSweepPending);
        next = block->m_sweepPendingNext;
        block->m_isSweepPending = false;
        if (block == skip)
            continue;
        if (block == clientData->m_strongRootBlockCursor) {
            if (block->isEmpty())
                clientData->m_strongRootBlockFree = nullptr;
            continue;
        }
        if (block->isEmpty()) {
            if (block->m_isAvailable)
                removeAvailable(clientData, block);
            unlink(clientData, vm, block);
        } else if (block->m_freeNotifyThreshold && block->m_occupiedCount <= block->m_freeNotifyThreshold)
            appendAvailable(clientData, block);
    }
}

// A delete left a retired `block` with reAdmissionWatermark free slots (occupiedCount is not 0), or left
// `block` empty. The first case is the frequent one and calls nothing.
NEVER_INLINE void StrongRootBlock::didFreeSlot(StrongRootBlock* block, unsigned occupiedCount)
{
    auto& vm = block->vm();
    auto* clientData = clientDataFast(vm);
    if (occupiedCount && !clientData->m_strongRootBlockSweepPending && vm.heap.mutatorState() != JSC::MutatorState::Sweeping) [[likely]] {
        ASSERT(block->m_freeNotifyThreshold == retiredNotifyThreshold);
        appendAvailable(clientData, block);
        return;
    }
    didFreeSlotSlow(clientData, vm, block, occupiedCount);
}

NEVER_INLINE void StrongRootBlock::didFreeSlotSlow(WebCore::JSVMClientData* clientData, JSC::VM& vm, StrongRootBlock* block, unsigned occupiedCount)
{
    // Mid-sweep (a JSCell destructor) a barriered m_next store asserts, and no other cell is to be written.
    // So the block only records itself, and drainSweepPending() does the rest outside the sweep.
    if (vm.heap.mutatorState() == JSC::MutatorState::Sweeping) {
        if (!block->m_isSweepPending) {
            block->m_isSweepPending = true;
            block->m_sweepPendingNext = clientData->m_strongRootBlockSweepPending;
            clientData->m_strongRootBlockSweepPending = block;
        }
        return;
    }
    // First, so that no block is unlinked while the stack still points at it.
    if (clientData->m_strongRootBlockSweepPending)
        drainSweepPending(clientData, vm, block);

    if (occupiedCount) {
        ASSERT(block->m_freeNotifyThreshold == retiredNotifyThreshold);
        appendAvailable(clientData, block);
        return;
    }
    if (block == clientData->m_strongRootBlockCursor) {
        // With no block to take its place the cursor stays: a create and a delete in turn would
        // unlink it and link it again each time. It is then the one empty block that is kept.
        if (!clientData->m_strongRootBlockAvailableHead) {
            clientData->m_strongRootBlockFree = nullptr;
            return;
        }
        clientData->m_strongRootBlockCursor = nullptr;
    } else if (block->m_isAvailable)
        removeAvailable(clientData, block);
    unlink(clientData, vm, block);
}

} // namespace Bun
