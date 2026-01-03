#pragma once

#include "root.h"
#include "CryptoUtil.h"
#include "KeyObject.h"

namespace Bun {
JSC_DECLARE_HOST_FUNCTION(jsSignOneShot);
JSC_DECLARE_HOST_FUNCTION(jsVerifyOneShot);

static const unsigned int NoDsaSignature = static_cast<unsigned int>(-1);

struct SignJobCtx {
    WTF_MAKE_TZONE_ALLOCATED(SignJobCtx);

public:
    enum class Mode {
        Sign,
        Verify
    };

    SignJobCtx(Mode mode, RefPtr<KeyObjectData> keyData, Vector<uint8_t>&& data, ncrypto::Digest digest, std::optional<int32_t> padding, std::optional<int32_t> saltLength, DSASigEnc dsaSigEnc, Vector<uint8_t>&& signature = {})
        : m_mode(mode)
        , m_keyData(keyData)
        , m_data(WTF::move(data))
        , m_signature(WTF::move(signature))
        , m_digest(digest)
        , m_padding(padding)
        , m_saltLength(saltLength)
        , m_dsaSigEnc(dsaSigEnc)

    {
    }

    SignJobCtx(SignJobCtx&& other)
        : m_mode(other.m_mode)
        , m_keyData(WTF::move(other.m_keyData))
        , m_data(WTF::move(other.m_data))
        , m_signature(WTF::move(other.m_signature))
        , m_digest(other.m_digest)
        , m_padding(other.m_padding)
        , m_saltLength(other.m_saltLength)
        , m_dsaSigEnc(other.m_dsaSigEnc)
    {
    }

    static std::optional<SignJobCtx> fromJS(JSC::JSGlobalObject*, JSC::ThrowScope&, Mode mode,
        JSValue algorithmValue, JSValue dataValue, JSValue keyValue, JSValue signatureValue, JSValue callbackValue);

    void runTask(JSC::JSGlobalObject*);
    void runFromJS(JSC::JSGlobalObject*, JSC::JSValue callback);
    void deinit();

    Mode m_mode;
    RefPtr<KeyObjectData> m_keyData;
    Vector<uint8_t> m_data;
    Vector<uint8_t> m_signature;
    ncrypto::Digest m_digest;
    std::optional<int32_t> m_padding;
    std::optional<int32_t> m_saltLength;
    DSASigEnc m_dsaSigEnc;

    std::optional<ByteSource> m_signResult = { std::nullopt };
    std::optional<bool> m_verifyResult = { std::nullopt };
    int m_opensslError = 0;
};

struct SignJob {
    static SignJob* create(JSC::JSGlobalObject*, SignJobCtx&&, JSC::JSValue callback);
    static void createAndSchedule(JSC::JSGlobalObject*, SignJobCtx&&, JSC::JSValue callback);
    void schedule();
};
}
