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
#include "CryptoAlgorithmMLDSA.h"

#if ENABLE(WEB_CRYPTO)

#include "CryptoAlgorithmAKPShared.h"
#include "CryptoAlgorithmMlDsaParams.h"
#include "CryptoAlgorithmRegistry.h"
#include "CryptoKeyAKP.h"
#include "OpenSSLCryptoUniquePtr.h"
#include <openssl/err.h>
#include <openssl/evp.h>
#include <wtf/text/Base64.h>
#include <wtf/text/MakeString.h>

namespace WebCore {

static String mlDsaName(CryptoAlgorithmIdentifier identifier)
{
    return CryptoAlgorithmRegistry::singleton().name(identifier);
}

// Node's PKCS#8 length table for the seedless "expandedKey only" form, which
// gets a dedicated NotSupportedError before hitting the parser.
static std::optional<size_t> mlDsaPrivOnlyPkcs8Length(CryptoAlgorithmIdentifier identifier)
{
    switch (identifier) {
    case CryptoAlgorithmIdentifier::ML_DSA_44:
        return 2588;
    case CryptoAlgorithmIdentifier::ML_DSA_65:
        return 4060;
    case CryptoAlgorithmIdentifier::ML_DSA_87:
        return 4924;
    default:
        return std::nullopt;
    }
}

void CryptoAlgorithmMLDSA::generateKey(const CryptoAlgorithmParameters& parameters, bool extractable, CryptoKeyUsageBitmap usages, KeyOrKeyPairCallback&& callback, ExceptionCallback&& exceptionCallback, ScriptExecutionContext&)
{
    if (usages & ~(CryptoKeyUsageSign | CryptoKeyUsageVerify)) {
        exceptionCallback(SyntaxError, makeString("Unsupported key usage for an "_s, mlDsaName(m_identifier), " key"_s));
        return;
    }

    CryptoKeyUsageBitmap privateUsages = usages & CryptoKeyUsageSign;
    CryptoKeyUsageBitmap publicUsages = usages & CryptoKeyUsageVerify;
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

ExceptionOr<Vector<uint8_t>> CryptoAlgorithmMLDSA::platformSign(const CryptoKeyAKP& key, const Vector<uint8_t>& context, const Vector<uint8_t>& data)
{
    EvpDigestCtxPtr mdCtx(EVP_MD_CTX_new());
    EVP_PKEY_CTX* pkeyCtx = nullptr;
    // Failures run on the work queue; clear the BoringSSL queue so the next
    // operation on this thread does not pick up a stale error as its cause.
    if (!mdCtx || !EVP_DigestSignInit(mdCtx.get(), &pkeyCtx, nullptr, nullptr, key.platformKey())) {
        ERR_clear_error();
        return Exception { OperationError };
    }

    if (!context.isEmpty() && !EVP_PKEY_CTX_set1_signature_context_string(pkeyCtx, context.begin(), context.size())) {
        ERR_clear_error();
        return Exception { OperationError };
    }

    size_t signatureLength = 0;
    if (!EVP_DigestSign(mdCtx.get(), nullptr, &signatureLength, data.begin(), data.size())) {
        ERR_clear_error();
        return Exception { OperationError };
    }

    Vector<uint8_t> signature(signatureLength);
    if (!EVP_DigestSign(mdCtx.get(), signature.begin(), &signatureLength, data.begin(), data.size())) {
        ERR_clear_error();
        return Exception { OperationError };
    }
    signature.shrink(signatureLength);
    return signature;
}

ExceptionOr<bool> CryptoAlgorithmMLDSA::platformVerify(const CryptoKeyAKP& key, const Vector<uint8_t>& context, const Vector<uint8_t>& signature, const Vector<uint8_t>& data)
{
    EvpDigestCtxPtr mdCtx(EVP_MD_CTX_new());
    EVP_PKEY_CTX* pkeyCtx = nullptr;
    if (!mdCtx || !EVP_DigestVerifyInit(mdCtx.get(), &pkeyCtx, nullptr, nullptr, key.platformKey())) {
        ERR_clear_error();
        return Exception { OperationError };
    }

    if (!context.isEmpty() && !EVP_PKEY_CTX_set1_signature_context_string(pkeyCtx, context.begin(), context.size())) {
        ERR_clear_error();
        return Exception { OperationError };
    }

    bool valid = EVP_DigestVerify(mdCtx.get(), signature.begin(), signature.size(), data.begin(), data.size()) == 1;
    if (!valid)
        ERR_clear_error();
    return valid;
}

void CryptoAlgorithmMLDSA::sign(const CryptoAlgorithmParameters& parameters, Ref<CryptoKey>&& key, Vector<uint8_t>&& data, VectorCallback&& callback, ExceptionCallback&& exceptionCallback, ScriptExecutionContext& context, WorkQueue& workQueue)
{
    if (key->type() != CryptoKeyType::Private) {
        exceptionCallback(InvalidAccessError, "Key must be a private key"_s);
        return;
    }

    const auto& mlDsaParameters = downcast<CryptoAlgorithmMlDsaParams>(parameters);
    // Oversized contexts are rejected with a cause-carrying OperationError in
    // SubtleCrypto::sign; this is only a backstop.
    if (mlDsaParameters.contextVector().size() > s_maxContextLength) {
        exceptionCallback(OperationError, ""_s);
        return;
    }

    dispatchOperationInWorkQueue(workQueue, context, WTF::move(callback), WTF::move(exceptionCallback),
        [key = WTF::move(key), contextString = mlDsaParameters.contextVector(), data = WTF::move(data)] {
            return platformSign(downcast<CryptoKeyAKP>(key.get()), contextString, data);
        });
}

void CryptoAlgorithmMLDSA::verify(const CryptoAlgorithmParameters& parameters, Ref<CryptoKey>&& key, Vector<uint8_t>&& signature, Vector<uint8_t>&& data, BoolCallback&& callback, ExceptionCallback&& exceptionCallback, ScriptExecutionContext& context, WorkQueue& workQueue)
{
    if (key->type() != CryptoKeyType::Public) {
        exceptionCallback(InvalidAccessError, "Key must be a public key"_s);
        return;
    }

    const auto& mlDsaParameters = downcast<CryptoAlgorithmMlDsaParams>(parameters);
    if (mlDsaParameters.contextVector().size() > s_maxContextLength) {
        exceptionCallback(OperationError, ""_s);
        return;
    }

    dispatchOperationInWorkQueue(workQueue, context, WTF::move(callback), WTF::move(exceptionCallback),
        [key = WTF::move(key), contextString = mlDsaParameters.contextVector(), signature = WTF::move(signature), data = WTF::move(data)] {
            return platformVerify(downcast<CryptoKeyAKP>(key.get()), contextString, signature, data);
        });
}

void CryptoAlgorithmMLDSA::importKey(CryptoKeyFormat format, KeyData&& data, const CryptoAlgorithmParameters& parameters, bool extractable, CryptoKeyUsageBitmap usages, KeyCallback&& callback, ExceptionCallback&& exceptionCallback)
{
    static constexpr AkpAlgorithmTraits traits {
        CryptoKeyUsageVerify,
        CryptoKeyUsageSign,
        mlDsaPrivOnlyPkcs8Length,
        "Importing an ML-DSA PKCS#8 key without a seed is not supported"_s,
        "sig"_s,
    };
    importAkpKey(m_identifier, traits, format, WTF::move(data), parameters, extractable, usages, WTF::move(callback), WTF::move(exceptionCallback));
}

void CryptoAlgorithmMLDSA::exportKey(CryptoKeyFormat format, Ref<CryptoKey>&& key, KeyDataCallback&& callback, ExceptionCallback&& exceptionCallback)
{
    exportAkpKey(m_identifier, format, WTF::move(key), WTF::move(callback), WTF::move(exceptionCallback));
}

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)
