#pragma once

#include "root.h"
#include "ncrypto.h"
#include "CryptoGenKeyPair.h"

namespace Bun {

struct DhKeyPairJobCtx : KeyPairJobCtx {
    WTF_MAKE_TZONE_ALLOCATED(DhKeyPairJobCtx);

public:
    DhKeyPairJobCtx(WTF::Variant<ncrypto::BignumPointer, int>&& prime, uint32_t generator, const KeyEncodingConfig& config)
        : KeyPairJobCtx(config.publicKeyEncoding, config.privateKeyEncoding)
        , m_prime(WTF::move(prime))
        , m_generator(generator)
    {
    }

    void deinit();
    ncrypto::EVPKeyCtxPointer setup();
    static std::optional<DhKeyPairJobCtx> fromJS(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, const JSC::GCOwnedDataScope<WTF::StringView>& typeView, JSC::JSValue optionsValue, const KeyEncodingConfig& config);

    WTF::Variant<ncrypto::BignumPointer, int> m_prime;
    uint32_t m_generator;
};

struct DhKeyPairJob {
    static void createAndSchedule(JSC::JSGlobalObject*, DhKeyPairJobCtx&&, JSC::JSValue callback);
};

} // namespace Bun
