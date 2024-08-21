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
    *escape_slot = *reinterpret_cast<Handle*>(escape_value);
    return &escape_slot->to_v8_object.value;
}

}
