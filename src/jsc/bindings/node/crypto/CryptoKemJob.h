#pragma once

#include "root.h"
#include "JSCallbackArgs.h"
#include "KeyObject.h"
#include "CryptoUtil.h"

namespace Bun {

JSC_DECLARE_HOST_FUNCTION(jsEncapsulate);
JSC_DECLARE_HOST_FUNCTION(jsDecapsulate);

struct KemJobCtx {
    WTF_MAKE_TZONE_ALLOCATED(KemJobCtx);

public:
    enum class Mode : uint8_t {
        Encapsulate,
        Decapsulate,
    };

    KemJobCtx(Mode mode, RefPtr<KeyObjectData>&& key, WTF::Vector<uint8_t>&& ciphertext)
        : m_mode(mode)
        , m_key(WTF::move(key))
        , m_ciphertext(WTF::move(ciphertext))
    {
    }

    KemJobCtx(KemJobCtx&& other)
        : m_mode(other.m_mode)
        , m_key(WTF::move(other.m_key))
        , m_ciphertext(WTF::move(other.m_ciphertext))
        , m_sharedKeyResult(WTF::move(other.m_sharedKeyResult))
        , m_ciphertextResult(WTF::move(other.m_ciphertextResult))
    {
    }

    ~KemJobCtx() = default;

    static std::optional<KemJobCtx> fromJS(JSC::JSGlobalObject*, JSC::ThrowScope&, Mode,
        JSC::JSValue keyValue, JSC::JSValue ciphertextValue, JSC::JSValue callbackValue);

    void runTask(JSC::JSGlobalObject*);
    JSCallbackArgs runFromJS(JSC::JSGlobalObject*);
    void deinit();

    Mode m_mode;
    RefPtr<KeyObjectData> m_key;
    // Input ciphertext (Decapsulate mode only).
    WTF::Vector<uint8_t> m_ciphertext;

    ByteSource m_sharedKeyResult;
    ByteSource m_ciphertextResult;
};

struct KemJob {
    static void createAndSchedule(JSC::JSGlobalObject*, KemJobCtx&&, JSC::JSValue callback);
};

} // namespace Bun
