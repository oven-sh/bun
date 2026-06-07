/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
 * Copyright (C) 2020 Sony Interactive Entertainment Inc.
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

class CryptoAlgorithmAesCtrParams;
class CryptoKeyAES;

class CryptoAlgorithmAES_CTR final : public CryptoAlgorithm {
public:
    class CounterBlockHelper {
    public:
        CounterBlockHelper(const Vector<uint8_t>& counterVector, size_t counterLength);

        size_t countToOverflowSaturating() const;
        Vector<uint8_t> counterVectorAfterOverflow() const;

    private:
        // 128 bits integer with miminum required operators.
        struct CounterBlockBits {
            void set();
            bool all() const;
            bool any() const;

            CounterBlockBits operator&(const CounterBlockBits&) const;
            CounterBlockBits operator~() const;
            CounterBlockBits& operator<<=(unsigned);
            CounterBlockBits& operator&=(const CounterBlockBits&);

            uint64_t m_hi { 0 };
            uint64_t m_lo { 0 };
        };

        CounterBlockBits m_bits;
        const size_t m_counterLength;
    };

    static constexpr ASCIILiteral s_name = "AES-CTR"_s;
    static constexpr CryptoAlgorithmIdentifier s_identifier = CryptoAlgorithmIdentifier::AES_CTR;
    static Ref<CryptoAlgorithm> create();

private:
    CryptoAlgorithmAES_CTR() = default;
    CryptoAlgorithmIdentifier identifier() const final;

    void encrypt(const CryptoAlgorithmParameters&, Ref<CryptoKey>&&, Vector<uint8_t>&&, VectorCallback&&, ExceptionCallback&&, ScriptExecutionContext&, WorkQueue&) final;
    void decrypt(const CryptoAlgorithmParameters&, Ref<CryptoKey>&&, Vector<uint8_t>&&, VectorCallback&&, ExceptionCallback&&, ScriptExecutionContext&, WorkQueue&) final;
    void generateKey(const CryptoAlgorithmParameters&, bool extractable, CryptoKeyUsageBitmap, KeyOrKeyPairCallback&&, ExceptionCallback&&, ScriptExecutionContext&) final;
    void importKey(CryptoKeyFormat, KeyData&&, const CryptoAlgorithmParameters&, bool extractable, CryptoKeyUsageBitmap, KeyCallback&&, ExceptionCallback&&) final;
    void exportKey(CryptoKeyFormat, Ref<CryptoKey>&&, KeyDataCallback&&, ExceptionCallback&&) final;
    ExceptionOr<size_t> getKeyLength(const CryptoAlgorithmParameters&) final;

    static ExceptionOr<Vector<uint8_t>> platformEncrypt(const CryptoAlgorithmAesCtrParams&, const CryptoKeyAES&, const Vector<uint8_t>&);
    static ExceptionOr<Vector<uint8_t>> platformDecrypt(const CryptoAlgorithmAesCtrParams&, const CryptoKeyAES&, const Vector<uint8_t>&);
};

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)
