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

#include "CryptoAlgorithm.h"
#include "CryptoAlgorithmRegistry.h"
#include "CryptoAlgorithmX25519Params.h"
#include "JSAesCbcCfbParams.h"
#include "JSAesCtrParams.h"
#include "JSAeadParams.h"
#include "JSAesGcmParams.h"
#include "JSAesKeyParams.h"
#include "JSCryptoAlgorithmParameters.h"
#include "JSCryptoKey.h"
#include "JSCryptoKeyPair.h"
#include "JSDOMPromiseDeferred.h"
#include "JSDOMWrapper.h"
#include "JSEcKeyParams.h"
#include "JSEcdhKeyDeriveParams.h"
#include "JSEcdsaParams.h"
#include "JSHkdfParams.h"
#include "JSHmacKeyParams.h"
#include "JSJsonWebKey.h"
#include "JSPbkdf2Params.h"
#include "JSMlDsaParams.h"
#include "JSX25519Params.h"
#include "AsymmetricKeyValue.h"
#include "CryptoAlgorithmMLDSA.h"
#include "CryptoKeyAKP.h"
#include "CryptoKeyEC.h"
#include "CryptoKeyRSA.h"
#include "ErrorCode.h"
#include "JSDOMExceptionHandling.h"
#include "node/crypto/CryptoUtil.h"
#include <openssl/bytestring.h>
#include <openssl/err.h>
#include <openssl/evp.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <functional>
#include "JSRsaHashedImportParams.h"
#include "JSRsaHashedKeyGenParams.h"
#include "JSRsaKeyGenParams.h"
#include "JSRsaOaepParams.h"
#include "JSRsaPssParams.h"
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

static ExceptionOr<std::unique_ptr<CryptoAlgorithmParameters>> normalizeCryptoAlgorithmParameters(JSGlobalObject&, WebCore::SubtleCrypto::AlgorithmIdentifier, Operations);

static ExceptionOr<CryptoAlgorithmIdentifier> toHashIdentifier(JSGlobalObject& state, SubtleCrypto::AlgorithmIdentifier algorithmIdentifier)
{
    auto digestParams = normalizeCryptoAlgorithmParameters(state, algorithmIdentifier, Operations::Digest);
    if (digestParams.hasException())
        return digestParams.releaseException();
    return digestParams.returnValue()->identifier;
}

static bool isRSAESPKCSWebCryptoDeprecated(JSGlobalObject& state)
{
    return true;
    // auto& globalObject = *uncheckedDowncast<JSDOMGlobalObject>(&state);
    // auto* context = globalObject.scriptExecutionContext();
    // return context && context->settingsValues().deprecateRSAESPKCSWebCryptoEnabled;
}

static bool isSafeCurvesEnabled(JSGlobalObject& state)
{
    return true;
    // auto& globalObject = *uncheckedDowncast<JSDOMGlobalObject>(&state);
    // auto* context = globalObject.scriptExecutionContext();
    // return context && context->settingsValues().webCryptoSafeCurvesEnabled;
}

// The lazy *Vector() accessors on the parameter classes copy these dictionary members into
// Vector<uint8_t> with no size check, and exceeding the Vector capacity cap CRASH()es in
// allocateBuffer. Validate them while normalizing so an oversized member rejects instead.
static bool isAcceptableVectorSource(const BufferSource& data)
{
    return WTF::isValidCapacityForVector<uint8_t>(data.length());
}

static bool isAcceptableVectorSource(const std::optional<BufferSource::VariantType>& data)
{
    if (!data)
        return true;
    auto length = std::visit([](auto& buffer) -> size_t { return buffer ? buffer->byteLength() : 0; }, *data);
    return WTF::isValidCapacityForVector<uint8_t>(length);
}

// RsaKeyGenParams.publicExponent is a WebIDL BigInteger (a Uint8Array, not a
// BufferSource), but publicExponentVector() does the same unguarded append.
static bool isAcceptableVectorSource(const RefPtr<Uint8Array>& data)
{
    return !data || WTF::isValidCapacityForVector<uint8_t>(data->byteLength());
}

static ExceptionOr<std::unique_ptr<CryptoAlgorithmParameters>> normalizeCryptoAlgorithmParameters(JSGlobalObject& state, SubtleCrypto::AlgorithmIdentifier algorithmIdentifier, Operations operation)
{
    VM& vm = state.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (std::holds_alternative<String>(algorithmIdentifier)) {
        auto newParams = Strong<JSObject>(vm, constructEmptyObject(&state));
        newParams->putDirect(vm, vm.propertyNames->name, jsString(vm, std::get<String>(algorithmIdentifier)));

        RELEASE_AND_RETURN(scope, normalizeCryptoAlgorithmParameters(state, newParams, operation));
    }

    auto& value = std::get<JSC::Strong<JSC::JSObject>>(algorithmIdentifier);

    auto params = convertDictionary<CryptoAlgorithmParameters>(state, value.get());
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });

    auto identifier = CryptoAlgorithmRegistry::singleton().identifier(params.name);
    if (!identifier) [[unlikely]]
        return Exception { NotSupportedError, "Unrecognized algorithm name"_s };

    if (*identifier == CryptoAlgorithmIdentifier::Ed25519 && !isSafeCurvesEnabled(state))
        return Exception { NotSupportedError, "Unrecognized algorithm name"_s };

    std::unique_ptr<CryptoAlgorithmParameters> result;
    switch (operation) {
    case Operations::Encrypt:
    case Operations::Decrypt:
        switch (*identifier) {
        case CryptoAlgorithmIdentifier::RSAES_PKCS1_v1_5:
            if (isRSAESPKCSWebCryptoDeprecated(state))
                return Exception { NotSupportedError, "RSAES-PKCS1-v1_5 support is deprecated"_s };
            result = makeUnique<CryptoAlgorithmParameters>(params);
            break;
        case CryptoAlgorithmIdentifier::RSA_OAEP: {
            auto params = convertDictionary<CryptoAlgorithmRsaOaepParams>(state, value.get());
            RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
            if (!isAcceptableVectorSource(params.label))
                return Exception { OperationError, "Input data is too large"_s };
            result = makeUnique<CryptoAlgorithmRsaOaepParams>(params);
            break;
        }
        case CryptoAlgorithmIdentifier::AES_CBC:
        case CryptoAlgorithmIdentifier::AES_CFB: {
            auto params = convertDictionary<CryptoAlgorithmAesCbcCfbParams>(state, value.get());
            RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
            if (!isAcceptableVectorSource(params.iv))
                return Exception { OperationError, "Input data is too large"_s };
            result = makeUnique<CryptoAlgorithmAesCbcCfbParams>(params);
            break;
        }
        case CryptoAlgorithmIdentifier::AES_CTR: {
            auto params = convertDictionary<CryptoAlgorithmAesCtrParams>(state, value.get());
            RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
            if (!isAcceptableVectorSource(params.counter))
                return Exception { OperationError, "Input data is too large"_s };
            result = makeUnique<CryptoAlgorithmAesCtrParams>(params);
            break;
        }
        case CryptoAlgorithmIdentifier::AES_GCM: {
            auto params = convertDictionary<CryptoAlgorithmAesGcmParams>(state, value.get());
            RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
            if (!isAcceptableVectorSource(params.iv) || !isAcceptableVectorSource(params.additionalData))
                return Exception { OperationError, "Input data is too large"_s };
            result = makeUnique<CryptoAlgorithmAesGcmParams>(params);
            break;
        }
        case CryptoAlgorithmIdentifier::ChaCha20_Poly1305: {
            auto params = convertDictionary<CryptoAlgorithmAeadParams>(state, value.get());
            RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
            if (!isAcceptableVectorSource(params.iv) || !isAcceptableVectorSource(params.additionalData))
                return Exception { OperationError, "Input data is too large"_s };
            result = makeUnique<CryptoAlgorithmAeadParams>(params);
            break;
        }
        default:
            return Exception { NotSupportedError, "Unrecognized algorithm name"_s };
        }
        break;
    case Operations::Sign:
    case Operations::Verify:
        switch (*identifier) {
        case CryptoAlgorithmIdentifier::RSASSA_PKCS1_v1_5:
        case CryptoAlgorithmIdentifier::HMAC:
        case CryptoAlgorithmIdentifier::Ed25519:
            result = makeUnique<CryptoAlgorithmParameters>(params);
            break;
        case CryptoAlgorithmIdentifier::ECDSA: {
            auto params = convertDictionary<CryptoAlgorithmEcdsaParams>(state, value.get());
            RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
            auto hashIdentifier = toHashIdentifier(state, params.hash);
            RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
            if (hashIdentifier.hasException()) return hashIdentifier.releaseException();
            params.hashIdentifier = hashIdentifier.releaseReturnValue();
            result = makeUnique<CryptoAlgorithmEcdsaParams>(params);
            break;
        }
        case CryptoAlgorithmIdentifier::RSA_PSS: {
            auto params = convertDictionary<CryptoAlgorithmRsaPssParams>(state, value.get());
            RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
            result = makeUnique<CryptoAlgorithmRsaPssParams>(params);
            break;
        }
        case CryptoAlgorithmIdentifier::ML_DSA_44:
        case CryptoAlgorithmIdentifier::ML_DSA_65:
        case CryptoAlgorithmIdentifier::ML_DSA_87: {
            auto params = convertDictionary<CryptoAlgorithmMlDsaParams>(state, value.get());
            RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
            if (!isAcceptableVectorSource(params.context))
                return Exception { OperationError, "Input data is too large"_s };
            result = makeUnique<CryptoAlgorithmMlDsaParams>(params);
            break;
        }
        default:
            return Exception { NotSupportedError, "Unrecognized algorithm name"_s };
        }
        break;
    case Operations::Digest:
        switch (*identifier) {
        case CryptoAlgorithmIdentifier::SHA_1:
        case CryptoAlgorithmIdentifier::SHA_224:
        case CryptoAlgorithmIdentifier::SHA_256:
        case CryptoAlgorithmIdentifier::SHA_384:
        case CryptoAlgorithmIdentifier::SHA_512:
        case CryptoAlgorithmIdentifier::SHA3_256:
        case CryptoAlgorithmIdentifier::SHA3_384:
        case CryptoAlgorithmIdentifier::SHA3_512:
            result = makeUnique<CryptoAlgorithmParameters>(params);
            break;
        default:
            return Exception { NotSupportedError, "Unrecognized algorithm name"_s };
        }
        break;
    case Operations::GenerateKey:
        switch (*identifier) {
        case CryptoAlgorithmIdentifier::RSAES_PKCS1_v1_5: {
            if (isRSAESPKCSWebCryptoDeprecated(state))
                return Exception { NotSupportedError, "RSAES-PKCS1-v1_5 support is deprecated"_s };
            auto params = convertDictionary<CryptoAlgorithmRsaKeyGenParams>(state, value.get());
            RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
            if (!isAcceptableVectorSource(params.publicExponent))
                return Exception { OperationError, "Input data is too large"_s };
            result = makeUnique<CryptoAlgorithmRsaKeyGenParams>(params);
            break;
        }
        case CryptoAlgorithmIdentifier::RSASSA_PKCS1_v1_5:
        case CryptoAlgorithmIdentifier::RSA_PSS:
        case CryptoAlgorithmIdentifier::RSA_OAEP: {
            auto params = convertDictionary<CryptoAlgorithmRsaHashedKeyGenParams>(state, value.get());
            RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
            if (!isAcceptableVectorSource(params.publicExponent))
                return Exception { OperationError, "Input data is too large"_s };
            auto hashIdentifier = toHashIdentifier(state, params.hash);
            RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
            if (hashIdentifier.hasException()) return hashIdentifier.releaseException();
            params.hashIdentifier = hashIdentifier.releaseReturnValue();
            result = makeUnique<CryptoAlgorithmRsaHashedKeyGenParams>(params);
            break;
        }
        case CryptoAlgorithmIdentifier::AES_CTR:
        case CryptoAlgorithmIdentifier::AES_CBC:
        case CryptoAlgorithmIdentifier::AES_GCM:
        case CryptoAlgorithmIdentifier::AES_CFB:
        case CryptoAlgorithmIdentifier::AES_KW: {
            auto params = convertDictionary<CryptoAlgorithmAesKeyParams>(state, value.get());
            RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
            result = makeUnique<CryptoAlgorithmAesKeyParams>(params);
            break;
        }
        case CryptoAlgorithmIdentifier::HMAC: {
            auto params = convertDictionary<CryptoAlgorithmHmacKeyParams>(state, value.get());
            RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
            auto hashIdentifier = toHashIdentifier(state, params.hash);
            RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
            if (hashIdentifier.hasException()) return hashIdentifier.releaseException();
            params.hashIdentifier = hashIdentifier.releaseReturnValue();
            result = makeUnique<CryptoAlgorithmHmacKeyParams>(params);
            break;
        }
        case CryptoAlgorithmIdentifier::ECDSA:
        case CryptoAlgorithmIdentifier::ECDH: {
            auto params = convertDictionary<CryptoAlgorithmEcKeyParams>(state, value.get());
            RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
            result = makeUnique<CryptoAlgorithmEcKeyParams>(params);
            break;
        }
        case CryptoAlgorithmIdentifier::Ed25519:
            result = makeUnique<CryptoAlgorithmParameters>(params);
            break;
        case CryptoAlgorithmIdentifier::X25519:
        case CryptoAlgorithmIdentifier::ChaCha20_Poly1305:
        case CryptoAlgorithmIdentifier::ML_DSA_44:
        case CryptoAlgorithmIdentifier::ML_DSA_65:
        case CryptoAlgorithmIdentifier::ML_DSA_87:
        case CryptoAlgorithmIdentifier::ML_KEM_768:
        case CryptoAlgorithmIdentifier::ML_KEM_1024:
            result = makeUnique<CryptoAlgorithmParameters>(params);
            break;
        default:
            return Exception { NotSupportedError, "Unrecognized algorithm name"_s };
        }
        break;
    case Operations::DeriveBits:
        switch (*identifier) {
        case CryptoAlgorithmIdentifier::ECDH: {
            // Remove this hack once https://bugs.webkit.org/show_bug.cgi?id=169333 is fixed.
            JSValue nameValue = value.get()->get(&state, vm.propertyNames->name);
            RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
            JSValue publicValue = value.get()->get(&state, Identifier::fromString(vm, "public"_s));
            RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
            JSObject* newValue = constructEmptyObject(&state);
            RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
            newValue->putDirect(vm, vm.propertyNames->name, nameValue);
            newValue->putDirect(vm, Identifier::fromString(vm, "publicKey"_s), publicValue);

            auto params = convertDictionary<CryptoAlgorithmEcdhKeyDeriveParams>(state, newValue);
            RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
            result = makeUnique<CryptoAlgorithmEcdhKeyDeriveParams>(params);
            break;
        }
        case CryptoAlgorithmIdentifier::X25519: {
            // Remove this hack once https://bugs.webkit.org/show_bug.cgi?id=169333 is fixed.
            JSValue nameValue = value.get()->get(&state, vm.propertyNames->name);
            RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
            JSValue publicValue = value.get()->get(&state, vm.propertyNames->publicKeyword);
            RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
            JSObject* newValue = constructEmptyObject(&state);
            RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
            newValue->putDirect(vm, vm.propertyNames->name, nameValue);
            newValue->putDirect(vm, Identifier::fromString(vm, "publicKey"_s), publicValue);

            auto params = convertDictionary<CryptoAlgorithmX25519Params>(state, newValue);
            RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
            result = makeUnique<CryptoAlgorithmX25519Params>(params);
            break;
        }
        case CryptoAlgorithmIdentifier::HKDF: {
            auto params = convertDictionary<CryptoAlgorithmHkdfParams>(state, value.get());
            RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
            if (!isAcceptableVectorSource(params.salt) || !isAcceptableVectorSource(params.info))
                return Exception { OperationError, "Input data is too large"_s };
            auto hashIdentifier = toHashIdentifier(state, params.hash);
            RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
            if (hashIdentifier.hasException()) return hashIdentifier.releaseException();
            params.hashIdentifier = hashIdentifier.releaseReturnValue();
            result = makeUnique<CryptoAlgorithmHkdfParams>(params);
            break;
        }
        case CryptoAlgorithmIdentifier::PBKDF2: {
            auto params = convertDictionary<CryptoAlgorithmPbkdf2Params>(state, value.get());
            RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
            if (!isAcceptableVectorSource(params.salt))
                return Exception { OperationError, "Input data is too large"_s };
            auto hashIdentifier = toHashIdentifier(state, params.hash);
            RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
            if (hashIdentifier.hasException()) return hashIdentifier.releaseException();
            params.hashIdentifier = hashIdentifier.releaseReturnValue();
            result = makeUnique<CryptoAlgorithmPbkdf2Params>(params);
            break;
        }
        default:
            return Exception { NotSupportedError, "Unrecognized algorithm name"_s };
        }
        break;
    case Operations::ImportKey:
        switch (*identifier) {
        case CryptoAlgorithmIdentifier::RSAES_PKCS1_v1_5:
            if (isRSAESPKCSWebCryptoDeprecated(state))
                return Exception { NotSupportedError, "RSAES-PKCS1-v1_5 support is deprecated"_s };
            result = makeUnique<CryptoAlgorithmParameters>(params);
            break;
        case CryptoAlgorithmIdentifier::RSASSA_PKCS1_v1_5:
        case CryptoAlgorithmIdentifier::RSA_PSS:
        case CryptoAlgorithmIdentifier::RSA_OAEP: {
            auto params = convertDictionary<CryptoAlgorithmRsaHashedImportParams>(state, value.get());
            RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
            auto hashIdentifier = toHashIdentifier(state, params.hash);
            RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
            if (hashIdentifier.hasException()) return hashIdentifier.releaseException();
            params.hashIdentifier = hashIdentifier.releaseReturnValue();
            result = makeUnique<CryptoAlgorithmRsaHashedImportParams>(params);
            break;
        }
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
            result = makeUnique<CryptoAlgorithmParameters>(params);
            break;
        case CryptoAlgorithmIdentifier::HMAC: {
            auto params = convertDictionary<CryptoAlgorithmHmacKeyParams>(state, value.get());
            RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
            auto hashIdentifier = toHashIdentifier(state, params.hash);
            RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
            if (hashIdentifier.hasException()) return hashIdentifier.releaseException();
            params.hashIdentifier = hashIdentifier.releaseReturnValue();
            result = makeUnique<CryptoAlgorithmHmacKeyParams>(params);
            break;
        }
        case CryptoAlgorithmIdentifier::ECDSA:
        case CryptoAlgorithmIdentifier::ECDH: {
            auto params = convertDictionary<CryptoAlgorithmEcKeyParams>(state, value.get());
            RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
            result = makeUnique<CryptoAlgorithmEcKeyParams>(params);
            break;
        }
        case CryptoAlgorithmIdentifier::HKDF:
        case CryptoAlgorithmIdentifier::PBKDF2:
            result = makeUnique<CryptoAlgorithmParameters>(params);
            break;
        case CryptoAlgorithmIdentifier::SHA_1:
        case CryptoAlgorithmIdentifier::SHA_224:
        case CryptoAlgorithmIdentifier::SHA_256:
        case CryptoAlgorithmIdentifier::SHA_384:
        case CryptoAlgorithmIdentifier::SHA_512:
        case CryptoAlgorithmIdentifier::SHA3_256:
        case CryptoAlgorithmIdentifier::SHA3_384:
        case CryptoAlgorithmIdentifier::SHA3_512:
            return Exception { NotSupportedError, "Unrecognized algorithm name"_s };
        case CryptoAlgorithmIdentifier::None:
            return Exception { NotSupportedError, "Unrecognized algorithm name"_s };
        }

        break;
    case Operations::WrapKey:
    case Operations::UnwrapKey:
        switch (*identifier) {
        case CryptoAlgorithmIdentifier::AES_KW:
            result = makeUnique<CryptoAlgorithmParameters>(params);
            break;
        default:
            return Exception { NotSupportedError, "Unrecognized algorithm name"_s };
        }
        break;
    case Operations::Encapsulate:
    case Operations::Decapsulate:
        switch (*identifier) {
        case CryptoAlgorithmIdentifier::ML_KEM_768:
        case CryptoAlgorithmIdentifier::ML_KEM_1024:
            result = makeUnique<CryptoAlgorithmParameters>(params);
            break;
        default:
            return Exception { NotSupportedError, "Unrecognized algorithm name"_s };
        }
        break;
    case Operations::GetKeyLength:
        switch (*identifier) {
        case CryptoAlgorithmIdentifier::AES_CTR:
        case CryptoAlgorithmIdentifier::AES_CBC:
        case CryptoAlgorithmIdentifier::AES_GCM:
        case CryptoAlgorithmIdentifier::AES_CFB:
        case CryptoAlgorithmIdentifier::AES_KW: {
            auto params = convertDictionary<CryptoAlgorithmAesKeyParams>(state, value.get());
            RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
            result = makeUnique<CryptoAlgorithmAesKeyParams>(params);
            break;
        }
        case CryptoAlgorithmIdentifier::HMAC: {
            auto params = convertDictionary<CryptoAlgorithmHmacKeyParams>(state, value.get());
            RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
            auto hashIdentifier = toHashIdentifier(state, params.hash);
            RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
            if (hashIdentifier.hasException()) return hashIdentifier.releaseException();
            params.hashIdentifier = hashIdentifier.releaseReturnValue();
            result = makeUnique<CryptoAlgorithmHmacKeyParams>(params);
            break;
        }
        case CryptoAlgorithmIdentifier::HKDF:
        case CryptoAlgorithmIdentifier::PBKDF2:
        case CryptoAlgorithmIdentifier::ChaCha20_Poly1305:
            result = makeUnique<CryptoAlgorithmParameters>(params);
            break;
        default:
            return Exception { NotSupportedError, "Unrecognized algorithm name"_s };
        }
        break;
    }

    result->identifier = *identifier;
    return result;
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

static CryptoKeyUsageBitmap toCryptoKeyUsageBitmap(const Vector<CryptoKeyUsage>& usages)
{
    CryptoKeyUsageBitmap result = 0;
    // Maybe we shouldn't silently bypass duplicated usages?
    for (auto usage : usages)
        result |= toCryptoKeyUsageBitmap(usage);

    return result;
}

// Maybe we want more specific error messages?
static void rejectWithException(Ref<DeferredPromise>&& passedPromise, ExceptionCode ec, const String& msg)
{
    if (!msg.isEmpty()) {
        passedPromise->reject(ec, msg);
        return;
    }
    switch (ec) {
    case NotSupportedError:
        passedPromise->reject(ec, "The algorithm is not supported"_s);
        return;
    case SyntaxError:
        passedPromise->reject(ec, "A required parameter was missing or out-of-range"_s);
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
    webKey.usages = webKey.key_ops ? toCryptoKeyUsageBitmap(webKey.key_ops.value()) : 0;
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
                    promise->reject(Exception { TypeError });
                    return std::nullopt;
                },
                [&promise](auto& bufferSource) -> std::optional<KeyData> {
                    if (!WTF::isValidCapacityForVector<uint8_t>(bufferSource->byteLength())) {
                        promise->reject(OperationError, "Input data is too large"_s);
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

// WTF::Vector capacity is capped below the maximum legal ArrayBuffer size, and exceeding the cap
// CRASH()es inside Vector::allocateBuffer. Validate the length before copying and reject the
// promise instead, mirroring the toKeyData contract: nullopt means the promise was already rejected.
static std::optional<Vector<uint8_t>> copyToVector(BufferSource&& data, Ref<DeferredPromise>& promise)
{
    if (!WTF::isValidCapacityForVector<uint8_t>(data.length())) {
        promise->reject(OperationError, "Input data is too large"_s);
        return std::nullopt;
    }
    return Vector<uint8_t> { std::span { data.data(), data.length() } };
}

static bool isSupportedExportKey(JSGlobalObject& state, CryptoAlgorithmIdentifier identifier)
{
    switch (identifier) {
    case CryptoAlgorithmIdentifier::RSAES_PKCS1_v1_5:
        return !isRSAESPKCSWebCryptoDeprecated(state);
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

static bool rejectIfMlDsaContextTooLong(const CryptoAlgorithmParameters& params, Ref<DeferredPromise>&& promise);

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

// Node rejects oversized ML-DSA context strings with an OperationError whose
// cause is an ERR_OUT_OF_RANGE error; returns true when it rejected.
static bool rejectIfMlDsaContextTooLong(const CryptoAlgorithmParameters& params, Ref<DeferredPromise>&& promise)
{
    auto* mlDsaParams = dynamicDowncast<CryptoAlgorithmMlDsaParams>(params);
    if (!mlDsaParams || mlDsaParams->contextVector().size() <= CryptoAlgorithmMLDSA::s_maxContextLength)
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

static std::unique_ptr<CryptoAlgorithmParameters> crossThreadCopyImportParams(const CryptoAlgorithmParameters& importParams)
{
    switch (importParams.parametersClass()) {
    case CryptoAlgorithmParameters::Class::None: {
        auto result = makeUnique<CryptoAlgorithmParameters>();
        result->identifier = importParams.identifier;
        return result;
    }
    case CryptoAlgorithmParameters::Class::EcKeyParams:
        return makeUnique<CryptoAlgorithmEcKeyParams>(crossThreadCopy(downcast<CryptoAlgorithmEcKeyParams>(importParams)));
    case CryptoAlgorithmParameters::Class::HmacKeyParams:
        return makeUnique<CryptoAlgorithmHmacKeyParams>(crossThreadCopy(downcast<CryptoAlgorithmHmacKeyParams>(importParams)));
    case CryptoAlgorithmParameters::Class::RsaHashedImportParams:
        return makeUnique<CryptoAlgorithmRsaHashedImportParams>(crossThreadCopy(downcast<CryptoAlgorithmRsaHashedImportParams>(importParams)));
    default:
        ASSERT_NOT_REACHED();
        return nullptr;
    }
}

void SubtleCrypto::addAuthenticatedEncryptionWarningIfNecessary(CryptoAlgorithmIdentifier algorithmIdentifier)
{
    // if (algorithmIdentifier == CryptoAlgorithmIdentifier::AES_CBC || algorithmIdentifier == CryptoAlgorithmIdentifier::AES_CTR) {
    //     if (!scriptExecutionContext()->hasLoggedAuthenticatedEncryptionWarning()) {
    //         scriptExecutionContext()->addConsoleMessage(MessageSource::Security, MessageLevel::Warning, "AES-CBC and AES-CTR do not provide authentication by default, and implementing it manually can result in minor, but serious mistakes. We recommended using authenticated encryption like AES-GCM to protect against chosen-ciphertext attacks."_s);
    //         scriptExecutionContext()->setHasLoggedAuthenticatedEncryptionWarning(true);
    //     }
    // }
}

// MARK: - Exposed functions.

void SubtleCrypto::encrypt(JSC::JSGlobalObject& state, AlgorithmIdentifier&& algorithmIdentifier, CryptoKey& key, BufferSource&& dataBufferSource, Ref<DeferredPromise>&& promise)
{
    auto& vm = state.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    addAuthenticatedEncryptionWarningIfNecessary(key.algorithmIdentifier());

    auto paramsOrException = normalizeCryptoAlgorithmParameters(state, WTF::move(algorithmIdentifier), Operations::Encrypt);
    RETURN_IF_EXCEPTION(scope, void());
    if (paramsOrException.hasException()) {
        promise->reject(paramsOrException.releaseException());
        return;
    }
    auto params = paramsOrException.releaseReturnValue();

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

    addAuthenticatedEncryptionWarningIfNecessary(key.algorithmIdentifier());

    auto paramsOrException = normalizeCryptoAlgorithmParameters(state, WTF::move(algorithmIdentifier), Operations::Decrypt);
    RETURN_IF_EXCEPTION(scope, void());
    if (paramsOrException.hasException()) {
        promise->reject(paramsOrException.releaseException());
        return;
    }
    auto params = paramsOrException.releaseReturnValue();

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

    auto paramsOrException = normalizeCryptoAlgorithmParameters(state, WTF::move(algorithmIdentifier), Operations::Sign);
    RETURN_IF_EXCEPTION(scope, void());
    if (paramsOrException.hasException()) {
        promise->reject(paramsOrException.releaseException());
        return;
    }
    auto params = paramsOrException.releaseReturnValue();

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

    auto paramsOrException = normalizeCryptoAlgorithmParameters(state, WTF::move(algorithmIdentifier), Operations::Verify);
    RETURN_IF_EXCEPTION(scope, void());
    if (paramsOrException.hasException()) {
        promise->reject(paramsOrException.releaseException());
        return;
    }
    auto params = paramsOrException.releaseReturnValue();

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
    auto paramsOrException = normalizeCryptoAlgorithmParameters(state, WTF::move(algorithmIdentifier), Operations::Digest);
    RETURN_IF_EXCEPTION(scope, void());
    if (paramsOrException.hasException()) {
        promise->reject(paramsOrException.releaseException());
        return;
    }
    auto params = paramsOrException.releaseReturnValue();

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
    auto paramsOrException = normalizeCryptoAlgorithmParameters(state, WTF::move(algorithmIdentifier), Operations::GenerateKey);
    RETURN_IF_EXCEPTION(scope, void());
    if (paramsOrException.hasException()) {
        promise->reject(paramsOrException.releaseException());
        return;
    }
    auto params = paramsOrException.releaseReturnValue();

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

    // The 26 January 2017 version of the specification suggests we should perform the following task asynchronously
    // regardless what kind of keys it produces: https://www.w3.org/TR/WebCryptoAPI/#SubtleCrypto-method-generateKey
    // That's simply not efficient for AES, HMAC and EC keys. Therefore, we perform it as an async task only for RSA keys.
    RELEASE_AND_RETURN(scope, algorithm->generateKey(*params, extractable, keyUsagesBitmap, WTF::move(callback), WTF::move(exceptionCallback), *scriptExecutionContext()));
}

void SubtleCrypto::deriveKey(JSC::JSGlobalObject& state, AlgorithmIdentifier&& algorithmIdentifier, CryptoKey& baseKey, AlgorithmIdentifier&& derivedKeyType, bool extractable, Vector<CryptoKeyUsage>&& keyUsages, Ref<DeferredPromise>&& promise)
{
    auto& vm = state.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto paramsOrException = normalizeCryptoAlgorithmParameters(state, WTF::move(algorithmIdentifier), Operations::DeriveBits);
    RETURN_IF_EXCEPTION(scope, void());
    if (paramsOrException.hasException()) {
        promise->reject(paramsOrException.releaseException());
        return;
    }
    auto params = paramsOrException.releaseReturnValue();

    auto importParamsOrException = normalizeCryptoAlgorithmParameters(state, derivedKeyType, Operations::ImportKey);
    RETURN_IF_EXCEPTION(scope, void());
    if (importParamsOrException.hasException()) {
        promise->reject(importParamsOrException.releaseException());
        return;
    }
    auto importParams = importParamsOrException.releaseReturnValue();

    auto getLengthParamsOrException = normalizeCryptoAlgorithmParameters(state, derivedKeyType, Operations::GetKeyLength);
    RETURN_IF_EXCEPTION(scope, void());
    if (getLengthParamsOrException.hasException()) {
        promise->reject(getLengthParamsOrException.releaseException());
        return;
    }
    auto getLengthParams = getLengthParamsOrException.releaseReturnValue();

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

    auto index = promise.ptr();
    m_pendingPromises.add(index, WTF::move(promise));
    WeakPtr weakThis { *this };
    auto callback = [index, weakThis, importAlgorithm = WTF::move(importAlgorithm), importParams = crossThreadCopyImportParams(*importParams), extractable, keyUsagesBitmap](const Vector<uint8_t>& derivedKey) mutable {
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

        importAlgorithm->importKey(SubtleCrypto::KeyFormat::Raw, WTF::move(data), *importParams, extractable, keyUsagesBitmap, WTF::move(callback), WTF::move(exceptionCallback));
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
    auto paramsOrException = normalizeCryptoAlgorithmParameters(state, WTF::move(algorithmIdentifier), Operations::DeriveBits);
    RETURN_IF_EXCEPTION(scope, void());
    if (paramsOrException.hasException()) {
        promise->reject(paramsOrException.releaseException());
        return;
    }
    auto params = paramsOrException.releaseReturnValue();

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

void SubtleCrypto::importKey(JSC::JSGlobalObject& state, KeyFormat format, KeyDataVariant&& keyDataVariant, AlgorithmIdentifier&& algorithmIdentifier, bool extractable, Vector<CryptoKeyUsage>&& keyUsages, Ref<DeferredPromise>&& promise)
{
    auto& vm = state.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto paramsOrException = normalizeCryptoAlgorithmParameters(state, WTF::move(algorithmIdentifier), Operations::ImportKey);
    RETURN_IF_EXCEPTION(scope, void());
    if (paramsOrException.hasException()) {
        promise->reject(paramsOrException.releaseException());
        return;
    }
    auto params = paramsOrException.releaseReturnValue();

    auto keyDataOrNull = toKeyData(format, WTF::move(keyDataVariant), promise);
    if (!keyDataOrNull) {
        // When toKeyData, it means the promise has been rejected, and we should return.
        return;
    }

    auto keyData = *keyDataOrNull;
    auto keyUsagesBitmap = toCryptoKeyUsageBitmap(keyUsages);

    // Node's aliasKeyFormat maps raw-secret and raw-public to raw for these
    // algorithms and rejects the seed/public formats everywhere else; only the
    // ML algorithms consume them directly (lib/internal/crypto/webcrypto.js).
    switch (params->identifier) {
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
    if (!isAkpAlgorithm(params->identifier) && (format == KeyFormat::RawPublic || format == KeyFormat::RawSeed)) {
        bool aliasesRawPublic = false;
        switch (params->identifier) {
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
            promise->reject(NotSupportedError, makeString("Unable to import "_s, CryptoAlgorithmRegistry::singleton().name(params->identifier), " using "_s, format == KeyFormat::RawPublic ? "raw-public"_s : "raw-seed"_s, " format"_s));
            return;
        }
    }

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
        if (auto promise = getPromise(index, weakThis)) {
            // The ML import paths leave the BoringSSL parse failure in the error
            // queue; attach it as the DOMException's cause like Node does.
            if (ec == DataError && isAkpAlgorithm(identifier)) {
                if (uint32_t opensslError = ERR_get_error()) {
                    ERR_clear_error();
                    rejectWithCause(promise.releaseNonNull(), ec, msg, [opensslError](JSDOMGlobalObject& globalObject) -> JSC::JSValue {
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
            rejectWithException(promise.releaseNonNull(), ec, msg);
        }
    };

    // The 11 December 2014 version of the specification suggests we should perform the following task asynchronously:
    // https://www.w3.org/TR/WebCryptoAPI/#SubtleCrypto-method-importKey
    // It is not beneficial for less time consuming operations. Therefore, we perform it synchronously.
    RELEASE_AND_RETURN(scope, algorithm->importKey(format, WTF::move(keyData), *params, extractable, keyUsagesBitmap, WTF::move(callback), WTF::move(exceptionCallback)));
}

void SubtleCrypto::exportKey(KeyFormat format, CryptoKey& key, Ref<DeferredPromise>&& promise)
{
    if (!isSupportedExportKey(*promise->globalObject(), key.algorithmIdentifier())) {
        promise->reject(Exception { NotSupportedError });
        return;
    }

    if (!key.extractable()) {
        promise->reject(InvalidAccessError, "key is not extractable"_s);
        return;
    }

    // Node aliases raw-public to raw for EC and OKP public keys and rejects the
    // seed/public formats everywhere else; only the ML algorithms consume them.
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
            promise->reject(NotSupportedError, makeString("Unable to export "_s, CryptoAlgorithmRegistry::singleton().name(key.algorithmIdentifier()), ' ', type, " key using "_s, format == KeyFormat::RawPublic ? "raw-public"_s : "raw-seed"_s, " format"_s));
            return;
        }
    }

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

    bool isEncryption = false;

    auto wrapParamsOrException = normalizeCryptoAlgorithmParameters(state, wrapAlgorithmIdentifier, Operations::WrapKey);
    RETURN_IF_EXCEPTION(scope, void());
    if (wrapParamsOrException.hasException()) {
        ASSERT(wrapParamsOrException.exception().code() != ExistingExceptionError);

        wrapParamsOrException = normalizeCryptoAlgorithmParameters(state, wrapAlgorithmIdentifier, Operations::Encrypt);
        RETURN_IF_EXCEPTION(scope, void());
        if (wrapParamsOrException.hasException()) {
            promise->reject(wrapParamsOrException.releaseException());
            return;
        }

        isEncryption = true;
    }
    auto wrapParams = wrapParamsOrException.releaseReturnValue();

    if (wrapParams->identifier != wrappingKey.algorithmIdentifier()) {
        promise->reject(InvalidAccessError, "Key algorithm mismatch"_s);
        return;
    }

    if (!wrappingKey.allows(CryptoKeyUsageWrapKey)) {
        promise->reject(InvalidAccessError, "Unable to use this key to wrapKey"_s);
        return;
    }

    if (!isSupportedExportKey(state, key.algorithmIdentifier())) {
        promise->reject(Exception { NotSupportedError });
        return;
    }

    if (!key.extractable()) {
        promise->reject(InvalidAccessError, "key is not extractable"_s);
        return;
    }

    auto exportAlgorithm = CryptoAlgorithmRegistry::singleton().create(key.algorithmIdentifier());
    auto wrapAlgorithm = CryptoAlgorithmRegistry::singleton().create(wrappingKey.algorithmIdentifier());

    auto context = scriptExecutionContext();

    auto index = promise.ptr();
    m_pendingPromises.add(index, WTF::move(promise));
    WeakPtr weakThis { *this };
    auto callback = [index, weakThis, wrapAlgorithm, wrappingKey = Ref { wrappingKey }, wrapParams = WTF::move(wrapParams), isEncryption, context, workQueue = m_workQueue](SubtleCrypto::KeyFormat format, KeyData&& key) mutable {
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
                    bytes = std::get<Vector<uint8_t>>(key);
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
                    CString jwkUTF8String = jwkString.utf8(StrictConversion);
                    bytes.append(jwkUTF8String.span());

                    // AES-KW (RFC 3394) can only wrap plaintext whose length is a multiple of
                    // 8 bytes. A serialized JWK usually isn't, so pad it with trailing spaces,
                    // which JSON.parse ignores when the key is unwrapped. This matches Node.js.
                    if (wrappingKey->algorithmIdentifier() == CryptoAlgorithmIdentifier::AES_KW) {
                        while (bytes.size() % 8)
                            bytes.append(' ');
                    }
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

                if (!isEncryption) {
                    // The 11 December 2014 version of the specification suggests we should perform the following task asynchronously:
                    // https://www.w3.org/TR/WebCryptoAPI/#SubtleCrypto-method-wrapKey
                    // It is not beneficial for less time consuming operations. Therefore, we perform it synchronously.
                    RELEASE_AND_RETURN(scope, wrapAlgorithm->wrapKey(wrappingKey.get(), WTF::move(bytes), WTF::move(callback), WTF::move(exceptionCallback)));
                }
                // The following operation should be performed asynchronously.
                RELEASE_AND_RETURN(scope, wrapAlgorithm->encrypt(*wrapParams, WTF::move(wrappingKey), WTF::move(bytes), WTF::move(callback), WTF::move(exceptionCallback), *context, workQueue));
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

    bool isDecryption = false;

    auto unwrapParamsOrException = normalizeCryptoAlgorithmParameters(state, unwrapAlgorithmIdentifier, Operations::UnwrapKey);
    RETURN_IF_EXCEPTION(scope, void());
    if (unwrapParamsOrException.hasException()) {
        unwrapParamsOrException = normalizeCryptoAlgorithmParameters(state, unwrapAlgorithmIdentifier, Operations::Decrypt);
        RETURN_IF_EXCEPTION(scope, void());
        if (unwrapParamsOrException.hasException()) {
            promise->reject(unwrapParamsOrException.releaseException());
            return;
        }

        isDecryption = true;
    }
    auto unwrapParams = unwrapParamsOrException.releaseReturnValue();

    auto unwrappedKeyAlgorithmOrException = normalizeCryptoAlgorithmParameters(state, unwrappedKeyAlgorithmIdentifier, Operations::ImportKey);
    RETURN_IF_EXCEPTION(scope, void());
    if (unwrappedKeyAlgorithmOrException.hasException()) {
        promise->reject(unwrappedKeyAlgorithmOrException.releaseException());
        return;
    }
    auto unwrappedKeyAlgorithm = unwrappedKeyAlgorithmOrException.releaseReturnValue();

    auto keyUsagesBitmap = toCryptoKeyUsageBitmap(keyUsages);

    if (unwrapParams->identifier != unwrappingKey.algorithmIdentifier()) {
        promise->reject(InvalidAccessError, "Key algorithm mismatch"_s);
        return;
    }

    if (!unwrappingKey.allows(CryptoKeyUsageUnwrapKey)) {
        promise->reject(InvalidAccessError, "Unable to use this key to unwrapKey"_s);
        return;
    }

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

    auto index = promise.ptr();
    m_pendingPromises.add(index, WTF::move(promise));
    WeakPtr weakThis { *this };
    auto callback = [index, weakThis, format, importAlgorithm, unwrappedKeyAlgorithm = crossThreadCopyImportParams(*unwrappedKeyAlgorithm), extractable, keyUsagesBitmap](const Vector<uint8_t>& bytes) mutable {
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
                    String jwkString(bytes.span());
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
                auto exceptionCallback = [index, weakThis](ExceptionCode ec, const String& msg) mutable {
                    if (auto promise = getPromise(index, weakThis))
                        rejectWithException(promise.releaseNonNull(), ec, msg);
                };

                // The following operation should be performed synchronously.
                RELEASE_AND_RETURN(scope, importAlgorithm->importKey(format, WTF::move(keyData), *unwrappedKeyAlgorithm, extractable, keyUsagesBitmap, WTF::move(callback), WTF::move(exceptionCallback)));
            }
        }
    };
    auto exceptionCallback = [index, weakThis](ExceptionCode ec, const String& msg) mutable {
        if (auto promise = getPromise(index, weakThis))
            rejectWithException(promise.releaseNonNull(), ec, msg);
    };

    if (!isDecryption) {
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

void SubtleCrypto::getPublicKey(JSC::JSGlobalObject& state, CryptoKey& key, Vector<CryptoKeyUsage>&& keyUsages, Ref<DeferredPromise>&& promise)
{
    if (key.type() != CryptoKeyType::Private) {
        promise->reject(key.type() == CryptoKeyType::Secret ? NotSupportedError : InvalidAccessError, "key must be a private key"_s);
        return;
    }

    auto keyUsagesBitmap = toCryptoKeyUsageBitmap(keyUsages);
    auto identifier = key.algorithmIdentifier();

    std::unique_ptr<CryptoAlgorithmParameters> importParams;
    switch (identifier) {
    case CryptoAlgorithmIdentifier::RSASSA_PKCS1_v1_5:
    case CryptoAlgorithmIdentifier::RSA_PSS:
    case CryptoAlgorithmIdentifier::RSA_OAEP: {
        auto params = makeUnique<CryptoAlgorithmRsaHashedImportParams>();
        params->hashIdentifier = downcast<CryptoKeyRSA>(key).hashAlgorithmIdentifier();
        importParams = WTF::move(params);
        break;
    }
    case CryptoAlgorithmIdentifier::ECDSA:
    case CryptoAlgorithmIdentifier::ECDH: {
        auto params = makeUnique<CryptoAlgorithmEcKeyParams>();
        params->namedCurve = downcast<CryptoKeyEC>(key).namedCurveString();
        importParams = WTF::move(params);
        break;
    }
    case CryptoAlgorithmIdentifier::Ed25519:
    case CryptoAlgorithmIdentifier::X25519:
    case CryptoAlgorithmIdentifier::ML_DSA_44:
    case CryptoAlgorithmIdentifier::ML_DSA_65:
    case CryptoAlgorithmIdentifier::ML_DSA_87:
    case CryptoAlgorithmIdentifier::ML_KEM_768:
    case CryptoAlgorithmIdentifier::ML_KEM_1024:
        importParams = makeUnique<CryptoAlgorithmParameters>();
        break;
    default:
        promise->reject(Exception { NotSupportedError });
        return;
    }
    importParams->identifier = identifier;

    Vector<uint8_t> spki;
    {
        AsymmetricKeyValue keyValue(key);
        auto der = marshalEVPKey(keyValue.key, true);
        if (!der) {
            promise->reject(OperationError, ""_s);
            return;
        }
        spki = WTF::move(*der);
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

    algorithm->importKey(KeyFormat::Spki, KeyData { WTF::move(spki) }, *importParams, true, keyUsagesBitmap, WTF::move(callback), WTF::move(exceptionCallback));
}

void SubtleCrypto::encapsulateBits(JSC::JSGlobalObject& state, AlgorithmIdentifier&& algorithmIdentifier, CryptoKey& encapsulationKey, Ref<DeferredPromise>&& promise)
{
    auto& vm = state.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto paramsOrException = normalizeCryptoAlgorithmParameters(state, WTF::move(algorithmIdentifier), Operations::Encapsulate);
    RETURN_IF_EXCEPTION(scope, void());
    if (paramsOrException.hasException()) {
        promise->reject(paramsOrException.releaseException());
        return;
    }
    auto params = paramsOrException.releaseReturnValue();

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
    auto paramsOrException = normalizeCryptoAlgorithmParameters(state, WTF::move(algorithmIdentifier), Operations::Encapsulate);
    RETURN_IF_EXCEPTION(scope, void());
    if (paramsOrException.hasException()) {
        promise->reject(paramsOrException.releaseException());
        return;
    }
    auto params = paramsOrException.releaseReturnValue();

    auto importParamsOrException = normalizeCryptoAlgorithmParameters(state, WTF::move(sharedKeyAlgorithm), Operations::ImportKey);
    RETURN_IF_EXCEPTION(scope, void());
    if (importParamsOrException.hasException()) {
        promise->reject(importParamsOrException.releaseException());
        return;
    }
    auto importParams = importParamsOrException.releaseReturnValue();

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

    auto index = promise.ptr();
    m_pendingPromises.add(index, WTF::move(promise));
    WeakPtr weakThis { *this };
    auto callback = [index, weakThis, importAlgorithm = WTF::move(importAlgorithm), importParams = crossThreadCopyImportParams(*importParams), extractable, keyUsagesBitmap](Vector<uint8_t>&& sharedKeyBytes, Vector<uint8_t>&& ciphertext) mutable {
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
        auto format = importParams->identifier == CryptoAlgorithmIdentifier::HKDF || importParams->identifier == CryptoAlgorithmIdentifier::PBKDF2
            ? SubtleCrypto::KeyFormat::Raw
            : SubtleCrypto::KeyFormat::RawSecret;
        importAlgorithm->importKey(format, WTF::move(data), *importParams, extractable, keyUsagesBitmap, WTF::move(keyCallback), WTF::move(keyExceptionCallback));
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
    auto paramsOrException = normalizeCryptoAlgorithmParameters(state, WTF::move(algorithmIdentifier), Operations::Decapsulate);
    RETURN_IF_EXCEPTION(scope, void());
    if (paramsOrException.hasException()) {
        promise->reject(paramsOrException.releaseException());
        return;
    }
    auto params = paramsOrException.releaseReturnValue();

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
    auto paramsOrException = normalizeCryptoAlgorithmParameters(state, WTF::move(algorithmIdentifier), Operations::Decapsulate);
    RETURN_IF_EXCEPTION(scope, void());
    if (paramsOrException.hasException()) {
        promise->reject(paramsOrException.releaseException());
        return;
    }
    auto params = paramsOrException.releaseReturnValue();

    auto importParamsOrException = normalizeCryptoAlgorithmParameters(state, WTF::move(sharedKeyAlgorithm), Operations::ImportKey);
    RETURN_IF_EXCEPTION(scope, void());
    if (importParamsOrException.hasException()) {
        promise->reject(importParamsOrException.releaseException());
        return;
    }
    auto importParams = importParamsOrException.releaseReturnValue();

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

    auto index = promise.ptr();
    m_pendingPromises.add(index, WTF::move(promise));
    WeakPtr weakThis { *this };
    auto callback = [index, weakThis, importAlgorithm = WTF::move(importAlgorithm), importParams = crossThreadCopyImportParams(*importParams), extractable, keyUsagesBitmap](const Vector<uint8_t>& sharedKeyBytes) mutable {
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
        auto format = importParams->identifier == CryptoAlgorithmIdentifier::HKDF || importParams->identifier == CryptoAlgorithmIdentifier::PBKDF2
            ? SubtleCrypto::KeyFormat::Raw
            : SubtleCrypto::KeyFormat::RawSecret;
        importAlgorithm->importKey(format, WTF::move(data), *importParams, extractable, keyUsagesBitmap, WTF::move(keyCallback), WTF::move(keyExceptionCallback));
    };
    auto exceptionCallback = [index, weakThis](ExceptionCode ec, const String& msg) mutable {
        if (auto promise = getPromise(index, weakThis))
            rejectWithException(promise.releaseNonNull(), ec, msg);
    };

    RELEASE_AND_RETURN(scope, algorithm->decapsulate(decapsulationKey, WTF::move(*ciphertext), WTF::move(callback), WTF::move(exceptionCallback)));
}

ExceptionOr<std::unique_ptr<CryptoAlgorithmParameters>> SubtleCrypto::normalizeImportParameters(JSC::JSGlobalObject& state, AlgorithmIdentifier&& algorithmIdentifier)
{
    return normalizeCryptoAlgorithmParameters(state, WTF::move(algorithmIdentifier), Operations::ImportKey);
}

// https://wicg.github.io/webcrypto-modern-algos/#SubtleCrypto-method-supports
// Mirrors Node's SubtleCrypto.supports: argument conversion failures throw,
// everything discovered while probing an operation reports false.
bool SubtleCrypto::supports(JSC::JSGlobalObject& state, const String& operation, AlgorithmIdentifier&& algorithmIdentifier, JSC::JSValue lengthOrAdditionalAlgorithm)
{
    auto& vm = state.vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    auto normalize = [&](const AlgorithmIdentifier& identifier, Operations op) -> std::unique_ptr<CryptoAlgorithmParameters> {
        AlgorithmIdentifier copy = identifier;
        auto result = normalizeCryptoAlgorithmParameters(state, WTF::move(copy), op);
        if (throwScope.exception()) [[unlikely]] {
            (void)throwScope.tryClearException();
            return nullptr;
        }
        if (result.hasException())
            return nullptr;
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
            auto* publicKey = downcast<CryptoAlgorithmEcdhKeyDeriveParams>(params).publicKey.get();
            if (!publicKey || !is<CryptoKeyEC>(*publicKey))
                return false;
            auto namedCurve = downcast<CryptoKeyEC>(*publicKey).namedCurveString();
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
            return params && isSupportedExportKey(state, params->identifier);
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
            auto hmacLength = downcast<CryptoAlgorithmHmacKeyParams>(*additionalParams).length;
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
