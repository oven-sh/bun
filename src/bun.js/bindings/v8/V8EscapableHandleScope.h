#pragma once

#include "V8EscapableHandleScopeBase.h"

namespace v8 {

class EscapableHandleScope : public EscapableHandleScopeBase {
public:
    BUN_EXPORT EscapableHandleScope(Isolate* isolate);
    BUN_EXPORT ~EscapableHandleScope();
};

static_assert(sizeof(EscapableHandleScope) == 32, "EscapableHandleScope has wrong layout");

} // namespace v8
