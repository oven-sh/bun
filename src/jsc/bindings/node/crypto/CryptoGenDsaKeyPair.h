#pragma once

#include "root.h"
#include "ncrypto.h"
#include "CryptoGenKeyPair.h"

namespace Bun {

struct DsaKeyPairJobCtx : KeyPairJobCtx {
    WTF_MAKE_TZONE_ALLOCATED(DsaKeyPairJobCtx);

public:
    DsaKeyPairJobCtx(uint32_t modulusLength, std::optional<int32_t> divisorLength, const KeyEncodingConfig& config)
        : KeyPairJobCtx(config.publicKeyEncoding, config.privateKeyEncoding)
        , m_modulusLength(modulusLength)
        , m_divisorLength(divisorLength)
    {
    }

    void deinit();
    ncrypto::EVPKeyCtxPointer setup();
    static std::optional<DsaKeyPairJobCtx> fromJS(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, const JSC::GCOwnedDataScope<WTF::StringView>& typeView, JSC::JSValue optionsValue, const KeyEncodingConfig& config);

    uint32_t m_modulusLength;
    std::optional<int32_t> m_divisorLength;
};

struct DsaKeyPairJob {
    static DsaKeyPairJob* create(JSC::JSGlobalObject*, DsaKeyPairJobCtx&&, JSC::JSValue callback);
    static void createAndSchedule(JSC::JSGlobalObject*, DsaKeyPairJobCtx&&, JSC::JSValue callback);
    void schedule();
};

} // namespace Bun
