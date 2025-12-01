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
#include "CryptoAlgorithmAES_GCM.h"

#if ENABLE(WEB_CRYPTO)

#include "CryptoAlgorithmAesGcmParams.h"
#include "CryptoKeyAES.h"
#include "OpenSSLCryptoUniquePtr.h"
#include <openssl/evp.h>

namespace WebCore {

static const EVP_CIPHER* aesAlgorithm(size_t keySize)
{
    if (keySize * 8 == 128)
        return EVP_aes_128_gcm();

    if (keySize * 8 == 192)
        return EVP_aes_192_gcm();

    if (keySize * 8 == 256)
        return EVP_aes_256_gcm();

    return nullptr;
}

static std::optional<Vector<uint8_t>> cryptEncrypt(const Vector<uint8_t>& key, const Vector<uint8_t>& iv, const Vector<uint8_t>& plainText, const Vector<uint8_t>& additionalData, uint8_t tagLength)
{
    const EVP_CIPHER* algorithm = aesAlgorithm(key.size());
    if (!algorithm)
        return std::nullopt;

    EvpCipherCtxPtr ctx;
    int len = 0;

    Vector<uint8_t> cipherText(plainText.size() + tagLength);
    size_t tagOffset = plainText.size();

    // Create and initialize the context
    if (!(ctx = EvpCipherCtxPtr(EVP_CIPHER_CTX_new())))
        return std::nullopt;

    // Disable padding
    if (1 != EVP_CIPHER_CTX_set_padding(ctx.get(), 0))
        return std::nullopt;

    // Initialize the encryption operation
    if (1 != EVP_EncryptInit_ex(ctx.get(), algorithm, nullptr, nullptr, nullptr))
        return std::nullopt;

    // Set IV length
    if (1 != EVP_CIPHER_CTX_ctrl(ctx.get(), EVP_CTRL_GCM_SET_IVLEN, iv.size(), nullptr))
        return std::nullopt;

    // Initialize key and IV
    if (1 != EVP_EncryptInit_ex(ctx.get(), nullptr, nullptr, key.begin(), iv.begin()))
        return std::nullopt;

    // Provide any AAD data
    if (additionalData.size() > 0) {
        if (1 != EVP_EncryptUpdate(ctx.get(), nullptr, &len, additionalData.begin(), additionalData.size()))
            return std::nullopt;
    }

    // Provide the message to be encrypted, and obtain the encrypted output
    if (plainText.size() > 0) {
        if (1 != EVP_EncryptUpdate(ctx.get(), cipherText.begin(), &len, plainText.begin(), plainText.size()))
            return std::nullopt;
    }

    // Finalize the encryption. Normally ciphertext bytes may be written at
    // this stage, but this does not occur in GCM mode since it is not padded.
    // We're still required to call it however to signal that the tag should be written next.
    if (1 != EVP_EncryptFinal_ex(ctx.get(), cipherText.begin() + len, &len))
        return std::nullopt;

    // Get the tag
    if (1 != EVP_CIPHER_CTX_ctrl(ctx.get(), EVP_CTRL_GCM_GET_TAG, tagLength, cipherText.begin() + tagOffset))
        return std::nullopt;

    return cipherText;
}

static std::optional<Vector<uint8_t>> cryptDecrypt(const Vector<uint8_t>& key, const Vector<uint8_t>& iv, const Vector<uint8_t>& cipherText, const Vector<uint8_t>& additionalData, uint8_t tagLength)
{
    const EVP_CIPHER* algorithm = aesAlgorithm(key.size());
    if (!algorithm)
        return std::nullopt;

    EvpCipherCtxPtr ctx;
    int len;
    int plainTextLen;
    int cipherTextLen = cipherText.size() - tagLength;

    Vector<uint8_t> plainText(cipherText.size());
    Vector<uint8_t> tag { std::span { cipherText.begin() + cipherTextLen, tagLength } };

    // Create and initialize the context
    if (!(ctx = EvpCipherCtxPtr(EVP_CIPHER_CTX_new())))
        return std::nullopt;

    // Disable padding
    if (1 != EVP_CIPHER_CTX_set_padding(ctx.get(), 0))
        return std::nullopt;

    // Initialize the encryption operation
    if (1 != EVP_DecryptInit_ex(ctx.get(), algorithm, nullptr, nullptr, nullptr))
        return std::nullopt;

    // Set IV length
    if (1 != EVP_CIPHER_CTX_ctrl(ctx.get(), EVP_CTRL_GCM_SET_IVLEN, iv.size(), nullptr))
        return std::nullopt;

    // Initialize key and IV
    if (1 != EVP_DecryptInit_ex(ctx.get(), nullptr, nullptr, key.begin(), iv.begin()))
        return std::nullopt;

    // Provide any AAD data
    if (additionalData.size() > 0) {
        if (1 != EVP_DecryptUpdate(ctx.get(), nullptr, &len, additionalData.begin(), additionalData.size()))
            return std::nullopt;
    }

    // Set expected tag value
    if (1 != EVP_CIPHER_CTX_ctrl(ctx.get(), EVP_CTRL_GCM_SET_TAG, tag.size(), tag.begin()))
        return std::nullopt;

    // Provide the message to be encrypted, and obtain the encrypted output
    if (1 != EVP_DecryptUpdate(ctx.get(), plainText.begin(), &len, cipherText.begin(), cipherTextLen))
        return std::nullopt;
    plainTextLen = len;

    // Finalize the decryption
    if (1 != EVP_DecryptFinal_ex(ctx.get(), plainText.begin() + len, &len))
        return std::nullopt;

    plainTextLen += len;

    plainText.shrink(plainTextLen);

    return plainText;
}

ExceptionOr<Vector<uint8_t>> CryptoAlgorithmAES_GCM::platformEncrypt(const CryptoAlgorithmAesGcmParams& parameters, const CryptoKeyAES& key, const Vector<uint8_t>& plainText)
{
    auto output = cryptEncrypt(key.key(), parameters.ivVector(), plainText, parameters.additionalDataVector(), parameters.tagLength.value_or(0) / 8);
    if (!output)
        return Exception { OperationError };
    return WTFMove(*output);
}

ExceptionOr<Vector<uint8_t>> CryptoAlgorithmAES_GCM::platformDecrypt(const CryptoAlgorithmAesGcmParams& parameters, const CryptoKeyAES& key, const Vector<uint8_t>& cipherText)
{
    auto output = cryptDecrypt(key.key(), parameters.ivVector(), cipherText, parameters.additionalDataVector(), parameters.tagLength.value_or(0) / 8);
    if (!output)
        return Exception { OperationError };
    return WTFMove(*output);
}

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)
