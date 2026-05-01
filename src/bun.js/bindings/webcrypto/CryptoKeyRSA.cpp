/*
 * Copyright (C) 2016 Apple Inc. All rights reserved.
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
#include "CryptoKeyRSA.h"

#include "CryptoKeyRSAComponents.h"
#include "JsonWebKey.h"
#include "../wtf-bindings.h"
#include <wtf/text/Base64.h>

#if ENABLE(WEB_CRYPTO)

namespace WebCore {

RefPtr<CryptoKeyRSA> CryptoKeyRSA::importJwk(CryptoAlgorithmIdentifier algorithm, std::optional<CryptoAlgorithmIdentifier> hash, JsonWebKey&& keyData, bool extractable, CryptoKeyUsageBitmap usages)
{
    if (keyData.kty != "RSA"_s)
        return nullptr;
    if (keyData.key_ops && ((keyData.usages & usages) != usages))
        return nullptr;
    if (keyData.ext && !keyData.ext.value() && extractable)
        return nullptr;

    if (keyData.n.isNull() || keyData.e.isNull())
        return nullptr;
    auto modulus = base64URLDecode(keyData.n);
    if (!modulus)
        return nullptr;
    // Per RFC 7518 Section 6.3.1.1: https://tools.ietf.org/html/rfc7518#section-6.3.1.1
    if (!modulus->isEmpty() && !modulus->at(0))
        modulus->removeAt(0);
    auto exponent = base64URLDecode(keyData.e);
    if (!exponent)
        return nullptr;
    if (keyData.d.isNull()) {
        // import public key
        auto publicKeyComponents = CryptoKeyRSAComponents::createPublic(WTF::move(*modulus), WTF::move(*exponent));
        // Notice: CryptoAlgorithmIdentifier::SHA_1 is just a placeholder. It should not have any effect if hash is std::nullopt.
        return CryptoKeyRSA::create(algorithm, hash.value_or(CryptoAlgorithmIdentifier::SHA_1), !!hash, *publicKeyComponents, extractable, usages);
    }

    // import private key
    auto privateExponent = base64URLDecode(keyData.d);
    if (!privateExponent)
        return nullptr;
    if (keyData.p.isNull() && keyData.q.isNull() && keyData.dp.isNull() && keyData.dp.isNull() && keyData.qi.isNull()) {
        auto privateKeyComponents = CryptoKeyRSAComponents::createPrivate(WTF::move(*modulus), WTF::move(*exponent), WTF::move(*privateExponent));
        // Notice: CryptoAlgorithmIdentifier::SHA_1 is just a placeholder. It should not have any effect if hash is std::nullopt.
        return CryptoKeyRSA::create(algorithm, hash.value_or(CryptoAlgorithmIdentifier::SHA_1), !!hash, *privateKeyComponents, extractable, usages);
    }

    if (keyData.p.isNull() || keyData.q.isNull() || keyData.dp.isNull() || keyData.dq.isNull() || keyData.qi.isNull())
        return nullptr;

    auto firstPrimeFactor = base64URLDecode(keyData.p);
    if (!firstPrimeFactor)
        return nullptr;
    auto firstFactorCRTExponent = base64URLDecode(keyData.dp);
    if (!firstFactorCRTExponent)
        return nullptr;
    auto secondPrimeFactor = base64URLDecode(keyData.q);
    if (!secondPrimeFactor)
        return nullptr;
    auto secondFactorCRTExponent = base64URLDecode(keyData.dq);
    if (!secondFactorCRTExponent)
        return nullptr;
    auto secondFactorCRTCoefficient = base64URLDecode(keyData.qi);
    if (!secondFactorCRTCoefficient)
        return nullptr;

    CryptoKeyRSAComponents::PrimeInfo firstPrimeInfo;
    firstPrimeInfo.primeFactor = WTF::move(*firstPrimeFactor);
    firstPrimeInfo.factorCRTExponent = WTF::move(*firstFactorCRTExponent);

    CryptoKeyRSAComponents::PrimeInfo secondPrimeInfo;
    secondPrimeInfo.primeFactor = WTF::move(*secondPrimeFactor);
    secondPrimeInfo.factorCRTExponent = WTF::move(*secondFactorCRTExponent);
    secondPrimeInfo.factorCRTCoefficient = WTF::move(*secondFactorCRTCoefficient);

    if (!keyData.oth) {
        auto privateKeyComponents = CryptoKeyRSAComponents::createPrivateWithAdditionalData(WTF::move(*modulus), WTF::move(*exponent), WTF::move(*privateExponent), WTF::move(firstPrimeInfo), WTF::move(secondPrimeInfo), {});
        // Notice: CryptoAlgorithmIdentifier::SHA_1 is just a placeholder. It should not have any effect if hash is std::nullopt.
        return CryptoKeyRSA::create(algorithm, hash.value_or(CryptoAlgorithmIdentifier::SHA_1), !!hash, *privateKeyComponents, extractable, usages);
    }

    Vector<CryptoKeyRSAComponents::PrimeInfo> otherPrimeInfos;
    for (const auto& value : keyData.oth.value()) {
        auto primeFactor = base64URLDecode(value.r);
        if (!primeFactor)
            return nullptr;
        auto factorCRTExponent = base64URLDecode(value.d);
        if (!factorCRTExponent)
            return nullptr;
        auto factorCRTCoefficient = base64URLDecode(value.t);
        if (!factorCRTCoefficient)
            return nullptr;

        CryptoKeyRSAComponents::PrimeInfo info;
        info.primeFactor = WTF::move(*primeFactor);
        info.factorCRTExponent = WTF::move(*factorCRTExponent);
        info.factorCRTCoefficient = WTF::move(*factorCRTCoefficient);

        otherPrimeInfos.append(WTF::move(info));
    }

    auto privateKeyComponents = CryptoKeyRSAComponents::createPrivateWithAdditionalData(WTF::move(*modulus), WTF::move(*exponent), WTF::move(*privateExponent), WTF::move(firstPrimeInfo), WTF::move(secondPrimeInfo), WTF::move(otherPrimeInfos));
    // Notice: CryptoAlgorithmIdentifier::SHA_1 is just a placeholder. It should not have any effect if hash is std::nullopt.
    return CryptoKeyRSA::create(algorithm, hash.value_or(CryptoAlgorithmIdentifier::SHA_1), !!hash, *privateKeyComponents, extractable, usages);
}

JsonWebKey CryptoKeyRSA::exportJwk() const
{
    JsonWebKey result {};
    result.kty = "RSA"_s;
    result.key_ops = usages();
    result.ext = extractable();

    auto rsaComponents = exportData();

    if (!rsaComponents)
        return result;

    // public key
    result.n = Bun::base64URLEncodeToString(rsaComponents->modulus());
    result.e = Bun::base64URLEncodeToString(rsaComponents->exponent());
    if (rsaComponents->type() == CryptoKeyRSAComponents::Type::Public)
        return result;

    // private key
    result.d = Bun::base64URLEncodeToString(rsaComponents->privateExponent());
    if (!rsaComponents->hasAdditionalPrivateKeyParameters())
        return result;

    result.p = Bun::base64URLEncodeToString(rsaComponents->firstPrimeInfo().primeFactor);
    result.q = Bun::base64URLEncodeToString(rsaComponents->secondPrimeInfo().primeFactor);
    result.dp = Bun::base64URLEncodeToString(rsaComponents->firstPrimeInfo().factorCRTExponent);
    result.dq = Bun::base64URLEncodeToString(rsaComponents->secondPrimeInfo().factorCRTExponent);
    result.qi = Bun::base64URLEncodeToString(rsaComponents->secondPrimeInfo().factorCRTCoefficient);
    if (rsaComponents->otherPrimeInfos().isEmpty())
        return result;

    Vector<RsaOtherPrimesInfo> oth;
    for (const auto& info : rsaComponents->otherPrimeInfos()) {
        RsaOtherPrimesInfo otherInfo;
        otherInfo.r = Bun::base64URLEncodeToString(info.primeFactor);
        otherInfo.d = Bun::base64URLEncodeToString(info.factorCRTExponent);
        otherInfo.t = Bun::base64URLEncodeToString(info.factorCRTCoefficient);
        oth.append(WTF::move(otherInfo));
    }
    result.oth = WTF::move(oth);
    return result;
}

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)
