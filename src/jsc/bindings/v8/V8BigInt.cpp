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

Local<BigInt> BigInt::NewFromUnsigned(Isolate* isolate, uint64_t value)
{
    auto* globalObject = isolate->globalObject();
    auto& vm = isolate->vm();
    NapiUngatedScope ungated { vm };
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSC::JSBigInt* bigint = JSC::JSBigInt::createFrom(globalObject, value);
    RETURN_IF_EXCEPTION(scope, Local<BigInt>());
    return isolate->currentHandleScope()->createLocal<BigInt>(vm, bigint);
}

} // namespace v8
