#include "root.h"
#include "StrongRef.h"
#include "StrongRootBlock.h"
#include "BunClientData.h"
#include "ZigGlobalObject.h"

namespace Bun {

// Backing store for bun_jsc::Strong. One instance per live Strong handle on the
// Rust side; the Rust `Impl*` is a pointer to this. Each instance owns one
// occupied slot in a StrongRootBlock on the per-VM main global.
struct StrongRefImpl {
    WTF_DEPRECATED_MAKE_STRUCT_FAST_ALLOCATED(StrongRefImpl);

    StrongRootBlock* block;
    uint32_t index;
};

} // namespace Bun

using Bun::StrongRefImpl;
using Bun::StrongRootBlock;

extern "C" StrongRefImpl* Bun__StrongRef__new(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedValue)
{
    // Always hang the slot off the per-thread main global so a ShadowRealm or
    // node:vm caller does not create a per-realm block list.
    UNUSED_PARAM(globalObject);
    auto* zigGlobal = defaultGlobalObject();
    auto* block = StrongRootBlock::acquire(zigGlobal);
    unsigned index = block->findFreeSlot();
    block->set(index, JSC::JSValue::decode(encodedValue));
    return new StrongRefImpl { block, index };
}

extern "C" JSC::EncodedJSValue Bun__StrongRef__get(StrongRefImpl* _Nonnull ref)
{
    return JSC::JSValue::encode(ref->block->read(ref->index));
}

extern "C" void Bun__StrongRef__set(StrongRefImpl* _Nonnull ref, JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedValue)
{
    UNUSED_PARAM(globalObject);
    ref->block->write(ref->index, JSC::JSValue::decode(encodedValue));
}

extern "C" void Bun__StrongRef__clear(StrongRefImpl* _Nonnull ref)
{
    ref->block->clearValue(ref->index);
}

extern "C" void Bun__StrongRef__delete(StrongRefImpl* _Nonnull ref)
{
    if (ref->block->clear(ref->index))
        StrongRootBlock::release(defaultGlobalObject(), ref->block);
    delete ref;
}

// Called from swap_global_for_test_isolation so Strong handles outlive a
// per-file global swap the same way HandleSet-backed handles did.
extern "C" void Bun__StrongRef__transferBlocks(Zig::GlobalObject* from, Zig::GlobalObject* to)
{
    auto& vm = JSC::getVM(to);
    ASSERT(!to->m_strongRootBlockHead.get());
    ASSERT(!to->m_strongRootBlockFree.get());
    to->m_strongRootBlockHead.setMayBeNull(vm, to, from->m_strongRootBlockHead.get());
    to->m_strongRootBlockFree.setMayBeNull(vm, to, from->m_strongRootBlockFree.get());
    from->m_strongRootBlockHead.clear();
    from->m_strongRootBlockFree.clear();
}
