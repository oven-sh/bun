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
#include "CryptoAlgorithmECDSA.h"

#if ENABLE(WEB_CRYPTO)

#include "CryptoAlgorithmEcKeyParams.h"
#include "CryptoAlgorithmEcdsaParams.h"
#include "CryptoKeyEC.h"
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <wtf/CrossThreadCopier.h>

namespace WebCore {

namespace CryptoAlgorithmECDSAInternal {
static constexpr auto ALG256 = "ES256"_s;
static constexpr auto ALG384 = "ES384"_s;
static constexpr auto ALG512 = "ES512"_s;
static constexpr auto P256 = "P-256"_s;
static constexpr auto P384 = "P-384"_s;
static constexpr auto P521 = "P-521"_s;
}

Ref<CryptoAlgorithm> CryptoAlgorithmECDSA::create()
{
    return adoptRef(*new CryptoAlgorithmECDSA);
}

CryptoAlgorithmIdentifier CryptoAlgorithmECDSA::identifier() const
{
    return s_identifier;
}

void CryptoAlgorithmECDSA::sign(const CryptoAlgorithmParameters& parameters, Ref<CryptoKey>&& key, Vector<uint8_t>&& data, VectorCallback&& callback, ExceptionCallback&& exceptionCallback, ScriptExecutionContext& context, WorkQueue& workQueue)
{
    if (key->type() != CryptoKeyType::Private) {
        exceptionCallback(InvalidAccessError, ""_s);
        return;
    }

    dispatchOperationInWorkQueue(workQueue, context, WTF::move(callback), WTF::move(exceptionCallback),
        [parameters = crossThreadCopy(downcast<CryptoAlgorithmEcdsaParams>(parameters)), key = WTF::move(key), data = WTF::move(data)] {
            return platformSign(parameters, downcast<CryptoKeyEC>(key.get()), data);
        });
}

void CryptoAlgorithmECDSA::verify(const CryptoAlgorithmParameters& parameters, Ref<CryptoKey>&& key, Vector<uint8_t>&& signature, Vector<uint8_t>&& data, BoolCallback&& callback, ExceptionCallback&& exceptionCallback, ScriptExecutionContext& context, WorkQueue& workQueue)
{
    if (key->type() != CryptoKeyType::Public) {
        exceptionCallback(InvalidAccessError, ""_s);
        return;
    }

    dispatchOperationInWorkQueue(workQueue, context, WTF::move(callback), WTF::move(exceptionCallback),
        [parameters = crossThreadCopy(downcast<CryptoAlgorithmEcdsaParams>(parameters)), key = WTF::move(key), signature = WTF::move(signature), data = WTF::move(data)] {
            return platformVerify(parameters, downcast<CryptoKeyEC>(key.get()), signature, data);
        });
}

void CryptoAlgorithmECDSA::generateKey(const CryptoAlgorithmParameters& parameters, bool extractable, CryptoKeyUsageBitmap usages, KeyOrKeyPairCallback&& callback, ExceptionCallback&& exceptionCallback, ScriptExecutionContext&)
{
    const auto& ecParameters = downcast<CryptoAlgorithmEcKeyParams>(parameters);

    if (usages & (CryptoKeyUsageEncrypt | CryptoKeyUsageDecrypt | CryptoKeyUsageDeriveKey | CryptoKeyUsageDeriveBits | CryptoKeyUsageWrapKey | CryptoKeyUsageUnwrapKey)) {
        exceptionCallback(SyntaxError, ""_s);
        return;
    }

    auto result = CryptoKeyEC::generatePair(CryptoAlgorithmIdentifier::ECDSA, ecParameters.namedCurve, extractable, usages);
    if (result.hasException()) {
        exceptionCallback(result.releaseException().code(), ""_s);
        return;
    }

    auto pair = result.releaseReturnValue();
    pair.publicKey->setUsagesBitmap(pair.publicKey->usagesBitmap() & CryptoKeyUsageVerify);
    pair.privateKey->setUsagesBitmap(pair.privateKey->usagesBitmap() & CryptoKeyUsageSign);
    callback(WTF::move(pair));
}

void CryptoAlgorithmECDSA::importKey(CryptoKeyFormat format, KeyData&& data, const CryptoAlgorithmParameters& parameters, bool extractable, CryptoKeyUsageBitmap usages, KeyCallback&& callback, ExceptionCallback&& exceptionCallback)
{
    using namespace CryptoAlgorithmECDSAInternal;
    const auto& ecParameters = downcast<CryptoAlgorithmEcKeyParams>(parameters);

    RefPtr<CryptoKeyEC> result;
    switch (format) {
    case CryptoKeyFormat::Jwk: {
        JsonWebKey key = WTF::move(std::get<JsonWebKey>(data));

        if (usages && ((!key.d.isNull() && (usages ^ CryptoKeyUsageSign)) || (key.d.isNull() && (usages ^ CryptoKeyUsageVerify)))) {
            exceptionCallback(SyntaxError, ""_s);
            return;
        }
        if (usages && !key.use.isNull() && key.use != "sig"_s) {
            exceptionCallback(DataError, ""_s);
            return;
        }

        bool isMatched = false;
        if (key.crv == P256)
            isMatched = key.alg.isNull() || key.alg == ALG256;
        if (key.crv == P384)
            isMatched = key.alg.isNull() || key.alg == ALG384;
        if (key.crv == P521)
            isMatched = key.alg.isNull() || key.alg == ALG512;
        if (!isMatched) {
            exceptionCallback(DataError, ""_s);
            return;
        }

        result = CryptoKeyEC::importJwk(ecParameters.identifier, ecParameters.namedCurve, WTF::move(key), extractable, usages);
        break;
    }
    case CryptoKeyFormat::Raw:
        if (usages && (usages ^ CryptoKeyUsageVerify)) {
            exceptionCallback(SyntaxError, ""_s);
            return;
        }
        result = CryptoKeyEC::importRaw(ecParameters.identifier, ecParameters.namedCurve, WTF::move(std::get<Vector<uint8_t>>(data)), extractable, usages);
        break;
    case CryptoKeyFormat::Spki:
        if (usages && (usages ^ CryptoKeyUsageVerify)) {
            exceptionCallback(SyntaxError, ""_s);
            return;
        }
        result = CryptoKeyEC::importSpki(ecParameters.identifier, ecParameters.namedCurve, WTF::move(std::get<Vector<uint8_t>>(data)), extractable, usages);
        break;
    case CryptoKeyFormat::Pkcs8:
        if (usages && (usages ^ CryptoKeyUsageSign)) {
            exceptionCallback(SyntaxError, ""_s);
            return;
        }
        result = CryptoKeyEC::importPkcs8(ecParameters.identifier, ecParameters.namedCurve, WTF::move(std::get<Vector<uint8_t>>(data)), extractable, usages);
        break;
    }
    if (!result) {
        exceptionCallback(DataError, ""_s);
        return;
    }

    callback(*result);
}

void CryptoAlgorithmECDSA::exportKey(CryptoKeyFormat format, Ref<CryptoKey>&& key, KeyDataCallback&& callback, ExceptionCallback&& exceptionCallback)
{
    const auto& ecKey = downcast<CryptoKeyEC>(key.get());

    if (!ecKey.keySizeInBits()) {
        exceptionCallback(OperationError, ""_s);
        return;
    }

    KeyData result;
    switch (format) {
    case CryptoKeyFormat::Jwk: {
        auto jwk = ecKey.exportJwk();
        if (jwk.hasException()) {
            exceptionCallback(jwk.releaseException().code(), ""_s);
            return;
        }
        result = jwk.releaseReturnValue();
        break;
    }
    case CryptoKeyFormat::Raw: {
        auto raw = ecKey.exportRaw();
        if (raw.hasException()) {
            exceptionCallback(raw.releaseException().code(), ""_s);
            return;
        }
        result = raw.releaseReturnValue();
        break;
    }
    case CryptoKeyFormat::Spki: {
        auto spki = ecKey.exportSpki();
        if (spki.hasException()) {
            exceptionCallback(spki.releaseException().code(), ""_s);
            return;
        }
        result = spki.releaseReturnValue();
        break;
    }
    case CryptoKeyFormat::Pkcs8: {
        auto pkcs8 = ecKey.exportPkcs8();
        if (pkcs8.hasException()) {
            exceptionCallback(pkcs8.releaseException().code(), ""_s);
            return;
        }
        result = pkcs8.releaseReturnValue();
        break;
    }
    }

    callback(format, WTF::move(result));
}

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)
