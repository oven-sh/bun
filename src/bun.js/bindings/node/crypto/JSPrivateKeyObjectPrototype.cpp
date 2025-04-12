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

const JSC::ClassInfo JSPrivateKeyObjectPrototype::s_info = { "PrivateKeyObject"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSPrivateKeyObjectPrototype) };

static const JSC::HashTableValue JSPrivateKeyObjectPrototypeTableValues[] = {
    { "asymmetricKeyType"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsPrivateKeyObjectPrototype_asymmetricKeyType, 0 } },
    { "asymmetricKeyDetails"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsPrivateKeyObjectPrototype_asymmetricKeyDetails, 0 } },
    { "export"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsPrivateKeyObjectPrototype_export, 1 } },
};

void JSPrivateKeyObjectPrototype::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSPrivateKeyObjectPrototype::info(), JSPrivateKeyObjectPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
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
    return JSValue::encode(handle.exportAsymmetric(globalObject, scope, optionsValue, KeyObject::Type::Private));
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

    KeyObject& handle = privateKeyObject->handle();
    return JSValue::encode(handle.asymmetricKeyDetails(globalObject, scope));
}
