#include "CryptoDhJob.h"
#include "NodeValidator.h"
#include "JSKeyObject.h"
#include "ErrorCode.h"

using namespace JSC;
using namespace ncrypto;

namespace Bun {

extern "C" void Bun__DhJobCtx__deinit(DhJobCtx* ctx)
{
    ctx->deinit();
}
void DhJobCtx::deinit()
{
    delete this;
}

extern "C" void Bun__DhJobCtx__runTask(DhJobCtx* ctx, JSGlobalObject* globalObject)
{
    ctx->runTask(globalObject);
}
void DhJobCtx::runTask(JSGlobalObject* globalObject)
{
    // A failed derive must not leave its OpenSSL errors on the thread's error queue, where a
    // later unrelated operation would pick them up.
    ncrypto::ClearErrorOnReturn clearErrorOnReturn;

    auto dp = DHPointer::stateless(m_privateKey->asymmetricKey, m_publicKey->asymmetricKey);
    if (!dp) {
        m_opensslError = ERR_get_error();
        return;
    }

    m_result = ByteSource::allocated(dp.release());
}

// Same error from the synchronous path and the callback path: the OpenSSL error of the failed derive.
NEVER_INLINE JSValue DhJobCtx::deriveError(JSGlobalObject* globalObject, ThrowScope& scope)
{
    if (m_opensslError) {
        return createCryptoError(globalObject, scope, m_opensslError, nullptr);
    }
    return createError(globalObject, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "Deriving bits failed"_s);
}

extern "C" void Bun__DhJobCtx__runFromJS(DhJobCtx* ctx, JSGlobalObject* globalObject, JSCallbackArgs* out)
{
    *out = ctx->runFromJS(globalObject);
}
JSCallbackArgs DhJobCtx::runFromJS(JSGlobalObject* lexicalGlobalObject)
{
    VM& vm = lexicalGlobalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);

    if (!m_result) {
        JSValue err = deriveError(lexicalGlobalObject, scope);
        RETURN_IF_EXCEPTION(scope, {});
        return { err };
    }

    JSValue result = WebCore::createBuffer(lexicalGlobalObject, m_result.span());
    RETURN_IF_EXCEPTION(scope, {});
    return { jsNull(), result };
}

extern "C" void Bun__DhJob__createAndSchedule(JSGlobalObject* globalObject, DhJobCtx* ctx, EncodedJSValue callback);
void DhJob::createAndSchedule(JSGlobalObject* globalObject, DhJobCtx&& ctx, JSValue callback)
{
    DhJobCtx* ctxCopy = new DhJobCtx(WTF::move(ctx));
    Bun__DhJob__createAndSchedule(globalObject, ctxCopy, JSValue::encode(callback));
}

static NEVER_INLINE void throwIncompatibleKeyTypes(JSGlobalObject* globalObject, ThrowScope& scope, KeyObject& privateKey, KeyObject& publicKey)
{
    auto privateKeyType = privateKey.asymmetricKeyType(globalObject).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, );
    auto publicKeyType = publicKey.asymmetricKeyType(globalObject).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, );
    ERR::CRYPTO_INCOMPATIBLE_KEY(scope, globalObject, "key types for Diffie-Hellman"_s, makeString(privateKeyType, " and "_s, publicKeyType));
}

// At least one of the two keys is not a KeyObject. The checks run in node's order: both keys are
// validated before either is read.
static NEVER_INLINE std::optional<DhJobCtx> dhJobCtxFromKeyData(JSGlobalObject* globalObject, ThrowScope& scope, JSValue privateKeyValue, JSValue publicKeyValue, JSKeyObject* privateKeyObject, JSKeyObject* publicKeyObject)
{
    if (privateKeyValue.isUndefinedOrNull()) {
        ERR::INVALID_ARG_VALUE(scope, globalObject, "options.privateKey"_s, privateKeyValue);
        return std::nullopt;
    }

    if (publicKeyValue.isUndefinedOrNull()) {
        ERR::INVALID_ARG_VALUE(scope, globalObject, "options.publicKey"_s, publicKeyValue);
        return std::nullopt;
    }

    if (privateKeyObject && privateKeyObject->handle().type() != CryptoKeyType::Private) {
        ERR::CRYPTO_INVALID_KEY_OBJECT_TYPE(scope, globalObject, privateKeyObject->handle().type(), "private"_s);
        return std::nullopt;
    }

    if (publicKeyObject && publicKeyObject->handle().type() == CryptoKeyType::Secret) {
        ERR::CRYPTO_INVALID_KEY_OBJECT_TYPE(scope, globalObject, CryptoKeyType::Secret, "private or public"_s);
        return std::nullopt;
    }

    using Mode = KeyObject::PrepareAsymmetricKeyMode;
    auto preparedPublicKey = KeyObject::prepareAsymmetricKey(globalObject, scope, publicKeyValue, Mode::ConsumePublic, "options.publicKey"_s);
    RETURN_IF_EXCEPTION(scope, std::nullopt);
    auto preparedPrivateKey = KeyObject::prepareAsymmetricKey(globalObject, scope, privateKeyValue, Mode::ConsumePrivate, "options.privateKey"_s);
    RETURN_IF_EXCEPTION(scope, std::nullopt);

    // Key data of a type that cannot derive, or of two types that differ, fails in the derive.
    KeyObject publicKey = KeyObject::importPreparedKey(globalObject, scope, WTF::move(preparedPublicKey), Mode::ConsumePublic);
    RETURN_IF_EXCEPTION(scope, std::nullopt);
    KeyObject privateKey = KeyObject::importPreparedKey(globalObject, scope, WTF::move(preparedPrivateKey), Mode::ConsumePrivate);
    RETURN_IF_EXCEPTION(scope, std::nullopt);

    return DhJobCtx(privateKey.data(), publicKey.data());
}

std::optional<DhJobCtx> DhJobCtx::fromJS(JSGlobalObject* globalObject, ThrowScope& scope, JSC::JSObject* options)
{
    VM& vm = globalObject->vm();

    JSValue privateKeyValue = options->get(globalObject, Identifier::fromString(vm, "privateKey"_s));
    RETURN_IF_EXCEPTION(scope, std::nullopt);
    JSValue publicKeyValue = options->get(globalObject, Identifier::fromString(vm, "publicKey"_s));
    RETURN_IF_EXCEPTION(scope, std::nullopt);

    JSKeyObject* privateKeyObject = dynamicDowncast<JSKeyObject>(privateKeyValue);
    JSKeyObject* publicKeyObject = dynamicDowncast<JSKeyObject>(publicKeyValue);
    if (!privateKeyObject || !publicKeyObject) {
        return dhJobCtxFromKeyData(globalObject, scope, privateKeyValue, publicKeyValue, privateKeyObject, publicKeyObject);
    }

    KeyObject& privateKey = privateKeyObject->handle();
    KeyObject& publicKey = publicKeyObject->handle();

    if (privateKey.type() != CryptoKeyType::Private) {
        ERR::CRYPTO_INVALID_KEY_OBJECT_TYPE(scope, globalObject, privateKey.type(), "private"_s);
        return std::nullopt;
    }

    if (publicKey.type() != CryptoKeyType::Public && publicKey.type() != CryptoKeyType::Private) {
        ERR::CRYPTO_INVALID_KEY_OBJECT_TYPE(scope, globalObject, publicKey.type(), "private or public"_s);
        return std::nullopt;
    }

    static constexpr auto supportedKeyTypes = std::to_array<int>({ EVP_PKEY_DH,
        EVP_PKEY_EC,
        EVP_PKEY_X448,
        EVP_PKEY_X25519 });

    int privateKeyType = privateKey.asymmetricKey().id();
    int publicKeyType = publicKey.asymmetricKey().id();

    if (privateKeyType != publicKeyType || std::ranges::find(supportedKeyTypes, privateKeyType) == supportedKeyTypes.end()) {
        throwIncompatibleKeyTypes(globalObject, scope, privateKey, publicKey);
        return std::nullopt;
    }

    return DhJobCtx(privateKey.data(), publicKey.data());
}

JSC_DEFINE_HOST_FUNCTION(jsDiffieHellman, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue optionsValue = callFrame->argument(0);
    V::validateObject(scope, lexicalGlobalObject, optionsValue, "options"_s);
    RETURN_IF_EXCEPTION(scope, {});
    JSObject* options = optionsValue.getObject();

    JSValue callbackValue = callFrame->argument(1);
    if (!callbackValue.isUndefined()) {
        V::validateFunction(scope, lexicalGlobalObject, callbackValue, "callback"_s);
        RETURN_IF_EXCEPTION(scope, {});
    }

    std::optional<DhJobCtx> ctx = DhJobCtx::fromJS(lexicalGlobalObject, scope, options);
    EXCEPTION_ASSERT(ctx.has_value() == !scope.exception());
    RETURN_IF_EXCEPTION(scope, {});

    if (!callbackValue.isUndefined()) {
        DhJob::createAndSchedule(lexicalGlobalObject, WTF::move(*ctx), callbackValue);
        return JSValue::encode(jsUndefined());
    }

    ctx->runTask(lexicalGlobalObject);

    if (!ctx->m_result) {
        JSValue err = ctx->deriveError(lexicalGlobalObject, scope);
        RETURN_IF_EXCEPTION(scope, {});
        throwException(lexicalGlobalObject, scope, err);
        return {};
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(WebCore::createBuffer(lexicalGlobalObject, ctx->m_result.span())));
}

} // namespace Bun
