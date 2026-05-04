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
#include "CryptoAlgorithmHMAC.h"

#if ENABLE(WEB_CRYPTO)

#include "CryptoKeyHMAC.h"
#include "OpenSSLCryptoUniquePtr.h"
#include "OpenSSLUtilities.h"
#include <openssl/evp.h>
#include <wtf/CryptographicUtilities.h>

namespace WebCore {

static std::optional<Vector<uint8_t>> calculateSignature(const EVP_MD* algorithm, const Vector<uint8_t>& key, const uint8_t* data, size_t dataLength)
{
    HMACCtxPtr ctx;
    if (!(ctx = HMACCtxPtr(HMAC_CTX_new())))
        return std::nullopt;

    if (1 != HMAC_Init_ex(ctx.get(), key.begin(), key.size(), algorithm, nullptr))
        return std::nullopt;

    // Call update with the message
    if (1 != HMAC_Update(ctx.get(), data, dataLength))
        return std::nullopt;

    // Finalize the DigestSign operation
    Vector<uint8_t> cipherText(EVP_MAX_MD_SIZE);
    unsigned len = 0;
    if (1 != HMAC_Final(ctx.get(), cipherText.begin(), &len))
        return std::nullopt;

    cipherText.shrink(len);
    return cipherText;
}

ExceptionOr<Vector<uint8_t>> CryptoAlgorithmHMAC::platformSignWithAlgorithm(const CryptoKeyHMAC& key, CryptoAlgorithmIdentifier algorithmIdentifier, const Vector<uint8_t>& data)
{

    auto algorithm = digestAlgorithm(algorithmIdentifier);
    if (!algorithm)
        return Exception { OperationError };

    auto result = calculateSignature(algorithm, key.key(), data.begin(), data.size());
    if (!result)
        return Exception { OperationError };
    return WTF::move(*result);
}

ExceptionOr<Vector<uint8_t>> CryptoAlgorithmHMAC::platformSign(const CryptoKeyHMAC& key, const Vector<uint8_t>& data)
{
    auto algorithm = digestAlgorithm(key.hashAlgorithmIdentifier());
    if (!algorithm)
        return Exception { OperationError };

    auto result = calculateSignature(algorithm, key.key(), data.begin(), data.size());
    if (!result)
        return Exception { OperationError };
    return WTF::move(*result);
}

ExceptionOr<bool> CryptoAlgorithmHMAC::platformVerifyWithAlgorithm(const CryptoKeyHMAC& key, CryptoAlgorithmIdentifier algorithmIdentifier, const Vector<uint8_t>& signature, const Vector<uint8_t>& data)
{

    auto algorithm = digestAlgorithm(algorithmIdentifier);
    if (!algorithm)
        return Exception { OperationError };

    auto expectedSignature = calculateSignature(algorithm, key.key(), data.begin(), data.size());
    if (!expectedSignature)
        return Exception { OperationError };
    // Using a constant time comparison to prevent timing attacks.
    return signature.size() == expectedSignature->size() && !constantTimeMemcmp(expectedSignature->span(), signature.span());
}

ExceptionOr<bool> CryptoAlgorithmHMAC::platformVerify(const CryptoKeyHMAC& key, const Vector<uint8_t>& signature, const Vector<uint8_t>& data)
{
    auto algorithm = digestAlgorithm(key.hashAlgorithmIdentifier());
    if (!algorithm)
        return Exception { OperationError };

    auto expectedSignature = calculateSignature(algorithm, key.key(), data.begin(), data.size());
    if (!expectedSignature)
        return Exception { OperationError };
    // Using a constant time comparison to prevent timing attacks.
    return signature.size() == expectedSignature->size() && !constantTimeMemcmp(expectedSignature->span(), signature.span());
}

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)
