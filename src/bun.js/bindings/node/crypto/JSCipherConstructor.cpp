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

using namespace JSC;
using namespace WebCore;
using namespace ncrypto;

namespace Bun {

const JSC::ClassInfo JSCipherConstructor::s_info = { "Cipher"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSCipherConstructor) };

JSC_DEFINE_HOST_FUNCTION(callCipher, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto* constructor = globalObject->m_JSCipherClassStructure.constructor(globalObject);

    ArgList args = ArgList(callFrame);
    auto callData = JSC::getConstructData(constructor);
    JSC::JSValue result = JSC::construct(globalObject, constructor, callData, args);
    return JSValue::encode(result);
}

void initAuthenticated(JSGlobalObject* globalObject, ThrowScope& scope, CipherCtxPointer& ctx, const WTF::StringView& cipherString, CipherKind kind, int32_t ivLen, std::optional<uint32_t>& authTagLen, int32_t& maxMessageSize)
{
    MarkPopErrorOnReturn popError;

    if (!ctx.setIvLength(ivLen)) {
        ERR::CRYPTO_INVALID_IV(scope, globalObject);
        return;
    }

    if (ctx.isGcmMode()) {
        if (authTagLen.has_value()) {
            if (!Cipher::IsValidGCMTagLength(*authTagLen)) {
                WTF::StringBuilder builder;
                builder.append("Invalid authentication tag length: "_s);
                builder.append(*authTagLen);
                ERR::CRYPTO_INVALID_AUTH_TAG(scope, globalObject, builder.toString());
                return;
            }
        }
    } else {
        if (!authTagLen.has_value()) {
            if (ctx.isChaCha20Poly1305()) {
                authTagLen = 16;
            } else {
                WTF::StringBuilder builder;
                builder.append("authTagLength required for: "_s);
                builder.append(cipherString);
                ERR::CRYPTO_INVALID_AUTH_TAG(scope, globalObject, builder.toString());
                return;
            }
        }

        if (ctx.isCcmMode() && kind == CipherKind::Decipher && ncrypto::isFipsEnabled()) {
            ERR::CRYPTO_UNSUPPORTED_OPERATION(scope, globalObject, "CCM encryption not supported in FIPS mode"_s);
            return;
        }

        if (!ctx.setAeadTagLength(*authTagLen)) {
            WTF::StringBuilder builder;
            builder.append("Invalid authentication tag length: "_s);
            builder.append(*authTagLen);
            ERR::CRYPTO_INVALID_AUTH_TAG(scope, globalObject, builder.toString());
            return;
        }

        if (ctx.isCcmMode()) {
            if (ivLen == 12)
                maxMessageSize = 16777215;
            else if (ivLen == 13)
                maxMessageSize = 65535;
            else
                maxMessageSize = INT_MAX;
        }
    }
}

JSC_DEFINE_HOST_FUNCTION(constructCipher, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue isDecipherValue = callFrame->argument(0);
    ASSERT(isDecipherValue.isBoolean());
    CipherKind cipherKind = isDecipherValue.toBoolean(globalObject) ? CipherKind::Decipher : CipherKind::Cipher;
    RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

    JSValue cipherValue = callFrame->argument(1);
    JSValue keyValue = callFrame->argument(2);
    JSValue ivValue = callFrame->argument(3);
    JSValue optionsValue = callFrame->argument(4);

    V::validateString(scope, globalObject, cipherValue, "cipher"_s);
    RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

    JSValue encodingValue = jsUndefined();
    if (optionsValue.pureToBoolean() != TriState::False) {

        encodingValue = optionsValue.get(globalObject, Identifier::fromString(vm, "encoding"_s));
        RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

        if (encodingValue.isUndefinedOrNull()) {
            encodingValue = jsUndefined();
        } else {
            V::validateString(scope, globalObject, encodingValue, "options.encoding"_s);
            RETURN_IF_EXCEPTION(scope, JSValue::encode({}));
        }
    }

    KeyObject keyObject = KeyObject::prepareSecretKey(globalObject, scope, keyValue, encodingValue);
    RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

    auto keyData = keyObject.symmetricKey().span();

    JSArrayBufferView* ivView = nullptr;
    if (!ivValue.isNull()) {
        ivView = getArrayBufferOrView(globalObject, scope, ivValue, "iv"_s, jsUndefined());
        RETURN_IF_EXCEPTION(scope, JSValue::encode({}));
    }

    std::optional<uint32_t> authTagLength = std::nullopt;
    if (optionsValue.pureToBoolean() != TriState::False) {
        JSValue authTagLengthValue = optionsValue.get(globalObject, Identifier::fromString(vm, "authTagLength"_s));
        RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

        if (!authTagLengthValue.isUndefinedOrNull()) {
            std::optional<int32_t> maybeAuthTagLength = authTagLengthValue.tryGetAsInt32();
            if (!maybeAuthTagLength || *maybeAuthTagLength < 0) {
                return ERR::INVALID_ARG_VALUE(scope, globalObject, "options.authTagLength"_s, authTagLengthValue);
            }

            authTagLength = *maybeAuthTagLength;
        }
    }

    WTF::String cipherString = cipherValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

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

    CipherCtxPointer ctx = CipherCtxPointer::New();

    if (cipher.isWrapMode()) {
        ctx.setAllowWrap();
    }

    const bool encrypt = cipherKind == CipherKind::Cipher;
    if (!ctx.init(cipher, encrypt)) {
        throwCryptoError(globalObject, scope, ERR_get_error(), "Failed to initialize cipher"_s);
        return JSValue::encode({});
    }

    int32_t maxMessageSize = 0;
    if (cipher.isSupportedAuthenticatedMode()) {
        initAuthenticated(globalObject, scope, ctx, cipherString, cipherKind, ivLen, authTagLength, maxMessageSize);
        RETURN_IF_EXCEPTION(scope, JSValue::encode({}));
    }

    if (!ctx.setKeyLength(keyData.size())) {
        ctx.reset();
        return ERR::CRYPTO_INVALID_KEYLEN(scope, globalObject);
    }

    if (!ctx.init(Cipher(), encrypt, keyData.data(), ivView ? reinterpret_cast<uint8_t*>(ivView->vector()) : nullptr)) {
        throwCryptoError(globalObject, scope, ERR_get_error(), "Failed to initialize cipher"_s);
    }

    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    JSC::Structure* structure = zigGlobalObject->m_JSCipherClassStructure.get(zigGlobalObject);

    return JSC::JSValue::encode(JSCipher::create(vm, structure, globalObject, cipherKind, WTFMove(ctx), authTagLength, maxMessageSize));
}

} // namespace Bun
