/*
 * Copyright (C) 2026 Apple Inc. All rights reserved.
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

// https://wicg.github.io/webcrypto-modern-algos/#dfn-ContextParams
class CryptoAlgorithmMlDsaParams final : public CryptoAlgorithmParameters {
public:
    mutable std::optional<BufferSource::VariantType> context;

    Class parametersClass() const final { return Class::MlDsaParams; }

    const Vector<uint8_t>& contextVector() const
    {
        if (!m_contextVector.isEmpty() || !context)
            return m_contextVector;

        BufferSource contextBuffer = WTF::move(*context);
        context = std::nullopt;
        if (!contextBuffer.length())
            return m_contextVector;

        m_contextVector.append(std::span { contextBuffer.data(), contextBuffer.length() });
        return m_contextVector;
    }

    CryptoAlgorithmMlDsaParams isolatedCopy() const
    {
        CryptoAlgorithmMlDsaParams result;
        result.identifier = identifier;
        result.m_contextVector = contextVector();

        return result;
    }

private:
    mutable Vector<uint8_t> m_contextVector;
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_CRYPTO_ALGORITHM_PARAMETERS(MlDsaParams)

#endif // ENABLE(WEB_CRYPTO)
