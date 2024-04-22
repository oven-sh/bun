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

#if ENABLE(WEB_CRYPTO)

#include "CryptoAlgorithm.h"
#include "CryptoAlgorithmRegistry.h"
#include "JSAesCbcCfbParams.h"
#include "JSAesCtrParams.h"
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
    GetKeyLength
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
    // auto& globalObject = *JSC::jsCast<JSDOMGlobalObject*>(&state);
    // auto* context = globalObject.scriptExecutionContext();
    // return context && context->settingsValues().deprecateRSAESPKCSWebCryptoEnabled;
}

static bool isSafeCurvesEnabled(JSGlobalObject& state)
{
    return true;
    // auto& globalObject = *JSC::jsCast<JSDOMGlobalObject*>(&state);
    // auto* context = globalObject.scriptExecutionContext();
    // return context && context->settingsValues().webCryptoSafeCurvesEnabled;
}

static ExceptionOr<std::unique_ptr<CryptoAlgorithmParameters>> normalizeCryptoAlgorithmParameters(JSGlobalObject& state, SubtleCrypto::AlgorithmIdentifier algorithmIdentifier, Operations operation)
{
    VM& vm = state.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (std::holds_alternative<String>(algorithmIdentifier)) {
        auto newParams = Strong<JSObject>(vm, constructEmptyObject(&state));
        newParams->putDirect(vm, Identifier::fromString(vm, "name"_s), jsString(vm, std::get<String>(algorithmIdentifier)));

        return normalizeCryptoAlgorithmParameters(state, newParams, operation);
    }

    auto& value = std::get<JSC::Strong<JSC::JSObject>>(algorithmIdentifier);

    auto params = convertDictionary<CryptoAlgorithmParameters>(state, value.get());
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });

    auto identifier = CryptoAlgorithmRegistry::singleton().identifier(params.name);
    if (UNLIKELY(!identifier))
        return Exception { NotSupportedError };

    if (*identifier == CryptoAlgorithmIdentifier::Ed25519 && !isSafeCurvesEnabled(state))
        return Exception { NotSupportedError };

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
            result = makeUnique<CryptoAlgorithmRsaOaepParams>(params);
            break;
        }
        case CryptoAlgorithmIdentifier::AES_CBC:
        case CryptoAlgorithmIdentifier::AES_CFB: {
            auto params = convertDictionary<CryptoAlgorithmAesCbcCfbParams>(state, value.get());
            RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
            result = makeUnique<CryptoAlgorithmAesCbcCfbParams>(params);
            break;
        }
        case CryptoAlgorithmIdentifier::AES_CTR: {
            auto params = convertDictionary<CryptoAlgorithmAesCtrParams>(state, value.get());
            RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
            result = makeUnique<CryptoAlgorithmAesCtrParams>(params);
            break;
        }
        case CryptoAlgorithmIdentifier::AES_GCM: {
            auto params = convertDictionary<CryptoAlgorithmAesGcmParams>(state, value.get());
            RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
            result = makeUnique<CryptoAlgorithmAesGcmParams>(params);
            break;
        }
        default:
            return Exception { NotSupportedError };
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
            if (hashIdentifier.hasException())
                return hashIdentifier.releaseException();
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
        default:
            return Exception { NotSupportedError };
        }
        break;
    case Operations::Digest:
        switch (*identifier) {
        case CryptoAlgorithmIdentifier::SHA_1:
        case CryptoAlgorithmIdentifier::SHA_224:
        case CryptoAlgorithmIdentifier::SHA_256:
        case CryptoAlgorithmIdentifier::SHA_384:
        case CryptoAlgorithmIdentifier::SHA_512:
            result = makeUnique<CryptoAlgorithmParameters>(params);
            break;
        default:
            return Exception { NotSupportedError };
        }
        break;
    case Operations::GenerateKey:
        switch (*identifier) {
        case CryptoAlgorithmIdentifier::RSAES_PKCS1_v1_5: {
            if (isRSAESPKCSWebCryptoDeprecated(state))
                return Exception { NotSupportedError, "RSAES-PKCS1-v1_5 support is deprecated"_s };
            auto params = convertDictionary<CryptoAlgorithmRsaKeyGenParams>(state, value.get());
            RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
            result = makeUnique<CryptoAlgorithmRsaKeyGenParams>(params);
            break;
        }
        case CryptoAlgorithmIdentifier::RSASSA_PKCS1_v1_5:
        case CryptoAlgorithmIdentifier::RSA_PSS:
        case CryptoAlgorithmIdentifier::RSA_OAEP: {
            auto params = convertDictionary<CryptoAlgorithmRsaHashedKeyGenParams>(state, value.get());
            RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
            auto hashIdentifier = toHashIdentifier(state, params.hash);
            if (hashIdentifier.hasException())
                return hashIdentifier.releaseException();
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
            if (hashIdentifier.hasException())
                return hashIdentifier.releaseException();
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
        default:
            return Exception { NotSupportedError };
        }
        break;
    case Operations::DeriveBits:
        switch (*identifier) {
        case CryptoAlgorithmIdentifier::ECDH: {
            // Remove this hack once https://bugs.webkit.org/show_bug.cgi?id=169333 is fixed.
            JSValue nameValue = value.get()->get(&state, Identifier::fromString(vm, "name"_s));
            JSValue publicValue = value.get()->get(&state, Identifier::fromString(vm, "public"_s));
            JSObject* newValue = constructEmptyObject(&state);
            newValue->putDirect(vm, Identifier::fromString(vm, "name"_s), nameValue);
            newValue->putDirect(vm, Identifier::fromString(vm, "publicKey"_s), publicValue);

            auto params = convertDictionary<CryptoAlgorithmEcdhKeyDeriveParams>(state, newValue);
            RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
            result = makeUnique<CryptoAlgorithmEcdhKeyDeriveParams>(params);
            break;
        }
        case CryptoAlgorithmIdentifier::HKDF: {
            auto params = convertDictionary<CryptoAlgorithmHkdfParams>(state, value.get());
            RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
            auto hashIdentifier = toHashIdentifier(state, params.hash);
            if (hashIdentifier.hasException())
                return hashIdentifier.releaseException();
            params.hashIdentifier = hashIdentifier.releaseReturnValue();
            result = makeUnique<CryptoAlgorithmHkdfParams>(params);
            break;
        }
        case CryptoAlgorithmIdentifier::PBKDF2: {
            auto params = convertDictionary<CryptoAlgorithmPbkdf2Params>(state, value.get());
            RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
            auto hashIdentifier = toHashIdentifier(state, params.hash);
            if (hashIdentifier.hasException())
                return hashIdentifier.releaseException();
            params.hashIdentifier = hashIdentifier.releaseReturnValue();
            result = makeUnique<CryptoAlgorithmPbkdf2Params>(params);
            break;
        }
        default:
            return Exception { NotSupportedError };
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
            if (hashIdentifier.hasException())
                return hashIdentifier.releaseException();
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
            result = makeUnique<CryptoAlgorithmParameters>(params);
            break;
        case CryptoAlgorithmIdentifier::HMAC: {
            auto params = convertDictionary<CryptoAlgorithmHmacKeyParams>(state, value.get());
            RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
            auto hashIdentifier = toHashIdentifier(state, params.hash);
            if (hashIdentifier.hasException())
                return hashIdentifier.releaseException();
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
            return Exception { NotSupportedError };
        }
        break;
    case Operations::WrapKey:
    case Operations::UnwrapKey:
        switch (*identifier) {
        case CryptoAlgorithmIdentifier::AES_KW:
            result = makeUnique<CryptoAlgorithmParameters>(params);
            break;
        default:
            return Exception { NotSupportedError };
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
            if (hashIdentifier.hasException())
                return hashIdentifier.releaseException();
            params.hashIdentifier = hashIdentifier.releaseReturnValue();
            result = makeUnique<CryptoAlgorithmHmacKeyParams>(params);
            break;
        }
        case CryptoAlgorithmIdentifier::HKDF:
        case CryptoAlgorithmIdentifier::PBKDF2:
            result = makeUnique<CryptoAlgorithmParameters>(params);
            break;
        default:
            return Exception { NotSupportedError };
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
static void rejectWithException(Ref<DeferredPromise>&& passedPromise, ExceptionCode ec)
{
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
        return WTF::switchOn(
            keyDataVariant,
            [&promise](JsonWebKey&) -> std::optional<KeyData> {
                promise->reject(Exception { TypeError });
                return std::nullopt;
            },
            [](auto& bufferSource) -> std::optional<KeyData> {
                return KeyData { Vector(std::span { static_cast<const uint8_t*>(bufferSource->data()), bufferSource->byteLength() }) };
            });
    case SubtleCrypto::KeyFormat::Jwk:
        return WTF::switchOn(
            keyDataVariant,
            [](JsonWebKey& webKey) -> std::optional<KeyData> {
                normalizeJsonWebKey(webKey);
                return KeyData { webKey };
            },
            [&promise](auto&) -> std::optional<KeyData> {
                promise->reject(Exception { TypeError });
                return std::nullopt;
            });
    }

    RELEASE_ASSERT_NOT_REACHED();
}

static Vector<uint8_t> copyToVector(BufferSource&& data)
{
    return std::span { data.data(), data.length() };
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
        return true;
    default:
        return false;
    }
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
    addAuthenticatedEncryptionWarningIfNecessary(key.algorithmIdentifier());

    auto paramsOrException = normalizeCryptoAlgorithmParameters(state, WTFMove(algorithmIdentifier), Operations::Encrypt);
    if (paramsOrException.hasException()) {
        promise->reject(paramsOrException.releaseException());
        return;
    }
    auto params = paramsOrException.releaseReturnValue();

    auto data = copyToVector(WTFMove(dataBufferSource));

    if (params->identifier != key.algorithmIdentifier()) {
        promise->reject(InvalidAccessError, "CryptoKey doesn't match AlgorithmIdentifier"_s);
        return;
    }

    if (!key.allows(CryptoKeyUsageEncrypt)) {
        promise->reject(InvalidAccessError, "CryptoKey doesn't support encryption"_s);
        return;
    }

    auto algorithm = CryptoAlgorithmRegistry::singleton().create(key.algorithmIdentifier());

    auto index = promise.ptr();
    m_pendingPromises.add(index, WTFMove(promise));
    WeakPtr weakThis { *this };
    auto callback = [index, weakThis](const Vector<uint8_t>& cipherText) mutable {
        if (auto promise = getPromise(index, weakThis))
            fulfillPromiseWithArrayBuffer(promise.releaseNonNull(), cipherText.data(), cipherText.size());
    };
    auto exceptionCallback = [index, weakThis](ExceptionCode ec) mutable {
        if (auto promise = getPromise(index, weakThis))
            rejectWithException(promise.releaseNonNull(), ec);
    };

    algorithm->encrypt(*params, key, WTFMove(data), WTFMove(callback), WTFMove(exceptionCallback), *scriptExecutionContext(), m_workQueue);
}

void SubtleCrypto::decrypt(JSC::JSGlobalObject& state, AlgorithmIdentifier&& algorithmIdentifier, CryptoKey& key, BufferSource&& dataBufferSource, Ref<DeferredPromise>&& promise)
{
    addAuthenticatedEncryptionWarningIfNecessary(key.algorithmIdentifier());

    auto paramsOrException = normalizeCryptoAlgorithmParameters(state, WTFMove(algorithmIdentifier), Operations::Decrypt);
    if (paramsOrException.hasException()) {
        promise->reject(paramsOrException.releaseException());
        return;
    }
    auto params = paramsOrException.releaseReturnValue();

    auto data = copyToVector(WTFMove(dataBufferSource));

    if (params->identifier != key.algorithmIdentifier()) {
        promise->reject(InvalidAccessError, "CryptoKey doesn't match AlgorithmIdentifier"_s);
        return;
    }

    if (!key.allows(CryptoKeyUsageDecrypt)) {
        promise->reject(InvalidAccessError, "CryptoKey doesn't support decryption"_s);
        return;
    }

    auto algorithm = CryptoAlgorithmRegistry::singleton().create(key.algorithmIdentifier());

    auto index = promise.ptr();
    m_pendingPromises.add(index, WTFMove(promise));
    WeakPtr weakThis { *this };
    auto callback = [index, weakThis](const Vector<uint8_t>& plainText) mutable {
        if (auto promise = getPromise(index, weakThis))
            fulfillPromiseWithArrayBuffer(promise.releaseNonNull(), plainText.data(), plainText.size());
    };
    auto exceptionCallback = [index, weakThis](ExceptionCode ec) mutable {
        if (auto promise = getPromise(index, weakThis))
            rejectWithException(promise.releaseNonNull(), ec);
    };

    algorithm->decrypt(*params, key, WTFMove(data), WTFMove(callback), WTFMove(exceptionCallback), *scriptExecutionContext(), m_workQueue);
}

void SubtleCrypto::sign(JSC::JSGlobalObject& state, AlgorithmIdentifier&& algorithmIdentifier, CryptoKey& key, BufferSource&& dataBufferSource, Ref<DeferredPromise>&& promise)
{
    auto paramsOrException = normalizeCryptoAlgorithmParameters(state, WTFMove(algorithmIdentifier), Operations::Sign);
    if (paramsOrException.hasException()) {
        promise->reject(paramsOrException.releaseException());
        return;
    }
    auto params = paramsOrException.releaseReturnValue();

    auto data = copyToVector(WTFMove(dataBufferSource));

    if (params->identifier != key.algorithmIdentifier()) {
        promise->reject(InvalidAccessError, "CryptoKey doesn't match AlgorithmIdentifier"_s);
        return;
    }

    if (!key.allows(CryptoKeyUsageSign)) {
        promise->reject(InvalidAccessError, "CryptoKey doesn't support signing"_s);
        return;
    }

    auto algorithm = CryptoAlgorithmRegistry::singleton().create(key.algorithmIdentifier());

    auto index = promise.ptr();
    m_pendingPromises.add(index, WTFMove(promise));
    WeakPtr weakThis { *this };
    auto callback = [index, weakThis](const Vector<uint8_t>& signature) mutable {
        if (auto promise = getPromise(index, weakThis))
            fulfillPromiseWithArrayBuffer(promise.releaseNonNull(), signature.data(), signature.size());
    };
    auto exceptionCallback = [index, weakThis](ExceptionCode ec) mutable {
        if (auto promise = getPromise(index, weakThis))
            rejectWithException(promise.releaseNonNull(), ec);
    };

    algorithm->sign(*params, key, WTFMove(data), WTFMove(callback), WTFMove(exceptionCallback), *scriptExecutionContext(), m_workQueue);
}

void SubtleCrypto::verify(JSC::JSGlobalObject& state, AlgorithmIdentifier&& algorithmIdentifier, CryptoKey& key, BufferSource&& signatureBufferSource, BufferSource&& dataBufferSource, Ref<DeferredPromise>&& promise)
{
    auto paramsOrException = normalizeCryptoAlgorithmParameters(state, WTFMove(algorithmIdentifier), Operations::Verify);
    if (paramsOrException.hasException()) {
        promise->reject(paramsOrException.releaseException());
        return;
    }
    auto params = paramsOrException.releaseReturnValue();

    auto signature = copyToVector(WTFMove(signatureBufferSource));
    auto data = copyToVector(WTFMove(dataBufferSource));

    if (params->identifier != key.algorithmIdentifier()) {
        promise->reject(InvalidAccessError, "CryptoKey doesn't match AlgorithmIdentifier"_s);
        return;
    }

    if (!key.allows(CryptoKeyUsageVerify)) {
        promise->reject(InvalidAccessError, "CryptoKey doesn't support verification"_s);
        return;
    }

    auto algorithm = CryptoAlgorithmRegistry::singleton().create(key.algorithmIdentifier());

    auto index = promise.ptr();
    m_pendingPromises.add(index, WTFMove(promise));
    WeakPtr weakThis { *this };
    auto callback = [index, weakThis](bool result) mutable {
        if (auto promise = getPromise(index, weakThis))
            promise->resolve<IDLBoolean>(result);
    };
    auto exceptionCallback = [index, weakThis](ExceptionCode ec) mutable {
        if (auto promise = getPromise(index, weakThis))
            rejectWithException(promise.releaseNonNull(), ec);
    };

    algorithm->verify(*params, key, WTFMove(signature), WTFMove(data), WTFMove(callback), WTFMove(exceptionCallback), *scriptExecutionContext(), m_workQueue);
}

void SubtleCrypto::digest(JSC::JSGlobalObject& state, AlgorithmIdentifier&& algorithmIdentifier, BufferSource&& dataBufferSource, Ref<DeferredPromise>&& promise)
{
    auto paramsOrException = normalizeCryptoAlgorithmParameters(state, WTFMove(algorithmIdentifier), Operations::Digest);
    if (paramsOrException.hasException()) {
        promise->reject(paramsOrException.releaseException());
        return;
    }
    auto params = paramsOrException.releaseReturnValue();

    auto data = copyToVector(WTFMove(dataBufferSource));

    auto algorithm = CryptoAlgorithmRegistry::singleton().create(params->identifier);

    auto index = promise.ptr();
    m_pendingPromises.add(index, WTFMove(promise));
    WeakPtr weakThis { *this };
    auto callback = [index, weakThis](const Vector<uint8_t>& digest) mutable {
        if (auto promise = getPromise(index, weakThis))
            fulfillPromiseWithArrayBuffer(promise.releaseNonNull(), digest.data(), digest.size());
    };
    auto exceptionCallback = [index, weakThis](ExceptionCode ec) mutable {
        if (auto promise = getPromise(index, weakThis))
            rejectWithException(promise.releaseNonNull(), ec);
    };

    algorithm->digest(WTFMove(data), WTFMove(callback), WTFMove(exceptionCallback), *scriptExecutionContext(), m_workQueue);
}

void SubtleCrypto::generateKey(JSC::JSGlobalObject& state, AlgorithmIdentifier&& algorithmIdentifier, bool extractable, Vector<CryptoKeyUsage>&& keyUsages, Ref<DeferredPromise>&& promise)
{
    auto paramsOrException = normalizeCryptoAlgorithmParameters(state, WTFMove(algorithmIdentifier), Operations::GenerateKey);
    if (paramsOrException.hasException()) {
        promise->reject(paramsOrException.releaseException());
        return;
    }
    auto params = paramsOrException.releaseReturnValue();

    auto keyUsagesBitmap = toCryptoKeyUsageBitmap(keyUsages);

    auto algorithm = CryptoAlgorithmRegistry::singleton().create(params->identifier);

    auto index = promise.ptr();
    m_pendingPromises.add(index, WTFMove(promise));
    WeakPtr weakThis { *this };
    auto callback = [index, weakThis](KeyOrKeyPair&& keyOrKeyPair) mutable {
        if (auto promise = getPromise(index, weakThis)) {
            WTF::switchOn(
                keyOrKeyPair,
                [&promise](RefPtr<CryptoKey>& key) {
                    if ((key->type() == CryptoKeyType::Private || key->type() == CryptoKeyType::Secret) && !key->usagesBitmap()) {
                        rejectWithException(promise.releaseNonNull(), SyntaxError);
                        return;
                    }
                    promise->resolve<IDLInterface<CryptoKey>>(*key);
                },
                [&promise](CryptoKeyPair& keyPair) {
                    if (!keyPair.privateKey->usagesBitmap()) {
                        rejectWithException(promise.releaseNonNull(), SyntaxError);
                        return;
                    }
                    promise->resolve<IDLDictionary<CryptoKeyPair>>(keyPair);
                });
        }
    };
    auto exceptionCallback = [index, weakThis](ExceptionCode ec) mutable {
        if (auto promise = getPromise(index, weakThis))
            rejectWithException(promise.releaseNonNull(), ec);
    };

    // The 26 January 2017 version of the specification suggests we should perform the following task asynchronously
    // regardless what kind of keys it produces: https://www.w3.org/TR/WebCryptoAPI/#SubtleCrypto-method-generateKey
    // That's simply not efficient for AES, HMAC and EC keys. Therefore, we perform it as an async task only for RSA keys.
    algorithm->generateKey(*params, extractable, keyUsagesBitmap, WTFMove(callback), WTFMove(exceptionCallback), *scriptExecutionContext());
}

void SubtleCrypto::deriveKey(JSC::JSGlobalObject& state, AlgorithmIdentifier&& algorithmIdentifier, CryptoKey& baseKey, AlgorithmIdentifier&& derivedKeyType, bool extractable, Vector<CryptoKeyUsage>&& keyUsages, Ref<DeferredPromise>&& promise)
{
    auto paramsOrException = normalizeCryptoAlgorithmParameters(state, WTFMove(algorithmIdentifier), Operations::DeriveBits);
    if (paramsOrException.hasException()) {
        promise->reject(paramsOrException.releaseException());
        return;
    }
    auto params = paramsOrException.releaseReturnValue();

    auto importParamsOrException = normalizeCryptoAlgorithmParameters(state, derivedKeyType, Operations::ImportKey);
    if (importParamsOrException.hasException()) {
        promise->reject(importParamsOrException.releaseException());
        return;
    }
    auto importParams = importParamsOrException.releaseReturnValue();

    auto getLengthParamsOrException = normalizeCryptoAlgorithmParameters(state, derivedKeyType, Operations::GetKeyLength);
    if (getLengthParamsOrException.hasException()) {
        promise->reject(getLengthParamsOrException.releaseException());
        return;
    }
    auto getLengthParams = getLengthParamsOrException.releaseReturnValue();

    auto keyUsagesBitmap = toCryptoKeyUsageBitmap(keyUsages);

    if (params->identifier != baseKey.algorithmIdentifier()) {
        promise->reject(InvalidAccessError, "CryptoKey doesn't match AlgorithmIdentifier"_s);
        return;
    }

    if (!baseKey.allows(CryptoKeyUsageDeriveKey)) {
        promise->reject(InvalidAccessError, "CryptoKey doesn't support CryptoKey derivation"_s);
        return;
    }

    auto getLengthAlgorithm = CryptoAlgorithmRegistry::singleton().create(getLengthParams->identifier);

    auto result = getLengthAlgorithm->getKeyLength(*getLengthParams);
    if (result.hasException()) {
        promise->reject(result.releaseException().code(), "Cannot get key length from derivedKeyType"_s);
        return;
    }
    size_t length = result.releaseReturnValue();

    auto importAlgorithm = CryptoAlgorithmRegistry::singleton().create(importParams->identifier);
    auto algorithm = CryptoAlgorithmRegistry::singleton().create(params->identifier);

    auto index = promise.ptr();
    m_pendingPromises.add(index, WTFMove(promise));
    WeakPtr weakThis { *this };
    auto callback = [index, weakThis, importAlgorithm = WTFMove(importAlgorithm), importParams = crossThreadCopyImportParams(*importParams), extractable, keyUsagesBitmap](const Vector<uint8_t>& derivedKey) mutable {
        // FIXME: https://bugs.webkit.org/show_bug.cgi?id=169395
        KeyData data = derivedKey;
        auto callback = [index, weakThis](CryptoKey& key) mutable {
            if (auto promise = getPromise(index, weakThis)) {
                if ((key.type() == CryptoKeyType::Private || key.type() == CryptoKeyType::Secret) && !key.usagesBitmap()) {
                    rejectWithException(promise.releaseNonNull(), SyntaxError);
                    return;
                }
                promise->resolve<IDLInterface<CryptoKey>>(key);
            }
        };
        auto exceptionCallback = [index, weakThis](ExceptionCode ec) mutable {
            if (auto promise = getPromise(index, weakThis))
                rejectWithException(promise.releaseNonNull(), ec);
        };

        importAlgorithm->importKey(SubtleCrypto::KeyFormat::Raw, WTFMove(data), *importParams, extractable, keyUsagesBitmap, WTFMove(callback), WTFMove(exceptionCallback));
    };
    auto exceptionCallback = [index, weakThis](ExceptionCode ec) mutable {
        if (auto promise = getPromise(index, weakThis))
            rejectWithException(promise.releaseNonNull(), ec);
    };

    algorithm->deriveBits(*params, baseKey, length, WTFMove(callback), WTFMove(exceptionCallback), *scriptExecutionContext(), m_workQueue);
}

void SubtleCrypto::deriveBits(JSC::JSGlobalObject& state, AlgorithmIdentifier&& algorithmIdentifier, CryptoKey& baseKey, unsigned length, Ref<DeferredPromise>&& promise)
{
    auto paramsOrException = normalizeCryptoAlgorithmParameters(state, WTFMove(algorithmIdentifier), Operations::DeriveBits);
    if (paramsOrException.hasException()) {
        promise->reject(paramsOrException.releaseException());
        return;
    }
    auto params = paramsOrException.releaseReturnValue();

    if (params->identifier != baseKey.algorithmIdentifier()) {
        promise->reject(InvalidAccessError, "CryptoKey doesn't match AlgorithmIdentifier"_s);
        return;
    }

    if (!baseKey.allows(CryptoKeyUsageDeriveBits)) {
        promise->reject(InvalidAccessError, "CryptoKey doesn't support bits derivation"_s);
        return;
    }

    auto algorithm = CryptoAlgorithmRegistry::singleton().create(params->identifier);

    auto index = promise.ptr();
    m_pendingPromises.add(index, WTFMove(promise));
    WeakPtr weakThis { *this };
    auto callback = [index, weakThis](const Vector<uint8_t>& derivedKey) mutable {
        if (auto promise = getPromise(index, weakThis))
            fulfillPromiseWithArrayBuffer(promise.releaseNonNull(), derivedKey.data(), derivedKey.size());
    };
    auto exceptionCallback = [index, weakThis](ExceptionCode ec) mutable {
        if (auto promise = getPromise(index, weakThis))
            rejectWithException(promise.releaseNonNull(), ec);
    };

    algorithm->deriveBits(*params, baseKey, length, WTFMove(callback), WTFMove(exceptionCallback), *scriptExecutionContext(), m_workQueue);
}

void SubtleCrypto::importKey(JSC::JSGlobalObject& state, KeyFormat format, KeyDataVariant&& keyDataVariant, AlgorithmIdentifier&& algorithmIdentifier, bool extractable, Vector<CryptoKeyUsage>&& keyUsages, Ref<DeferredPromise>&& promise)
{
    auto paramsOrException = normalizeCryptoAlgorithmParameters(state, WTFMove(algorithmIdentifier), Operations::ImportKey);
    if (paramsOrException.hasException()) {
        promise->reject(paramsOrException.releaseException());
        return;
    }
    auto params = paramsOrException.releaseReturnValue();

    auto keyDataOrNull = toKeyData(format, WTFMove(keyDataVariant), promise);
    if (!keyDataOrNull) {
        // When toKeyData, it means the promise has been rejected, and we should return.
        return;
    }

    auto keyData = *keyDataOrNull;
    auto keyUsagesBitmap = toCryptoKeyUsageBitmap(keyUsages);

    auto algorithm = CryptoAlgorithmRegistry::singleton().create(params->identifier);

    auto index = promise.ptr();
    m_pendingPromises.add(index, WTFMove(promise));
    WeakPtr weakThis { *this };
    auto callback = [index, weakThis](CryptoKey& key) mutable {
        if (auto promise = getPromise(index, weakThis)) {
            if ((key.type() == CryptoKeyType::Private || key.type() == CryptoKeyType::Secret) && !key.usagesBitmap()) {
                rejectWithException(promise.releaseNonNull(), SyntaxError);
                return;
            }
            promise->resolve<IDLInterface<CryptoKey>>(key);
        }
    };
    auto exceptionCallback = [index, weakThis](ExceptionCode ec) mutable {
        if (auto promise = getPromise(index, weakThis))
            rejectWithException(promise.releaseNonNull(), ec);
    };

    // The 11 December 2014 version of the specification suggests we should perform the following task asynchronously:
    // https://www.w3.org/TR/WebCryptoAPI/#SubtleCrypto-method-importKey
    // It is not beneficial for less time consuming operations. Therefore, we perform it synchronously.
    algorithm->importKey(format, WTFMove(keyData), *params, extractable, keyUsagesBitmap, WTFMove(callback), WTFMove(exceptionCallback));
}

void SubtleCrypto::exportKey(KeyFormat format, CryptoKey& key, Ref<DeferredPromise>&& promise)
{
    if (!isSupportedExportKey(*promise->globalObject(), key.algorithmIdentifier())) {
        promise->reject(Exception { NotSupportedError });
        return;
    }

    if (!key.extractable()) {
        promise->reject(InvalidAccessError, "The CryptoKey is nonextractable"_s);
        return;
    }

    auto algorithm = CryptoAlgorithmRegistry::singleton().create(key.algorithmIdentifier());

    auto index = promise.ptr();
    m_pendingPromises.add(index, WTFMove(promise));
    WeakPtr weakThis { *this };
    auto callback = [index, weakThis](SubtleCrypto::KeyFormat format, KeyData&& key) mutable {
        if (auto promise = getPromise(index, weakThis)) {
            switch (format) {
            case SubtleCrypto::KeyFormat::Spki:
            case SubtleCrypto::KeyFormat::Pkcs8:
            case SubtleCrypto::KeyFormat::Raw: {
                Vector<uint8_t>& rawKey = std::get<Vector<uint8_t>>(key);
                fulfillPromiseWithArrayBuffer(promise.releaseNonNull(), rawKey.data(), rawKey.size());
                return;
            }
            case SubtleCrypto::KeyFormat::Jwk:
                promise->resolve<IDLDictionary<JsonWebKey>>(WTFMove(std::get<JsonWebKey>(key)));
                return;
            }
            ASSERT_NOT_REACHED();
        }
    };
    auto exceptionCallback = [index, weakThis](ExceptionCode ec) mutable {
        if (auto promise = getPromise(index, weakThis))
            rejectWithException(promise.releaseNonNull(), ec);
    };

    // The 11 December 2014 version of the specification suggests we should perform the following task asynchronously:
    // https://www.w3.org/TR/WebCryptoAPI/#SubtleCrypto-method-exportKey
    // It is not beneficial for less time consuming operations. Therefore, we perform it synchronously.
    algorithm->exportKey(format, key, WTFMove(callback), WTFMove(exceptionCallback));
}

void SubtleCrypto::wrapKey(JSC::JSGlobalObject& state, KeyFormat format, CryptoKey& key, CryptoKey& wrappingKey, AlgorithmIdentifier&& wrapAlgorithmIdentifier, Ref<DeferredPromise>&& promise)
{
    bool isEncryption = false;

    auto wrapParamsOrException = normalizeCryptoAlgorithmParameters(state, wrapAlgorithmIdentifier, Operations::WrapKey);
    if (wrapParamsOrException.hasException()) {
        ASSERT(wrapParamsOrException.exception().code() != ExistingExceptionError);

        wrapParamsOrException = normalizeCryptoAlgorithmParameters(state, wrapAlgorithmIdentifier, Operations::Encrypt);
        if (wrapParamsOrException.hasException()) {
            promise->reject(wrapParamsOrException.releaseException());
            return;
        }

        isEncryption = true;
    }
    auto wrapParams = wrapParamsOrException.releaseReturnValue();

    if (wrapParams->identifier != wrappingKey.algorithmIdentifier()) {
        promise->reject(InvalidAccessError, "Wrapping CryptoKey doesn't match AlgorithmIdentifier"_s);
        return;
    }

    if (!wrappingKey.allows(CryptoKeyUsageWrapKey)) {
        promise->reject(InvalidAccessError, "Wrapping CryptoKey doesn't support wrapKey operation"_s);
        return;
    }

    if (!isSupportedExportKey(state, key.algorithmIdentifier())) {
        promise->reject(Exception { NotSupportedError });
        return;
    }

    if (!key.extractable()) {
        promise->reject(InvalidAccessError, "The CryptoKey is nonextractable"_s);
        return;
    }

    auto exportAlgorithm = CryptoAlgorithmRegistry::singleton().create(key.algorithmIdentifier());
    auto wrapAlgorithm = CryptoAlgorithmRegistry::singleton().create(wrappingKey.algorithmIdentifier());

    auto context = scriptExecutionContext();

    auto index = promise.ptr();
    m_pendingPromises.add(index, WTFMove(promise));
    WeakPtr weakThis { *this };
    auto callback = [index, weakThis, wrapAlgorithm, wrappingKey = Ref { wrappingKey }, wrapParams = WTFMove(wrapParams), isEncryption, context, workQueue = m_workQueue](SubtleCrypto::KeyFormat format, KeyData&& key) mutable {
        if (weakThis) {
            if (auto promise = weakThis->m_pendingPromises.get(index)) {
                Vector<uint8_t> bytes;
                switch (format) {
                case SubtleCrypto::KeyFormat::Spki:
                case SubtleCrypto::KeyFormat::Pkcs8:
                case SubtleCrypto::KeyFormat::Raw:
                    bytes = std::get<Vector<uint8_t>>(key);
                    break;
                case SubtleCrypto::KeyFormat::Jwk: {
                    // FIXME: Converting to JS just to JSON-Stringify seems inefficient. We should find a way to go directly from the struct to JSON.
                    auto jwk = toJS<IDLDictionary<JsonWebKey>>(*(promise->globalObject()), *(promise->globalObject()), WTFMove(std::get<JsonWebKey>(key)));
                    String jwkString = JSONStringify(promise->globalObject(), jwk, 0);
                    CString jwkUTF8String = jwkString.utf8(StrictConversion);
                    bytes.append(std::span { jwkUTF8String.data(), jwkUTF8String.length() });
                }
                }

                auto callback = [index, weakThis](const Vector<uint8_t>& wrappedKey) mutable {
                    if (auto promise = getPromise(index, weakThis))
                        fulfillPromiseWithArrayBuffer(promise.releaseNonNull(), wrappedKey.data(), wrappedKey.size());
                };
                auto exceptionCallback = [index, weakThis](ExceptionCode ec) mutable {
                    if (auto promise = getPromise(index, weakThis))
                        rejectWithException(promise.releaseNonNull(), ec);
                };

                if (!isEncryption) {
                    // The 11 December 2014 version of the specification suggests we should perform the following task asynchronously:
                    // https://www.w3.org/TR/WebCryptoAPI/#SubtleCrypto-method-wrapKey
                    // It is not beneficial for less time consuming operations. Therefore, we perform it synchronously.
                    wrapAlgorithm->wrapKey(wrappingKey.get(), WTFMove(bytes), WTFMove(callback), WTFMove(exceptionCallback));
                    return;
                }
                // The following operation should be performed asynchronously.
                wrapAlgorithm->encrypt(*wrapParams, WTFMove(wrappingKey), WTFMove(bytes), WTFMove(callback), WTFMove(exceptionCallback), *context, workQueue);
            }
        }
    };
    auto exceptionCallback = [index, weakThis](ExceptionCode ec) mutable {
        if (auto promise = getPromise(index, weakThis))
            rejectWithException(promise.releaseNonNull(), ec);
    };

    // The following operation should be performed synchronously.
    exportAlgorithm->exportKey(format, key, WTFMove(callback), WTFMove(exceptionCallback));
}

void SubtleCrypto::unwrapKey(JSC::JSGlobalObject& state, KeyFormat format, BufferSource&& wrappedKeyBufferSource, CryptoKey& unwrappingKey, AlgorithmIdentifier&& unwrapAlgorithmIdentifier, AlgorithmIdentifier&& unwrappedKeyAlgorithmIdentifier, bool extractable, Vector<CryptoKeyUsage>&& keyUsages, Ref<DeferredPromise>&& promise)
{
    auto wrappedKey = copyToVector(WTFMove(wrappedKeyBufferSource));

    bool isDecryption = false;

    auto unwrapParamsOrException = normalizeCryptoAlgorithmParameters(state, unwrapAlgorithmIdentifier, Operations::UnwrapKey);
    if (unwrapParamsOrException.hasException()) {
        unwrapParamsOrException = normalizeCryptoAlgorithmParameters(state, unwrapAlgorithmIdentifier, Operations::Decrypt);
        if (unwrapParamsOrException.hasException()) {
            promise->reject(unwrapParamsOrException.releaseException());
            return;
        }

        isDecryption = true;
    }
    auto unwrapParams = unwrapParamsOrException.releaseReturnValue();

    auto unwrappedKeyAlgorithmOrException = normalizeCryptoAlgorithmParameters(state, unwrappedKeyAlgorithmIdentifier, Operations::ImportKey);
    if (unwrappedKeyAlgorithmOrException.hasException()) {
        promise->reject(unwrappedKeyAlgorithmOrException.releaseException());
        return;
    }
    auto unwrappedKeyAlgorithm = unwrappedKeyAlgorithmOrException.releaseReturnValue();

    auto keyUsagesBitmap = toCryptoKeyUsageBitmap(keyUsages);

    if (unwrapParams->identifier != unwrappingKey.algorithmIdentifier()) {
        promise->reject(InvalidAccessError, "Unwrapping CryptoKey doesn't match unwrap AlgorithmIdentifier"_s);
        return;
    }

    if (!unwrappingKey.allows(CryptoKeyUsageUnwrapKey)) {
        promise->reject(InvalidAccessError, "Unwrapping CryptoKey doesn't support unwrapKey operation"_s);
        return;
    }

    auto importAlgorithm = CryptoAlgorithmRegistry::singleton().create(unwrappedKeyAlgorithm->identifier);
    if (UNLIKELY(!importAlgorithm)) {
        promise->reject(Exception { NotSupportedError });
        return;
    }

    auto unwrapAlgorithm = CryptoAlgorithmRegistry::singleton().create(unwrappingKey.algorithmIdentifier());
    if (UNLIKELY(!unwrapAlgorithm)) {
        promise->reject(Exception { NotSupportedError });
        return;
    }

    auto index = promise.ptr();
    m_pendingPromises.add(index, WTFMove(promise));
    WeakPtr weakThis { *this };
    auto callback = [index, weakThis, format, importAlgorithm, unwrappedKeyAlgorithm = crossThreadCopyImportParams(*unwrappedKeyAlgorithm), extractable, keyUsagesBitmap](const Vector<uint8_t>& bytes) mutable {
        if (weakThis) {
            if (RefPtr promise = weakThis->m_pendingPromises.get(index)) {
                KeyData keyData;
                switch (format) {
                case SubtleCrypto::KeyFormat::Spki:
                case SubtleCrypto::KeyFormat::Pkcs8:
                case SubtleCrypto::KeyFormat::Raw:
                    keyData = bytes;
                    break;
                case SubtleCrypto::KeyFormat::Jwk: {
                    auto& state = *(promise->globalObject());
                    auto& vm = state.vm();
                    auto scope = DECLARE_THROW_SCOPE(vm);

                    String jwkString(std::span { bytes.data(), bytes.size() });
                    JSLockHolder locker(vm);
                    auto jwkObject = JSONParse(&state, jwkString);
                    if (!jwkObject) {
                        promise->reject(DataError, "WrappedKey cannot be converted to a JSON object"_s);
                        return;
                    }
                    auto jwk = convert<IDLDictionary<JsonWebKey>>(state, jwkObject);
                    RETURN_IF_EXCEPTION(scope, void());
                    normalizeJsonWebKey(jwk);

                    keyData = jwk;
                    break;
                }
                }

                auto callback = [index, weakThis](CryptoKey& key) mutable {
                    if (auto promise = getPromise(index, weakThis)) {
                        if ((key.type() == CryptoKeyType::Private || key.type() == CryptoKeyType::Secret) && !key.usagesBitmap()) {
                            rejectWithException(promise.releaseNonNull(), SyntaxError);
                            return;
                        }
                        promise->resolve<IDLInterface<CryptoKey>>(key);
                    }
                };
                auto exceptionCallback = [index, weakThis](ExceptionCode ec) mutable {
                    if (auto promise = getPromise(index, weakThis))
                        rejectWithException(promise.releaseNonNull(), ec);
                };

                // The following operation should be performed synchronously.
                importAlgorithm->importKey(format, WTFMove(keyData), *unwrappedKeyAlgorithm, extractable, keyUsagesBitmap, WTFMove(callback), WTFMove(exceptionCallback));
            }
        }
    };
    auto exceptionCallback = [index, weakThis](ExceptionCode ec) mutable {
        if (auto promise = getPromise(index, weakThis))
            rejectWithException(promise.releaseNonNull(), ec);
    };

    if (!isDecryption) {
        // The 11 December 2014 version of the specification suggests we should perform the following task asynchronously:
        // https://www.w3.org/TR/WebCryptoAPI/#SubtleCrypto-method-unwrapKey
        // It is not beneficial for less time consuming operations. Therefore, we perform it synchronously.
        unwrapAlgorithm->unwrapKey(unwrappingKey, WTFMove(wrappedKey), WTFMove(callback), WTFMove(exceptionCallback));
        return;
    }

    unwrapAlgorithm->decrypt(*unwrapParams, unwrappingKey, WTFMove(wrappedKey), WTFMove(callback), WTFMove(exceptionCallback), *scriptExecutionContext(), m_workQueue);
}

}

#endif
