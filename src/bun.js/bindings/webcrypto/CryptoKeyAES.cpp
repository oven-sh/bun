/*
 * Copyright (C) 2013 Apple Inc. All rights reserved.
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
#include "CryptoKeyAES.h"
#include "../wtf-bindings.h"
#if ENABLE(WEB_CRYPTO)

#include "CryptoAesKeyAlgorithm.h"
#include "CryptoAlgorithmAesKeyParams.h"
#include "CryptoAlgorithmRegistry.h"
#include "ExceptionOr.h"
#include "JsonWebKey.h"
#include <wtf/text/Base64.h>
#include <wtf/text/WTFString.h>

namespace WebCore {

static inline bool lengthIsValid(size_t length)
{
    return (length == CryptoKeyAES::s_length128) || (length == CryptoKeyAES::s_length192) || (length == CryptoKeyAES::s_length256);
}

CryptoKeyAES::CryptoKeyAES(CryptoAlgorithmIdentifier algorithm, const Vector<uint8_t>& key, bool extractable, CryptoKeyUsageBitmap usage)
    : CryptoKey(algorithm, CryptoKeyType::Secret, extractable, usage)
    , m_key(key)
{
    ASSERT(isValidAESAlgorithm(algorithm));
}

CryptoKeyAES::CryptoKeyAES(CryptoAlgorithmIdentifier algorithm, Vector<uint8_t>&& key, bool extractable, CryptoKeyUsageBitmap usage)
    : CryptoKey(algorithm, CryptoKeyType::Secret, extractable, usage)
    , m_key(WTFMove(key))
{
    ASSERT(isValidAESAlgorithm(algorithm));
}

CryptoKeyAES::~CryptoKeyAES() = default;

bool CryptoKeyAES::isValidAESAlgorithm(CryptoAlgorithmIdentifier algorithm)
{
    return algorithm == CryptoAlgorithmIdentifier::AES_CTR
        || algorithm == CryptoAlgorithmIdentifier::AES_CBC
        || algorithm == CryptoAlgorithmIdentifier::AES_GCM
        || algorithm == CryptoAlgorithmIdentifier::AES_CFB
        || algorithm == CryptoAlgorithmIdentifier::AES_KW;
}

RefPtr<CryptoKeyAES> CryptoKeyAES::generate(CryptoAlgorithmIdentifier algorithm, size_t lengthBits, bool extractable, CryptoKeyUsageBitmap usages)
{
    if (!lengthIsValid(lengthBits))
        return nullptr;
    return adoptRef(new CryptoKeyAES(algorithm, randomData(lengthBits / 8), extractable, usages));
}

RefPtr<CryptoKeyAES> CryptoKeyAES::importRaw(CryptoAlgorithmIdentifier algorithm, Vector<uint8_t>&& keyData, bool extractable, CryptoKeyUsageBitmap usages)
{
    if (!lengthIsValid(keyData.size() * 8))
        return nullptr;
    return adoptRef(new CryptoKeyAES(algorithm, WTFMove(keyData), extractable, usages));
}

RefPtr<CryptoKeyAES> CryptoKeyAES::importJwk(CryptoAlgorithmIdentifier algorithm, JsonWebKey&& keyData, bool extractable, CryptoKeyUsageBitmap usages, CheckAlgCallback&& callback)
{
    if (keyData.kty != "oct"_s)
        return nullptr;
    if (keyData.k.isNull())
        return nullptr;
    auto octetSequence = base64URLDecode(keyData.k);
    if (!octetSequence)
        return nullptr;
    if (!callback(octetSequence->size() * 8, keyData.alg))
        return nullptr;
    if (usages && !keyData.use.isNull() && keyData.use != "enc"_s)
        return nullptr;
    if (keyData.key_ops && ((keyData.usages & usages) != usages))
        return nullptr;
    if (keyData.ext && !keyData.ext.value() && extractable)
        return nullptr;

    return adoptRef(new CryptoKeyAES(algorithm, WTFMove(*octetSequence), extractable, usages));
}

JsonWebKey CryptoKeyAES::exportJwk() const
{
    JsonWebKey result {};
    result.kty = "oct"_s;
    result.k = Bun::base64URLEncodeToString(m_key);
    result.key_ops = usages();
    result.ext = extractable();
    return result;
}

ExceptionOr<size_t> CryptoKeyAES::getKeyLength(const CryptoAlgorithmParameters& parameters)
{
    auto& aesParameters = downcast<CryptoAlgorithmAesKeyParams>(parameters);
    if (!lengthIsValid(aesParameters.length))
        return Exception { OperationError };
    return aesParameters.length;
}

auto CryptoKeyAES::algorithm() const -> KeyAlgorithm
{
    CryptoAesKeyAlgorithm result;
    result.name = CryptoAlgorithmRegistry::singleton().name(algorithmIdentifier());
    result.length = m_key.size() * 8;
    return result;
}

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)
