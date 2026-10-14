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

    // The byte arguments of one call. A synchronous ctx reads them in place.
    struct Inputs {
        WTF_FORBID_HEAP_ALLOCATION;

    public:
        BorrowedBytes key;
        BorrowedBytes salt;
        BorrowedBytes info;
    };

    HkdfJobCtx(ncrypto::Digest digest, size_t length, RefPtr<KeyObjectData>&& keyData, ByteSource&& key, ByteSource&& info, ByteSource&& salt);
    HkdfJobCtx(HkdfJobCtx&&);
    ~HkdfJobCtx();

    static std::optional<HkdfJobCtx> fromJS(JSC::JSGlobalObject*, JSC::CallFrame*, JSC::ThrowScope&, Mode, Inputs&);

    void runTask(JSC::JSGlobalObject*);
    JSCallbackArgs runFromJS(JSC::JSGlobalObject*);
    void deinit();

    ncrypto::Digest m_digest;
    size_t m_length;
    // Set when ikm is a KeyObject. m_key then points into it.
    RefPtr<KeyObjectData> m_keyData;
    ByteSource m_key;
    ByteSource m_info;
    ByteSource m_salt;

    std::optional<ByteSource> m_result;

    WTF_MAKE_TZONE_ALLOCATED(HkdfJobCtx);
};

struct HkdfJob {
    static void createAndSchedule(JSC::JSGlobalObject*, HkdfJobCtx&&, JSC::JSValue callback);
};

} // namespace Bun
