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

#include "CryptoAlgorithmIdentifier.h"
#include "CryptoKey.h"
#include "ExceptionOr.h"
#include <wtf/Function.h>
#include <wtf/Vector.h>

#if ENABLE(WEB_CRYPTO)

namespace WebCore {

class CryptoAlgorithmParameters;

struct JsonWebKey;

class CryptoKeyAES final : public CryptoKey {
public:
    static const int s_length128 = 128;
    static const int s_length192 = 192;
    static const int s_length256 = 256;

    static Ref<CryptoKeyAES> create(CryptoAlgorithmIdentifier algorithm, const Vector<uint8_t>& key, bool extractable, CryptoKeyUsageBitmap usage)
    {
        return adoptRef(*new CryptoKeyAES(algorithm, key, extractable, usage));
    }
    virtual ~CryptoKeyAES();

    static bool isValidAESAlgorithm(CryptoAlgorithmIdentifier);

    static RefPtr<CryptoKeyAES> generate(CryptoAlgorithmIdentifier, size_t lengthBits, bool extractable, CryptoKeyUsageBitmap);
    WEBCORE_EXPORT static RefPtr<CryptoKeyAES> importRaw(CryptoAlgorithmIdentifier, Vector<uint8_t>&& keyData, bool extractable, CryptoKeyUsageBitmap);
    using CheckAlgCallback = Function<bool(size_t, const String&)>;
    static RefPtr<CryptoKeyAES> importJwk(CryptoAlgorithmIdentifier, JsonWebKey&&, bool extractable, CryptoKeyUsageBitmap, CheckAlgCallback&&);

    CryptoKeyClass keyClass() const final { return CryptoKeyClass::AES; }

    const Vector<uint8_t>& key() const { return m_key; }
    JsonWebKey exportJwk() const;

    static ExceptionOr<size_t> getKeyLength(const CryptoAlgorithmParameters&);

private:
    CryptoKeyAES(CryptoAlgorithmIdentifier, const Vector<uint8_t>& key, bool extractable, CryptoKeyUsageBitmap);
    CryptoKeyAES(CryptoAlgorithmIdentifier, Vector<uint8_t>&& key, bool extractable, CryptoKeyUsageBitmap);

    KeyAlgorithm algorithm() const final;

    Vector<uint8_t> m_key;
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_CRYPTO_KEY(CryptoKeyAES, CryptoKeyClass::AES)

#endif // ENABLE(WEB_CRYPTO)
