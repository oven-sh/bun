#pragma once

#include "root.h"
#include "ncrypto.h"
#include "CryptoGenKeyPair.h"

namespace Bun {

struct NidKeyPairJobCtx : KeyPairJobCtx {
    NidKeyPairJobCtx(int id, const KeyEncodingConfig& config)
        : KeyPairJobCtx(config.publicKeyEncoding, config.privateKeyEncoding)
        , m_id(id)
    {
    }

    void runTask(JSC::JSGlobalObject*) { generate(setup()); }
    ncrypto::EVPKeyCtxPointer setup();
    static std::optional<NidKeyPairJobCtx> fromJS(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, const JSC::GCOwnedDataScope<WTF::StringView>& typeView, JSC::JSValue optionsValue, const KeyEncodingConfig& config);

    int m_id;
};

} // namespace Bun
