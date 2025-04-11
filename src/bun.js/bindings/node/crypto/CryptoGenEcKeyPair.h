#pragma once

#include "root.h"
#include "ncrypto.h"
#include "CryptoGenKeyPair.h"

struct EcKeyPairJobCtx : KeyPairJobCtx {

    EcKeyPairJobCtx(int curveNid, int paramEncoding, const KeyEncodingConfig& config)
        : KeyPairJobCtx(config.publicKeyEncoding, config.privateKeyEncoding)
        , m_curveNid(curveNid)
        , m_paramEncoding(paramEncoding)
    {
    }

    void deinit();
    ncrypto::EVPKeyCtxPointer setup();
    static std::optional<EcKeyPairJobCtx> fromJS(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, const JSC::GCOwnedDataScope<WTF::StringView>& typeView, JSC::JSValue optionsValue, const KeyEncodingConfig& config);

    int m_curveNid;
    int m_paramEncoding;
};

struct EcKeyPairJob {
    static EcKeyPairJob* create(JSC::JSGlobalObject*, EcKeyPairJobCtx&&, JSC::JSValue callback);
    static void createAndSchedule(JSC::JSGlobalObject*, EcKeyPairJobCtx&&, JSC::JSValue callback);
    void schedule();
};
