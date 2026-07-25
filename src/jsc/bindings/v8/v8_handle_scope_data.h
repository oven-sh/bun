#pragma once

// Access to the v8::internal::HandleScopeData that V8 14's inline HandleScope code
// (v8-local-handle.h) reads and writes directly at a fixed offset inside the Isolate
// (internal::Internals::GetHandleScopeData). That offset lands inside our Isolate's padding,
// which the Isolate constructor zeroes (matching real V8's HandleScopeData::Initialize()).
//
// The same warning as in real_v8.h applies: only include this in source files in the v8
// directory, never in headers.

#include "real_v8.h"
#include "V8Isolate.h"

#include <type_traits>

namespace v8 {
namespace shim {

// Use the real V8 struct directly so the layout cannot drift:
// { Address* next; Address* limit; int level; int sealed_level; } where Address is uintptr_t.
using HandleScopeData = real_v8::internal::HandleScopeData;

static_assert(std::is_same_v<real_v8::internal::Address, uintptr_t>,
    "V8's Address type is expected to be uintptr_t");
static_assert(real_v8::internal::Internals::kIsolateHandleScopeDataOffset
        >= offsetof(::v8::Isolate, m_padding),
    "HandleScopeData would overlap the Isolate's leading fields");
static_assert(real_v8::internal::Internals::kIsolateHandleScopeDataOffset + sizeof(HandleScopeData)
        <= offsetof(::v8::Isolate, m_roots),
    "HandleScopeData does not fit inside the Isolate's padding");

inline HandleScopeData* getHandleScopeData(Isolate* isolate)
{
    return reinterpret_cast<HandleScopeData*>(
        reinterpret_cast<char*>(isolate) + real_v8::internal::Internals::kIsolateHandleScopeDataOffset);
}

} // namespace shim
} // namespace v8
