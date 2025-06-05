#include "CryptoKeys.h"
#include "NodeValidator.h"
#include "ErrorCode.h"
#include "CryptoUtil.h"
#include "JSSecretKeyObject.h"
#include "JSPublicKeyObject.h"
#include "JSPrivateKeyObject.h"

using namespace JSC;

namespace Bun {

JSC_DEFINE_HOST_FUNCTION(jsCreateSecretKey, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    VM& vm = lexicalGlobalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    JSValue keyValue = callFrame->argument(0);
    JSValue encodingValue = callFrame->argument(1);

    KeyObject keyObject = KeyObject::prepareSecretKey(lexicalGlobalObject, scope, keyValue, encodingValue, true);
    RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

    Structure* structure = globalObject->m_JSSecretKeyObjectClassStructure.get(lexicalGlobalObject);
    JSSecretKeyObject* secretKey = JSSecretKeyObject::create(vm, structure, lexicalGlobalObject, WTFMove(keyObject));

    return JSValue::encode(secretKey);
}

JSC_DEFINE_HOST_FUNCTION(jsCreatePublicKey, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    VM& vm = lexicalGlobalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    JSValue keyValue = callFrame->argument(0);

    auto prepareResult = KeyObject::prepareAsymmetricKey(lexicalGlobalObject, scope, keyValue, KeyObject::PrepareAsymmetricKeyMode::CreatePublic);
    RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

    KeyObject keyObject;

    if (prepareResult.keyData) {
        RefPtr<KeyObjectData> keyData = *prepareResult.keyData;
        keyObject = KeyObject::create(CryptoKeyType::Public, WTFMove(keyData));
    } else {
        keyObject = KeyObject::getPublicOrPrivateKey(
            globalObject,
            scope,
            prepareResult.keyDataView,
            CryptoKeyType::Public,
            prepareResult.formatType,
            prepareResult.encodingType,
            prepareResult.cipher,
            WTFMove(prepareResult.passphrase));
        RETURN_IF_EXCEPTION(scope, {});
    }

    Structure* structure = globalObject->m_JSPublicKeyObjectClassStructure.get(lexicalGlobalObject);
    JSPublicKeyObject* publicKey = JSPublicKeyObject::create(vm, structure, lexicalGlobalObject, WTFMove(keyObject));

    return JSValue::encode(publicKey);
}

JSC_DEFINE_HOST_FUNCTION(jsCreatePrivateKey, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    VM& vm = lexicalGlobalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    JSValue keyValue = callFrame->argument(0);

    auto prepareResult = KeyObject::prepareAsymmetricKey(lexicalGlobalObject, scope, keyValue, KeyObject::PrepareAsymmetricKeyMode::CreatePrivate);
    RETURN_IF_EXCEPTION(scope, {});

    KeyObject keyObject;

    if (prepareResult.keyData) {
        auto keyData = *prepareResult.keyData;
        keyObject = KeyObject::create(CryptoKeyType::Private, WTFMove(keyData));
    } else {
        keyObject = KeyObject::getPublicOrPrivateKey(
            globalObject,
            scope,
            prepareResult.keyDataView,
            CryptoKeyType::Private,
            prepareResult.formatType,
            prepareResult.encodingType,
            prepareResult.cipher,
            WTFMove(prepareResult.passphrase));
        RETURN_IF_EXCEPTION(scope, {});
    }

    Structure* structure = globalObject->m_JSPrivateKeyObjectClassStructure.get(lexicalGlobalObject);
    JSPrivateKeyObject* privateKey = JSPrivateKeyObject::create(vm, structure, lexicalGlobalObject, WTFMove(keyObject));

    return JSValue::encode(privateKey);
}

} // namespace Bun
