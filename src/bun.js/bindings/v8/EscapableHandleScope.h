#pragma once

#include "v8/EscapableHandleScopeBase.h"

namespace v8 {

class EscapableHandleScope : public EscapableHandleScopeBase {
public:
    BUN_EXPORT EscapableHandleScope(Isolate* isolate);
    BUN_EXPORT ~EscapableHandleScope();
};

}
