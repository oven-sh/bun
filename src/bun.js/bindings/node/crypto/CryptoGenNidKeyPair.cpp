#include "CryptoGenNidKeyPair.h"
#include "CryptoUtil.h"
#include "NodeValidator.h"
#include "ErrorCode.h"

using namespace Bun;
using namespace JSC;

extern "C" void Bun__NidKeyPairJobCtx__deinit(NidKeyPairJobCtx* ctx)
{
    ctx->deinit();
}

void NidKeyPairJobCtx::deinit()
{
    delete this;
}

extern "C" void Bun__NidKeyPairJobCtx__runTask(NidKeyPairJobCtx* ctx, JSGlobalObject* globalObject)
{
    ncrypto::EVPKeyCtxPointer keyCtx = ctx->setup();
    if (!keyCtx) {
        return;
    }
    ctx->runTask(globalObject, keyCtx);
}

extern "C" void Bun__NidKeyPairJobCtx__runFromJS(NidKeyPairJobCtx* ctx, JSGlobalObject* globalObject, EncodedJSValue callback)
{
    ctx->runFromJS(globalObject, JSValue::decode(callback));
}

extern "C" NidKeyPairJob* Bun__NidKeyPairJob__create(JSGlobalObject* globalObject, NidKeyPairJobCtx* ctx, EncodedJSValue callback);
NidKeyPairJob* NidKeyPairJob::create(JSGlobalObject* globalObject, NidKeyPairJobCtx&& ctx, JSValue callback)
{
    NidKeyPairJobCtx* ctxCopy = new NidKeyPairJobCtx(WTFMove(ctx));
    return Bun__NidKeyPairJob__create(globalObject, ctxCopy, JSValue::encode(callback));
}

extern "C" void Bun__NidKeyPairJob__schedule(NidKeyPairJob* job);
void NidKeyPairJob::schedule()
{
    Bun__NidKeyPairJob__schedule(this);
}

extern "C" void Bun__NidKeyPairJob__createAndSchedule(JSGlobalObject* globalObject, NidKeyPairJobCtx* ctx, EncodedJSValue callback);
void NidKeyPairJob::createAndSchedule(JSGlobalObject* globalObject, NidKeyPairJobCtx&& ctx, JSValue callback)
{
    NidKeyPairJobCtx* ctxCopy = new NidKeyPairJobCtx(WTFMove(ctx));
    Bun__NidKeyPairJob__createAndSchedule(globalObject, ctxCopy, JSValue::encode(callback));
}

ncrypto::EVPKeyCtxPointer NidKeyPairJobCtx::setup()
{
    ncrypto::EVPKeyCtxPointer ctx = ncrypto::EVPKeyCtxPointer::NewFromID(m_id);
    if (!ctx.initForKeygen()) {
        m_opensslError = ERR_get_error();
        return {};
    }
    return ctx;
}

std::optional<NidKeyPairJobCtx> NidKeyPairJobCtx::fromJS(JSGlobalObject* globalObject, ThrowScope& scope, const GCOwnedDataScope<WTF::StringView>& typeView, JSValue optionsValue, const KeyEncodingConfig& config)
{
    int id;
    if (typeView == "ed25519"_s) {
        id = EVP_PKEY_ED25519;
    } else if (typeView == "ed448"_s) {
        id = EVP_PKEY_ED448;
    } else if (typeView == "x25519"_s) {
        id = EVP_PKEY_X25519;
    } else if (typeView == "x448"_s) {
        id = EVP_PKEY_X448;
    } else {
        UNREACHABLE();
    }

    return NidKeyPairJobCtx(
        id,
        config);
}
