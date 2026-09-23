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

#if ENABLE(WEB_CRYPTO)

namespace WebCore {

enum {
    CryptoKeyUsageEncrypt = 1 << 0,
    CryptoKeyUsageDecrypt = 1 << 1,
    CryptoKeyUsageSign = 1 << 2,
    CryptoKeyUsageVerify = 1 << 3,
    CryptoKeyUsageDeriveKey = 1 << 4,
    CryptoKeyUsageDeriveBits = 1 << 5,
    CryptoKeyUsageWrapKey = 1 << 6,
    CryptoKeyUsageUnwrapKey = 1 << 7,
    // Node appends the KEM usages after the eight WebCrypto Level 2 usages;
    // CryptoKey.usages and JWK key_ops enumerate in this canonical order.
    CryptoKeyUsageEncapsulateKey = 1 << 8,
    CryptoKeyUsageEncapsulateBits = 1 << 9,
    CryptoKeyUsageDecapsulateKey = 1 << 10,
    CryptoKeyUsageDecapsulateBits = 1 << 11
};

typedef int CryptoKeyUsageBitmap;

// The KEM usages are invalid for every non-KEM algorithm; exclusion-list
// usage guards OR this in alongside their algorithm-specific bits.
constexpr int CryptoKeyUsageKemMask = CryptoKeyUsageEncapsulateKey | CryptoKeyUsageEncapsulateBits | CryptoKeyUsageDecapsulateKey | CryptoKeyUsageDecapsulateBits;

// Only for binding purpose.
enum class CryptoKeyUsage {
    Encrypt,
    Decrypt,
    Sign,
    Verify,
    DeriveKey,
    DeriveBits,
    WrapKey,
    UnwrapKey,
    EncapsulateKey,
    EncapsulateBits,
    DecapsulateKey,
    DecapsulateBits
};

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)
