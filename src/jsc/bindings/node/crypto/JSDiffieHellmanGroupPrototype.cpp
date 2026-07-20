#include "JSDiffieHellmanGroupPrototype.h"
#include "JSDiffieHellmanGroup.h"
#include "DiffieHellmanFunctions.h"
#include "ErrorCode.h"

#include "NodeValidator.h"
#include "JSBufferEncodingType.h"
#include <JavaScriptCore/TypedArrayInlines.h>
#include <JavaScriptCore/JSCJSValueInlines.h>

namespace Bun {

// Declare host function prototypes
JSC_DECLARE_HOST_FUNCTION(jsDiffieHellmanGroupProtoFuncGenerateKeys);
JSC_DECLARE_HOST_FUNCTION(jsDiffieHellmanGroupProtoFuncComputeSecret);
JSC_DECLARE_HOST_FUNCTION(jsDiffieHellmanGroupProtoFuncGetPrime);
JSC_DECLARE_HOST_FUNCTION(jsDiffieHellmanGroupProtoFuncGetGenerator);
JSC_DECLARE_HOST_FUNCTION(jsDiffieHellmanGroupProtoFuncGetPublicKey);
JSC_DECLARE_HOST_FUNCTION(jsDiffieHellmanGroupProtoFuncGetPrivateKey);

// Define specific group prototype host functions
JSC_DEFINE_HOST_FUNCTION(jsDiffieHellmanGroupProtoFuncGenerateKeys, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return jsDiffieHellmanProtoFuncGenerateKeysTemplate<JSDiffieHellmanGroup>(globalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(jsDiffieHellmanGroupProtoFuncComputeSecret, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return jsDiffieHellmanProtoFuncComputeSecretTemplate<JSDiffieHellmanGroup>(globalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(jsDiffieHellmanGroupProtoFuncGetPrime, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return jsDiffieHellmanProtoFuncGetPrimeTemplate<JSDiffieHellmanGroup>(globalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(jsDiffieHellmanGroupProtoFuncGetGenerator, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return jsDiffieHellmanProtoFuncGetGeneratorTemplate<JSDiffieHellmanGroup>(globalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(jsDiffieHellmanGroupProtoFuncGetPublicKey, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return jsDiffieHellmanProtoFuncGetPublicKeyTemplate<JSDiffieHellmanGroup>(globalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(jsDiffieHellmanGroupProtoFuncGetPrivateKey, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return jsDiffieHellmanProtoFuncGetPrivateKeyTemplate<JSDiffieHellmanGroup>(globalObject, callFrame);
}

const JSC::ClassInfo JSDiffieHellmanGroupPrototype::s_info = { "DiffieHellmanGroup"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSDiffieHellmanGroupPrototype) };

static const JSC::HashTableValue JSDiffieHellmanGroupPrototypeTableValues[] = {
    { "generateKeys"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsDiffieHellmanGroupProtoFuncGenerateKeys, 0 } },
    { "computeSecret"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsDiffieHellmanGroupProtoFuncComputeSecret, 1 } },
    { "getPrime"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsDiffieHellmanGroupProtoFuncGetPrime, 0 } },
    { "getGenerator"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsDiffieHellmanGroupProtoFuncGetGenerator, 0 } },
    { "getPublicKey"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsDiffieHellmanGroupProtoFuncGetPublicKey, 0 } },
    { "getPrivateKey"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsDiffieHellmanGroupProtoFuncGetPrivateKey, 0 } },
};

void JSDiffieHellmanGroupPrototype::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSDiffieHellmanGroup::info(), JSDiffieHellmanGroupPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

} // namespace Bun
