#include "root.h"
#include "StrongRef.h"
#include "StrongRootBlock.h"
#include "BunClientData.h"

using Bun::StrongRefImpl;
using Bun::StrongRootBlock;

// Hot-path clientData lookup without the `downcast<JSVMClientData>`
// RELEASE_ASSERT virtual call; vm.clientData is unconditionally a
// JSVMClientData* in bun (set in JSVMClientData::create).
static ALWAYS_INLINE WebCore::JSVMClientData* clientDataFast(JSC::VM& vm)
{
    ASSERT(WebCore::clientData(vm));
    return static_cast<WebCore::JSVMClientData*>(vm.clientData);
}

// Handle layout for bun_jsc::Strong. The Rust side treats the return of
// Bun__StrongRef__new as an opaque non-null pointer; there is no heap
// allocation. The low 48 bits point at the WriteBarrier<Unknown> slot inside a
// StrongRootBlock (so Rust can read/clear the value with a direct pointer
// load, matching the old HandleSlot fast path), and the top 16 bits hold the
// slot index so `block` can be recovered as `slot - index*8 - slotsOffset()`.
// JSC cells live in the low 48 bits of the address space (the same invariant
// JSValue NaN-boxing and StructureID encoding rely on), and the slot index is
// bounded by StrongRootBlock::capacity.
static constexpr unsigned kStrongRefIndexShift = 48;
static constexpr uintptr_t kStrongRefSlotMask = (static_cast<uintptr_t>(1) << kStrongRefIndexShift) - 1;
static_assert(sizeof(uintptr_t) == 8, "StrongRef handle encoding requires 64-bit pointers");
static_assert(StrongRootBlock::capacity < (1u << (64 - kStrongRefIndexShift)), "slot index must fit in the top 16 bits");
static_assert(sizeof(StrongRootBlock::Slot) == sizeof(JSC::JSValue), "Rust Impl::get reads the slot as a JSValue");

static ALWAYS_INLINE StrongRefImpl* encodeStrongRef(StrongRootBlock* block, unsigned index)
{
    uintptr_t slot = reinterpret_cast<uintptr_t>(block->slotAt(index));
    ASSERT(!(slot & ~kStrongRefSlotMask));
    return reinterpret_cast<StrongRefImpl*>(slot | (static_cast<uintptr_t>(index) << kStrongRefIndexShift));
}

static ALWAYS_INLINE unsigned decodeStrongRefIndex(StrongRefImpl* ref)
{
    return static_cast<unsigned>(reinterpret_cast<uintptr_t>(ref) >> kStrongRefIndexShift);
}

static ALWAYS_INLINE StrongRootBlock* decodeStrongRefBlock(StrongRefImpl* ref)
{
    uintptr_t slot = reinterpret_cast<uintptr_t>(ref) & kStrongRefSlotMask;
    return reinterpret_cast<StrongRootBlock*>(slot - static_cast<uintptr_t>(decodeStrongRefIndex(ref)) * sizeof(StrongRootBlock::Slot) - StrongRootBlock::slotsOffset());
}

extern "C" StrongRefImpl* Bun__StrongRef__new(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedValue)
{
    auto& vm = JSC::getVM(globalObject);
    unsigned index;
    auto* block = StrongRootBlock::acquire(clientDataFast(vm), vm, index);
    block->set(vm, index, JSC::JSValue::decode(encodedValue));
    return encodeStrongRef(block, index);
}

extern "C" void Bun__StrongRef__set(StrongRefImpl* _Nonnull ref, JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedValue)
{
    decodeStrongRefBlock(ref)->write(JSC::getVM(globalObject), decodeStrongRefIndex(ref), JSC::JSValue::decode(encodedValue));
}

// The Rust caller (Strong.rs Impl::destroy) skips this call once
// VirtualMachine.is_shutting_down is true, so the block cell is guaranteed
// live here: destructOnExit / WebWorker__teardownJSCVM set that flag before
// their final collectNow, which is the only point the block can go dead while
// handles still exist.
extern "C" void Bun__StrongRef__delete(StrongRefImpl* _Nonnull ref)
{
    auto* block = decodeStrongRefBlock(ref);
    auto& vm = block->vm();
    auto* clientData = clientDataFast(vm);
    bool empty = block->clear(decodeStrongRefIndex(ref));
    // Mid-sweep (a JSCell destructor) only the slot may change; acquire() reclaims empties later.
    if (vm.heap.mutatorState() == JSC::MutatorState::Sweeping) [[unlikely]]
        return;
    // This block just freed a slot, so the next acquire() should try it first
    // (covers the FIFO pattern where the oldest-armed block gets room while
    // the cursor sits at a full head).
    clientData->m_strongRootBlockCursor = block;
    if (empty) [[unlikely]]
        StrongRootBlock::release(clientData, vm, block);
}
