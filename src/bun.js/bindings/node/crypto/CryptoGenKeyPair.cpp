#include "CryptoGenKeyPair.h"
#include "helpers.h"
#include "NodeValidator.h"
#include "CryptoUtil.h"
#include "BunProcess.h"
#include "JSPublicKeyObject.h"
#include "JSPrivateKeyObject.h"
#include <JavaScriptCore/ObjectConstructor.h>
#include "openssl/ec.h"
#include "CryptoGenRsaKeyPair.h"
#include "CryptoGenDsaKeyPair.h"
#include "CryptoGenEcKeyPair.h"
#include "CryptoGenNidKeyPair.h"
#include "CryptoGenDhKeyPair.h"

using namespace JSC;

namespace Bun {

void KeyPairJobCtx::runTask(JSGlobalObject* globalObject, ncrypto::EVPKeyCtxPointer& keyCtx)
{
    EVP_PKEY* pkey = nullptr;
    if (!EVP_PKEY_keygen(keyCtx.get(), &pkey)) {
        m_opensslError = ERR_get_error();
        return;
    }

    ncrypto::EVPKeyPointer key = ncrypto::EVPKeyPointer(pkey);
    m_keyObj = KeyObject::create(CryptoKeyType::Private, WTFMove(key));
}

void KeyPairJobCtx::runFromJS(JSGlobalObject* lexicalGlobalObject, JSValue callback)
{
    VM& vm = lexicalGlobalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);

    auto exceptionCallback = [lexicalGlobalObject, callback](JSValue exceptionValue) {
        Bun__EventLoop__runCallback1(lexicalGlobalObject, JSValue::encode(callback), JSValue::encode(jsUndefined()), JSValue::encode(exceptionValue));
    };

    if (!m_keyObj.data()) {
        JSValue err = createCryptoError(lexicalGlobalObject, scope, m_opensslError, "key generation failed"_s);
        Bun__EventLoop__runCallback1(lexicalGlobalObject, JSValue::encode(callback), JSValue::encode(jsUndefined()), JSValue::encode(err));
        return;
    }

    JSValue publicKeyValue = m_keyObj.exportPublic(lexicalGlobalObject, scope, m_publicKeyEncoding);
    if (scope.exception()) {
        JSValue exceptionValue = scope.exception();
        scope.clearException();
        exceptionCallback(exceptionValue);
        return;
    }

    JSValue privateKeyValue = m_keyObj.exportPrivate(lexicalGlobalObject, scope, m_privateKeyEncoding);
    if (scope.exception()) {
        JSValue exceptionValue = scope.exception();
        scope.clearException();
        exceptionCallback(exceptionValue);
        return;
    }

    Bun__EventLoop__runCallback3(
        lexicalGlobalObject,
        JSValue::encode(callback),
        JSValue::encode(jsUndefined()),
        JSValue::encode(jsNull()),
        JSValue::encode(publicKeyValue),
        JSValue::encode(privateKeyValue));
}

KeyEncodingConfig parseKeyEncodingConfig(JSGlobalObject* globalObject, ThrowScope& scope, JSValue keyTypeValue, JSValue optionsValue)
{
    ncrypto::EVPKeyPointer::PublicKeyEncodingConfig publicKeyEncoding = {};
    ncrypto::EVPKeyPointer::PrivateKeyEncodingConfig privateKeyEncoding = {};

    JSValue publicKeyEncodingValue = jsUndefined();
    JSValue privateKeyEncodingValue = jsUndefined();

    if (optionsValue.isObject()) {
        publicKeyEncodingValue = optionsValue.get(globalObject, Identifier::fromString(globalObject->vm(), "publicKeyEncoding"_s));
        RETURN_IF_EXCEPTION(scope, {});

        privateKeyEncodingValue = optionsValue.get(globalObject, Identifier::fromString(globalObject->vm(), "privateKeyEncoding"_s));
        RETURN_IF_EXCEPTION(scope, {});
    }

    if (publicKeyEncodingValue.isUndefinedOrNull()) {
        // defaults and output key object
        publicKeyEncoding.output_key_object = true;
    } else if (JSObject* publicKeyEncodingObj = publicKeyEncodingValue.getObject()) {
        parsePublicKeyEncoding(globalObject, scope, publicKeyEncodingObj, keyTypeValue, "publicKeyEncoding"_s, publicKeyEncoding);
        RETURN_IF_EXCEPTION(scope, {});
    } else {
        ERR::INVALID_ARG_VALUE(scope, globalObject, "options.publicKeyEncoding"_s, publicKeyEncodingValue);
        return {};
    }

    if (privateKeyEncodingValue.isUndefinedOrNull()) {
        // defaults and output key object
        privateKeyEncoding.output_key_object = true;
    } else if (JSObject* privateKeyEncodingObj = privateKeyEncodingValue.getObject()) {
        parsePrivateKeyEncoding(globalObject, scope, privateKeyEncodingObj, keyTypeValue, "privateKeyEncoding"_s, privateKeyEncoding);
        RETURN_IF_EXCEPTION(scope, {});
    } else {
        ERR::INVALID_ARG_VALUE(scope, globalObject, "options.privateKeyEncoding"_s, privateKeyEncodingValue);
        return {};
    }

    return {
        publicKeyEncoding,
        privateKeyEncoding,
    };
}

JSC_DEFINE_HOST_FUNCTION(jsGenerateKeyPair, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);

    JSValue typeValue = callFrame->argument(0);
    JSValue optionsValue = callFrame->argument(1);
    JSValue callbackValue = callFrame->argument(2);

    if (optionsValue.isCallable()) {
        callbackValue = optionsValue;
        optionsValue = jsUndefined();
    }

    V::validateFunction(scope, globalObject, callbackValue, "callback"_s);
    RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

    V::validateString(scope, globalObject, typeValue, "type"_s);
    RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

    KeyEncodingConfig config = parseKeyEncodingConfig(globalObject, scope, typeValue, optionsValue);
    RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

    if (!optionsValue.isUndefined()) {
        V::validateObject(scope, globalObject, optionsValue, "options"_s);
        RETURN_IF_EXCEPTION(scope, JSValue::encode({}));
    }

    JSString* typeString = typeValue.toString(globalObject);
    RETURN_IF_EXCEPTION(scope, JSValue::encode({}));
    GCOwnedDataScope<WTF::StringView> typeView = typeString->view(globalObject);
    RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

    if (typeView == "rsa"_s || typeView == "rsa-pss"_s) {
        std::optional<RsaKeyPairJobCtx> ctx = RsaKeyPairJobCtx::fromJS(globalObject, scope, typeView, optionsValue, config);
        ASSERT(ctx.has_value() == !scope.exception());
        RETURN_IF_EXCEPTION(scope, JSValue::encode({}));
        RsaKeyPairJob::createAndSchedule(globalObject, WTFMove(*ctx), callbackValue);
        return JSValue::encode(jsUndefined());
    }
    if (typeView == "dsa"_s) {
        std::optional<DsaKeyPairJobCtx> ctx = DsaKeyPairJobCtx::fromJS(globalObject, scope, typeView, optionsValue, config);
        ASSERT(ctx.has_value() == !scope.exception());
        RETURN_IF_EXCEPTION(scope, JSValue::encode({}));
        DsaKeyPairJob::createAndSchedule(globalObject, WTFMove(*ctx), callbackValue);
        return JSValue::encode(jsUndefined());
    }
    if (typeView == "ec"_s) {
        std::optional<EcKeyPairJobCtx> ctx = EcKeyPairJobCtx::fromJS(globalObject, scope, typeView, optionsValue, config);
        ASSERT(ctx.has_value() == !scope.exception());
        RETURN_IF_EXCEPTION(scope, JSValue::encode({}));
        EcKeyPairJob::createAndSchedule(globalObject, WTFMove(*ctx), callbackValue);
        return JSValue::encode(jsUndefined());
    }
    // TODO: should just get `id` here
    if (typeView == "ed25519"_s || typeView == "ed448"_s || typeView == "x25519"_s || typeView == "x448"_s) {
        std::optional<NidKeyPairJobCtx> ctx = NidKeyPairJobCtx::fromJS(globalObject, scope, typeView, optionsValue, config);
        ASSERT(ctx.has_value() == !scope.exception());
        RETURN_IF_EXCEPTION(scope, JSValue::encode({}));
        NidKeyPairJob::createAndSchedule(globalObject, WTFMove(*ctx), callbackValue);
        return JSValue::encode(jsUndefined());
    }
    if (typeView == "dh"_s) {
        std::optional<DhKeyPairJobCtx> ctx = DhKeyPairJobCtx::fromJS(globalObject, scope, typeView, optionsValue, config);
        ASSERT(ctx.has_value() == !scope.exception());
        RETURN_IF_EXCEPTION(scope, JSValue::encode({}));
        DhKeyPairJob::createAndSchedule(globalObject, WTFMove(*ctx), callbackValue);
        return JSValue::encode(jsUndefined());
    }

    return ERR::INVALID_ARG_VALUE(scope, globalObject, "type"_s, typeValue, "must be a supported key type"_s);
}

JSC_DEFINE_HOST_FUNCTION(jsGenerateKeyPairSync, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);

    JSValue typeValue = callFrame->argument(0);
    JSValue optionsValue = callFrame->argument(1);

    V::validateString(scope, globalObject, typeValue, "type"_s);
    RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

    KeyEncodingConfig config = parseKeyEncodingConfig(globalObject, scope, typeValue, optionsValue);
    RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

    if (!optionsValue.isUndefined()) {
        V::validateObject(scope, globalObject, optionsValue, "options"_s);
        RETURN_IF_EXCEPTION(scope, JSValue::encode({}));
    }

    JSString* typeString = typeValue.toString(globalObject);
    RETURN_IF_EXCEPTION(scope, JSValue::encode({}));
    GCOwnedDataScope<WTF::StringView> typeView = typeString->view(globalObject);
    RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

    JSObject* result = JSC::constructEmptyObject(globalObject);
    JSValue publicKeyValue = jsUndefined();
    JSValue privateKeyValue = jsUndefined();

    if (typeView == "rsa"_s || typeView == "rsa-pss"_s) {
        std::optional<RsaKeyPairJobCtx> ctx = RsaKeyPairJobCtx::fromJS(globalObject, scope, typeView, optionsValue, config);
        ASSERT(ctx.has_value() == !scope.exception());
        RETURN_IF_EXCEPTION(scope, JSValue::encode({}));
        ncrypto::EVPKeyCtxPointer keyCtx = ctx->setup();
        if (!keyCtx) {
            throwCryptoError(globalObject, scope, ctx->err());
            return JSValue::encode({});
        }
        ctx->runTask(globalObject, keyCtx);
        if (!ctx->m_keyObj.data()) {
            throwCryptoError(globalObject, scope, ctx->err());
            return JSValue::encode({});
        }
        publicKeyValue = ctx->m_keyObj.exportPublic(globalObject, scope, ctx->m_publicKeyEncoding);
        RETURN_IF_EXCEPTION(scope, JSValue::encode({}));
        privateKeyValue = ctx->m_keyObj.exportPrivate(globalObject, scope, ctx->m_privateKeyEncoding);
        RETURN_IF_EXCEPTION(scope, JSValue::encode({}));
    } else if (typeView == "dsa"_s) {
        auto ctx = DsaKeyPairJobCtx::fromJS(globalObject, scope, typeView, optionsValue, config);
        ASSERT(ctx.has_value() == !scope.exception());
        RETURN_IF_EXCEPTION(scope, JSValue::encode({}));
        ncrypto::EVPKeyCtxPointer keyCtx = ctx->setup();
        if (!keyCtx) {
            throwCryptoError(globalObject, scope, ctx->err());
            return JSValue::encode({});
        }
        ctx->runTask(globalObject, keyCtx);
        if (!ctx->m_keyObj.data()) {
            throwCryptoError(globalObject, scope, ctx->err());
            return JSValue::encode({});
        }
        publicKeyValue = ctx->m_keyObj.exportPublic(globalObject, scope, ctx->m_publicKeyEncoding);
        RETURN_IF_EXCEPTION(scope, JSValue::encode({}));
        privateKeyValue = ctx->m_keyObj.exportPrivate(globalObject, scope, ctx->m_privateKeyEncoding);
        RETURN_IF_EXCEPTION(scope, JSValue::encode({}));
    } else if (typeView == "ec"_s) {
        auto ctx = EcKeyPairJobCtx::fromJS(globalObject, scope, typeView, optionsValue, config);
        ASSERT(ctx.has_value() == !scope.exception());
        RETURN_IF_EXCEPTION(scope, JSValue::encode({}));
        ncrypto::EVPKeyCtxPointer keyCtx = ctx->setup();
        if (!keyCtx) {
            throwCryptoError(globalObject, scope, ctx->err());
            return JSValue::encode({});
        }
        ctx->runTask(globalObject, keyCtx);
        if (!ctx->m_keyObj.data()) {
            throwCryptoError(globalObject, scope, ctx->err());
            return JSValue::encode({});
        }
        publicKeyValue = ctx->m_keyObj.exportPublic(globalObject, scope, ctx->m_publicKeyEncoding);
        RETURN_IF_EXCEPTION(scope, JSValue::encode({}));
        privateKeyValue = ctx->m_keyObj.exportPrivate(globalObject, scope, ctx->m_privateKeyEncoding);
        RETURN_IF_EXCEPTION(scope, JSValue::encode({}));
    } else if (typeView == "ed25519"_s || typeView == "ed448"_s || typeView == "x25519"_s || typeView == "x448"_s) {
        auto ctx = NidKeyPairJobCtx::fromJS(globalObject, scope, typeView, optionsValue, config);
        ASSERT(ctx.has_value() == !scope.exception());
        RETURN_IF_EXCEPTION(scope, JSValue::encode({}));
        ncrypto::EVPKeyCtxPointer keyCtx = ctx->setup();
        if (!keyCtx) {
            throwCryptoError(globalObject, scope, ctx->err());
            return JSValue::encode({});
        }
        ctx->runTask(globalObject, keyCtx);
        if (!ctx->m_keyObj.data()) {
            throwCryptoError(globalObject, scope, ctx->err());
            return JSValue::encode({});
        }
        publicKeyValue = ctx->m_keyObj.exportPublic(globalObject, scope, ctx->m_publicKeyEncoding);
        RETURN_IF_EXCEPTION(scope, JSValue::encode({}));
        privateKeyValue = ctx->m_keyObj.exportPrivate(globalObject, scope, ctx->m_privateKeyEncoding);
        RETURN_IF_EXCEPTION(scope, JSValue::encode({}));
    } else if (typeView == "dh"_s) {
        auto ctx = DhKeyPairJobCtx::fromJS(globalObject, scope, typeView, optionsValue, config);
        ASSERT(ctx.has_value() == !scope.exception());
        RETURN_IF_EXCEPTION(scope, JSValue::encode({}));
        ncrypto::EVPKeyCtxPointer keyCtx = ctx->setup();
        if (!keyCtx) {
            throwCryptoError(globalObject, scope, ctx->err());
            return JSValue::encode({});
        }
        ctx->runTask(globalObject, keyCtx);
        if (!ctx->m_keyObj.data()) {
            throwCryptoError(globalObject, scope, ctx->err());
            return JSValue::encode({});
        }
        publicKeyValue = ctx->m_keyObj.exportPublic(globalObject, scope, ctx->m_publicKeyEncoding);
        RETURN_IF_EXCEPTION(scope, JSValue::encode({}));
        privateKeyValue = ctx->m_keyObj.exportPrivate(globalObject, scope, ctx->m_privateKeyEncoding);
        RETURN_IF_EXCEPTION(scope, JSValue::encode({}));
    } else {
        return ERR::INVALID_ARG_VALUE(scope, globalObject, "type"_s, typeValue, "must be a supported key type"_s);
    }

    result->putDirect(vm, Identifier::fromString(vm, "publicKey"_s), publicKeyValue);
    RETURN_IF_EXCEPTION(scope, JSValue::encode({}));
    result->putDirect(vm, Identifier::fromString(vm, "privateKey"_s), privateKeyValue);
    return JSValue::encode(result);
}

} // namespace Bun
