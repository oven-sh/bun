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

    RsaKeyPairJobCtx(RsaKeyVariant variant, uint32_t modulusLength, uint32_t exponent, std::optional<int32_t> saltLength, ncrypto::Digest md, ncrypto::Digest mgfMd, const KeyEncodingConfig& encodingConfig)
        : KeyPairJobCtx(encodingConfig.publicKeyEncoding, encodingConfig.privateKeyEncoding)
        , m_variant(variant)
        , m_modulusLength(modulusLength)
        , m_exponent(exponent)
        , m_saltLength(saltLength.value_or(-1))
        , m_md(md)
        , m_mgfMd(mgfMd)
    {
    }

    RsaKeyPairJobCtx(RsaKeyPairJobCtx&& other)
        : KeyPairJobCtx(other.m_publicKeyEncoding, other.m_privateKeyEncoding)
        , m_variant(other.m_variant)
        , m_modulusLength(other.m_modulusLength)
        , m_exponent(other.m_exponent)
        , m_saltLength(other.m_saltLength)
        , m_md(other.m_md)
        , m_mgfMd(other.m_mgfMd)
    {
    }

    void deinit();
    ncrypto::EVPKeyCtxPointer setup();
    static std::optional<RsaKeyPairJobCtx> fromJS(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, const JSC::GCOwnedDataScope<WTF::StringView>& typeView, JSC::JSValue optionsValue, const KeyEncodingConfig& config);

    RsaKeyVariant m_variant;
    uint32_t m_modulusLength;
    uint32_t m_exponent;

    int32_t m_saltLength;
    ncrypto::Digest m_md = nullptr;
    ncrypto::Digest m_mgfMd = nullptr;
};

struct RsaKeyPairJob {
    static RsaKeyPairJob* create(JSC::JSGlobalObject*, RsaKeyPairJobCtx&&, JSC::JSValue callback);
    static void createAndSchedule(JSC::JSGlobalObject*, RsaKeyPairJobCtx&&, JSC::JSValue callback);
    void schedule();
};

} // namespace Bun
