#pragma once

#include "v8.h"

namespace v8 {
namespace internal {

// identical to v8::Isolate
class Isolate {};

BUN_EXPORT Isolate* IsolateFromNeverReadOnlySpaceObject(uintptr_t obj);

} // namespace internal
} // namespace v8
