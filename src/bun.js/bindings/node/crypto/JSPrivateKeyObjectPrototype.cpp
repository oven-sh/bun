#include "JSPrivateKeyObjectPrototype.h"
#include "JSPrivateKeyObject.h"
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

JSC_DECLARE_HOST_FUNCTION(jsPrivateKeyObjectPrototype_export);
JSC_DECLARE_CUSTOM_GETTER(jsPrivateKeyObjectPrototype_asymmetricKeyType);
JSC_DECLARE_CUSTOM_GETTER(jsPrivateKeyObjectPrototype_asymmetricKeyDetails);
JSC_DECLARE_HOST_FUNCTION(jsPrivateKeyObjectPrototype_toCryptoKey);

const JSC::ClassInfo JSPrivateKeyObjectPrototype::s_info = { "PrivateKeyObject"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSPrivateKeyObjectPrototype) };

static const JSC::HashTableValue JSPrivateKeyObjectPrototypeTableValues[] = {
    { "asymmetricKeyType"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::GetterSetterType, jsPrivateKeyObjectPrototype_asymmetricKeyType, 0 } },
    { "asymmetricKeyDetails"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::GetterSetterType, jsPrivateKeyObjectPrototype_asymmetricKeyDetails, 0 } },
    { "export"_s, static_cast<unsigned>(PropertyAttribute::Function | PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::NativeFunctionType, jsPrivateKeyObjectPrototype_export, 1 } },
    // { "toCryptoKey"_s, static_cast<unsigned>(PropertyAttribute::Function | PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::NativeFunctionType, jsPrivateKeyObjectPrototype_toCryptoKey, 3 } },
};

void JSPrivateKeyObjectPrototype::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSPrivateKeyObjectPrototype::info(), JSPrivateKeyObjectPrototypeTableValues, *this);

    // intentionally inherit KeyObject's toStringTag
    // https://github.com/nodejs/node/blob/95b0f9d448832eeb75586c89fab0777a1a4b0610/lib/internal/crypto/keys.js#L146
}

JSC_DEFINE_HOST_FUNCTION(jsPrivateKeyObjectPrototype_export, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);

    JSPrivateKeyObject* privateKeyObject = jsDynamicCast<JSPrivateKeyObject*>(callFrame->thisValue());
    if (!privateKeyObject) {
        throwThisTypeError(*globalObject, scope, "PrivateKeyObject"_s, "export"_s);
        return {};
    }

    KeyObject& handle = privateKeyObject->handle();
    JSValue optionsValue = callFrame->argument(0);
    return JSValue::encode(handle.exportAsymmetric(globalObject, scope, optionsValue, CryptoKeyType::Private));
}

JSC_DEFINE_HOST_FUNCTION(jsPrivateKeyObjectPrototype_asymmetricKeyType, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName propertyName))
{
    VM& vm = globalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);

    JSPrivateKeyObject* privateKeyObject = jsDynamicCast<JSPrivateKeyObject*>(JSValue::decode(thisValue));
    if (!privateKeyObject) {
        return JSValue::encode(jsUndefined());
    }

    KeyObject& handle = privateKeyObject->handle();
    return JSValue::encode(handle.asymmetricKeyType(globalObject));
}

JSC_DEFINE_HOST_FUNCTION(jsPrivateKeyObjectPrototype_asymmetricKeyDetails, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName propertyName))
{
    VM& vm = globalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);

    JSPrivateKeyObject* privateKeyObject = jsDynamicCast<JSPrivateKeyObject*>(JSValue::decode(thisValue));
    if (!privateKeyObject) {
        return JSValue::encode(jsUndefined());
    }

    if (auto* keyDetails = privateKeyObject->m_keyDetails.get()) {
        return JSValue::encode(keyDetails);
    }

    KeyObject& handle = privateKeyObject->handle();
    JSObject* keyDetails = handle.asymmetricKeyDetails(globalObject, scope);
    RETURN_IF_EXCEPTION(scope, {});

    privateKeyObject->m_keyDetails.set(vm, privateKeyObject, keyDetails);
    return JSValue::encode(keyDetails);
}

// JSC_DEFINE_HOST_FUNCTION(jsPrivateKeyObjectPrototype_toCryptoKey, (JSGlobalObject * globalObject, CallFrame* callFrame))
// {
//     VM& vm = globalObject->vm();
//     ThrowScope scope = DECLARE_THROW_SCOPE(vm);

//     JSPrivateKeyObject* privateKeyObject = jsDynamicCast<JSPrivateKeyObject*>(callFrame->thisValue());
//     if (!privateKeyObject) {
//         throwThisTypeError(*globalObject, scope, "PrivateKeyObject"_s, "toCryptoKey"_s);
//         return JSValue::encode({});
//     }

//     KeyObject& handle = privateKeyObject->handle();
//     JSValue algorithmValue = callFrame->argument(0);
//     JSValue extractableValue = callFrame->argument(1);
//     JSValue keyUsagesValue = callFrame->argument(2);

//     return JSValue::encode(handle.toCryptoKey(globalObject, scope, algorithmValue, extractableValue, keyUsagesValue));
// }
