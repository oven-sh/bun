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

// One implementation backs ML-DSA-44/65/87; the registered subclasses below
// only pin the name and identifier, mirroring Node's ml_dsa.js.
class CryptoAlgorithmMLDSA : public CryptoAlgorithm {
public:
    static constexpr size_t s_maxContextLength = 255;

    void generateKey(const CryptoAlgorithmParameters&, bool extractable, CryptoKeyUsageBitmap, KeyOrKeyPairCallback&&, ExceptionCallback&&, ScriptExecutionContext&) final;
    void sign(const CryptoAlgorithmParameters&, Ref<CryptoKey>&&, Vector<uint8_t>&&, VectorCallback&&, ExceptionCallback&&, ScriptExecutionContext&, WorkQueue&) final;
    void verify(const CryptoAlgorithmParameters&, Ref<CryptoKey>&&, Vector<uint8_t>&& signature, Vector<uint8_t>&&, BoolCallback&&, ExceptionCallback&&, ScriptExecutionContext&, WorkQueue&) final;
    void importKey(CryptoKeyFormat, KeyData&&, const CryptoAlgorithmParameters&, bool extractable, CryptoKeyUsageBitmap, KeyCallback&&, ExceptionCallback&&) final;
    void exportKey(CryptoKeyFormat, Ref<CryptoKey>&&, KeyDataCallback&&, ExceptionCallback&&) final;

protected:
    explicit CryptoAlgorithmMLDSA(CryptoAlgorithmIdentifier identifier)
        : m_identifier(identifier)
    {
    }

    CryptoAlgorithmIdentifier identifier() const final { return m_identifier; }

private:
    static ExceptionOr<Vector<uint8_t>> platformSign(const CryptoKeyAKP&, const Vector<uint8_t>& context, const Vector<uint8_t>& data);
    static ExceptionOr<bool> platformVerify(const CryptoKeyAKP&, const Vector<uint8_t>& context, const Vector<uint8_t>& signature, const Vector<uint8_t>& data);

    CryptoAlgorithmIdentifier m_identifier;
};

class CryptoAlgorithmMLDSA44 final : public CryptoAlgorithmMLDSA {
public:
    static constexpr ASCIILiteral s_name = "ML-DSA-44"_s;
    static constexpr CryptoAlgorithmIdentifier s_identifier = CryptoAlgorithmIdentifier::ML_DSA_44;
    static Ref<CryptoAlgorithm> create() { return adoptRef(*new CryptoAlgorithmMLDSA44); }

private:
    CryptoAlgorithmMLDSA44()
        : CryptoAlgorithmMLDSA(s_identifier)
    {
    }
};

class CryptoAlgorithmMLDSA65 final : public CryptoAlgorithmMLDSA {
public:
    static constexpr ASCIILiteral s_name = "ML-DSA-65"_s;
    static constexpr CryptoAlgorithmIdentifier s_identifier = CryptoAlgorithmIdentifier::ML_DSA_65;
    static Ref<CryptoAlgorithm> create() { return adoptRef(*new CryptoAlgorithmMLDSA65); }

private:
    CryptoAlgorithmMLDSA65()
        : CryptoAlgorithmMLDSA(s_identifier)
    {
    }
};

class CryptoAlgorithmMLDSA87 final : public CryptoAlgorithmMLDSA {
public:
    static constexpr ASCIILiteral s_name = "ML-DSA-87"_s;
    static constexpr CryptoAlgorithmIdentifier s_identifier = CryptoAlgorithmIdentifier::ML_DSA_87;
    static Ref<CryptoAlgorithm> create() { return adoptRef(*new CryptoAlgorithmMLDSA87); }

private:
    CryptoAlgorithmMLDSA87()
        : CryptoAlgorithmMLDSA(s_identifier)
    {
    }
};

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)
