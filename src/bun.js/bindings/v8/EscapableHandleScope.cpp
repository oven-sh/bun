#include "v8/EscapableHandleScope.h"

namespace v8 {

EscapableHandleScope::EscapableHandleScope(Isolate* isolate)
    : EscapableHandleScopeBase(isolate)
{
}

EscapableHandleScope::~EscapableHandleScope()
{
    EscapableHandleScopeBase::~EscapableHandleScopeBase();
}

}
