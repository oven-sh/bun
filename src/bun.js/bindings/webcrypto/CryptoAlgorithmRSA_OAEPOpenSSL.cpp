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
#include "CryptoAlgorithmRSA_OAEP.h"

#if ENABLE(WEB_CRYPTO)

#include "CryptoAlgorithmRsaOaepParams.h"
#include "CryptoKeyRSA.h"
#include "OpenSSLUtilities.h"

#include <openssl/mem.h>

namespace WebCore {

ExceptionOr<Vector<uint8_t>> CryptoAlgorithmRSA_OAEP::platformEncrypt(const CryptoAlgorithmRsaOaepParams& parameters, const CryptoKeyRSA& key, const Vector<uint8_t>& plainText)
{
    return CryptoAlgorithmRSA_OAEP::platformEncryptWithHash(parameters, key, plainText, key.hashAlgorithmIdentifier());
}

ExceptionOr<Vector<uint8_t>> CryptoAlgorithmRSA_OAEP::platformEncryptWithHash(const CryptoAlgorithmRsaOaepParams& parameters, const CryptoKeyRSA& key, const Vector<uint8_t>& plainText, CryptoAlgorithmIdentifier hashIdentifier)
{
    auto ctx = EvpPKeyCtxPtr(EVP_PKEY_CTX_new(key.platformKey(), nullptr));
    if (!ctx)
        return Exception { OperationError };

    if (EVP_PKEY_encrypt_init(ctx.get()) <= 0)
        return Exception { OperationError };

    auto padding = parameters.padding;
    if (padding == 0) {
        padding = RSA_PKCS1_OAEP_PADDING;
    }

    if (EVP_PKEY_CTX_set_rsa_padding(ctx.get(), padding) <= 0)
        return Exception { OperationError };

    if (padding == RSA_PKCS1_OAEP_PADDING) {
        const EVP_MD* md = digestAlgorithm(hashIdentifier);
        if (!md)
            return Exception { NotSupportedError };

        if (EVP_PKEY_CTX_set_rsa_oaep_md(ctx.get(), md) <= 0)
            return Exception { OperationError };

        if (EVP_PKEY_CTX_set_rsa_mgf1_md(ctx.get(), md) <= 0)
            return Exception { OperationError };
    }

    if (!parameters.labelVector().isEmpty()) {
        size_t labelSize = parameters.labelVector().size();
        // The library takes ownership of the label so the caller should not free the original memory pointed to by label.
        auto label = OPENSSL_malloc(labelSize);
        memcpy(label, parameters.labelVector().begin(), labelSize);
        if (EVP_PKEY_CTX_set0_rsa_oaep_label(ctx.get(), reinterpret_cast<uint8_t*>(label), labelSize) <= 0) {
            OPENSSL_free(label);
            return Exception { OperationError };
        }
    }

    size_t cipherTextLen;
    if (EVP_PKEY_encrypt(ctx.get(), nullptr, &cipherTextLen, plainText.begin(), plainText.size()) <= 0)
        return Exception { OperationError };

    Vector<uint8_t> cipherText(cipherTextLen);
    if (EVP_PKEY_encrypt(ctx.get(), cipherText.begin(), &cipherTextLen, plainText.begin(), plainText.size()) <= 0)
        return Exception { OperationError };
    cipherText.shrink(cipherTextLen);

    return cipherText;
}

ExceptionOr<Vector<uint8_t>> CryptoAlgorithmRSA_OAEP::platformDecrypt(const CryptoAlgorithmRsaOaepParams& parameters, const CryptoKeyRSA& key, const Vector<uint8_t>& cipherText)
{
    return CryptoAlgorithmRSA_OAEP::platformDecryptWithHash(parameters, key, cipherText, key.hashAlgorithmIdentifier());
}

ExceptionOr<Vector<uint8_t>> CryptoAlgorithmRSA_OAEP::platformDecryptWithHash(const CryptoAlgorithmRsaOaepParams& parameters, const CryptoKeyRSA& key, const Vector<uint8_t>& cipherText, CryptoAlgorithmIdentifier hashIdentifier)
{
    auto ctx = EvpPKeyCtxPtr(EVP_PKEY_CTX_new(key.platformKey(), nullptr));
    if (!ctx)
        return Exception { OperationError };

    if (EVP_PKEY_decrypt_init(ctx.get()) <= 0)
        return Exception { OperationError };

    auto padding = parameters.padding;
    if (padding == 0) {
        padding = RSA_PKCS1_OAEP_PADDING;
    }

    if (EVP_PKEY_CTX_set_rsa_padding(ctx.get(), padding) <= 0)
        return Exception { OperationError };

    if (padding == RSA_PKCS1_OAEP_PADDING) {
        const EVP_MD* md = digestAlgorithm(hashIdentifier);
        if (!md)
            return Exception { NotSupportedError };

        if (EVP_PKEY_CTX_set_rsa_oaep_md(ctx.get(), md) <= 0)
            return Exception { OperationError };

        if (EVP_PKEY_CTX_set_rsa_mgf1_md(ctx.get(), md) <= 0)
            return Exception { OperationError };
    }

    if (!parameters.labelVector().isEmpty()) {
        size_t labelSize = parameters.labelVector().size();
        // The library takes ownership of the label so the caller should not free the original memory pointed to by label.
        auto label = OPENSSL_malloc(labelSize);
        memcpy(label, parameters.labelVector().begin(), labelSize);
        if (EVP_PKEY_CTX_set0_rsa_oaep_label(ctx.get(), reinterpret_cast<uint8_t*>(label), labelSize) <= 0) {
            OPENSSL_free(label);
            return Exception { OperationError };
        }
    }

    size_t plainTextLen;
    if (EVP_PKEY_decrypt(ctx.get(), nullptr, &plainTextLen, cipherText.begin(), cipherText.size()) <= 0)
        return Exception { OperationError };

    Vector<uint8_t> plainText(plainTextLen);
    if (EVP_PKEY_decrypt(ctx.get(), plainText.begin(), &plainTextLen, cipherText.begin(), cipherText.size()) <= 0)
        return Exception { OperationError };
    plainText.shrink(plainTextLen);

    return plainText;
}

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)
