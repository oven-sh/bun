#pragma once

#include "root.h"
#include "ncrypto.h"

namespace Bun {

struct SecretKeyJobCtx {
    SecretKeyJobCtx(size_t length);
    SecretKeyJobCtx(SecretKeyJobCtx&&);
    ~SecretKeyJobCtx() = default;

    void runTask(JSC::JSGlobalObject* lexicalGlobalObject);
    void runFromJS(JSC::JSGlobalObject* lexicalGlobalObject, JSC::JSValue callback);
    void deinit();

    static std::optional<SecretKeyJobCtx> fromJS(JSC::JSGlobalObject*, JSC::ThrowScope&, JSC::JSValue typeValue, JSC::JSValue optionsValue);
    JSC::JSValue result() const;

    size_t m_length;

    std::optional<WTF::Vector<uint8_t>> m_result { std::nullopt };

    WTF_MAKE_TZONE_ALLOCATED(SecretKeyJobCtx);
};

struct SecretKeyJob {
    static SecretKeyJob* create(JSC::JSGlobalObject*, size_t length, JSC::JSValue callback);
    static void createAndSchedule(JSC::JSGlobalObject*, SecretKeyJobCtx&&, JSC::JSValue callback);

    void schedule();
};

JSC_DECLARE_HOST_FUNCTION(jsGenerateKey);
JSC_DECLARE_HOST_FUNCTION(jsGenerateKeySync);

} // namespace Bun
