/*
 * Copyright (C) 2016-2019 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS''
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS
 * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "SubtleCrypto.h"
#include "OpenSSLUtilities.h"

#if ENABLE(WEB_CRYPTO)

#include "BufferSource.h"
#include "CryptoAlgorithm.h"
#include "CryptoAlgorithmParameters.h"
#include "CryptoAlgorithmRegistry.h"
#include "JSCryptoKey.h"
#include "JSDOMConvert.h"
#include "JSDOMPromiseDeferred.h"
#include "JSDOMWrapper.h"
#include "JSJsonWebKey.h"
#include "CryptoAlgorithmMLDSA.h"
#include "CryptoKeyAKP.h"
#include "CryptoKeyEC.h"
#include "CryptoKeyOKP.h"
#include "CryptoKeyPair.h"
#include "CryptoKeyRSA.h"
#include "BunString.h"
#include "ErrorCode.h"
#include "JSDOMExceptionHandling.h"
#include "VectorSizeLimit.h"
#include "node/crypto/CryptoUtil.h"
#include <openssl/bytestring.h>
#include <openssl/err.h>
#include <openssl/evp.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/Uint8Array.h>
#include <functional>
#include <utility>
#include <variant>
#include <wtf/text/MakeString.h>
#include <JavaScriptCore/JSONObject.h>

namespace WebCore {
using namespace JSC;

SubtleCrypto::SubtleCrypto(ScriptExecutionContext* context)
    : ContextDestructionObserver(context)
    , m_workQueue(WorkQueue::create("com.apple.WebKit.CryptoQueue"_s))
{
}

SubtleCrypto::~SubtleCrypto() = default;

enum class Operations {
    Encrypt,
    Decrypt,
    Sign,
    Verify,
    Digest,
    GenerateKey,
    DeriveBits,
    ImportKey,
    WrapKey,
    UnwrapKey,
    GetKeyLength,
    Encapsulate,
    Decapsulate
};

using Dictionary = CryptoAlgorithmParameters::Dictionary;
using IDLAlgorithmIdentifier = IDLUnion<IDLObject, IDLDOMString>;
using IDLBufferSourceUnion = IDLUnion<IDLArrayBufferView, IDLArrayBuffer>;
using IDLEnforcedOctet = IDLEnforceRangeAdaptor<IDLOctet>;
using IDLEnforcedUnsignedShort = IDLEnforceRangeAdaptor<IDLUnsignedShort>;
using IDLEnforcedUnsignedLong = IDLEnforceRangeAdaptor<IDLUnsignedLong>;

template<typename IDLType> static constexpr ASCIILiteral idlTypeName() = delete;
template<> constexpr ASCIILiteral idlTypeName<IDLAlgorithmIdentifier>() { return "(object or DOMString)"_s; }
template<> constexpr ASCIILiteral idlTypeName<IDLBufferSourceUnion>() { return "(ArrayBufferView or ArrayBuffer)"_s; }
template<> constexpr ASCIILiteral idlTypeName<IDLDOMString>() { return "DOMString"_s; }
template<> constexpr ASCIILiteral idlTypeName<IDLEnforcedOctet>() { return "octet"_s; }
template<> constexpr ASCIILiteral idlTypeName<IDLEnforcedUnsignedShort>() { return "unsigned short"_s; }
template<> constexpr ASCIILiteral idlTypeName<IDLEnforcedUnsignedLong>() { return "unsigned long"_s; }
template<> constexpr ASCIILiteral idlTypeName<IDLUint8Array>() { return "Uint8Array"_s; }

namespace {

// Getters observe the order of the calls. Each one can leave an exception pending.
struct DictionaryReader {
    JSGlobalObject& state;
    JSObject& object;
    ASCIILiteral dictionaryName;

    template<typename IDLType> typename Converter<IDLType>::ReturnType convertRequired(JSValue value, ASCIILiteral member) const
    {
        auto scope = DECLARE_THROW_SCOPE(state.vm());
        if (value.isUndefined()) {
            throwRequiredMemberTypeError(state, scope, member, dictionaryName, idlTypeName<IDLType>());
            return {};
        }
        RELEASE_AND_RETURN(scope, convert<IDLType>(state, value));
    }

    template<typename IDLType> typename Converter<IDLType>::ReturnType required(ASCIILiteral member) const
    {
        auto scope = DECLARE_THROW_SCOPE(state.vm());
        auto value = object.get(&state, Identifier::fromString(state.vm(), member));
        RETURN_IF_EXCEPTION(scope, {});
        RELEASE_AND_RETURN(scope, convertRequired<IDLType>(value, member));
    }

    template<typename IDLType> std::optional<typename Converter<IDLType>::ReturnType> optional(ASCIILiteral member) const
    {
        auto scope = DECLARE_THROW_SCOPE(state.vm());
        auto value = object.get(&state, Identifier::fromString(state.vm(), member));
        RETURN_IF_EXCEPTION(scope, std::nullopt);
        if (value.isUndefined())
            return std::nullopt;
        RELEASE_AND_RETURN(scope, convert<IDLType>(state, value));
    }

    BufferSource optionalBytes(ASCIILiteral member) const
    {
        auto bytes = optional<IDLBufferSourceUnion>(member);
        return bytes ? BufferSource { WTF::move(*bytes) } : BufferSource {};
    }

    String name() const
    {
        auto scope = DECLARE_THROW_SCOPE(state.vm());
        auto value = object.get(&state, state.vm().propertyNames->name);
        RETURN_IF_EXCEPTION(scope, {});
        RELEASE_AND_RETURN(scope, convertRequired<IDLDOMString>(value, "name"_s));
    }
};

}

// Every dictionary inherits `name`, so it is read and converted again.
static DictionaryReader openDictionary(JSGlobalObject& state, JSObject& object, ASCIILiteral dictionaryName)
{
    DictionaryReader reader { state, object, dictionaryName };
    reader.name();
    return reader;
}

// Vector CRASH()es above a capacity that is smaller than the largest ArrayBuffer.
static bool fitsInVector(const BufferSource& data)
{
    return WTF::isValidCapacityForVector<uint8_t>(data.length());
}

// CheckSize leaves the buffer members empty, for a caller that never runs the operation.
enum class Bytes : bool {
    CheckSize,
    Copy
};

// Readers call it last, after `hash` ran its getters. The size checks run before them, so their error wins.
[[nodiscard]] static bool tryCopy(Vector<uint8_t>& to, const BufferSource& from, Bytes bytes)
{
    if (bytes == Bytes::CheckSize)
        return fitsInVector(from);
    return to.tryAppend(std::span { from.data(), from.length() });
}

static Exception inputTooLarge()
{
    return Exception { OperationError, "Input data is too large"_s };
}

static Exception unrecognizedAlgorithm()
{
    return Exception { NotSupportedError, "Unrecognized algorithm name"_s };
}

static ExceptionOr<CryptoAlgorithmParameters> normalizeCryptoAlgorithmParameters(JSGlobalObject&, const SubtleCrypto::AlgorithmIdentifier&, Operations, Bytes = Bytes::Copy);

static ExceptionOr<CryptoAlgorithmIdentifier> toHashIdentifier(JSGlobalObject& state, const SubtleCrypto::AlgorithmIdentifier& algorithmIdentifier)
{
    auto digestParams = normalizeCryptoAlgorithmParameters(state, algorithmIdentifier, Operations::Digest);
    if (digestParams.hasException())
        return digestParams.releaseException();
    return digestParams.returnValue().identifier;
}

static ExceptionOr<Dictionary> readAeadParams(JSGlobalObject& state, JSObject& object, ASCIILiteral dictionaryName, Bytes bytes)
{
    constexpr uint8_t defaultTagLength = 128;
    auto scope = DECLARE_THROW_SCOPE(state.vm());
    auto reader = openDictionary(state, object, dictionaryName);
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
    auto additionalData = reader.optionalBytes("additionalData"_s);
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
    BufferSource iv = reader.required<IDLBufferSourceUnion>("iv"_s);
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
    auto tagLength = reader.optional<IDLEnforcedOctet>("tagLength"_s);
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
    if (!fitsInVector(iv) || !fitsInVector(additionalData))
        return inputTooLarge();
    CryptoAlgorithmAeadParams params { {}, {}, tagLength.value_or(defaultTagLength) };
    if (!tryCopy(params.iv, iv, bytes) || !tryCopy(params.additionalData, additionalData, bytes))
        return inputTooLarge();
    return Dictionary { WTF::move(params) };
}

static ExceptionOr<Dictionary> readAesCbcCfbParams(JSGlobalObject& state, JSObject& object, Bytes bytes)
{
    auto scope = DECLARE_THROW_SCOPE(state.vm());
    auto reader = openDictionary(state, object, "AesCbcCfbParams"_s);
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
    BufferSource iv = reader.required<IDLBufferSourceUnion>("iv"_s);
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
    CryptoAlgorithmAesCbcCfbParams params;
    if (!tryCopy(params.iv, iv, bytes))
        return inputTooLarge();
    return Dictionary { WTF::move(params) };
}

static ExceptionOr<Dictionary> readAesCtrParams(JSGlobalObject& state, JSObject& object, Bytes bytes)
{
    auto scope = DECLARE_THROW_SCOPE(state.vm());
    auto reader = openDictionary(state, object, "AesCtrParams"_s);
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
    BufferSource counter = reader.required<IDLBufferSourceUnion>("counter"_s);
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
    auto length = reader.required<IDLEnforcedOctet>("length"_s);
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
    CryptoAlgorithmAesCtrParams params { {}, length };
    if (!tryCopy(params.counter, counter, bytes))
        return inputTooLarge();
    return Dictionary { WTF::move(params) };
}

static ExceptionOr<Dictionary> readAesKeyParams(JSGlobalObject& state, JSObject& object)
{
    auto scope = DECLARE_THROW_SCOPE(state.vm());
    auto reader = openDictionary(state, object, "AesKeyParams"_s);
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
    auto length = reader.required<IDLEnforcedUnsignedShort>("length"_s);
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
    return Dictionary { CryptoAlgorithmAesKeyParams { length } };
}

static ExceptionOr<Dictionary> readEcKeyParams(JSGlobalObject& state, JSObject& object)
{
    auto scope = DECLARE_THROW_SCOPE(state.vm());
    auto reader = openDictionary(state, object, "EcKeyParams"_s);
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
    auto namedCurve = reader.required<IDLDOMString>("namedCurve"_s);
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
    return Dictionary { CryptoAlgorithmEcKeyParams { WTF::move(namedCurve) } };
}

// Both members are read before either is converted, and errors call `public` "publicKey".
static ExceptionOr<Dictionary> readEcdhKeyDeriveParams(JSGlobalObject& state, JSObject& object, ASCIILiteral dictionaryName)
{
    auto& vm = state.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto nameValue = object.get(&state, vm.propertyNames->name);
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
    auto publicValue = object.get(&state, vm.propertyNames->publicKeyword);
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
    DictionaryReader { state, object, dictionaryName }.convertRequired<IDLDOMString>(nameValue, "name"_s);
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
    if (publicValue.isUndefined()) {
        throwRequiredMemberTypeError(state, scope, "publicKey"_s, dictionaryName, "CryptoKey"_s);
        return Exception { ExistingExceptionError };
    }
    auto* publicKey = convert<IDLInterface<CryptoKey>>(state, publicValue, [&](JSGlobalObject& state, ThrowScope& scope) {
        throwDictionaryMemberTypeError(state, scope, "publicKey"_s, dictionaryName, "CryptoKey"_s);
    });
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
    return Dictionary { CryptoAlgorithmEcdhKeyDeriveParams { *publicKey } };
}

template<typename Params> static ExceptionOr<Dictionary> readHashParams(JSGlobalObject& state, JSObject& object, ASCIILiteral dictionaryName)
{
    auto scope = DECLARE_THROW_SCOPE(state.vm());
    auto reader = openDictionary(state, object, dictionaryName);
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
    auto hash = reader.required<IDLAlgorithmIdentifier>("hash"_s);
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
    auto hashIdentifier = toHashIdentifier(state, hash);
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
    if (hashIdentifier.hasException())
        return hashIdentifier.releaseException();
    return Dictionary { Params { hashIdentifier.returnValue() } };
}

static ExceptionOr<Dictionary> readHkdfParams(JSGlobalObject& state, JSObject& object, Bytes bytes)
{
    auto scope = DECLARE_THROW_SCOPE(state.vm());
    auto reader = openDictionary(state, object, "HkdfParams"_s);
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
    auto hash = reader.required<IDLAlgorithmIdentifier>("hash"_s);
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
    BufferSource info = reader.required<IDLBufferSourceUnion>("info"_s);
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
    BufferSource salt = reader.required<IDLBufferSourceUnion>("salt"_s);
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
    if (!fitsInVector(salt) || !fitsInVector(info))
        return inputTooLarge();
    auto hashIdentifier = toHashIdentifier(state, hash);
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
    if (hashIdentifier.hasException())
        return hashIdentifier.releaseException();
    CryptoAlgorithmHkdfParams params { hashIdentifier.returnValue(), {}, {} };
    if (!tryCopy(params.salt, salt, bytes) || !tryCopy(params.info, info, bytes))
        return inputTooLarge();
    return Dictionary { WTF::move(params) };
}

static ExceptionOr<Dictionary> readHmacKeyParams(JSGlobalObject& state, JSObject& object)
{
    auto scope = DECLARE_THROW_SCOPE(state.vm());
    auto reader = openDictionary(state, object, "HmacKeyParams"_s);
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
    auto hash = reader.required<IDLAlgorithmIdentifier>("hash"_s);
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
    auto length = reader.optional<IDLEnforcedUnsignedLong>("length"_s);
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
    auto hashIdentifier = toHashIdentifier(state, hash);
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
    if (hashIdentifier.hasException())
        return hashIdentifier.releaseException();
    return Dictionary { CryptoAlgorithmHmacKeyParams { hashIdentifier.returnValue(), length } };
}

static ExceptionOr<Dictionary> readContextParams(JSGlobalObject& state, JSObject& object, Bytes bytes)
{
    auto scope = DECLARE_THROW_SCOPE(state.vm());
    auto reader = openDictionary(state, object, "ContextParams"_s);
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
    auto context = reader.optionalBytes("context"_s);
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
    CryptoAlgorithmMlDsaParams params;
    if (!tryCopy(params.context, context, bytes))
        return inputTooLarge();
    return Dictionary { WTF::move(params) };
}

static ExceptionOr<Dictionary> readPbkdf2Params(JSGlobalObject& state, JSObject& object, Bytes bytes)
{
    auto scope = DECLARE_THROW_SCOPE(state.vm());
    auto reader = openDictionary(state, object, "Pbkdf2Params"_s);
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
    auto hash = reader.required<IDLAlgorithmIdentifier>("hash"_s);
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
    auto iterations = reader.required<IDLEnforcedUnsignedLong>("iterations"_s);
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
    BufferSource salt = reader.required<IDLBufferSourceUnion>("salt"_s);
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
    if (!fitsInVector(salt))
        return inputTooLarge();
    auto hashIdentifier = toHashIdentifier(state, hash);
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
    if (hashIdentifier.hasException())
        return hashIdentifier.releaseException();
    CryptoAlgorithmPbkdf2Params params { hashIdentifier.returnValue(), {}, iterations };
    if (!tryCopy(params.salt, salt, bytes))
        return inputTooLarge();
    return Dictionary { WTF::move(params) };
}

static ExceptionOr<Dictionary> readRsaHashedKeyGenParams(JSGlobalObject& state, JSObject& object, Bytes bytes)
{
    auto scope = DECLARE_THROW_SCOPE(state.vm());
    auto reader = openDictionary(state, object, "RsaHashedKeyGenParams"_s);
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
    auto modulusLength = reader.required<IDLEnforcedUnsignedLong>("modulusLength"_s);
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
    BufferSource publicExponent { RefPtr<ArrayBufferView> { reader.required<IDLUint8Array>("publicExponent"_s) } };
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
    auto hash = reader.required<IDLAlgorithmIdentifier>("hash"_s);
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
    if (!fitsInVector(publicExponent))
        return inputTooLarge();
    auto hashIdentifier = toHashIdentifier(state, hash);
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
    if (hashIdentifier.hasException())
        return hashIdentifier.releaseException();
    CryptoAlgorithmRsaHashedKeyGenParams params { hashIdentifier.returnValue(), modulusLength, {} };
    if (!tryCopy(params.publicExponent, publicExponent, bytes))
        return inputTooLarge();
    return Dictionary { WTF::move(params) };
}

static ExceptionOr<Dictionary> readRsaOaepParams(JSGlobalObject& state, JSObject& object, Bytes bytes)
{
    auto scope = DECLARE_THROW_SCOPE(state.vm());
    auto reader = openDictionary(state, object, "RsaOaepParams"_s);
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
    auto label = reader.optionalBytes("label"_s);
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
    CryptoAlgorithmRsaOaepParams params;
    if (!tryCopy(params.label, label, bytes))
        return inputTooLarge();
    return Dictionary { WTF::move(params) };
}

static ExceptionOr<Dictionary> readRsaPssParams(JSGlobalObject& state, JSObject& object)
{
    auto scope = DECLARE_THROW_SCOPE(state.vm());
    auto reader = openDictionary(state, object, "RsaPssParams"_s);
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
    auto saltLength = reader.required<IDLEnforcedUnsignedLong>("saltLength"_s);
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
    return Dictionary { CryptoAlgorithmRsaPssParams { saltLength } };
}

static ExceptionOr<Dictionary> readDictionary(JSGlobalObject& state, JSObject& object, CryptoAlgorithmIdentifier identifier, Operations operation, Bytes bytes)
{
    switch (operation) {
    case Operations::Encrypt:
    case Operations::Decrypt:
        switch (identifier) {
        case CryptoAlgorithmIdentifier::RSAES_PKCS1_v1_5:
            return Exception { NotSupportedError, "RSAES-PKCS1-v1_5 support is deprecated"_s };
        case CryptoAlgorithmIdentifier::RSA_OAEP:
            return readRsaOaepParams(state, object, bytes);
        case CryptoAlgorithmIdentifier::AES_CBC:
        case CryptoAlgorithmIdentifier::AES_CFB:
            return readAesCbcCfbParams(state, object, bytes);
        case CryptoAlgorithmIdentifier::AES_CTR:
            return readAesCtrParams(state, object, bytes);
        case CryptoAlgorithmIdentifier::AES_GCM:
            return readAeadParams(state, object, "AesGcmParams"_s, bytes);
        case CryptoAlgorithmIdentifier::ChaCha20_Poly1305:
            return readAeadParams(state, object, "AeadParams"_s, bytes);
        default:
            return unrecognizedAlgorithm();
        }
    case Operations::Sign:
    case Operations::Verify:
        switch (identifier) {
        case CryptoAlgorithmIdentifier::RSASSA_PKCS1_v1_5:
        case CryptoAlgorithmIdentifier::HMAC:
        case CryptoAlgorithmIdentifier::Ed25519:
            return Dictionary {};
        case CryptoAlgorithmIdentifier::ECDSA:
            return readHashParams<CryptoAlgorithmEcdsaParams>(state, object, "EcdsaParams"_s);
        case CryptoAlgorithmIdentifier::RSA_PSS:
            return readRsaPssParams(state, object);
        case CryptoAlgorithmIdentifier::ML_DSA_44:
        case CryptoAlgorithmIdentifier::ML_DSA_65:
        case CryptoAlgorithmIdentifier::ML_DSA_87:
            return readContextParams(state, object, bytes);
        default:
            return unrecognizedAlgorithm();
        }
    case Operations::Digest:
        switch (identifier) {
        case CryptoAlgorithmIdentifier::SHA_1:
        case CryptoAlgorithmIdentifier::SHA_224:
        case CryptoAlgorithmIdentifier::SHA_256:
        case CryptoAlgorithmIdentifier::SHA_384:
        case CryptoAlgorithmIdentifier::SHA_512:
        case CryptoAlgorithmIdentifier::SHA3_256:
        case CryptoAlgorithmIdentifier::SHA3_384:
        case CryptoAlgorithmIdentifier::SHA3_512:
            return Dictionary {};
        default:
            return unrecognizedAlgorithm();
        }
    case Operations::GenerateKey:
        switch (identifier) {
        case CryptoAlgorithmIdentifier::RSAES_PKCS1_v1_5:
            return Exception { NotSupportedError, "RSAES-PKCS1-v1_5 support is deprecated"_s };
        case CryptoAlgorithmIdentifier::RSASSA_PKCS1_v1_5:
        case CryptoAlgorithmIdentifier::RSA_PSS:
        case CryptoAlgorithmIdentifier::RSA_OAEP:
            return readRsaHashedKeyGenParams(state, object, bytes);
        case CryptoAlgorithmIdentifier::AES_CTR:
        case CryptoAlgorithmIdentifier::AES_CBC:
        case CryptoAlgorithmIdentifier::AES_GCM:
        case CryptoAlgorithmIdentifier::AES_CFB:
        case CryptoAlgorithmIdentifier::AES_KW:
            return readAesKeyParams(state, object);
        case CryptoAlgorithmIdentifier::HMAC:
            return readHmacKeyParams(state, object);
        case CryptoAlgorithmIdentifier::ECDSA:
        case CryptoAlgorithmIdentifier::ECDH:
            return readEcKeyParams(state, object);
        case CryptoAlgorithmIdentifier::Ed25519:
        case CryptoAlgorithmIdentifier::X25519:
        case CryptoAlgorithmIdentifier::ChaCha20_Poly1305:
        case CryptoAlgorithmIdentifier::ML_DSA_44:
        case CryptoAlgorithmIdentifier::ML_DSA_65:
        case CryptoAlgorithmIdentifier::ML_DSA_87:
        case CryptoAlgorithmIdentifier::ML_KEM_768:
        case CryptoAlgorithmIdentifier::ML_KEM_1024:
            return Dictionary {};
        default:
            return unrecognizedAlgorithm();
        }
    case Operations::DeriveBits:
        switch (identifier) {
        case CryptoAlgorithmIdentifier::ECDH:
            return readEcdhKeyDeriveParams(state, object, "EcdhKeyDeriveParams"_s);
        case CryptoAlgorithmIdentifier::X25519:
            return readEcdhKeyDeriveParams(state, object, "X25519Params"_s);
        case CryptoAlgorithmIdentifier::HKDF:
            return readHkdfParams(state, object, bytes);
        case CryptoAlgorithmIdentifier::PBKDF2:
            return readPbkdf2Params(state, object, bytes);
        default:
            return unrecognizedAlgorithm();
        }
    case Operations::ImportKey:
        switch (identifier) {
        case CryptoAlgorithmIdentifier::RSAES_PKCS1_v1_5:
            return Exception { NotSupportedError, "RSAES-PKCS1-v1_5 support is deprecated"_s };
        case CryptoAlgorithmIdentifier::RSASSA_PKCS1_v1_5:
        case CryptoAlgorithmIdentifier::RSA_PSS:
        case CryptoAlgorithmIdentifier::RSA_OAEP:
            return readHashParams<CryptoAlgorithmRsaHashedImportParams>(state, object, "RsaHashedImportParams"_s);
        case CryptoAlgorithmIdentifier::AES_CTR:
        case CryptoAlgorithmIdentifier::AES_CBC:
        case CryptoAlgorithmIdentifier::AES_GCM:
        case CryptoAlgorithmIdentifier::AES_CFB:
        case CryptoAlgorithmIdentifier::AES_KW:
        case CryptoAlgorithmIdentifier::Ed25519:
        case CryptoAlgorithmIdentifier::X25519:
        case CryptoAlgorithmIdentifier::ChaCha20_Poly1305:
        case CryptoAlgorithmIdentifier::ML_DSA_44:
        case CryptoAlgorithmIdentifier::ML_DSA_65:
        case CryptoAlgorithmIdentifier::ML_DSA_87:
        case CryptoAlgorithmIdentifier::ML_KEM_768:
        case CryptoAlgorithmIdentifier::ML_KEM_1024:
            return Dictionary {};
        case CryptoAlgorithmIdentifier::HMAC:
            return readHmacKeyParams(state, object);
        case CryptoAlgorithmIdentifier::ECDSA:
        case CryptoAlgorithmIdentifier::ECDH:
            return readEcKeyParams(state, object);
        case CryptoAlgorithmIdentifier::HKDF:
        case CryptoAlgorithmIdentifier::PBKDF2:
            return Dictionary {};
        case CryptoAlgorithmIdentifier::SHA_1:
        case CryptoAlgorithmIdentifier::SHA_224:
        case CryptoAlgorithmIdentifier::SHA_256:
        case CryptoAlgorithmIdentifier::SHA_384:
        case CryptoAlgorithmIdentifier::SHA_512:
        case CryptoAlgorithmIdentifier::SHA3_256:
        case CryptoAlgorithmIdentifier::SHA3_384:
        case CryptoAlgorithmIdentifier::SHA3_512:
        case CryptoAlgorithmIdentifier::None:
            return unrecognizedAlgorithm();
        }
        break;
    case Operations::WrapKey:
    case Operations::UnwrapKey:
        switch (identifier) {
        case CryptoAlgorithmIdentifier::AES_KW:
            return Dictionary {};
        default:
            return unrecognizedAlgorithm();
        }
    case Operations::Encapsulate:
    case Operations::Decapsulate:
        switch (identifier) {
        case CryptoAlgorithmIdentifier::ML_KEM_768:
        case CryptoAlgorithmIdentifier::ML_KEM_1024:
            return Dictionary {};
        default:
            return unrecognizedAlgorithm();
        }
    case Operations::GetKeyLength:
        switch (identifier) {
        case CryptoAlgorithmIdentifier::AES_CTR:
        case CryptoAlgorithmIdentifier::AES_CBC:
        case CryptoAlgorithmIdentifier::AES_GCM:
        case CryptoAlgorithmIdentifier::AES_CFB:
        case CryptoAlgorithmIdentifier::AES_KW:
            return readAesKeyParams(state, object);
        case CryptoAlgorithmIdentifier::HMAC:
            return readHmacKeyParams(state, object);
        case CryptoAlgorithmIdentifier::HKDF:
        case CryptoAlgorithmIdentifier::PBKDF2:
        case CryptoAlgorithmIdentifier::ChaCha20_Poly1305:
            return Dictionary {};
        default:
            return unrecognizedAlgorithm();
        }
    }

    return unrecognizedAlgorithm();
}

// https://w3c.github.io/webcrypto/#algorithm-normalization-normalize-an-algorithm
static ExceptionOr<CryptoAlgorithmParameters> normalizeCryptoAlgorithmParameters(JSGlobalObject& state, const SubtleCrypto::AlgorithmIdentifier& algorithmIdentifier, Operations operation, Bytes bytes)
{
    VM& vm = state.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSObject* object;
    if (auto* name = std::get_if<String>(&algorithmIdentifier)) {
        object = constructEmptyObject(&state);
        object->putDirect(vm, vm.propertyNames->name, jsString(vm, *name));
    } else
        object = std::get<Strong<JSObject>>(algorithmIdentifier).get();

    auto name = DictionaryReader { state, *object, "CryptoAlgorithmParameters"_s }.name();
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });

    auto identifier = CryptoAlgorithmRegistry::singleton().identifier(name);
    if (!identifier) [[unlikely]]
        return unrecognizedAlgorithm();

    auto dictionary = readDictionary(state, *object, *identifier, operation, bytes);
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
    if (dictionary.hasException())
        return dictionary.releaseException();
    return CryptoAlgorithmParameters { *identifier, dictionary.releaseReturnValue() };
}

// nullopt: the promise was rejected, or an exception is pending.
static std::optional<CryptoAlgorithmParameters> normalizeOrReject(JSGlobalObject& state, const SubtleCrypto::AlgorithmIdentifier& algorithmIdentifier, Operations operation, DeferredPromise& promise)
{
    auto scope = DECLARE_THROW_SCOPE(state.vm());
    auto result = normalizeCryptoAlgorithmParameters(state, algorithmIdentifier, operation);
    RETURN_IF_EXCEPTION(scope, std::nullopt);
    if (result.hasException()) {
        promise.reject(result.releaseException());
        return std::nullopt;
    }
    return result.releaseReturnValue();
}

// AES-KW, or else any algorithm that encrypts. Unwrapping takes the same dictionaries.
static std::optional<CryptoAlgorithmParameters> normalizeWrapAlgorithmOrReject(JSGlobalObject& state, const SubtleCrypto::AlgorithmIdentifier& algorithmIdentifier, DeferredPromise& promise)
{
    auto scope = DECLARE_THROW_SCOPE(state.vm());
    auto result = normalizeCryptoAlgorithmParameters(state, algorithmIdentifier, Operations::WrapKey);
    RETURN_IF_EXCEPTION(scope, std::nullopt);
    if (result.hasException())
        RELEASE_AND_RETURN(scope, normalizeOrReject(state, algorithmIdentifier, Operations::Encrypt, promise));
    return result.releaseReturnValue();
}

static CryptoKeyUsageBitmap toCryptoKeyUsageBitmap(CryptoKeyUsage usage)
{
    switch (usage) {
    case CryptoKeyUsage::Encrypt:
        return CryptoKeyUsageEncrypt;
    case CryptoKeyUsage::Decrypt:
        return CryptoKeyUsageDecrypt;
    case CryptoKeyUsage::Sign:
        return CryptoKeyUsageSign;
    case CryptoKeyUsage::Verify:
        return CryptoKeyUsageVerify;
    case CryptoKeyUsage::DeriveKey:
        return CryptoKeyUsageDeriveKey;
    case CryptoKeyUsage::DeriveBits:
        return CryptoKeyUsageDeriveBits;
    case CryptoKeyUsage::WrapKey:
        return CryptoKeyUsageWrapKey;
    case CryptoKeyUsage::UnwrapKey:
        return CryptoKeyUsageUnwrapKey;
    case CryptoKeyUsage::EncapsulateKey:
        return CryptoKeyUsageEncapsulateKey;
    case CryptoKeyUsage::EncapsulateBits:
        return CryptoKeyUsageEncapsulateBits;
    case CryptoKeyUsage::DecapsulateKey:
        return CryptoKeyUsageDecapsulateKey;
    case CryptoKeyUsage::DecapsulateBits:
        return CryptoKeyUsageDecapsulateBits;
    }

    RELEASE_ASSERT_NOT_REACHED();
}

CryptoKeyUsageBitmap SubtleCrypto::toCryptoKeyUsageBitmap(const Vector<CryptoKeyUsage>& usages)
{
    CryptoKeyUsageBitmap result = 0;
    // Maybe we shouldn't silently bypass duplicated usages?
    for (auto usage : usages)
        result |= WebCore::toCryptoKeyUsageBitmap(usage);

    return result;
}

// Maybe we want more specific error messages?
static void rejectWithException(Ref<DeferredPromise>&& passedPromise, ExceptionCode ec, const String& msg)
{
    // createDOMException() turns this code into JavaScript's own SyntaxError.
    if (ec == SyntaxError) {
        passedPromise->rejectWithCallback([&](JSDOMGlobalObject& globalObject) {
            return createDOMExceptionObject(&globalObject, ec, msg.isEmpty() ? "A required parameter was missing or out-of-range"_s : msg);
        });
        return;
    }
    if (!msg.isEmpty()) {
        passedPromise->reject(ec, msg);
        return;
    }
    switch (ec) {
    case NotSupportedError:
        passedPromise->reject(ec, "The algorithm is not supported"_s);
        return;
    case InvalidStateError:
        passedPromise->reject(ec, "The requested operation is not valid for the current state of the provided key"_s);
        return;
    case InvalidAccessError:
        passedPromise->reject(ec, "The requested operation is not valid for the provided key"_s);
        return;
    case UnknownError:
        passedPromise->reject(ec, "The operation failed for an unknown transient reason (e.g. out of memory)"_s);
        return;
    case DataError:
        passedPromise->reject(ec, "Data provided to an operation does not meet requirements"_s);
        return;
    case OperationError:
        passedPromise->reject(ec, "The operation failed for an operation-specific reason"_s);
        return;
    default:
        break;
    }
    ASSERT_NOT_REACHED();
}

static void normalizeJsonWebKey(JsonWebKey& webKey)
{
    // Maybe we shouldn't silently bypass duplicated usages?
    webKey.usages = webKey.key_ops ? SubtleCrypto::toCryptoKeyUsageBitmap(webKey.key_ops.value()) : 0;
}

// FIXME: This returns an std::optional<KeyData> and takes a promise, rather than returning an
// ExceptionOr<KeyData> and letting the caller handle the promise, to work around an issue where
// Variant types (which KeyData is) in ExceptionOr<> cause compile issues on some platforms. This
// should be resolved by adopting a standards compliant std::variant (see https://webkit.org/b/175583)
static std::optional<KeyData> toKeyData(SubtleCrypto::KeyFormat format, SubtleCrypto::KeyDataVariant&& keyDataVariant, Ref<DeferredPromise>& promise)
{
    switch (format) {
    case SubtleCrypto::KeyFormat::Spki:
    case SubtleCrypto::KeyFormat::Pkcs8:
    case SubtleCrypto::KeyFormat::Raw:
    case SubtleCrypto::KeyFormat::RawSecret:
    case SubtleCrypto::KeyFormat::RawPublic:
    case SubtleCrypto::KeyFormat::RawSeed:
        return std::visit(
            WTF::makeVisitor(
                [&promise](JsonWebKey&) -> std::optional<KeyData> {
                    // The importKey binding rejects object keyData for buffer
                    // formats with node's ERR_INVALID_ARG_TYPE before it can
                    // reach this conversion.
                    ASSERT_NOT_REACHED();
                    promise->reject(Exception { TypeError });
                    return std::nullopt;
                },
                [&promise](auto& bufferSource) -> std::optional<KeyData> {
                    if (!WTF::isValidCapacityForVector<uint8_t>(bufferSource->byteLength())) {
                        promise->reject(inputTooLarge());
                        return std::nullopt;
                    }
                    return KeyData { Vector(std::span { static_cast<const uint8_t*>(bufferSource->data()), bufferSource->byteLength() }) };
                }),
            keyDataVariant);
    case SubtleCrypto::KeyFormat::Jwk:
        return std::visit(
            WTF::makeVisitor(
                [](JsonWebKey& webKey) -> std::optional<KeyData> {
                    normalizeJsonWebKey(webKey);
                    return KeyData { webKey };
                },
                [&promise](auto&) -> std::optional<KeyData> {
                    promise->reject(Exception { TypeError });
                    return std::nullopt;
                }),
            keyDataVariant);
    }

    RELEASE_ASSERT_NOT_REACHED();
}

// nullopt: the promise was rejected.
static std::optional<Vector<uint8_t>> copyToVector(BufferSource&& data, Ref<DeferredPromise>& promise)
{
    Vector<uint8_t> copy;
    if (!tryCopy(copy, data, Bytes::Copy)) {
        promise->reject(inputTooLarge());
        return std::nullopt;
    }
    return copy;
}

static bool isSupportedExportKey(CryptoAlgorithmIdentifier identifier)
{
    switch (identifier) {
    case CryptoAlgorithmIdentifier::RSASSA_PKCS1_v1_5:
    case CryptoAlgorithmIdentifier::RSA_PSS:
    case CryptoAlgorithmIdentifier::RSA_OAEP:
    case CryptoAlgorithmIdentifier::AES_CTR:
    case CryptoAlgorithmIdentifier::AES_CBC:
    case CryptoAlgorithmIdentifier::AES_GCM:
    case CryptoAlgorithmIdentifier::AES_CFB:
    case CryptoAlgorithmIdentifier::AES_KW:
    case CryptoAlgorithmIdentifier::HMAC:
    case CryptoAlgorithmIdentifier::ECDSA:
    case CryptoAlgorithmIdentifier::ECDH:
    case CryptoAlgorithmIdentifier::Ed25519:
    case CryptoAlgorithmIdentifier::X25519:
    case CryptoAlgorithmIdentifier::ChaCha20_Poly1305:
    case CryptoAlgorithmIdentifier::ML_DSA_44:
    case CryptoAlgorithmIdentifier::ML_DSA_65:
    case CryptoAlgorithmIdentifier::ML_DSA_87:
    case CryptoAlgorithmIdentifier::ML_KEM_768:
    case CryptoAlgorithmIdentifier::ML_KEM_1024:
        return true;
    default:
        return false;
    }
}

static bool isAkpAlgorithm(CryptoAlgorithmIdentifier identifier)
{
    return CryptoKeyAKP::isMlDsa(identifier) || CryptoKeyAKP::isMlKem(identifier);
}

// Rejects with a DOMException carrying a `cause`, matching Node's error shapes
// for the ML-DSA/ML-KEM code paths.
static void rejectWithCause(Ref<DeferredPromise>&& promise, ExceptionCode ec, const String& message, Function<JSC::JSValue(JSDOMGlobalObject&)>&& makeCause)
{
    promise->rejectWithCallback([&](JSDOMGlobalObject& globalObject) -> JSC::JSValue {
        auto& vm = globalObject.vm();
        JSC::JSValue cause = makeCause(globalObject);
        auto exception = createDOMException(&globalObject, ec, message);
        if (auto* exceptionObject = exception.getObject(); exceptionObject && cause)
            exceptionObject->putDirect(vm, vm.propertyNames->cause, cause);
        return exception;
    });
}

// Rejects an import failure. The ML import paths leave the BoringSSL parse
// failure in the error queue; attach it as the DOMException's cause like Node
// does. Shared by importKey's and unwrapKey's inner-import exceptionCallbacks.
static void rejectImportKeyException(Ref<DeferredPromise>&& promise, ExceptionCode ec, const String& msg, CryptoAlgorithmIdentifier identifier)
{
    if (ec == DataError && isAkpAlgorithm(identifier)) {
        if (uint32_t opensslError = ERR_get_error()) {
            ERR_clear_error();
            rejectWithCause(WTF::move(promise), ec, msg, [opensslError](JSDOMGlobalObject& globalObject) -> JSC::JSValue {
                auto& vm = globalObject.vm();
                auto scope = DECLARE_THROW_SCOPE(vm);
                auto cause = Bun::createCryptoError(&globalObject, scope, opensslError, nullptr);
                if (scope.exception()) [[unlikely]] {
                    (void)scope.tryClearException();
                    return JSC::jsUndefined();
                }
                return cause;
            });
            return;
        }
    }
    rejectWithException(WTF::move(promise), ec, msg);
}

// Node rejects oversized ML-DSA context strings with an OperationError whose
// cause is an ERR_OUT_OF_RANGE error; returns true when it rejected.
static bool rejectIfMlDsaContextTooLong(const CryptoAlgorithmParameters& params, Ref<DeferredPromise>&& promise)
{
    auto* mlDsaParams = std::get_if<CryptoAlgorithmMlDsaParams>(&params.dictionary);
    if (!mlDsaParams || mlDsaParams->context.size() <= CryptoAlgorithmMLDSA::s_maxContextLength)
        return false;
    rejectWithCause(WTF::move(promise), OperationError, "The operation failed for an operation-specific reason"_s, [](JSDOMGlobalObject& globalObject) -> JSC::JSValue {
        return Bun::createError(&globalObject, Bun::ErrorCode::ERR_OUT_OF_RANGE, "context string must be at most 255 bytes"_s);
    });
    return true;
}

RefPtr<DeferredPromise> getPromise(DeferredPromise* index, WeakPtr<SubtleCrypto> weakThis)
{
    if (weakThis)
        return weakThis->m_pendingPromises.take(index);
    return nullptr;
}

// For the callback of a job, which can be destroyed on the work pool. nullopt: the promise was rejected.
static std::optional<CryptoAlgorithmParameters> isolateOrReject(CryptoAlgorithmParameters&& importParams, DeferredPromise& promise)
{
    if (auto* ecParams = std::get_if<CryptoAlgorithmEcKeyParams>(&importParams.dictionary)) {
        ecParams->namedCurve = tryMakeString(ecParams->namedCurve);
        if (ecParams->namedCurve.isNull()) {
            promise.reject(inputTooLarge());
            return std::nullopt;
        }
    }
    return WTF::move(importParams);
}

static JSObject* convertDictionaryToJS(JSGlobalObject& lexicalGlobalObject, JSDOMGlobalObject& globalObject, const CryptoKeyPair& keyPair)
{
    auto& vm = lexicalGlobalObject.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* result = constructEmptyObject(&lexicalGlobalObject, globalObject.objectPrototype());
    for (auto [name, key] : { std::pair { "privateKey"_s, keyPair.privateKey.get() }, std::pair { "publicKey"_s, keyPair.publicKey.get() } }) {
        if (!key)
            continue;
        auto value = toJS(&lexicalGlobalObject, &globalObject, *key);
        RETURN_IF_EXCEPTION(scope, {});
        Bun::putDirectNamed(vm, result, name, value);
    }
    return result;
}

// MARK: - Exposed functions.

void SubtleCrypto::encrypt(JSC::JSGlobalObject& state, AlgorithmIdentifier&& algorithmIdentifier, CryptoKey& key, BufferSource&& dataBufferSource, Ref<DeferredPromise>&& promise)
{
    auto& vm = state.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto params = normalizeOrReject(state, algorithmIdentifier, Operations::Encrypt, promise);
    RETURN_IF_EXCEPTION(scope, void());
    if (!params)
        return;

    auto data = copyToVector(WTF::move(dataBufferSource), promise);
    if (!data)
        return;

    if (params->identifier != key.algorithmIdentifier()) {
        promise->reject(InvalidAccessError, "Key algorithm mismatch"_s);
        return;
    }

    if (!key.allows(CryptoKeyUsageEncrypt)) {
        promise->reject(InvalidAccessError, "Unable to use this key to encrypt"_s);
        return;
    }

    auto algorithm = CryptoAlgorithmRegistry::singleton().create(key.algorithmIdentifier());

    auto index = promise.ptr();
    m_pendingPromises.add(index, WTF::move(promise));
    WeakPtr weakThis { *this };
    auto callback = [index, weakThis](const Vector<uint8_t>& cipherText) mutable {
        if (auto promise = getPromise(index, weakThis))
            fulfillPromiseWithArrayBuffer(promise.releaseNonNull(), cipherText.begin(), cipherText.size());
    };
    auto exceptionCallback = [index, weakThis](ExceptionCode ec, const String& msg) mutable {
        if (auto promise = getPromise(index, weakThis))
            rejectWithException(promise.releaseNonNull(), ec, msg);
    };

    RELEASE_AND_RETURN(scope, algorithm->encrypt(*params, key, WTF::move(*data), WTF::move(callback), WTF::move(exceptionCallback), *scriptExecutionContext(), m_workQueue));
}

void SubtleCrypto::decrypt(JSC::JSGlobalObject& state, AlgorithmIdentifier&& algorithmIdentifier, CryptoKey& key, BufferSource&& dataBufferSource, Ref<DeferredPromise>&& promise)
{
    auto& vm = state.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto params = normalizeOrReject(state, algorithmIdentifier, Operations::Decrypt, promise);
    RETURN_IF_EXCEPTION(scope, void());
    if (!params)
        return;

    auto data = copyToVector(WTF::move(dataBufferSource), promise);
    if (!data)
        return;

    if (params->identifier != key.algorithmIdentifier()) {
        promise->reject(InvalidAccessError, "Key algorithm mismatch"_s);
        return;
    }

    if (!key.allows(CryptoKeyUsageDecrypt)) {
        promise->reject(InvalidAccessError, "Unable to use this key to decrypt"_s);
        return;
    }

    auto algorithm = CryptoAlgorithmRegistry::singleton().create(key.algorithmIdentifier());

    auto index = promise.ptr();
    m_pendingPromises.add(index, WTF::move(promise));
    WeakPtr weakThis { *this };
    auto callback = [index, weakThis](const Vector<uint8_t>& plainText) mutable {
        if (auto promise = getPromise(index, weakThis))
            fulfillPromiseWithArrayBuffer(promise.releaseNonNull(), plainText.begin(), plainText.size());
    };
    auto exceptionCallback = [index, weakThis](ExceptionCode ec, const String& msg) mutable {
        if (auto promise = getPromise(index, weakThis))
            rejectWithException(promise.releaseNonNull(), ec, msg);
    };

    RELEASE_AND_RETURN(scope, algorithm->decrypt(*params, key, WTF::move(*data), WTF::move(callback), WTF::move(exceptionCallback), *scriptExecutionContext(), m_workQueue));
}

void SubtleCrypto::sign(JSC::JSGlobalObject& state, AlgorithmIdentifier&& algorithmIdentifier, CryptoKey& key, BufferSource&& dataBufferSource, Ref<DeferredPromise>&& promise)
{
    auto& vm = state.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto params = normalizeOrReject(state, algorithmIdentifier, Operations::Sign, promise);
    RETURN_IF_EXCEPTION(scope, void());
    if (!params)
        return;

    auto data = copyToVector(WTF::move(dataBufferSource), promise);
    if (!data)
        return;

    if (params->identifier != key.algorithmIdentifier()) {
        promise->reject(InvalidAccessError, "Key algorithm mismatch"_s);
        return;
    }

    if (!key.allows(CryptoKeyUsageSign)) {
        promise->reject(InvalidAccessError, "Unable to use this key to sign"_s);
        return;
    }

    if (rejectIfMlDsaContextTooLong(*params, WTF::move(promise)))
        return;

    auto algorithm = CryptoAlgorithmRegistry::singleton().create(key.algorithmIdentifier());

    auto index = promise.ptr();
    m_pendingPromises.add(index, WTF::move(promise));
    WeakPtr weakThis { *this };
    auto callback = [index, weakThis](const Vector<uint8_t>& signature) mutable {
        if (auto promise = getPromise(index, weakThis))
            fulfillPromiseWithArrayBuffer(promise.releaseNonNull(), signature.begin(), signature.size());
    };
    auto exceptionCallback = [index, weakThis](ExceptionCode ec, const String& msg) mutable {
        if (auto promise = getPromise(index, weakThis))
            rejectWithException(promise.releaseNonNull(), ec, msg);
    };

    RELEASE_AND_RETURN(scope, algorithm->sign(*params, key, WTF::move(*data), WTF::move(callback), WTF::move(exceptionCallback), *scriptExecutionContext(), m_workQueue));
}

void SubtleCrypto::verify(JSC::JSGlobalObject& state, AlgorithmIdentifier&& algorithmIdentifier, CryptoKey& key, BufferSource&& signatureBufferSource, BufferSource&& dataBufferSource, Ref<DeferredPromise>&& promise)
{
    auto& vm = state.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto params = normalizeOrReject(state, algorithmIdentifier, Operations::Verify, promise);
    RETURN_IF_EXCEPTION(scope, void());
    if (!params)
        return;

    auto signature = copyToVector(WTF::move(signatureBufferSource), promise);
    if (!signature)
        return;
    auto data = copyToVector(WTF::move(dataBufferSource), promise);
    if (!data)
        return;

    if (params->identifier != key.algorithmIdentifier()) {
        promise->reject(InvalidAccessError, "Key algorithm mismatch"_s);
        return;
    }

    if (!key.allows(CryptoKeyUsageVerify)) {
        promise->reject(InvalidAccessError, "Unable to use this key to verify"_s);
        return;
    }

    if (rejectIfMlDsaContextTooLong(*params, WTF::move(promise)))
        return;

    auto algorithm = CryptoAlgorithmRegistry::singleton().create(key.algorithmIdentifier());

    auto index = promise.ptr();
    m_pendingPromises.add(index, WTF::move(promise));
    WeakPtr weakThis { *this };
    auto callback = [index, weakThis](bool result) mutable {
        if (auto promise = getPromise(index, weakThis))
            promise->resolve<IDLBoolean>(result);
    };
    auto exceptionCallback = [index, weakThis](ExceptionCode ec, const String& msg) mutable {
        if (auto promise = getPromise(index, weakThis))
            rejectWithException(promise.releaseNonNull(), ec, msg);
    };

    RELEASE_AND_RETURN(scope, algorithm->verify(*params, key, WTF::move(*signature), WTF::move(*data), WTF::move(callback), WTF::move(exceptionCallback), *scriptExecutionContext(), m_workQueue));
}

void SubtleCrypto::digest(JSC::JSGlobalObject& state, AlgorithmIdentifier&& algorithmIdentifier, BufferSource&& dataBufferSource, Ref<DeferredPromise>&& promise)
{
    auto& vm = state.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto params = normalizeOrReject(state, algorithmIdentifier, Operations::Digest, promise);
    RETURN_IF_EXCEPTION(scope, void());
    if (!params)
        return;

    auto data = copyToVector(WTF::move(dataBufferSource), promise);
    if (!data)
        return;

    auto algorithm = CryptoAlgorithmRegistry::singleton().create(params->identifier);

    auto index = promise.ptr();
    m_pendingPromises.add(index, WTF::move(promise));
    WeakPtr weakThis { *this };
    auto callback = [index, weakThis](const Vector<uint8_t>& digest) mutable {
        if (auto promise = getPromise(index, weakThis))
            fulfillPromiseWithArrayBuffer(promise.releaseNonNull(), digest.begin(), digest.size());
    };
    auto exceptionCallback = [index, weakThis](ExceptionCode ec, const String& msg) mutable {
        if (auto promise = getPromise(index, weakThis))
            rejectWithException(promise.releaseNonNull(), ec, msg);
    };

    RELEASE_AND_RETURN(scope, algorithm->digest(WTF::move(*data), WTF::move(callback), WTF::move(exceptionCallback), *scriptExecutionContext(), m_workQueue));
}

void SubtleCrypto::generateKey(JSC::JSGlobalObject& state, AlgorithmIdentifier&& algorithmIdentifier, bool extractable, Vector<CryptoKeyUsage>&& keyUsages, Ref<DeferredPromise>&& promise)
{
    auto& vm = state.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto params = normalizeOrReject(state, algorithmIdentifier, Operations::GenerateKey, promise);
    RETURN_IF_EXCEPTION(scope, void());
    if (!params)
        return;

    auto keyUsagesBitmap = toCryptoKeyUsageBitmap(keyUsages);

    auto algorithm = CryptoAlgorithmRegistry::singleton().create(params->identifier);

    auto index = promise.ptr();
    m_pendingPromises.add(index, WTF::move(promise));
    WeakPtr weakThis { *this };
    auto callback = [index, weakThis](KeyOrKeyPair&& keyOrKeyPair) mutable {
        if (auto promise = getPromise(index, weakThis)) {
            std::visit(
                WTF::makeVisitor(
                    [&promise](RefPtr<CryptoKey>& key) {
                        if ((key->type() == CryptoKeyType::Private || key->type() == CryptoKeyType::Secret) && !key->usagesBitmap()) {
                            rejectWithException(promise.releaseNonNull(), SyntaxError, "Usages cannot be empty when creating a key."_s);
                            return;
                        }
                        promise->resolve<IDLInterface<CryptoKey>>(*key);
                    },
                    [&promise](CryptoKeyPair& keyPair) {
                        if (!keyPair.privateKey->usagesBitmap()) {
                            rejectWithException(promise.releaseNonNull(), SyntaxError, "Usages cannot be empty when creating a key."_s);
                            return;
                        }
                        promise->resolve<IDLDictionary<CryptoKeyPair>>(keyPair);
                    }),
                keyOrKeyPair);
        }
    };
    auto exceptionCallback = [index, weakThis](ExceptionCode ec, const String& msg) mutable {
        if (auto promise = getPromise(index, weakThis))
            rejectWithException(promise.releaseNonNull(), ec, msg);
    };

    ncrypto::ClearErrorOnReturn clearErrorOnReturn;
    // The 26 January 2017 version of the specification suggests we should perform the following task asynchronously
    // regardless what kind of keys it produces: https://www.w3.org/TR/WebCryptoAPI/#SubtleCrypto-method-generateKey
    // That's simply not efficient for AES, HMAC and EC keys. Therefore, we perform it as an async task only for RSA keys.
    RELEASE_AND_RETURN(scope, algorithm->generateKey(*params, extractable, keyUsagesBitmap, WTF::move(callback), WTF::move(exceptionCallback), *scriptExecutionContext()));
}

void SubtleCrypto::deriveKey(JSC::JSGlobalObject& state, AlgorithmIdentifier&& algorithmIdentifier, CryptoKey& baseKey, AlgorithmIdentifier&& derivedKeyType, bool extractable, Vector<CryptoKeyUsage>&& keyUsages, Ref<DeferredPromise>&& promise)
{
    auto& vm = state.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto params = normalizeOrReject(state, algorithmIdentifier, Operations::DeriveBits, promise);
    RETURN_IF_EXCEPTION(scope, void());
    if (!params)
        return;

    auto importParams = normalizeOrReject(state, derivedKeyType, Operations::ImportKey, promise);
    RETURN_IF_EXCEPTION(scope, void());
    if (!importParams)
        return;

    auto getLengthParams = normalizeOrReject(state, derivedKeyType, Operations::GetKeyLength, promise);
    RETURN_IF_EXCEPTION(scope, void());
    if (!getLengthParams)
        return;

    auto keyUsagesBitmap = toCryptoKeyUsageBitmap(keyUsages);

    if (!baseKey.allows(CryptoKeyUsageDeriveKey)) {
        promise->reject(InvalidAccessError, "baseKey does not have deriveKey usage"_s);
        return;
    }

    if (params->identifier != baseKey.algorithmIdentifier()) {
        promise->reject(InvalidAccessError, "Key algorithm mismatch"_s);
        return;
    }

    auto getLengthAlgorithm = CryptoAlgorithmRegistry::singleton().create(getLengthParams->identifier);

    auto result = getLengthAlgorithm->getKeyLength(*getLengthParams);
    if (result.hasException()) {
        promise->reject(result.releaseException().code(), "Cannot get key length from derivedKeyType"_s);
        return;
    }
    std::optional<size_t> length = result.releaseReturnValue();

    auto importAlgorithm = CryptoAlgorithmRegistry::singleton().create(importParams->identifier);
    auto algorithm = CryptoAlgorithmRegistry::singleton().create(params->identifier);

    auto isolatedParams = isolateOrReject(WTF::move(*importParams), promise);
    if (!isolatedParams)
        return;

    auto index = promise.ptr();
    m_pendingPromises.add(index, WTF::move(promise));
    WeakPtr weakThis { *this };
    auto callback = [index, weakThis, importAlgorithm = WTF::move(importAlgorithm), importParams = WTF::move(*isolatedParams), extractable, keyUsagesBitmap](const Vector<uint8_t>& derivedKey) mutable {
        // FIXME: https://bugs.webkit.org/show_bug.cgi?id=169395
        KeyData data = derivedKey;
        auto callback = [index, weakThis](CryptoKey& key) mutable {
            if (auto promise = getPromise(index, weakThis)) {
                if ((key.type() == CryptoKeyType::Private || key.type() == CryptoKeyType::Secret) && !key.usagesBitmap()) {
                    rejectWithException(promise.releaseNonNull(), SyntaxError,
                        key.type() == CryptoKeyType::Private
                            ? "Usages cannot be empty when importing a private key."_s
                            : "Usages cannot be empty when importing a secret key."_s);
                    return;
                }
                promise->resolve<IDLInterface<CryptoKey>>(key);
            }
        };
        auto exceptionCallback = [index, weakThis](ExceptionCode ec, const String& msg) mutable {
            if (auto promise = getPromise(index, weakThis))
                rejectWithException(promise.releaseNonNull(), ec, msg);
        };

        // Legacy secret-key algorithms accept both raw spellings, but the modern
        // ones (ChaCha20-Poly1305, AKP) only take raw-secret; HKDF/PBKDF2 only
        // take raw. Mirrors the encapsulateKey/decapsulateKey import below.
        auto importFormat = importParams.identifier == CryptoAlgorithmIdentifier::HKDF || importParams.identifier == CryptoAlgorithmIdentifier::PBKDF2
            ? SubtleCrypto::KeyFormat::Raw
            : SubtleCrypto::KeyFormat::RawSecret;
        importAlgorithm->importKey(importFormat, WTF::move(data), importParams, extractable, keyUsagesBitmap, WTF::move(callback), WTF::move(exceptionCallback));
    };
    auto exceptionCallback = [index, weakThis](ExceptionCode ec, const String& msg) mutable {
        if (auto promise = getPromise(index, weakThis))
            rejectWithException(promise.releaseNonNull(), ec, msg);
    };

    RELEASE_AND_RETURN(scope, algorithm->deriveBits(*params, baseKey, length, WTF::move(callback), WTF::move(exceptionCallback), *scriptExecutionContext(), m_workQueue));
}

void SubtleCrypto::deriveBits(JSC::JSGlobalObject& state, AlgorithmIdentifier&& algorithmIdentifier, CryptoKey& baseKey, std::optional<unsigned> length, Ref<DeferredPromise>&& promise)
{
    auto& vm = state.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto params = normalizeOrReject(state, algorithmIdentifier, Operations::DeriveBits, promise);
    RETURN_IF_EXCEPTION(scope, void());
    if (!params)
        return;

    if (!baseKey.allows(CryptoKeyUsageDeriveBits)) {
        promise->reject(InvalidAccessError, "baseKey does not have deriveBits usage"_s);
        return;
    }

    if (params->identifier != baseKey.algorithmIdentifier()) {
        promise->reject(InvalidAccessError, "Key algorithm mismatch"_s);
        return;
    }

    auto algorithm = CryptoAlgorithmRegistry::singleton().create(params->identifier);

    auto index = promise.ptr();
    m_pendingPromises.add(index, WTF::move(promise));
    WeakPtr weakThis { *this };
    auto callback = [index, weakThis](const Vector<uint8_t>& derivedKey) mutable {
        if (auto promise = getPromise(index, weakThis))
            fulfillPromiseWithArrayBuffer(promise.releaseNonNull(), derivedKey.begin(), derivedKey.size());
    };
    auto exceptionCallback = [index, weakThis](ExceptionCode ec, const String& msg) mutable {
        if (auto promise = getPromise(index, weakThis))
            rejectWithException(promise.releaseNonNull(), ec, msg);
    };

    RELEASE_AND_RETURN(scope, algorithm->deriveBits(*params, baseKey, length, WTF::move(callback), WTF::move(exceptionCallback), *scriptExecutionContext(), m_workQueue));
}

// Node's aliasKeyFormat maps raw-secret and raw-public to raw for these
// algorithms and rejects the seed/public formats everywhere else; only the
// ML algorithms consume them directly (lib/internal/crypto/webcrypto.js).
// Shared by importKey and unwrapKey; returns false after rejecting the promise.
static bool aliasImportKeyFormat(CryptoAlgorithmIdentifier identifier, SubtleCrypto::KeyFormat& format, DeferredPromise& promise)
{
    using KeyFormat = SubtleCrypto::KeyFormat;
    switch (identifier) {
    case CryptoAlgorithmIdentifier::RSAES_PKCS1_v1_5:
    case CryptoAlgorithmIdentifier::RSASSA_PKCS1_v1_5:
    case CryptoAlgorithmIdentifier::RSA_PSS:
    case CryptoAlgorithmIdentifier::RSA_OAEP:
    case CryptoAlgorithmIdentifier::ECDSA:
    case CryptoAlgorithmIdentifier::ECDH:
    case CryptoAlgorithmIdentifier::Ed25519:
    case CryptoAlgorithmIdentifier::X25519:
    case CryptoAlgorithmIdentifier::HKDF:
    case CryptoAlgorithmIdentifier::PBKDF2:
        if (format == KeyFormat::RawSecret)
            format = KeyFormat::Raw;
        break;
    default:
        break;
    }
    if (!isAkpAlgorithm(identifier) && (format == KeyFormat::RawPublic || format == KeyFormat::RawSeed)) {
        bool aliasesRawPublic = false;
        switch (identifier) {
        case CryptoAlgorithmIdentifier::RSAES_PKCS1_v1_5:
        case CryptoAlgorithmIdentifier::RSASSA_PKCS1_v1_5:
        case CryptoAlgorithmIdentifier::RSA_PSS:
        case CryptoAlgorithmIdentifier::RSA_OAEP:
        case CryptoAlgorithmIdentifier::ECDSA:
        case CryptoAlgorithmIdentifier::ECDH:
        case CryptoAlgorithmIdentifier::Ed25519:
        case CryptoAlgorithmIdentifier::X25519:
        case CryptoAlgorithmIdentifier::HKDF:
        case CryptoAlgorithmIdentifier::PBKDF2:
            aliasesRawPublic = true;
            break;
        default:
            break;
        }
        if (format == KeyFormat::RawPublic && aliasesRawPublic)
            format = KeyFormat::Raw;
        else {
            promise.reject(NotSupportedError, makeString("Unable to import "_s, CryptoAlgorithmRegistry::singleton().name(identifier), " using "_s, format == KeyFormat::RawPublic ? "raw-public"_s : "raw-seed"_s, " format"_s));
            return false;
        }
    }
    return true;
}

// Export-side twin of aliasImportKeyFormat, shared by exportKey and wrapKey.
static bool aliasExportKeyFormat(const CryptoKey& key, SubtleCrypto::KeyFormat& format, DeferredPromise& promise)
{
    using KeyFormat = SubtleCrypto::KeyFormat;
    if (!isAkpAlgorithm(key.algorithmIdentifier()) && (format == KeyFormat::RawPublic || format == KeyFormat::RawSeed)) {
        bool aliasesRawPublic = false;
        switch (key.algorithmIdentifier()) {
        case CryptoAlgorithmIdentifier::ECDSA:
        case CryptoAlgorithmIdentifier::ECDH:
        case CryptoAlgorithmIdentifier::Ed25519:
        case CryptoAlgorithmIdentifier::X25519:
            aliasesRawPublic = key.type() == CryptoKeyType::Public;
            break;
        default:
            break;
        }
        if (format == KeyFormat::RawPublic && aliasesRawPublic)
            format = KeyFormat::Raw;
        else {
            auto type = key.type() == CryptoKeyType::Private ? "private"_s : key.type() == CryptoKeyType::Public ? "public"_s
                                                                                                                 : "secret"_s;
            promise.reject(NotSupportedError, makeString("Unable to export "_s, CryptoAlgorithmRegistry::singleton().name(key.algorithmIdentifier()), ' ', type, " key using "_s, format == KeyFormat::RawPublic ? "raw-public"_s : "raw-seed"_s, " format"_s));
            return false;
        }
    }
    return true;
}

void SubtleCrypto::importKey(JSC::JSGlobalObject& state, KeyFormat format, KeyDataVariant&& keyDataVariant, AlgorithmIdentifier&& algorithmIdentifier, bool extractable, Vector<CryptoKeyUsage>&& keyUsages, Ref<DeferredPromise>&& promise)
{
    auto& vm = state.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto params = normalizeOrReject(state, algorithmIdentifier, Operations::ImportKey, promise);
    RETURN_IF_EXCEPTION(scope, void());
    if (!params)
        return;

    auto keyDataOrNull = toKeyData(format, WTF::move(keyDataVariant), promise);
    if (!keyDataOrNull) {
        // When toKeyData, it means the promise has been rejected, and we should return.
        return;
    }

    auto keyData = *keyDataOrNull;
    auto keyUsagesBitmap = toCryptoKeyUsageBitmap(keyUsages);

    if (!aliasImportKeyFormat(params->identifier, format, promise.get()))
        return;

    auto algorithm = CryptoAlgorithmRegistry::singleton().create(params->identifier);

    auto index = promise.ptr();
    m_pendingPromises.add(index, WTF::move(promise));
    WeakPtr weakThis { *this };
    auto callback = [index, weakThis](CryptoKey& key) mutable {
        if (auto promise = getPromise(index, weakThis)) {
            if ((key.type() == CryptoKeyType::Private || key.type() == CryptoKeyType::Secret) && !key.usagesBitmap()) {
                rejectWithException(promise.releaseNonNull(), SyntaxError,
                    key.type() == CryptoKeyType::Private
                        ? "Usages cannot be empty when importing a private key."_s
                        : "Usages cannot be empty when importing a secret key."_s);
                return;
            }
            promise->resolve<IDLInterface<CryptoKey>>(key);
        }
    };
    auto exceptionCallback = [index, weakThis, identifier = params->identifier](ExceptionCode ec, const String& msg) mutable {
        if (auto promise = getPromise(index, weakThis))
            rejectImportKeyException(promise.releaseNonNull(), ec, msg, identifier);
    };

    ncrypto::ClearErrorOnReturn clearErrorOnReturn;
    // The 11 December 2014 version of the specification suggests we should perform the following task asynchronously:
    // https://www.w3.org/TR/WebCryptoAPI/#SubtleCrypto-method-importKey
    // It is not beneficial for less time consuming operations. Therefore, we perform it synchronously.
    RELEASE_AND_RETURN(scope, algorithm->importKey(format, WTF::move(keyData), *params, extractable, keyUsagesBitmap, WTF::move(callback), WTF::move(exceptionCallback)));
}

void SubtleCrypto::exportKey(KeyFormat format, CryptoKey& key, Ref<DeferredPromise>&& promise)
{
    if (!isSupportedExportKey(key.algorithmIdentifier())) {
        promise->reject(Exception { NotSupportedError });
        return;
    }

    if (!key.extractable()) {
        promise->reject(InvalidAccessError, "key is not extractable"_s);
        return;
    }

    if (!aliasExportKeyFormat(key, format, promise.get()))
        return;

    auto algorithm = CryptoAlgorithmRegistry::singleton().create(key.algorithmIdentifier());

    auto index = promise.ptr();
    m_pendingPromises.add(index, WTF::move(promise));
    WeakPtr weakThis { *this };
    auto callback = [index, weakThis](SubtleCrypto::KeyFormat format, KeyData&& key) mutable {
        if (auto promise = getPromise(index, weakThis)) {
            switch (format) {
            case SubtleCrypto::KeyFormat::Spki:
            case SubtleCrypto::KeyFormat::Pkcs8:
            case SubtleCrypto::KeyFormat::RawSecret:
            case SubtleCrypto::KeyFormat::RawPublic:
            case SubtleCrypto::KeyFormat::RawSeed:
            case SubtleCrypto::KeyFormat::Raw: {
                Vector<uint8_t>& rawKey = std::get<Vector<uint8_t>>(key);
                fulfillPromiseWithArrayBuffer(promise.releaseNonNull(), rawKey.begin(), rawKey.size());
                return;
            }
            case SubtleCrypto::KeyFormat::Jwk:
                promise->resolve<IDLDictionary<JsonWebKey>>(WTF::move(std::get<JsonWebKey>(key)));
                return;
            }
            ASSERT_NOT_REACHED();
        }
    };
    auto exceptionCallback = [index, weakThis](ExceptionCode ec, const String& msg) mutable {
        if (auto promise = getPromise(index, weakThis))
            rejectWithException(promise.releaseNonNull(), ec, msg);
    };

    // The 11 December 2014 version of the specification suggests we should perform the following task asynchronously:
    // https://www.w3.org/TR/WebCryptoAPI/#SubtleCrypto-method-exportKey
    // It is not beneficial for less time consuming operations. Therefore, we perform it synchronously.
    algorithm->exportKey(format, key, WTF::move(callback), WTF::move(exceptionCallback));
}

void SubtleCrypto::wrapKey(JSC::JSGlobalObject& state, KeyFormat format, CryptoKey& key, CryptoKey& wrappingKey, AlgorithmIdentifier&& wrapAlgorithmIdentifier, Ref<DeferredPromise>&& promise)
{
    auto& vm = state.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto wrapParams = normalizeWrapAlgorithmOrReject(state, wrapAlgorithmIdentifier, promise);
    RETURN_IF_EXCEPTION(scope, void());
    if (!wrapParams)
        return;

    if (wrapParams->identifier != wrappingKey.algorithmIdentifier()) {
        promise->reject(InvalidAccessError, "Key algorithm mismatch"_s);
        return;
    }

    if (!wrappingKey.allows(CryptoKeyUsageWrapKey)) {
        promise->reject(InvalidAccessError, "Unable to use this key to wrapKey"_s);
        return;
    }

    if (!isSupportedExportKey(key.algorithmIdentifier())) {
        promise->reject(Exception { NotSupportedError });
        return;
    }

    if (!key.extractable()) {
        promise->reject(InvalidAccessError, "key is not extractable"_s);
        return;
    }

    // wrapKey re-uses the exportKey machinery, so it needs the same
    // raw-public/raw-seed aliasing (subtle.wrapKey('raw-public', ...) works in
    // Node for EC/OKP public keys). After the extractable check, like
    // exportKey: node rejects a non-extractable key first.
    if (!aliasExportKeyFormat(key, format, promise.get()))
        return;

    auto exportAlgorithm = CryptoAlgorithmRegistry::singleton().create(key.algorithmIdentifier());
    auto wrapAlgorithm = CryptoAlgorithmRegistry::singleton().create(wrappingKey.algorithmIdentifier());

    auto context = scriptExecutionContext();

    auto index = promise.ptr();
    m_pendingPromises.add(index, WTF::move(promise));
    WeakPtr weakThis { *this };
    auto callback = [index, weakThis, wrapAlgorithm, wrappingKey = Ref { wrappingKey }, wrapParams = WTF::move(*wrapParams), context, workQueue = m_workQueue](SubtleCrypto::KeyFormat format, KeyData&& key) mutable {
        if (weakThis) {
            // get() peeks the map's Ref as a raw pointer; the JWK error paths below remove that
            // Ref before rejecting, so hold our own reference like the unwrapKey callback does.
            if (RefPtr promise = weakThis->m_pendingPromises.get(index)) {
                auto& vm = promise->globalObject()->vm();
                auto scope = DECLARE_THROW_SCOPE(vm);
                Vector<uint8_t> bytes;
                switch (format) {
                case SubtleCrypto::KeyFormat::Spki:
                case SubtleCrypto::KeyFormat::Pkcs8:
                case SubtleCrypto::KeyFormat::RawSecret:
                case SubtleCrypto::KeyFormat::RawPublic:
                case SubtleCrypto::KeyFormat::RawSeed:
                case SubtleCrypto::KeyFormat::Raw:
                    bytes = WTF::move(std::get<Vector<uint8_t>>(key));
                    break;
                case SubtleCrypto::KeyFormat::Jwk: {
                    // FIXME: Converting to JS just to JSON-Stringify seems inefficient. We should find a way to go directly from the struct to JSON.
                    auto jwk = toJS<IDLDictionary<JsonWebKey>>(*(promise->globalObject()), *(promise->globalObject()), WTF::move(std::get<JsonWebKey>(key)));
                    if (scope.exception()) [[unlikely]] {
                        weakThis->m_pendingPromises.remove(index);
                        promise->reject(Exception { ExistingExceptionError });
                        return;
                    }
                    String jwkString = JSONStringify(promise->globalObject(), jwk, 0);
                    if (scope.exception()) [[unlikely]] {
                        weakThis->m_pendingPromises.remove(index);
                        promise->reject(Exception { ExistingExceptionError });
                        return;
                    }
                    // AES-KW (RFC 3394) can only wrap plaintext whose length is a multiple of
                    // 8 bytes. A serialized JWK usually isn't, so pad it with trailing spaces,
                    // which JSON.parse ignores when the key is unwrapped. This matches Node.js.
                    auto jwkUTF8 = Bun::UTF8View::tryCreate(jwkString);
                    size_t paddedSize = jwkUTF8 ? jwkUTF8->bytes().size() : 0;
                    if (wrappingKey->algorithmIdentifier() == CryptoAlgorithmIdentifier::AES_KW)
                        paddedSize = roundUpToMultipleOf(8, paddedSize);
                    if (!jwkUTF8 || paddedSize > Bun::maxVectorSize<uint8_t>() || !bytes.tryReserveInitialCapacity(paddedSize)) [[unlikely]] {
                        weakThis->m_pendingPromises.remove(index);
                        promise->reject(inputTooLarge());
                        return;
                    }
                    bytes.append(jwkUTF8->bytes());
                    while (bytes.size() < paddedSize)
                        bytes.append(' ');
                }
                }

                auto callback = [index, weakThis](const Vector<uint8_t>& wrappedKey) mutable {
                    if (auto promise = getPromise(index, weakThis))
                        fulfillPromiseWithArrayBuffer(promise.releaseNonNull(), wrappedKey.begin(), wrappedKey.size());
                };
                auto exceptionCallback = [index, weakThis](ExceptionCode ec, const String& msg) mutable {
                    if (auto promise = getPromise(index, weakThis))
                        rejectWithException(promise.releaseNonNull(), ec, msg);
                };

                if (wrapParams.identifier == CryptoAlgorithmIdentifier::AES_KW) {
                    // The 11 December 2014 version of the specification suggests we should perform the following task asynchronously:
                    // https://www.w3.org/TR/WebCryptoAPI/#SubtleCrypto-method-wrapKey
                    // It is not beneficial for less time consuming operations. Therefore, we perform it synchronously.
                    RELEASE_AND_RETURN(scope, wrapAlgorithm->wrapKey(wrappingKey.get(), WTF::move(bytes), WTF::move(callback), WTF::move(exceptionCallback)));
                }
                // The following operation should be performed asynchronously.
                RELEASE_AND_RETURN(scope, wrapAlgorithm->encrypt(wrapParams, WTF::move(wrappingKey), WTF::move(bytes), WTF::move(callback), WTF::move(exceptionCallback), *context, workQueue));
            }
        }
    };
    auto exceptionCallback = [index, weakThis](ExceptionCode ec, const String& msg) mutable {
        if (auto promise = getPromise(index, weakThis))
            rejectWithException(promise.releaseNonNull(), ec, msg);
    };

    // The following operation should be performed synchronously.
    RELEASE_AND_RETURN(scope, exportAlgorithm->exportKey(format, key, WTF::move(callback), WTF::move(exceptionCallback)));
}

void SubtleCrypto::unwrapKey(JSC::JSGlobalObject& state, KeyFormat format, BufferSource&& wrappedKeyBufferSource, CryptoKey& unwrappingKey, AlgorithmIdentifier&& unwrapAlgorithmIdentifier, AlgorithmIdentifier&& unwrappedKeyAlgorithmIdentifier, bool extractable, Vector<CryptoKeyUsage>&& keyUsages, Ref<DeferredPromise>&& promise)
{
    auto& vm = state.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto wrappedKey = copyToVector(WTF::move(wrappedKeyBufferSource), promise);
    if (!wrappedKey)
        return;

    auto unwrapParams = normalizeWrapAlgorithmOrReject(state, unwrapAlgorithmIdentifier, promise);
    RETURN_IF_EXCEPTION(scope, void());
    if (!unwrapParams)
        return;

    auto unwrappedKeyAlgorithm = normalizeOrReject(state, unwrappedKeyAlgorithmIdentifier, Operations::ImportKey, promise);
    RETURN_IF_EXCEPTION(scope, void());
    if (!unwrappedKeyAlgorithm)
        return;

    auto keyUsagesBitmap = toCryptoKeyUsageBitmap(keyUsages);

    if (unwrapParams->identifier != unwrappingKey.algorithmIdentifier()) {
        promise->reject(InvalidAccessError, "Key algorithm mismatch"_s);
        return;
    }

    if (!unwrappingKey.allows(CryptoKeyUsageUnwrapKey)) {
        promise->reject(InvalidAccessError, "Unable to use this key to unwrapKey"_s);
        return;
    }

    // unwrapKey re-uses the importKey machinery, so it needs the same
    // raw-secret/raw-public aliasing that importKey applies.
    if (!aliasImportKeyFormat(unwrappedKeyAlgorithm->identifier, format, promise.get()))
        return;

    auto importAlgorithm = CryptoAlgorithmRegistry::singleton().create(unwrappedKeyAlgorithm->identifier);
    if (!importAlgorithm) [[unlikely]] {
        promise->reject(Exception { NotSupportedError });
        return;
    }

    auto unwrapAlgorithm = CryptoAlgorithmRegistry::singleton().create(unwrappingKey.algorithmIdentifier());
    if (!unwrapAlgorithm) [[unlikely]] {
        promise->reject(Exception { NotSupportedError });
        return;
    }

    auto isolatedParams = isolateOrReject(WTF::move(*unwrappedKeyAlgorithm), promise);
    if (!isolatedParams)
        return;

    auto index = promise.ptr();
    m_pendingPromises.add(index, WTF::move(promise));
    WeakPtr weakThis { *this };
    auto callback = [index, weakThis, format, importAlgorithm, unwrappedKeyAlgorithm = WTF::move(*isolatedParams), extractable, keyUsagesBitmap](const Vector<uint8_t>& bytes) mutable {
        if (weakThis) {
            if (RefPtr promise = weakThis->m_pendingPromises.get(index)) {
                auto& state = *(promise->globalObject());
                auto& vm = state.vm();
                JSLockHolder locker(vm);
                auto scope = DECLARE_THROW_SCOPE(vm);

                KeyData keyData;
                switch (format) {
                case SubtleCrypto::KeyFormat::Spki:
                case SubtleCrypto::KeyFormat::Pkcs8:
                case SubtleCrypto::KeyFormat::RawSecret:
                case SubtleCrypto::KeyFormat::RawPublic:
                case SubtleCrypto::KeyFormat::RawSeed:
                case SubtleCrypto::KeyFormat::Raw:
                    keyData = bytes;
                    break;
                case SubtleCrypto::KeyFormat::Jwk: {
                    String jwkString(byteCast<Latin1Character>(bytes.span()));
                    auto jwkObject = JSONParse(&state, jwkString);
                    if (scope.exception()) [[unlikely]] {
                        weakThis->m_pendingPromises.remove(index);
                        promise->reject(Exception { ExistingExceptionError });
                        return;
                    }
                    if (!jwkObject) {
                        weakThis->m_pendingPromises.remove(index);
                        promise->reject(DataError, "WrappedKey cannot be converted to a JSON object"_s);
                        return;
                    }
                    auto jwk = convert<IDLDictionary<JsonWebKey>>(state, jwkObject);
                    if (scope.exception()) [[unlikely]] {
                        weakThis->m_pendingPromises.remove(index);
                        promise->reject(Exception { ExistingExceptionError });
                        return;
                    }
                    normalizeJsonWebKey(jwk);

                    keyData = jwk;
                    break;
                }
                }

                auto callback = [index, weakThis](CryptoKey& key) mutable {
                    if (auto promise = getPromise(index, weakThis)) {
                        if ((key.type() == CryptoKeyType::Private || key.type() == CryptoKeyType::Secret) && !key.usagesBitmap()) {
                            rejectWithException(promise.releaseNonNull(), SyntaxError,
                                key.type() == CryptoKeyType::Private
                                    ? "Usages cannot be empty when importing a private key."_s
                                    : "Usages cannot be empty when importing a secret key."_s);
                            return;
                        }
                        promise->resolve<IDLInterface<CryptoKey>>(key);
                    }
                };
                auto exceptionCallback = [index, weakThis, identifier = importAlgorithm->identifier()](ExceptionCode ec, const String& msg) mutable {
                    if (auto promise = getPromise(index, weakThis))
                        rejectImportKeyException(promise.releaseNonNull(), ec, msg, identifier);
                };

                ncrypto::ClearErrorOnReturn clearErrorOnReturn;
                // The following operation should be performed synchronously.
                RELEASE_AND_RETURN(scope, importAlgorithm->importKey(format, WTF::move(keyData), unwrappedKeyAlgorithm, extractable, keyUsagesBitmap, WTF::move(callback), WTF::move(exceptionCallback)));
            }
        }
    };
    auto exceptionCallback = [index, weakThis](ExceptionCode ec, const String& msg) mutable {
        if (auto promise = getPromise(index, weakThis))
            rejectWithException(promise.releaseNonNull(), ec, msg);
    };

    if (unwrapParams->identifier == CryptoAlgorithmIdentifier::AES_KW) {
        // The 11 December 2014 version of the specification suggests we should perform the following task asynchronously:
        // https://www.w3.org/TR/WebCryptoAPI/#SubtleCrypto-method-unwrapKey
        // It is not beneficial for less time consuming operations. Therefore, we perform it synchronously.
        RELEASE_AND_RETURN(scope, unwrapAlgorithm->unwrapKey(unwrappingKey, WTF::move(*wrappedKey), WTF::move(callback), WTF::move(exceptionCallback)));
    }

    RELEASE_AND_RETURN(scope, unwrapAlgorithm->decrypt(*unwrapParams, unwrappingKey, WTF::move(*wrappedKey), WTF::move(callback), WTF::move(exceptionCallback), *scriptExecutionContext(), m_workQueue));
}

static JSC::JSValue toJSArrayBuffer(JSDOMGlobalObject& globalObject, RefPtr<JSC::ArrayBuffer>&& buffer)
{
    return JSC::JSArrayBuffer::create(globalObject.vm(), globalObject.arrayBufferStructure(JSC::ArrayBufferSharingMode::Default), WTF::move(buffer));
}

static std::optional<Vector<uint8_t>> marshalPublicKey(const CryptoKey& key)
{
    switch (key.keyClass()) {
    case CryptoKeyClass::RSA:
        return marshalEVPKey(uncheckedDowncast<CryptoKeyRSA>(key).platformKey(), true);
    case CryptoKeyClass::EC:
        return marshalEVPKey(uncheckedDowncast<CryptoKeyEC>(key).platformKey(), true);
    case CryptoKeyClass::AKP:
        return marshalEVPKey(uncheckedDowncast<CryptoKeyAKP>(key).platformKey(), true);
    case CryptoKeyClass::OKP:
        return marshalEVPKey(uncheckedDowncast<CryptoKeyOKP>(key).toEVPKey().get(), true);
    case CryptoKeyClass::AES:
    case CryptoKeyClass::HMAC:
    case CryptoKeyClass::Raw:
        break;
    }
    return std::nullopt;
}

void SubtleCrypto::getPublicKey(JSC::JSGlobalObject& state, CryptoKey& key, Vector<CryptoKeyUsage>&& keyUsages, Ref<DeferredPromise>&& promise)
{
    if (key.type() != CryptoKeyType::Private) {
        promise->reject(key.type() == CryptoKeyType::Secret ? NotSupportedError : InvalidAccessError, "key must be a private key"_s);
        return;
    }

    auto keyUsagesBitmap = toCryptoKeyUsageBitmap(keyUsages);
    auto identifier = key.algorithmIdentifier();

    CryptoAlgorithmParameters importParams { identifier, {} };
    switch (identifier) {
    case CryptoAlgorithmIdentifier::RSASSA_PKCS1_v1_5:
    case CryptoAlgorithmIdentifier::RSA_PSS:
    case CryptoAlgorithmIdentifier::RSA_OAEP:
        importParams.dictionary = CryptoAlgorithmRsaHashedImportParams { downcast<CryptoKeyRSA>(key).hashAlgorithmIdentifier() };
        break;
    case CryptoAlgorithmIdentifier::ECDSA:
    case CryptoAlgorithmIdentifier::ECDH:
        importParams.dictionary = CryptoAlgorithmEcKeyParams { downcast<CryptoKeyEC>(key).namedCurveString() };
        break;
    case CryptoAlgorithmIdentifier::Ed25519:
    case CryptoAlgorithmIdentifier::X25519:
    case CryptoAlgorithmIdentifier::ML_DSA_44:
    case CryptoAlgorithmIdentifier::ML_DSA_65:
    case CryptoAlgorithmIdentifier::ML_DSA_87:
    case CryptoAlgorithmIdentifier::ML_KEM_768:
    case CryptoAlgorithmIdentifier::ML_KEM_1024:
        break;
    default:
        promise->reject(Exception { NotSupportedError });
        return;
    }

    auto spki = marshalPublicKey(key);
    if (!spki) {
        promise->reject(OperationError, ""_s);
        return;
    }

    auto algorithm = CryptoAlgorithmRegistry::singleton().create(identifier);

    auto index = promise.ptr();
    m_pendingPromises.add(index, WTF::move(promise));
    WeakPtr weakThis { *this };
    auto callback = [index, weakThis](CryptoKey& publicKey) mutable {
        if (auto promise = getPromise(index, weakThis))
            promise->resolve<IDLInterface<CryptoKey>>(publicKey);
    };
    auto exceptionCallback = [index, weakThis](ExceptionCode ec, const String& msg) mutable {
        if (auto promise = getPromise(index, weakThis))
            rejectWithException(promise.releaseNonNull(), ec, msg);
    };

    algorithm->importKey(KeyFormat::Spki, KeyData { WTF::move(*spki) }, importParams, true, keyUsagesBitmap, WTF::move(callback), WTF::move(exceptionCallback));
}

void SubtleCrypto::encapsulateBits(JSC::JSGlobalObject& state, AlgorithmIdentifier&& algorithmIdentifier, CryptoKey& encapsulationKey, Ref<DeferredPromise>&& promise)
{
    auto& vm = state.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto params = normalizeOrReject(state, algorithmIdentifier, Operations::Encapsulate, promise);
    RETURN_IF_EXCEPTION(scope, void());
    if (!params)
        return;

    if (params->identifier != encapsulationKey.algorithmIdentifier()) {
        promise->reject(InvalidAccessError, "key algorithm mismatch"_s);
        return;
    }

    if (!encapsulationKey.allows(CryptoKeyUsageEncapsulateBits)) {
        promise->reject(InvalidAccessError, "encapsulationKey does not have encapsulateBits usage"_s);
        return;
    }

    auto algorithm = CryptoAlgorithmRegistry::singleton().create(params->identifier);

    auto index = promise.ptr();
    m_pendingPromises.add(index, WTF::move(promise));
    WeakPtr weakThis { *this };
    auto callback = [index, weakThis](Vector<uint8_t>&& sharedKey, Vector<uint8_t>&& ciphertext) mutable {
        if (auto promise = getPromise(index, weakThis)) {
            auto sharedKeyBuffer = ArrayBuffer::tryCreate(sharedKey.span());
            auto ciphertextBuffer = ArrayBuffer::tryCreate(ciphertext.span());
            if (!sharedKeyBuffer || !ciphertextBuffer) {
                rejectWithException(promise.releaseNonNull(), OperationError, ""_s);
                return;
            }
            promise->resolveWithCallback([&](JSDOMGlobalObject& globalObject) -> JSC::JSValue {
                auto* result = JSC::constructEmptyObject(&globalObject);
                // Node v26.3.0 enumerates encapsulateBits results sharedKey-first
                // but encapsulateKey results ciphertext-first; match each path.
                result->putDirect(globalObject.vm(), JSC::Identifier::fromString(globalObject.vm(), "sharedKey"_s), toJSArrayBuffer(globalObject, WTF::move(sharedKeyBuffer)));
                result->putDirect(globalObject.vm(), JSC::Identifier::fromString(globalObject.vm(), "ciphertext"_s), toJSArrayBuffer(globalObject, WTF::move(ciphertextBuffer)));
                return result;
            });
        }
    };
    auto exceptionCallback = [index, weakThis](ExceptionCode ec, const String& msg) mutable {
        if (auto promise = getPromise(index, weakThis))
            rejectWithException(promise.releaseNonNull(), ec, msg);
    };

    RELEASE_AND_RETURN(scope, algorithm->encapsulate(encapsulationKey, WTF::move(callback), WTF::move(exceptionCallback)));
}

void SubtleCrypto::encapsulateKey(JSC::JSGlobalObject& state, AlgorithmIdentifier&& algorithmIdentifier, CryptoKey& encapsulationKey, AlgorithmIdentifier&& sharedKeyAlgorithm, bool extractable, Vector<CryptoKeyUsage>&& keyUsages, Ref<DeferredPromise>&& promise)
{
    auto& vm = state.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto params = normalizeOrReject(state, algorithmIdentifier, Operations::Encapsulate, promise);
    RETURN_IF_EXCEPTION(scope, void());
    if (!params)
        return;

    auto importParams = normalizeOrReject(state, sharedKeyAlgorithm, Operations::ImportKey, promise);
    RETURN_IF_EXCEPTION(scope, void());
    if (!importParams)
        return;

    auto keyUsagesBitmap = toCryptoKeyUsageBitmap(keyUsages);

    if (params->identifier != encapsulationKey.algorithmIdentifier()) {
        promise->reject(InvalidAccessError, "key algorithm mismatch"_s);
        return;
    }

    if (!encapsulationKey.allows(CryptoKeyUsageEncapsulateKey)) {
        promise->reject(InvalidAccessError, "encapsulationKey does not have encapsulateKey usage"_s);
        return;
    }

    auto algorithm = CryptoAlgorithmRegistry::singleton().create(params->identifier);
    auto importAlgorithm = CryptoAlgorithmRegistry::singleton().create(importParams->identifier);

    auto isolatedParams = isolateOrReject(WTF::move(*importParams), promise);
    if (!isolatedParams)
        return;

    auto index = promise.ptr();
    m_pendingPromises.add(index, WTF::move(promise));
    WeakPtr weakThis { *this };
    auto callback = [index, weakThis, importAlgorithm = WTF::move(importAlgorithm), importParams = WTF::move(*isolatedParams), extractable, keyUsagesBitmap](Vector<uint8_t>&& sharedKeyBytes, Vector<uint8_t>&& ciphertext) mutable {
        KeyData data = WTF::move(sharedKeyBytes);
        auto keyCallback = [index, weakThis, ciphertext = WTF::move(ciphertext)](CryptoKey& sharedKey) mutable {
            if (auto promise = getPromise(index, weakThis)) {
                if ((sharedKey.type() == CryptoKeyType::Private || sharedKey.type() == CryptoKeyType::Secret) && !sharedKey.usagesBitmap()) {
                    rejectWithException(promise.releaseNonNull(), SyntaxError, "Usages cannot be empty when importing a secret key."_s);
                    return;
                }
                auto ciphertextBuffer = ArrayBuffer::tryCreate(ciphertext.span());
                if (!ciphertextBuffer) {
                    rejectWithException(promise.releaseNonNull(), OperationError, ""_s);
                    return;
                }
                promise->resolveWithCallback([&](JSDOMGlobalObject& globalObject) -> JSC::JSValue {
                    auto* result = JSC::constructEmptyObject(&globalObject);
                    // Node v26.3.0 enumerates encapsulateKey results ciphertext-first,
                    // unlike encapsulateBits; match each path.
                    result->putDirect(globalObject.vm(), JSC::Identifier::fromString(globalObject.vm(), "ciphertext"_s), toJSArrayBuffer(globalObject, WTF::move(ciphertextBuffer)));
                    result->putDirect(globalObject.vm(), JSC::Identifier::fromString(globalObject.vm(), "sharedKey"_s), toJS(&globalObject, &globalObject, sharedKey));
                    return result;
                });
            }
        };
        auto keyExceptionCallback = [index, weakThis](ExceptionCode ec, const String& msg) mutable {
            if (auto promise = getPromise(index, weakThis))
                rejectWithException(promise.releaseNonNull(), ec, msg);
        };
        auto format = importParams.identifier == CryptoAlgorithmIdentifier::HKDF || importParams.identifier == CryptoAlgorithmIdentifier::PBKDF2
            ? SubtleCrypto::KeyFormat::Raw
            : SubtleCrypto::KeyFormat::RawSecret;
        importAlgorithm->importKey(format, WTF::move(data), importParams, extractable, keyUsagesBitmap, WTF::move(keyCallback), WTF::move(keyExceptionCallback));
    };
    auto exceptionCallback = [index, weakThis](ExceptionCode ec, const String& msg) mutable {
        if (auto promise = getPromise(index, weakThis))
            rejectWithException(promise.releaseNonNull(), ec, msg);
    };

    RELEASE_AND_RETURN(scope, algorithm->encapsulate(encapsulationKey, WTF::move(callback), WTF::move(exceptionCallback)));
}

void SubtleCrypto::decapsulateBits(JSC::JSGlobalObject& state, AlgorithmIdentifier&& algorithmIdentifier, CryptoKey& decapsulationKey, BufferSource&& ciphertextBufferSource, Ref<DeferredPromise>&& promise)
{
    auto& vm = state.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto params = normalizeOrReject(state, algorithmIdentifier, Operations::Decapsulate, promise);
    RETURN_IF_EXCEPTION(scope, void());
    if (!params)
        return;

    auto ciphertext = copyToVector(WTF::move(ciphertextBufferSource), promise);
    if (!ciphertext)
        return;

    if (params->identifier != decapsulationKey.algorithmIdentifier()) {
        promise->reject(InvalidAccessError, "key algorithm mismatch"_s);
        return;
    }

    if (!decapsulationKey.allows(CryptoKeyUsageDecapsulateBits)) {
        promise->reject(InvalidAccessError, "decapsulationKey does not have decapsulateBits usage"_s);
        return;
    }

    auto algorithm = CryptoAlgorithmRegistry::singleton().create(params->identifier);

    auto index = promise.ptr();
    m_pendingPromises.add(index, WTF::move(promise));
    WeakPtr weakThis { *this };
    auto callback = [index, weakThis](const Vector<uint8_t>& sharedKey) mutable {
        if (auto promise = getPromise(index, weakThis))
            fulfillPromiseWithArrayBuffer(promise.releaseNonNull(), sharedKey.begin(), sharedKey.size());
    };
    auto exceptionCallback = [index, weakThis](ExceptionCode ec, const String& msg) mutable {
        if (auto promise = getPromise(index, weakThis))
            rejectWithException(promise.releaseNonNull(), ec, msg);
    };

    RELEASE_AND_RETURN(scope, algorithm->decapsulate(decapsulationKey, WTF::move(*ciphertext), WTF::move(callback), WTF::move(exceptionCallback)));
}

void SubtleCrypto::decapsulateKey(JSC::JSGlobalObject& state, AlgorithmIdentifier&& algorithmIdentifier, CryptoKey& decapsulationKey, BufferSource&& ciphertextBufferSource, AlgorithmIdentifier&& sharedKeyAlgorithm, bool extractable, Vector<CryptoKeyUsage>&& keyUsages, Ref<DeferredPromise>&& promise)
{
    auto& vm = state.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto params = normalizeOrReject(state, algorithmIdentifier, Operations::Decapsulate, promise);
    RETURN_IF_EXCEPTION(scope, void());
    if (!params)
        return;

    auto importParams = normalizeOrReject(state, sharedKeyAlgorithm, Operations::ImportKey, promise);
    RETURN_IF_EXCEPTION(scope, void());
    if (!importParams)
        return;

    auto ciphertext = copyToVector(WTF::move(ciphertextBufferSource), promise);
    if (!ciphertext)
        return;

    auto keyUsagesBitmap = toCryptoKeyUsageBitmap(keyUsages);

    if (params->identifier != decapsulationKey.algorithmIdentifier()) {
        promise->reject(InvalidAccessError, "key algorithm mismatch"_s);
        return;
    }

    if (!decapsulationKey.allows(CryptoKeyUsageDecapsulateKey)) {
        promise->reject(InvalidAccessError, "decapsulationKey does not have decapsulateKey usage"_s);
        return;
    }

    auto algorithm = CryptoAlgorithmRegistry::singleton().create(params->identifier);
    auto importAlgorithm = CryptoAlgorithmRegistry::singleton().create(importParams->identifier);

    auto isolatedParams = isolateOrReject(WTF::move(*importParams), promise);
    if (!isolatedParams)
        return;

    auto index = promise.ptr();
    m_pendingPromises.add(index, WTF::move(promise));
    WeakPtr weakThis { *this };
    auto callback = [index, weakThis, importAlgorithm = WTF::move(importAlgorithm), importParams = WTF::move(*isolatedParams), extractable, keyUsagesBitmap](const Vector<uint8_t>& sharedKeyBytes) mutable {
        KeyData data = sharedKeyBytes;
        auto keyCallback = [index, weakThis](CryptoKey& sharedKey) mutable {
            if (auto promise = getPromise(index, weakThis)) {
                if ((sharedKey.type() == CryptoKeyType::Private || sharedKey.type() == CryptoKeyType::Secret) && !sharedKey.usagesBitmap()) {
                    rejectWithException(promise.releaseNonNull(), SyntaxError, "Usages cannot be empty when importing a secret key."_s);
                    return;
                }
                promise->resolve<IDLInterface<CryptoKey>>(sharedKey);
            }
        };
        auto keyExceptionCallback = [index, weakThis](ExceptionCode ec, const String& msg) mutable {
            if (auto promise = getPromise(index, weakThis))
                rejectWithException(promise.releaseNonNull(), ec, msg);
        };
        auto format = importParams.identifier == CryptoAlgorithmIdentifier::HKDF || importParams.identifier == CryptoAlgorithmIdentifier::PBKDF2
            ? SubtleCrypto::KeyFormat::Raw
            : SubtleCrypto::KeyFormat::RawSecret;
        importAlgorithm->importKey(format, WTF::move(data), importParams, extractable, keyUsagesBitmap, WTF::move(keyCallback), WTF::move(keyExceptionCallback));
    };
    auto exceptionCallback = [index, weakThis](ExceptionCode ec, const String& msg) mutable {
        if (auto promise = getPromise(index, weakThis))
            rejectWithException(promise.releaseNonNull(), ec, msg);
    };

    RELEASE_AND_RETURN(scope, algorithm->decapsulate(decapsulationKey, WTF::move(*ciphertext), WTF::move(callback), WTF::move(exceptionCallback)));
}

ExceptionOr<CryptoAlgorithmParameters> SubtleCrypto::normalizeImportParameters(JSC::JSGlobalObject& state, const AlgorithmIdentifier& algorithmIdentifier)
{
    return normalizeCryptoAlgorithmParameters(state, algorithmIdentifier, Operations::ImportKey);
}

// https://wicg.github.io/webcrypto-modern-algos/#SubtleCrypto-method-supports
// Mirrors Node's SubtleCrypto.supports: argument conversion failures throw,
// everything discovered while probing an operation reports false.
bool SubtleCrypto::supports(JSC::JSGlobalObject& state, const String& operation, AlgorithmIdentifier&& algorithmIdentifier, JSC::JSValue lengthOrAdditionalAlgorithm)
{
    auto& vm = state.vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    auto normalize = [&](const AlgorithmIdentifier& identifier, Operations op) -> std::optional<CryptoAlgorithmParameters> {
        auto result = normalizeCryptoAlgorithmParameters(state, identifier, op, Bytes::CheckSize);
        if (throwScope.exception()) [[unlikely]] {
            (void)throwScope.tryClearException();
            return std::nullopt;
        }
        if (result.hasException())
            return std::nullopt;
        return result.releaseReturnValue();
    };

    auto getKeyLengthFor = [&](const AlgorithmIdentifier& identifier) -> std::optional<std::optional<size_t>> {
        auto params = normalize(identifier, Operations::GetKeyLength);
        RETURN_IF_EXCEPTION(throwScope, std::nullopt);
        if (!params)
            return std::nullopt;
        auto algorithm = CryptoAlgorithmRegistry::singleton().create(params->identifier);
        auto length = algorithm->getKeyLength(*params);
        if (length.hasException())
            return std::nullopt;
        return length.releaseReturnValue();
    };

    auto checkDeriveBitsLength = [&](const CryptoAlgorithmParameters& params, std::optional<unsigned> length) -> bool {
        switch (params.identifier) {
        case CryptoAlgorithmIdentifier::HKDF:
        case CryptoAlgorithmIdentifier::PBKDF2:
            return length && *length && !(*length % 8);
        case CryptoAlgorithmIdentifier::X25519:
            return !length || *length <= 256;
        case CryptoAlgorithmIdentifier::ECDH: {
            auto* publicKey = dynamicDowncast<CryptoKeyEC>(std::get<CryptoAlgorithmEcdhKeyDeriveParams>(params.dictionary).publicKey.get());
            if (!publicKey)
                return false;
            auto namedCurve = publicKey->namedCurveString();
            unsigned maxLength = namedCurve == "P-256"_s ? 256 : namedCurve == "P-384"_s ? 384
                                                                                         : 528;
            return !length || *length <= maxLength;
        }
        default:
            return true;
        }
    };

    // check(op, alg, length) from Node's webcrypto.js.
    std::function<bool(const String&, const AlgorithmIdentifier&, std::optional<unsigned>)> check = [&](const String& op, const AlgorithmIdentifier& algorithm, std::optional<unsigned> length) -> bool {
        Operations operationKind;
        if (op == "encrypt"_s)
            operationKind = Operations::Encrypt;
        else if (op == "decrypt"_s)
            operationKind = Operations::Decrypt;
        else if (op == "sign"_s || op == "verify"_s)
            operationKind = op == "sign"_s ? Operations::Sign : Operations::Verify;
        else if (op == "digest"_s)
            operationKind = Operations::Digest;
        else if (op == "generateKey"_s)
            operationKind = Operations::GenerateKey;
        else if (op == "deriveBits"_s)
            operationKind = Operations::DeriveBits;
        else if (op == "importKey"_s)
            operationKind = Operations::ImportKey;
        else if (op == "wrapKey"_s)
            operationKind = Operations::WrapKey;
        else if (op == "unwrapKey"_s)
            operationKind = Operations::UnwrapKey;
        else if (op == "encapsulate"_s)
            operationKind = Operations::Encapsulate;
        else if (op == "decapsulate"_s)
            operationKind = Operations::Decapsulate;
        else if (op == "exportKey"_s) {
            auto params = normalize(algorithm, Operations::ImportKey);
            return params && isSupportedExportKey(params->identifier);
        } else
            return false;

        auto params = normalize(algorithm, operationKind);
        if (!params) {
            RETURN_IF_EXCEPTION(throwScope, false); // termination cannot be cleared
            if (op == "wrapKey"_s)
                return check("encrypt"_s, algorithm, std::nullopt);
            if (op == "unwrapKey"_s)
                return check("decrypt"_s, algorithm, std::nullopt);
            return false;
        }

        if (op == "deriveBits"_s)
            return checkDeriveBitsLength(*params, length);
        if (op == "generateKey"_s && params->identifier == CryptoAlgorithmIdentifier::HMAC)
            return getKeyLengthFor(algorithm).has_value();
        return true;
    };

    String op = operation;
    if (op != "decapsulateBits"_s && op != "decapsulateKey"_s && op != "decrypt"_s && op != "deriveBits"_s
        && op != "deriveKey"_s && op != "digest"_s && op != "encapsulateBits"_s && op != "encapsulateKey"_s
        && op != "encrypt"_s && op != "exportKey"_s && op != "generateKey"_s && op != "getPublicKey"_s
        && op != "importKey"_s && op != "sign"_s && op != "unwrapKey"_s && op != "verify"_s && op != "wrapKey"_s)
        return false;

    auto convertAdditionalAlgorithm = [&]() -> std::optional<AlgorithmIdentifier> {
        auto additional = convert<IDLUnion<IDLObject, IDLDOMString>>(state, lengthOrAdditionalAlgorithm);
        RETURN_IF_EXCEPTION(throwScope, std::nullopt);
        return WTF::move(additional);
    };

    std::optional<unsigned> length;
    if (op == "deriveKey"_s) {
        auto additional = convertAdditionalAlgorithm();
        if (!additional)
            return false;
        if (!check("importKey"_s, *additional, std::nullopt))
            return false;
        auto keyLength = getKeyLengthFor(*additional);
        if (!keyLength)
            return false;
        if (*keyLength)
            length = static_cast<unsigned>(**keyLength);
        op = "deriveBits"_s;
    } else if (op == "wrapKey"_s || op == "unwrapKey"_s) {
        auto additional = convertAdditionalAlgorithm();
        if (!additional)
            return false;
        if (!check(op == "wrapKey"_s ? "exportKey"_s : "importKey"_s, *additional, std::nullopt))
            return false;
    } else if (op == "deriveBits"_s) {
        if (!lengthOrAdditionalAlgorithm.isNull()) {
            auto converted = convert<IDLUnsignedLong>(state, lengthOrAdditionalAlgorithm);
            RETURN_IF_EXCEPTION(throwScope, false);
            length = converted;
        }
    } else if (op == "getPublicKey"_s) {
        auto params = normalize(algorithmIdentifier, Operations::ImportKey);
        if (!params)
            return false;
        switch (params->identifier) {
        case CryptoAlgorithmIdentifier::RSASSA_PKCS1_v1_5:
        case CryptoAlgorithmIdentifier::RSA_PSS:
        case CryptoAlgorithmIdentifier::RSA_OAEP:
        case CryptoAlgorithmIdentifier::ECDSA:
        case CryptoAlgorithmIdentifier::ECDH:
        case CryptoAlgorithmIdentifier::Ed25519:
        case CryptoAlgorithmIdentifier::X25519:
        case CryptoAlgorithmIdentifier::ML_DSA_44:
        case CryptoAlgorithmIdentifier::ML_DSA_65:
        case CryptoAlgorithmIdentifier::ML_DSA_87:
        case CryptoAlgorithmIdentifier::ML_KEM_768:
        case CryptoAlgorithmIdentifier::ML_KEM_1024:
            return true;
        default:
            return false;
        }
    } else if (op == "encapsulateKey"_s || op == "decapsulateKey"_s) {
        auto additional = convertAdditionalAlgorithm();
        if (!additional)
            return false;
        auto additionalParams = normalize(*additional, Operations::ImportKey);
        if (!additionalParams)
            return false;
        switch (additionalParams->identifier) {
        case CryptoAlgorithmIdentifier::AES_KW:
        case CryptoAlgorithmIdentifier::AES_GCM:
        case CryptoAlgorithmIdentifier::AES_CTR:
        case CryptoAlgorithmIdentifier::AES_CBC:
        case CryptoAlgorithmIdentifier::AES_CFB:
        case CryptoAlgorithmIdentifier::ChaCha20_Poly1305:
        case CryptoAlgorithmIdentifier::HKDF:
        case CryptoAlgorithmIdentifier::PBKDF2:
            break;
        case CryptoAlgorithmIdentifier::HMAC: {
            auto hmacLength = std::get<CryptoAlgorithmHmacKeyParams>(additionalParams->dictionary).length;
            if (!hmacLength || *hmacLength == 256)
                break;
            return false;
        }
        default:
            return false;
        }
    }

    if (op == "encapsulateBits"_s || op == "encapsulateKey"_s)
        op = "encapsulate"_s;
    else if (op == "decapsulateBits"_s || op == "decapsulateKey"_s)
        op = "decapsulate"_s;

    return check(op, algorithmIdentifier, length);
}

}

#endif
