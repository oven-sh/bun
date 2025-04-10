#pragma once

#include "root.h"

struct GenerateSecretKeyJobCtx {
    GenerateSecretKeyJobCtx(size_t length);
    GenerateSecretKeyJobCtx(GenerateSecretKeyJobCtx&&) = default;
    ~GenerateSecretKeyJobCtx() = default;

    void runTask(JSC::JSGlobalObject* lexicalGlobalObject);
    void runFromJS(JSC::JSGlobalObject* lexicalGlobalObject, JSC::JSValue callback);
    void deinit();

    static std::optional<GenerateSecretKeyJobCtx> fromJS(JSC::JSGlobalObject*, JSC::ThrowScope&, JSC::JSValue typeValue, JSC::JSValue optionsValue);

    size_t m_length;

    std::optional<WTF::Vector<uint8_t>> m_result { std::nullopt };

    WTF_MAKE_TZONE_ALLOCATED(GenerateSecretKeyJobCtx);
};

struct GenerateSecretKeyJob {
    static GenerateSecretKeyJob* create(JSC::JSGlobalObject*, size_t length, JSC::JSValue callback);
    static void createAndSchedule(JSC::JSGlobalObject*, GenerateSecretKeyJobCtx&&, JSC::JSValue callback);

    void schedule();
};

JSC_DECLARE_HOST_FUNCTION(jsCreatePublicKey);
JSC_DECLARE_HOST_FUNCTION(jsCreateSecretKey);
JSC_DECLARE_HOST_FUNCTION(jsGenerateKey);
JSC_DECLARE_HOST_FUNCTION(jsGenerateKeySync);
JSC_DECLARE_HOST_FUNCTION(jsGenerateKeyPair);
JSC_DECLARE_HOST_FUNCTION(jsGenerateKeyPairSync);
