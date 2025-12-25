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
#include "CryptoAlgorithmRSAES_PKCS1_v1_5.h"

#if ENABLE(WEB_CRYPTO)

#include "CryptoAlgorithmRsaKeyGenParams.h"
#include "CryptoKeyPair.h"
#include "CryptoKeyRSA.h"
#include <variant>

namespace WebCore {

static constexpr auto ALG = "RSA1_5"_s;

Ref<CryptoAlgorithm> CryptoAlgorithmRSAES_PKCS1_v1_5::create()
{
    return adoptRef(*new CryptoAlgorithmRSAES_PKCS1_v1_5);
}

CryptoAlgorithmIdentifier CryptoAlgorithmRSAES_PKCS1_v1_5::identifier() const
{
    return s_identifier;
}

void CryptoAlgorithmRSAES_PKCS1_v1_5::encrypt(const CryptoAlgorithmParameters&, Ref<CryptoKey>&& key, Vector<uint8_t>&& plainText, VectorCallback&& callback, ExceptionCallback&& exceptionCallback, ScriptExecutionContext& context, WorkQueue& workQueue)
{
    if (key->type() != CryptoKeyType::Public) {
        exceptionCallback(InvalidAccessError, ""_s);
        return;
    }

    dispatchOperationInWorkQueue(workQueue, context, WTF::move(callback), WTF::move(exceptionCallback),
        [key = WTF::move(key), plainText = WTF::move(plainText)] {
            return platformEncrypt(downcast<CryptoKeyRSA>(key.get()), plainText);
        });
}

void CryptoAlgorithmRSAES_PKCS1_v1_5::decrypt(const CryptoAlgorithmParameters&, Ref<CryptoKey>&& key, Vector<uint8_t>&& cipherText, VectorCallback&& callback, ExceptionCallback&& exceptionCallback, ScriptExecutionContext& context, WorkQueue& workQueue)
{
    if (key->type() != CryptoKeyType::Private) {
        exceptionCallback(InvalidAccessError, ""_s);
        return;
    }

    dispatchOperationInWorkQueue(workQueue, context, WTF::move(callback), WTF::move(exceptionCallback),
        [key = WTF::move(key), cipherText = WTF::move(cipherText)] {
            return platformDecrypt(downcast<CryptoKeyRSA>(key.get()), cipherText);
        });
}

void CryptoAlgorithmRSAES_PKCS1_v1_5::generateKey(const CryptoAlgorithmParameters& parameters, bool extractable, CryptoKeyUsageBitmap usages, KeyOrKeyPairCallback&& callback, ExceptionCallback&& exceptionCallback, ScriptExecutionContext& context)
{
    const auto& rsaParameters = downcast<CryptoAlgorithmRsaKeyGenParams>(parameters);

    if (usages & (CryptoKeyUsageSign | CryptoKeyUsageVerify | CryptoKeyUsageDeriveKey | CryptoKeyUsageDeriveBits | CryptoKeyUsageWrapKey | CryptoKeyUsageUnwrapKey)) {
        exceptionCallback(SyntaxError, ""_s);
        return;
    }

    auto keyPairCallback = [capturedCallback = WTF::move(callback)](CryptoKeyPair&& pair) {
        pair.publicKey->setUsagesBitmap(pair.publicKey->usagesBitmap() & CryptoKeyUsageEncrypt);
        pair.privateKey->setUsagesBitmap(pair.privateKey->usagesBitmap() & CryptoKeyUsageDecrypt);
        capturedCallback(WTF::move(pair));
    };
    auto failureCallback = [capturedCallback = WTF::move(exceptionCallback)]() {
        capturedCallback(OperationError, ""_s);
    };
    // Notice: CryptoAlgorithmIdentifier::SHA_1 is just a placeholder. It should not have any effect.
    CryptoKeyRSA::generatePair(CryptoAlgorithmIdentifier::RSAES_PKCS1_v1_5, CryptoAlgorithmIdentifier::SHA_1, false, rsaParameters.modulusLength, rsaParameters.publicExponentVector(), extractable, usages, WTF::move(keyPairCallback), WTF::move(failureCallback), &context);
}

void CryptoAlgorithmRSAES_PKCS1_v1_5::importKey(CryptoKeyFormat format, KeyData&& data, const CryptoAlgorithmParameters& parameters, bool extractable, CryptoKeyUsageBitmap usages, KeyCallback&& callback, ExceptionCallback&& exceptionCallback)
{
    RefPtr<CryptoKeyRSA> result;
    switch (format) {
    case CryptoKeyFormat::Jwk: {
        JsonWebKey key = WTF::move(std::get<JsonWebKey>(data));
        if (usages && ((!key.d.isNull() && (usages ^ CryptoKeyUsageDecrypt)) || (key.d.isNull() && (usages ^ CryptoKeyUsageEncrypt)))) {
            exceptionCallback(SyntaxError, ""_s);
            return;
        }
        if (usages && !key.use.isNull() && key.use != "enc"_s) {
            exceptionCallback(DataError, ""_s);
            return;
        }
        if (!key.alg.isNull() && key.alg != ALG) {
            exceptionCallback(DataError, ""_s);
            return;
        }
        result = CryptoKeyRSA::importJwk(parameters.identifier, std::nullopt, WTF::move(key), extractable, usages);
        break;
    }
    case CryptoKeyFormat::Spki: {
        if (usages && (usages ^ CryptoKeyUsageEncrypt)) {
            exceptionCallback(SyntaxError, ""_s);
            return;
        }
        result = CryptoKeyRSA::importSpki(parameters.identifier, std::nullopt, WTF::move(std::get<Vector<uint8_t>>(data)), extractable, usages);
        break;
    }
    case CryptoKeyFormat::Pkcs8: {
        if (usages && (usages ^ CryptoKeyUsageDecrypt)) {
            exceptionCallback(SyntaxError, ""_s);
            return;
        }
        result = CryptoKeyRSA::importPkcs8(parameters.identifier, std::nullopt, WTF::move(std::get<Vector<uint8_t>>(data)), extractable, usages);
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

void CryptoAlgorithmRSAES_PKCS1_v1_5::exportKey(CryptoKeyFormat format, Ref<CryptoKey>&& key, KeyDataCallback&& callback, ExceptionCallback&& exceptionCallback)
{
    const auto& rsaKey = downcast<CryptoKeyRSA>(key.get());

    if (!rsaKey.keySizeInBits()) {
        exceptionCallback(OperationError, ""_s);
        return;
    }

    KeyData result;
    switch (format) {
    case CryptoKeyFormat::Jwk: {
        JsonWebKey jwk = rsaKey.exportJwk();
        jwk.alg = String(ALG);
        result = WTF::move(jwk);
        break;
    }
    case CryptoKeyFormat::Spki: {
        auto spki = rsaKey.exportSpki();
        if (spki.hasException()) {
            exceptionCallback(spki.releaseException().code(), ""_s);
            return;
        }
        result = spki.releaseReturnValue();
        break;
    }
    case CryptoKeyFormat::Pkcs8: {
        auto pkcs8 = rsaKey.exportPkcs8();
        if (pkcs8.hasException()) {
            exceptionCallback(pkcs8.releaseException().code(), ""_s);
            return;
        }
        result = pkcs8.releaseReturnValue();
        break;
    }
    default:
        exceptionCallback(NotSupportedError, ""_s);
        return;
    }

    callback(format, WTF::move(result));
}

}

#endif // ENABLE(WEB_CRYPTO)
