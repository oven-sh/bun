#include "v8/EscapableHandleScopeBase.h"

namespace v8 {

EscapableHandleScopeBase::EscapableHandleScopeBase(Isolate* isolate)
    : HandleScope(isolate)
{
    // at this point isolate->currentHandleScope() would just be this, so instead we have to get the
    // previous one
    auto& handle = prev->buffer->createUninitializedHandle();
    memset(&handle, 0xaa, sizeof(handle));
    escape_slot = &handle;
}

uintptr_t* EscapableHandleScopeBase::EscapeSlot(uintptr_t* escape_value)
{
    *escape_slot = *reinterpret_cast<HandleScopeBuffer::Handle*>(escape_value);
    return reinterpret_cast<uintptr_t*>(escape_slot);
}

}
