/*
 * Copyright (C) 2020 Sony Interactive Entertainment Inc.
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
#include "../wtf-bindings.h"

#if ENABLE(WEB_CRYPTO)

#include "JsonWebKey.h"
#include "OpenSSLUtilities.h"
#include <wtf/text/Base64.h>

namespace WebCore {

static int curveIdentifier(CryptoKeyEC::NamedCurve curve)
{
    switch (curve) {
    case CryptoKeyEC::NamedCurve::P256:
        return NID_X9_62_prime256v1;
    case CryptoKeyEC::NamedCurve::P384:
        return NID_secp384r1;
    case CryptoKeyEC::NamedCurve::P521:
        return NID_secp521r1;
    }

    ASSERT_NOT_REACHED();
    return NID_undef;
}

static size_t curveSize(CryptoKeyEC::NamedCurve curve)
{
    switch (curve) {
    case CryptoKeyEC::NamedCurve::P256:
        return 256;
    case CryptoKeyEC::NamedCurve::P384:
        return 384;
    case CryptoKeyEC::NamedCurve::P521:
        return 521;
    }

    ASSERT_NOT_REACHED();
    return 0;
}

static ECKeyPtr createECKey(CryptoKeyEC::NamedCurve curve)
{
    auto key = ECKeyPtr(EC_KEY_new_by_curve_name(curveIdentifier(curve)));
    if (key) {
        // OPENSSL_EC_NAMED_CURVE needs to be set to export the key with the curve name, not with the curve parameters.
        EC_KEY_set_asn1_flag(key.get(), OPENSSL_EC_NAMED_CURVE);
    }
    return key;
}

// This function verifies that the group represents the named curve.
static bool verifyCurve(const EC_GROUP* group, CryptoKeyEC::NamedCurve curve)
{
    if (!group)
        return false;

    auto key = createECKey(curve);
    if (!key)
        return false;

    return !EC_GROUP_cmp(group, EC_KEY_get0_group(key.get()), nullptr);
}

size_t CryptoKeyEC::keySizeInBits() const
{
    // EVP_PKEY_size() returns the size of DER-encoded key and cannot be used for this function's purpose.
    // Instead we resolve the key size by CryptoKeyEC::NamedCurve.
    size_t size = curveSize(m_curve);
    return size;
}

bool CryptoKeyEC::platformSupportedCurve(NamedCurve curve)
{
    return curve == NamedCurve::P256 || curve == NamedCurve::P384 || curve == NamedCurve::P521;
}

std::optional<CryptoKeyPair> CryptoKeyEC::platformGeneratePair(CryptoAlgorithmIdentifier identifier, NamedCurve curve, bool extractable, CryptoKeyUsageBitmap usages)
{
    // To generate a key pair, we generate a private key and extract the public key from the private key.
    auto privateECKey = createECKey(curve);
    if (!privateECKey)
        return std::nullopt;

    if (EC_KEY_generate_key(privateECKey.get()) <= 0)
        return std::nullopt;

    auto point = ECPointPtr(EC_POINT_dup(EC_KEY_get0_public_key(privateECKey.get()), EC_KEY_get0_group(privateECKey.get())));
    if (!point)
        return std::nullopt;

    auto publicECKey = createECKey(curve);
    if (!publicECKey)
        return std::nullopt;

    if (EC_KEY_set_public_key(publicECKey.get(), point.get()) <= 0)
        return std::nullopt;

    auto privatePKey = EvpPKeyPtr(EVP_PKEY_new());
    if (EVP_PKEY_set1_EC_KEY(privatePKey.get(), privateECKey.get()) <= 0)
        return std::nullopt;

    auto publicPKey = EvpPKeyPtr(EVP_PKEY_new());
    if (EVP_PKEY_set1_EC_KEY(publicPKey.get(), publicECKey.get()) <= 0)
        return std::nullopt;

    auto publicKey = CryptoKeyEC::create(identifier, curve, CryptoKeyType::Public, WTF::move(publicPKey), true, usages);
    auto privateKey = CryptoKeyEC::create(identifier, curve, CryptoKeyType::Private, WTF::move(privatePKey), extractable, usages);
    return CryptoKeyPair { WTF::move(publicKey), WTF::move(privateKey) };
}

RefPtr<CryptoKeyEC> CryptoKeyEC::platformImportRaw(CryptoAlgorithmIdentifier identifier, NamedCurve curve, Vector<uint8_t>&& keyData, bool extractable, CryptoKeyUsageBitmap usages)
{
    auto key = createECKey(curve);
    if (!key)
        return nullptr;

    auto group = EC_KEY_get0_group(key.get());
    auto point = ECPointPtr(EC_POINT_new(group));
    // Load an EC point from the keyData. This point is used as a public key.
    if (EC_POINT_oct2point(group, point.get(), keyData.begin(), keyData.size(), nullptr) <= 0)
        return nullptr;

    if (EC_KEY_set_public_key(key.get(), point.get()) <= 0)
        return nullptr;

    if (EC_KEY_check_key(key.get()) <= 0)
        return nullptr;

    auto pkey = EvpPKeyPtr(EVP_PKEY_new());
    if (EVP_PKEY_set1_EC_KEY(pkey.get(), key.get()) <= 0)
        return nullptr;

    return create(identifier, curve, CryptoKeyType::Public, WTF::move(pkey), extractable, usages);
}

RefPtr<CryptoKeyEC> CryptoKeyEC::platformImportJWKPublic(CryptoAlgorithmIdentifier identifier, NamedCurve curve, Vector<uint8_t>&& x, Vector<uint8_t>&& y, bool extractable, CryptoKeyUsageBitmap usages)
{
    auto key = createECKey(curve);
    if (!key)
        return nullptr;

    auto group = EC_KEY_get0_group(key.get());
    auto point = ECPointPtr(EC_POINT_new(group));

    // Currently we only support elliptic curves over GF(p).
    if (EC_POINT_set_affine_coordinates_GFp(group, point.get(), convertToBigNumber(x).get(), convertToBigNumber(y).get(), nullptr) <= 0)
        return nullptr;

    if (EC_KEY_set_public_key(key.get(), point.get()) <= 0)
        return nullptr;

    if (EC_KEY_check_key(key.get()) <= 0)
        return nullptr;

    auto pkey = EvpPKeyPtr(EVP_PKEY_new());
    if (EVP_PKEY_set1_EC_KEY(pkey.get(), key.get()) <= 0)
        return nullptr;

    return create(identifier, curve, CryptoKeyType::Public, WTF::move(pkey), extractable, usages);
}

RefPtr<CryptoKeyEC> CryptoKeyEC::platformImportJWKPrivate(CryptoAlgorithmIdentifier identifier, NamedCurve curve, Vector<uint8_t>&& x, Vector<uint8_t>&& y, Vector<uint8_t>&& d, bool extractable, CryptoKeyUsageBitmap usages)
{
    auto key = createECKey(curve);
    if (!key)
        return nullptr;

    auto group = EC_KEY_get0_group(key.get());
    auto point = ECPointPtr(EC_POINT_new(group));

    // Currently we only support elliptic curves over GF(p).
    if (EC_POINT_set_affine_coordinates_GFp(group, point.get(), convertToBigNumber(x).get(), convertToBigNumber(y).get(), nullptr) <= 0)
        return nullptr;

    if (EC_KEY_set_public_key(key.get(), point.get()) <= 0)
        return nullptr;

    if (EC_KEY_set_private_key(key.get(), convertToBigNumber(d).get()) <= 0)
        return nullptr;

    if (EC_KEY_check_key(key.get()) <= 0)
        return nullptr;

    auto pkey = EvpPKeyPtr(EVP_PKEY_new());
    if (EVP_PKEY_set1_EC_KEY(pkey.get(), key.get()) <= 0)
        return nullptr;

    return create(identifier, curve, CryptoKeyType::Private, WTF::move(pkey), extractable, usages);
}

static const ASN1_OBJECT* ecPublicKeyIdentifier()
{
    static ASN1_OBJECT* oid = OBJ_txt2obj("1.2.840.10045.2.1", 1);
    return oid;
}

static const ASN1_OBJECT* ecDHIdentifier()
{
    static ASN1_OBJECT* oid = OBJ_txt2obj("1.3.132.1.12", 1);
    return oid;
}

static bool supportedAlgorithmIdentifier(CryptoAlgorithmIdentifier identifier, const ASN1_OBJECT* oid)
{
    switch (identifier) {
    case CryptoAlgorithmIdentifier::ECDSA:
        // ECDSA only supports id-ecPublicKey algorithms for imported keys.
        if (!OBJ_cmp(oid, ecPublicKeyIdentifier()))
            return true;
        return false;
    case CryptoAlgorithmIdentifier::ECDH:
        // ECDH supports both id-ecPublicKey and id-ecDH algorithms for imported keys.
        if (!OBJ_cmp(oid, ecPublicKeyIdentifier()))
            return true;
        if (!OBJ_cmp(oid, ecDHIdentifier()))
            return true;
        return false;
    default:
        ASSERT_NOT_REACHED();
        return false;
    }
}

RefPtr<CryptoKeyEC> CryptoKeyEC::platformImportSpki(CryptoAlgorithmIdentifier identifier, NamedCurve curve, Vector<uint8_t>&& keyData, bool extractable, CryptoKeyUsageBitmap usages)
{
    // In this function we extract the subjectPublicKey after verifying that the algorithm in the SPKI data
    // match the given identifier and curve. Then construct an EC key with the named curve and set the public key.

    // SubjectPublicKeyInfo  ::=  SEQUENCE  {
    //   algorithm         AlgorithmIdentifier,
    //   subjectPublicKey  BIT STRING
    // }

    const uint8_t* ptr = keyData.begin();
    auto subjectPublicKeyInfo = ASN1SequencePtr(d2i_ASN1_SEQUENCE_ANY(nullptr, &ptr, keyData.size()));
    if (!subjectPublicKeyInfo)
        return nullptr;
    if (ptr - keyData.begin() != (ptrdiff_t)keyData.size())
        return nullptr;

    if (sk_ASN1_TYPE_num(subjectPublicKeyInfo.get()) != 2)
        return nullptr;

    ASN1_TYPE* value = sk_ASN1_TYPE_value(subjectPublicKeyInfo.get(), 0);
    if (value->type != V_ASN1_SEQUENCE)
        return nullptr;

    // AlgorithmIdentifier  ::=  SEQUENCE  {
    //     algorithm   OBJECT IDENTIFIER,
    //     parameters  ANY DEFINED BY algorithm OPTIONAL
    // }

    ptr = value->value.sequence->data;
    auto algorithm = ASN1SequencePtr(d2i_ASN1_SEQUENCE_ANY(nullptr, &ptr, value->value.sequence->length));
    if (!algorithm)
        return nullptr;

    if (sk_ASN1_TYPE_num(algorithm.get()) != 2)
        return nullptr;

    value = sk_ASN1_TYPE_value(algorithm.get(), 0);
    if (value->type != V_ASN1_OBJECT)
        return nullptr;

    if (!supportedAlgorithmIdentifier(identifier, value->value.object))
        return nullptr;

    // ECParameters ::= CHOICE {
    //  namedCurve         OBJECT IDENTIFIER
    //  -- implicitCurve   null
    //  -- specifiedCurve  SpecifiedECDomain
    // }
    //
    // Only "namedCurve" is supported.
    value = sk_ASN1_TYPE_value(algorithm.get(), 1);
    if (value->type != V_ASN1_OBJECT)
        return nullptr;

    int curveNID = OBJ_obj2nid(value->value.object);
    if (curveNID != curveIdentifier(curve))
        return nullptr;

    // subjectPublicKey must be a BIT STRING.
    value = sk_ASN1_TYPE_value(subjectPublicKeyInfo.get(), 1);
    if (value->type != V_ASN1_BIT_STRING)
        return nullptr;

    ASN1_BIT_STRING* bitString = value->value.bit_string;

    // The SPKI data has been verified at this point. We prepare platform data next.
    auto key = createECKey(curve);
    if (!key)
        return nullptr;

    auto group = EC_KEY_get0_group(key.get());
    if (!group)
        return nullptr;

    auto point = ECPointPtr(EC_POINT_new(group));
    if (!point)
        return nullptr;

    if (EC_POINT_oct2point(group, point.get(), bitString->data, bitString->length, 0) <= 0)
        return nullptr;

    if (EC_KEY_set_public_key(key.get(), point.get()) <= 0)
        return nullptr;

    if (EC_KEY_check_key(key.get()) <= 0)
        return nullptr;

    EC_KEY_set_asn1_flag(key.get(), OPENSSL_EC_NAMED_CURVE);

    auto pkey = EvpPKeyPtr(EVP_PKEY_new());
    if (EVP_PKEY_set1_EC_KEY(pkey.get(), key.get()) <= 0)
        return nullptr;

    return adoptRef(new CryptoKeyEC(identifier, curve, CryptoKeyType::Public, WTF::move(pkey), extractable, usages));
}

RefPtr<CryptoKeyEC> CryptoKeyEC::platformImportPkcs8(CryptoAlgorithmIdentifier identifier, NamedCurve curve, Vector<uint8_t>&& keyData, bool extractable, CryptoKeyUsageBitmap usages)
{
    // We need a local pointer variable to pass to d2i (DER to internal) functions().
    const uint8_t* ptr = keyData.begin();

    // We use d2i_PKCS8_PRIV_KEY_INFO() to import a private key.
    auto p8inf = PKCS8PrivKeyInfoPtr(d2i_PKCS8_PRIV_KEY_INFO(nullptr, &ptr, keyData.size()));
    if (!p8inf)
        return nullptr;
    if (ptr - keyData.begin() != (ptrdiff_t)keyData.size())
        return nullptr;

    auto pkey = EvpPKeyPtr(EVP_PKCS82PKEY(p8inf.get()));
    if (!pkey || EVP_PKEY_base_id(pkey.get()) != EVP_PKEY_EC)
        return nullptr;

    auto ecKey = EVP_PKEY_get0_EC_KEY(pkey.get());
    if (!ecKey)
        return nullptr;

    if (EC_KEY_check_key(ecKey) <= 0)
        return nullptr;

    if (!verifyCurve(EC_KEY_get0_group(ecKey), curve))
        return nullptr;

    EC_KEY_set_asn1_flag(ecKey, OPENSSL_EC_NAMED_CURVE);

    return adoptRef(new CryptoKeyEC(identifier, curve, CryptoKeyType::Private, WTF::move(pkey), extractable, usages));
}

Vector<uint8_t> CryptoKeyEC::platformExportRaw() const
{
    EC_KEY* key = EVP_PKEY_get0_EC_KEY(platformKey());
    if (!key)
        return {};

    const EC_POINT* point = EC_KEY_get0_public_key(key);
    const EC_GROUP* group = EC_KEY_get0_group(key);
    size_t keyDataSize = EC_POINT_point2oct(group, point, POINT_CONVERSION_UNCOMPRESSED, nullptr, 0, nullptr);
    if (!keyDataSize)
        return {};

    Vector<uint8_t> keyData(keyDataSize);
    if (EC_POINT_point2oct(group, point, POINT_CONVERSION_UNCOMPRESSED, keyData.begin(), keyData.size(), nullptr) != keyDataSize)
        return {};

    return keyData;
}

bool CryptoKeyEC::platformAddFieldElements(JsonWebKey& jwk) const
{
    size_t keySizeInBytes = (keySizeInBits() + 7) / 8;

    EC_KEY* key = EVP_PKEY_get0_EC_KEY(platformKey());
    if (!key)
        return false;

    const EC_POINT* publicKey = EC_KEY_get0_public_key(key);
    if (publicKey) {
        auto ctx = BNCtxPtr(BN_CTX_new());
        auto x = BIGNUMPtr(BN_new());
        auto y = BIGNUMPtr(BN_new());
        if (1 == EC_POINT_get_affine_coordinates_GFp(EC_KEY_get0_group(key), publicKey, x.get(), y.get(), ctx.get())) {
            jwk.x = Bun::base64URLEncodeToString(convertToBytesExpand(x.get(), keySizeInBytes));
            jwk.y = Bun::base64URLEncodeToString(convertToBytesExpand(y.get(), keySizeInBytes));
        }
    }

    if (type() == Type::Private) {
        const BIGNUM* privateKey = EC_KEY_get0_private_key(key);
        if (privateKey)
            jwk.d = Bun::base64URLEncodeToString(convertToBytesExpand(privateKey, keySizeInBytes));
    }
    return true;
}

Vector<uint8_t> CryptoKeyEC::platformExportSpki() const
{
    if (type() != CryptoKeyType::Public)
        return {};

    int len = i2d_PUBKEY(platformKey(), nullptr);
    if (len < 0)
        return {};

    Vector<uint8_t> keyData(len);
    auto ptr = keyData.begin();
    if (i2d_PUBKEY(platformKey(), &ptr) < 0)
        return {};

    return keyData;
}

Vector<uint8_t> CryptoKeyEC::platformExportPkcs8() const
{
    if (type() != CryptoKeyType::Private)
        return {};

    auto p8inf = PKCS8PrivKeyInfoPtr(EVP_PKEY2PKCS8(platformKey()));
    if (!p8inf)
        return {};

    int len = i2d_PKCS8_PRIV_KEY_INFO(p8inf.get(), nullptr);
    if (len < 0)
        return {};

    Vector<uint8_t> keyData(len);
    auto ptr = keyData.begin();
    if (i2d_PKCS8_PRIV_KEY_INFO(p8inf.get(), &ptr) < 0)
        return {};

    return keyData;
}

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)
