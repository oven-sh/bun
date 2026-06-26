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
#include "CryptoKey.h"

#if ENABLE(WEB_CRYPTO)

#include "CryptoAlgorithmRegistry.h"
#include "WebCoreOpaqueRoot.h"
#include <wtf/CryptographicallyRandomNumber.h>
#include <openssl/rand.h>
#include <openssl/evp.h>
#include "CryptoKeyRSA.h"
#include "CryptoKeyEC.h"
#include "CryptoKeyHMAC.h"
namespace WebCore {

CryptoKey::CryptoKey(CryptoAlgorithmIdentifier algorithmIdentifier, Type type, bool extractable, CryptoKeyUsageBitmap usages)
    : m_algorithmIdentifier(algorithmIdentifier)
    , m_type(type)
    , m_extractable(extractable)
    , m_usages(usages)
{
}

CryptoKey::~CryptoKey() = default;

auto CryptoKey::usages() const -> Vector<CryptoKeyUsage>
{
    // The result is ordered alphabetically.
    Vector<CryptoKeyUsage> result;
    if (m_usages & CryptoKeyUsageDecrypt)
        result.append(CryptoKeyUsage::Decrypt);
    if (m_usages & CryptoKeyUsageDeriveBits)
        result.append(CryptoKeyUsage::DeriveBits);
    if (m_usages & CryptoKeyUsageDeriveKey)
        result.append(CryptoKeyUsage::DeriveKey);
    if (m_usages & CryptoKeyUsageEncrypt)
        result.append(CryptoKeyUsage::Encrypt);
    if (m_usages & CryptoKeyUsageSign)
        result.append(CryptoKeyUsage::Sign);
    if (m_usages & CryptoKeyUsageUnwrapKey)
        result.append(CryptoKeyUsage::UnwrapKey);
    if (m_usages & CryptoKeyUsageVerify)
        result.append(CryptoKeyUsage::Verify);
    if (m_usages & CryptoKeyUsageWrapKey)
        result.append(CryptoKeyUsage::WrapKey);
    return result;
}

WebCoreOpaqueRoot root(CryptoKey* key)
{
    return WebCoreOpaqueRoot { key };
}

Vector<uint8_t> CryptoKey::randomData(size_t size)
{
    Vector<uint8_t> result(size);
    RAND_bytes(result.begin(), result.size());
    return result;
}

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)
