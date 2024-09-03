#include "V8EscapableHandleScope.h"

namespace v8 {

EscapableHandleScope::EscapableHandleScope(Isolate* isolate)
    : EscapableHandleScopeBase(isolate)
{
}

EscapableHandleScope::~EscapableHandleScope()
{
}

} // namespace v8
