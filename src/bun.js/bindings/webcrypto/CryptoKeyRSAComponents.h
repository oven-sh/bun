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

#pragma once

#include <wtf/Vector.h>

#if ENABLE(WEB_CRYPTO)

namespace WebCore {

class CryptoKeyRSAComponents {
public:
    enum class Type {
        Public,
        Private
    };

    struct PrimeInfo {
        Vector<uint8_t> primeFactor;
        Vector<uint8_t> factorCRTExponent;
        Vector<uint8_t> factorCRTCoefficient;
    };

    static std::unique_ptr<CryptoKeyRSAComponents> createPublic(const Vector<uint8_t>& modulus, const Vector<uint8_t>& exponent)
    {
        return std::unique_ptr<CryptoKeyRSAComponents>(new CryptoKeyRSAComponents(modulus, exponent));
    }
    static std::unique_ptr<CryptoKeyRSAComponents> createPublic(Vector<uint8_t>&& modulus, Vector<uint8_t>&& exponent)
    {
        return std::unique_ptr<CryptoKeyRSAComponents>(new CryptoKeyRSAComponents(WTFMove(modulus), WTFMove(exponent)));
    }

    static std::unique_ptr<CryptoKeyRSAComponents> createPrivate(const Vector<uint8_t>& modulus, const Vector<uint8_t>& exponent, const Vector<uint8_t>& privateExponent)
    {
        return std::unique_ptr<CryptoKeyRSAComponents>(new CryptoKeyRSAComponents(modulus, exponent, privateExponent));
    }
    static std::unique_ptr<CryptoKeyRSAComponents> createPrivate(Vector<uint8_t>&& modulus, Vector<uint8_t>&& exponent, Vector<uint8_t>&& privateExponent)
    {
        return std::unique_ptr<CryptoKeyRSAComponents>(new CryptoKeyRSAComponents(WTFMove(modulus), WTFMove(exponent), WTFMove(privateExponent)));
    }

    static std::unique_ptr<CryptoKeyRSAComponents> createPrivateWithAdditionalData(const Vector<uint8_t>& modulus, const Vector<uint8_t>& exponent, const Vector<uint8_t>& privateExponent, const PrimeInfo& firstPrimeInfo, const PrimeInfo& secondPrimeInfo, const Vector<PrimeInfo>& otherPrimeInfos)
    {
        return std::unique_ptr<CryptoKeyRSAComponents>(new CryptoKeyRSAComponents(modulus, exponent, privateExponent, firstPrimeInfo, secondPrimeInfo, otherPrimeInfos));
    }
    static std::unique_ptr<CryptoKeyRSAComponents> createPrivateWithAdditionalData(Vector<uint8_t>&& modulus, Vector<uint8_t>&& exponent, Vector<uint8_t>&& privateExponent, PrimeInfo&& firstPrimeInfo, PrimeInfo&& secondPrimeInfo, Vector<PrimeInfo>&& otherPrimeInfos)
    {
        return std::unique_ptr<CryptoKeyRSAComponents>(new CryptoKeyRSAComponents(WTFMove(modulus), WTFMove(exponent), WTFMove(privateExponent), WTFMove(firstPrimeInfo), WTFMove(secondPrimeInfo), WTFMove(otherPrimeInfos)));
    }

    virtual ~CryptoKeyRSAComponents();

    Type type() const { return m_type; }

    // Private and public keys.
    const Vector<uint8_t>& modulus() const { return m_modulus; }
    const Vector<uint8_t>& exponent() const { return m_exponent; }

    // Only private keys.
    const Vector<uint8_t>& privateExponent() const { return m_privateExponent; }
    bool hasAdditionalPrivateKeyParameters() const { return m_hasAdditionalPrivateKeyParameters; }
    const PrimeInfo& firstPrimeInfo() const { return m_firstPrimeInfo; }
    const PrimeInfo& secondPrimeInfo() const { return m_secondPrimeInfo; }
    const Vector<PrimeInfo>& otherPrimeInfos() const { return m_otherPrimeInfos; }

private:
    CryptoKeyRSAComponents(const Vector<uint8_t>& modulus, const Vector<uint8_t>& exponent);
    CryptoKeyRSAComponents(Vector<uint8_t>&& modulus, Vector<uint8_t>&& exponent);

    CryptoKeyRSAComponents(const Vector<uint8_t>& modulus, const Vector<uint8_t>& exponent, const Vector<uint8_t>& privateExponent);
    CryptoKeyRSAComponents(Vector<uint8_t>&& modulus, Vector<uint8_t>&& exponent, Vector<uint8_t>&& privateExponent);

    CryptoKeyRSAComponents(const Vector<uint8_t>& modulus, const Vector<uint8_t>& exponent, const Vector<uint8_t>& privateExponent, const PrimeInfo& firstPrimeInfo, const PrimeInfo& secondPrimeInfo, const Vector<PrimeInfo>& otherPrimeInfos);
    CryptoKeyRSAComponents(Vector<uint8_t>&& modulus, Vector<uint8_t>&& exponent, Vector<uint8_t>&& privateExponent, PrimeInfo&& firstPrimeInfo, PrimeInfo&& secondPrimeInfo, Vector<PrimeInfo>&& otherPrimeInfos);

    Type m_type;

    // Private and public keys.
    Vector<uint8_t> m_modulus;
    Vector<uint8_t> m_exponent;

    // Only private keys.
    Vector<uint8_t> m_privateExponent;
    bool m_hasAdditionalPrivateKeyParameters;
    PrimeInfo m_firstPrimeInfo;
    PrimeInfo m_secondPrimeInfo;
    Vector<PrimeInfo> m_otherPrimeInfos; // When three or more primes have been used, the number of array elements is be the number of primes used minus two.
};

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)
