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

#include "config.h"
#include "CryptoKeyAKP.h"
#include "../wtf-bindings.h"

#if ENABLE(WEB_CRYPTO)

#include "CryptoAlgorithmRegistry.h"
#include "CryptoKeyPair.h"
#include "JsonWebKey.h"
#include <openssl/bytestring.h>
#include <openssl/err.h>
#include <openssl/evp.h>
#include <openssl/mem.h>
#include <wtf/text/Base64.h>

namespace WebCore {

bool CryptoKeyAKP::isMlDsa(CryptoAlgorithmIdentifier identifier)
{
    switch (identifier) {
    case CryptoAlgorithmIdentifier::ML_DSA_44:
    case CryptoAlgorithmIdentifier::ML_DSA_65:
    case CryptoAlgorithmIdentifier::ML_DSA_87:
        return true;
    default:
        return false;
    }
}

bool CryptoKeyAKP::isMlKem(CryptoAlgorithmIdentifier identifier)
{
    switch (identifier) {
    case CryptoAlgorithmIdentifier::ML_KEM_768:
    case CryptoAlgorithmIdentifier::ML_KEM_1024:
        return true;
    default:
        return false;
    }
}

const EVP_PKEY_ALG* CryptoKeyAKP::algForIdentifier(CryptoAlgorithmIdentifier identifier)
{
    switch (identifier) {
    case CryptoAlgorithmIdentifier::ML_DSA_44:
        return EVP_pkey_ml_dsa_44();
    case CryptoAlgorithmIdentifier::ML_DSA_65:
        return EVP_pkey_ml_dsa_65();
    case CryptoAlgorithmIdentifier::ML_DSA_87:
        return EVP_pkey_ml_dsa_87();
    case CryptoAlgorithmIdentifier::ML_KEM_768:
        return EVP_pkey_ml_kem_768();
    case CryptoAlgorithmIdentifier::ML_KEM_1024:
        return EVP_pkey_ml_kem_1024();
    default:
        return nullptr;
    }
}

int CryptoKeyAKP::nidForIdentifier(CryptoAlgorithmIdentifier identifier)
{
    switch (identifier) {
    case CryptoAlgorithmIdentifier::ML_DSA_44:
        return EVP_PKEY_ML_DSA_44;
    case CryptoAlgorithmIdentifier::ML_DSA_65:
        return EVP_PKEY_ML_DSA_65;
    case CryptoAlgorithmIdentifier::ML_DSA_87:
        return EVP_PKEY_ML_DSA_87;
    case CryptoAlgorithmIdentifier::ML_KEM_768:
        return EVP_PKEY_ML_KEM_768;
    case CryptoAlgorithmIdentifier::ML_KEM_1024:
        return EVP_PKEY_ML_KEM_1024;
    default:
        return 0;
    }
}

size_t CryptoKeyAKP::seedSizeForIdentifier(CryptoAlgorithmIdentifier identifier)
{
    // ML-DSA seeds are the 32-byte xi from FIPS 204; ML-KEM seeds are d||z (FIPS 203).
    return isMlKem(identifier) ? 64 : 32;
}

CryptoKeyAKP::CryptoKeyAKP(CryptoAlgorithmIdentifier identifier, CryptoKeyType type, EvpPKeyPtr&& key, bool extractable, CryptoKeyUsageBitmap usages)
    : CryptoKey(identifier, type, extractable, usages)
    , m_key(WTF::move(key))
{
}

RefPtr<CryptoKeyAKP> CryptoKeyAKP::create(CryptoAlgorithmIdentifier identifier, CryptoKeyType type, EvpPKeyPtr&& key, bool extractable, CryptoKeyUsageBitmap usages)
{
    if (!key || EVP_PKEY_id(key.get()) != nidForIdentifier(identifier))
        return nullptr;
    return adoptRef(*new CryptoKeyAKP(identifier, type, WTF::move(key), extractable, usages));
}

auto CryptoKeyAKP::algorithm() const -> KeyAlgorithm
{
    CryptoKeyAlgorithm result;
    result.name = CryptoAlgorithmRegistry::singleton().name(algorithmIdentifier());
    return result;
}

static std::optional<Vector<uint8_t>> rawPublicKeyBytes(const EVP_PKEY* key)
{
    size_t publicLength = 0;
    if (!EVP_PKEY_get_raw_public_key(key, nullptr, &publicLength))
        return std::nullopt;
    Vector<uint8_t> publicData(publicLength);
    if (!EVP_PKEY_get_raw_public_key(key, publicData.begin(), &publicLength))
        return std::nullopt;
    publicData.shrink(publicLength);
    return publicData;
}

static EvpPKeyPtr publicKeyFromPrivate(const EVP_PKEY* privateKey, const EVP_PKEY_ALG* alg)
{
    auto publicData = rawPublicKeyBytes(privateKey);
    if (!publicData)
        return nullptr;
    return EvpPKeyPtr(EVP_PKEY_from_raw_public_key(alg, publicData->begin(), publicData->size()));
}

ExceptionOr<CryptoKeyPair> CryptoKeyAKP::generatePair(CryptoAlgorithmIdentifier identifier, bool extractable, CryptoKeyUsageBitmap publicUsages, CryptoKeyUsageBitmap privateUsages)
{
    const EVP_PKEY_ALG* alg = algForIdentifier(identifier);
    int nid = nidForIdentifier(identifier);
    if (!alg || !nid)
        return Exception { OperationError };

    EvpPKeyCtxPtr ctx(EVP_PKEY_CTX_new_id(nid, nullptr));
    if (!ctx)
        return Exception { OperationError };

    EVP_PKEY* rawPrivateKey = nullptr;
    if (EVP_PKEY_keygen_init(ctx.get()) <= 0 || EVP_PKEY_keygen(ctx.get(), &rawPrivateKey) <= 0)
        return Exception { OperationError };
    EvpPKeyPtr privateKey(rawPrivateKey);

    EvpPKeyPtr publicKey = publicKeyFromPrivate(privateKey.get(), alg);
    if (!publicKey)
        return Exception { OperationError };

    auto publicCryptoKey = CryptoKeyAKP::create(identifier, CryptoKeyType::Public, WTF::move(publicKey), true, publicUsages);
    auto privateCryptoKey = CryptoKeyAKP::create(identifier, CryptoKeyType::Private, WTF::move(privateKey), extractable, privateUsages);
    if (!publicCryptoKey || !privateCryptoKey)
        return Exception { OperationError };

    return CryptoKeyPair { WTF::move(publicCryptoKey), WTF::move(privateCryptoKey) };
}

RefPtr<CryptoKeyAKP> CryptoKeyAKP::importSpki(CryptoAlgorithmIdentifier identifier, Vector<uint8_t>&& keyData, bool extractable, CryptoKeyUsageBitmap usages, bool* wrongKeyType)
{
    CBS cbs;
    CBS_init(&cbs, keyData.begin(), keyData.size());
    EvpPKeyPtr key(EVP_parse_public_key(&cbs));
    if (!key || CBS_len(&cbs) != 0)
        return nullptr;
    if (EVP_PKEY_id(key.get()) != nidForIdentifier(identifier)) {
        if (wrongKeyType)
            *wrongKeyType = true;
        return nullptr;
    }
    return create(identifier, CryptoKeyType::Public, WTF::move(key), extractable, usages);
}

RefPtr<CryptoKeyAKP> CryptoKeyAKP::importPkcs8(CryptoAlgorithmIdentifier identifier, Vector<uint8_t>&& keyData, bool extractable, CryptoKeyUsageBitmap usages, bool* wrongKeyType)
{
    CBS cbs;
    CBS_init(&cbs, keyData.begin(), keyData.size());
    EvpPKeyPtr key(EVP_parse_private_key(&cbs));
    if (!key || CBS_len(&cbs) != 0)
        return nullptr;
    if (EVP_PKEY_id(key.get()) != nidForIdentifier(identifier)) {
        if (wrongKeyType)
            *wrongKeyType = true;
        return nullptr;
    }
    return create(identifier, CryptoKeyType::Private, WTF::move(key), extractable, usages);
}

RefPtr<CryptoKeyAKP> CryptoKeyAKP::importRawPublic(CryptoAlgorithmIdentifier identifier, Vector<uint8_t>&& keyData, bool extractable, CryptoKeyUsageBitmap usages)
{
    const EVP_PKEY_ALG* alg = algForIdentifier(identifier);
    if (!alg)
        return nullptr;
    EvpPKeyPtr key(EVP_PKEY_from_raw_public_key(alg, keyData.begin(), keyData.size()));
    if (!key)
        return nullptr;
    return create(identifier, CryptoKeyType::Public, WTF::move(key), extractable, usages);
}

RefPtr<CryptoKeyAKP> CryptoKeyAKP::importRawSeed(CryptoAlgorithmIdentifier identifier, Vector<uint8_t>&& keyData, bool extractable, CryptoKeyUsageBitmap usages)
{
    const EVP_PKEY_ALG* alg = algForIdentifier(identifier);
    if (!alg)
        return nullptr;
    EvpPKeyPtr key(EVP_PKEY_from_private_seed(alg, keyData.begin(), keyData.size()));
    if (!key)
        return nullptr;
    return create(identifier, CryptoKeyType::Private, WTF::move(key), extractable, usages);
}

RefPtr<CryptoKeyAKP> CryptoKeyAKP::importJwk(CryptoAlgorithmIdentifier identifier, JsonWebKey&& keyData, bool extractable, CryptoKeyUsageBitmap usages)
{
    const EVP_PKEY_ALG* alg = algForIdentifier(identifier);
    if (!alg)
        return nullptr;

    auto publicData = base64URLDecode(keyData.pub);
    if (!publicData)
        return nullptr;

    if (keyData.priv.isNull()) {
        EvpPKeyPtr key(EVP_PKEY_from_raw_public_key(alg, publicData->begin(), publicData->size()));
        if (!key)
            return nullptr;
        return create(identifier, CryptoKeyType::Public, WTF::move(key), extractable, usages);
    }

    auto seed = base64URLDecode(keyData.priv);
    if (!seed)
        return nullptr;
    EvpPKeyPtr key(EVP_PKEY_from_private_seed(alg, seed->begin(), seed->size()));
    if (!key)
        return nullptr;

    // The JWK carries both halves; reject a "pub" that does not match the seed.
    auto derivedPublic = rawPublicKeyBytes(key.get());
    if (!derivedPublic || derivedPublic->size() != publicData->size())
        return nullptr;
    if (memcmp(derivedPublic->begin(), publicData->begin(), derivedPublic->size()))
        return nullptr;

    return create(identifier, CryptoKeyType::Private, WTF::move(key), extractable, usages);
}

ExceptionOr<Vector<uint8_t>> CryptoKeyAKP::exportSpki() const
{
    if (type() != CryptoKeyType::Public)
        return Exception { InvalidAccessError };

    bssl::ScopedCBB cbb;
    if (!CBB_init(cbb.get(), 0) || !EVP_marshal_public_key(cbb.get(), m_key.get()))
        return Exception { OperationError };

    return Vector<uint8_t>(std::span { CBB_data(cbb.get()), CBB_len(cbb.get()) });
}

ExceptionOr<Vector<uint8_t>> CryptoKeyAKP::exportPkcs8() const
{
    if (type() != CryptoKeyType::Private)
        return Exception { InvalidAccessError };

    bssl::ScopedCBB cbb;
    if (!CBB_init(cbb.get(), 0) || !EVP_marshal_private_key(cbb.get(), m_key.get()))
        return Exception { OperationError };

    return Vector<uint8_t>(std::span { CBB_data(cbb.get()), CBB_len(cbb.get()) });
}

ExceptionOr<Vector<uint8_t>> CryptoKeyAKP::exportRawPublic() const
{
    if (type() != CryptoKeyType::Public)
        return Exception { InvalidAccessError };

    auto result = rawPublicKeyBytes(m_key.get());
    if (!result)
        return Exception { OperationError };
    return WTF::move(*result);
}

ExceptionOr<Vector<uint8_t>> CryptoKeyAKP::exportRawSeed() const
{
    if (type() != CryptoKeyType::Private)
        return Exception { InvalidAccessError };

    size_t length = 0;
    if (!EVP_PKEY_get_private_seed(m_key.get(), nullptr, &length))
        return Exception { OperationError };
    Vector<uint8_t> result(length);
    if (!EVP_PKEY_get_private_seed(m_key.get(), result.begin(), &length))
        return Exception { OperationError };
    return result;
}

ExceptionOr<JsonWebKey> CryptoKeyAKP::exportJwk() const
{
    JsonWebKey result;
    result.kty = "AKP"_s;
    result.alg = CryptoAlgorithmRegistry::singleton().name(algorithmIdentifier());
    result.key_ops = usages();
    result.ext = extractable();

    if (type() == CryptoKeyType::Private) {
        auto seed = exportRawSeed();
        if (seed.hasException())
            return seed.releaseException();
        result.priv = Bun::base64URLEncodeToString(seed.returnValue());
    }

    auto publicData = rawPublicKeyBytes(m_key.get());
    if (!publicData)
        return Exception { OperationError };
    result.pub = Bun::base64URLEncodeToString(*publicData);

    return result;
}

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)
