#include "CryptoGenRsaKeyPair.h"
#include "ErrorCode.h"
#include "NodeValidator.h"
#include "CryptoUtil.h"
#include "BunProcess.h"

using namespace Bun;
using namespace JSC;

extern "C" void Bun__RsaKeyPairJobCtx__deinit(RsaKeyPairJobCtx* ctx)
{
    ctx->deinit();
}

void RsaKeyPairJobCtx::deinit()
{
    delete this;
}

extern "C" void Bun__RsaKeyPairJobCtx__runTask(RsaKeyPairJobCtx* ctx, JSGlobalObject* globalObject)
{
    ncrypto::EVPKeyCtxPointer keyCtx = ctx->setup();
    if (!keyCtx) {
        return;
    }
    ctx->runTask(globalObject, keyCtx);
}

extern "C" void Bun__RsaKeyPairJobCtx__runFromJS(RsaKeyPairJobCtx* ctx, JSGlobalObject* globalObject, EncodedJSValue callback)
{
    ctx->runFromJS(globalObject, JSValue::decode(callback));
}

extern "C" RsaKeyPairJob* Bun__RsaKeyPairJob__create(JSGlobalObject* globalObject, RsaKeyPairJobCtx* ctx, EncodedJSValue callback);
RsaKeyPairJob* RsaKeyPairJob::create(JSGlobalObject* globalObject, RsaKeyPairJobCtx&& ctx, JSValue callback)
{
    RsaKeyPairJobCtx* ctxCopy = new RsaKeyPairJobCtx(WTF::move(ctx));
    return Bun__RsaKeyPairJob__create(globalObject, ctxCopy, JSValue::encode(callback));
}

extern "C" void Bun__RsaKeyPairJob__schedule(RsaKeyPairJob* job);
void RsaKeyPairJob::schedule()
{
    Bun__RsaKeyPairJob__schedule(this);
}

extern "C" void Bun__RsaKeyPairJob__createAndSchedule(JSGlobalObject* globalObject, RsaKeyPairJobCtx* ctx, EncodedJSValue callback);
void RsaKeyPairJob::createAndSchedule(JSGlobalObject* globalObject, RsaKeyPairJobCtx&& ctx, JSValue callback)
{
    RsaKeyPairJobCtx* ctxCopy = new RsaKeyPairJobCtx(WTF::move(ctx));
    Bun__RsaKeyPairJob__createAndSchedule(globalObject, ctxCopy, JSValue::encode(callback));
}

ncrypto::EVPKeyCtxPointer RsaKeyPairJobCtx::setup()
{
    ncrypto::EVPKeyCtxPointer ctx = ncrypto::EVPKeyCtxPointer::NewFromID(m_variant == RsaKeyVariant::RSA_PSS ? EVP_PKEY_RSA_PSS : EVP_PKEY_RSA);
    if (!ctx || !ctx.initForKeygen() || !ctx.setRsaKeygenBits(m_modulusLength)) {
        m_opensslError = ERR_get_error();
        return {};
    }

    if (m_exponent != ncrypto::EVPKeyCtxPointer::kDefaultRsaExponent) {
        auto bn = ncrypto::BignumPointer::New();
        if (!bn.setWord(m_exponent) || !ctx.setRsaKeygenPubExp(WTF::move(bn))) {
            m_opensslError = ERR_get_error();
            return {};
        }
    }

    if (m_variant == RsaKeyVariant::RSA_PSS) {
        if (m_md && !ctx.setRsaPssKeygenMd(m_md)) {
            m_opensslError = ERR_get_error();
            return {};
        }

        auto& mgf1Md = m_mgfMd;
        if (!mgf1Md && m_md) {
            mgf1Md = m_md;
        }

        if (mgf1Md && !ctx.setRsaPssKeygenMgf1Md(mgf1Md)) {
            m_opensslError = ERR_get_error();
            return {};
        }

        int saltLength = m_saltLength;
        if (saltLength < 0 && m_md) {
            saltLength = m_md.size();
        }

        if (saltLength >= 0 && !ctx.setRsaPssSaltlen(saltLength)) {
            m_opensslError = ERR_get_error();
            return {};
        }
    }

    return ctx;
}

std::optional<RsaKeyPairJobCtx> RsaKeyPairJobCtx::fromJS(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, const JSC::GCOwnedDataScope<WTF::StringView>& typeView, JSC::JSValue optionsValue, const KeyEncodingConfig& encodingConfig)
{
    VM& vm = globalObject->vm();

    V::validateObject(scope, globalObject, optionsValue, "options"_s);
    RETURN_IF_EXCEPTION(scope, std::nullopt);

    JSValue modulusLengthValue = optionsValue.get(globalObject, Identifier::fromString(vm, "modulusLength"_s));
    RETURN_IF_EXCEPTION(scope, std::nullopt);
    uint32_t modulusLength;
    V::validateUint32(scope, globalObject, modulusLengthValue, "options.modulusLength"_s, jsUndefined(), &modulusLength);
    RETURN_IF_EXCEPTION(scope, std::nullopt);

    JSValue publicExponentValue = optionsValue.get(globalObject, Identifier::fromString(vm, "publicExponent"_s));
    RETURN_IF_EXCEPTION(scope, std::nullopt);
    uint32_t publicExponent = 0x10001;
    if (!publicExponentValue.isUndefinedOrNull()) {
        V::validateUint32(scope, globalObject, publicExponentValue, "options.publicExponent"_s, jsUndefined(), &publicExponent);
        RETURN_IF_EXCEPTION(scope, std::nullopt);
    }

    if (typeView == "rsa"_s) {
        return RsaKeyPairJobCtx(
            RsaKeyVariant::RSA_SSA_PKCS1_v1_5,
            modulusLength,
            publicExponent,
            encodingConfig);
    }

    JSValue hashValue = optionsValue.get(globalObject, Identifier::fromString(vm, "hash"_s));
    RETURN_IF_EXCEPTION(scope, std::nullopt);
    JSValue mgf1HashValue = optionsValue.get(globalObject, Identifier::fromString(vm, "mgf1Hash"_s));
    RETURN_IF_EXCEPTION(scope, std::nullopt);
    JSValue hashAlgorithmValue = optionsValue.get(globalObject, Identifier::fromString(vm, "hashAlgorithm"_s));
    RETURN_IF_EXCEPTION(scope, std::nullopt);
    JSValue mgf1HashAlgorithmValue = optionsValue.get(globalObject, Identifier::fromString(vm, "mgf1HashAlgorithm"_s));
    RETURN_IF_EXCEPTION(scope, std::nullopt);
    JSValue saltLengthValue = optionsValue.get(globalObject, Identifier::fromString(vm, "saltLength"_s));
    RETURN_IF_EXCEPTION(scope, std::nullopt);

    JSString* hashString = nullptr;
    GCOwnedDataScope<WTF::StringView> hashView(hashString, WTF::nullStringView());
    JSString* hashAlgorithmString = nullptr;
    GCOwnedDataScope<WTF::StringView> hashAlgorithmView(hashAlgorithmString, WTF::nullStringView());
    JSString* mgf1HashString = nullptr;
    GCOwnedDataScope<WTF::StringView> mgf1HashView(mgf1HashString, WTF::nullStringView());
    JSString* mgf1HashAlgorithmString = nullptr;
    GCOwnedDataScope<WTF::StringView> mgf1HashAlgorithmView(mgf1HashAlgorithmString, WTF::nullStringView());
    std::optional<int32_t> saltLength = std::nullopt;

    if (!saltLengthValue.isUndefined()) {
        int32_t length;
        V::validateInt32(scope, globalObject, saltLengthValue, "options.saltLength"_s, jsNumber(0), jsUndefined(), &length);
        RETURN_IF_EXCEPTION(scope, std::nullopt);
        saltLength = length;
    }
    if (!hashAlgorithmValue.isUndefined()) {
        V::validateString(scope, globalObject, hashAlgorithmValue, "options.hashAlgorithm"_s);
        RETURN_IF_EXCEPTION(scope, std::nullopt);
        hashString = hashAlgorithmValue.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, std::nullopt);
        hashView = hashString->view(globalObject);
        RETURN_IF_EXCEPTION(scope, std::nullopt);
    }
    if (!mgf1HashAlgorithmValue.isUndefined()) {
        V::validateString(scope, globalObject, mgf1HashAlgorithmValue, "options.mgf1HashAlgorithm"_s);
        RETURN_IF_EXCEPTION(scope, std::nullopt);
        mgf1HashAlgorithmString = mgf1HashAlgorithmValue.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, std::nullopt);
        mgf1HashView = mgf1HashAlgorithmString->view(globalObject);
        RETURN_IF_EXCEPTION(scope, std::nullopt);
    }
    if (!hashValue.isUndefined()) {
        Bun::Process::emitWarning(globalObject, jsString(vm, makeString("\"options.hash\" is deprecated, use \"options.hashAlgorithm\" instead."_s)), jsString(vm, makeString("DeprecationWarning"_s)), jsString(vm, makeString("DEP0154"_s)), jsUndefined());
        CLEAR_IF_EXCEPTION(scope);
        V::validateString(scope, globalObject, hashValue, "options.hash"_s);
        RETURN_IF_EXCEPTION(scope, std::nullopt);
        hashString = hashValue.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, std::nullopt);
        hashView = hashString->view(globalObject);
        RETURN_IF_EXCEPTION(scope, std::nullopt);
        if (!hashAlgorithmView->isNull() && hashAlgorithmView != hashView) {
            ERR::INVALID_ARG_VALUE(scope, globalObject, "options.hash"_s, hashValue);
            return std::nullopt;
        }
    }
    if (!mgf1HashValue.isUndefined()) {
        Bun::Process::emitWarning(globalObject, jsString(vm, makeString("\"options.mgf1Hash\" is deprecated, use \"options.mgf1HashAlgorithm\" instead."_s)), jsString(vm, makeString("DeprecationWarning"_s)), jsString(vm, makeString("DEP0154"_s)), jsUndefined());
        CLEAR_IF_EXCEPTION(scope);
        V::validateString(scope, globalObject, mgf1HashValue, "options.mgf1Hash"_s);
        RETURN_IF_EXCEPTION(scope, std::nullopt);
        mgf1HashString = mgf1HashValue.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, std::nullopt);
        mgf1HashView = mgf1HashString->view(globalObject);
        RETURN_IF_EXCEPTION(scope, std::nullopt);
        if (!mgf1HashAlgorithmView->isNull() && mgf1HashAlgorithmView != mgf1HashView) {
            ERR::INVALID_ARG_VALUE(scope, globalObject, "options.mgf1Hash"_s, mgf1HashValue);
            return std::nullopt;
        }
    }

    GCOwnedDataScope<WTF::StringView> hash = hashAlgorithmView->isNull() ? hashView : hashAlgorithmView;
    GCOwnedDataScope<WTF::StringView> mgf1Hash = mgf1HashAlgorithmView->isNull() ? mgf1HashView : mgf1HashAlgorithmView;

    ncrypto::Digest md = nullptr;
    ncrypto::Digest mgf1Md = nullptr;

    if (!hash->isNull()) {
        md = ncrypto::Digest::FromName(hash);
        if (!md) {
            ERR::CRYPTO_INVALID_DIGEST(scope, globalObject, hash);
            return std::nullopt;
        }
    }

    if (!mgf1Hash->isNull()) {
        mgf1Md = ncrypto::Digest::FromName(mgf1Hash);
        if (!mgf1Md) {
            ERR::CRYPTO_INVALID_DIGEST(scope, globalObject, "Invalid MGF1 digest: ", mgf1Hash);
            return std::nullopt;
        }
    }

    if (saltLength && *saltLength < 0) {
        ERR::OUT_OF_RANGE(scope, globalObject, "salt length is out of range"_s);
        return std::nullopt;
    }

    return RsaKeyPairJobCtx(
        RsaKeyVariant::RSA_PSS,
        modulusLength,
        publicExponent,
        saltLength,
        md,
        mgf1Md,
        encodingConfig);
}
