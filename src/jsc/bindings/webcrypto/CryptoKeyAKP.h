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

#include "CryptoKey.h"
#include "CryptoKeyPair.h"
#include "ExceptionOr.h"
#include "OpenSSLCryptoUniquePtr.h"

#if ENABLE(WEB_CRYPTO)

typedef struct evp_pkey_alg_st EVP_PKEY_ALG;

namespace WebCore {

struct JsonWebKey;

// Backs the ML-DSA and ML-KEM algorithms. The JWK key type for these is
// "AKP" (Algorithm Key Pair), which is where the class name comes from.
class CryptoKeyAKP final : public CryptoKey {
public:
    static bool isMlDsa(CryptoAlgorithmIdentifier);
    static bool isMlKem(CryptoAlgorithmIdentifier);
    static const EVP_PKEY_ALG* algForIdentifier(CryptoAlgorithmIdentifier);
    static int nidForIdentifier(CryptoAlgorithmIdentifier);

    static RefPtr<CryptoKeyAKP> create(CryptoAlgorithmIdentifier, CryptoKeyType, EvpPKeyPtr&&, bool extractable, CryptoKeyUsageBitmap);

    static ExceptionOr<CryptoKeyPair> generatePair(CryptoAlgorithmIdentifier, bool extractable, CryptoKeyUsageBitmap publicUsages, CryptoKeyUsageBitmap privateUsages);
    // A null return means the key data could not be parsed ("Invalid keyData");
    // `wrongKeyType`, when set, means it parsed as a key of another algorithm.
    static RefPtr<CryptoKeyAKP> importSpki(CryptoAlgorithmIdentifier, Vector<uint8_t>&& keyData, bool extractable, CryptoKeyUsageBitmap, bool* wrongKeyType);
    static RefPtr<CryptoKeyAKP> importPkcs8(CryptoAlgorithmIdentifier, Vector<uint8_t>&& keyData, bool extractable, CryptoKeyUsageBitmap, bool* wrongKeyType);
    static RefPtr<CryptoKeyAKP> importRawPublic(CryptoAlgorithmIdentifier, Vector<uint8_t>&& keyData, bool extractable, CryptoKeyUsageBitmap);
    static RefPtr<CryptoKeyAKP> importRawSeed(CryptoAlgorithmIdentifier, Vector<uint8_t>&& keyData, bool extractable, CryptoKeyUsageBitmap);
    static RefPtr<CryptoKeyAKP> importJwk(CryptoAlgorithmIdentifier, JsonWebKey&&, bool extractable, CryptoKeyUsageBitmap);

    ExceptionOr<Vector<uint8_t>> exportSpki() const;
    ExceptionOr<Vector<uint8_t>> exportPkcs8() const;
    ExceptionOr<Vector<uint8_t>> exportRawPublic() const;
    ExceptionOr<Vector<uint8_t>> exportRawSeed() const;
    ExceptionOr<JsonWebKey> exportJwk() const;

    EVP_PKEY* platformKey() const { return m_key.get(); }

private:
    CryptoKeyAKP(CryptoAlgorithmIdentifier, CryptoKeyType, EvpPKeyPtr&&, bool extractable, CryptoKeyUsageBitmap);

    CryptoKeyClass keyClass() const final { return CryptoKeyClass::AKP; }
    KeyAlgorithm algorithm() const final;

    EvpPKeyPtr m_key;
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_CRYPTO_KEY(CryptoKeyAKP, CryptoKeyClass::AKP)

#endif // ENABLE(WEB_CRYPTO)
