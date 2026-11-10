#include "V8BigInt.h"
#include "V8HandleScope.h"
#include "v8_compatibility_assertions.h"
#include "napi.h"
#include <JavaScriptCore/JSBigInt.h>

ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::BigInt)

namespace v8 {

Local<BigInt> BigInt::New(Isolate* isolate, int64_t value)
{
    auto* globalObject = isolate->globalObject();
    NapiUngatedScope ungated { isolate->vm() };
    JSC::JSBigInt* bigint = JSC::JSBigInt::createFrom(globalObject, value);
    return isolate->currentHandleScope()->createLocal<BigInt>(isolate->vm(), bigint);
}

} // namespace v8
