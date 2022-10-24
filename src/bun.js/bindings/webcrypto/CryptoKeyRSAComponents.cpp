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
#include "CryptoKeyRSAComponents.h"

#if ENABLE(WEB_CRYPTO)

namespace WebCore {

CryptoKeyRSAComponents::CryptoKeyRSAComponents(const Vector<uint8_t>& modulus, const Vector<uint8_t>& exponent)
    : m_type(Type::Public)
    , m_modulus(modulus)
    , m_exponent(exponent)
{
}

CryptoKeyRSAComponents::CryptoKeyRSAComponents(Vector<uint8_t>&& modulus, Vector<uint8_t>&& exponent)
    : m_type(Type::Public)
    , m_modulus(WTFMove(modulus))
    , m_exponent(WTFMove(exponent))
{
}

CryptoKeyRSAComponents::CryptoKeyRSAComponents(const Vector<uint8_t>& modulus, const Vector<uint8_t>& exponent, const Vector<uint8_t>& privateExponent)
    : m_type(Type::Private)
    , m_modulus(modulus)
    , m_exponent(exponent)
    , m_privateExponent(privateExponent)
    , m_hasAdditionalPrivateKeyParameters(false)
{
}

CryptoKeyRSAComponents::CryptoKeyRSAComponents(Vector<uint8_t>&& modulus, Vector<uint8_t>&& exponent, Vector<uint8_t>&& privateExponent)
    : m_type(Type::Private)
    , m_modulus(WTFMove(modulus))
    , m_exponent(WTFMove(exponent))
    , m_privateExponent(WTFMove(privateExponent))
    , m_hasAdditionalPrivateKeyParameters(false)
{
}

CryptoKeyRSAComponents::CryptoKeyRSAComponents(const Vector<uint8_t>& modulus, const Vector<uint8_t>& exponent, const Vector<uint8_t>& privateExponent, const PrimeInfo& firstPrimeInfo, const PrimeInfo& secondPrimeInfo, const Vector<PrimeInfo>& otherPrimeInfos)
    : m_type(Type::Private)
    , m_modulus(modulus)
    , m_exponent(exponent)
    , m_privateExponent(privateExponent)
    , m_hasAdditionalPrivateKeyParameters(true)
    , m_firstPrimeInfo(firstPrimeInfo)
    , m_secondPrimeInfo(secondPrimeInfo)
    , m_otherPrimeInfos(otherPrimeInfos)
{
}

CryptoKeyRSAComponents::CryptoKeyRSAComponents(Vector<uint8_t>&& modulus, Vector<uint8_t>&& exponent, Vector<uint8_t>&& privateExponent, PrimeInfo&& firstPrimeInfo, PrimeInfo&& secondPrimeInfo, Vector<PrimeInfo>&& otherPrimeInfos)
    : m_type(Type::Private)
    , m_modulus(WTFMove(modulus))
    , m_exponent(WTFMove(exponent))
    , m_privateExponent(WTFMove(privateExponent))
    , m_hasAdditionalPrivateKeyParameters(true)
    , m_firstPrimeInfo(WTFMove(firstPrimeInfo))
    , m_secondPrimeInfo(WTFMove(secondPrimeInfo))
    , m_otherPrimeInfos(WTFMove(otherPrimeInfos))
{
}

CryptoKeyRSAComponents::~CryptoKeyRSAComponents() = default;

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)
