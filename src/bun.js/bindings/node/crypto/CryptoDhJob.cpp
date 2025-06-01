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
    auto dp = DHPointer::stateless(m_privateKey->asymmetricKey, m_publicKey->asymmetricKey);
    if (!dp) {
        return;
    }

    WTF::Vector<uint8_t> result;
    if (!result.tryGrow(dp.size())) {
        return;
    }

    m_result = ByteSource::allocated(dp.release());
}

extern "C" void Bun__DhJobCtx__runFromJS(DhJobCtx* ctx, JSGlobalObject* globalObject, EncodedJSValue callback)
{
    ctx->runFromJS(globalObject, JSValue::decode(callback));
}
void DhJobCtx::runFromJS(JSGlobalObject* lexicalGlobalObject, JSValue callback)
{
    VM& vm = lexicalGlobalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);

    if (!m_result) {
        JSObject* err = createError(lexicalGlobalObject, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "diffieHellman failed"_s);
        Bun__EventLoop__runCallback1(lexicalGlobalObject, JSValue::encode(callback), JSValue::encode(jsUndefined()), JSValue::encode(err));
        return;
    }

    JSValue result = WebCore::createBuffer(lexicalGlobalObject, m_result.span());

    Bun__EventLoop__runCallback2(
        lexicalGlobalObject,
        JSValue::encode(callback),
        JSValue::encode(jsUndefined()),
        JSValue::encode(jsNull()),
        JSValue::encode(result));
}

extern "C" DhJob* Bun__DhJob__create(JSGlobalObject* globalObject, DhJobCtx* ctx, EncodedJSValue callback);
DhJob* DhJob::create(JSGlobalObject* globalObject, DhJobCtx&& ctx, JSValue callback)
{
    DhJobCtx* ctxCopy = new DhJobCtx(WTFMove(ctx));
    return Bun__DhJob__create(globalObject, ctxCopy, JSValue::encode(callback));
}

extern "C" void Bun__DhJob__schedule(DhJob* job);
void DhJob::schedule()
{
    Bun__DhJob__schedule(this);
}

extern "C" void Bun__DhJob__createAndSchedule(JSGlobalObject* globalObject, DhJobCtx* ctx, EncodedJSValue callback);
void DhJob::createAndSchedule(JSGlobalObject* globalObject, DhJobCtx&& ctx, JSValue callback)
{
    DhJobCtx* ctxCopy = new DhJobCtx(WTFMove(ctx));
    Bun__DhJob__createAndSchedule(globalObject, ctxCopy, JSValue::encode(callback));
}

std::optional<DhJobCtx> DhJobCtx::fromJS(JSGlobalObject* globalObject, ThrowScope& scope, JSC::JSObject* options)
{
    VM& vm = globalObject->vm();

    JSValue privateKeyValue = options->get(globalObject, Identifier::fromString(vm, "privateKey"_s));
    RETURN_IF_EXCEPTION(scope, std::nullopt);
    JSValue publicKeyValue = options->get(globalObject, Identifier::fromString(vm, "publicKey"_s));
    RETURN_IF_EXCEPTION(scope, std::nullopt);

    JSKeyObject* privateKeyObject = jsDynamicCast<JSKeyObject*>(privateKeyValue);
    if (!privateKeyObject) {
        ERR::INVALID_ARG_VALUE(scope, globalObject, "options.privateKey"_s, privateKeyValue);
        return std::nullopt;
    }

    JSKeyObject* publicKeyObject = jsDynamicCast<JSKeyObject*>(publicKeyValue);
    if (!publicKeyObject) {
        ERR::INVALID_ARG_VALUE(scope, globalObject, "options.publicKey"_s, publicKeyValue);
        return std::nullopt;
    }

    const KeyObject& privateKey = privateKeyObject->handle();
    const KeyObject& publicKey = publicKeyObject->handle();

    if (privateKey.type() != CryptoKeyType::Private) {
        ERR::CRYPTO_INVALID_KEY_OBJECT_TYPE(scope, globalObject, privateKey.type(), "private"_s);
        return std::nullopt;
    }

    if (publicKey.type() != CryptoKeyType::Public && publicKey.type() != CryptoKeyType::Private) {
        ERR::CRYPTO_INVALID_KEY_OBJECT_TYPE(scope, globalObject, publicKey.type(), "public or private"_s);
        return std::nullopt;
    }

    static constexpr auto supportedKeyTypes = std::to_array<int>({ EVP_PKEY_DH,
        EVP_PKEY_EC,
        EVP_PKEY_X448,
        EVP_PKEY_X25519 });

    int privateKeyType = privateKey.asymmetricKey().id();
    int publicKeyType = publicKey.asymmetricKey().id();

    if (privateKeyType != publicKeyType || std::ranges::find(supportedKeyTypes, privateKeyType) == supportedKeyTypes.end()) {
        ERR::INVALID_ARG_VALUE(scope, globalObject, "options.privateKey"_s, privateKeyValue, "must be a supported key type"_s);
        return std::nullopt;
    }

    return DhJobCtx(privateKey.data(), publicKey.data());
}

JSC_DEFINE_HOST_FUNCTION(jsDiffieHellman, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    VM& vm = lexicalGlobalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);

    JSValue optionsValue = callFrame->argument(0);
    V::validateObject(scope, lexicalGlobalObject, optionsValue, "options"_s);
    RETURN_IF_EXCEPTION(scope, JSValue::encode({}));
    JSObject* options = optionsValue.getObject();

    JSValue callbackValue = callFrame->argument(1);
    if (!callbackValue.isUndefined()) {
        V::validateFunction(scope, lexicalGlobalObject, callbackValue, "callback"_s);
        RETURN_IF_EXCEPTION(scope, JSValue::encode({}));
    }

    std::optional<DhJobCtx> ctx = DhJobCtx::fromJS(lexicalGlobalObject, scope, options);
    ASSERT(ctx.has_value() == !scope.exception());
    RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

    if (!callbackValue.isUndefined()) {
        DhJob::createAndSchedule(lexicalGlobalObject, WTFMove(*ctx), callbackValue);
        return JSValue::encode(jsUndefined());
    }

    ctx->runTask(lexicalGlobalObject);

    if (!ctx->m_result) {
        return ERR::CRYPTO_OPERATION_FAILED(scope, lexicalGlobalObject, "diffieHellman operation failed"_s);
    }

    return JSValue::encode(WebCore::createBuffer(lexicalGlobalObject, ctx->m_result.span()));
}

} // namespace Bun
