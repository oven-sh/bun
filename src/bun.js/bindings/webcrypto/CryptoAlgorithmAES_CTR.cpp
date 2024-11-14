/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
 * Copyright (C) 2020 Sony Interactive Entertainment Inc.
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
#include "CryptoAlgorithmAES_CTR.h"

#if ENABLE(WEB_CRYPTO)

#include "CryptoAlgorithmAesCtrParams.h"
#include "CryptoAlgorithmAesKeyParams.h"
#include "CryptoKeyAES.h"
#include <wtf/CrossThreadCopier.h>
#include <wtf/FlipBytes.h>

namespace WebCore {

namespace CryptoAlgorithmAES_CTRInternal {
static constexpr auto ALG128 = "A128CTR"_s;
static constexpr auto ALG192 = "A192CTR"_s;
static constexpr auto ALG256 = "A256CTR"_s;
static const size_t CounterSize = 16;
static const uint64_t AllBitsSet = ~(uint64_t)0;
}

static inline bool usagesAreInvalidForCryptoAlgorithmAES_CTR(CryptoKeyUsageBitmap usages)
{
    return usages & (CryptoKeyUsageSign | CryptoKeyUsageVerify | CryptoKeyUsageDeriveKey | CryptoKeyUsageDeriveBits);
}

static bool parametersAreValid(const CryptoAlgorithmAesCtrParams& parameters)
{
    using namespace CryptoAlgorithmAES_CTRInternal;
    if (parameters.counterVector().size() != CounterSize)
        return false;
    if (!parameters.length || parameters.length > 128)
        return false;
    return true;
}

Ref<CryptoAlgorithm> CryptoAlgorithmAES_CTR::create()
{
    return adoptRef(*new CryptoAlgorithmAES_CTR);
}

CryptoAlgorithmIdentifier CryptoAlgorithmAES_CTR::identifier() const
{
    return s_identifier;
}

void CryptoAlgorithmAES_CTR::encrypt(const CryptoAlgorithmParameters& parameters, Ref<CryptoKey>&& key, Vector<uint8_t>&& plainText, VectorCallback&& callback, ExceptionCallback&& exceptionCallback, ScriptExecutionContext& context, WorkQueue& workQueue)
{
    auto& aesParameters = downcast<CryptoAlgorithmAesCtrParams>(parameters);
    if (!parametersAreValid(aesParameters)) {
        exceptionCallback(OperationError);
        return;
    }

    dispatchOperationInWorkQueue(workQueue, context, WTFMove(callback), WTFMove(exceptionCallback),
        [parameters = crossThreadCopy(aesParameters), key = WTFMove(key), plainText = WTFMove(plainText)] {
            return platformEncrypt(parameters, downcast<CryptoKeyAES>(key.get()), plainText);
        });
}

void CryptoAlgorithmAES_CTR::decrypt(const CryptoAlgorithmParameters& parameters, Ref<CryptoKey>&& key, Vector<uint8_t>&& cipherText, VectorCallback&& callback, ExceptionCallback&& exceptionCallback, ScriptExecutionContext& context, WorkQueue& workQueue)
{
    auto& aesParameters = downcast<CryptoAlgorithmAesCtrParams>(parameters);
    if (!parametersAreValid(aesParameters)) {
        exceptionCallback(OperationError);
        return;
    }

    dispatchOperationInWorkQueue(workQueue, context, WTFMove(callback), WTFMove(exceptionCallback),
        [parameters = crossThreadCopy(aesParameters), key = WTFMove(key), cipherText = WTFMove(cipherText)] {
            return platformDecrypt(parameters, downcast<CryptoKeyAES>(key.get()), cipherText);
        });
}

void CryptoAlgorithmAES_CTR::generateKey(const CryptoAlgorithmParameters& parameters, bool extractable, CryptoKeyUsageBitmap usages, KeyOrKeyPairCallback&& callback, ExceptionCallback&& exceptionCallback, ScriptExecutionContext&)
{
    const auto& aesParameters = downcast<CryptoAlgorithmAesKeyParams>(parameters);

    if (usagesAreInvalidForCryptoAlgorithmAES_CTR(usages)) {
        exceptionCallback(SyntaxError);
        return;
    }

    auto result = CryptoKeyAES::generate(CryptoAlgorithmIdentifier::AES_CTR, aesParameters.length, extractable, usages);
    if (!result) {
        exceptionCallback(OperationError);
        return;
    }

    callback(WTFMove(result));
}

void CryptoAlgorithmAES_CTR::importKey(CryptoKeyFormat format, KeyData&& data, const CryptoAlgorithmParameters& parameters, bool extractable, CryptoKeyUsageBitmap usages, KeyCallback&& callback, ExceptionCallback&& exceptionCallback)
{
    using namespace CryptoAlgorithmAES_CTRInternal;

    if (usagesAreInvalidForCryptoAlgorithmAES_CTR(usages)) {
        exceptionCallback(SyntaxError);
        return;
    }

    RefPtr<CryptoKeyAES> result;
    switch (format) {
    case CryptoKeyFormat::Raw:
        result = CryptoKeyAES::importRaw(parameters.identifier, WTFMove(std::get<Vector<uint8_t>>(data)), extractable, usages);
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
        result = CryptoKeyAES::importJwk(parameters.identifier, WTFMove(std::get<JsonWebKey>(data)), extractable, usages, WTFMove(checkAlgCallback));
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

void CryptoAlgorithmAES_CTR::exportKey(CryptoKeyFormat format, Ref<CryptoKey>&& key, KeyDataCallback&& callback, ExceptionCallback&& exceptionCallback)
{
    using namespace CryptoAlgorithmAES_CTRInternal;
    const auto& aesKey = downcast<CryptoKeyAES>(key.get());

    if (aesKey.key().isEmpty()) {
        exceptionCallback(OperationError);
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
        result = WTFMove(jwk);
        break;
    }
    default:
        exceptionCallback(NotSupportedError);
        return;
    }

    callback(format, WTFMove(result));
}

ExceptionOr<size_t> CryptoAlgorithmAES_CTR::getKeyLength(const CryptoAlgorithmParameters& parameters)
{
    return CryptoKeyAES::getKeyLength(parameters);
}

CryptoAlgorithmAES_CTR::CounterBlockHelper::CounterBlockHelper(const Vector<uint8_t>& counterVector, size_t counterLength)
    : m_counterLength(counterLength)
{
    using namespace CryptoAlgorithmAES_CTRInternal;

    ASSERT(counterVector.size() == CounterSize);
    ASSERT(counterLength <= CounterSize * 8);
    bool littleEndian = false; // counterVector is stored in big-endian.
    memcpy(&m_bits.m_hi, counterVector.data(), 8);
    m_bits.m_hi = flipBytesIfLittleEndian(m_bits.m_hi, littleEndian);
    memcpy(&m_bits.m_lo, counterVector.data() + 8, 8);
    m_bits.m_lo = flipBytesIfLittleEndian(m_bits.m_lo, littleEndian);
}

size_t CryptoAlgorithmAES_CTR::CounterBlockHelper::countToOverflowSaturating() const
{
    CounterBlockBits counterMask;
    counterMask.set();
    counterMask <<= m_counterLength;
    counterMask = ~counterMask;

    auto countMinusOne = ~m_bits & counterMask;

    CounterBlockBits sizeTypeMask;
    sizeTypeMask.set();
    sizeTypeMask <<= sizeof(size_t) * 8;
    if ((sizeTypeMask & countMinusOne).any()) {
        // Saturating to the size_t max since the count is greater than that.
        return std::numeric_limits<size_t>::max();
    }

    countMinusOne &= ~sizeTypeMask;
    if (countMinusOne.all()) {
        // As all bits are set, adding one would result in an overflow.
        // Return size_t max instead.
        return std::numeric_limits<size_t>::max();
    }

    static_assert(sizeof(size_t) <= sizeof(uint64_t));
    return countMinusOne.m_lo + 1;
}

Vector<uint8_t> CryptoAlgorithmAES_CTR::CounterBlockHelper::counterVectorAfterOverflow() const
{
    using namespace CryptoAlgorithmAES_CTRInternal;

    CounterBlockBits nonceMask;
    nonceMask.set();
    nonceMask <<= m_counterLength;
    auto bits = m_bits & nonceMask;

    bool littleEndian = false; // counterVector is stored in big-endian.
    Vector<uint8_t> counterVector(CounterSize);
    uint64_t hi = flipBytesIfLittleEndian(bits.m_hi, littleEndian);
    memcpy(counterVector.data(), &hi, 8);
    uint64_t lo = flipBytesIfLittleEndian(bits.m_lo, littleEndian);
    memcpy(counterVector.data() + 8, &lo, 8);

    return counterVector;
}

void CryptoAlgorithmAES_CTR::CounterBlockHelper::CounterBlockBits::set()
{
    using namespace CryptoAlgorithmAES_CTRInternal;
    m_hi = AllBitsSet;
    m_lo = AllBitsSet;
}

bool CryptoAlgorithmAES_CTR::CounterBlockHelper::CounterBlockBits::all() const
{
    using namespace CryptoAlgorithmAES_CTRInternal;
    return m_hi == AllBitsSet && m_lo == AllBitsSet;
}

bool CryptoAlgorithmAES_CTR::CounterBlockHelper::CounterBlockBits::any() const
{
    return m_hi || m_lo;
}

auto CryptoAlgorithmAES_CTR::CounterBlockHelper::CounterBlockBits::operator&(const CounterBlockBits& rhs) const -> CounterBlockBits
{
    return { m_hi & rhs.m_hi, m_lo & rhs.m_lo };
}

auto CryptoAlgorithmAES_CTR::CounterBlockHelper::CounterBlockBits::operator~() const -> CounterBlockBits
{
    return { ~m_hi, ~m_lo };
}

auto CryptoAlgorithmAES_CTR::CounterBlockHelper::CounterBlockBits::operator<<=(unsigned shift) -> CounterBlockBits&
{
    if (shift < 64) {
        m_hi = (m_hi << shift) | m_lo >> (64 - shift);
        m_lo <<= shift;
    } else if (shift < 128) {
        shift -= 64;
        m_hi = m_lo << shift;
        m_lo = 0;
    } else {
        m_hi = 0;
        m_lo = 0;
    }
    return *this;
}

auto CryptoAlgorithmAES_CTR::CounterBlockHelper::CounterBlockBits::operator&=(const CounterBlockBits& rhs) -> CounterBlockBits&
{
    m_hi &= rhs.m_hi;
    m_lo &= rhs.m_lo;
    return *this;
}

}

#endif // ENABLE(WEB_CRYPTO)
