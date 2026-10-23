#pragma once

#include "root.h"
#include "JSCallbackArgs.h"
#include "CryptoUtil.h"
#include "KeyObject.h"
#include <wtf/FixedVector.h>

namespace Bun {
JSC_DECLARE_HOST_FUNCTION(jsSignOneShot);
JSC_DECLARE_HOST_FUNCTION(jsVerifyOneShot);

inline constexpr unsigned int NoDsaSignature = static_cast<unsigned int>(-1);

struct SignJobCtx {
    WTF_MAKE_TZONE_ALLOCATED(SignJobCtx);

public:
    enum class Mode {
        Sign,
        Verify
    };

    SignJobCtx(Mode mode, RefPtr<KeyObjectData> keyData, Vector<uint8_t>&& data, ncrypto::Digest digest, std::optional<int32_t> padding, std::optional<int32_t> saltLength, DSASigEnc dsaSigEnc, FixedVector<uint8_t>&& context, Vector<uint8_t>&& signature = {})
        : m_keyData(keyData)
        , m_data(WTF::move(data))
        , m_signature(WTF::move(signature))
        , m_context(WTF::move(context))
        , m_digest(digest)
        , m_padding(padding)
        , m_saltLength(saltLength)
        , m_dsaSigEnc(dsaSigEnc)
        , m_mode(mode)
    {
    }

    SignJobCtx(SignJobCtx&& other)
        : m_keyData(WTF::move(other.m_keyData))
        , m_data(WTF::move(other.m_data))
        , m_signature(WTF::move(other.m_signature))
        , m_context(WTF::move(other.m_context))
        , m_digest(other.m_digest)
        , m_padding(other.m_padding)
        , m_saltLength(other.m_saltLength)
        , m_dsaSigEnc(other.m_dsaSigEnc)
        , m_mode(other.m_mode)
    {
    }

    static std::optional<SignJobCtx> fromJS(JSC::JSGlobalObject*, JSC::ThrowScope&, Mode mode,
        JSValue algorithmValue, JSValue dataValue, JSValue keyValue, JSValue signatureValue, JSValue callbackValue);

    void runTask(JSC::JSGlobalObject*);
    JSCallbackArgs runFromJS(JSC::JSGlobalObject*);
    void deinit();
    bool hasUnsupportedContext() const;
    JSC::JSValue failureError(JSC::JSGlobalObject*, JSC::ThrowScope&) const;

    RefPtr<KeyObjectData> m_keyData;
    Vector<uint8_t> m_data;
    Vector<uint8_t> m_signature;
    // The `context` option. Zero bytes and an absent option are the same state.
    FixedVector<uint8_t> m_context;
    ncrypto::Digest m_digest;
    std::optional<int32_t> m_padding;
    std::optional<int32_t> m_saltLength;
    DSASigEnc m_dsaSigEnc;
    Mode m_mode;

    std::optional<ByteSource> m_signResult = { std::nullopt };
    std::optional<bool> m_verifyResult = { std::nullopt };
    int m_opensslError = 0;
};

struct SignJob {
    static void createAndSchedule(JSC::JSGlobalObject*, SignJobCtx&&, JSC::JSValue callback);
};
}
