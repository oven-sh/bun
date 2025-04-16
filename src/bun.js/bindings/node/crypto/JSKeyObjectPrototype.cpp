#include "JSKeyObjectPrototype.h"
#include "JSKeyObject.h"
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

JSC_DECLARE_HOST_FUNCTION(jsKeyObjectPrototype_equals);
JSC_DECLARE_CUSTOM_GETTER(jsKeyObjectPrototype_type);

const JSC::ClassInfo JSKeyObjectPrototype::s_info = { "KeyObject"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSKeyObjectPrototype) };

static const JSC::HashTableValue JSKeyObjectPrototypeTableValues[] = {
    { "equals"_s, static_cast<unsigned>(PropertyAttribute::Function | PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::NativeFunctionType, jsKeyObjectPrototype_equals, 1 } },
    { "type"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::GetterSetterType, jsKeyObjectPrototype_type, 0 } },
};

void JSKeyObjectPrototype::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSKeyObjectPrototype::info(), JSKeyObjectPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

JSC_DEFINE_HOST_FUNCTION(jsKeyObjectPrototype_equals, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);

    JSKeyObject* thisObject = jsDynamicCast<JSKeyObject*>(callFrame->thisValue());
    if (!thisObject) {
        throwThisTypeError(*globalObject, scope, "KeyObject"_s, "equals"_s);
        return JSValue::encode({});
    }

    JSValue otherKeyObjectValue = callFrame->argument(0);
    JSKeyObject* otherKeyObject = jsDynamicCast<JSKeyObject*>(otherKeyObjectValue);
    if (!otherKeyObject) {
        return ERR::INVALID_ARG_INSTANCE(scope, globalObject, "otherKeyObject"_s, "KeyObject"_s, otherKeyObjectValue);
    }

    KeyObject& thisHandle = thisObject->handle();
    KeyObject& otherHandle = otherKeyObject->handle();

    std::optional<bool> result = thisHandle.equals(otherHandle);
    if (!result.has_value()) {
        return ERR::CRYPTO_UNSUPPORTED_OPERATION(scope, globalObject);
    }

    return JSValue::encode(jsBoolean(*result));
}

JSC_DEFINE_CUSTOM_GETTER(jsKeyObjectPrototype_type, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName propertyName))
{
    VM& vm = globalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);

    JSKeyObject* keyObject = jsDynamicCast<JSKeyObject*>(JSValue::decode(thisValue));
    if (!keyObject) {
        return JSValue::encode(jsUndefined());
    }

    KeyObject& handle = keyObject->handle();

    switch (handle.type()) {
    case CryptoKeyType::Secret:
        return JSValue::encode(jsNontrivialString(vm, "secret"_s));
    case CryptoKeyType::Public:
        return JSValue::encode(jsNontrivialString(vm, "public"_s));
    case CryptoKeyType::Private:
        return JSValue::encode(jsNontrivialString(vm, "private"_s));
    }
}
