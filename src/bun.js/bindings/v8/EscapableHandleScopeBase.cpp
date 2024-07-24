#include "v8/EscapableHandleScopeBase.h"

namespace v8 {

EscapableHandleScopeBase::EscapableHandleScopeBase(Isolate* isolate)
{
    assert("EscapableHandleScopeBase::EscapableHandleScopeBase" && 0);
}

uintptr_t* EscapableHandleScopeBase::EscapeSlot(uintptr_t* escape_value)
{
    assert("EscapableHandleScopeBase::EscapeSlot" && 0);
}

}
