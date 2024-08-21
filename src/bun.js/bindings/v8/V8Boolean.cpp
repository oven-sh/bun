#include "V8Boolean.h"
#include "V8HandleScope.h"

namespace v8 {

bool Boolean::Value() const
{
    return localToJSValue(Isolate::GetCurrent()->globalInternals()).asBoolean();
}

Local<Boolean> Boolean::New(Isolate* isolate, bool value)
{
    return isolate->currentHandleScope()->createLocal<Boolean>(isolate->vm(), JSC::jsBoolean(value));
}

}
