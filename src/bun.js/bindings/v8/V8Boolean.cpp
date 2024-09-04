#include "V8Boolean.h"
#include "V8HandleScope.h"

namespace v8 {

bool Boolean::Value() const
{
    JSC::JSValue jsv = localToOddball();
    if (jsv.isTrue()) {
        return true;
    } else if (jsv.isFalse()) {
        return false;
    } else {
        RELEASE_ASSERT_NOT_REACHED("non-Boolean passed to Boolean::Value");
    }
}

Local<Boolean> Boolean::New(Isolate* isolate, bool value)
{
    return isolate->currentHandleScope()->createLocal<Boolean>(isolate->vm(), JSC::jsBoolean(value));
}

} // namespace v8
