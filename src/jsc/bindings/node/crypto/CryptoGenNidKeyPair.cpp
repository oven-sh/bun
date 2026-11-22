#include "CryptoGenNidKeyPair.h"
#include "CryptoUtil.h"
#include "NodeValidator.h"
#include "ErrorCode.h"

using namespace Bun;
using namespace JSC;

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
    } else if (int pqcNid = pqcKeyTypeToNid(typeView)) {
        id = pqcNid;
    } else {
        UNREACHABLE();
    }

    return NidKeyPairJobCtx(
        id,
        config);
}
