/*
 * Copyright (C) 2023 Apple Inc. All rights reserved.
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

#if ENABLE(WEB_CRYPTO)

namespace WebCore {

struct JsonWebKey;

class CryptoKeyOKP final : public CryptoKey {
public:
    using KeyMaterial = Vector<uint8_t>;

    enum class NamedCurve {
        X25519,
        Ed25519,
    };

    static RefPtr<CryptoKeyOKP> create(CryptoAlgorithmIdentifier, NamedCurve, CryptoKeyType, KeyMaterial&&, bool extractable, CryptoKeyUsageBitmap);

    WEBCORE_EXPORT static ExceptionOr<CryptoKeyPair> generatePair(CryptoAlgorithmIdentifier, NamedCurve, bool extractable, CryptoKeyUsageBitmap);
    WEBCORE_EXPORT static RefPtr<CryptoKeyOKP> importRaw(CryptoAlgorithmIdentifier, NamedCurve, Vector<uint8_t>&& keyData, bool extractable, CryptoKeyUsageBitmap);
    static RefPtr<CryptoKeyOKP> importPublicJwk(CryptoAlgorithmIdentifier, NamedCurve, JsonWebKey&&, bool extractable, CryptoKeyUsageBitmap);
    static RefPtr<CryptoKeyOKP> importJwk(CryptoAlgorithmIdentifier, NamedCurve, JsonWebKey&&, bool extractable, CryptoKeyUsageBitmap);
    static RefPtr<CryptoKeyOKP> importSpki(CryptoAlgorithmIdentifier, NamedCurve, Vector<uint8_t>&& keyData, bool extractable, CryptoKeyUsageBitmap);
    static RefPtr<CryptoKeyOKP> importPkcs8(CryptoAlgorithmIdentifier, NamedCurve, Vector<uint8_t>&& keyData, bool extractable, CryptoKeyUsageBitmap);

    WEBCORE_EXPORT ExceptionOr<Vector<uint8_t>> exportRaw() const;
    ExceptionOr<JsonWebKey> exportJwk() const;
    ExceptionOr<Vector<uint8_t>> exportSpki() const;
    ExceptionOr<Vector<uint8_t>> exportPkcs8() const;

    NamedCurve namedCurve() const { return m_curve; }
    String namedCurveString() const;
    bool isEd25519PrivateKey() { return namedCurve() == NamedCurve::Ed25519 && type() == CryptoKeyType::Private; };

    static bool isValidOKPAlgorithm(CryptoAlgorithmIdentifier);
    static KeyMaterial ed25519PublicFromPrivate(const KeyMaterial& privateKey);
    static KeyMaterial x25519PublicFromPrivate(const KeyMaterial& privateKey);
    static KeyMaterial ed25519PrivateFromSeed(KeyMaterial&& seed);

    size_t keySizeInBits() const { return platformKey().size() * 8; }
    size_t keySizeInBytes() const { return platformKey().size(); }
    const KeyMaterial& platformKey() const { return m_data; }

    size_t exportKeySizeInBits() const { return exportKey().size() * 8; }
    size_t exportKeySizeInBytes() const { return exportKey().size(); }
    const KeyMaterial& exportKey() const { return !m_exportKey ? m_data : *m_exportKey; };

private:
    CryptoKeyOKP(CryptoAlgorithmIdentifier, NamedCurve, CryptoKeyType, Vector<uint8_t>&&, bool extractable, CryptoKeyUsageBitmap);

    CryptoKeyClass keyClass() const final { return CryptoKeyClass::OKP; }
    KeyAlgorithm algorithm() const final;

    String generateJwkD() const;
    String generateJwkX() const;

    static bool isPlatformSupportedCurve(NamedCurve);
    static std::optional<CryptoKeyPair> platformGeneratePair(CryptoAlgorithmIdentifier, NamedCurve, bool extractable, CryptoKeyUsageBitmap);
    Vector<uint8_t> platformExportRaw() const;
    Vector<uint8_t> platformExportSpki() const;
    Vector<uint8_t> platformExportPkcs8() const;
    static RefPtr<CryptoKeyOKP> importJwkInternal(CryptoAlgorithmIdentifier identifier, NamedCurve namedCurve, JsonWebKey&& keyData, bool extractable, CryptoKeyUsageBitmap usages, bool onlyPublic);

    NamedCurve m_curve;
    KeyMaterial m_data;
    std::optional<KeyMaterial> m_exportKey;
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_CRYPTO_KEY(CryptoKeyOKP, CryptoKeyClass::OKP)

#endif // ENABLE(WEB_CRYPTO)
