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
#include "CryptoAlgorithmRegistry.h"

#if ENABLE(WEB_CRYPTO)

#include "CryptoAlgorithm.h"
#include <wtf/NeverDestroyed.h>

namespace WebCore {

CryptoAlgorithmRegistry& CryptoAlgorithmRegistry::singleton()
{
    static LazyNeverDestroyed<CryptoAlgorithmRegistry> registry;
    static std::once_flag onceKey;
    std::call_once(onceKey, [&] {
        registry.construct();
    });
    return registry;
}

CryptoAlgorithmRegistry::CryptoAlgorithmRegistry()
{
    platformRegisterAlgorithms();
}

std::optional<CryptoAlgorithmIdentifier> CryptoAlgorithmRegistry::identifier(const String& name)
{
    if (name.isEmpty())
        return std::nullopt;

    Locker locker { m_lock };

    // FIXME: How is it helpful to call isolatedCopy on the argument to find?
    auto identifier = m_identifiers.find(name.isolatedCopy());
    if (identifier == m_identifiers.end())
        return std::nullopt;

    return identifier->value;
}

String CryptoAlgorithmRegistry::name(CryptoAlgorithmIdentifier identifier)
{
    Locker locker { m_lock };

    auto contructor = m_constructors.find(static_cast<unsigned>(identifier));
    if (contructor == m_constructors.end())
        return {};

    return contructor->value.first.isolatedCopy();
}

RefPtr<CryptoAlgorithm> CryptoAlgorithmRegistry::create(CryptoAlgorithmIdentifier identifier)
{
    Locker locker { m_lock };

    auto contructor = m_constructors.find(static_cast<unsigned>(identifier));
    if (contructor == m_constructors.end())
        return nullptr;

    return contructor->value.second();
}

void CryptoAlgorithmRegistry::registerAlgorithm(const String& name, CryptoAlgorithmIdentifier identifier, CryptoAlgorithmConstructor constructor)
{
    Locker locker { m_lock };

    ASSERT(!m_identifiers.contains(name));
    // hashs can contains 2 names (SHA-256 and SHA256)
    // ASSERT(!m_constructors.contains(static_cast<unsigned>(identifier)));

    m_identifiers.add(name, identifier);
    m_constructors.add(static_cast<unsigned>(identifier), std::make_pair(name, constructor));
}

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)
