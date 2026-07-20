/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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
#include "CryptoAlgorithmChaCha20Poly1305.h"

#if ENABLE(WEB_CRYPTO)

#include "CryptoAlgorithmAeadParams.h"
#include "CryptoKeyRaw.h"
#include <openssl/aead.h>

namespace WebCore {

static constexpr size_t tagSize = 16;

static std::optional<Vector<uint8_t>> aeadSeal(const Vector<uint8_t>& key, const Vector<uint8_t>& nonce, const Vector<uint8_t>& plainText, const Vector<uint8_t>& additionalData)
{
    EVP_AEAD_CTX ctx;
    if (!EVP_AEAD_CTX_init(&ctx, EVP_aead_chacha20_poly1305(), key.begin(), key.size(), tagSize, nullptr))
        return std::nullopt;

    Vector<uint8_t> cipherText(plainText.size() + tagSize);
    size_t outLength = 0;
    bool ok = EVP_AEAD_CTX_seal(&ctx, cipherText.begin(), &outLength, cipherText.size(),
        nonce.begin(), nonce.size(), plainText.begin(), plainText.size(),
        additionalData.begin(), additionalData.size());
    EVP_AEAD_CTX_cleanup(&ctx);
    if (!ok)
        return std::nullopt;

    cipherText.shrink(outLength);
    return cipherText;
}

static std::optional<Vector<uint8_t>> aeadOpen(const Vector<uint8_t>& key, const Vector<uint8_t>& nonce, const Vector<uint8_t>& cipherText, const Vector<uint8_t>& additionalData)
{
    EVP_AEAD_CTX ctx;
    if (!EVP_AEAD_CTX_init(&ctx, EVP_aead_chacha20_poly1305(), key.begin(), key.size(), tagSize, nullptr))
        return std::nullopt;

    Vector<uint8_t> plainText(cipherText.size());
    size_t outLength = 0;
    bool ok = EVP_AEAD_CTX_open(&ctx, plainText.begin(), &outLength, plainText.size(),
        nonce.begin(), nonce.size(), cipherText.begin(), cipherText.size(),
        additionalData.begin(), additionalData.size());
    EVP_AEAD_CTX_cleanup(&ctx);
    if (!ok)
        return std::nullopt;

    plainText.shrink(outLength);
    return plainText;
}

ExceptionOr<Vector<uint8_t>> CryptoAlgorithmChaCha20Poly1305::platformEncrypt(const CryptoAlgorithmAeadParams& parameters, const CryptoKeyRaw& key, const Vector<uint8_t>& plainText)
{
    auto output = aeadSeal(key.key(), parameters.ivVector(), plainText, parameters.additionalDataVector());
    if (!output)
        return Exception { OperationError };
    return WTF::move(*output);
}

ExceptionOr<Vector<uint8_t>> CryptoAlgorithmChaCha20Poly1305::platformDecrypt(const CryptoAlgorithmAeadParams& parameters, const CryptoKeyRaw& key, const Vector<uint8_t>& cipherText)
{
    auto output = aeadOpen(key.key(), parameters.ivVector(), cipherText, parameters.additionalDataVector());
    if (!output)
        return Exception { OperationError };
    return WTF::move(*output);
}

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)
