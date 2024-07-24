#pragma once

#include "v8.h"

namespace v8 {
namespace internal {

class Isolate {};

BUN_EXPORT Isolate* IsolateFromNeverReadOnlySpaceObject(uintptr_t obj);

}
}
