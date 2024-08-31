#include "V8EscapableHandleScopeBase.h"

namespace v8 {

EscapableHandleScopeBase::EscapableHandleScopeBase(Isolate* isolate)
    : HandleScope(isolate)
{
    // at this point isolate->currentHandleScope() would just be this, so instead we have to get the
    // previous one
    auto& handle = prev->buffer->createEmptyHandle();
    escape_slot = &handle;
}

// Store the handle escape_value in the escape slot that we have allocated from the parent
// HandleScope, and return the escape slot
uintptr_t* EscapableHandleScopeBase::EscapeSlot(uintptr_t* escape_value)
{
    RELEASE_ASSERT(escape_slot != nullptr, "EscapableHandleScope::Escape called multiple times");
    TaggedPointer* newHandle = prev->buffer->createHandleFromExistingObject(
        TaggedPointer::fromRaw(*escape_value),
        isolate,
        escape_slot);
    escape_slot = nullptr;
    return &newHandle->value;
}

}
