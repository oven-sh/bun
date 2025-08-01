#include "JSPublicKeyObjectPrototype.h"
#include "JSPublicKeyObject.h"
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

JSC_DECLARE_HOST_FUNCTION(jsPublicKeyObjectPrototype_export);
JSC_DECLARE_CUSTOM_GETTER(jsPublicKeyObjectPrototype_asymmetricKeyType);
JSC_DECLARE_CUSTOM_GETTER(jsPublicKeyObjectPrototype_asymmetricKeyDetails);
JSC_DECLARE_HOST_FUNCTION(jsPublicKeyObjectPrototype_toCryptoKey);

const JSC::ClassInfo JSPublicKeyObjectPrototype::s_info = { "PublicKeyObject"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSPublicKeyObjectPrototype) };

static const JSC::HashTableValue JSPublicKeyObjectPrototypeTableValues[] = {
    { "asymmetricKeyType"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::GetterSetterType, jsPublicKeyObjectPrototype_asymmetricKeyType, 0 } },
    { "asymmetricKeyDetails"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::GetterSetterType, jsPublicKeyObjectPrototype_asymmetricKeyDetails, 0 } },
    { "export"_s, static_cast<unsigned>(PropertyAttribute::Function | PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::NativeFunctionType, jsPublicKeyObjectPrototype_export, 1 } },
    // { "toCryptoKey"_s, static_cast<unsigned>(PropertyAttribute::Function | PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::NativeFunctionType, jsPublicKeyObjectPrototype_toCryptoKey, 3 } },
};

void JSPublicKeyObjectPrototype::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSPublicKeyObjectPrototype::info(), JSPublicKeyObjectPrototypeTableValues, *this);

    // intentionally inherit KeyObject's toStringTag
    // https://github.com/nodejs/node/blob/95b0f9d448832eeb75586c89fab0777a1a4b0610/lib/internal/crypto/keys.js#L146
}

JSC_DEFINE_HOST_FUNCTION(jsPublicKeyObjectPrototype_export, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);

    JSPublicKeyObject* publicKeyObject = jsDynamicCast<JSPublicKeyObject*>(callFrame->thisValue());
    if (!publicKeyObject) {
        throwThisTypeError(*globalObject, scope, "PublicKeyObject"_s, "export"_s);
        return {};
    }

    KeyObject& handle = publicKeyObject->handle();
    JSValue optionsValue = callFrame->argument(0);
    return JSValue::encode(handle.exportAsymmetric(globalObject, scope, optionsValue, CryptoKeyType::Public));
}

JSC_DEFINE_HOST_FUNCTION(jsPublicKeyObjectPrototype_asymmetricKeyType, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName propertyName))
{
    VM& vm = globalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);

    JSPublicKeyObject* publicKeyObject = jsDynamicCast<JSPublicKeyObject*>(JSValue::decode(thisValue));
    if (!publicKeyObject) {
        return JSValue::encode(jsUndefined());
    }

    KeyObject& handle = publicKeyObject->handle();
    return JSValue::encode(handle.asymmetricKeyType(globalObject));
}

JSC_DEFINE_HOST_FUNCTION(jsPublicKeyObjectPrototype_asymmetricKeyDetails, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName propertyName))
{
    VM& vm = globalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);

    JSPublicKeyObject* publicKeyObject = jsDynamicCast<JSPublicKeyObject*>(JSValue::decode(thisValue));
    if (!publicKeyObject) {
        return JSValue::encode(jsUndefined());
    }

    if (auto* keyDetails = publicKeyObject->m_keyDetails.get()) {
        return JSValue::encode(keyDetails);
    }

    KeyObject& handle = publicKeyObject->handle();
    JSObject* keyDetails = handle.asymmetricKeyDetails(globalObject, scope);
    RETURN_IF_EXCEPTION(scope, {});

    publicKeyObject->m_keyDetails.set(vm, publicKeyObject, keyDetails);

    return JSValue::encode(keyDetails);
}

// JSC_DEFINE_HOST_FUNCTION(jsPublicKeyObjectPrototype_toCryptoKey, (JSGlobalObject * globalObject, CallFrame* callFrame))
// {
//     VM& vm = globalObject->vm();
//     ThrowScope scope = DECLARE_THROW_SCOPE(vm);

//     JSPublicKeyObject* publicKeyObject = jsDynamicCast<JSPublicKeyObject*>(callFrame->thisValue());
//     if (!publicKeyObject) {
//         throwThisTypeError(*globalObject, scope, "PublicKeyObject"_s, "toCryptoKey"_s);
//         return {};
//     }

//     KeyObject& handle = publicKeyObject->handle();
//     JSValue algorithmValue = callFrame->argument(0);
//     JSValue extractableValue = callFrame->argument(1);
//     JSValue keyUsagesValue = callFrame->argument(2);

//     return JSValue::encode(handle.toCryptoKey(globalObject, scope, algorithmValue, extractableValue, keyUsagesValue));
// }
