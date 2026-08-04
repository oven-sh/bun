#pragma once

#include "v8.h"
#include "v8_internal.h"

namespace v8 {

class Isolate;
template<typename T>
class Local;
class Value;
class Data;

template<typename T> class WeakCallbackInfo;
enum class WeakCallbackType;

namespace api_internal {

BUN_EXPORT void ToLocalEmpty();
BUN_EXPORT void FromJustIsNothing();
BUN_EXPORT uintptr_t* GlobalizeReference(v8::internal::Isolate* isolate, uintptr_t address);
BUN_EXPORT uintptr_t* CopyGlobalReference(uintptr_t* from);
BUN_EXPORT void MoveGlobalReference(uintptr_t** from, uintptr_t** to);
BUN_EXPORT void DisposeGlobal(uintptr_t* location);
BUN_EXPORT void MakeWeak(uintptr_t* location, void* data, void (*weak_callback)(const WeakCallbackInfo<void>&), WeakCallbackType type);
BUN_EXPORT void MakeWeak(uintptr_t** location_addr);
BUN_EXPORT void* ClearWeak(uintptr_t* location);
BUN_EXPORT void AnnotateStrongRetainer(uintptr_t* location, const char* label);
BUN_EXPORT uintptr_t* Eternalize(Isolate* isolate, Value* handle);
BUN_EXPORT Local<Value> GetFunctionTemplateData(Isolate* isolate, Local<Data> target);

} // namespace api_internal
} // namespace v8
