#pragma once

#include "root.h"
#include <JavaScriptCore/JSDestructibleObject.h>
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSTypedArrays.h>
#include <wtf/text/WTFString.h>
#include "ncrypto.h"
#include "BunClientData.h"
#include "openssl/ssl.h"

namespace Bun {

enum class CipherKind {
    Cipher,
    Decipher,
};

enum class UpdateResult {
    Success,
    ErrorMessageSize,
    ErrorState
};

enum class AuthTagState {
    AuthTagUnknown,
    AuthTagKnown,
    AuthTagPassedToOpenSSL
};

class JSCipher final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static JSCipher* create(JSC::VM& vm, JSC::Structure* structure, JSC::JSGlobalObject* globalObject, CipherKind kind, ncrypto::CipherCtxPointer&& ctx, std::optional<uint32_t> authTagLen, int32_t maxMessageSize)
    {
        JSCipher* instance = new (NotNull, JSC::allocateCell<JSCipher>(vm)) JSCipher(vm, structure, kind, WTF::move(ctx), authTagLen, maxMessageSize);
        instance->finishCreation(vm, globalObject);
        return instance;
    }

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<JSCipher, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForJSCipher.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSCipher = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForJSCipher.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForJSCipher = std::forward<decltype(space)>(space); });
    }

    bool checkCCMMessageLength(int32_t messageLen) const
    {
        if (messageLen > m_maxMessageSize) {
            return false;
        }

        return true;
    }

    bool maybePassAuthTagToOpenSSL()
    {
        if (m_authTagState == AuthTagState::AuthTagKnown) {
            ncrypto::Buffer<const char> buf {
                .data = m_authTag,
                .len = m_authTagLen.value(),
            };

            if (!m_ctx.setAeadTag(buf)) {
                return false;
            }

            m_authTagState = AuthTagState::AuthTagPassedToOpenSSL;
        }

        return true;
    }

    bool isAuthenticatedMode() const
    {
        return ncrypto::Cipher::FromCtx(m_ctx).isSupportedAuthenticatedMode();
    }

    ncrypto::CipherCtxPointer m_ctx;
    const CipherKind m_kind;
    AuthTagState m_authTagState;
    std::optional<uint32_t> m_authTagLen;
    char m_authTag[EVP_GCM_TLS_TAG_LEN];
    bool m_pendingAuthFailed;
    int32_t m_maxMessageSize;

private:
    JSCipher(JSC::VM& vm, JSC::Structure* structure, CipherKind kind, ncrypto::CipherCtxPointer&& ctx, std::optional<uint32_t> authTagLen, int32_t maxMessageSize)
        : Base(vm, structure)
        , m_kind(kind)
        , m_authTagState(AuthTagState::AuthTagUnknown)
        , m_authTagLen(authTagLen)
        , m_pendingAuthFailed(false)
        , m_maxMessageSize(maxMessageSize)
        , m_ctx(WTF::move(ctx))
    {
    }

    void finishCreation(JSC::VM&, JSC::JSGlobalObject*);
    static void destroy(JSC::JSCell* cell) { static_cast<JSCipher*>(cell)->~JSCipher(); }
};

void setupCipherClassStructure(JSC::LazyClassStructure::Initializer&);

JSC_DECLARE_HOST_FUNCTION(jsPublicEncrypt);
JSC_DECLARE_HOST_FUNCTION(jsPublicDecrypt);
JSC_DECLARE_HOST_FUNCTION(jsPrivateEncrypt);
JSC_DECLARE_HOST_FUNCTION(jsPrivateDecrypt);

} // namespace Bun
