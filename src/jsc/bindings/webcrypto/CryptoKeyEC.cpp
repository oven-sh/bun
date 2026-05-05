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

#include "config.h"
#include "CryptoKeyEC.h"

#if ENABLE(WEB_CRYPTO)

#include "CryptoAlgorithmRegistry.h"
#include "JsonWebKey.h"
#include <wtf/text/Base64.h>

namespace WebCore {

static const ASCIILiteral P256 { "P-256"_s };
static const ASCIILiteral P384 { "P-384"_s };
static const ASCIILiteral P521 { "P-521"_s };

static std::optional<CryptoKeyEC::NamedCurve> toNamedCurve(const String& curve)
{
    if (curve == P256)
        return CryptoKeyEC::NamedCurve::P256;
    if (curve == P384)
        return CryptoKeyEC::NamedCurve::P384;
    if (curve == P521)
        return CryptoKeyEC::NamedCurve::P521;

    return std::nullopt;
}

CryptoKeyEC::CryptoKeyEC(CryptoAlgorithmIdentifier identifier, NamedCurve curve, CryptoKeyType type, PlatformECKeyContainer&& platformKey, bool extractable, CryptoKeyUsageBitmap usages)
    : CryptoKey(identifier, type, extractable, usages)
    , m_platformKey(WTF::move(platformKey))
    , m_curve(curve)
{
    // Only CryptoKeyEC objects for supported curves should be created.
    ASSERT(platformSupportedCurve(curve));
}

ExceptionOr<CryptoKeyPair> CryptoKeyEC::generatePair(CryptoAlgorithmIdentifier identifier, const String& curve, bool extractable, CryptoKeyUsageBitmap usages)
{
    auto namedCurve = toNamedCurve(curve);
    if (!namedCurve || !platformSupportedCurve(*namedCurve))
        return Exception { NotSupportedError };

    auto result = platformGeneratePair(identifier, *namedCurve, extractable, usages);
    if (!result)
        return Exception { OperationError };

    return WTF::move(*result);
}

RefPtr<CryptoKeyEC> CryptoKeyEC::importRaw(CryptoAlgorithmIdentifier identifier, const String& curve, Vector<uint8_t>&& keyData, bool extractable, CryptoKeyUsageBitmap usages)
{
    auto namedCurve = toNamedCurve(curve);
    if (!namedCurve || !platformSupportedCurve(*namedCurve))
        return nullptr;

    return platformImportRaw(identifier, *namedCurve, WTF::move(keyData), extractable, usages);
}

RefPtr<CryptoKeyEC> CryptoKeyEC::importJwk(CryptoAlgorithmIdentifier identifier, const String& curve, JsonWebKey&& keyData, bool extractable, CryptoKeyUsageBitmap usages)
{
    if (keyData.kty != "EC"_s)
        return nullptr;
    if (keyData.key_ops && ((keyData.usages & usages) != usages))
        return nullptr;
    if (keyData.ext && !keyData.ext.value() && extractable)
        return nullptr;

    if (keyData.crv.isNull() || curve != keyData.crv)
        return nullptr;
    auto namedCurve = toNamedCurve(keyData.crv);
    if (!namedCurve || !platformSupportedCurve(*namedCurve))
        return nullptr;

    if (keyData.x.isNull() || keyData.y.isNull())
        return nullptr;
    auto x = base64URLDecode(keyData.x);
    if (!x)
        return nullptr;
    auto y = base64URLDecode(keyData.y);
    if (!y)
        return nullptr;
    if (keyData.d.isNull()) {
        // import public key
        return platformImportJWKPublic(identifier, *namedCurve, WTF::move(*x), WTF::move(*y), extractable, usages);
    }

    auto d = base64URLDecode(keyData.d);
    if (!d)
        return nullptr;
    // import private key
    return platformImportJWKPrivate(identifier, *namedCurve, WTF::move(*x), WTF::move(*y), WTF::move(*d), extractable, usages);
}

RefPtr<CryptoKeyEC> CryptoKeyEC::importSpki(CryptoAlgorithmIdentifier identifier, const String& curve, Vector<uint8_t>&& keyData, bool extractable, CryptoKeyUsageBitmap usages)
{
    auto namedCurve = toNamedCurve(curve);
    if (!namedCurve || !platformSupportedCurve(*namedCurve))
        return nullptr;

    return platformImportSpki(identifier, *namedCurve, WTF::move(keyData), extractable, usages);
}

RefPtr<CryptoKeyEC> CryptoKeyEC::importPkcs8(CryptoAlgorithmIdentifier identifier, const String& curve, Vector<uint8_t>&& keyData, bool extractable, CryptoKeyUsageBitmap usages)
{
    auto namedCurve = toNamedCurve(curve);
    if (!namedCurve || !platformSupportedCurve(*namedCurve))
        return nullptr;

    return platformImportPkcs8(identifier, *namedCurve, WTF::move(keyData), extractable, usages);
}

ExceptionOr<Vector<uint8_t>> CryptoKeyEC::exportRaw() const
{
    if (type() != CryptoKey::Type::Public)
        return Exception { InvalidAccessError };

    auto&& result = platformExportRaw();
    if (result.isEmpty())
        return Exception { OperationError };
    return WTF::move(result);
}

ExceptionOr<JsonWebKey> CryptoKeyEC::exportJwk() const
{
    JsonWebKey result {};
    result.kty = "EC"_s;
    switch (m_curve) {
    case NamedCurve::P256:
        result.crv = P256;
        break;
    case NamedCurve::P384:
        result.crv = P384;
        break;
    case NamedCurve::P521:
        result.crv = P521;
        break;
    }
    result.key_ops = usages();
    result.ext = extractable();
    if (!platformAddFieldElements(result))
        return Exception { OperationError };
    return result;
}

ExceptionOr<Vector<uint8_t>> CryptoKeyEC::exportSpki() const
{
    if (type() != CryptoKey::Type::Public)
        return Exception { InvalidAccessError };

    auto&& result = platformExportSpki();
    if (result.isEmpty())
        return Exception { OperationError };
    return WTF::move(result);
}

ExceptionOr<Vector<uint8_t>> CryptoKeyEC::exportPkcs8() const
{
    if (type() != CryptoKey::Type::Private)
        return Exception { InvalidAccessError };

    auto&& result = platformExportPkcs8();
    if (result.isEmpty())
        return Exception { OperationError };
    return WTF::move(result);
}

String CryptoKeyEC::namedCurveString() const
{
    switch (m_curve) {
    case NamedCurve::P256:
        return String(P256);
    case NamedCurve::P384:
        return String(P384);
    case NamedCurve::P521:
        return String(P521);
    }

    ASSERT_NOT_REACHED();
    return emptyString();
}

bool CryptoKeyEC::isValidECAlgorithm(CryptoAlgorithmIdentifier algorithm)
{
    return algorithm == CryptoAlgorithmIdentifier::ECDSA || algorithm == CryptoAlgorithmIdentifier::ECDH;
}

auto CryptoKeyEC::algorithm() const -> KeyAlgorithm
{
    CryptoEcKeyAlgorithm result;
    result.name = CryptoAlgorithmRegistry::singleton().name(algorithmIdentifier());

    switch (m_curve) {
    case NamedCurve::P256:
        result.namedCurve = P256;
        break;
    case NamedCurve::P384:
        result.namedCurve = P384;
        break;
    case NamedCurve::P521:
        result.namedCurve = P521;
        break;
    }

    return result;
}

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)
