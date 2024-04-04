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
#include "CryptoKeyHMAC.h"
#include "../wtf-bindings.h"

#if ENABLE(WEB_CRYPTO)

#include "CryptoAlgorithmHmacKeyParams.h"
#include "CryptoAlgorithmRegistry.h"
#include "ExceptionOr.h"
#include "JsonWebKey.h"
#include <wtf/text/Base64.h>
#include <wtf/text/WTFString.h>

namespace WebCore {

static size_t getKeyLengthFromHash(CryptoAlgorithmIdentifier hash)
{
    switch (hash) {
    case CryptoAlgorithmIdentifier::SHA_1:
    case CryptoAlgorithmIdentifier::SHA_224:
    case CryptoAlgorithmIdentifier::SHA_256:
        return 512;
    case CryptoAlgorithmIdentifier::SHA_384:
    case CryptoAlgorithmIdentifier::SHA_512:
        return 1024;
    default:
        ASSERT_NOT_REACHED();
        return 0;
    }
}

CryptoKeyHMAC::CryptoKeyHMAC(const Vector<uint8_t>& key, CryptoAlgorithmIdentifier hash, bool extractable, CryptoKeyUsageBitmap usage)
    : CryptoKey(CryptoAlgorithmIdentifier::HMAC, CryptoKeyType::Secret, extractable, usage)
    , m_hash(hash)
    , m_key(key)
{
}

CryptoKeyHMAC::CryptoKeyHMAC(Vector<uint8_t>&& key, CryptoAlgorithmIdentifier hash, bool extractable, CryptoKeyUsageBitmap usage)
    : CryptoKey(CryptoAlgorithmIdentifier::HMAC, CryptoKeyType::Secret, extractable, usage)
    , m_hash(hash)
    , m_key(WTFMove(key))
{
}

CryptoKeyHMAC::~CryptoKeyHMAC() = default;

RefPtr<CryptoKeyHMAC> CryptoKeyHMAC::generateFromBytes(void* data, size_t byteLength, CryptoAlgorithmIdentifier hash, bool extractable, CryptoKeyUsageBitmap usages)
{

    Vector<uint8_t> vec_data(std::span { (uint8_t*)data, byteLength });
    return adoptRef(new CryptoKeyHMAC(vec_data, hash, extractable, usages));
}

RefPtr<CryptoKeyHMAC> CryptoKeyHMAC::generate(size_t lengthBits, CryptoAlgorithmIdentifier hash, bool extractable, CryptoKeyUsageBitmap usages)
{
    if (!lengthBits) {
        lengthBits = getKeyLengthFromHash(hash);
        if (!lengthBits)
            return nullptr;
    }
    // CommonHMAC only supports key length that is a multiple of 8. Therefore, here we are a little bit different
    // from the spec as of 11 December 2014: https://www.w3.org/TR/WebCryptoAPI/#hmac-operations
    if (lengthBits % 8)
        return nullptr;

    return adoptRef(new CryptoKeyHMAC(randomData(lengthBits / 8), hash, extractable, usages));
}

RefPtr<CryptoKeyHMAC> CryptoKeyHMAC::importRaw(size_t lengthBits, CryptoAlgorithmIdentifier hash, Vector<uint8_t>&& keyData, bool extractable, CryptoKeyUsageBitmap usages)
{
    size_t length = keyData.size() * 8;
    if (!length)
        return nullptr;
    // CommonHMAC only supports key length that is a multiple of 8. Therefore, here we are a little bit different
    // from the spec as of 11 December 2014: https://www.w3.org/TR/WebCryptoAPI/#hmac-operations
    if (lengthBits && lengthBits != length)
        return nullptr;

    return adoptRef(new CryptoKeyHMAC(WTFMove(keyData), hash, extractable, usages));
}

RefPtr<CryptoKeyHMAC> CryptoKeyHMAC::importJwk(size_t lengthBits, CryptoAlgorithmIdentifier hash, JsonWebKey&& keyData, bool extractable, CryptoKeyUsageBitmap usages, CheckAlgCallback&& callback)
{
    if (keyData.kty != "oct"_s)
        return nullptr;
    if (keyData.k.isNull())
        return nullptr;
    auto octetSequence = base64URLDecode(keyData.k);
    if (!octetSequence)
        return nullptr;
    if (!callback(hash, keyData.alg))
        return nullptr;
    if (usages && !keyData.use.isNull() && keyData.use != "sig"_s)
        return nullptr;
    if (keyData.key_ops && ((keyData.usages & usages) != usages))
        return nullptr;
    if (keyData.ext && !keyData.ext.value() && extractable)
        return nullptr;

    return CryptoKeyHMAC::importRaw(lengthBits, hash, WTFMove(*octetSequence), extractable, usages);
}

JsonWebKey CryptoKeyHMAC::exportJwk() const
{

    JsonWebKey result {};
    result.kty = "oct"_s;
    result.k = Bun::base64URLEncodeToString(m_key);
    result.key_ops = usages();
    result.ext = extractable();
    return result;
}

ExceptionOr<size_t> CryptoKeyHMAC::getKeyLength(const CryptoAlgorithmParameters& parameters)
{
    auto& aesParameters = downcast<CryptoAlgorithmHmacKeyParams>(parameters);

    size_t result = aesParameters.length ? *(aesParameters.length) : getKeyLengthFromHash(aesParameters.hashIdentifier);
    if (result)
        return result;

    return Exception { TypeError };
}

auto CryptoKeyHMAC::algorithm() const -> KeyAlgorithm
{
    CryptoHmacKeyAlgorithm result;
    result.name = CryptoAlgorithmRegistry::singleton().name(algorithmIdentifier());
    result.hash.name = CryptoAlgorithmRegistry::singleton().name(m_hash);
    result.length = m_key.size() * 8;
    return result;
}

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)
