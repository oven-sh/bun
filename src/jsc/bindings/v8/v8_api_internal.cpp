#include "v8_api_internal.h"
#include "V8Isolate.h"
#include "V8HandleScope.h"
#include "V8Data.h"
#include "V8Value.h"
#include "shim/HandleScopeBuffer.h"
#include "shim/GlobalHandleRegistry.h"
#include "shim/GlobalInternals.h"
#include "shim/Function.h"
#include "shim/FunctionTemplate.h"
#include "v8_compatibility_assertions.h"

ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::WeakCallbackInfo<void>)
ASSERT_V8_ENUM_MATCHES(WeakCallbackType, kParameter)
ASSERT_V8_ENUM_MATCHES(WeakCallbackType, kInternalFields)

namespace v8 {

namespace api_internal {

void ToLocalEmpty()
{
    BUN_PANIC("Attempt to unwrap an empty v8::MaybeLocal");
}

void FromJustIsNothing()
{
    BUN_PANIC("Attempt to call FromJust on an empty v8::Maybe");
}

uintptr_t* GlobalizeReference(internal::Isolate* i_isolate, uintptr_t address)
{
    auto* isolate = reinterpret_cast<Isolate*>(i_isolate);
    TaggedPointer* newSlot = shim::GlobalHandleRegistry::ensure(isolate->vm()).create(isolate, TaggedPointer::fromRaw(address));
    return newSlot->asRawPtrLocation();
}

void DisposeGlobal(uintptr_t* location)
{
    if (!location) return;
    shim::GlobalHandleRegistry::dispose(reinterpret_cast<shim::GlobalHandle*>(location));
}

void MakeWeak(uintptr_t* location, void* data, WeakCallbackInfo<void>::Callback weak_callback, WeakCallbackType type)
{
    if (!location) return;
    shim::GlobalHandleRegistry::makeWeak(reinterpret_cast<shim::GlobalHandle*>(location), data, weak_callback, type);
}

void MakeWeak(uintptr_t** location_addr)
{
    if (!*location_addr) return;
    shim::GlobalHandleRegistry::makeWeak(reinterpret_cast<shim::GlobalHandle*>(*location_addr), location_addr, nullptr, WeakCallbackType::kParameter);
}

void* ClearWeak(uintptr_t* location)
{
    if (!location) return nullptr;
    return shim::GlobalHandleRegistry::clearWeak(reinterpret_cast<shim::GlobalHandle*>(location));
}

void MoveGlobalReference(uintptr_t** from, uintptr_t** to)
{
    // The inline caller has copied *from into *to, which is not null. Only a handle that is not Normal records where its v8::Global is.
    if (reinterpret_cast<shim::GlobalHandle*>(*to)->state() == shim::GlobalHandle::State::Normal) [[likely]] {
        return;
    }
    shim::GlobalHandleRegistry::didMove(from, to);
}

Local<Value> GetFunctionTemplateData(Isolate* isolate, Local<Data> target)
{
    // The target should be a Function that was created from a FunctionTemplate
    // Use operator* to get the Data* from Local<Data>, then call localToObjectPointer
    auto* function = target->localToObjectPointer<shim::Function>();
    if (!function) return Local<Value>();

    auto* functionTemplate = function->functionTemplate();
    if (!functionTemplate) return Local<Value>();

    JSC::JSValue data = functionTemplate->m_data.get();
    return isolate->currentHandleScope()->createLocal<Value>(isolate->vm(), data);
}

} // namespace api_internal
} // namespace v8
