/*
 * Copyright (C) 2017-2019 Apple Inc. All rights reserved.
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

#if 0
#include "CommonCryptoUtilities.h"

typedef CCECCryptorRef PlatformECKey;
namespace WebCore {
struct CCECCryptorRefDeleter {
    void operator()(CCECCryptorRef key) const { CCECCryptorRelease(key); }
};
}
typedef std::unique_ptr<typename std::remove_pointer<CCECCryptorRef>::type, WebCore::CCECCryptorRefDeleter> PlatformECKeyContainer;
#endif

#if USE(GCRYPT)
#include <pal/crypto/gcrypt/Handle.h>

typedef gcry_sexp_t PlatformECKey;
typedef std::unique_ptr<typename std::remove_pointer<gcry_sexp_t>::type, PAL::GCrypt::HandleDeleter<gcry_sexp_t>> PlatformECKeyContainer;
#endif

#if USE(OPENSSL)
#include "OpenSSLCryptoUniquePtr.h"
typedef EVP_PKEY* PlatformECKey;
typedef WebCore::EvpPKeyPtr PlatformECKeyContainer;
#endif

namespace WebCore {

struct JsonWebKey;

class CryptoKeyEC final : public CryptoKey {
public:
    enum class NamedCurve {
        P256,
        P384,
        P521,
    };

    static Ref<CryptoKeyEC> create(CryptoAlgorithmIdentifier identifier, NamedCurve curve, CryptoKeyType type, PlatformECKeyContainer&& platformKey, bool extractable, CryptoKeyUsageBitmap usages)
    {
        return adoptRef(*new CryptoKeyEC(identifier, curve, type, WTF::move(platformKey), extractable, usages));
    }
    virtual ~CryptoKeyEC() = default;

    WEBCORE_EXPORT static ExceptionOr<CryptoKeyPair> generatePair(CryptoAlgorithmIdentifier, const String& curve, bool extractable, CryptoKeyUsageBitmap);
    WEBCORE_EXPORT static RefPtr<CryptoKeyEC> importRaw(CryptoAlgorithmIdentifier, const String& curve, Vector<uint8_t>&& keyData, bool extractable, CryptoKeyUsageBitmap);
    static RefPtr<CryptoKeyEC> importJwk(CryptoAlgorithmIdentifier, const String& curve, JsonWebKey&&, bool extractable, CryptoKeyUsageBitmap);
    static RefPtr<CryptoKeyEC> importSpki(CryptoAlgorithmIdentifier, const String& curve, Vector<uint8_t>&& keyData, bool extractable, CryptoKeyUsageBitmap);
    static RefPtr<CryptoKeyEC> importPkcs8(CryptoAlgorithmIdentifier, const String& curve, Vector<uint8_t>&& keyData, bool extractable, CryptoKeyUsageBitmap);

    WEBCORE_EXPORT ExceptionOr<Vector<uint8_t>> exportRaw() const;
    ExceptionOr<JsonWebKey> exportJwk() const;
    ExceptionOr<Vector<uint8_t>> exportSpki() const;
    ExceptionOr<Vector<uint8_t>> exportPkcs8() const;

    size_t keySizeInBits() const;
    size_t keySizeInBytes() const { return std::ceil(keySizeInBits() / 8.); }
    NamedCurve namedCurve() const { return m_curve; }
    String namedCurveString() const;
    PlatformECKey platformKey() const { return m_platformKey.get(); }
    static bool isValidECAlgorithm(CryptoAlgorithmIdentifier);
    static RefPtr<CryptoKeyEC> platformImportSpki(CryptoAlgorithmIdentifier, NamedCurve, Vector<uint8_t>&& keyData, bool extractable, CryptoKeyUsageBitmap);
    static RefPtr<CryptoKeyEC> platformImportPkcs8(CryptoAlgorithmIdentifier, NamedCurve, Vector<uint8_t>&& keyData, bool extractable, CryptoKeyUsageBitmap);

private:
    CryptoKeyEC(CryptoAlgorithmIdentifier, NamedCurve, CryptoKeyType, PlatformECKeyContainer&&, bool extractable, CryptoKeyUsageBitmap);

    CryptoKeyClass keyClass() const final { return CryptoKeyClass::EC; }

    KeyAlgorithm algorithm() const final;

    static bool platformSupportedCurve(NamedCurve);
    static std::optional<CryptoKeyPair> platformGeneratePair(CryptoAlgorithmIdentifier, NamedCurve, bool extractable, CryptoKeyUsageBitmap);
    static RefPtr<CryptoKeyEC> platformImportRaw(CryptoAlgorithmIdentifier, NamedCurve, Vector<uint8_t>&& keyData, bool extractable, CryptoKeyUsageBitmap);
    static RefPtr<CryptoKeyEC> platformImportJWKPublic(CryptoAlgorithmIdentifier, NamedCurve, Vector<uint8_t>&& x, Vector<uint8_t>&& y, bool extractable, CryptoKeyUsageBitmap);
    static RefPtr<CryptoKeyEC> platformImportJWKPrivate(CryptoAlgorithmIdentifier, NamedCurve, Vector<uint8_t>&& x, Vector<uint8_t>&& y, Vector<uint8_t>&& d, bool extractable, CryptoKeyUsageBitmap);
    Vector<uint8_t> platformExportRaw() const;
    bool platformAddFieldElements(JsonWebKey&) const;
    Vector<uint8_t> platformExportSpki() const;
    Vector<uint8_t> platformExportPkcs8() const;

    PlatformECKeyContainer m_platformKey;
    NamedCurve m_curve;
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_CRYPTO_KEY(CryptoKeyEC, CryptoKeyClass::EC)

#endif // ENABLE(WEB_CRYPTO)
