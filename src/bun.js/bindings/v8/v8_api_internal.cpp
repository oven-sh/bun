#include "v8_api_internal.h"
#include "V8Isolate.h"
#include "shim/HandleScopeBuffer.h"
#include "shim/GlobalInternals.h"

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

} // namespace api_internal
} // namespace v8
