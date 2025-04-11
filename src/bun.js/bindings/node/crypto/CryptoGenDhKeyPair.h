#pragma once

#include "root.h"
#include "ncrypto.h"
#include "CryptoGenKeyPair.h"

struct DhKeyPairJobCtx : KeyPairJobCtx {

    DhKeyPairJobCtx(ncrypto::DHPointer&& group, const KeyEncodingConfig& config)
        : KeyPairJobCtx(config.publicKeyEncoding, config.privateKeyEncoding)
        , m_prime(WTFMove(group))
    {
    }

    DhKeyPairJobCtx(int primeLength, uint32_t generator, const KeyEncodingConfig& config)
        : KeyPairJobCtx(config.publicKeyEncoding, config.privateKeyEncoding)
        , m_prime(primeLength)
        , m_generator(generator)
    {
    }

    DhKeyPairJobCtx(ncrypto::BignumPointer&& prime, const KeyEncodingConfig& config)
        : KeyPairJobCtx(config.publicKeyEncoding, config.privateKeyEncoding)
        , m_prime(WTFMove(prime))
    {
    }

    void deinit();
    ncrypto::EVPKeyCtxPointer setup();
    static std::optional<DhKeyPairJobCtx> fromJS(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, const JSC::GCOwnedDataScope<WTF::StringView>& typeView, JSC::JSValue optionsValue, const KeyEncodingConfig& config);

    std::variant<ncrypto::BignumPointer, int> m_prime;
    uint32_t m_generator;
};

struct DhKeyPairJob {
    static DhKeyPairJob* create(JSC::JSGlobalObject*, DhKeyPairJobCtx&&, JSC::JSValue callback);
    static void createAndSchedule(JSC::JSGlobalObject*, DhKeyPairJobCtx&&, JSC::JSValue callback);
    void schedule();
};
