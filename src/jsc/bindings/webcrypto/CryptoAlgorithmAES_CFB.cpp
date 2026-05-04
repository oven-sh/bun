/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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
#include "CryptoAlgorithmAES_CFB.h"

#if ENABLE(WEB_CRYPTO)

#include "CryptoAlgorithmAesCbcCfbParams.h"
#include "CryptoAlgorithmAesKeyParams.h"
#include "CryptoKeyAES.h"
#include <wtf/CrossThreadCopier.h>

namespace WebCore {

namespace CryptoAlgorithmAES_CFBInternal {
static constexpr auto ALG128 = "A128CFB8"_s;
static constexpr auto ALG192 = "A192CFB8"_s;
static constexpr auto ALG256 = "A256CFB8"_s;
static const size_t IVSIZE = 16;
}

static inline bool usagesAreInvalidForCryptoAlgorithmAES_CFB(CryptoKeyUsageBitmap usages)
{
    return usages & (CryptoKeyUsageSign | CryptoKeyUsageVerify | CryptoKeyUsageDeriveKey | CryptoKeyUsageDeriveBits);
}

Ref<CryptoAlgorithm> CryptoAlgorithmAES_CFB::create()
{
    return adoptRef(*new CryptoAlgorithmAES_CFB);
}

CryptoAlgorithmIdentifier CryptoAlgorithmAES_CFB::identifier() const
{
    return s_identifier;
}

void CryptoAlgorithmAES_CFB::encrypt(const CryptoAlgorithmParameters& parameters, Ref<CryptoKey>&& key, Vector<uint8_t>&& plainText, VectorCallback&& callback, ExceptionCallback&& exceptionCallback, ScriptExecutionContext& context, WorkQueue& workQueue)
{
    using namespace CryptoAlgorithmAES_CFBInternal;

    auto& aesParameters = downcast<CryptoAlgorithmAesCbcCfbParams>(parameters);
    if (aesParameters.ivVector().size() != IVSIZE) {
        exceptionCallback(OperationError, "algorithm.iv must contain exactly 16 bytes"_s);
        return;
    }

    dispatchOperationInWorkQueue(workQueue, context, WTF::move(callback), WTF::move(exceptionCallback),
        [parameters = crossThreadCopy(aesParameters), key = WTF::move(key), plainText = WTF::move(plainText)] {
            return platformEncrypt(parameters, downcast<CryptoKeyAES>(key.get()), plainText);
        });
}

void CryptoAlgorithmAES_CFB::decrypt(const CryptoAlgorithmParameters& parameters, Ref<CryptoKey>&& key, Vector<uint8_t>&& cipherText, VectorCallback&& callback, ExceptionCallback&& exceptionCallback, ScriptExecutionContext& context, WorkQueue& workQueue)
{
    using namespace CryptoAlgorithmAES_CFBInternal;

    auto& aesParameters = downcast<CryptoAlgorithmAesCbcCfbParams>(parameters);
    if (aesParameters.ivVector().size() != IVSIZE) {
        exceptionCallback(OperationError, "algorithm.iv must contain exactly 16 bytes"_s);
        return;
    }

    dispatchOperationInWorkQueue(workQueue, context, WTF::move(callback), WTF::move(exceptionCallback),
        [parameters = crossThreadCopy(aesParameters), key = WTF::move(key), cipherText = WTF::move(cipherText)] {
            return platformDecrypt(parameters, downcast<CryptoKeyAES>(key.get()), cipherText);
        });
}

void CryptoAlgorithmAES_CFB::generateKey(const CryptoAlgorithmParameters& parameters, bool extractable, CryptoKeyUsageBitmap usages, KeyOrKeyPairCallback&& callback, ExceptionCallback&& exceptionCallback, ScriptExecutionContext&)
{
    const auto& aesParameters = downcast<CryptoAlgorithmAesKeyParams>(parameters);

    if (usagesAreInvalidForCryptoAlgorithmAES_CFB(usages)) {
        exceptionCallback(SyntaxError, ""_s);
        return;
    }

    auto result = CryptoKeyAES::generate(CryptoAlgorithmIdentifier::AES_CFB, aesParameters.length, extractable, usages);
    if (!result) {
        exceptionCallback(OperationError, ""_s);
        return;
    }

    callback(WTF::move(result));
}

void CryptoAlgorithmAES_CFB::importKey(CryptoKeyFormat format, KeyData&& data, const CryptoAlgorithmParameters& parameters, bool extractable, CryptoKeyUsageBitmap usages, KeyCallback&& callback, ExceptionCallback&& exceptionCallback)
{
    using namespace CryptoAlgorithmAES_CFBInternal;

    if (usagesAreInvalidForCryptoAlgorithmAES_CFB(usages)) {
        exceptionCallback(SyntaxError, ""_s);
        return;
    }

    RefPtr<CryptoKeyAES> result;
    switch (format) {
    case CryptoKeyFormat::Raw:
        result = CryptoKeyAES::importRaw(parameters.identifier, WTF::move(std::get<Vector<uint8_t>>(data)), extractable, usages);
        break;
    case CryptoKeyFormat::Jwk: {
        auto checkAlgCallback = [](size_t length, const String& alg) -> bool {
            switch (length) {
            case CryptoKeyAES::s_length128:
                return alg.isNull() || alg == ALG128;
            case CryptoKeyAES::s_length192:
                return alg.isNull() || alg == ALG192;
            case CryptoKeyAES::s_length256:
                return alg.isNull() || alg == ALG256;
            }
            return false;
        };
        result = CryptoKeyAES::importJwk(parameters.identifier, WTF::move(std::get<JsonWebKey>(data)), extractable, usages, WTF::move(checkAlgCallback));
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

void CryptoAlgorithmAES_CFB::exportKey(CryptoKeyFormat format, Ref<CryptoKey>&& key, KeyDataCallback&& callback, ExceptionCallback&& exceptionCallback)
{
    using namespace CryptoAlgorithmAES_CFBInternal;
    const auto& aesKey = downcast<CryptoKeyAES>(key.get());

    if (aesKey.key().isEmpty()) {
        exceptionCallback(OperationError, ""_s);
        return;
    }

    KeyData result;
    switch (format) {
    case CryptoKeyFormat::Raw:
        result = Vector<uint8_t>(aesKey.key());
        break;
    case CryptoKeyFormat::Jwk: {
        JsonWebKey jwk = aesKey.exportJwk();
        switch (aesKey.key().size() * 8) {
        case CryptoKeyAES::s_length128:
            jwk.alg = String(ALG128);
            break;
        case CryptoKeyAES::s_length192:
            jwk.alg = String(ALG192);
            break;
        case CryptoKeyAES::s_length256:
            jwk.alg = String(ALG256);
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

ExceptionOr<size_t> CryptoAlgorithmAES_CFB::getKeyLength(const CryptoAlgorithmParameters& parameters)
{
    return CryptoKeyAES::getKeyLength(parameters);
}

}

#endif // ENABLE(WEB_CRYPTO)
