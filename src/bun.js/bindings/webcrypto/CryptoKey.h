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

#pragma once

#include "CryptoAesKeyAlgorithm.h"
#include "CryptoAlgorithmIdentifier.h"
#include "CryptoEcKeyAlgorithm.h"
#include "CryptoHmacKeyAlgorithm.h"
#include "CryptoKeyAlgorithm.h"
#include "CryptoKeyType.h"
#include "CryptoKeyUsage.h"
#include "CryptoRsaHashedKeyAlgorithm.h"
#include "CryptoRsaKeyAlgorithm.h"
#include <variant>
#include <wtf/Forward.h>
#include <wtf/ThreadSafeRefCounted.h>
#include <wtf/TypeCasts.h>
#include <wtf/Vector.h>
#include <wtf/text/WTFString.h>

namespace WebCore {

class WebCoreOpaqueRoot;

enum class CryptoKeyClass {
    AES,
    EC,
    HMAC,
    OKP,
    RSA,
    Raw,
};

class CryptoKey : public ThreadSafeRefCounted<CryptoKey> {
public:
    using Type = CryptoKeyType;
    using KeyAlgorithm = std::variant<CryptoKeyAlgorithm, CryptoAesKeyAlgorithm, CryptoEcKeyAlgorithm, CryptoHmacKeyAlgorithm, CryptoRsaHashedKeyAlgorithm, CryptoRsaKeyAlgorithm>;

    CryptoKey(CryptoAlgorithmIdentifier, Type, bool extractable, CryptoKeyUsageBitmap);
    virtual ~CryptoKey();

    Type type() const;
    bool extractable() const { return m_extractable; }
    Vector<CryptoKeyUsage> usages() const;
    virtual KeyAlgorithm algorithm() const = 0;

    virtual CryptoKeyClass keyClass() const = 0;

    CryptoAlgorithmIdentifier algorithmIdentifier() const { return m_algorithmIdentifier; }
    CryptoKeyUsageBitmap usagesBitmap() const { return m_usages; }
    void setUsagesBitmap(CryptoKeyUsageBitmap usage) { m_usages = usage; };
    bool allows(CryptoKeyUsageBitmap usage) const { return usage == (m_usages & usage); }

    static Vector<uint8_t> randomData(size_t);

private:
    CryptoAlgorithmIdentifier m_algorithmIdentifier;
    Type m_type;
    bool m_extractable;
    CryptoKeyUsageBitmap m_usages;
};

inline auto CryptoKey::type() const -> Type
{
    return m_type;
}

WebCoreOpaqueRoot root(CryptoKey*);

} // namespace WebCore

#define SPECIALIZE_TYPE_TRAITS_CRYPTO_KEY(ToClassName, KeyClass) \
    SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::ToClassName)           \
    static bool isType(const WebCore::CryptoKey& key)            \
    {                                                            \
        return key.keyClass() == WebCore::KeyClass;              \
    }                                                            \
    SPECIALIZE_TYPE_TRAITS_END()
