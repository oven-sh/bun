#pragma once

#include "v8.h"
#include "v8_internal.h"

namespace v8 {
namespace api_internal {

BUN_EXPORT void ToLocalEmpty();
BUN_EXPORT uintptr_t* GlobalizeReference(v8::internal::Isolate* isolate, uintptr_t address);
BUN_EXPORT void DisposeGlobal(uintptr_t* location);

}
}
