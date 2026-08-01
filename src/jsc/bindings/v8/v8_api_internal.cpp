#include "v8_api_internal.h"
#include "V8Isolate.h"
#include "V8HandleScope.h"
#include "V8Data.h"
#include "V8Value.h"
#include "shim/HandleScopeBuffer.h"
#include "shim/GlobalInternals.h"
#include "shim/Function.h"
#include "shim/FunctionTemplate.h"
#include "v8_compatibility_assertions.h"
#include <wtf/HashMap.h>
#include <wtf/NeverDestroyed.h>

ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::WeakCallbackInfo<void>)
ASSERT_V8_ENUM_MATCHES(WeakCallbackType, kParameter)
ASSERT_V8_ENUM_MATCHES(WeakCallbackType, kInternalFields)

namespace v8 {

namespace api_internal {

namespace {
struct WeakHandleEntry {
    void* parameter { nullptr };
    WeakCallbackInfo<void>::Callback callback { nullptr };
    WeakCallbackType type { WeakCallbackType::kParameter };
};

static WTF::HashMap<uintptr_t*, WeakHandleEntry>& weakHandles()
{
    static WTF::NeverDestroyed<WTF::HashMap<uintptr_t*, WeakHandleEntry>> map;
    return map.get();
}
} // namespace

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
    if (location) weakHandles().remove(location);
    // TODO free up a slot in the handle scope
    (void)location;
}

void MakeWeak(uintptr_t* location, void* data, WeakCallbackInfo<void>::Callback weak_callback, WeakCallbackType type)
{
    // Record the weak callback so ClearWeak() can return the parameter. The underlying
    // handle remains strongly visited by globalHandles(); firing the callback on collect
    // is not yet wired up.
    if (!location) return;
    weakHandles().set(location, WeakHandleEntry { data, weak_callback, type });
}

void* ClearWeak(uintptr_t* location)
{
    if (!location) return nullptr;
    auto& map = weakHandles();
    auto it = map.find(location);
    if (it == map.end()) return nullptr;
    void* parameter = it->value.parameter;
    map.remove(it);
    return parameter;
}

void MoveGlobalReference(uintptr_t** from, uintptr_t** to)
{
    // The inline caller already copied *from into *to. Our weak state is keyed by the
    // global-handle storage slot (which did not move), so nothing to update here.
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
