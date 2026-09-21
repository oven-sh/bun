#pragma once

#include "v8.h"

namespace v8 {

class Isolate;

namespace internal {

// identical to v8::Isolate
class Isolate {};

BUN_EXPORT Isolate* IsolateFromNeverReadOnlySpaceObject(uintptr_t obj);

class Internals {
public:
    BUN_EXPORT static v8::Isolate* GetCurrentIsolate();
};

} // namespace internal
} // namespace v8
