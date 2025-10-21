/*
 * Copyright (C) 2018 Sony Interactive Entertainment Inc.
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
#include "CryptoDigest.h"

#include <openssl/sha.h>

namespace {
struct SHA1Functions {
    static constexpr auto init = SHA1_Init;
    static constexpr auto update = SHA1_Update;
    static constexpr auto final = SHA1_Final;
    static constexpr size_t digestLength = SHA_DIGEST_LENGTH;
};

struct SHA224Functions {
    static constexpr auto init = SHA224_Init;
    static constexpr auto update = SHA224_Update;
    static constexpr auto final = SHA224_Final;
    static constexpr size_t digestLength = SHA224_DIGEST_LENGTH;
};

struct SHA256Functions {
    static constexpr auto init = SHA256_Init;
    static constexpr auto update = SHA256_Update;
    static constexpr auto final = SHA256_Final;
    static constexpr size_t digestLength = SHA256_DIGEST_LENGTH;
};

struct SHA384Functions {
    static constexpr auto init = SHA384_Init;
    static constexpr auto update = SHA384_Update;
    static constexpr auto final = SHA384_Final;
    static constexpr size_t digestLength = SHA384_DIGEST_LENGTH;
};

struct SHA512Functions {
    static constexpr auto init = SHA512_Init;
    static constexpr auto update = SHA512_Update;
    static constexpr auto final = SHA512_Final;
    static constexpr size_t digestLength = SHA512_DIGEST_LENGTH;
};
}

namespace PAL {

struct CryptoDigestContext {
    virtual ~CryptoDigestContext() = default;
    virtual void addBytes(const void* input, size_t length) = 0;
    virtual Vector<uint8_t> computeHash() = 0;
};

template<typename SHAContext, typename SHAFunctions>
struct CryptoDigestContextImpl : public CryptoDigestContext {
    WTF_DEPRECATED_MAKE_STRUCT_FAST_ALLOCATED(CryptoDigestContextImpl);

    static std::unique_ptr<CryptoDigestContext> create()
    {
        return makeUnique<CryptoDigestContextImpl>();
    }

    CryptoDigestContextImpl()
    {
        SHAFunctions::init(&m_context);
    }

    void addBytes(const void* input, size_t length) override
    {
        SHAFunctions::update(&m_context, input, length);
    }

    Vector<uint8_t> computeHash() override
    {
        Vector<uint8_t> result(SHAFunctions::digestLength);
        SHAFunctions::final(result.begin(), &m_context);
        return result;
    }

private:
    SHAContext m_context;
};

CryptoDigest::CryptoDigest()
{
}

CryptoDigest::~CryptoDigest()
{
}

std::unique_ptr<CryptoDigest> CryptoDigest::create(CryptoDigest::Algorithm algorithm)
{
    std::unique_ptr<CryptoDigest> digest(new CryptoDigest);

    switch (algorithm) {
    case CryptoDigest::Algorithm::SHA_1:
        digest->m_context = CryptoDigestContextImpl<SHA_CTX, SHA1Functions>::create();
        return digest;
    case CryptoDigest::Algorithm::SHA_224:
        digest->m_context = CryptoDigestContextImpl<SHA256_CTX, SHA224Functions>::create();
        return digest;
    case CryptoDigest::Algorithm::SHA_256:
        digest->m_context = CryptoDigestContextImpl<SHA256_CTX, SHA256Functions>::create();
        return digest;
    case CryptoDigest::Algorithm::SHA_384:
        digest->m_context = CryptoDigestContextImpl<SHA512_CTX, SHA384Functions>::create();
        return digest;
    case CryptoDigest::Algorithm::SHA_512:
        digest->m_context = CryptoDigestContextImpl<SHA512_CTX, SHA512Functions>::create();
        return digest;
    }

    return nullptr;
}

void CryptoDigest::addBytes(const void* input, size_t length)
{
    ASSERT(m_context);
    m_context->addBytes(input, length);
}

Vector<uint8_t> CryptoDigest::computeHash()
{
    ASSERT(m_context);
    return m_context->computeHash();
}

} // namespace PAL
