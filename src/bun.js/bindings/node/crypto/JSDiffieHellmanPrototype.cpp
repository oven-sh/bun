#include "JSDiffieHellmanPrototype.h"
#include "JSDiffieHellman.h"
#include "DiffieHellmanFunctions.h"
#include "ErrorCode.h"

#include "NodeValidator.h"
#include "JSBufferEncodingType.h"
#include <JavaScriptCore/TypedArrayInlines.h>
#include <JavaScriptCore/JSCJSValueInlines.h>

namespace Bun {

// Declare host function prototypes
JSC_DECLARE_HOST_FUNCTION(jsDiffieHellmanProtoFuncGenerateKeys);
JSC_DECLARE_HOST_FUNCTION(jsDiffieHellmanProtoFuncComputeSecret);
JSC_DECLARE_HOST_FUNCTION(jsDiffieHellmanProtoFuncGetPrime);
JSC_DECLARE_HOST_FUNCTION(jsDiffieHellmanProtoFuncGetGenerator);
JSC_DECLARE_HOST_FUNCTION(jsDiffieHellmanProtoFuncGetPublicKey);
JSC_DECLARE_HOST_FUNCTION(jsDiffieHellmanProtoFuncGetPrivateKey);
JSC_DECLARE_HOST_FUNCTION(jsDiffieHellmanProtoFuncSetPublicKey);
JSC_DECLARE_HOST_FUNCTION(jsDiffieHellmanProtoFuncSetPrivateKey);

const JSC::ClassInfo JSDiffieHellmanPrototype::s_info = { "DiffieHellman"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSDiffieHellmanPrototype) };

static const JSC::HashTableValue JSDiffieHellmanPrototypeTableValues[] = {
    { "generateKeys"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsDiffieHellmanProtoFuncGenerateKeys, 0 } },
    { "computeSecret"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsDiffieHellmanProtoFuncComputeSecret, 1 } },
    { "getPrime"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsDiffieHellmanProtoFuncGetPrime, 0 } },
    { "getGenerator"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsDiffieHellmanProtoFuncGetGenerator, 0 } },
    { "getPublicKey"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsDiffieHellmanProtoFuncGetPublicKey, 0 } },
    { "getPrivateKey"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsDiffieHellmanProtoFuncGetPrivateKey, 0 } },
    { "setPublicKey"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsDiffieHellmanProtoFuncSetPublicKey, 1 } },
    { "setPrivateKey"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsDiffieHellmanProtoFuncSetPrivateKey, 1 } },
};

void JSDiffieHellmanPrototype::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSDiffieHellmanPrototype::info(), JSDiffieHellmanPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

// Implementation of prototype methods
JSC_DEFINE_HOST_FUNCTION(jsDiffieHellmanProtoFuncGenerateKeys, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return jsDiffieHellmanProtoFuncGenerateKeysTemplate<JSDiffieHellman>(globalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(jsDiffieHellmanProtoFuncComputeSecret, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return jsDiffieHellmanProtoFuncComputeSecretTemplate<JSDiffieHellman>(globalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(jsDiffieHellmanProtoFuncGetPrime, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return jsDiffieHellmanProtoFuncGetPrimeTemplate<JSDiffieHellman>(globalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(jsDiffieHellmanProtoFuncGetGenerator, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return jsDiffieHellmanProtoFuncGetGeneratorTemplate<JSDiffieHellman>(globalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(jsDiffieHellmanProtoFuncGetPublicKey, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return jsDiffieHellmanProtoFuncGetPublicKeyTemplate<JSDiffieHellman>(globalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(jsDiffieHellmanProtoFuncGetPrivateKey, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return jsDiffieHellmanProtoFuncGetPrivateKeyTemplate<JSDiffieHellman>(globalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(jsDiffieHellmanProtoFuncSetPublicKey, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return jsDiffieHellmanProtoFuncSetPublicKeyTemplate<JSDiffieHellman>(globalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(jsDiffieHellmanProtoFuncSetPrivateKey, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return jsDiffieHellmanProtoFuncSetPrivateKeyTemplate<JSDiffieHellman>(globalObject, callFrame);
}

} // namespace Bun
