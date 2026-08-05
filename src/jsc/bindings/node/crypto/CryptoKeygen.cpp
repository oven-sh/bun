#include "CryptoKeygen.h"
#include "JSSecretKeyObject.h"
#include "CryptoUtil.h"
#include "helpers.h"
#include "NodeValidator.h"

using namespace JSC;
using namespace WebCore;

namespace Bun {

SecretKeyJobCtx::SecretKeyJobCtx(size_t length)
    : m_length(length)
{
}

SecretKeyJobCtx::SecretKeyJobCtx(SecretKeyJobCtx&& other)
    : m_length(other.m_length)
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

    if (!ncrypto::CSPRNG(key.begin(), key.size())) {
        return;
    }

    m_result = WTF::move(key);
}

extern "C" uint32_t Bun__SecretKeyJobCtx__takeCallbackArgs(SecretKeyJobCtx* ctx, JSGlobalObject* lexicalGlobalObject, EncodedJSValue* args)
{
    return ctx->takeCallbackArgs(lexicalGlobalObject, args);
}
uint32_t SecretKeyJobCtx::takeCallbackArgs(JSGlobalObject* lexicalGlobalObject, EncodedJSValue* args)
{
    VM& vm = lexicalGlobalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    if (!m_result) {
        args[0] = JSValue::encode(createError(lexicalGlobalObject, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "key generation failed"_s));
        return 1;
    }

    KeyObject keyObject = KeyObject::create(WTF::move(*m_result));

    Structure* structure = globalObject->m_JSSecretKeyObjectClassStructure.get(lexicalGlobalObject);
    JSSecretKeyObject* secretKey = JSSecretKeyObject::create(vm, structure, lexicalGlobalObject, WTF::move(keyObject));

    args[0] = JSValue::encode(jsNull());
    args[1] = JSValue::encode(secretKey);
    return 2;
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
    SecretKeyJobCtx* ctxCopy = new SecretKeyJobCtx(WTF::move(ctx));
    return Bun__SecretKeyJob__createAndSchedule(lexicalGlobalObject, ctxCopy, JSValue::encode(callback));
}

std::optional<SecretKeyJobCtx> SecretKeyJobCtx::fromJS(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSValue typeValue, JSC::JSValue optionsValue)
{
    VM& vm = globalObject->vm();

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
        JSValue lengthValue = optionsValue.get(globalObject, Identifier::fromString(vm, "length"_s));
        RETURN_IF_EXCEPTION(scope, std::nullopt);
        V::validateInteger(scope, globalObject, lengthValue, "options.length"_s, jsNumber(8), jsNumber(std::numeric_limits<int32_t>::max()), &length);
        RETURN_IF_EXCEPTION(scope, std::nullopt);
        return SecretKeyJobCtx(length / CHAR_BIT);
    }

    if (typeView == "aes"_s) {
        int32_t length;
        JSValue lengthValue = optionsValue.get(globalObject, Identifier::fromString(vm, "length"_s));
        RETURN_IF_EXCEPTION(scope, std::nullopt);
        V::validateOneOf(scope, globalObject, "options.length"_s, lengthValue, std::array { 128, 192, 256 }, &length);
        RETURN_IF_EXCEPTION(scope, std::nullopt);
        return SecretKeyJobCtx(length / CHAR_BIT);
    }

    ERR::INVALID_ARG_VALUE(scope, globalObject, "type"_s, typeValue, "must be a supported key type"_s);
    return std::nullopt;
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
    RETURN_IF_EXCEPTION(scope, {});

    std::optional<SecretKeyJobCtx> ctx = SecretKeyJobCtx::fromJS(lexicalGlobalObject, scope, typeValue, optionsValue);
    EXCEPTION_ASSERT(ctx.has_value() == !scope.exception());
    RETURN_IF_EXCEPTION(scope, {});

    SecretKeyJob::createAndSchedule(lexicalGlobalObject, WTF::move(ctx.value()), callbackValue);

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsGenerateKeySync, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    VM& vm = lexicalGlobalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);

    JSValue typeValue = callFrame->argument(0);
    JSValue optionsValue = callFrame->argument(1);

    std::optional<SecretKeyJobCtx> ctx = SecretKeyJobCtx::fromJS(lexicalGlobalObject, scope, typeValue, optionsValue);
    EXCEPTION_ASSERT(ctx.has_value() == !scope.exception());
    RETURN_IF_EXCEPTION(scope, {});

    ctx->runTask(lexicalGlobalObject);

    if (!ctx->m_result) {
        return ERR::CRYPTO_OPERATION_FAILED(scope, lexicalGlobalObject, "key generation failed"_s);
    }

    auto& result = ctx->m_result.value();
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    KeyObject keyObject = KeyObject::create(WTF::move(result));
    Structure* structure = globalObject->m_JSSecretKeyObjectClassStructure.get(lexicalGlobalObject);
    JSSecretKeyObject* secretKey = JSSecretKeyObject::create(vm, structure, lexicalGlobalObject, WTF::move(keyObject));

    return JSValue::encode(secretKey);
}

} // namespace Bun
