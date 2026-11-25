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

static bool setOaepLabel(EVP_PKEY_CTX* ctx, const Vector<uint8_t>& label)
{
    if (label.isEmpty())
        return true;

    auto copy = OpenSSLBytesPtr(static_cast<uint8_t*>(OPENSSL_malloc(label.size())));
    memcpy(copy.get(), label.begin(), label.size());
    if (EVP_PKEY_CTX_set0_rsa_oaep_label(ctx, copy.get(), label.size()) <= 0)
        return false;

    // Ownership transferred to OpenSSL
    copy.release();
    return true;
}

ExceptionOr<Vector<uint8_t>> CryptoAlgorithmRSA_OAEP::platformEncrypt(const CryptoAlgorithmRsaOaepParams& parameters, const CryptoKeyRSA& key, const Vector<uint8_t>& plainText)
{
    auto ctx = EvpPKeyCtxPtr(EVP_PKEY_CTX_new(key.platformKey(), nullptr));
    if (!ctx)
        return Exception { OperationError };

    if (EVP_PKEY_encrypt_init(ctx.get()) <= 0)
        return Exception { OperationError };

    if (EVP_PKEY_CTX_set_rsa_padding(ctx.get(), RSA_PKCS1_OAEP_PADDING) <= 0)
        return Exception { OperationError };

    const EVP_MD* md = digestAlgorithm(key.hashAlgorithmIdentifier());
    if (!md)
        return Exception { NotSupportedError };

    if (EVP_PKEY_CTX_set_rsa_oaep_md(ctx.get(), md) <= 0)
        return Exception { OperationError };

    if (EVP_PKEY_CTX_set_rsa_mgf1_md(ctx.get(), md) <= 0)
        return Exception { OperationError };

    if (!setOaepLabel(ctx.get(), parameters.labelVector()))
        return Exception { OperationError };

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
    auto ctx = EvpPKeyCtxPtr(EVP_PKEY_CTX_new(key.platformKey(), nullptr));
    if (!ctx)
        return Exception { OperationError };

    if (EVP_PKEY_decrypt_init(ctx.get()) <= 0)
        return Exception { OperationError };

    if (EVP_PKEY_CTX_set_rsa_padding(ctx.get(), RSA_PKCS1_OAEP_PADDING) <= 0)
        return Exception { OperationError };

    const EVP_MD* md = digestAlgorithm(key.hashAlgorithmIdentifier());
    if (!md)
        return Exception { NotSupportedError };

    if (EVP_PKEY_CTX_set_rsa_oaep_md(ctx.get(), md) <= 0)
        return Exception { OperationError };

    if (EVP_PKEY_CTX_set_rsa_mgf1_md(ctx.get(), md) <= 0)
        return Exception { OperationError };

    if (!setOaepLabel(ctx.get(), parameters.labelVector()))
        return Exception { OperationError };

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
