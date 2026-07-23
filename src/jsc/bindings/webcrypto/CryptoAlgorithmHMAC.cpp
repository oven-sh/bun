/*
 * Copyright (C) 2013 Apple Inc. All rights reserved.
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
#include "CryptoAlgorithmHMAC.h"

#if ENABLE(WEB_CRYPTO)

#include "CryptoAlgorithmHmacKeyParams.h"
#include "CryptoKeyHMAC.h"
#include <variant>
#include <wtf/text/Base64.h>

namespace WebCore {

namespace CryptoAlgorithmHMACInternal {
static constexpr auto ALG1 = "HS1"_s;
static constexpr auto ALG224 = "HS224"_s;
static constexpr auto ALG256 = "HS256"_s;
static constexpr auto ALG384 = "HS384"_s;
static constexpr auto ALG512 = "HS512"_s;
}

static inline bool usagesAreInvalidForCryptoAlgorithmHMAC(CryptoKeyUsageBitmap usages)
{
    return usages & (CryptoKeyUsageEncrypt | CryptoKeyUsageDecrypt | CryptoKeyUsageDeriveKey | CryptoKeyUsageDeriveBits | CryptoKeyUsageWrapKey | CryptoKeyUsageUnwrapKey | CryptoKeyUsageKemMask);
}

Ref<CryptoAlgorithm> CryptoAlgorithmHMAC::create()
{
    return adoptRef(*new CryptoAlgorithmHMAC);
}

CryptoAlgorithmIdentifier CryptoAlgorithmHMAC::identifier() const
{
    return s_identifier;
}

void CryptoAlgorithmHMAC::sign(const CryptoAlgorithmParameters&, Ref<CryptoKey>&& key, Vector<uint8_t>&& data, VectorCallback&& callback, ExceptionCallback&& exceptionCallback, ScriptExecutionContext& context, WorkQueue& workQueue)
{
    dispatchOperationInWorkQueue(workQueue, context, WTF::move(callback), WTF::move(exceptionCallback),
        [key = WTF::move(key), data = WTF::move(data)] {
            return platformSign(downcast<CryptoKeyHMAC>(key.get()), data);
        });
}

void CryptoAlgorithmHMAC::verify(const CryptoAlgorithmParameters&, Ref<CryptoKey>&& key, Vector<uint8_t>&& signature, Vector<uint8_t>&& data, BoolCallback&& callback, ExceptionCallback&& exceptionCallback, ScriptExecutionContext& context, WorkQueue& workQueue)
{
    dispatchOperationInWorkQueue(workQueue, context, WTF::move(callback), WTF::move(exceptionCallback),
        [key = WTF::move(key), signature = WTF::move(signature), data = WTF::move(data)] {
            return platformVerify(downcast<CryptoKeyHMAC>(key.get()), signature, data);
        });
}

void CryptoAlgorithmHMAC::generateKey(const CryptoAlgorithmParameters& parameters, bool extractable, CryptoKeyUsageBitmap usages, KeyOrKeyPairCallback&& callback, ExceptionCallback&& exceptionCallback, ScriptExecutionContext&)
{
    const auto& hmacParameters = downcast<CryptoAlgorithmHmacKeyParams>(parameters);

    if (usagesAreInvalidForCryptoAlgorithmHMAC(usages)) {
        exceptionCallback(SyntaxError, "Unsupported key usage for an HMAC key"_s);
        return;
    }

    if (hmacParameters.length && !hmacParameters.length.value()) {
        exceptionCallback(OperationError, ""_s);
        return;
    }

    auto result = CryptoKeyHMAC::generate(hmacParameters.length.value_or(0), hmacParameters.hashIdentifier, extractable, usages);
    if (!result) {
        exceptionCallback(OperationError, ""_s);
        return;
    }

    callback(WTF::move(result));
}

void CryptoAlgorithmHMAC::importKey(CryptoKeyFormat format, KeyData&& data, const CryptoAlgorithmParameters& parameters, bool extractable, CryptoKeyUsageBitmap usages, KeyCallback&& callback, ExceptionCallback&& exceptionCallback)
{
    using namespace CryptoAlgorithmHMACInternal;

    const auto& hmacParameters = downcast<CryptoAlgorithmHmacKeyParams>(parameters);

    if (usagesAreInvalidForCryptoAlgorithmHMAC(usages)) {
        // Node's import-path wording drops the article.
        exceptionCallback(SyntaxError, "Unsupported key usage for HMAC key"_s);
        return;
    }

    // Node validates HmacImportParams.length in its WebIDL converter.
    if (hmacParameters.length && !*hmacParameters.length) {
        exceptionCallback(DataError, "HmacImportParams.length cannot be 0"_s);
        return;
    }
    if (hmacParameters.length && *hmacParameters.length % 8) {
        exceptionCallback(NotSupportedError, "Unsupported HmacImportParams.length"_s);
        return;
    }

    RefPtr<CryptoKeyHMAC> result;
    switch (format) {
    case CryptoKeyFormat::RawSecret:
    case CryptoKeyFormat::Raw: {
        auto& keyData = std::get<Vector<uint8_t>>(data);
        if (keyData.isEmpty()) {
            exceptionCallback(DataError, "Zero-length key is not supported"_s);
            return;
        }
        if (hmacParameters.length && *hmacParameters.length != keyData.size() * 8) {
            exceptionCallback(DataError, "Invalid key length"_s);
            return;
        }
        result = CryptoKeyHMAC::importRaw(hmacParameters.length.value_or(0), hmacParameters.hashIdentifier, WTF::move(keyData), extractable, usages);
        break;
    }
    case CryptoKeyFormat::Jwk: {
        // Only reached with a non-null alg (the import arm checks first);
        // no JWK alg spelling exists for the SHA3 hashes, so they fall
        // through to the mismatch default.
        auto checkAlgCallback = [](CryptoAlgorithmIdentifier hash, const String& alg) -> bool {
            switch (hash) {
            case CryptoAlgorithmIdentifier::SHA_1:
                return alg == ALG1;
            case CryptoAlgorithmIdentifier::SHA_224:
                return alg == ALG224;
            case CryptoAlgorithmIdentifier::SHA_256:
                return alg == ALG256;
            case CryptoAlgorithmIdentifier::SHA_384:
                return alg == ALG384;
            case CryptoAlgorithmIdentifier::SHA_512:
                return alg == ALG512;
            default:
                return false;
            }
        };
        auto& jwk = std::get<JsonWebKey>(data);
        if (jwk.kty.isNull()) {
            exceptionCallback(DataError, "Invalid keyData"_s);
            return;
        }
        if (jwk.kty != "oct"_s) {
            exceptionCallback(DataError, "Invalid JWK \"kty\" Parameter"_s);
            return;
        }
        if (jwk.k.isNull()) {
            exceptionCallback(DataError, "Invalid keyData"_s);
            return;
        }
        // Node validates use/key_ops/ext before alg and the decoded key
        // (verified against v26.3.0: a bad "use" wins over a bad "alg",
        // a bad key, or a length mismatch).
        if (usages && !jwk.use.isNull() && jwk.use != "sig"_s) {
            exceptionCallback(DataError, "Invalid JWK \"use\" Parameter"_s);
            return;
        }
        if (jwk.key_ops && ((jwk.usages & usages) != usages)) {
            exceptionCallback(DataError, "Key operations and usage mismatch"_s);
            return;
        }
        if (jwk.ext && !jwk.ext.value() && extractable) {
            exceptionCallback(DataError, "JWK \"ext\" Parameter and extractable mismatch"_s);
            return;
        }
        if (!jwk.alg.isNull() && !checkAlgCallback(hmacParameters.hashIdentifier, jwk.alg)) {
            exceptionCallback(DataError, "JWK \"alg\" does not match the requested algorithm"_s);
            return;
        }
        // Node checks the decoded key's length for every format; its lenient
        // base64url decode turns invalid input into an empty key.
        auto keyBytes = base64URLDecode(jwk.k);
        if (!keyBytes || keyBytes->isEmpty()) {
            exceptionCallback(DataError, "Zero-length key is not supported"_s);
            return;
        }
        if (hmacParameters.length && *hmacParameters.length != keyBytes->size() * 8) {
            exceptionCallback(DataError, "Invalid key length"_s);
            return;
        }
        result = CryptoKeyHMAC::importRaw(hmacParameters.length.value_or(0), hmacParameters.hashIdentifier, WTF::move(*keyBytes), extractable, usages);
        break;
    }
    default:
        exceptionCallback(NotSupportedError, ""_s);
        return;
    }
    // Both importRaw nullptr conditions (empty key, length mismatch) are
    // rejected with specific errors in the format arms above.
    ASSERT(result);
    callback(*result);
}

void CryptoAlgorithmHMAC::exportKey(CryptoKeyFormat format, Ref<CryptoKey>&& key, KeyDataCallback&& callback, ExceptionCallback&& exceptionCallback)
{
    using namespace CryptoAlgorithmHMACInternal;
    const auto& hmacKey = downcast<CryptoKeyHMAC>(key.get());

    if (hmacKey.key().isEmpty()) {
        exceptionCallback(OperationError, ""_s);
        return;
    }

    KeyData result;
    switch (format) {
    case CryptoKeyFormat::RawSecret:
    case CryptoKeyFormat::Raw:
        result = Vector<uint8_t>(hmacKey.key());
        break;
    case CryptoKeyFormat::Jwk: {
        JsonWebKey jwk = hmacKey.exportJwk();
        switch (hmacKey.hashAlgorithmIdentifier()) {
        case CryptoAlgorithmIdentifier::SHA_1:
            jwk.alg = String(ALG1);
            break;
        case CryptoAlgorithmIdentifier::SHA_224:
            jwk.alg = String(ALG224);
            break;
        case CryptoAlgorithmIdentifier::SHA_256:
            jwk.alg = String(ALG256);
            break;
        case CryptoAlgorithmIdentifier::SHA_384:
            jwk.alg = String(ALG384);
            break;
        case CryptoAlgorithmIdentifier::SHA_512:
            jwk.alg = String(ALG512);
            break;
        case CryptoAlgorithmIdentifier::SHA3_256:
        case CryptoAlgorithmIdentifier::SHA3_384:
        case CryptoAlgorithmIdentifier::SHA3_512:
            break;
        default:
            ASSERT_NOT_REACHED();
        }
        result = WTF::move(jwk);
        break;
    }
    default:
        exceptionCallback(NotSupportedError, ""_s);
        return;
    }

    callback(format, WTF::move(result));
}

ExceptionOr<std::optional<size_t>> CryptoAlgorithmHMAC::getKeyLength(const CryptoAlgorithmParameters& parameters)
{
    return CryptoKeyHMAC::getKeyLength(parameters);
}

}

#endif // ENABLE(WEB_CRYPTO)
