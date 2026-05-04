#include "CryptoGenEcKeyPair.h"
#include "CryptoUtil.h"
#include "NodeValidator.h"
#include "ncrypto.h"

using namespace Bun;
using namespace JSC;

extern "C" void Bun__EcKeyPairJobCtx__deinit(EcKeyPairJobCtx* ctx)
{
    ctx->deinit();
}

void EcKeyPairJobCtx::deinit()
{
    delete this;
}

extern "C" void Bun__EcKeyPairJobCtx__runTask(EcKeyPairJobCtx* ctx, JSGlobalObject* globalObject)
{
    ncrypto::EVPKeyCtxPointer keyCtx = ctx->setup();
    if (!keyCtx) {
        return;
    }
    ctx->runTask(globalObject, keyCtx);
}

extern "C" void Bun__EcKeyPairJobCtx__runFromJS(EcKeyPairJobCtx* ctx, JSGlobalObject* globalObject, EncodedJSValue callback)
{
    ctx->runFromJS(globalObject, JSValue::decode(callback));
}

extern "C" EcKeyPairJob* Bun__EcKeyPairJob__create(JSGlobalObject* globalObject, EcKeyPairJobCtx* ctx, EncodedJSValue callback);
EcKeyPairJob* EcKeyPairJob::create(JSGlobalObject* globalObject, EcKeyPairJobCtx&& ctx, JSValue callback)
{
    EcKeyPairJobCtx* ctxCopy = new EcKeyPairJobCtx(WTF::move(ctx));
    return Bun__EcKeyPairJob__create(globalObject, ctxCopy, JSValue::encode(callback));
}

extern "C" void Bun__EcKeyPairJob__schedule(EcKeyPairJob* job);
void EcKeyPairJob::schedule()
{
    Bun__EcKeyPairJob__schedule(this);
}

extern "C" void Bun__EcKeyPairJob__createAndSchedule(JSGlobalObject* globalObject, EcKeyPairJobCtx* ctx, EncodedJSValue callback);
void EcKeyPairJob::createAndSchedule(JSGlobalObject* globalObject, EcKeyPairJobCtx&& ctx, JSValue callback)
{
    EcKeyPairJobCtx* ctxCopy = new EcKeyPairJobCtx(WTF::move(ctx));
    Bun__EcKeyPairJob__createAndSchedule(globalObject, ctxCopy, JSValue::encode(callback));
}

ncrypto::EVPKeyCtxPointer EcKeyPairJobCtx::setup()
{
    ncrypto::EVPKeyCtxPointer keyCtx;
    switch (m_curveNid) {
    case EVP_PKEY_ED25519:
    case EVP_PKEY_ED448:
    case EVP_PKEY_X25519:
    case EVP_PKEY_X448:
        keyCtx = ncrypto::EVPKeyCtxPointer::NewFromID(m_curveNid);
        break;
    default: {
        auto paramCtx = ncrypto::EVPKeyCtxPointer::NewFromID(EVP_PKEY_EC);
        if (!paramCtx.initForParamgen() || !paramCtx.setEcParameters(m_curveNid, m_paramEncoding)) {
            m_opensslError = ERR_get_error();
            return {};
        }

        auto keyParams = paramCtx.paramgen();
        if (!keyParams) {
            m_opensslError = ERR_get_error();
            return {};
        }

        keyCtx = keyParams.newCtx();
    }
    }

    if (!keyCtx.initForKeygen()) {
        m_opensslError = ERR_get_error();
        return {};
    }

    return keyCtx;
}

std::optional<EcKeyPairJobCtx> EcKeyPairJobCtx::fromJS(JSGlobalObject* globalObject, ThrowScope& scope, const GCOwnedDataScope<WTF::StringView>& typeView, JSValue optionsValue, const KeyEncodingConfig& config)
{
    VM& vm = globalObject->vm();

    V::validateObject(scope, globalObject, optionsValue, "options"_s);
    RETURN_IF_EXCEPTION(scope, std::nullopt);

    JSValue namedCurveValue = optionsValue.get(globalObject, Identifier::fromString(vm, "namedCurve"_s));
    RETURN_IF_EXCEPTION(scope, std::nullopt);
    V::validateString(scope, globalObject, namedCurveValue, "options.namedCurve"_s);
    RETURN_IF_EXCEPTION(scope, std::nullopt);

    JSValue paramEncodingValue = optionsValue.get(globalObject, Identifier::fromString(vm, "paramEncoding"_s));
    RETURN_IF_EXCEPTION(scope, std::nullopt);

    int paramEncoding;

    if (paramEncodingValue.isUndefinedOrNull()) {
        paramEncoding = OPENSSL_EC_NAMED_CURVE;
    } else if (paramEncodingValue.isString()) {
        JSString* paramEncodingString = paramEncodingValue.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, std::nullopt);
        GCOwnedDataScope<WTF::StringView> paramEncodingView = paramEncodingString->view(globalObject);
        RETURN_IF_EXCEPTION(scope, std::nullopt);

        if (paramEncodingView == "named"_s) {
            paramEncoding = OPENSSL_EC_NAMED_CURVE;
        } else if (paramEncodingView == "explicit"_s) {
            paramEncoding = OPENSSL_EC_EXPLICIT_CURVE;
        } else {
            ERR::INVALID_ARG_VALUE(scope, globalObject, "options.paramEncoding"_s, paramEncodingValue);
            return std::nullopt;
        }
    } else {
        ERR::INVALID_ARG_VALUE(scope, globalObject, "options.paramEncoding"_s, paramEncodingValue);
        return std::nullopt;
    }

    JSString* namedCurveString = namedCurveValue.toString(globalObject);
    RETURN_IF_EXCEPTION(scope, std::nullopt);
    GCOwnedDataScope<WTF::StringView> namedCurveView = namedCurveString->view(globalObject);
    RETURN_IF_EXCEPTION(scope, std::nullopt);

    CString curveName = namedCurveView->utf8();

    int curveNid = ncrypto::Ec::GetCurveIdFromName(curveName.data());
    if (curveNid == NID_undef) {
        ERR::CRYPTO_INVALID_CURVE(scope, globalObject);
        return std::nullopt;
    }

    return EcKeyPairJobCtx(
        curveNid,
        paramEncoding,
        config);
}
