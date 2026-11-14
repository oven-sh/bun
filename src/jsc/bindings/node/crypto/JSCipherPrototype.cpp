#include "JSCipherPrototype.h"
#include "JSCipher.h"
#include "ErrorCode.h"
#include "CryptoUtil.h"
#include "NodeValidator.h"
#include "JSBufferEncodingType.h"
#include <JavaScriptCore/TypedArrayInlines.h>
#include <JavaScriptCore/JSCJSValueInlines.h>

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
    Bun::reifyStaticPropertyTable(vm, JSCipherPrototype::info(), JSCipherPrototypeTableValues, *this);
    Bun::putToStringTagWithoutTransition(vm, this, info());
}

JSC_DEFINE_HOST_FUNCTION(jsCipherUpdate, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    JSCipher* cipher = dynamicDowncast<JSCipher>(callFrame->thisValue());
    if (!cipher) {
        throwThisTypeError(*lexicalGlobalObject, scope, "Cipher"_s, "update"_s);
        return {};
    }

    JSValue dataValue = callFrame->argument(0);
    JSValue encodingValue = callFrame->argument(1);

    // https://github.com/nodejs/node/blob/v26.12.1/lib/internal/crypto/cipher.js#L185-L191
    // An encoding that is not known is UTF-8, as in the other update() methods.
    auto encoding = BufferEncodingType::utf8;
    if (dataValue.isString()) {
        encoding = parseEnumeration<BufferEncodingType>(*lexicalGlobalObject, encodingValue).value_or(BufferEncodingType::utf8);
        RETURN_IF_EXCEPTION(scope, {});
        unsigned length = asString(dataValue)->length();
        if (encoding == BufferEncodingType::hex && length % 2 != 0) {
            return Bun::ERR::INVALID_ARG_VALUE(scope, lexicalGlobalObject, "encoding"_s, encodingValue, makeString("is invalid for data of length "_s, length));
        }
    } else if (!dataValue.inherits<JSArrayBufferView>()) {
        return ERR::INVALID_ARG_TYPE_INSTANCE(scope, lexicalGlobalObject, "data"_s, "string"_s, "Buffer, TypedArray, or DataView"_s, dataValue);
    }

    JSArrayBufferView* dataView = getArrayBufferOrView(lexicalGlobalObject, scope, dataValue, "data"_s, encoding);
    RETURN_IF_EXCEPTION(scope, {});

    // Read once: the length of a length-tracking view is not fixed.
    const std::span<const uint8_t> data = dataView->span();

    ClearErrorOnReturn clearErrorOnReturn;

    if (data.size() > INT_MAX) {
        return ERR::OUT_OF_RANGE(scope, lexicalGlobalObject, "data is too big"_s, 0, INT_MAX, jsNumber(data.size()));
    }

    if (!cipher->m_ctx) {
        throwCryptoError(lexicalGlobalObject, scope, ERR_peek_error(), "Trying to add data in unsupported state");
        return {};
    }

    if (cipher->m_ctx.isCcmMode() && !cipher->checkCCMMessageLength(data.size())) {
        // return undefined
        // https://github.com/nodejs/node/blob/6b4255434226491449b7d925038008439e5586b2/src/crypto/crypto_cipher.cc#L742
        return JSValue::encode(jsUndefined());
    }

    if (cipher->m_kind == CipherKind::Decipher && cipher->isAuthenticatedMode()) {
        bool passed = cipher->maybePassAuthTagToOpenSSL();
        ASSERT_UNUSED(passed, passed);
    }

    if (data.size() + cipher->m_ctx.getBlockSize() > INT_MAX) {
        throwCryptoError(lexicalGlobalObject, scope, ERR_peek_error(), "Trying to add data in unsupported state");
        return {};
    }

    RefPtr<ArrayBuffer> outBuf = JSC::ArrayBuffer::tryCreateUninitialized(cipher->heldBackBlock().size() + EVP_CIPHER_CTX_max_next_update(cipher->m_ctx, data.size()), 1);
    if (!outBuf) {
        throwOutOfMemoryError(lexicalGlobalObject, scope);
        return {};
    }
    size_t outLen = cipher->takeHeldBackBlock(outBuf->mutableSpan());

    auto out = outBuf->mutableSpan().subspan(outLen);
    size_t written = 0;
    bool res = EVP_CipherUpdate_ex(cipher->m_ctx, out.data(), &written, out.size(), data.data(), data.size()) == 1;
    ensureStillAliveHere(dataView);
    outLen += written;

    if (!res && cipher->m_kind == CipherKind::Decipher && cipher->m_ctx.isCcmMode()) {
        cipher->m_pendingAuthFailed = true;
        RELEASE_AND_RETURN(scope, JSValue::encode(JSUint8Array::create(lexicalGlobalObject, globalObject->JSBufferSubclassStructure(), 0)));
    }

    if (!res) {
        throwCryptoError(lexicalGlobalObject, scope, ERR_peek_error(), "Trying to add data in unsupported state");
        return {};
    }

    // The result's ArrayBuffer is as long as what was written, like Node's. BoringSSL documents
    // EVP_CIPHER_CTX_max_next_update() as an upper bound, but it is exact today, so nothing is copied.
    if (outLen != outBuf->byteLength())
        outBuf = ArrayBuffer::tryCreate(outBuf->span().first(outLen));
    if (!outBuf) {
        throwOutOfMemoryError(lexicalGlobalObject, scope);
        return {};
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(createBuffer(lexicalGlobalObject, outBuf.releaseNonNull())));
}

JSC_DEFINE_HOST_FUNCTION(jsCipherFinal, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    ClearErrorOnReturn clearErrorOnReturn;

    JSCipher* cipher = dynamicDowncast<JSCipher>(callFrame->thisValue());
    if (!cipher) {
        throwThisTypeError(*lexicalGlobalObject, scope, "Cipher"_s, "final"_s);
        return {};
    }

    if (!cipher->m_ctx) {
        // Node throws the bare "Invalid state" here (CipherBase::Final in crypto_cipher.cc);
        // only the JS-layer checks name an operation.
        return ERR::CRYPTO_INVALID_STATE(scope, lexicalGlobalObject, "Invalid state"_s);
    }

    const bool isAuthMode = cipher->isAuthenticatedMode();

    auto throwCryptoErrorWithAuth = [isAuthMode](JSGlobalObject* globalObject, ThrowScope& scope) {
        throwCryptoError(globalObject, scope, ERR_peek_error(), isAuthMode ? "Unsupported state or unable to authenticate data" : "Unsupported state");
    };

    // Room for the held-back block and the last one.
    uint8_t out[2 * EVP_MAX_BLOCK_LENGTH];
    size_t outLen = cipher->takeHeldBackBlock(out);

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
    } else {
        size_t written = 0;
        ok = EVP_CipherFinal_ex2(cipher->m_ctx, out + outLen, &written, sizeof(out) - outLen) == 1;
        outLen += written;

        if (ok && cipher->m_kind == CipherKind::Cipher && cipher->isAuthenticatedMode()) {
            ASSERT(cipher->m_authTagLen.has_value());
            ok = cipher->m_ctx.getAeadTag(*cipher->m_authTagLen, reinterpret_cast<unsigned char*>(cipher->m_authTag));
        }
    }

    cipher->m_ctx.reset();
    cipher->m_sizeForGC = 0;

    if (!ok) {
        throwCryptoErrorWithAuth(lexicalGlobalObject, scope);
        return {};
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(createBuffer(lexicalGlobalObject, std::span { out }.first(outLen))));
}

JSC_DEFINE_HOST_FUNCTION(jsCipherSetAutoPadding, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSCipher* cipher = dynamicDowncast<JSCipher>(callFrame->thisValue());
    if (!cipher) {
        throwThisTypeError(*globalObject, scope, "Cipher"_s, "setAutoPadding"_s);
        return {};
    }

    JSValue paddingValue = callFrame->argument(0);

    bool padding = paddingValue.toBoolean(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    MarkPopErrorOnReturn popError;
    if (!cipher->m_ctx.setPadding(padding)) {
        return ERR::CRYPTO_INVALID_STATE(scope, globalObject, "Invalid state for operation setAutoPadding"_s);
    }

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsCipherGetAuthTag, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSCipher* cipher = dynamicDowncast<JSCipher>(callFrame->thisValue());
    if (!cipher) {
        throwThisTypeError(*lexicalGlobalObject, scope, "Cipher"_s, "getAuthTag"_s);
        return {};
    }

    if (cipher->m_ctx || cipher->m_kind != CipherKind::Cipher || !cipher->m_authTagLen) {
        return ERR::CRYPTO_INVALID_STATE(scope, lexicalGlobalObject, "Invalid state for operation getAuthTag"_s);
    }

    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    JSC::JSUint8Array* buf = JSC::JSUint8Array::createUninitialized(lexicalGlobalObject, globalObject->JSBufferSubclassStructure(), *cipher->m_authTagLen);
    RETURN_IF_EXCEPTION(scope, {});

    memcpy(buf->vector(), cipher->m_authTag, *cipher->m_authTagLen);

    return JSValue::encode(buf);
}

JSC_DEFINE_HOST_FUNCTION(jsCipherSetAuthTag, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSCipher* cipher = dynamicDowncast<JSCipher>(callFrame->thisValue());
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
        return ERR::CRYPTO_INVALID_STATE(scope, globalObject, "Invalid state for operation setAuthTag"_s);
    }

    if (authTag->byteLength() > INT_MAX) {
        return ERR::OUT_OF_RANGE(scope, globalObject, "buffer is too big"_s, 0, INT_MAX, jsNumber(authTag->byteLength()));
    }

    uint32_t tagLen = authTag->byteLength();

    // m_authTagLen is always set at construction, so the supplied tag must match exactly;
    // Node 26 no longer accepts implicit short GCM tags (former DEP0182).
    ASSERT(cipher->m_authTagLen.has_value());
    if (*cipher->m_authTagLen != tagLen) {
        WTF::StringBuilder builder;
        builder.append("Invalid authentication tag length: "_s);
        builder.append(tagLen);
        return ERR::CRYPTO_INVALID_AUTH_TAG(scope, globalObject, builder.toString());
    }

    cipher->m_authTagState = AuthTagState::AuthTagKnown;

    memset(cipher->m_authTag, 0, sizeof(cipher->m_authTag));
    memcpy(cipher->m_authTag, authTag->vector(), *cipher->m_authTagLen);

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsCipherSetAAD, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSCipher* cipher = dynamicDowncast<JSCipher>(callFrame->thisValue());
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

    // Passing a NULL output buffer to EVP_CipherUpdate is only valid for AEAD
    // modes; for any other mode it writes the ciphertext through the NULL pointer.
    if (!cipher->m_ctx || !cipher->isAuthenticatedMode()) {
        return ERR::CRYPTO_INVALID_STATE(scope, globalObject, "Invalid state for operation setAAD"_s);
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
            return ERR::CRYPTO_INVALID_STATE(scope, globalObject, "Invalid state for operation setAAD"_s);
        }

        ncrypto::Buffer<const unsigned char> buf {
            .data = nullptr,
            .len = static_cast<size_t>(*plaintextLength),
        };

        if (!cipher->m_ctx.update(buf, nullptr, &outlen)) {
            return ERR::CRYPTO_INVALID_STATE(scope, globalObject, "Invalid state for operation setAAD"_s);
        }
    }

    ncrypto::Buffer<const unsigned char> buf {
        .data = reinterpret_cast<uint8_t*>(aadbuf->vector()),
        .len = aadbuf->byteLength(),
    };

    if (!cipher->m_ctx.update(buf, nullptr, &outlen)) {
        return ERR::CRYPTO_INVALID_STATE(scope, globalObject, "Invalid state for operation setAAD"_s);
    }

    return JSValue::encode(jsUndefined());
}
