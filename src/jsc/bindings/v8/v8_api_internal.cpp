#include "v8_api_internal.h"
#include "V8Isolate.h"
#include "V8HandleScope.h"
#include "V8Data.h"
#include "V8Value.h"
#include "shim/HandleScopeBuffer.h"
#include "shim/GlobalInternals.h"
#include "shim/Function.h"
#include "shim/FunctionTemplate.h"

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
    auto* globalHandles = isolate->globalInternals()->globalHandles();
    TaggedPointer* newSlot = globalHandles->createHandleFromExistingObject(TaggedPointer::fromRaw(address), isolate);
    return newSlot->asRawPtrLocation();
}

void DisposeGlobal(uintptr_t* location)
{
    // TODO free up a slot in the handle scope
    (void)location;
}

uintptr_t* CopyGlobalReference(uintptr_t* from)
{
    auto* isolate = Isolate::GetCurrent();
    auto* globalHandles = isolate->globalInternals()->globalHandles();
    TaggedPointer* newSlot = globalHandles->createHandleFromExistingObject(TaggedPointer::fromRaw(*from), isolate);
    return newSlot->asRawPtrLocation();
}

void MoveGlobalReference(uintptr_t** from, uintptr_t** to)
{
    *to = *from;
}

void MakeWeak(uintptr_t*, void*, void (*)(const WeakCallbackInfo<void>&), WeakCallbackType)
{
    V8_UNIMPLEMENTED();
}

void MakeWeak(uintptr_t**)
{
    V8_UNIMPLEMENTED();
}

void* ClearWeak(uintptr_t*)
{
    V8_UNIMPLEMENTED();
    return nullptr;
}

void AnnotateStrongRetainer(uintptr_t*, const char*)
{
}

uintptr_t* Eternalize(Isolate* isolate, Value* handle)
{
    return GlobalizeReference(reinterpret_cast<internal::Isolate*>(isolate), *reinterpret_cast<uintptr_t*>(handle));
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
