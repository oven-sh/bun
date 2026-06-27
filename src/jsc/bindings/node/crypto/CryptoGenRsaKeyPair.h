#pragma once

#include "root.h"
#include "ncrypto.h"
#include "CryptoGenKeyPair.h"

namespace Bun {

enum class RsaKeyVariant {
    RSA_SSA_PKCS1_v1_5,
    RSA_PSS,
    RSA_OAEP,
};

struct RsaKeyPairJobCtx : KeyPairJobCtx {
    WTF_MAKE_TZONE_ALLOCATED(RsaKeyPairJobCtx);

public:
    RsaKeyPairJobCtx(RsaKeyVariant variant, uint32_t modulusLength, uint32_t exponent, const KeyEncodingConfig& encodingConfig)
        : KeyPairJobCtx(encodingConfig.publicKeyEncoding, encodingConfig.privateKeyEncoding)
        , m_variant(variant)
        , m_modulusLength(modulusLength)
        , m_exponent(exponent)
    {
    }

    // The RSA_PSS variant only needs the message digest: fromJS rejects any
    // parameter set where the MGF1 hash or salt length differs from it.
    RsaKeyPairJobCtx(RsaKeyVariant variant, uint32_t modulusLength, uint32_t exponent, ncrypto::Digest md, const KeyEncodingConfig& encodingConfig)
        : KeyPairJobCtx(encodingConfig.publicKeyEncoding, encodingConfig.privateKeyEncoding)
        , m_variant(variant)
        , m_modulusLength(modulusLength)
        , m_exponent(exponent)
        , m_md(md)
    {
    }

    RsaKeyPairJobCtx(RsaKeyPairJobCtx&& other)
        : KeyPairJobCtx(other.m_publicKeyEncoding, other.m_privateKeyEncoding)
        , m_variant(other.m_variant)
        , m_modulusLength(other.m_modulusLength)
        , m_exponent(other.m_exponent)
        , m_md(other.m_md)
    {
    }

    void deinit();
    ncrypto::EVPKeyCtxPointer setup();
    // Shadows KeyPairJobCtx::runTask so the RSA_PSS variant can re-encode the
    // generated plain RSA key as id-RSASSA-PSS (see setup for why).
    void runTask(JSC::JSGlobalObject* globalObject, ncrypto::EVPKeyCtxPointer& ctx);
    static std::optional<RsaKeyPairJobCtx> fromJS(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, const JSC::GCOwnedDataScope<WTF::StringView>& typeView, JSC::JSValue optionsValue, const KeyEncodingConfig& config);

    RsaKeyVariant m_variant;
    uint32_t m_modulusLength;
    uint32_t m_exponent;

    ncrypto::Digest m_md = nullptr;
};

struct RsaKeyPairJob {
    static RsaKeyPairJob* create(JSC::JSGlobalObject*, RsaKeyPairJobCtx&&, JSC::JSValue callback);
    static void createAndSchedule(JSC::JSGlobalObject*, RsaKeyPairJobCtx&&, JSC::JSValue callback);
    void schedule();
};

} // namespace Bun
