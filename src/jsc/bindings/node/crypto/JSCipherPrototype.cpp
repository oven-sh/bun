#include "JSCipherPrototype.h"
#include "JSCipher.h"
#include "ErrorCode.h"
#include "CryptoUtil.h"
#include "NodeValidator.h"
#include "JSBufferEncodingType.h"
#include "JSStringDecoder.h"
#include "LazyTransform.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/TypedArrayInlines.h>
#include <JavaScriptCore/JSCJSValueInlines.h>

using namespace Bun;
using namespace JSC;
using namespace WebCore;
using namespace ncrypto;

JSC_DECLARE_HOST_FUNCTION(jsCipherUpdate);
JSC_DECLARE_HOST_FUNCTION(jsCipherFinal);
JSC_DECLARE_HOST_FUNCTION(jsCipherSetAutoPadding);
JSC_DECLARE_HOST_FUNCTION(jsCipherGetAuthTag);
JSC_DECLARE_HOST_FUNCTION(jsCipherSetAuthTag);
JSC_DECLARE_HOST_FUNCTION(jsCipherSetAAD);
JSC_DECLARE_HOST_FUNCTION(jsCipherTransform);
JSC_DECLARE_HOST_FUNCTION(jsCipherFlush);

const JSC::ClassInfo JSCipherPrototype::s_info = { "Cipher"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSCipherPrototype) };

// Enumerable, like the prototype assignments in Node's lib/internal/crypto/cipher.js.
static const JSC::HashTableValue JSCipherivPrototypeTableValues[] = {
    { "_transform"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { HashTableValue::NativeFunctionType, jsCipherTransform, 3 } },
    { "_flush"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { HashTableValue::NativeFunctionType, jsCipherFlush, 1 } },
    { "update"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { HashTableValue::NativeFunctionType, jsCipherUpdate, 3 } },
    { "final"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { HashTableValue::NativeFunctionType, jsCipherFinal, 1 } },
    { "setAutoPadding"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { HashTableValue::NativeFunctionType, jsCipherSetAutoPadding, 1 } },
    { "getAuthTag"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { HashTableValue::NativeFunctionType, jsCipherGetAuthTag, 0 } },
    { "setAAD"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { HashTableValue::NativeFunctionType, jsCipherSetAAD, 2 } },
    { "_readableState"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor), JSC::NoIntrinsic, { HashTableValue::GetterSetterType, jsLazyTransformStateGetter, jsLazyTransformStateSetter } },
    { "_writableState"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor), JSC::NoIntrinsic, { HashTableValue::GetterSetterType, jsLazyTransformStateGetter, jsLazyTransformStateSetter } },
};

static const JSC::HashTableValue JSDecipherivPrototypeTableValues[] = {
    { "_transform"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { HashTableValue::NativeFunctionType, jsCipherTransform, 3 } },
    { "_flush"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { HashTableValue::NativeFunctionType, jsCipherFlush, 1 } },
    { "update"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { HashTableValue::NativeFunctionType, jsCipherUpdate, 3 } },
    { "final"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { HashTableValue::NativeFunctionType, jsCipherFinal, 1 } },
    { "setAutoPadding"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { HashTableValue::NativeFunctionType, jsCipherSetAutoPadding, 1 } },
    { "setAuthTag"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { HashTableValue::NativeFunctionType, jsCipherSetAuthTag, 2 } },
    { "setAAD"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { HashTableValue::NativeFunctionType, jsCipherSetAAD, 2 } },
    { "_readableState"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor), JSC::NoIntrinsic, { HashTableValue::GetterSetterType, jsLazyTransformStateGetter, jsLazyTransformStateSetter } },
    { "_writableState"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor), JSC::NoIntrinsic, { HashTableValue::GetterSetterType, jsLazyTransformStateGetter, jsLazyTransformStateSetter } },
};

void JSCipherPrototype::finishCreation(JSC::VM& vm, CipherKind kind)
{
    Base::finishCreation(vm);
    if (kind == CipherKind::Cipher)
        Bun::reifyStaticPropertyTable(vm, JSCipherPrototype::info(), JSCipherivPrototypeTableValues, *this);
    else
        Bun::reifyStaticPropertyTable(vm, JSCipherPrototype::info(), JSDecipherivPrototypeTableValues, *this);
}

// The Buffer produced by feeding `data` to the cipher (undefined when a CCM message is over the length limit).
static EncodedJSValue cipherUpdate(JSC::JSGlobalObject* lexicalGlobalObject, JSCipher* cipher, JSValue dataValue, JSValue encodingValue)
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

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
        RELEASE_AND_RETURN(scope, JSValue::encode(JSUint8Array::create(lexicalGlobalObject, globalObject->JSBufferSubclassStructure(), 0)));
    }

    if (res != 1) {
        throwCryptoError(lexicalGlobalObject, scope, popError.peekError(), "Trying to add data in unsupported state");
        return {};
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(JSUint8Array::create(lexicalGlobalObject, globalObject->JSBufferSubclassStructure(), WTF::move(outBuf), 0, bufLen)));
}

// The Buffer holding any remaining output; finalizes the cipher.
static EncodedJSValue cipherFinal(JSC::JSGlobalObject* lexicalGlobalObject, JSCipher* cipher)
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    MarkPopErrorOnReturn popError;

    if (!cipher->m_ctx) {
        // Node throws the bare "Invalid state" here (CipherBase::Final in crypto_cipher.cc);
        // only the JS-layer checks name an operation.
        return ERR::CRYPTO_INVALID_STATE(scope, lexicalGlobalObject, "Invalid state"_s);
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

    RELEASE_AND_RETURN(scope, JSValue::encode(JSUint8Array::create(lexicalGlobalObject, globalObject->JSBufferSubclassStructure(), WTF::move(outBuf), 0, outLen)));
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

    return JSValue::encode(callFrame->thisValue());
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

    return JSValue::encode(callFrame->thisValue());
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

    return JSValue::encode(callFrame->thisValue());
}

// update()/final() with an outputEncoding: run the bytes through this._decoder (a StringDecoder
// created on first use, as in Node) so multi-byte characters split across calls decode correctly.
static EncodedJSValue encodeCipherOutput(JSC::JSGlobalObject* lexicalGlobalObject, JSCipher* cipher, JSValue output, JSValue outputEncodingValue, bool end)
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    auto* outputView = dynamicDowncast<JSArrayBufferView>(output);
    if (!outputView)
        return JSValue::encode(output);

    auto outputEncodingString = outputEncodingValue.toWTFString(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto outputEncoding = parseEnumerationFromString<BufferEncodingType>(outputEncodingString);

    Identifier decoderName = Identifier::fromString(vm, "_decoder"_s);
    JSValue decoderValue = cipher->get(lexicalGlobalObject, decoderName);
    RETURN_IF_EXCEPTION(scope, {});
    if (decoderValue.isUndefinedOrNull()) {
        if (!outputEncoding)
            return ERR::UNKNOWN_ENCODING(scope, lexicalGlobalObject, outputEncodingString);
        decoderValue = JSStringDecoder::create(vm, lexicalGlobalObject, globalObject->JSStringDecoderStructure(), *outputEncoding);
        cipher->putDirect(vm, decoderName, decoderValue, 0);
    }

    if (auto* decoder = dynamicDowncast<JSStringDecoder>(decoderValue)) {
        if (!outputEncoding || decoder->m_encoding != *outputEncoding) {
            if (!outputEncoding)
                return ERR::UNKNOWN_ENCODING(scope, lexicalGlobalObject, outputEncodingString);
            // https://github.com/nodejs/node/blob/6b4255434226491449b7d925038008439e5586b2/lib/internal/crypto/cipher.js#L100
            return throwError(lexicalGlobalObject, scope, ErrorCode::ERR_INTERNAL_ASSERTION, "Cannot change encoding"_s);
        }
        auto* bytes = static_cast<uint8_t*>(outputView->vector());
        uint32_t length = outputView->byteLength();
        JSString* result = end ? decoder->end(vm, lexicalGlobalObject, bytes, length) : decoder->write(vm, lexicalGlobalObject, bytes, length);
        RETURN_IF_EXCEPTION(scope, {});
        return JSValue::encode(result);
    }

    // Someone replaced this._decoder: use it like Node would.
    JSValue method = decoderValue.get(lexicalGlobalObject, Identifier::fromString(vm, end ? "end"_s : "write"_s));
    RETURN_IF_EXCEPTION(scope, {});
    auto callData = JSC::getCallData(method);
    if (callData.type == CallData::Type::None)
        return throwVMTypeError(lexicalGlobalObject, scope, end ? "this._decoder.end is not a function"_s : "this._decoder.write is not a function"_s);
    MarkedArgumentBuffer args;
    args.append(output);
    RELEASE_AND_RETURN(scope, JSValue::encode(JSC::profiledCall(lexicalGlobalObject, ProfilingReason::API, method, callData, decoderValue, args)));
}

static bool wantsStringOutput(JSC::JSGlobalObject* globalObject, JSValue outputEncodingValue)
{
    // `if (outputEncoding && outputEncoding !== "buffer")`
    if (!outputEncodingValue.toBoolean(globalObject))
        return false;
    if (!outputEncodingValue.isString())
        return true;
    auto encoding = asString(outputEncodingValue)->tryGetValue();
    return !WTF::equal(static_cast<const WTF::String&>(encoding), "buffer"_s);
}

// cipher.update(data[, inputEncoding][, outputEncoding])
JSC_DEFINE_HOST_FUNCTION(jsCipherUpdate, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSCipher* cipher = dynamicDowncast<JSCipher>(callFrame->thisValue());
    if (!cipher) {
        throwThisTypeError(*globalObject, scope, "Cipher"_s, "update"_s);
        return {};
    }

    JSValue output = JSValue::decode(cipherUpdate(globalObject, cipher, callFrame->argument(0), callFrame->argument(1)));
    RETURN_IF_EXCEPTION(scope, {});

    JSValue outputEncoding = callFrame->argument(2);
    if (!wantsStringOutput(globalObject, outputEncoding))
        return JSValue::encode(output);
    RELEASE_AND_RETURN(scope, encodeCipherOutput(globalObject, cipher, output, outputEncoding, false));
}

// cipher.final([outputEncoding])
JSC_DEFINE_HOST_FUNCTION(jsCipherFinal, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSCipher* cipher = dynamicDowncast<JSCipher>(callFrame->thisValue());
    if (!cipher) {
        throwThisTypeError(*globalObject, scope, "Cipher"_s, "final"_s);
        return {};
    }

    JSValue output = JSValue::decode(cipherFinal(globalObject, cipher));
    RETURN_IF_EXCEPTION(scope, {});

    JSValue outputEncoding = callFrame->argument(0);
    if (!wantsStringOutput(globalObject, outputEncoding))
        return JSValue::encode(output);
    RELEASE_AND_RETURN(scope, encodeCipherOutput(globalObject, cipher, output, outputEncoding, true));
}

static void callWith(JSC::JSGlobalObject* globalObject, JSValue function, JSValue thisValue, JSValue argument, ASCIILiteral notCallableMessage)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto callData = JSC::getCallData(function);
    if (callData.type == CallData::Type::None) [[unlikely]] {
        throwTypeError(globalObject, scope, notCallableMessage);
        return;
    }
    MarkedArgumentBuffer args;
    if (argument)
        args.append(argument);
    JSC::profiledCall(globalObject, ProfilingReason::API, function, callData, thisValue, args);
    RETURN_IF_EXCEPTION(scope, void());
}

// Transform hook: _transform(chunk, encoding, callback) — this.push(this.update(chunk, encoding)); callback()
JSC_DEFINE_HOST_FUNCTION(jsCipherTransform, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue thisValue = callFrame->thisValue();
    JSCipher* cipher = dynamicDowncast<JSCipher>(thisValue);
    if (!cipher) {
        throwThisTypeError(*globalObject, scope, "Cipher"_s, "_transform"_s);
        return {};
    }

    JSValue output = JSValue::decode(cipherUpdate(globalObject, cipher, callFrame->argument(0), callFrame->argument(1)));
    RETURN_IF_EXCEPTION(scope, {});
    JSValue push = cipher->get(globalObject, Identifier::fromString(vm, "push"_s));
    RETURN_IF_EXCEPTION(scope, {});
    callWith(globalObject, push, thisValue, output, "this.push is not a function"_s);
    RETURN_IF_EXCEPTION(scope, {});
    callWith(globalObject, callFrame->argument(2), jsUndefined(), JSValue(), "callback is not a function"_s);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

// Transform hook: _flush(callback) — push this.final(); an error from final() goes to the callback.
JSC_DEFINE_HOST_FUNCTION(jsCipherFlush, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue thisValue = callFrame->thisValue();
    JSCipher* cipher = dynamicDowncast<JSCipher>(thisValue);
    if (!cipher) {
        throwThisTypeError(*globalObject, scope, "Cipher"_s, "_flush"_s);
        return {};
    }
    JSValue callback = callFrame->argument(0);

    JSValue output = JSValue::decode(cipherFinal(globalObject, cipher));
    if (JSC::Exception* exception = scope.exception()) {
        if (!scope.tryClearException())
            return {};
        callWith(globalObject, callback, jsUndefined(), exception->value(), "callback is not a function"_s);
        RETURN_IF_EXCEPTION(scope, {});
        return JSValue::encode(jsUndefined());
    }

    JSValue push = cipher->get(globalObject, Identifier::fromString(vm, "push"_s));
    RETURN_IF_EXCEPTION(scope, {});
    callWith(globalObject, push, thisValue, output, "this.push is not a function"_s);
    if (JSC::Exception* exception = scope.exception()) {
        if (!scope.tryClearException())
            return {};
        callWith(globalObject, callback, jsUndefined(), exception->value(), "callback is not a function"_s);
        RETURN_IF_EXCEPTION(scope, {});
        return JSValue::encode(jsUndefined());
    }

    callWith(globalObject, callback, jsUndefined(), JSValue(), "callback is not a function"_s);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}
