#include "JSCipherPrototype.h"
#include "JSCipher.h"
#include "ErrorCode.h"
#include "CryptoUtil.h"
#include "BunProcess.h"
#include "NodeValidator.h"
#include "JSBufferEncodingType.h"
#include <JavaScriptCore/TypedArrayInlines.h>
#include <JavaScriptCore/JSCJSValueInlines.h>

extern "C" bool Bun__Node__ProcessNoDeprecation;

using namespace Bun;
using namespace JSC;
using namespace WebCore;
using namespace ncrypto;

// Declare host function prototypes
JSC_DECLARE_HOST_FUNCTION(jsCipherUpdate);
JSC_DECLARE_HOST_FUNCTION(jsCipherFinal);
JSC_DECLARE_HOST_FUNCTION(jsCipherSetAutoPadding);
JSC_DECLARE_HOST_FUNCTION(jsCipherGetAuthTag);
JSC_DECLARE_HOST_FUNCTION(jsCipherSetAuthTag);
JSC_DECLARE_HOST_FUNCTION(jsCipherSetAAD);

const JSC::ClassInfo JSCipherPrototype::s_info = { "Cipher"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSCipherPrototype) };

static const JSC::HashTableValue JSCipherPrototypeTableValues[] = {
    { "update"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { HashTableValue::NativeFunctionType, jsCipherUpdate, 2 } },
    { "final"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { HashTableValue::NativeFunctionType, jsCipherFinal, 0 } },
    { "setAutoPadding"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { HashTableValue::NativeFunctionType, jsCipherSetAutoPadding, 1 } },
    { "getAuthTag"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { HashTableValue::NativeFunctionType, jsCipherGetAuthTag, 0 } },
    { "setAuthTag"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { HashTableValue::NativeFunctionType, jsCipherSetAuthTag, 1 } },
    { "setAAD"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { HashTableValue::NativeFunctionType, jsCipherSetAAD, 2 } },
};

void JSCipherPrototype::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSCipherPrototype::info(), JSCipherPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

JSC_DEFINE_HOST_FUNCTION(jsCipherUpdate, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    JSCipher* cipher = jsDynamicCast<JSCipher*>(callFrame->thisValue());
    if (!cipher) {
        throwThisTypeError(*lexicalGlobalObject, scope, "Cipher"_s, "update"_s);
        return {};
    }

    JSValue dataValue = callFrame->argument(0);
    JSValue encodingValue = callFrame->argument(1);

    WTF::String dataString = WTF::nullString();
    WTF::String encodingString = WTF::nullString();

    JSArrayBufferView* dataView = getArrayBufferOrView(lexicalGlobalObject, scope, dataValue, "data"_s, encodingValue);
    RETURN_IF_EXCEPTION(scope, {});

    MarkPopErrorOnReturn popError;

    if (dataView->byteLength() > INT_MAX) {
        return ERR::OUT_OF_RANGE(scope, lexicalGlobalObject, "data is too big"_s, 0, INT_MAX, jsNumber(dataView->byteLength()));
    }

    if (!cipher->m_ctx) {
        throwCryptoError(lexicalGlobalObject, scope, popError.peekError(), "Trying to add data in unsupported state");
        return {};
    }

    if (cipher->m_ctx.isCcmMode() && !cipher->checkCCMMessageLength(dataView->byteLength())) {
        // return undefined
        // https://github.com/nodejs/node/blob/6b4255434226491449b7d925038008439e5586b2/src/crypto/crypto_cipher.cc#L742
        return JSValue::encode(jsUndefined());
    }

    if (cipher->m_kind == CipherKind::Decipher && cipher->isAuthenticatedMode()) {
        ASSERT(cipher->maybePassAuthTagToOpenSSL());
    }

    const int32_t blockSize = cipher->m_ctx.getBlockSize();
    if (dataView->byteLength() + blockSize > INT_MAX) {
        throwCryptoError(lexicalGlobalObject, scope, popError.peekError(), "Trying to add data in unsupported state");
        return {};
    }
    int32_t bufLen = dataView->byteLength() + blockSize;

    ncrypto::Buffer<const uint8_t> buf {
        .data = reinterpret_cast<uint8_t*>(dataView->vector()),
        .len = dataView->byteLength(),
    };

    if (cipher->m_kind == CipherKind::Cipher && cipher->m_ctx.isWrapMode() && !cipher->m_ctx.update(buf, nullptr, &bufLen)) {
        throwCryptoError(lexicalGlobalObject, scope, popError.peekError(), "Trying to add data in unsupported state");
        return {};
    }

    RefPtr<ArrayBuffer> outBuf = JSC::ArrayBuffer::tryCreateUninitialized(bufLen, 1);
    if (!outBuf) {
        throwOutOfMemoryError(lexicalGlobalObject, scope);
        return {};
    }

    buf = {
        .data = reinterpret_cast<uint8_t*>(dataView->vector()),
        .len = dataView->byteLength(),
    };

    bool res = cipher->m_ctx.update(buf, static_cast<unsigned char*>(outBuf->data()), &bufLen);
    ASSERT(static_cast<size_t>(bufLen) <= outBuf->byteLength());

    if (!res && cipher->m_kind == CipherKind::Decipher && cipher->m_ctx.isCcmMode()) {
        cipher->m_pendingAuthFailed = true;
        RELEASE_AND_RETURN(scope, JSValue::encode(JSUint8Array::create(lexicalGlobalObject, globalObject->JSBufferSubclassStructure(), WTF::move(outBuf), 0, bufLen)));
    }

    if (res != 1) {
        throwCryptoError(lexicalGlobalObject, scope, popError.peekError(), "Trying to add data in unsupported state");
        return {};
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(JSUint8Array::create(lexicalGlobalObject, globalObject->JSBufferSubclassStructure(), WTF::move(outBuf), 0, bufLen)));
}

JSC_DEFINE_HOST_FUNCTION(jsCipherFinal, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    MarkPopErrorOnReturn popError;

    JSCipher* cipher = jsDynamicCast<JSCipher*>(callFrame->thisValue());
    if (!cipher) {
        throwThisTypeError(*lexicalGlobalObject, scope, "Cipher"_s, "final"_s);
        return {};
    }

    if (!cipher->m_ctx) {
        return ERR::CRYPTO_INVALID_STATE(scope, lexicalGlobalObject, "final"_s);
    }

    const bool isAuthMode = cipher->isAuthenticatedMode();

    auto throwCryptoErrorWithAuth = [isAuthMode, &popError](JSGlobalObject* globalObject, ThrowScope& scope) {
        throwCryptoError(globalObject, scope, popError.peekError(), isAuthMode ? "Unsupported state or unable to authenticate data" : "Unsupported state");
    };

    int32_t outLen = cipher->m_ctx.getBlockSize();
    RefPtr<ArrayBuffer> outBuf = ArrayBuffer::tryCreateUninitialized(outLen, 1);
    if (!outBuf) {
        throwOutOfMemoryError(lexicalGlobalObject, scope);
        return {};
    }

    if (cipher->m_kind == CipherKind::Decipher && Cipher::FromCtx(cipher->m_ctx).isSupportedAuthenticatedMode()) {
        cipher->maybePassAuthTagToOpenSSL();
    }

    if (cipher->m_kind == CipherKind::Decipher && cipher->m_ctx.isChaCha20Poly1305() && cipher->m_authTagState != AuthTagState::AuthTagPassedToOpenSSL) {
        throwCryptoErrorWithAuth(lexicalGlobalObject, scope);
        return {};
    }

    bool ok;
    if (cipher->m_kind == CipherKind::Decipher && cipher->m_ctx.isCcmMode()) {
        ok = !cipher->m_pendingAuthFailed;
        outLen = 0;
    } else {
        ok = cipher->m_ctx.update({}, static_cast<unsigned char*>(outBuf->data()), &outLen, true);
        ASSERT(outLen <= outBuf->byteLength());

        if (ok && cipher->m_kind == CipherKind::Cipher && cipher->isAuthenticatedMode()) {
            if (!cipher->m_authTagLen.has_value()) {
                ASSERT(cipher->m_ctx.isGcmMode());
                cipher->m_authTagLen = sizeof(cipher->m_authTag);
            }

            ok = cipher->m_ctx.getAeadTag(*cipher->m_authTagLen, reinterpret_cast<unsigned char*>(cipher->m_authTag));
        }
    }

    cipher->m_ctx.reset();

    if (!ok) {
        throwCryptoErrorWithAuth(lexicalGlobalObject, scope);
        return {};
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(JSUint8Array::create(lexicalGlobalObject, globalObject->JSBufferSubclassStructure(), WTF::move(outBuf), 0, outLen)));
}

JSC_DEFINE_HOST_FUNCTION(jsCipherSetAutoPadding, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSCipher* cipher = jsDynamicCast<JSCipher*>(callFrame->thisValue());
    if (!cipher) {
        throwThisTypeError(*globalObject, scope, "Cipher"_s, "setAutoPadding"_s);
        return {};
    }

    JSValue paddingValue = callFrame->argument(0);

    bool padding = paddingValue.toBoolean(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    MarkPopErrorOnReturn popError;
    if (!cipher->m_ctx.setPadding(padding)) {
        return ERR::CRYPTO_INVALID_STATE(scope, globalObject, "setAutoPadding"_s);
    }

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsCipherGetAuthTag, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSCipher* cipher = jsDynamicCast<JSCipher*>(callFrame->thisValue());
    if (!cipher) {
        throwThisTypeError(*lexicalGlobalObject, scope, "Cipher"_s, "getAuthTag"_s);
        return {};
    }

    if (cipher->m_ctx || cipher->m_kind != CipherKind::Cipher || !cipher->m_authTagLen) {
        return ERR::CRYPTO_INVALID_STATE(scope, lexicalGlobalObject, "getAuthTag"_s);
    }

    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    JSC::JSUint8Array* buf = JSC::JSUint8Array::createUninitialized(lexicalGlobalObject, globalObject->JSBufferSubclassStructure(), *cipher->m_authTagLen);
    RETURN_IF_EXCEPTION(scope, {});
    if (!buf) {
        throwOutOfMemoryError(lexicalGlobalObject, scope);
        return {};
    }

    memcpy(buf->vector(), cipher->m_authTag, *cipher->m_authTagLen);

    return JSValue::encode(buf);
}

JSC_DEFINE_HOST_FUNCTION(jsCipherSetAuthTag, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSCipher* cipher = jsDynamicCast<JSCipher*>(callFrame->thisValue());
    if (!cipher) {
        throwThisTypeError(*globalObject, scope, "Cipher"_s, "setAuthTag"_s);
        return {};
    }

    JSValue authTagValue = callFrame->argument(0);
    JSValue encodingValue = callFrame->argument(1);
    JSArrayBufferView* authTag = getArrayBufferOrView(globalObject, scope, authTagValue, "buffer"_s, encodingValue);
    RETURN_IF_EXCEPTION(scope, {});
    ASSERT(authTag);

    if (!cipher->m_ctx || !cipher->isAuthenticatedMode() || cipher->m_kind != CipherKind::Decipher || cipher->m_authTagState != AuthTagState::AuthTagUnknown) {
        return ERR::CRYPTO_INVALID_STATE(scope, globalObject, "setAuthTag"_s);
    }

    if (authTag->byteLength() > INT_MAX) {
        return ERR::OUT_OF_RANGE(scope, globalObject, "buffer is too big"_s, 0, INT_MAX, jsNumber(authTag->byteLength()));
    }

    uint32_t tagLen = authTag->byteLength();

    bool isValid;
    if (cipher->m_ctx.isGcmMode()) {
        isValid = (!cipher->m_authTagLen.has_value() || *cipher->m_authTagLen == tagLen) && Cipher::IsValidGCMTagLength(tagLen);
    } else {
        ASSERT(Cipher::FromCtx(cipher->m_ctx).isSupportedAuthenticatedMode());
        ASSERT(cipher->m_authTagLen.has_value());
        isValid = *cipher->m_authTagLen == tagLen;
    }

    if (!isValid) {
        WTF::StringBuilder builder;
        builder.append("Invalid authentication tag length: "_s);
        builder.append(tagLen);
        return ERR::CRYPTO_INVALID_AUTH_TAG(scope, globalObject, builder.toString());
    }

    if (cipher->m_ctx.isGcmMode() && !cipher->m_authTagLen.has_value() && tagLen != 16 && !Bun__Node__ProcessNoDeprecation) {
        Bun::Process::emitWarning(globalObject, jsString(vm, makeString("Using AES-GCM authentication tags of less than 128 bits without specifying the authTagLength option when initializing decryption is deprecated."_s)), jsString(vm, makeString("DeprecationWarning"_s)), jsString(vm, makeString("DEP0182"_s)), jsUndefined());
        CLEAR_IF_EXCEPTION(scope);
    }

    cipher->m_authTagLen = tagLen;
    cipher->m_authTagState = AuthTagState::AuthTagKnown;

    memset(cipher->m_authTag, 0, sizeof(cipher->m_authTag));
    memcpy(cipher->m_authTag, authTag->vector(), *cipher->m_authTagLen);

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsCipherSetAAD, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSCipher* cipher = jsDynamicCast<JSCipher*>(callFrame->thisValue());
    if (!cipher) {
        throwThisTypeError(*globalObject, scope, "Cipher"_s, "setAAD"_s);
        return {};
    }

    JSValue aadbufValue = callFrame->argument(0);
    JSValue optionsValue = callFrame->argument(1);

    JSValue encodingValue = jsUndefined();
    std::optional<uint32_t> plaintextLength = std::nullopt;
    if (optionsValue.pureToBoolean() != TriState::False) {
        encodingValue = optionsValue.get(globalObject, Identifier::fromString(vm, "encoding"_s));
        RETURN_IF_EXCEPTION(scope, {});

        if (!encodingValue.isUndefinedOrNull()) {
            V::validateString(scope, globalObject, encodingValue, "options.encoding"_s);
            RETURN_IF_EXCEPTION(scope, {});
        }

        JSValue plaintextLengthValue = optionsValue.get(globalObject, Identifier::fromString(vm, "plaintextLength"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!plaintextLengthValue.isUndefinedOrNull()) {
            std::optional<int32_t> maybePlaintextLength = plaintextLengthValue.tryGetAsInt32();
            if (!maybePlaintextLength || *maybePlaintextLength < 0) {
                return ERR::INVALID_ARG_VALUE(scope, globalObject, "options.plaintextLength"_s, plaintextLengthValue);
            }

            plaintextLength = *maybePlaintextLength;
        }
    }

    JSArrayBufferView* aadbuf = getArrayBufferOrView(globalObject, scope, aadbufValue, "aadbuf"_s, encodingValue);
    RETURN_IF_EXCEPTION(scope, {});
    ASSERT(aadbuf);

    if (aadbuf->byteLength() > std::numeric_limits<int>::max()) {
        return ERR::OUT_OF_RANGE(scope, globalObject, "buffer is too big"_s, 0, INT_MAX, jsNumber(aadbuf->byteLength()));
    }

    MarkPopErrorOnReturn popError;

    int32_t outlen;

    if (cipher->m_ctx.isCcmMode()) {
        if (!plaintextLength.has_value()) {
            return ERR::MISSING_ARGS(scope, globalObject, "options.plaintextLength required for CCM mode with AAD"_s);
        }

        if (!cipher->checkCCMMessageLength(*plaintextLength)) {
            return ERR::CRYPTO_INVALID_MESSAGELEN(scope, globalObject);
        }

        if (cipher->m_kind == CipherKind::Decipher && !cipher->maybePassAuthTagToOpenSSL()) {
            return ERR::CRYPTO_INVALID_STATE(scope, globalObject, "setAAD"_s);
        }

        ncrypto::Buffer<const unsigned char> buf {
            .data = nullptr,
            .len = static_cast<size_t>(*plaintextLength),
        };

        if (!cipher->m_ctx.update(buf, nullptr, &outlen)) {
            return ERR::CRYPTO_INVALID_STATE(scope, globalObject, "setAAD"_s);
        }
    }

    ncrypto::Buffer<const unsigned char> buf {
        .data = reinterpret_cast<uint8_t*>(aadbuf->vector()),
        .len = aadbuf->byteLength(),
    };

    if (!cipher->m_ctx.update(buf, nullptr, &outlen)) {
        return ERR::CRYPTO_INVALID_STATE(scope, globalObject, "setAAD"_s);
    }

    return JSValue::encode(jsUndefined());
}
