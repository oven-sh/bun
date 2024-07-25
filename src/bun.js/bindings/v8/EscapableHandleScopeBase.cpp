#include "v8/EscapableHandleScopeBase.h"

namespace v8 {

EscapableHandleScopeBase::EscapableHandleScopeBase(Isolate* isolate)
    : HandleScope(isolate)
{
}

uintptr_t* EscapableHandleScopeBase::EscapeSlot(uintptr_t* escape_value)
{
    assert("EscapableHandleScopeBase::EscapeSlot" && 0);
    return nullptr;
}

}
