#pragma once

#include "root.h"
#include "JSCallbackArgs.h"
#include "helpers.h"
#include "ncrypto.h"
#include "CryptoUtil.h"
#include "KeyObject.h"

namespace Bun {

JSC_DECLARE_HOST_FUNCTION(jsHkdf);
JSC_DECLARE_HOST_FUNCTION(jsHkdfSync);

struct HkdfJobCtx {

    enum class Mode {
        Sync,
        Async,
    };

    HkdfJobCtx(ncrypto::Digest digest, size_t length, KeyObject&& key, WTF::Vector<uint8_t>&& info, WTF::Vector<uint8_t>&& salt);
    HkdfJobCtx(HkdfJobCtx&&);
    ~HkdfJobCtx();

    static std::optional<HkdfJobCtx> fromJS(JSC::JSGlobalObject*, JSC::CallFrame*, JSC::ThrowScope&, Mode);

    void runTask(JSC::JSGlobalObject*);
    JSCallbackArgs runFromJS(JSC::JSGlobalObject*);
    void deinit();

    ncrypto::Digest m_digest;
    size_t m_length;
    KeyObject m_key;
    WTF::Vector<uint8_t> m_info;
    WTF::Vector<uint8_t> m_salt;

    std::optional<ByteSource> m_result;

    WTF_MAKE_TZONE_ALLOCATED(HkdfJobCtx);
};

struct HkdfJob {
    static void createAndSchedule(JSC::JSGlobalObject*, HkdfJobCtx&&, JSC::JSValue callback);
};

} // namespace Bun
