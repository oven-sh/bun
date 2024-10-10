#pragma once

#include "v8.h"
#include "V8Isolate.h"
#include "V8HandleScope.h"

namespace v8 {

class EscapableHandleScopeBase : public HandleScope {
public:
    BUN_EXPORT EscapableHandleScopeBase(Isolate* isolate);

protected:
    BUN_EXPORT uintptr_t* EscapeSlot(uintptr_t* escape_value);

private:
    shim::Handle* m_escapeSlot;
};

} // namespace v8
