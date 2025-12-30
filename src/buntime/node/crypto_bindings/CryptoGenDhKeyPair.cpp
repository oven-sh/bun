#include "CryptoGenDhKeyPair.h"
#include "ErrorCode.h"
#include "NodeValidator.h"
#include "CryptoUtil.h"

using namespace Bun;
using namespace JSC;

extern "C" void Bun__DhKeyPairJobCtx__deinit(DhKeyPairJobCtx* ctx)
{
    ctx->deinit();
}

void DhKeyPairJobCtx::deinit()
{
    delete this;
}

extern "C" void Bun__DhKeyPairJobCtx__runTask(DhKeyPairJobCtx* ctx, JSGlobalObject* globalObject)
{
    ncrypto::EVPKeyCtxPointer keyCtx = ctx->setup();
    if (!keyCtx) {
        return;
    }
    ctx->runTask(globalObject, keyCtx);
}

extern "C" void Bun__DhKeyPairJobCtx__runFromJS(DhKeyPairJobCtx* ctx, JSGlobalObject* globalObject, EncodedJSValue callback)
{
    ctx->runFromJS(globalObject, JSValue::decode(callback));
}

extern "C" DhKeyPairJob* Bun__DhKeyPairJob__create(JSGlobalObject* globalObject, DhKeyPairJobCtx* ctx, EncodedJSValue callback);
DhKeyPairJob* DhKeyPairJob::create(JSGlobalObject* globalObject, DhKeyPairJobCtx&& ctx, JSValue callback)
{
    DhKeyPairJobCtx* ctxCopy = new DhKeyPairJobCtx(WTF::move(ctx));
    return Bun__DhKeyPairJob__create(globalObject, ctxCopy, JSValue::encode(callback));
}

extern "C" void Bun__DhKeyPairJob__schedule(DhKeyPairJob* job);
void DhKeyPairJob::schedule()
{
    Bun__DhKeyPairJob__schedule(this);
}

extern "C" void Bun__DhKeyPairJob__createAndSchedule(JSGlobalObject* globalObject, DhKeyPairJobCtx* ctx, EncodedJSValue callback);
void DhKeyPairJob::createAndSchedule(JSGlobalObject* globalObject, DhKeyPairJobCtx&& ctx, JSValue callback)
{
    DhKeyPairJobCtx* ctxCopy = new DhKeyPairJobCtx(WTF::move(ctx));
    Bun__DhKeyPairJob__createAndSchedule(globalObject, ctxCopy, JSValue::encode(callback));
}

ncrypto::EVPKeyCtxPointer DhKeyPairJobCtx::setup()
{
    ncrypto::EVPKeyPointer keyParams;

    if (ncrypto::BignumPointer* primeFixedValue = std::get_if<ncrypto::BignumPointer>(&m_prime)) {
        auto prime = primeFixedValue->clone();
        auto bnG = ncrypto::BignumPointer::New();
        if (!prime || !bnG || !bnG.setWord(m_generator)) {
            m_opensslError = ERR_get_error();
            return {};
        }
        auto dh = ncrypto::DHPointer::New(WTF::move(prime), WTF::move(bnG));
        if (!dh) {
            m_opensslError = ERR_get_error();
            return {};
        }

        keyParams = ncrypto::EVPKeyPointer::NewDH(WTF::move(dh));
    } else if (std::get_if<int>(&m_prime)) {
        auto paramCtx = ncrypto::EVPKeyCtxPointer::NewFromID(EVP_PKEY_DH);

        int* primeLength = std::get_if<int>(&m_prime);
        if (!paramCtx.initForParamgen() || !paramCtx.setDhParameters(*primeLength, m_generator)) {
            m_opensslError = ERR_get_error();
            return {};
        }

        keyParams = paramCtx.paramgen();
    }

    if (!keyParams) {
        m_opensslError = ERR_get_error();
        return {};
    }

    ncrypto::EVPKeyCtxPointer ctx = keyParams.newCtx();
    if (!ctx.initForKeygen()) {
        m_opensslError = ERR_get_error();
        return {};
    }

    return ctx;
}

std::optional<DhKeyPairJobCtx> DhKeyPairJobCtx::fromJS(JSGlobalObject* globalObject, ThrowScope& scope, const GCOwnedDataScope<WTF::StringView>& typeView, JSValue optionsValue, const KeyEncodingConfig& config)
{
    VM& vm = globalObject->vm();

    V::validateObject(scope, globalObject, optionsValue, "options"_s);
    RETURN_IF_EXCEPTION(scope, std::nullopt);

    JSValue groupValue = optionsValue.get(globalObject, Identifier::fromString(vm, "group"_s));
    RETURN_IF_EXCEPTION(scope, std::nullopt);
    JSValue primeLengthValue = optionsValue.get(globalObject, Identifier::fromString(vm, "primeLength"_s));
    RETURN_IF_EXCEPTION(scope, std::nullopt);
    JSValue primeValue = optionsValue.get(globalObject, Identifier::fromString(vm, "prime"_s));
    RETURN_IF_EXCEPTION(scope, std::nullopt);
    JSValue generatorValue = optionsValue.get(globalObject, Identifier::fromString(vm, "generator"_s));
    RETURN_IF_EXCEPTION(scope, std::nullopt);

    if (!groupValue.isUndefinedOrNull()) {
        if (!primeValue.isUndefinedOrNull()) {
            ERR::INCOMPATIBLE_OPTION_PAIR(scope, globalObject, "group"_s, "prime"_s);
            return std::nullopt;
        }
        if (!primeLengthValue.isUndefinedOrNull()) {
            ERR::INCOMPATIBLE_OPTION_PAIR(scope, globalObject, "group"_s, "primeLength"_s);
            return std::nullopt;
        }
        if (!generatorValue.isUndefinedOrNull()) {
            ERR::INCOMPATIBLE_OPTION_PAIR(scope, globalObject, "group"_s, "generator"_s);
            return std::nullopt;
        }

        V::validateString(scope, globalObject, groupValue, "options.group"_s);
        RETURN_IF_EXCEPTION(scope, std::nullopt);

        JSString* groupString = groupValue.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, std::nullopt);
        GCOwnedDataScope<WTF::StringView> groupView = groupString->view(globalObject);
        RETURN_IF_EXCEPTION(scope, std::nullopt);

        auto group = ncrypto::DHPointer::FromGroup(groupView);
        if (!group) {
            ERR::CRYPTO_UNKNOWN_DH_GROUP(scope, globalObject);
            return std::nullopt;
        }

        return DhKeyPairJobCtx(
            WTF::move(group),
            config);
    }

    std::optional<int32_t> primeLength = std::nullopt;
    ncrypto::BignumPointer prime;
    int32_t generator = 2;

    if (!primeValue.isUndefinedOrNull()) {
        if (!primeLengthValue.isUndefinedOrNull()) {
            ERR::INCOMPATIBLE_OPTION_PAIR(scope, globalObject, "prime"_s, "primeLength"_s);
            return std::nullopt;
        }

        if (JSArrayBufferView* view = jsDynamicCast<JSArrayBufferView*>(primeValue)) {
            prime = ncrypto::BignumPointer(reinterpret_cast<const uint8_t*>(view->vector()), view->byteLength());
            if (!prime) [[unlikely]] {
                ERR::OUT_OF_RANGE(scope, globalObject, "prime is too big"_s);
                return std::nullopt;
            }

            // TODO: delete this case? validateBuffer allows Buffer, TypeArray, and DataView
        } else if (JSArrayBuffer* buffer = jsDynamicCast<JSArrayBuffer*>(primeValue)) {
            auto impl = buffer->impl();
            prime = ncrypto::BignumPointer(reinterpret_cast<const uint8_t*>(impl->data()), impl->byteLength());
            if (!prime) [[unlikely]] {
                ERR::OUT_OF_RANGE(scope, globalObject, "prime is too big"_s);
                return std::nullopt;
            }
        } else {
            ERR::INVALID_ARG_TYPE(scope, globalObject, "options.prime"_s, "Buffer, TypedArray, or DataView"_s, primeValue);
            return std::nullopt;
        }
    } else if (!primeLengthValue.isUndefinedOrNull()) {
        int32_t length;
        V::validateInt32(scope, globalObject, primeLengthValue, "options.primeLength"_s, jsNumber(0), jsUndefined(), &length);
        RETURN_IF_EXCEPTION(scope, std::nullopt);
        primeLength = length;
    } else {
        ERR::MISSING_OPTION(scope, globalObject, "At least one of the group, prime, or primeLength options"_s);
        return std::nullopt;
    }

    if (!generatorValue.isUndefinedOrNull()) {
        V::validateInt32(scope, globalObject, generatorValue, "options.generator"_s, jsNumber(0), jsUndefined(), &generator);
        RETURN_IF_EXCEPTION(scope, std::nullopt);
    }

    if (primeLength) {
        return DhKeyPairJobCtx(
            *primeLength,
            generator,
            config);
    }

    return DhKeyPairJobCtx(
        prime,
        generator,
        config);
}
