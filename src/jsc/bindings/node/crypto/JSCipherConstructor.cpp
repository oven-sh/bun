#include "JSCipherConstructor.h"
#include "JSCipher.h"
#include "ErrorCode.h"
#include "JSBufferEncodingType.h"
#include "NodeValidator.h"
#include <JavaScriptCore/TypedArrayInlines.h>
#include <JavaScriptCore/JSCJSValueInlines.h>
#include "CryptoUtil.h"
#include "openssl/dh.h"
#include "openssl/bn.h"
#include "openssl/err.h"
#include "ncrypto.h"
#include "KeyObject.h"
#include "ZigGlobalObject.h"

using namespace JSC;
using namespace WebCore;
using namespace ncrypto;

namespace Bun {

const JSC::ClassInfo JSCipherConstructor::s_info = { "Cipher"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSCipherConstructor) };

// Node's Cipheriv/Decipheriv are plain functions: calling without `new` constructs anyway.
JSC_DEFINE_HOST_FUNCTION(callCipher, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSObject* constructor = callFrame->jsCallee();
    ArgList args = ArgList(callFrame);
    auto constructData = JSC::getConstructData(constructor);
    JSC::JSValue result = JSC::construct(lexicalGlobalObject, constructor, constructData, args);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(result);
}

void initAuthenticated(JSGlobalObject* globalObject, ThrowScope& scope, CipherCtxPointer& ctx, const WTF::StringView& cipherString, CipherKind kind, int32_t ivLen, std::optional<uint32_t>& authTagLen, int32_t& maxMessageSize)
{
    MarkPopErrorOnReturn popError;

    if (!ctx.setIvLength(ivLen)) {
        ERR::CRYPTO_INVALID_IV(scope, globalObject);
        return;
    }

    if (ctx.isCcmMode()) {
        if (kind == CipherKind::Decipher && ncrypto::isFipsEnabled()) {
            ERR::CRYPTO_UNSUPPORTED_OPERATION(scope, globalObject, "CCM encryption not supported in FIPS mode"_s);
            return;
        }

        // NIST SP 800-38C A.1: max plaintext length is 2^(8*(15-ivLen)) - 1 bytes.
        // https://github.com/nodejs/node/blob/v26.3.0/src/crypto/crypto_cipher.cc#L440-L442
        if (ivLen == 12)
            maxMessageSize = 16777215;
        else if (ivLen == 13)
            maxMessageSize = 65535;
        else
            maxMessageSize = INT_MAX;
    }

    if (!authTagLen.has_value()) {
        // Both GCM and ChaCha20-Poly1305 have a default tag length of 16 bytes.
        // Other modes (CCM, OCB) require an explicit tag length.
        if (ctx.isGcmMode() || ctx.isChaCha20Poly1305()) {
            authTagLen = 16;
        } else {
            WTF::StringBuilder builder;
            builder.append("authTagLength required for "_s);
            builder.append(cipherString);
            ERR::CRYPTO_INVALID_AUTH_TAG(scope, globalObject, builder.toString());
            return;
        }
    } else if ((ctx.isGcmMode() && !Cipher::IsValidGCMTagLength(*authTagLen))
        || (!ctx.isGcmMode() && !ctx.setAeadTagLength(*authTagLen))) {
        // GCM authentication tag lengths are restricted according to NIST 800-38d,
        // page 9. For other modes, we rely on OpenSSL to validate the length.
        WTF::StringBuilder builder;
        builder.append("Invalid authentication tag length: "_s);
        builder.append(*authTagLen);
        ERR::CRYPTO_INVALID_AUTH_TAG(scope, globalObject, builder.toString());
        return;
    }
}

// new Cipheriv(cipher, key, iv[, options]) / new Decipheriv(cipher, key, iv[, options])
static EncodedJSValue constructCipher(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame, CipherKind cipherKind)
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    auto& classStructure = cipherKind == CipherKind::Cipher ? zigGlobalObject->m_JSCipherClassStructure : zigGlobalObject->m_JSDecipherClassStructure;
    JSC::Structure* structure = classStructure.get(zigGlobalObject);
    JSValue newTarget = callFrame->newTarget();
    if (classStructure.constructor(zigGlobalObject) != newTarget) [[unlikely]] {
        auto* functionGlobalObject = defaultGlobalObject(getFunctionRealm(globalObject, newTarget.getObject()));
        RETURN_IF_EXCEPTION(scope, {});
        auto& baseClassStructure = cipherKind == CipherKind::Cipher ? functionGlobalObject->m_JSCipherClassStructure : functionGlobalObject->m_JSDecipherClassStructure;
        structure = InternalFunction::createSubclassStructure(globalObject, newTarget.getObject(), baseClassStructure.get(functionGlobalObject));
        RETURN_IF_EXCEPTION(scope, {});
    }

    JSValue cipherValue = callFrame->argument(0);
    JSValue keyValue = callFrame->argument(1);
    JSValue ivValue = callFrame->argument(2);
    JSValue optionsValue = callFrame->argument(3);

    V::validateString(scope, globalObject, cipherValue, "cipher"_s);
    RETURN_IF_EXCEPTION(scope, {});

    JSValue encodingValue = jsUndefined();
    if (optionsValue.pureToBoolean() != TriState::False) {

        encodingValue = optionsValue.get(globalObject, Identifier::fromString(vm, "encoding"_s));
        RETURN_IF_EXCEPTION(scope, {});

        if (encodingValue.isUndefinedOrNull()) {
            encodingValue = jsUndefined();
        } else {
            V::validateString(scope, globalObject, encodingValue, "options.encoding"_s);
            RETURN_IF_EXCEPTION(scope, {});
        }
    }

    KeyObject keyObject = KeyObject::prepareSecretKey(globalObject, scope, keyValue, encodingValue);
    RETURN_IF_EXCEPTION(scope, {});

    auto keyData = keyObject.symmetricKey().span();

    JSArrayBufferView* ivView = nullptr;
    if (!ivValue.isNull()) {
        ivView = getArrayBufferOrView(globalObject, scope, ivValue, "iv"_s, jsUndefined());
        RETURN_IF_EXCEPTION(scope, {});
    }

    std::optional<uint32_t> authTagLength = std::nullopt;
    if (optionsValue.pureToBoolean() != TriState::False) {
        JSValue authTagLengthValue = optionsValue.get(globalObject, Identifier::fromString(vm, "authTagLength"_s));
        RETURN_IF_EXCEPTION(scope, {});

        if (!authTagLengthValue.isUndefinedOrNull()) {
            std::optional<int32_t> maybeAuthTagLength = authTagLengthValue.tryGetAsInt32();
            if (!maybeAuthTagLength || *maybeAuthTagLength < 0) {
                return ERR::INVALID_ARG_VALUE(scope, globalObject, "options.authTagLength"_s, authTagLengthValue);
            }

            authTagLength = *maybeAuthTagLength;
        }
    }

    WTF::String cipherString = cipherValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    if (keyData.size() > INT_MAX) [[unlikely]] {
        return ERR::OUT_OF_RANGE(scope, globalObject, "key is too big"_s, 0, INT_MAX, jsNumber(keyData.size()));
    }

    int32_t ivLen = 0;
    if (ivView) {
        if (ivView->byteLength() > INT_MAX) [[unlikely]] {
            return ERR::OUT_OF_RANGE(scope, globalObject, "iv is too big"_s, 0, INT_MAX, jsNumber(ivView->byteLength()));
        }
        ivLen = ivView->byteLength();
    }

    MarkPopErrorOnReturn popError;

    Cipher cipher = Cipher::FromName(cipherString);
    if (!cipher) {
        return ERR::CRYPTO_UNKNOWN_CIPHER(scope, globalObject, cipherString);
    }

    const int32_t expectedIvLen = cipher.getIvLength();

    if (!ivView && expectedIvLen != 0) {
        return ERR::CRYPTO_INVALID_IV(scope, globalObject);
    }

    if (!cipher.isSupportedAuthenticatedMode() && ivView && ivView->byteLength() != expectedIvLen) {
        return ERR::CRYPTO_INVALID_IV(scope, globalObject);
    }

    if (cipher.isChaCha20Poly1305()) {
        ASSERT(ivView);

        if (ivView->byteLength() > 12) {
            return ERR::CRYPTO_INVALID_IV(scope, globalObject);
        }
    }

    // OpenSSL 3 caps GCM IVs at 1024 bits (GCM_IV_MAX_SIZE). BoringSSL has no
    // such cap, so enforce it here to match Node.js and avoid unbounded GHASH work.
    if (cipher.isGcmMode()) {
        ASSERT(ivView);

        if (ivView->byteLength() > 128) {
            return ERR::CRYPTO_INVALID_IV(scope, globalObject);
        }
    }

    CipherCtxPointer ctx = CipherCtxPointer::New();

    if (cipher.isWrapMode()) {
        ctx.setAllowWrap();
    }

    const bool encrypt = cipherKind == CipherKind::Cipher;
    if (!ctx.init(cipher, encrypt)) {
        throwCryptoError(globalObject, scope, ERR_get_error(), "Failed to initialize cipher"_s);
        return {};
    }

    int32_t maxMessageSize = 0;
    if (cipher.isSupportedAuthenticatedMode()) {
        initAuthenticated(globalObject, scope, ctx, cipherString, cipherKind, ivLen, authTagLength, maxMessageSize);
        RETURN_IF_EXCEPTION(scope, {});
    } else {
        // Like Node, only keep authTagLength for authenticated modes. Keeping an
        // unvalidated value here would let getAuthTag() memcpy past the 16-byte
        // m_authTag buffer.
        authTagLength = std::nullopt;
    }

    if (!ctx.setKeyLength(keyData.size())) {
        ctx.reset();
        return ERR::CRYPTO_INVALID_KEYLEN(scope, globalObject);
    }

    if (!ctx.init(Cipher(), encrypt, keyData.data(), ivView ? reinterpret_cast<uint8_t*>(ivView->vector()) : nullptr)) {
        throwCryptoError(globalObject, scope, ERR_get_error(), "Failed to initialize cipher"_s);
        return {};
    }

    JSCipher* result = JSCipher::create(vm, structure, globalObject, cipherKind, WTF::move(ctx), authTagLength, maxMessageSize);
    // Transform is constructed lazily (see LazyTransform.h); it reads `this._options` then.
    if (!optionsValue.isUndefined())
        result->putDirect(vm, Identifier::fromString(vm, "_options"_s), optionsValue);
    return JSC::JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(constructCipheriv, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return constructCipher(globalObject, callFrame, CipherKind::Cipher);
}

JSC_DEFINE_HOST_FUNCTION(constructDecipheriv, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return constructCipher(globalObject, callFrame, CipherKind::Decipher);
}

} // namespace Bun
