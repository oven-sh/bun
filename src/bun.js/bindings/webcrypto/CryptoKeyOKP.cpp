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

#include "config.h"
#include "CryptoKeyOKP.h"

#if ENABLE(WEB_CRYPTO)

#include "CryptoAlgorithmRegistry.h"
#include "JsonWebKey.h"
#include <wtf/text/Base64.h>

namespace WebCore {

static const ASCIILiteral X25519 { "X25519"_s };
static const ASCIILiteral Ed25519 { "Ed25519"_s };

static constexpr size_t internalKeySizeInBytesFromNamedCurve(CryptoKeyOKP::NamedCurve curve, CryptoKeyType type)
{
    switch (curve) {
    case CryptoKeyOKP::NamedCurve::X25519:
        return 32;
    case CryptoKeyOKP::NamedCurve::Ed25519:
        return type == CryptoKeyType::Private ? 64 : 32;
    default:
        return -1;
    }
}

static constexpr size_t externalKeySizeInBytesFromNamedCurve(CryptoKeyOKP::NamedCurve curve)
{
    switch (curve) {
    case CryptoKeyOKP::NamedCurve::X25519:
    case CryptoKeyOKP::NamedCurve::Ed25519:
        return 32;
    default:
        return -1;
    }
}

RefPtr<CryptoKeyOKP> CryptoKeyOKP::create(CryptoAlgorithmIdentifier identifier, NamedCurve curve, CryptoKeyType type, KeyMaterial&& platformKey, bool extractable, CryptoKeyUsageBitmap usages)
{
    auto bytesExpectedInternal = internalKeySizeInBytesFromNamedCurve(curve, type);
    if (bytesExpectedInternal == -1)
        return nullptr;

    if (platformKey.size() != bytesExpectedInternal) {
        if (type != CryptoKeyType::Private || curve != NamedCurve::Ed25519)
            return nullptr;

        auto bytesExpectedExternal = externalKeySizeInBytesFromNamedCurve(curve);
        if (bytesExpectedExternal == -1)
            return nullptr;

        // We need to match the internal format when importing a private key
        // Import format only consists of 32 bytes of private key
        // Internal format is private key + public key suffix
        if (platformKey.size() == bytesExpectedExternal) {
            auto&& privateKey = ed25519PrivateFromSeed(WTFMove(platformKey));
            if (privateKey.size() == 0)
                return nullptr;

            return adoptRef(*new CryptoKeyOKP(identifier, curve, type, WTFMove(privateKey), extractable, usages));
        }

        return nullptr;
    }

    return adoptRef(*new CryptoKeyOKP(identifier, curve, type, WTFMove(platformKey), extractable, usages));
}

CryptoKeyOKP::CryptoKeyOKP(CryptoAlgorithmIdentifier identifier, NamedCurve curve, CryptoKeyType type, KeyMaterial&& data, bool extractable, CryptoKeyUsageBitmap usages)
    : CryptoKey(identifier, type, extractable, usages)
    , m_curve(curve)
    , m_data(data)
    , m_exportKey(curve == NamedCurve::Ed25519 && type == CryptoKeyType::Private ? std::optional<Vector<uint8_t>>(Vector<uint8_t>(std::span { data.begin(), 32 })) : std::nullopt)
{
}

ExceptionOr<CryptoKeyPair> CryptoKeyOKP::generatePair(CryptoAlgorithmIdentifier identifier, NamedCurve namedCurve, bool extractable, CryptoKeyUsageBitmap usages)
{
    if (!isPlatformSupportedCurve(namedCurve))
        return Exception { NotSupportedError };

    auto result = platformGeneratePair(identifier, namedCurve, extractable, usages);
    if (!result)
        return Exception { OperationError };

    return WTFMove(*result);
}

RefPtr<CryptoKeyOKP> CryptoKeyOKP::importRaw(CryptoAlgorithmIdentifier identifier, NamedCurve namedCurve, Vector<uint8_t>&& keyData, bool extractable, CryptoKeyUsageBitmap usages)
{
    if (!isPlatformSupportedCurve(namedCurve))
        return nullptr;

    return create(identifier, namedCurve, usages & CryptoKeyUsageSign ? CryptoKeyType::Private : CryptoKeyType::Public, WTFMove(keyData), extractable, usages);
}

RefPtr<CryptoKeyOKP> CryptoKeyOKP::importJwkInternal(CryptoAlgorithmIdentifier identifier, NamedCurve namedCurve, JsonWebKey&& keyData, bool extractable, CryptoKeyUsageBitmap usages, bool onlyPublic)
{
    if (!isPlatformSupportedCurve(namedCurve))
        return nullptr;

    switch (namedCurve) {
    case NamedCurve::Ed25519:
        if (!keyData.d.isEmpty() && !onlyPublic) {
            if (usages & (CryptoKeyUsageEncrypt | CryptoKeyUsageDecrypt | CryptoKeyUsageVerify | CryptoKeyUsageDeriveKey | CryptoKeyUsageDeriveBits | CryptoKeyUsageWrapKey | CryptoKeyUsageUnwrapKey))
                return nullptr;
        } else {
            if (usages & (CryptoKeyUsageEncrypt | CryptoKeyUsageDecrypt | CryptoKeyUsageSign | CryptoKeyUsageDeriveKey | CryptoKeyUsageDeriveBits | CryptoKeyUsageWrapKey | CryptoKeyUsageUnwrapKey))
                return nullptr;
        }
        if (keyData.kty != "OKP"_s)
            return nullptr;
        if (keyData.crv != "Ed25519"_s)
            return nullptr;
        if (usages && !keyData.use.isEmpty() && keyData.use != "sig"_s)
            return nullptr;
        if (keyData.key_ops && ((keyData.usages & usages) != usages))
            return nullptr;
        if (keyData.ext && !keyData.ext.value() && extractable)
            return nullptr;
        break;
    case NamedCurve::X25519:
        if (keyData.crv != "X25519"_s)
            return nullptr;
        // FIXME: Add further checks.
        break;
    }

    if (!onlyPublic) {
        if (!keyData.d.isNull()) {
            // FIXME: Validate keyData.x is paired with keyData.d
            auto d = base64URLDecode(keyData.d);
            if (!d)
                return nullptr;
            return create(identifier, namedCurve, CryptoKeyType::Private, WTFMove(*d), extractable, usages);
        }
    }

    if (keyData.x.isNull())
        return nullptr;

    auto x = base64URLDecode(keyData.x);
    if (!x)
        return nullptr;
    return create(identifier, namedCurve, CryptoKeyType::Public, WTFMove(*x), extractable, usages);
}

RefPtr<CryptoKeyOKP> CryptoKeyOKP::importPublicJwk(CryptoAlgorithmIdentifier identifier, NamedCurve namedCurve, JsonWebKey&& keyData, bool extractable, CryptoKeyUsageBitmap usages)
{
    return importJwkInternal(identifier, namedCurve, WTFMove(keyData), extractable, usages, true);
}
RefPtr<CryptoKeyOKP> CryptoKeyOKP::importJwk(CryptoAlgorithmIdentifier identifier, NamedCurve namedCurve, JsonWebKey&& keyData, bool extractable, CryptoKeyUsageBitmap usages)
{
    return importJwkInternal(identifier, namedCurve, WTFMove(keyData), extractable, usages, false);
}

ExceptionOr<Vector<uint8_t>> CryptoKeyOKP::exportRaw() const
{
    if (type() != CryptoKey::Type::Public)
        return Exception { InvalidAccessError };

    auto&& result = platformExportRaw();
    if (result.isEmpty())
        return Exception { OperationError };
    return WTFMove(result);
}

ExceptionOr<JsonWebKey> CryptoKeyOKP::exportJwk() const
{
    JsonWebKey result {};
    result.kty = "OKP"_s;
    switch (m_curve) {
    case NamedCurve::X25519:
        result.crv = X25519;
        break;
    case NamedCurve::Ed25519:
        result.crv = Ed25519;
        break;
    }

    result.key_ops = usages();
    result.ext = extractable();

    switch (type()) {
    case CryptoKeyType::Private:
        result.d = generateJwkD();
        result.x = generateJwkX();
        break;
    case CryptoKeyType::Public:
        result.x = generateJwkX();
        break;
    case CryptoKeyType::Secret:
        return Exception { OperationError };
    }

    return result;
}

String CryptoKeyOKP::namedCurveString() const
{
    switch (m_curve) {
    case NamedCurve::X25519:
        return X25519;
    case NamedCurve::Ed25519:
        return Ed25519;
    }

    ASSERT_NOT_REACHED();
    return emptyString();
}

bool CryptoKeyOKP::isValidOKPAlgorithm(CryptoAlgorithmIdentifier algorithm)
{
    return algorithm == CryptoAlgorithmIdentifier::Ed25519;
}

auto CryptoKeyOKP::algorithm() const -> KeyAlgorithm
{
    CryptoKeyAlgorithm result;
    // FIXME: This should be set to the actual algorithm name in the case of X25519
    result.name = CryptoAlgorithmRegistry::singleton().name(algorithmIdentifier());

    // This is commented out because the spec doesn't define the namedCurve field for OKP keys
    // switch (m_curve) {
    // case NamedCurve::X25519:
    //     result.namedCurve = X25519;
    //     break;
    // case NamedCurve::Ed25519:
    //     result.namedCurve = Ed25519;
    //     break;
    // }

    return result;
}

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)
