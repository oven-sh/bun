#pragma once
#include <JavaScriptCore/JSCJSValue.h>

namespace Bun {
// One occupied slot in a StrongRootBlock; see StrongRef.cpp.
struct StrongRefImpl;

// Handle layout (see StrongRef.cpp): the low 48 bits address the slot, the top 16 hold the slot's index in its block.
static constexpr unsigned kStrongRefIndexShift = 48;
static constexpr uintptr_t kStrongRefSlotMask = (static_cast<uintptr_t>(1) << kStrongRefIndexShift) - 1;

// The value `ref` keeps alive.
ALWAYS_INLINE JSC::JSValue strongRefGet(const StrongRefImpl* _Nonnull ref)
{
    return *reinterpret_cast<const JSC::JSValue*>(reinterpret_cast<uintptr_t>(ref) & kStrongRefSlotMask);
}
}

extern "C" void Bun__StrongRef__delete(Bun::StrongRefImpl* _Nonnull ref);
extern "C" Bun::StrongRefImpl* Bun__StrongRef__new(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedValue);
extern "C" void Bun__StrongRef__set(Bun::StrongRefImpl* _Nonnull ref, JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedValue);
