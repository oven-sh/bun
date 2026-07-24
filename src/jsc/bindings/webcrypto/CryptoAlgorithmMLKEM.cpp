/*
 * Copyright (C) 2026 Apple Inc. All rights reserved.
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
#include "CryptoAlgorithmMLKEM.h"

#if ENABLE(WEB_CRYPTO)

#include "CryptoAlgorithmAKPShared.h"
#include "CryptoAlgorithmRegistry.h"
#include "CryptoKeyAKP.h"
#include "OpenSSLCryptoUniquePtr.h"
#include <openssl/err.h>
#include <openssl/evp.h>
#include <wtf/text/Base64.h>
#include <wtf/text/MakeString.h>

namespace WebCore {

static constexpr CryptoKeyUsageBitmap allMlKemUsages = CryptoKeyUsageEncapsulateKey | CryptoKeyUsageEncapsulateBits | CryptoKeyUsageDecapsulateKey | CryptoKeyUsageDecapsulateBits;
static constexpr CryptoKeyUsageBitmap publicMlKemUsages = CryptoKeyUsageEncapsulateKey | CryptoKeyUsageEncapsulateBits;
static constexpr CryptoKeyUsageBitmap privateMlKemUsages = CryptoKeyUsageDecapsulateKey | CryptoKeyUsageDecapsulateBits;

static String mlKemName(CryptoAlgorithmIdentifier identifier)
{
    return CryptoAlgorithmRegistry::singleton().name(identifier);
}

// Node's PKCS#8 length table for the seedless "expandedKey only" form, which
// gets a dedicated NotSupportedError before hitting the parser.
static std::optional<size_t> mlKemPrivOnlyPkcs8Length(CryptoAlgorithmIdentifier identifier)
{
    switch (identifier) {
    case CryptoAlgorithmIdentifier::ML_KEM_768:
        return 2428;
    case CryptoAlgorithmIdentifier::ML_KEM_1024:
        return 3196;
    default:
        return std::nullopt;
    }
}

void CryptoAlgorithmMLKEM::generateKey(const CryptoAlgorithmParameters& parameters, bool extractable, CryptoKeyUsageBitmap usages, KeyOrKeyPairCallback&& callback, ExceptionCallback&& exceptionCallback, ScriptExecutionContext&)
{
    if (usages & ~allMlKemUsages) {
        exceptionCallback(SyntaxError, makeString("Unsupported key usage for an "_s, mlKemName(m_identifier), " key"_s));
        return;
    }

    CryptoKeyUsageBitmap privateUsages = usages & privateMlKemUsages;
    CryptoKeyUsageBitmap publicUsages = usages & publicMlKemUsages;
    if (!privateUsages) {
        exceptionCallback(SyntaxError, "Usages cannot be empty when creating a key."_s);
        return;
    }

    auto result = CryptoKeyAKP::generatePair(parameters.identifier, extractable, publicUsages, privateUsages);
    if (result.hasException()) {
        exceptionCallback(result.releaseException().code(), ""_s);
        return;
    }

    callback(result.releaseReturnValue());
}

void CryptoAlgorithmMLKEM::importKey(CryptoKeyFormat format, KeyData&& data, const CryptoAlgorithmParameters& parameters, bool extractable, CryptoKeyUsageBitmap usages, KeyCallback&& callback, ExceptionCallback&& exceptionCallback)
{
    static constexpr AkpAlgorithmTraits traits {
        publicMlKemUsages,
        privateMlKemUsages,
        mlKemPrivOnlyPkcs8Length,
        "Importing an ML-KEM PKCS#8 key without a seed is not supported"_s,
        "enc"_s,
    };
    importAkpKey(m_identifier, traits, format, WTF::move(data), parameters, extractable, usages, WTF::move(callback), WTF::move(exceptionCallback));
}

void CryptoAlgorithmMLKEM::exportKey(CryptoKeyFormat format, Ref<CryptoKey>&& key, KeyDataCallback&& callback, ExceptionCallback&& exceptionCallback)
{
    exportAkpKey(m_identifier, format, WTF::move(key), WTF::move(callback), WTF::move(exceptionCallback));
}

void CryptoAlgorithmMLKEM::encapsulate(Ref<CryptoKey>&& key, VectorPairCallback&& callback, ExceptionCallback&& exceptionCallback)
{
    if (key->type() != CryptoKeyType::Public) {
        exceptionCallback(InvalidAccessError, "Key must be a public key"_s);
        return;
    }

    const auto& akpKey = downcast<CryptoKeyAKP>(key.get());
    EvpPKeyCtxPtr ctx(EVP_PKEY_CTX_new(akpKey.platformKey(), nullptr));
    if (!ctx || !EVP_PKEY_encapsulate_init(ctx.get(), nullptr)) {
        ERR_clear_error();
        exceptionCallback(OperationError, ""_s);
        return;
    }

    size_t ciphertextLength = 0;
    size_t sharedKeyLength = 0;
    if (!EVP_PKEY_encapsulate(ctx.get(), nullptr, &ciphertextLength, nullptr, &sharedKeyLength)) {
        ERR_clear_error();
        exceptionCallback(OperationError, ""_s);
        return;
    }

    Vector<uint8_t> ciphertext(ciphertextLength);
    Vector<uint8_t> sharedKey(sharedKeyLength);
    if (!EVP_PKEY_encapsulate(ctx.get(), ciphertext.begin(), &ciphertextLength, sharedKey.begin(), &sharedKeyLength)) {
        ERR_clear_error();
        exceptionCallback(OperationError, ""_s);
        return;
    }
    ciphertext.shrink(ciphertextLength);
    sharedKey.shrink(sharedKeyLength);

    callback(WTF::move(sharedKey), WTF::move(ciphertext));
}

void CryptoAlgorithmMLKEM::decapsulate(Ref<CryptoKey>&& key, Vector<uint8_t>&& ciphertext, VectorCallback&& callback, ExceptionCallback&& exceptionCallback)
{
    if (key->type() != CryptoKeyType::Private) {
        exceptionCallback(InvalidAccessError, "Key must be a private key"_s);
        return;
    }

    const auto& akpKey = downcast<CryptoKeyAKP>(key.get());
    EvpPKeyCtxPtr ctx(EVP_PKEY_CTX_new(akpKey.platformKey(), nullptr));
    if (!ctx || !EVP_PKEY_decapsulate_init(ctx.get(), nullptr)) {
        ERR_clear_error();
        exceptionCallback(OperationError, ""_s);
        return;
    }

    size_t sharedKeyLength = 0;
    if (!EVP_PKEY_decapsulate(ctx.get(), nullptr, &sharedKeyLength, ciphertext.begin(), ciphertext.size())) {
        ERR_clear_error();
        exceptionCallback(OperationError, ""_s);
        return;
    }

    Vector<uint8_t> sharedKey(sharedKeyLength);
    if (!EVP_PKEY_decapsulate(ctx.get(), sharedKey.begin(), &sharedKeyLength, ciphertext.begin(), ciphertext.size())) {
        ERR_clear_error();
        exceptionCallback(OperationError, ""_s);
        return;
    }
    sharedKey.shrink(sharedKeyLength);

    callback(sharedKey);
}

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)
