#pragma once

#include "root.h"
#include "KeyObject.h"
#include "CryptoUtil.h"

namespace Bun {

JSC_DECLARE_HOST_FUNCTION(jsDiffieHellman);

struct DhJobCtx {
    WTF_MAKE_TZONE_ALLOCATED(DhJobCtx);

public:
    DhJobCtx(RefPtr<KeyObjectData>&& privateKey, RefPtr<KeyObjectData>&& publicKey)
        : m_privateKey(WTF::move(privateKey))
        , m_publicKey(WTF::move(publicKey))
    {
    }

    DhJobCtx(DhJobCtx&& other)
        : m_privateKey(WTF::move(other.m_privateKey))
        , m_publicKey(WTF::move(other.m_publicKey))
        , m_result(WTF::move(other.m_result))
    {
    }

    ~DhJobCtx() = default;

    static std::optional<DhJobCtx> fromJS(JSC::JSGlobalObject*, JSC::ThrowScope&, JSC::JSObject* options);

    void runTask(JSC::JSGlobalObject*);
    void runFromJS(JSC::JSGlobalObject*, JSC::JSValue callback);
    void deinit();

    RefPtr<KeyObjectData> m_privateKey;
    RefPtr<KeyObjectData> m_publicKey;

    ByteSource m_result;
};

struct DhJob {
    static DhJob* create(JSC::JSGlobalObject*, DhJobCtx&&, JSC::JSValue callback);
    static void createAndSchedule(JSC::JSGlobalObject*, DhJobCtx&&, JSC::JSValue callback);
    void schedule();
};

} // namespace Bun
