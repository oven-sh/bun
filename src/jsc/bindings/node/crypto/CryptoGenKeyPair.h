#pragma once

#include "root.h"
#include "JSCallbackArgs.h"
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

    // Every key pair generation runs here: generateKeyPairSync on the JS thread, the generateKeyPair jobs on the work pool.
    template<typename Ctx> static void generate(Ctx&);

    JSCallbackArgs runFromJS(JSC::JSGlobalObject* globalObject);

    int err() const { return m_opensslError; };

    ncrypto::EVPKeyPointer::PublicKeyEncodingConfig m_publicKeyEncoding;
    ncrypto::EVPKeyPointer::PrivateKeyEncodingConfig m_privateKeyEncoding;

    // keyObj is set after work is done
    KeyObject m_keyObj;

private:
    bool keygen(ncrypto::EVPKeyCtxPointer&);

    int m_opensslError = 0;
};

template<typename Ctx>
void KeyPairJobCtx::generate(Ctx& ctx)
{
    // Without this, the error read below can be one that an earlier operation left on this thread.
    ncrypto::ClearErrorOnReturn clearErrorOnReturn;
    ncrypto::EVPKeyCtxPointer keyCtx = ctx.setup();
    if (!keyCtx || !ctx.keygen(keyCtx)) {
        ctx.m_opensslError = ERR_get_error();
    }
}

KeyEncodingConfig parseKeyEncodingConfig(JSC::JSGlobalObject*, JSC::ThrowScope&, JSC::JSValue keyTypeValue, JSC::JSValue optionsValue);

} // namespace Bun
