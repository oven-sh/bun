#include "V8EscapableHandleScope.h"
#include "v8_compatibility_assertions.h"

ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::EscapableHandleScope)

namespace v8 {

EscapableHandleScope::EscapableHandleScope(Isolate* isolate)
    : EscapableHandleScopeBase(isolate)
{
}

EscapableHandleScope::~EscapableHandleScope()
{
}

} // namespace v8
