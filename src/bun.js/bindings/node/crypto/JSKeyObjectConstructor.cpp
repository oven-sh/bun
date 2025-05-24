#include "JSKeyObjectConstructor.h"
#include "JSKeyObject.h"
#include "ErrorCode.h"
#include "JSBufferEncodingType.h"
#include "NodeValidator.h"
#include <JavaScriptCore/TypedArrayInlines.h>
#include <JavaScriptCore/JSCJSValueInlines.h>
#include "CryptoUtil.h"
#include "openssl/dh.h"
#include "openssl/bn.h"
#include "openssl/err.h"
#include "ncrypto.h"
#include "JSCryptoKey.h"
#include "JSSecretKeyObject.h"
#include "JSPublicKeyObject.h"
#include "JSPrivateKeyObject.h"
#include "ZigGlobalObject.h"
#include "CryptoKeyAES.h"
#include "CryptoKeyHMAC.h"
#include "CryptoKeyRaw.h"
#include "CryptoKey.h"
#include "CryptoKeyType.h"
using namespace JSC;
using namespace WebCore;
using namespace ncrypto;

namespace Bun {

JSC_DECLARE_HOST_FUNCTION(jsKeyObjectConstructor_from);

static const JSC::HashTableValue JSKeyObjectConstructorTableValues[] = {
    { "from"_s, static_cast<unsigned>(PropertyAttribute::Function | PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::NativeFunctionType, jsKeyObjectConstructor_from, 1 } },
};

const JSC::ClassInfo JSKeyObjectConstructor::s_info = { "KeyObject"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSKeyObjectConstructor) };

void JSKeyObjectConstructor::finishCreation(VM& vm, JSGlobalObject* globalObject, JSObject* prototype)
{
    Base::finishCreation(vm, 2, "KeyObject"_s);
    putDirect(vm, vm.propertyNames->prototype, prototype, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
    reifyStaticProperties(vm, JSKeyObjectConstructor::info(), JSKeyObjectConstructorTableValues, *this);
}

JSC_DEFINE_HOST_FUNCTION(callKeyObject, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    VM& vm = lexicalGlobalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);
    throwTypeError(lexicalGlobalObject, scope, "Cannot call KeyObject class constructor without |new|"_s);
    return JSValue::encode({});
}

JSC_DEFINE_HOST_FUNCTION(constructKeyObject, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = lexicalGlobalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);

    JSValue typeValue = callFrame->argument(0);

    if (!typeValue.isString()) {
        // always INVALID_ARG_VALUE
        // https://github.com/nodejs/node/blob/e1fabe4f58722af265d11081b91ce287f90738f4/lib/internal/crypto/keys.js#L108
        return ERR::INVALID_ARG_VALUE(scope, lexicalGlobalObject, "type"_s, typeValue);
    }

    JSString* typeString = typeValue.toString(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, JSValue::encode({}));
    GCOwnedDataScope<WTF::StringView> typeView = typeString->view(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

    if (typeView != "secret"_s && typeView != "public"_s && typeView != "private"_s) {
        return ERR::INVALID_ARG_VALUE(scope, lexicalGlobalObject, "type"_s, typeValue);
    }

    JSValue handleValue = callFrame->argument(1);
    // constructing a KeyObject is impossible
    return ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "handle"_s, "object"_s, handleValue);
}

JSC_DEFINE_HOST_FUNCTION(jsKeyObjectConstructor_from, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    VM& vm = lexicalGlobalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    // 1. Validate Input Argument
    JSValue keyValue = callFrame->argument(0);
    JSCryptoKey* cryptoKey = jsDynamicCast<JSCryptoKey*>(keyValue);

    if (!cryptoKey) {
        return ERR::INVALID_ARG_TYPE_INSTANCE(scope, globalObject, "key"_s, "CryptoKey"_s, keyValue);
    }

    WebCore::CryptoKey& wrappedKey = cryptoKey->wrapped();

    auto keyObjectResult = KeyObject::create(wrappedKey);
    if (keyObjectResult.hasException()) [[unlikely]] {
        WebCore::propagateException(*lexicalGlobalObject, scope, keyObjectResult.releaseException());
        return JSValue::encode({});
    }

    // 2. Determine Key Type and Extract Material
    switch (wrappedKey.type()) {
    case CryptoKeyType::Secret: {
        auto* structure = globalObject->m_JSSecretKeyObjectClassStructure.get(globalObject);
        JSSecretKeyObject* instance = JSSecretKeyObject::create(vm, structure, globalObject, keyObjectResult.releaseReturnValue());
        RELEASE_AND_RETURN(scope, JSValue::encode(instance));
    }

    case CryptoKeyType::Public: {
        auto* structure = globalObject->m_JSPublicKeyObjectClassStructure.get(globalObject);
        JSPublicKeyObject* instance = JSPublicKeyObject::create(vm, structure, globalObject, keyObjectResult.releaseReturnValue());
        RELEASE_AND_RETURN(scope, JSValue::encode(instance));
    }

    case CryptoKeyType::Private: {
        auto* structure = globalObject->m_JSPrivateKeyObjectClassStructure.get(globalObject);
        JSPrivateKeyObject* instance = JSPrivateKeyObject::create(vm, structure, globalObject, keyObjectResult.releaseReturnValue());
        RELEASE_AND_RETURN(scope, JSValue::encode(instance));
    }
    }

    ASSERT_NOT_REACHED();

    // Should not be reached
    RELEASE_AND_RETURN(scope, JSValue::encode(jsUndefined()));
}

} // namespace Bun
