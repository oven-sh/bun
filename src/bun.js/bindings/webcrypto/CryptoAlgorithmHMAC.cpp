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
    return usages & (CryptoKeyUsageEncrypt | CryptoKeyUsageDecrypt | CryptoKeyUsageDeriveKey | CryptoKeyUsageDeriveBits | CryptoKeyUsageWrapKey | CryptoKeyUsageUnwrapKey);
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
        exceptionCallback(SyntaxError, ""_s);
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
        exceptionCallback(SyntaxError, ""_s);
        return;
    }

    RefPtr<CryptoKeyHMAC> result;
    switch (format) {
    case CryptoKeyFormat::Raw:
        result = CryptoKeyHMAC::importRaw(hmacParameters.length.value_or(0), hmacParameters.hashIdentifier, WTF::move(std::get<Vector<uint8_t>>(data)), extractable, usages);
        break;
    case CryptoKeyFormat::Jwk: {
        auto checkAlgCallback = [](CryptoAlgorithmIdentifier hash, const String& alg) -> bool {
            switch (hash) {
            case CryptoAlgorithmIdentifier::SHA_1:
                return alg.isNull() || alg == ALG1;
            case CryptoAlgorithmIdentifier::SHA_224:
                return alg.isNull() || alg == ALG224;
            case CryptoAlgorithmIdentifier::SHA_256:
                return alg.isNull() || alg == ALG256;
            case CryptoAlgorithmIdentifier::SHA_384:
                return alg.isNull() || alg == ALG384;
            case CryptoAlgorithmIdentifier::SHA_512:
                return alg.isNull() || alg == ALG512;
            default:
                return false;
            }
            return false;
        };
        result = CryptoKeyHMAC::importJwk(hmacParameters.length.value_or(0), hmacParameters.hashIdentifier, WTF::move(std::get<JsonWebKey>(data)), extractable, usages, WTF::move(checkAlgCallback));
        break;
    }
    default:
        exceptionCallback(NotSupportedError, ""_s);
        return;
    }
    if (!result) {
        exceptionCallback(DataError, ""_s);
        return;
    }

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

ExceptionOr<size_t> CryptoAlgorithmHMAC::getKeyLength(const CryptoAlgorithmParameters& parameters)
{
    return CryptoKeyHMAC::getKeyLength(parameters);
}

}

#endif // ENABLE(WEB_CRYPTO)
