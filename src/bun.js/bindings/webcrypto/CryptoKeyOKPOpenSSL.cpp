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
#include "../wtf-bindings.h"
#if ENABLE(WEB_CRYPTO)

#include "JsonWebKey.h"
// #include "Logging.h"
#include <wtf/text/Base64.h>
#include <openssl/curve25519.h>
#include "CommonCryptoDERUtilities.h"

namespace WebCore {

bool CryptoKeyOKP::isPlatformSupportedCurve(NamedCurve namedCurve)
{
    return namedCurve == NamedCurve::Ed25519 || namedCurve == NamedCurve::X25519;
}

std::optional<CryptoKeyPair> CryptoKeyOKP::platformGeneratePair(CryptoAlgorithmIdentifier identifier, NamedCurve namedCurve, bool extractable, CryptoKeyUsageBitmap usages)
{
    if (namedCurve != NamedCurve::Ed25519 && namedCurve != NamedCurve::X25519)
        return {};

    Vector<uint8_t> public_key(ED25519_PUBLIC_KEY_LEN), private_key(ED25519_PRIVATE_KEY_LEN);

    bool isEd25519 = identifier == CryptoAlgorithmIdentifier::Ed25519;
    if (isEd25519) {
        ED25519_keypair(public_key.begin(), private_key.begin());
    } else {
        X25519_keypair(public_key.begin(), private_key.begin());
    }

    bool isPublicKeyExtractable = true;
    auto publicKey = CryptoKeyOKP::create(identifier, namedCurve, CryptoKeyType::Public, WTF::move(public_key), isPublicKeyExtractable, usages);
    ASSERT(publicKey);
    auto privateKey = CryptoKeyOKP::create(identifier, namedCurve, CryptoKeyType::Private, Vector<uint8_t>(std::span { private_key.begin(), isEd25519 ? (unsigned int)ED25519_PRIVATE_KEY_LEN : (unsigned int)X25519_PRIVATE_KEY_LEN }), extractable, usages);
    ASSERT(privateKey);
    return CryptoKeyPair { WTF::move(publicKey), WTF::move(privateKey) };
}

// Per https://www.ietf.org/rfc/rfc5280.txt
// SubjectPublicKeyInfo ::= SEQUENCE { algorithm AlgorithmIdentifier, subjectPublicKey BIT STRING }
// AlgorithmIdentifier  ::= SEQUENCE { algorithm OBJECT IDENTIFIER, parameters ANY DEFINED BY algorithm OPTIONAL }
// Per https://www.rfc-editor.org/rfc/rfc8410
// id-X25519    OBJECT IDENTIFIER ::= { 1 3 101 110 }
// id-X448      OBJECT IDENTIFIER ::= { 1 3 101 111 }
// id-Ed25519   OBJECT IDENTIFIER ::= { 1 3 101 112 }
// id-Ed448     OBJECT IDENTIFIER ::= { 1 3 101 113 }
// For all of the OIDs, the parameters MUST be absent.
RefPtr<CryptoKeyOKP> CryptoKeyOKP::importSpki(CryptoAlgorithmIdentifier identifier, NamedCurve namedCurve, Vector<uint8_t>&& keyData, bool extractable, CryptoKeyUsageBitmap usages)
{
    // FIXME: We should use the underlying crypto library to import PKCS8 OKP keys.

    // Read SEQUENCE
    size_t index = 1;
    if (keyData.size() < index + 1)
        return nullptr;

    // Read length and SEQUENCE
    // FIXME: Check length is 5 + 1 + 1 + 1 + keyByteSize.
    index += bytesUsedToEncodedLength(keyData[index]) + 1;
    if (keyData.size() < index + 1)
        return nullptr;

    // Read length
    // FIXME: Check length is 5.
    index += bytesUsedToEncodedLength(keyData[index]);
    if (keyData.size() < index + 5)
        return nullptr;

    // Read OID
    // FIXME: spec says this is 1 3 101 11X but WPT tests expect 6 3 43 101 11X.
    if (keyData[index++] != 6 || keyData[index++] != 3 || keyData[index++] != 43 || keyData[index++] != 101)
        return nullptr;

    switch (namedCurve) {
    case NamedCurve::X25519:
        if (keyData[index++] != 110)
            return nullptr;
        break;
    case NamedCurve::Ed25519:
        if (keyData[index++] != 112)
            return nullptr;
        break;
    };

    // Read BIT STRING
    if (keyData.size() < index + 1)
        return nullptr;
    if (keyData[index++] != 3)
        return nullptr;

    // Read length
    // FIXME: Check length is keyByteSize + 1.
    index += bytesUsedToEncodedLength(keyData[index]);

    if (keyData.size() < index + 1)
        return nullptr;

    // Initial octet
    if (!!keyData[index])
        return nullptr;
    ++index;

    return create(identifier, namedCurve, CryptoKeyType::Public, std::span<const uint8_t> { keyData.begin() + index, keyData.size() - index }, extractable, usages);
}

constexpr uint8_t OKPOIDFirstByte = 6;
constexpr uint8_t OKPOIDSecondByte = 3;
constexpr uint8_t OKPOIDThirdByte = 43;
constexpr uint8_t OKPOIDFourthByte = 101;
constexpr uint8_t OKPOIDX25519Byte = 110;
constexpr uint8_t OKPOIDEd25519Byte = 112;

static void writeOID(CryptoKeyOKP::NamedCurve namedCurve, Vector<uint8_t>& result)
{
    result.append(OKPOIDFirstByte);
    result.append(OKPOIDSecondByte);
    result.append(OKPOIDThirdByte);
    result.append(OKPOIDFourthByte);

    switch (namedCurve) {
    case CryptoKeyOKP::NamedCurve::X25519:
        result.append(OKPOIDX25519Byte);
        break;
    case CryptoKeyOKP::NamedCurve::Ed25519:
        result.append(OKPOIDEd25519Byte);
        break;
    };
}

ExceptionOr<Vector<uint8_t>> CryptoKeyOKP::exportSpki() const
{
    if (type() != CryptoKeyType::Public)
        return Exception { InvalidAccessError };

    size_t keySize = keySizeInBytes();

    // SEQUENCE, length, SEQUENCE, length, OID, Bit String (Initial octet prepended)
    size_t totalSize = 1 + 1 + 1 + 1 + 5 + 1 + 1 + 1 + keySize;
    Vector<uint8_t> result;
    result.reserveInitialCapacity(totalSize);
    result.append(SequenceMark);
    addEncodedASN1Length(result, totalSize - 2);
    result.append(SequenceMark);
    addEncodedASN1Length(result, 5);

    writeOID(namedCurve(), result);

    result.append(BitStringMark);
    addEncodedASN1Length(result, keySize + 1);
    result.append(InitialOctet);
    result.append(std::span { platformKey().begin(), platformKey().size() });

    ASSERT(result.size() == totalSize);

    return WTF::move(result);
}

// Per https://www.ietf.org/rfc/rfc5280.txt
// PrivateKeyInfo ::= SEQUENCE { version INTEGER, privateKeyAlgorithm AlgorithmIdentifier, privateKey OCTET STRING }
// AlgorithmIdentifier  ::= SEQUENCE { algorithm OBJECT IDENTIFIER, parameters ANY DEFINED BY algorithm OPTIONAL }
// Per https://www.rfc-editor.org/rfc/rfc8410
// id-X25519    OBJECT IDENTIFIER ::= { 1 3 101 110 }
// id-X448      OBJECT IDENTIFIER ::= { 1 3 101 111 }
// id-Ed25519   OBJECT IDENTIFIER ::= { 1 3 101 112 }
// id-Ed448     OBJECT IDENTIFIER ::= { 1 3 101 113 }
// For all of the OIDs, the parameters MUST be absent.
RefPtr<CryptoKeyOKP> CryptoKeyOKP::importPkcs8(CryptoAlgorithmIdentifier identifier, NamedCurve namedCurve, Vector<uint8_t>&& keyData, bool extractable, CryptoKeyUsageBitmap usages)
{
    // FIXME: We should use the underlying crypto library to import PKCS8 OKP keys.

    // Read SEQUENCE
    size_t index = 1;
    if (keyData.size() < index + 1)
        return nullptr;

    // Read length
    index += bytesUsedToEncodedLength(keyData[index]);
    if (keyData.size() < index + 1)
        return nullptr;

    // Read version
    index += 3;
    if (keyData.size() < index + 1)
        return nullptr;

    // Read SEQUENCE
    index += bytesUsedToEncodedLength(keyData[index]);
    if (keyData.size() < index + 1)
        return nullptr;

    // Read length
    index += bytesUsedToEncodedLength(keyData[index]);
    if (keyData.size() < index + 1)
        return nullptr;

    // Read OID
    if (keyData[index++] != OKPOIDFirstByte || keyData[index++] != OKPOIDSecondByte || keyData[index++] != OKPOIDThirdByte || keyData[index++] != OKPOIDFourthByte)
        return nullptr;

    switch (namedCurve) {
    case NamedCurve::X25519:
        if (keyData[index++] != OKPOIDX25519Byte)
            return nullptr;
        break;
    case NamedCurve::Ed25519:
        if (keyData[index++] != OKPOIDEd25519Byte)
            return nullptr;
        break;
    };

    // Read OCTET STRING
    if (keyData.size() < index + 1)
        return nullptr;

    if (keyData[index++] != 4)
        return nullptr;

    index += bytesUsedToEncodedLength(keyData[index]);
    if (keyData.size() < index + 1)
        return nullptr;

    // Read OCTET STRING
    if (keyData[index++] != 4)
        return nullptr;

    index += bytesUsedToEncodedLength(keyData[index]);
    if (keyData.size() < index + 1)
        return nullptr;

    return create(identifier, namedCurve, CryptoKeyType::Private, std::span<const uint8_t> { keyData.begin() + index, keyData.size() - index }, extractable, usages);
}

ExceptionOr<Vector<uint8_t>> CryptoKeyOKP::exportPkcs8() const
{
    if (type() != CryptoKeyType::Private)
        return Exception { InvalidAccessError };

    size_t keySize = exportKeySizeInBytes();

    // SEQUENCE, length, version SEQUENCE, length, OID, Octet String Octet String
    size_t totalSize = 1 + 1 + 3 + 1 + 1 + 5 + 1 + 1 + 1 + 1 + keySize;
    Vector<uint8_t> result;
    result.reserveInitialCapacity(totalSize);
    result.append(SequenceMark);
    addEncodedASN1Length(result, totalSize - 2);

    result.append(2);
    result.append(1);
    result.append(0);

    result.append(SequenceMark);
    addEncodedASN1Length(result, 5);

    writeOID(namedCurve(), result);

    result.append(OctetStringMark);
    addEncodedASN1Length(result, keySize + 2);
    result.append(OctetStringMark);
    addEncodedASN1Length(result, keySize);
    result.append(std::span { exportKey().begin(), exportKey().size() });

    ASSERT(result.size() == totalSize);

    return WTF::move(result);
}

String CryptoKeyOKP::generateJwkD() const
{
    ASSERT(type() == CryptoKeyType::Private);
    if (namedCurve() == NamedCurve::Ed25519) {
        ASSERT(m_exportKey);
        return Bun::base64URLEncodeToString(*m_exportKey);
    }
    return Bun::base64URLEncodeToString(m_data);
}

CryptoKeyOKP::KeyMaterial CryptoKeyOKP::ed25519PublicFromPrivate(const KeyMaterial& seed)
{
    auto publicKey = KeyMaterial(ED25519_PUBLIC_KEY_LEN);
    uint8_t privateKey[ED25519_PRIVATE_KEY_LEN];

    ED25519_keypair_from_seed(publicKey.begin(), privateKey, seed.begin());

    return publicKey;
}

CryptoKeyOKP::KeyMaterial CryptoKeyOKP::x25519PublicFromPrivate(const KeyMaterial& privateKey)
{
    auto publicKey = KeyMaterial(X25519_PUBLIC_VALUE_LEN);

    X25519_public_from_private(publicKey.begin(), privateKey.begin());

    return publicKey;
}

CryptoKeyOKP::KeyMaterial CryptoKeyOKP::ed25519PrivateFromSeed(KeyMaterial&& seed)
{
    uint8_t publicKey[ED25519_PUBLIC_KEY_LEN];
    auto privateKey = KeyMaterial(ED25519_PRIVATE_KEY_LEN);

    ED25519_keypair_from_seed(publicKey, privateKey.begin(), seed.begin());

    return privateKey;
}

String CryptoKeyOKP::generateJwkX() const
{
    if (type() == CryptoKeyType::Public)
        return Bun::base64URLEncodeToString(m_data);

    ASSERT(type() == CryptoKeyType::Private);

    if (namedCurve() == NamedCurve::Ed25519)
        return Bun::base64URLEncodeToString(ed25519PublicFromPrivate(const_cast<KeyMaterial&>(m_data)));

    ASSERT(namedCurve() == NamedCurve::X25519);
    return Bun::base64URLEncodeToString(x25519PublicFromPrivate(const_cast<KeyMaterial&>(m_data)));
}

CryptoKeyOKP::KeyMaterial CryptoKeyOKP::platformExportRaw() const
{
    if (namedCurve() == NamedCurve::Ed25519 && type() == CryptoKeyType::Private) {
        ASSERT(m_exportKey);
        const auto& exportKey = *m_exportKey;
        return Vector<uint8_t>(exportKey.span());
    }
    return KeyMaterial(m_data.span());
}

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)
