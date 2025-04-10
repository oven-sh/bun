#include "CryptoKeygen.h"
#include "JSSecretKeyObject.h"
#include "CryptoUtil.h"
#include "helpers.h"
#include "NodeValidator.h"

using namespace Bun;
using namespace JSC;
using namespace WebCore;

SecretKeyJobCtx::SecretKeyJobCtx(size_t length)
    : m_length(length)
{
}

extern "C" void Bun__SecretKeyJobCtx__runTask(SecretKeyJobCtx* ctx, JSGlobalObject* lexicalGlobalObject)
{
    ctx->runTask(lexicalGlobalObject);
}
void SecretKeyJobCtx::runTask(JSGlobalObject* lexicalGlobalObject)
{
    Vector<uint8_t> key;
    key.grow(m_length);

    std::ignore = ncrypto::CSPRNG(key.data(), key.size());

    m_result = WTFMove(key);
}

extern "C" void Bun__SecretKeyJobCtx__runFromJS(SecretKeyJobCtx* ctx, JSGlobalObject* lexicalGlobalObject, JSC::JSValue callback)
{
    ctx->runFromJS(lexicalGlobalObject, callback);
}
void SecretKeyJobCtx::runFromJS(JSGlobalObject* lexicalGlobalObject, JSC::JSValue callback)
{
    VM& vm = lexicalGlobalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    if (!m_result) {
        JSObject* err = createError(lexicalGlobalObject, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "key generation failed"_s);
        Bun__EventLoop__runCallback1(lexicalGlobalObject, JSValue::encode(callback), JSValue::encode(jsUndefined()), JSValue::encode(err));
        return;
    }

    Structure* structure = globalObject->m_JSSecretKeyObjectClassStructure.get(lexicalGlobalObject);
    JSSecretKeyObject* secretKey = JSSecretKeyObject::create(vm, structure, lexicalGlobalObject, KeyObject::Type::Secret, WTFMove(*m_result));

    Bun__EventLoop__runCallback2(lexicalGlobalObject,
        JSValue::encode(callback),
        JSValue::encode(jsUndefined()),
        JSValue::encode(jsNull()),
        JSValue::encode(secretKey));
}

extern "C" void Bun__SecretKeyJobCtx__deinit(SecretKeyJobCtx* ctx)
{
    ctx->deinit();
}
void SecretKeyJobCtx::deinit()
{
    delete this;
}

extern "C" SecretKeyJob* Bun__SecretKeyJob__create(JSC::JSGlobalObject*, SecretKeyJobCtx*, EncodedJSValue callback);
SecretKeyJob* SecretKeyJob::create(JSC::JSGlobalObject* lexicalGlobalObject, size_t length, JSC::JSValue callback)
{
    SecretKeyJobCtx* ctx = new SecretKeyJobCtx(length);
    return Bun__SecretKeyJob__create(lexicalGlobalObject, ctx, JSValue::encode(callback));
}

extern "C" void Bun__SecretKeyJob__schedule(SecretKeyJob* job);
void SecretKeyJob::schedule()
{
    Bun__SecretKeyJob__schedule(this);
}

extern "C" void Bun__SecretKeyJob__createAndSchedule(JSC::JSGlobalObject*, SecretKeyJobCtx*, EncodedJSValue callback);
void SecretKeyJob::createAndSchedule(JSC::JSGlobalObject* lexicalGlobalObject, SecretKeyJobCtx&& ctx, JSC::JSValue callback)
{
    SecretKeyJobCtx* ctxCopy = new SecretKeyJobCtx(WTFMove(ctx));
    return Bun__SecretKeyJob__createAndSchedule(lexicalGlobalObject, ctxCopy, JSValue::encode(callback));
}

std::optional<SecretKeyJobCtx> SecretKeyJobCtx::fromJS(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSValue typeValue, JSC::JSValue optionsValue)
{
    V::validateString(scope, globalObject, typeValue, "type"_s);
    RETURN_IF_EXCEPTION(scope, std::nullopt);

    V::validateObject(scope, globalObject, optionsValue, "options"_s);
    RETURN_IF_EXCEPTION(scope, std::nullopt);

    JSString* typeString = typeValue.toString(globalObject);
    RETURN_IF_EXCEPTION(scope, std::nullopt);
    GCOwnedDataScope<WTF::StringView> typeView = typeString->view(globalObject);
    RETURN_IF_EXCEPTION(scope, std::nullopt);

    if (typeView == "hmac"_s) {
        int32_t length;
        V::validateInteger(scope, globalObject, optionsValue, "options.length"_s, jsNumber(8), jsNumber(std::numeric_limits<int32_t>::max()), &length);
        RETURN_IF_EXCEPTION(scope, std::nullopt);
        return SecretKeyJobCtx(length);
    }

    if (typeView == "aes"_s) {
        int32_t length;
        V::validateOneOf(scope, globalObject, "options.length"_s, optionsValue, { 128, 192, 256 }, &length);
        RETURN_IF_EXCEPTION(scope, std::nullopt);
        return SecretKeyJobCtx(length);
    }

    ERR::INVALID_ARG_VALUE(scope, globalObject, "type"_s, typeValue, "must be a supported key type"_s);
    return std::nullopt;
}

JSC_DEFINE_HOST_FUNCTION(jsCreatePublicKey, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    VM& vm = lexicalGlobalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsGenerateKey, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    VM& vm = lexicalGlobalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);

    JSValue typeValue = callFrame->argument(0);
    JSValue optionsValue = callFrame->argument(1);
    JSValue callbackValue = callFrame->argument(2);

    if (optionsValue.isCallable()) {
        callbackValue = optionsValue;
        optionsValue = jsUndefined();
    }

    V::validateFunction(scope, lexicalGlobalObject, callbackValue, "callback"_s);
    RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

    std::optional<SecretKeyJobCtx> ctx = SecretKeyJobCtx::fromJS(lexicalGlobalObject, scope, typeValue, optionsValue);
    ASSERT(ctx.has_value() == !!scope.exception());
    RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

    SecretKeyJob::createAndSchedule(lexicalGlobalObject, WTFMove(ctx.value()), callbackValue);

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsGenerateKeySync, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    VM& vm = lexicalGlobalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);

    JSValue typeValue = callFrame->argument(0);
    JSValue optionsValue = callFrame->argument(1);

    std::optional<SecretKeyJobCtx> ctx = SecretKeyJobCtx::fromJS(lexicalGlobalObject, scope, typeValue, optionsValue);
    ASSERT(ctx.has_value() == !!scope.exception());
    RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

    ctx->runTask(lexicalGlobalObject);

    if (!ctx->m_result) {
        return ERR::CRYPTO_OPERATION_FAILED(scope, lexicalGlobalObject, "key generation failed"_s);
    }

    auto& result = ctx->m_result.value();
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    Structure* structure = globalObject->m_JSSecretKeyObjectClassStructure.get(lexicalGlobalObject);
    JSSecretKeyObject* secretKey = JSSecretKeyObject::create(vm, structure, lexicalGlobalObject, KeyObject::Type::Secret, WTFMove(result));

    return JSValue::encode(secretKey);
}

JSC_DEFINE_HOST_FUNCTION(jsGenerateKeyPair, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    VM& vm = lexicalGlobalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);

    // JSValue typeValue = callFrame->argument(0);
    // JSValue optionsValue = callFrame->argument(1);
    // JSValue callbackValue = callFrame->argument(2);

    // if (optionsValue.isCallable()) {
    //     callbackValue = optionsValue;
    //     optionsValue = jsUndefined();
    // }

    // V::validateFunction(scope, lexicalGlobalObject, callbackValue, "callback"_s);
    // RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsGenerateKeyPairSync, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsCreateSecretKey, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    VM& vm = lexicalGlobalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    JSValue keyValue = callFrame->argument(0);
    JSValue encodingValue = callFrame->argument(1);

    WTF::Vector<uint8_t> symmetricKey;
    prepareSecretKey(lexicalGlobalObject, scope, symmetricKey, keyValue, encodingValue, true);
    RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

    Structure* structure = globalObject->m_JSSecretKeyObjectClassStructure.get(lexicalGlobalObject);
    JSSecretKeyObject* secretKey = JSSecretKeyObject::create(vm, structure, lexicalGlobalObject, KeyObject::Type::Secret, WTFMove(symmetricKey));

    return JSValue::encode(secretKey);
}
