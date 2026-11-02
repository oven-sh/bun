#pragma once

#include "../V8Isolate.h"
#include "HandleScopeBuffer.h"
#include "napi.h"

#include "JavaScriptCore/TopExceptionScope.h"

namespace v8 {
namespace shim {

// For a value constructor, which an addon may call while an exception is pending. `construct` returns the new cell
// and runs under a NapiUngatedScope. That scope forbids JavaScript and a report runs JavaScript, so a failure is
// reported after the scope.
template<typename T, typename Construct>
ALWAYS_INLINE Local<T> constructUngated(Isolate* isolate, const Construct& construct)
{
    JSC::VM& vm = isolate->vm();
    {
        NapiUngatedScope ungated { vm };
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        auto* cell = construct();
        if (!scope.exception()) [[likely]]
            return isolate->currentHandleScope()->createLocal<T>(vm, cell);
    }
    reportUncaughtException();
    return Local<T>();
}

} // namespace shim
} // namespace v8
