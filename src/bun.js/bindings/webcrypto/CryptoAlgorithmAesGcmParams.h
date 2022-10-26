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

#pragma once

#include "BufferSource.h"
#include "CryptoAlgorithmParameters.h"
#include <wtf/Vector.h>

#if ENABLE(WEB_CRYPTO)

namespace WebCore {

class CryptoAlgorithmAesGcmParams final : public CryptoAlgorithmParameters {
public:
    BufferSource iv;
    // Use additionalDataVector() instead of additionalData. The label will be gone once additionalDataVector() is called.
    mutable std::optional<BufferSource::VariantType> additionalData;
    mutable std::optional<uint8_t> tagLength;

    Class parametersClass() const final { return Class::AesGcmParams; }

    const Vector<uint8_t>& ivVector() const
    {
        if (!m_ivVector.isEmpty() || !iv.length())
            return m_ivVector;

        m_ivVector.append(iv.data(), iv.length());
        return m_ivVector;
    }

    const Vector<uint8_t>& additionalDataVector() const
    {
        if (!m_additionalDataVector.isEmpty() || !additionalData)
            return m_additionalDataVector;

        BufferSource additionalDataBuffer = WTFMove(*additionalData);
        additionalData = std::nullopt;
        if (!additionalDataBuffer.length())
            return m_additionalDataVector;

        m_additionalDataVector.append(additionalDataBuffer.data(), additionalDataBuffer.length());
        return m_additionalDataVector;
    }

    CryptoAlgorithmAesGcmParams isolatedCopy() const
    {
        CryptoAlgorithmAesGcmParams result;
        result.identifier = identifier;
        result.m_ivVector = ivVector();
        result.m_additionalDataVector = additionalDataVector();
        result.tagLength = tagLength;

        return result;
    }

private:
    mutable Vector<uint8_t> m_ivVector;
    mutable Vector<uint8_t> m_additionalDataVector;
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_CRYPTO_ALGORITHM_PARAMETERS(AesGcmParams)

#endif // ENABLE(WEB_CRYPTO)
