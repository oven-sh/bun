#include "JSSecretKeyObjectPrototype.h"
#include "JSSecretKeyObject.h"
#include "ErrorCode.h"
#include "CryptoUtil.h"
#include "BunProcess.h"
#include "NodeValidator.h"
#include "JSBufferEncodingType.h"
#include <JavaScriptCore/TypedArrayInlines.h>
#include <JavaScriptCore/JSCJSValueInlines.h>

using namespace Bun;
using namespace JSC;
using namespace WebCore;
using namespace ncrypto;

JSC_DECLARE_HOST_FUNCTION(jsSecretKeyObjectExport);
JSC_DECLARE_CUSTOM_GETTER(jsSecretKeyObjectSymmetricKeySize);
JSC_DECLARE_HOST_FUNCTION(jsSecretKeyObjectToCryptoKey);

const JSC::ClassInfo JSSecretKeyObjectPrototype::s_info = { "SecretKeyObject"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSSecretKeyObjectPrototype) };

static const JSC::HashTableValue JSSecretKeyObjectPrototypeTableValues[] = {
    { "export"_s, static_cast<unsigned>(PropertyAttribute::Function | PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::NativeFunctionType, jsSecretKeyObjectExport, 1 } },
    { "symmetricKeySize"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::GetterSetterType, jsSecretKeyObjectSymmetricKeySize, 0 } },
    // { "toCryptoKey"_s, static_cast<unsigned>(PropertyAttribute::Function | PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::NativeFunctionType, jsSecretKeyObjectToCryptoKey, 3 } },
};

void JSSecretKeyObjectPrototype::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSSecretKeyObjectPrototype::info(), JSSecretKeyObjectPrototypeTableValues, *this);

    // intentionally inherit KeyObject's toStringTag
    // https://github.com/nodejs/node/blob/95b0f9d448832eeb75586c89fab0777a1a4b0610/lib/internal/crypto/keys.js#L146
}

JSC_DEFINE_HOST_FUNCTION(jsSecretKeyObjectExport, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);

    JSSecretKeyObject* secretKeyObject = jsDynamicCast<JSSecretKeyObject*>(callFrame->thisValue());
    if (!secretKeyObject) {
        throwThisTypeError(*globalObject, scope, "SecretKeyObject"_s, "export"_s);
        return {};
    }

    KeyObject& handle = secretKeyObject->handle();
    JSValue optionsValue = callFrame->argument(0);

    RELEASE_AND_RETURN(scope, JSValue::encode(handle.exportSecret(globalObject, scope, optionsValue)));
}

JSC_DEFINE_CUSTOM_GETTER(jsSecretKeyObjectSymmetricKeySize, (JSGlobalObject*, JSC::EncodedJSValue thisValue, PropertyName propertyName))
{
    JSSecretKeyObject* secretKeyObject = jsDynamicCast<JSSecretKeyObject*>(JSValue::decode(thisValue));
    if (!secretKeyObject) {
        return JSValue::encode(jsUndefined());
    }

    size_t symmetricKeySize = secretKeyObject->handle().symmetricKey().size();
    return JSValue::encode(jsNumber(symmetricKeySize));
}

// JSC_DEFINE_HOST_FUNCTION(jsSecretKeyObjectToCryptoKey, (JSGlobalObject * globalObject, CallFrame* callFrame))
// {
//     VM& vm = globalObject->vm();
//     ThrowScope scope = DECLARE_THROW_SCOPE(vm);

//     JSSecretKeyObject* secretKeyObject = jsDynamicCast<JSSecretKeyObject*>(callFrame->thisValue());
//     if (!secretKeyObject) {
//         throwThisTypeError(*globalObject, scope, "SecretKeyObject"_s, "toCryptoKey"_s);
//         return {};
//     }

//     KeyObject& handle = secretKeyObject->handle();
//     JSValue algorithmValue = callFrame->argument(0);
//     JSValue extractableValue = callFrame->argument(1);
//     JSValue keyUsagesValue = callFrame->argument(2);

//     return JSValue::encode(handle.toCryptoKey(globalObject, scope, algorithmValue, extractableValue, keyUsagesValue));
// }
