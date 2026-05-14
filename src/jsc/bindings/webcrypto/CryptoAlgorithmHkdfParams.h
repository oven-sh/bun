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
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/Strong.h>
#include <wtf/Vector.h>

#if ENABLE(WEB_CRYPTO)

namespace WebCore {

class CryptoAlgorithmHkdfParams final : public CryptoAlgorithmParameters {
public:
    // FIXME: Consider merging hash and hashIdentifier.
    std::variant<JSC::Strong<JSC::JSObject>, String> hash;
    CryptoAlgorithmIdentifier hashIdentifier;
    BufferSource salt;
    BufferSource info;

    const Vector<uint8_t>& saltVector() const
    {
        if (!m_saltVector.isEmpty() || !salt.length())
            return m_saltVector;

        m_saltVector.append(std::span { salt.data(), salt.length() });
        return m_saltVector;
    }

    const Vector<uint8_t>& infoVector() const
    {
        if (!m_infoVector.isEmpty() || !info.length())
            return m_infoVector;

        m_infoVector.append(std::span { info.data(), info.length() });
        return m_infoVector;
    }

    Class parametersClass() const final { return Class::HkdfParams; }

    CryptoAlgorithmHkdfParams isolatedCopy() const
    {
        CryptoAlgorithmHkdfParams result;
        result.identifier = identifier;
        result.m_saltVector = saltVector();
        result.m_infoVector = infoVector();
        result.hashIdentifier = hashIdentifier;

        return result;
    }

private:
    mutable Vector<uint8_t> m_saltVector;
    mutable Vector<uint8_t> m_infoVector;
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_CRYPTO_ALGORITHM_PARAMETERS(HkdfParams)

#endif // ENABLE(WEB_CRYPTO)
