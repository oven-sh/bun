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
#include "CryptoAlgorithmRSA_OAEP.h"

#if ENABLE(WEB_CRYPTO)

#include "CryptoAlgorithmRsaHashedImportParams.h"
#include "CryptoAlgorithmRsaHashedKeyGenParams.h"
#include "CryptoAlgorithmRsaOaepParams.h"
#include "CryptoKeyPair.h"
#include "CryptoKeyRSA.h"
#include <variant>
#include <wtf/CrossThreadCopier.h>

namespace WebCore {

namespace CryptoAlgorithmRSA_OAEPInternal {
static constexpr auto ALG1 = "RSA-OAEP"_s;
static constexpr auto ALG224 = "RSA-OAEP-224"_s;
static constexpr auto ALG256 = "RSA-OAEP-256"_s;
static constexpr auto ALG384 = "RSA-OAEP-384"_s;
static constexpr auto ALG512 = "RSA-OAEP-512"_s;
}

Ref<CryptoAlgorithm> CryptoAlgorithmRSA_OAEP::create()
{
    return adoptRef(*new CryptoAlgorithmRSA_OAEP);
}

CryptoAlgorithmIdentifier CryptoAlgorithmRSA_OAEP::identifier() const
{
    return s_identifier;
}

void CryptoAlgorithmRSA_OAEP::encrypt(const CryptoAlgorithmParameters& parameters, Ref<CryptoKey>&& key, Vector<uint8_t>&& plainText, VectorCallback&& callback, ExceptionCallback&& exceptionCallback, ScriptExecutionContext& context, WorkQueue& workQueue)
{
    if (key->type() != CryptoKeyType::Public) {
        exceptionCallback(InvalidAccessError);
        return;
    }

    dispatchOperationInWorkQueue(workQueue, context, WTFMove(callback), WTFMove(exceptionCallback),
        [parameters = crossThreadCopy(downcast<CryptoAlgorithmRsaOaepParams>(parameters)), key = WTFMove(key), plainText = WTFMove(plainText)] {
            return platformEncrypt(parameters, downcast<CryptoKeyRSA>(key.get()), plainText);
        });
}

void CryptoAlgorithmRSA_OAEP::decrypt(const CryptoAlgorithmParameters& parameters, Ref<CryptoKey>&& key, Vector<uint8_t>&& cipherText, VectorCallback&& callback, ExceptionCallback&& exceptionCallback, ScriptExecutionContext& context, WorkQueue& workQueue)
{
    if (key->type() != CryptoKeyType::Private) {
        exceptionCallback(InvalidAccessError);
        return;
    }

    dispatchOperationInWorkQueue(workQueue, context, WTFMove(callback), WTFMove(exceptionCallback),
        [parameters = crossThreadCopy(downcast<CryptoAlgorithmRsaOaepParams>(parameters)), key = WTFMove(key), cipherText = WTFMove(cipherText)] {
            return platformDecrypt(parameters, downcast<CryptoKeyRSA>(key.get()), cipherText);
        });
}

void CryptoAlgorithmRSA_OAEP::generateKey(const CryptoAlgorithmParameters& parameters, bool extractable, CryptoKeyUsageBitmap usages, KeyOrKeyPairCallback&& callback, ExceptionCallback&& exceptionCallback, ScriptExecutionContext& context)
{
    const auto& rsaParameters = downcast<CryptoAlgorithmRsaHashedKeyGenParams>(parameters);

    if (usages & (CryptoKeyUsageSign | CryptoKeyUsageVerify | CryptoKeyUsageDeriveKey | CryptoKeyUsageDeriveBits)) {
        exceptionCallback(SyntaxError);
        return;
    }

    auto keyPairCallback = [capturedCallback = WTFMove(callback)](CryptoKeyPair&& pair) {
        pair.publicKey->setUsagesBitmap(pair.publicKey->usagesBitmap() & (CryptoKeyUsageEncrypt | CryptoKeyUsageWrapKey));
        pair.privateKey->setUsagesBitmap(pair.privateKey->usagesBitmap() & (CryptoKeyUsageDecrypt | CryptoKeyUsageUnwrapKey));
        capturedCallback(WTFMove(pair));
    };
    auto failureCallback = [capturedCallback = WTFMove(exceptionCallback)]() {
        capturedCallback(OperationError);
    };
    CryptoKeyRSA::generatePair(CryptoAlgorithmIdentifier::RSA_OAEP, rsaParameters.hashIdentifier, true, rsaParameters.modulusLength, rsaParameters.publicExponentVector(), extractable, usages, WTFMove(keyPairCallback), WTFMove(failureCallback), &context);
}

void CryptoAlgorithmRSA_OAEP::importKey(CryptoKeyFormat format, KeyData&& data, const CryptoAlgorithmParameters& parameters, bool extractable, CryptoKeyUsageBitmap usages, KeyCallback&& callback, ExceptionCallback&& exceptionCallback)
{
    using namespace CryptoAlgorithmRSA_OAEPInternal;

    const auto& rsaParameters = downcast<CryptoAlgorithmRsaHashedImportParams>(parameters);

    RefPtr<CryptoKeyRSA> result;
    switch (format) {
    case CryptoKeyFormat::Jwk: {
        JsonWebKey key = WTFMove(std::get<JsonWebKey>(data));

        bool isUsagesAllowed = false;
        if (!key.d.isNull()) {
            isUsagesAllowed = isUsagesAllowed || !(usages ^ CryptoKeyUsageDecrypt);
            isUsagesAllowed = isUsagesAllowed || !(usages ^ CryptoKeyUsageUnwrapKey);
            isUsagesAllowed = isUsagesAllowed || !(usages ^ (CryptoKeyUsageDecrypt | CryptoKeyUsageUnwrapKey));
        } else {
            isUsagesAllowed = isUsagesAllowed || !(usages ^ CryptoKeyUsageEncrypt);
            isUsagesAllowed = isUsagesAllowed || !(usages ^ CryptoKeyUsageWrapKey);
            isUsagesAllowed = isUsagesAllowed || !(usages ^ (CryptoKeyUsageEncrypt | CryptoKeyUsageWrapKey));
        }
        isUsagesAllowed = isUsagesAllowed || !usages;
        if (!isUsagesAllowed) {
            exceptionCallback(SyntaxError);
            return;
        }

        if (usages && !key.use.isNull() && key.use != "enc"_s) {
            exceptionCallback(DataError);
            return;
        }

        bool isMatched = false;
        switch (rsaParameters.hashIdentifier) {
        case CryptoAlgorithmIdentifier::SHA_1:
            isMatched = key.alg.isNull() || key.alg == ALG1;
            break;
        case CryptoAlgorithmIdentifier::SHA_224:
            isMatched = key.alg.isNull() || key.alg == ALG224;
            break;
        case CryptoAlgorithmIdentifier::SHA_256:
            isMatched = key.alg.isNull() || key.alg == ALG256;
            break;
        case CryptoAlgorithmIdentifier::SHA_384:
            isMatched = key.alg.isNull() || key.alg == ALG384;
            break;
        case CryptoAlgorithmIdentifier::SHA_512:
            isMatched = key.alg.isNull() || key.alg == ALG512;
            break;
        default:
            break;
        }
        if (!isMatched) {
            exceptionCallback(DataError);
            return;
        }

        result = CryptoKeyRSA::importJwk(rsaParameters.identifier, rsaParameters.hashIdentifier, WTFMove(key), extractable, usages);
        break;
    }
    case CryptoKeyFormat::Spki: {
        if (usages && (usages ^ CryptoKeyUsageEncrypt) && (usages ^ CryptoKeyUsageWrapKey) && (usages ^ (CryptoKeyUsageEncrypt | CryptoKeyUsageWrapKey))) {
            exceptionCallback(SyntaxError);
            return;
        }
        // FIXME: <webkit.org/b/165436>
        result = CryptoKeyRSA::importSpki(rsaParameters.identifier, rsaParameters.hashIdentifier, WTFMove(std::get<Vector<uint8_t>>(data)), extractable, usages);
        break;
    }
    case CryptoKeyFormat::Pkcs8: {
        if (usages && (usages ^ CryptoKeyUsageDecrypt) && (usages ^ CryptoKeyUsageUnwrapKey) && (usages ^ (CryptoKeyUsageDecrypt | CryptoKeyUsageUnwrapKey))) {
            exceptionCallback(SyntaxError);
            return;
        }
        // FIXME: <webkit.org/b/165436>
        result = CryptoKeyRSA::importPkcs8(parameters.identifier, rsaParameters.hashIdentifier, WTFMove(std::get<Vector<uint8_t>>(data)), extractable, usages);
        break;
    }
    default:
        exceptionCallback(NotSupportedError);
        return;
    }
    if (!result) {
        exceptionCallback(DataError);
        return;
    }

    callback(*result);
}

void CryptoAlgorithmRSA_OAEP::exportKey(CryptoKeyFormat format, Ref<CryptoKey>&& key, KeyDataCallback&& callback, ExceptionCallback&& exceptionCallback)
{
    using namespace CryptoAlgorithmRSA_OAEPInternal;
    const auto& rsaKey = downcast<CryptoKeyRSA>(key.get());

    if (!rsaKey.keySizeInBits()) {
        exceptionCallback(OperationError);
        return;
    }

    KeyData result;
    switch (format) {
    case CryptoKeyFormat::Jwk: {
        JsonWebKey jwk = rsaKey.exportJwk();
        switch (rsaKey.hashAlgorithmIdentifier()) {
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
        result = WTFMove(jwk);
        break;
    }
    case CryptoKeyFormat::Spki: {
        // FIXME: <webkit.org/b/165437>
        auto spki = rsaKey.exportSpki();
        if (spki.hasException()) {
            exceptionCallback(spki.releaseException().code());
            return;
        }
        result = spki.releaseReturnValue();
        break;
    }
    case CryptoKeyFormat::Pkcs8: {
        // FIXME: <webkit.org/b/165437>
        auto pkcs8 = rsaKey.exportPkcs8();
        if (pkcs8.hasException()) {
            exceptionCallback(pkcs8.releaseException().code());
            return;
        }
        result = pkcs8.releaseReturnValue();
        break;
    }
    default:
        exceptionCallback(NotSupportedError);
        return;
    }

    callback(format, WTFMove(result));
}

}

#endif // ENABLE(WEB_CRYPTO)
