/*
 * Copyright (C) 2016 Igalia S.L.
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
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#pragma once

#include <memory>
#include <openssl/ec.h>
#include <openssl/hmac.h>
#if OPENSSL_VERSION_NUMBER >= 0x30000000L
#include <openssl/kdf.h>
#include <openssl/param_build.h>
#endif
#include <openssl/x509.h>

namespace WebCore {

template<typename T>
struct OpenSSLCryptoPtrDeleter {
    void operator()(T* ptr) const = delete;
};

template<typename T>
using OpenSSLCryptoPtr = std::unique_ptr<T, OpenSSLCryptoPtrDeleter<T>>;
// clang-format off
#define DEFINE_OPENSSL_CRYPTO_PTR_FULL(alias, typeName, deleterFunc) \
    template<> struct OpenSSLCryptoPtrDeleter<typeName> { \
        void operator()(typeName* ptr) const { \
            deleterFunc;                                             \
        }                                                            \
    };                                                               \
    using alias = OpenSSLCryptoPtr<typeName>;

#define DEFINE_OPENSSL_CRYPTO_PTR(alias, typeName, deleterFunc)      \
    DEFINE_OPENSSL_CRYPTO_PTR_FULL(alias, typeName, deleterFunc(ptr))
// clang-format on
DEFINE_OPENSSL_CRYPTO_PTR(EvpCipherCtxPtr, EVP_CIPHER_CTX, EVP_CIPHER_CTX_free)
DEFINE_OPENSSL_CRYPTO_PTR(EvpDigestCtxPtr, EVP_MD_CTX, EVP_MD_CTX_free)
DEFINE_OPENSSL_CRYPTO_PTR(EvpPKeyPtr, EVP_PKEY, EVP_PKEY_free)
DEFINE_OPENSSL_CRYPTO_PTR(EvpPKeyCtxPtr, EVP_PKEY_CTX, EVP_PKEY_CTX_free)

#if OPENSSL_VERSION_NUMBER >= 0x30000000L
DEFINE_OPENSSL_CRYPTO_PTR(OsslParamBldPtr, OSSL_PARAM_BLD, OSSL_PARAM_BLD_free)
DEFINE_OPENSSL_CRYPTO_PTR(OsslParamPtr, OSSL_PARAM, OSSL_PARAM_free)
DEFINE_OPENSSL_CRYPTO_PTR(EVPKDFCtxPtr, EVP_KDF_CTX, EVP_KDF_CTX_free)
DEFINE_OPENSSL_CRYPTO_PTR(EVPKDFPtr, EVP_KDF, EVP_KDF_free)
#endif // OPENSSL_VERSION_NUMBER >= 0x30000000L

// These are deprecated in OpenSSL 3. FIXME: Migrate to EvpKey. See Bug #245146.
DEFINE_OPENSSL_CRYPTO_PTR(RSAPtr, RSA, RSA_free)
DEFINE_OPENSSL_CRYPTO_PTR(ECKeyPtr, EC_KEY, EC_KEY_free)
DEFINE_OPENSSL_CRYPTO_PTR(HMACCtxPtr, HMAC_CTX, HMAC_CTX_free)

DEFINE_OPENSSL_CRYPTO_PTR(ECPointPtr, EC_POINT, EC_POINT_clear_free)
DEFINE_OPENSSL_CRYPTO_PTR(PKCS8PrivKeyInfoPtr, PKCS8_PRIV_KEY_INFO, PKCS8_PRIV_KEY_INFO_free)
DEFINE_OPENSSL_CRYPTO_PTR(BIGNUMPtr, BIGNUM, BN_clear_free)
DEFINE_OPENSSL_CRYPTO_PTR(BNCtxPtr, BN_CTX, BN_CTX_free)
DEFINE_OPENSSL_CRYPTO_PTR(ECDSASigPtr, ECDSA_SIG, ECDSA_SIG_free)
DEFINE_OPENSSL_CRYPTO_PTR(X509Ptr, X509, X509_free)
DEFINE_OPENSSL_CRYPTO_PTR(BIOPtr, BIO, BIO_free)

DEFINE_OPENSSL_CRYPTO_PTR_FULL(ASN1SequencePtr, ASN1_SEQUENCE_ANY, sk_ASN1_TYPE_pop_free(ptr, ASN1_TYPE_free))

#undef DEFINE_OPENSSL_CRYPTO_PTR
#undef DEFINE_OPENSSL_CRYPTO_PTR_FULL

} // namespace WebCore
