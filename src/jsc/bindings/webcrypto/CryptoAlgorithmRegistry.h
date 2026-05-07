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

#include "CryptoAlgorithmIdentifier.h"
#include <wtf/Forward.h>
#include <wtf/HashMap.h>
#include <wtf/Lock.h>
#include <wtf/Noncopyable.h>
#include <wtf/text/StringHash.h>

#if ENABLE(WEB_CRYPTO)

namespace WebCore {

class CryptoAlgorithm;

class CryptoAlgorithmRegistry {
    WTF_MAKE_NONCOPYABLE(CryptoAlgorithmRegistry);
    friend class LazyNeverDestroyed<CryptoAlgorithmRegistry>;

public:
    static CryptoAlgorithmRegistry& singleton();

    std::optional<CryptoAlgorithmIdentifier> identifier(const String&);
    String name(CryptoAlgorithmIdentifier);

    RefPtr<CryptoAlgorithm> create(CryptoAlgorithmIdentifier);

private:
    CryptoAlgorithmRegistry();
    void platformRegisterAlgorithms();

    using CryptoAlgorithmConstructor = Ref<CryptoAlgorithm> (*)();

    template<typename AlgorithmClass> void registerAlgorithm()
    {
        registerAlgorithm(AlgorithmClass::s_name, AlgorithmClass::s_identifier, AlgorithmClass::create);
    }
    template<typename AlgorithmClass> void registerAlgorithmWithAlternativeName()
    {
        registerAlgorithm(AlgorithmClass::s_name, AlgorithmClass::s_identifier, AlgorithmClass::create);
        registerAlgorithm(AlgorithmClass::s_alternative_name, AlgorithmClass::s_identifier, AlgorithmClass::create);
    }

    void registerAlgorithm(const String& name, CryptoAlgorithmIdentifier, CryptoAlgorithmConstructor);

    Lock m_lock;
    HashMap<String, CryptoAlgorithmIdentifier, ASCIICaseInsensitiveHash> m_identifiers WTF_GUARDED_BY_LOCK(m_lock);
    HashMap<unsigned, std::pair<String, CryptoAlgorithmConstructor>> m_constructors WTF_GUARDED_BY_LOCK(m_lock);
};

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)
