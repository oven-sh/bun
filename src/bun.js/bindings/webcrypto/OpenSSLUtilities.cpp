/*
 * Copyright (C) 2021 Sony Interactive Entertainment Inc.
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
#include "OpenSSLUtilities.h"

#if ENABLE(WEB_CRYPTO)

#include "OpenSSLCryptoUniquePtr.h"

namespace WebCore {

const EVP_MD* digestAlgorithm(CryptoAlgorithmIdentifier hashFunction)
{
    switch (hashFunction) {
    case CryptoAlgorithmIdentifier::SHA_1:
        return EVP_sha1();
    case CryptoAlgorithmIdentifier::SHA_224:
        return EVP_sha224();
    case CryptoAlgorithmIdentifier::SHA_256:
        return EVP_sha256();
    case CryptoAlgorithmIdentifier::SHA_384:
        return EVP_sha384();
    case CryptoAlgorithmIdentifier::SHA_512:
        return EVP_sha512();
    default:
        return nullptr;
    }
}

std::optional<Vector<uint8_t>> calculateDigest(const EVP_MD* algorithm, const Vector<uint8_t>& message)
{
    EvpDigestCtxPtr ctx;
    if (!(ctx = EvpDigestCtxPtr(EVP_MD_CTX_create())))
        return std::nullopt;

    int digestLength = EVP_MD_size(algorithm);
    if (digestLength <= 0)
        return std::nullopt;
    Vector<uint8_t> digest(digestLength);

    if (EVP_DigestInit_ex(ctx.get(), algorithm, nullptr) != 1)
        return std::nullopt;

    if (EVP_DigestUpdate(ctx.get(), message.begin(), message.size()) != 1)
        return std::nullopt;

    if (EVP_DigestFinal_ex(ctx.get(), digest.begin(), nullptr) != 1)
        return std::nullopt;

    return digest;
}

Vector<uint8_t> convertToBytes(const BIGNUM* bignum)
{
    Vector<uint8_t> bytes(BN_num_bytes(bignum));
    BN_bn2bin(bignum, bytes.begin());
    return bytes;
}

Vector<uint8_t> convertToBytesExpand(const BIGNUM* bignum, size_t minimumBufferSize)
{
    int length = BN_num_bytes(bignum);
    if (length < 0)
        return {};

    size_t bufferSize = std::max<size_t>(length, minimumBufferSize);

    Vector<uint8_t> bytes(bufferSize);

    size_t paddingLength = bufferSize - length;
    if (paddingLength > 0) {
        uint8_t padding = BN_is_negative(bignum) ? 0xFF : 0x00;
        for (size_t i = 0; i < paddingLength; i++)
            bytes[i] = padding;
    }
    BN_bn2bin(bignum, bytes.begin() + paddingLength);
    return bytes;
}

BIGNUMPtr convertToBigNumber(const Vector<uint8_t>& bytes)
{
    return BIGNUMPtr(BN_bin2bn(bytes.begin(), bytes.size(), nullptr));
}

bool AESKey::setKey(const Vector<uint8_t>& key, int enc)
{
    size_t keySize = key.size() * 8;
    if (keySize != 128 && keySize != 192 && keySize != 256)
        return false;

    if (enc == AES_ENCRYPT) {
        if (AES_set_encrypt_key(key.begin(), keySize, &m_key) < 0)
            return false;
        return true;
    }

    if (enc == AES_DECRYPT) {
        if (AES_set_decrypt_key(key.begin(), keySize, &m_key) < 0)
            return false;
        return true;
    }

    ASSERT_NOT_REACHED();
    return false;
}

AESKey::~AESKey()
{
    memset(&m_key, 0, sizeof m_key);
}

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)
