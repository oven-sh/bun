#include "root.h"
#include "StrongRef.h"
#include "StrongRootBlock.h"

using Bun::StrongRefImpl;
using Bun::StrongRootBlock;

extern "C" void* Bun__getVM();
extern "C" bool Bun__VirtualMachine__isShuttingDown(void*);

// Handle layout for bun_jsc::Strong. The Rust side treats the return of
// Bun__StrongRef__new as an opaque non-null pointer; it is really an encoded
// (StrongRootBlock*, slot index) pair, not a heap allocation. JSC cells live in
// the low 48 bits of the address space (MarkedBlock/PreciseAllocation; the same
// invariant JSValue NaN-boxing and StructureID encoding rely on), and the slot
// index is bounded by StrongRootBlock::capacity, so the index packs into the
// top 16 bits.
static constexpr unsigned kStrongRefIndexShift = 48;
static constexpr uintptr_t kStrongRefBlockMask = (static_cast<uintptr_t>(1) << kStrongRefIndexShift) - 1;
static_assert(sizeof(uintptr_t) == 8, "StrongRef handle encoding requires 64-bit pointers");
static_assert(StrongRootBlock::capacity < (1u << (64 - kStrongRefIndexShift)), "slot index must fit in the top 16 bits");

static ALWAYS_INLINE StrongRefImpl* encodeStrongRef(StrongRootBlock* block, unsigned index)
{
    uintptr_t raw = reinterpret_cast<uintptr_t>(block);
    ASSERT(!(raw & ~kStrongRefBlockMask));
    return reinterpret_cast<StrongRefImpl*>(raw | (static_cast<uintptr_t>(index) << kStrongRefIndexShift));
}

static ALWAYS_INLINE StrongRootBlock* decodeStrongRefBlock(StrongRefImpl* ref)
{
    return reinterpret_cast<StrongRootBlock*>(reinterpret_cast<uintptr_t>(ref) & kStrongRefBlockMask);
}

static ALWAYS_INLINE unsigned decodeStrongRefIndex(StrongRefImpl* ref)
{
    return static_cast<unsigned>(reinterpret_cast<uintptr_t>(ref) >> kStrongRefIndexShift);
}

extern "C" StrongRefImpl* Bun__StrongRef__new(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedValue)
{
    unsigned index;
    auto* block = StrongRootBlock::acquire(JSC::getVM(globalObject), index);
    block->set(index, JSC::JSValue::decode(encodedValue));
    return encodeStrongRef(block, index);
}

extern "C" JSC::EncodedJSValue Bun__StrongRef__get(StrongRefImpl* _Nonnull ref)
{
    return JSC::JSValue::encode(decodeStrongRefBlock(ref)->read(decodeStrongRefIndex(ref)));
}

extern "C" void Bun__StrongRef__set(StrongRefImpl* _Nonnull ref, JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedValue)
{
    UNUSED_PARAM(globalObject);
    decodeStrongRefBlock(ref)->write(decodeStrongRefIndex(ref), JSC::JSValue::decode(encodedValue));
}

extern "C" void Bun__StrongRef__clear(StrongRefImpl* _Nonnull ref)
{
    decodeStrongRefBlock(ref)->clearValue(decodeStrongRefIndex(ref));
}

extern "C" void Bun__StrongRef__delete(StrongRefImpl* _Nonnull ref)
{
    // destructOnExit / WebWorker__teardownJSCVM unprotect the global and run a
    // final full GC whose sweep-time finalizers (and later deinit_runtime_state
    // after ~VM) can drop Rust bun_jsc::Strong handles; past that point the
    // block cell may be unmarked or the heap freed. VirtualMachine.is_shutting_down
    // is set before either path reaches the final collection, and the handle is
    // not a heap allocation, so a no-op here is the whole of teardown.
    if (Bun__VirtualMachine__isShuttingDown(Bun__getVM())) [[unlikely]]
        return;
    auto* block = decodeStrongRefBlock(ref);
    if (block->clear(decodeStrongRefIndex(ref)))
        StrongRootBlock::release(block->vm(), block);
}
