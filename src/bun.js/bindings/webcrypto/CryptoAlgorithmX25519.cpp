/*
 * Copyright (C) 2023 Igalia S.L.
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation; either
 * version 2,1 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Library General Public License for more details.
 *
 * You should have received a copy of the GNU Library General Public License
 * along with this library; see the file COPYING.LIB.  If not, write to
 * the Free Software Foundation, Inc., 51 Franklin Street, Fifth Floor,
 * Boston, MA 02110-1301, USA.
 */

#include "config.h"
#include "CryptoAlgorithmX25519.h"

#if ENABLE(WEB_CRYPTO)

#include "CryptoAlgorithmX25519Params.h"
#include "CryptoKeyOKP.h"
#include "ScriptExecutionContext.h"
#include "CryptoDigest.h"
#include <wtf/CryptographicUtilities.h>

namespace WebCore {

Ref<CryptoAlgorithm> CryptoAlgorithmX25519::create()
{
    return adoptRef(*new CryptoAlgorithmX25519);
}

CryptoAlgorithmIdentifier CryptoAlgorithmX25519::identifier() const
{
    return s_identifier;
}

void CryptoAlgorithmX25519::generateKey(const CryptoAlgorithmParameters&, bool extractable, CryptoKeyUsageBitmap usages, KeyOrKeyPairCallback&& callback, ExceptionCallback&& exceptionCallback, ScriptExecutionContext&)
{
    if (usages & (CryptoKeyUsageEncrypt | CryptoKeyUsageDecrypt | CryptoKeyUsageSign | CryptoKeyUsageVerify | CryptoKeyUsageWrapKey | CryptoKeyUsageUnwrapKey)) {
        exceptionCallback(ExceptionCode::SyntaxError, ""_s);
        return;
    }

    auto result = CryptoKeyOKP::generatePair(CryptoAlgorithmIdentifier::X25519, CryptoKeyOKP::NamedCurve::X25519, extractable, usages);
    if (result.hasException()) {
        exceptionCallback(result.releaseException().code(), ""_s);
        return;
    }

    auto pair = result.releaseReturnValue();
    pair.publicKey->setUsagesBitmap(0);
    pair.privateKey->setUsagesBitmap(pair.privateKey->usagesBitmap() & (CryptoKeyUsageDeriveKey | CryptoKeyUsageDeriveBits));
    callback(WTF::move(pair));
}

#if !PLATFORM(COCOA) && !USE(GCRYPT)
std::optional<Vector<uint8_t>> CryptoAlgorithmX25519::platformDeriveBits(const CryptoKeyOKP&, const CryptoKeyOKP&)
{
    return std::nullopt;
}
#endif

void CryptoAlgorithmX25519::deriveBits(const CryptoAlgorithmParameters& parameters, Ref<CryptoKey>&& baseKey, std::optional<size_t> length, VectorCallback&& callback, ExceptionCallback&& exceptionCallback, ScriptExecutionContext& context, WorkQueue& workQueue)
{
    if (baseKey->type() != CryptoKey::Type::Private) {
        exceptionCallback(ExceptionCode::InvalidAccessError, ""_s);
        return;
    }
    auto& ecParameters = downcast<CryptoAlgorithmX25519Params>(parameters);
    ASSERT(ecParameters.publicKey);
    if (ecParameters.publicKey->type() != CryptoKey::Type::Public) {
        exceptionCallback(ExceptionCode::InvalidAccessError, ""_s);
        return;
    }
    if (baseKey->algorithmIdentifier() != ecParameters.publicKey->algorithmIdentifier()) {
        exceptionCallback(ExceptionCode::InvalidAccessError, ""_s);
        return;
    }
    auto& ecBaseKey = downcast<CryptoKeyOKP>(baseKey.get());
    auto& ecPublicKey = downcast<CryptoKeyOKP>(*(ecParameters.publicKey.get()));
    if (ecBaseKey.namedCurve() != ecPublicKey.namedCurve()) {
        exceptionCallback(ExceptionCode::InvalidAccessError, ""_s);
        return;
    }

    // Return an empty string doesn't make much sense, but truncating either at all.
    // https://github.com/WICG/webcrypto-secure-curves/pull/29
    if (length && !(*length)) {
        // Avoid executing the key-derivation, since we are going to return an empty string.
        callback({});
        return;
    }

    auto unifiedCallback = [callback = WTF::move(callback), exceptionCallback = WTF::move(exceptionCallback)](std::optional<Vector<uint8_t>>&& derivedKey, std::optional<size_t> length) mutable {
        if (!derivedKey) {
            exceptionCallback(ExceptionCode::OperationError, ""_s);
            return;
        }
        if (!length) {
            callback(WTF::move(*derivedKey));
            return;
        }
#if !HAVE(X25519_ZERO_CHECKS)
        // https://datatracker.ietf.org/doc/html/rfc7748#section-6.1
        constexpr auto expectedOutputSize = 32;
        constexpr std::array<uint8_t, expectedOutputSize> zeros {};
        if (derivedKey->size() != expectedOutputSize || !constantTimeMemcmp(derivedKey->span(), zeros)) {
            exceptionCallback(ExceptionCode::OperationError, ""_s);
            return;
        }
#endif
        auto lengthInBytes = std::ceil(*length / 8.);
        if (lengthInBytes > (*derivedKey).size()) {
            exceptionCallback(ExceptionCode::OperationError, ""_s);
            return;
        }
        (*derivedKey).shrink(lengthInBytes);
        callback(WTF::move(*derivedKey));
    };
    // This is a special case that can't use dispatchOperation() because it bundles
    // the result validation and callback dispatch into unifiedCallback.
    workQueue.dispatch(
        context.globalObject(),
        [baseKey = WTF::move(baseKey), publicKey = ecParameters.publicKey, length, unifiedCallback = WTF::move(unifiedCallback), contextIdentifier = context.identifier()]() mutable {
            auto derivedKey = platformDeriveBits(downcast<CryptoKeyOKP>(baseKey.get()), downcast<CryptoKeyOKP>(*publicKey));
            ScriptExecutionContext::postTaskTo(contextIdentifier, [derivedKey = WTF::move(derivedKey), length, unifiedCallback = WTF::move(unifiedCallback)](auto&) mutable {
                unifiedCallback(WTF::move(derivedKey), length);
            });
        });
}

void CryptoAlgorithmX25519::importKey(CryptoKeyFormat format, KeyData&& data, const CryptoAlgorithmParameters&, bool extractable, CryptoKeyUsageBitmap usages, KeyCallback&& callback, ExceptionCallback&& exceptionCallback)
{
    RefPtr<CryptoKeyOKP> result;
    switch (format) {
    case CryptoKeyFormat::Jwk: {
        JsonWebKey key = WTF::move(std::get<JsonWebKey>(data));

        bool isUsagesAllowed = false;
        if (!key.d.isNull()) {
            isUsagesAllowed = isUsagesAllowed || !(usages ^ CryptoKeyUsageDeriveKey);
            isUsagesAllowed = isUsagesAllowed || !(usages ^ CryptoKeyUsageDeriveBits);
            isUsagesAllowed = isUsagesAllowed || !(usages ^ (CryptoKeyUsageDeriveKey | CryptoKeyUsageDeriveBits));
        }
        isUsagesAllowed = isUsagesAllowed || !usages;
        if (!isUsagesAllowed) {
            exceptionCallback(ExceptionCode::SyntaxError, ""_s);
            return;
        }

        if (usages && !key.use.isNull() && key.use != "enc"_s) {
            exceptionCallback(ExceptionCode::DataError, ""_s);
            return;
        }

        result = CryptoKeyOKP::importJwk(CryptoAlgorithmIdentifier::X25519, CryptoKeyOKP::NamedCurve::X25519, WTF::move(key), extractable, usages);
        break;
    }
    case CryptoKeyFormat::Raw:
        if (usages) {
            exceptionCallback(ExceptionCode::SyntaxError, ""_s);
            return;
        }
        result = CryptoKeyOKP::importRaw(CryptoAlgorithmIdentifier::X25519, CryptoKeyOKP::NamedCurve::X25519, WTF::move(std::get<Vector<uint8_t>>(data)), extractable, usages);
        break;
    case CryptoKeyFormat::Spki:
        if (usages) {
            exceptionCallback(ExceptionCode::SyntaxError, ""_s);
            return;
        }
        result = CryptoKeyOKP::importSpki(CryptoAlgorithmIdentifier::X25519, CryptoKeyOKP::NamedCurve::X25519, WTF::move(std::get<Vector<uint8_t>>(data)), extractable, usages);
        break;
    case CryptoKeyFormat::Pkcs8:
        if (usages && (usages ^ CryptoKeyUsageDeriveKey) && (usages ^ CryptoKeyUsageDeriveBits) && (usages ^ (CryptoKeyUsageDeriveKey | CryptoKeyUsageDeriveBits))) {
            exceptionCallback(ExceptionCode::SyntaxError, ""_s);
            return;
        }
        result = CryptoKeyOKP::importPkcs8(CryptoAlgorithmIdentifier::X25519, CryptoKeyOKP::NamedCurve::X25519, WTF::move(std::get<Vector<uint8_t>>(data)), extractable, usages);
        break;
    }
    if (!result) {
        exceptionCallback(ExceptionCode::DataError, ""_s);
        return;
    }

    callback(*result);
}

void CryptoAlgorithmX25519::exportKey(CryptoKeyFormat format, Ref<CryptoKey>&& key, KeyDataCallback&& callback, ExceptionCallback&& exceptionCallback)
{
    const auto& ecKey = downcast<CryptoKeyOKP>(key.get());

    if (!ecKey.keySizeInBits()) {
        exceptionCallback(ExceptionCode::OperationError, ""_s);
        return;
    }

    KeyData result;
    switch (format) {
    case CryptoKeyFormat::Jwk: {
        auto jwk = ecKey.exportJwk();
        if (jwk.hasException()) {
            exceptionCallback(jwk.releaseException().code(), ""_s);
            return;
        }
        result = jwk.releaseReturnValue();
        break;
    }
    case CryptoKeyFormat::Raw: {
        auto raw = ecKey.exportRaw();
        if (raw.hasException()) {
            exceptionCallback(raw.releaseException().code(), ""_s);
            return;
        }
        result = raw.releaseReturnValue();
        break;
    }
    case CryptoKeyFormat::Spki: {
        auto spki = ecKey.exportSpki();
        if (spki.hasException()) {
            exceptionCallback(spki.releaseException().code(), ""_s);
            return;
        }
        result = spki.releaseReturnValue();
        break;
    }
    case CryptoKeyFormat::Pkcs8: {
        auto pkcs8 = ecKey.exportPkcs8();
        if (pkcs8.hasException()) {
            exceptionCallback(pkcs8.releaseException().code(), ""_s);
            return;
        }
        result = pkcs8.releaseReturnValue();
        break;
    }
    }

    callback(format, WTF::move(result));
}

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)
