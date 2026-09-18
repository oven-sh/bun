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

#pragma once

#include "CryptoAlgorithm.h"

#if ENABLE(WEB_CRYPTO)

namespace WebCore {

class CryptoKeyAKP;

// One implementation backs ML-KEM-768/1024; the registered subclasses below
// only pin the name and identifier, mirroring Node's ml_kem.js. ML-KEM-512
// is not registered because the vendored BoringSSL has no EVP support for it.
class CryptoAlgorithmMLKEM : public CryptoAlgorithm {
public:
    void generateKey(const CryptoAlgorithmParameters&, bool extractable, CryptoKeyUsageBitmap, KeyOrKeyPairCallback&&, ExceptionCallback&&, ScriptExecutionContext&) final;
    void importKey(CryptoKeyFormat, KeyData&&, const CryptoAlgorithmParameters&, bool extractable, CryptoKeyUsageBitmap, KeyCallback&&, ExceptionCallback&&) final;
    void exportKey(CryptoKeyFormat, Ref<CryptoKey>&&, KeyDataCallback&&, ExceptionCallback&&) final;
    void encapsulate(Ref<CryptoKey>&&, VectorPairCallback&&, ExceptionCallback&&) final;
    void decapsulate(Ref<CryptoKey>&&, Vector<uint8_t>&& ciphertext, VectorCallback&&, ExceptionCallback&&) final;

protected:
    explicit CryptoAlgorithmMLKEM(CryptoAlgorithmIdentifier identifier)
        : m_identifier(identifier)
    {
    }

    CryptoAlgorithmIdentifier identifier() const final { return m_identifier; }

private:
    CryptoAlgorithmIdentifier m_identifier;
};

class CryptoAlgorithmMLKEM768 final : public CryptoAlgorithmMLKEM {
public:
    static constexpr ASCIILiteral s_name = "ML-KEM-768"_s;
    static constexpr CryptoAlgorithmIdentifier s_identifier = CryptoAlgorithmIdentifier::ML_KEM_768;
    static Ref<CryptoAlgorithm> create() { return adoptRef(*new CryptoAlgorithmMLKEM768); }

private:
    CryptoAlgorithmMLKEM768()
        : CryptoAlgorithmMLKEM(s_identifier)
    {
    }
};

class CryptoAlgorithmMLKEM1024 final : public CryptoAlgorithmMLKEM {
public:
    static constexpr ASCIILiteral s_name = "ML-KEM-1024"_s;
    static constexpr CryptoAlgorithmIdentifier s_identifier = CryptoAlgorithmIdentifier::ML_KEM_1024;
    static Ref<CryptoAlgorithm> create() { return adoptRef(*new CryptoAlgorithmMLKEM1024); }

private:
    CryptoAlgorithmMLKEM1024()
        : CryptoAlgorithmMLKEM(s_identifier)
    {
    }
};

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)
