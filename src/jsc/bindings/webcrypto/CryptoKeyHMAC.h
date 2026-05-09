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

#if ENABLE(WEB_CRYPTO)

#include "CryptoKey.h"
#include "ExceptionOr.h"
#include <wtf/Function.h>
#include <wtf/Vector.h>

namespace WebCore {

class CryptoAlgorithmParameters;
struct JsonWebKey;

class CryptoKeyHMAC final : public CryptoKey {
public:
    static Ref<CryptoKeyHMAC> create(const Vector<uint8_t>& key, CryptoAlgorithmIdentifier hash, bool extractable, CryptoKeyUsageBitmap usage)
    {
        return adoptRef(*new CryptoKeyHMAC(key, hash, extractable, usage));
    }

    virtual ~CryptoKeyHMAC();

    static RefPtr<CryptoKeyHMAC> generate(size_t lengthBits, CryptoAlgorithmIdentifier hash, bool extractable, CryptoKeyUsageBitmap);
    static RefPtr<CryptoKeyHMAC> generateFromBytes(void* data, size_t byteLength, CryptoAlgorithmIdentifier hash, bool extractable, CryptoKeyUsageBitmap);
    static RefPtr<CryptoKeyHMAC> importRaw(size_t lengthBits, CryptoAlgorithmIdentifier hash, Vector<uint8_t>&& keyData, bool extractable, CryptoKeyUsageBitmap);
    using CheckAlgCallback = Function<bool(CryptoAlgorithmIdentifier, const String&)>;
    static RefPtr<CryptoKeyHMAC> importJwk(size_t lengthBits, CryptoAlgorithmIdentifier hash, JsonWebKey&&, bool extractable, CryptoKeyUsageBitmap, CheckAlgCallback&&);

    CryptoKeyClass keyClass() const final { return CryptoKeyClass::HMAC; }

    const Vector<uint8_t>& key() const { return m_key; }
    JsonWebKey exportJwk() const;

    CryptoAlgorithmIdentifier hashAlgorithmIdentifier() const { return m_hash; }

    static ExceptionOr<size_t> getKeyLength(const CryptoAlgorithmParameters&);

private:
    CryptoKeyHMAC(const Vector<uint8_t>& key, CryptoAlgorithmIdentifier hash, bool extractable, CryptoKeyUsageBitmap);
    CryptoKeyHMAC(Vector<uint8_t>&& key, CryptoAlgorithmIdentifier hash, bool extractable, CryptoKeyUsageBitmap);

    KeyAlgorithm algorithm() const final;

    CryptoAlgorithmIdentifier m_hash;
    Vector<uint8_t> m_key;
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_CRYPTO_KEY(CryptoKeyHMAC, CryptoKeyClass::HMAC)

#endif // ENABLE(WEB_CRYPTO)
