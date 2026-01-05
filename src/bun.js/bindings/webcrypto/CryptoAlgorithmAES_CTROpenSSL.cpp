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
#include "CryptoAlgorithmAES_CTR.h"

#if ENABLE(WEB_CRYPTO)

#include "CryptoAlgorithmAesCtrParams.h"
#include "CryptoKeyAES.h"
#include "OpenSSLCryptoUniquePtr.h"
#include <openssl/evp.h>

namespace WebCore {

static const EVP_CIPHER* aesAlgorithm(size_t keySize)
{
    if (keySize * 8 == 128)
        return EVP_aes_128_ctr();

    if (keySize * 8 == 192)
        return EVP_aes_192_ctr();

    if (keySize * 8 == 256)
        return EVP_aes_256_ctr();

    return nullptr;
}

static std::optional<Vector<uint8_t>> crypt(int operation, const Vector<uint8_t>& key, const Vector<uint8_t>& counter, size_t counterLength, const Vector<uint8_t>& inputText)
{
    constexpr size_t blockSize = 16;
    const EVP_CIPHER* algorithm = aesAlgorithm(key.size());
    if (!algorithm)
        return std::nullopt;

    EvpCipherCtxPtr ctx;
    int len;

    // Create and initialize the context
    if (!(ctx = EvpCipherCtxPtr(EVP_CIPHER_CTX_new())))
        return std::nullopt;

    const size_t blocks = roundUpToMultipleOf(blockSize, inputText.size()) / blockSize;

    // Detect loop
    if (counterLength < sizeof(size_t) * 8 && blocks > ((size_t)1 << counterLength))
        return std::nullopt;

    // Calculate capacity before overflow
    CryptoAlgorithmAES_CTR::CounterBlockHelper counterBlockHelper(counter, counterLength);
    size_t capacity = counterBlockHelper.countToOverflowSaturating();

    // Divide data into two parts if necessary
    size_t headSize = inputText.size();
    if (capacity < blocks)
        headSize = capacity * blockSize;

    Vector<uint8_t> outputText(inputText.size());
    // First part
    {
        // Initialize the encryption(decryption) operation
        if (1 != EVP_CipherInit_ex(ctx.get(), algorithm, nullptr, key.begin(), counter.begin(), operation))
            return std::nullopt;

        // Disable padding
        if (1 != EVP_CIPHER_CTX_set_padding(ctx.get(), 0))
            return std::nullopt;

        // Provide the message to be encrypted(decrypted), and obtain the encrypted(decrypted) output
        if (1 != EVP_CipherUpdate(ctx.get(), outputText.begin(), &len, inputText.begin(), headSize))
            return std::nullopt;

        // Finalize the encryption(decryption)
        if (1 != EVP_CipherFinal_ex(ctx.get(), outputText.begin() + len, &len))
            return std::nullopt;
    }

    // Sedond part
    if (capacity < blocks) {
        size_t tailSize = inputText.size() - headSize;

        Vector<uint8_t> remainingCounter = counterBlockHelper.counterVectorAfterOverflow();

        // Initialize the encryption(decryption) operation
        if (1 != EVP_CipherInit_ex(ctx.get(), algorithm, nullptr, key.begin(), remainingCounter.begin(), operation))
            return std::nullopt;

        // Disable padding
        if (1 != EVP_CIPHER_CTX_set_padding(ctx.get(), 0))
            return std::nullopt;

        // Provide the message to be encrypted(decrypted), and obtain the encrypted(decrypted) output
        if (1 != EVP_CipherUpdate(ctx.get(), outputText.begin() + headSize, &len, inputText.begin() + headSize, tailSize))
            return std::nullopt;

        // Finalize the encryption(decryption)
        if (1 != EVP_CipherFinal_ex(ctx.get(), outputText.begin() + headSize + len, &len))
            return std::nullopt;
    }

    return outputText;
}

ExceptionOr<Vector<uint8_t>> CryptoAlgorithmAES_CTR::platformEncrypt(const CryptoAlgorithmAesCtrParams& parameters, const CryptoKeyAES& key, const Vector<uint8_t>& plainText)
{
    auto output = crypt(1, key.key(), parameters.counterVector(), parameters.length, plainText);
    if (!output)
        return Exception { OperationError };
    return WTF::move(*output);
}

ExceptionOr<Vector<uint8_t>> CryptoAlgorithmAES_CTR::platformDecrypt(const CryptoAlgorithmAesCtrParams& parameters, const CryptoKeyAES& key, const Vector<uint8_t>& cipherText)
{
    auto output = crypt(0, key.key(), parameters.counterVector(), parameters.length, cipherText);
    if (!output)
        return Exception { OperationError };
    return WTF::move(*output);
}

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)
