#include "CryptoGenDsaKeyPair.h"
#include "CryptoUtil.h"
#include "NodeValidator.h"

using namespace Bun;
using namespace JSC;

extern "C" void Bun__DsaKeyPairJobCtx__deinit(DsaKeyPairJobCtx* ctx)
{
    ctx->deinit();
}

void DsaKeyPairJobCtx::deinit()
{
    delete this;
}

extern "C" void Bun__DsaKeyPairJobCtx__runTask(DsaKeyPairJobCtx* ctx, JSGlobalObject* globalObject)
{
    ncrypto::EVPKeyCtxPointer keyCtx = ctx->setup();
    if (!keyCtx) {
        return;
    }
    ctx->runTask(globalObject, keyCtx);
}

extern "C" void Bun__DsaKeyPairJobCtx__runFromJS(DsaKeyPairJobCtx* ctx, JSGlobalObject* globalObject, EncodedJSValue callback)
{
    ctx->runFromJS(globalObject, JSValue::decode(callback));
}

extern "C" DsaKeyPairJob* Bun__DsaKeyPairJob__create(JSGlobalObject* globalObject, DsaKeyPairJobCtx* ctx, EncodedJSValue callback);
DsaKeyPairJob* DsaKeyPairJob::create(JSGlobalObject* globalObject, DsaKeyPairJobCtx&& ctx, JSValue callback)
{
    DsaKeyPairJobCtx* ctxCopy = new DsaKeyPairJobCtx(WTF::move(ctx));
    return Bun__DsaKeyPairJob__create(globalObject, ctxCopy, JSValue::encode(callback));
}

extern "C" void Bun__DsaKeyPairJob__schedule(DsaKeyPairJob* job);
void DsaKeyPairJob::schedule()
{
    Bun__DsaKeyPairJob__schedule(this);
}

extern "C" void Bun__DsaKeyPairJob__createAndSchedule(JSGlobalObject* globalObject, DsaKeyPairJobCtx* ctx, EncodedJSValue callback);
void DsaKeyPairJob::createAndSchedule(JSGlobalObject* globalObject, DsaKeyPairJobCtx&& ctx, JSValue callback)
{
    DsaKeyPairJobCtx* ctxCopy = new DsaKeyPairJobCtx(WTF::move(ctx));
    Bun__DsaKeyPairJob__createAndSchedule(globalObject, ctxCopy, JSValue::encode(callback));
}

ncrypto::EVPKeyCtxPointer DsaKeyPairJobCtx::setup()
{
    ncrypto::EVPKeyCtxPointer paramCtx = ncrypto::EVPKeyCtxPointer::NewFromID(EVP_PKEY_DSA);

    if (!paramCtx || paramCtx.initForParamgen() || !paramCtx.setDsaParameters(m_modulusLength, m_divisorLength)) {
        m_opensslError = ERR_get_error();
        return {};
    }

    auto keyParams = paramCtx.paramgen();
    if (!keyParams) {
        m_opensslError = ERR_get_error();
        return {};
    }

    ncrypto::EVPKeyCtxPointer keyCtx = keyParams.newCtx();
    if (!keyCtx.initForKeygen()) {
        m_opensslError = ERR_get_error();
        return {};
    }

    return keyCtx;
}

std::optional<DsaKeyPairJobCtx> DsaKeyPairJobCtx::fromJS(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, const JSC::GCOwnedDataScope<WTF::StringView>& typeView, JSC::JSValue optionsValue, const KeyEncodingConfig& config)
{
    VM& vm = globalObject->vm();

    V::validateObject(scope, globalObject, optionsValue, "options"_s);
    RETURN_IF_EXCEPTION(scope, std::nullopt);

    JSValue modulusLengthValue = optionsValue.get(globalObject, Identifier::fromString(vm, "modulusLength"_s));
    RETURN_IF_EXCEPTION(scope, std::nullopt);
    uint32_t modulusLength;
    V::validateUint32(scope, globalObject, modulusLengthValue, "options.modulusLength"_s, jsUndefined(), &modulusLength);
    RETURN_IF_EXCEPTION(scope, std::nullopt);

    JSValue divisorLengthValue = optionsValue.get(globalObject, Identifier::fromString(vm, "divisorLength"_s));
    RETURN_IF_EXCEPTION(scope, std::nullopt);
    std::optional<int32_t> divisorLength = std::nullopt;
    if (!divisorLengthValue.isUndefinedOrNull()) {
        int32_t length;
        V::validateInt32(scope, globalObject, divisorLengthValue, "options.divisorLength"_s, jsNumber(0), jsUndefined(), &length);
        RETURN_IF_EXCEPTION(scope, std::nullopt);
        divisorLength = length;
    }

    return DsaKeyPairJobCtx(
        modulusLength,
        divisorLength,
        config);
}
