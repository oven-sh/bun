#include "v8_api_internal.h"
#include "V8Isolate.h"
#include "V8HandleScopeBuffer.h"

namespace v8 {
namespace api_internal {

void ToLocalEmpty()
{
    BUN_PANIC("Attempt to unwrap an empty v8::MaybeLocal");
}

uintptr_t* GlobalizeReference(v8::internal::Isolate* isolate, uintptr_t address)
{
    auto* globalHandles = reinterpret_cast<Isolate*>(isolate)->globalInternals()->globalHandles();
    return &globalHandles->createHandleFromExistingHandle(TaggedPointer::fromRaw(address))->value;
}

void DisposeGlobal(uintptr_t* location)
{
    // TODO free up a slot in the handle scope
    (void)location;
}

}
}
