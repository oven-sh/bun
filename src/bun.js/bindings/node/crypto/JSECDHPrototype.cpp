#include "JSECDHPrototype.h"
#include "JSECDH.h"
#include "ErrorCode.h"

#include "NodeValidator.h"
#include "JSBufferEncodingType.h"
#include <JavaScriptCore/TypedArrayInlines.h>
#include <JavaScriptCore/JSCJSValueInlines.h>

namespace Bun {

// Declare host function prototypes
JSC_DECLARE_HOST_FUNCTION(jsECDHProtoFuncComputeSecret);
JSC_DECLARE_HOST_FUNCTION(jsECDHProtoFuncGetPublicKey);
JSC_DECLARE_HOST_FUNCTION(jsECDHProtoFuncGetPrivateKey);
JSC_DECLARE_HOST_FUNCTION(jsECDHProtoFuncSetPublicKey);
JSC_DECLARE_HOST_FUNCTION(jsECDHProtoFuncSetPrivateKey);
JSC_DECLARE_HOST_FUNCTION(jsECDHProtoFuncGenerateKeys);

const JSC::ClassInfo JSECDHPrototype::s_info = { "ECDH"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSECDHPrototype) };

static const JSC::HashTableValue JSECDHPrototypeTableValues[] = {
    { "getPublicKey"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsECDHProtoFuncGetPublicKey, 0 } },
    { "getPrivateKey"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsECDHProtoFuncGetPrivateKey, 0 } },
    { "setPublicKey"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsECDHProtoFuncSetPublicKey, 1 } },
    { "setPrivateKey"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsECDHProtoFuncSetPrivateKey, 1 } },
    { "generateKeys"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsECDHProtoFuncGenerateKeys, 0 } },
    { "computeSecret"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsECDHProtoFuncComputeSecret, 1 } },
};

void JSECDHPrototype::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSECDHPrototype::info(), JSECDHPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

JSC_DEFINE_HOST_FUNCTION(jsECDHProtoFuncGenerateKeys, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    // TODO
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsECDHProtoFuncComputeSecret, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    // TODO
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsECDHProtoFuncGetPublicKey, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    // TODO
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsECDHProtoFuncGetPrivateKey, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    // TODO
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsECDHProtoFuncSetPublicKey, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    // TODO
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsECDHProtoFuncSetPrivateKey, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    // TODO
    return JSValue::encode(jsUndefined());
}

} // namespace Bun
