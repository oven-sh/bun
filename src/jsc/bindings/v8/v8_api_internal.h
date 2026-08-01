#pragma once

#include "v8.h"
#include "v8_internal.h"

namespace v8 {

class Isolate;
template<typename T>
class Local;
class Value;
class Data;

namespace api_internal {

BUN_EXPORT void ToLocalEmpty();
BUN_EXPORT void FromJustIsNothing();
BUN_EXPORT uintptr_t* GlobalizeReference(v8::internal::Isolate* isolate, uintptr_t address);
BUN_EXPORT void DisposeGlobal(uintptr_t* location);
BUN_EXPORT Local<Value> GetFunctionTemplateData(Isolate* isolate, Local<Data> target);

} // namespace api_internal
} // namespace v8
