#include "root.h"
#include "headers-handwritten.h"
#include "ZigGlobalObject.h"
#include "BunClientData.h"
#include "BunProcess.h"
#include <JavaScriptCore/DeferGCInlines.h>
#include <JavaScriptCore/JSString.h>

// Bun.unsafe.gcDefer() / gcAllow(): bracket a latency-sensitive region
// (e.g. a UI render frame) so an eden GC doesn't fire mid-region. Uses
// DeferGCForAWhile semantics — the matching decrement does NOT trigger
// a collection; the next regular allocation slow path will, so the
// deferred pressure is handled at the first opportunity *outside* the
// bracket.
//
// State lives on JSVMClientData (per-VM), not thread_local: the deferred
// heap belongs to a specific VM, and a Worker's OS thread can outlive its
// VM and be reused for another. thread_local would let a stale guard from
// the dead VM survive into the next one and dtor against a freed Heap.
//
// Heap::increment/decrementDeferralDepth are private; the public RAII
// handle is DeferGCForAWhile, which has WTF_FORBID_HEAP_ALLOCATION (deletes
// class-scope new including placement-new). A ::new-expression bypasses
// class-scope lookup ([expr.new]/12), so we placement-new the guard
// directly into per-VM storage — no heap allocation, no wrapper struct.
// Only one heap-deferral level is held regardless of JS-side nesting; the
// depth counter is purely for balance tracking.

namespace BunGCDefer {

// JSVMClientData::gcDeferStorage is sized/aligned for a single pointer; that
// must match DeferGCForAWhile's layout (one JSC::Heap& member).
static_assert(sizeof(JSC::DeferGCForAWhile) == sizeof(void*));
static_assert(alignof(JSC::DeferGCForAWhile) == alignof(void*));

static void emitWarning(JSC::VM& vm, ASCIILiteral message)
{
    auto* globalObject = defaultGlobalObject();
    if (!globalObject) [[unlikely]]
        return;
    // Process::emitWarning re-enters JS (process.emit / nextTick) and can
    // throw. Swallow it so the host_fn returns the depth without a pending
    // exception — otherwise the Rust wrapper's
    // assert_exception_presence_matches(false) trips in debug, and in
    // release the next JS allocation throws an unrelated error.
    auto scope = DECLARE_THROW_SCOPE(vm);
    Bun::Process::emitWarning(globalObject, JSC::jsString(vm, String(message)), JSC::jsUndefined(), JSC::jsUndefined(), JSC::jsUndefined());
    CLEAR_IF_EXCEPTION(scope);
}

} // namespace BunGCDefer

extern "C" int32_t JSC__VM__gcDeferralIncrement(JSC::VM* vm)
{
    auto* clientData = static_cast<WebCore::JSVMClientData*>(vm->clientData);
    if (clientData->gcDeferDepth++ == 0)
        ::new (static_cast<void*>(clientData->gcDeferStorage)) JSC::DeferGCForAWhile(*vm);
    if (clientData->gcDeferDepth >= 16 && !clientData->gcDeferWarned) [[unlikely]] {
        clientData->gcDeferWarned = true;
        BunGCDefer::emitWarning(*vm, "Bun.unsafe.gcDefer depth reached 16; gcDefer/gcAllow likely unbalanced"_s);
    }
    return static_cast<int32_t>(clientData->gcDeferDepth);
}

extern "C" int32_t JSC__VM__gcDeferralDecrement(JSC::VM* vm)
{
    auto* clientData = static_cast<WebCore::JSVMClientData*>(vm->clientData);
    if (!clientData->gcDeferDepth) [[unlikely]] {
        BunGCDefer::emitWarning(*vm, "Bun.unsafe.gcAllow called with no matching gcDefer"_s);
        return 0;
    }
    if (--clientData->gcDeferDepth == 0)
        std::launder(reinterpret_cast<JSC::DeferGCForAWhile*>(clientData->gcDeferStorage))->~DeferGCForAWhile();
    return static_cast<int32_t>(clientData->gcDeferDepth);
}
