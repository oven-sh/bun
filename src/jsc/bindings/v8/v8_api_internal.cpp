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
    TaggedPointer* newSlot = isolate->globalHandleRegistry().create(isolate, TaggedPointer::fromRaw(address));
    return newSlot->asRawPtrLocation();
}

void DisposeGlobal(uintptr_t* location)
{
    if (!location) return;
    shim::GlobalHandleRegistry::dispose(reinterpret_cast<shim::Handle*>(location));
}

void MakeWeak(uintptr_t* location, void* data, WeakCallbackInfo<void>::Callback weak_callback, WeakCallbackType type)
{
    // Record the parameter so ClearWeak() can return it. The underlying handle
    // keeps its strong root in the GlobalHandleRegistry; firing the callback on collect
    // is not yet wired up.
    (void)weak_callback;
    (void)type;
    if (!location) return;
    shim::GlobalHandleRegistry::setWeakParameter(reinterpret_cast<shim::Handle*>(location), data);
}

void* ClearWeak(uintptr_t* location)
{
    if (!location) return nullptr;
    return shim::GlobalHandleRegistry::takeWeakParameter(reinterpret_cast<shim::Handle*>(location));
}

void MoveGlobalReference(uintptr_t** from, uintptr_t** to)
{
    // The inline caller already copied *from into *to. Our weak state is keyed by the
    // handle, which did not move: its GlobalHandleBlock has the parameter, so there is nothing to update here.
    (void)from;
    (void)to;
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
