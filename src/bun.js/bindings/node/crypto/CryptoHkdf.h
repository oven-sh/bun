#pragma once

#include "root.h"
#include "helpers.h"
#include "ncrypto.h"
#include "CryptoUtil.h"

using namespace JSC;
using namespace Bun;
using namespace ncrypto;

JSC_DECLARE_HOST_FUNCTION(jsHkdf);
JSC_DECLARE_HOST_FUNCTION(jsHkdfSync);

struct HkdfJobCtx {

    enum class Mode {
        Sync,
        Async,
    };

    HkdfJobCtx(Digest digest, size_t length, WTF::Vector<uint8_t>&& key, WTF::Vector<uint8_t>&& info, WTF::Vector<uint8_t>&& salt);
    HkdfJobCtx(HkdfJobCtx&&);
    ~HkdfJobCtx();

    static std::optional<HkdfJobCtx> fromJS(JSGlobalObject*, CallFrame*, ThrowScope&, Mode);

    void runTask(JSGlobalObject*);
    void runFromJS(JSGlobalObject*, JSValue callback);
    void deinit();

    ncrypto::Digest m_digest;
    size_t m_length;
    WTF::Vector<uint8_t> m_key;
    WTF::Vector<uint8_t> m_info;
    WTF::Vector<uint8_t> m_salt;

    std::optional<ByteSource> m_result;

    WTF_MAKE_TZONE_ALLOCATED(HkdfJobCtx);
};

struct HkdfJob {
    static HkdfJob* create(JSGlobalObject*, HkdfJobCtx&&, JSValue callback);
    static void createAndSchedule(JSGlobalObject*, HkdfJobCtx&&, JSValue callback);
    void schedule();
};
