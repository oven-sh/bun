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
#include "CryptoAlgorithmRSA_PSS.h"

#if ENABLE(WEB_CRYPTO)

#include "CryptoAlgorithmRsaPssParams.h"
#include "CryptoKeyRSA.h"
#include "OpenSSLUtilities.h"

namespace WebCore {

static ExceptionOr<Vector<uint8_t>> signWithMD(const CryptoAlgorithmRsaPssParams& parameters, const CryptoKeyRSA& key, const Vector<uint8_t>& data, const EVP_MD* md)
{
    auto padding = parameters.padding;
    if (padding == 0) {
        padding = RSA_PKCS1_PSS_PADDING;
    }
    std::optional<Vector<uint8_t>> digest = calculateDigest(md, data);
    if (!digest)
        return Exception { OperationError };

    auto ctx = EvpPKeyCtxPtr(EVP_PKEY_CTX_new(key.platformKey(), nullptr));
    if (!ctx)
        return Exception { OperationError };

    if (EVP_PKEY_sign_init(ctx.get()) <= 0)
        return Exception { OperationError };

    if (EVP_PKEY_CTX_set_rsa_padding(ctx.get(), padding) <= 0)
        return Exception { OperationError };

    if (padding == RSA_PKCS1_PSS_PADDING) {
        if (EVP_PKEY_CTX_set_rsa_pss_saltlen(ctx.get(), parameters.saltLength) <= 0)
            return Exception { OperationError };
    }

    if (EVP_PKEY_CTX_set_signature_md(ctx.get(), md) <= 0)
        return Exception { OperationError };

    if (EVP_PKEY_CTX_set_rsa_mgf1_md(ctx.get(), md) <= 0)
        return Exception { OperationError };

    size_t signatureLen;
    if (EVP_PKEY_sign(ctx.get(), nullptr, &signatureLen, digest->data(), digest->size()) <= 0)
        return Exception { OperationError };

    Vector<uint8_t> signature(signatureLen);
    if (EVP_PKEY_sign(ctx.get(), signature.data(), &signatureLen, digest->data(), digest->size()) <= 0)
        return Exception { OperationError };
    signature.shrink(signatureLen);

    return signature;
}
ExceptionOr<Vector<uint8_t>> CryptoAlgorithmRSA_PSS::platformSignWithAlgorithm(const CryptoAlgorithmRsaPssParams& parameters, CryptoAlgorithmIdentifier hash, const CryptoKeyRSA& key, const Vector<uint8_t>& data)
{
#if 1 //  defined(EVP_PKEY_CTX_set_rsa_pss_saltlen) && defined(EVP_PKEY_CTX_set_rsa_mgf1_md)
    const EVP_MD* md = digestAlgorithm(hash);
    if (!md)
        return Exception { NotSupportedError };

    return signWithMD(parameters, key, data, md);
#else
    return Exception { NotSupportedError };
#endif
}

ExceptionOr<Vector<uint8_t>> CryptoAlgorithmRSA_PSS::platformSign(const CryptoAlgorithmRsaPssParams& parameters, const CryptoKeyRSA& key, const Vector<uint8_t>& data)
{
#if 1 //  defined(EVP_PKEY_CTX_set_rsa_pss_saltlen) && defined(EVP_PKEY_CTX_set_rsa_mgf1_md)
    const EVP_MD* md = digestAlgorithm(key.hashAlgorithmIdentifier());
    if (!md)
        return Exception { NotSupportedError };

    return signWithMD(parameters, key, data, md);
#else
    return Exception { NotSupportedError };
#endif
}

static ExceptionOr<bool> verifyWithMD(const CryptoAlgorithmRsaPssParams& parameters, const CryptoKeyRSA& key, const Vector<uint8_t>& signature, const Vector<uint8_t>& data, const EVP_MD* md)
{
    auto padding = parameters.padding;
    if (padding == 0) {
        padding = RSA_PKCS1_PSS_PADDING;
    }

    auto ctx = EvpPKeyCtxPtr(EVP_PKEY_CTX_new(key.platformKey(), nullptr));
    if (!ctx)
        return Exception { OperationError };

    if (EVP_PKEY_verify_init(ctx.get()) <= 0)
        return Exception { OperationError };

    if (EVP_PKEY_CTX_set_rsa_padding(ctx.get(), padding) <= 0)
        return Exception { OperationError };

    if (padding == RSA_PKCS1_PSS_PADDING) {
        if (EVP_PKEY_CTX_set_rsa_pss_saltlen(ctx.get(), parameters.saltLength) <= 0)
            return Exception { OperationError };
    }

    if (EVP_PKEY_CTX_set_signature_md(ctx.get(), md) <= 0)
        return Exception { OperationError };

    if (EVP_PKEY_CTX_set_rsa_mgf1_md(ctx.get(), md) <= 0)
        return Exception { OperationError };

    std::optional<Vector<uint8_t>> digest = calculateDigest(md, data);
    if (!digest)
        return Exception { OperationError };

    int ret = EVP_PKEY_verify(ctx.get(), signature.data(), signature.size(), digest->data(), digest->size());

    return ret == 1;
}
ExceptionOr<bool> CryptoAlgorithmRSA_PSS::platformVerifyWithAlgorithm(const CryptoAlgorithmRsaPssParams& parameters, CryptoAlgorithmIdentifier hash, const CryptoKeyRSA& key, const Vector<uint8_t>& signature, const Vector<uint8_t>& data)
{
    const EVP_MD* md = digestAlgorithm(hash);
    if (!md)
        return Exception { NotSupportedError };

    return verifyWithMD(parameters, key, signature, data, md);
}

ExceptionOr<bool> CryptoAlgorithmRSA_PSS::platformVerify(const CryptoAlgorithmRsaPssParams& parameters, const CryptoKeyRSA& key, const Vector<uint8_t>& signature, const Vector<uint8_t>& data)
{
#if 1 // defined(EVP_PKEY_CTX_set_rsa_pss_saltlen) && defined(EVP_PKEY_CTX_set_rsa_mgf1_md)
    const EVP_MD* md = digestAlgorithm(key.hashAlgorithmIdentifier());
    if (!md)
        return Exception { NotSupportedError };

    return verifyWithMD(parameters, key, signature, data, md);
#else
    return Exception { NotSupportedError };
#endif
}

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)
