#pragma once

#include "root.h"
#include "ncrypto.h"
#include "KeyObject.h"

namespace Bun {

JSC_DECLARE_HOST_FUNCTION(jsGenerateKeyPair);
JSC_DECLARE_HOST_FUNCTION(jsGenerateKeyPairSync);

struct KeyEncodingConfig {
    ncrypto::EVPKeyPointer::PublicKeyEncodingConfig publicKeyEncoding;
    ncrypto::EVPKeyPointer::PrivateKeyEncodingConfig privateKeyEncoding;
};

struct KeyPairJobCtx {
public:
    KeyPairJobCtx(ncrypto::EVPKeyPointer::PublicKeyEncodingConfig publicKeyEncoding, ncrypto::EVPKeyPointer::PrivateKeyEncodingConfig privateKeyEncoding)
        : m_publicKeyEncoding(publicKeyEncoding)
        , m_privateKeyEncoding(privateKeyEncoding)
    {
    }

    void runTask(JSC::JSGlobalObject* globalObject, ncrypto::EVPKeyCtxPointer& ctx);
    void runFromJS(JSC::JSGlobalObject* globalObject, JSC::JSValue callback);
    void deinit();

    int err() const { return m_opensslError; };

    ncrypto::EVPKeyPointer::PublicKeyEncodingConfig m_publicKeyEncoding;
    ncrypto::EVPKeyPointer::PrivateKeyEncodingConfig m_privateKeyEncoding;

    // keyObj is set after work is done
    KeyObject m_keyObj;
    int m_opensslError = 0;
};

KeyEncodingConfig parseKeyEncodingConfig(JSC::JSGlobalObject*, JSC::ThrowScope&, JSC::JSValue keyTypeValue, JSC::JSValue optionsValue);

} // namespace Bun
