/*
 * Copyright (C) 2016 Apple Inc. All rights reserved.
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

#include "CryptoKeyUsage.h"
#include "RsaOtherPrimesInfo.h"
#include <bit>
#include <wtf/Vector.h>

#if ENABLE(WEB_CRYPTO)

namespace WebCore {

struct JsonWebKey {
    String kty;
    String use;
    // Strings, as in the Web Crypto IDL, where WebKit has CryptoKeyUsage: any string is a
    // valid entry (RFC 7517 section 4.3). `usages` is the bitmap of the entries that name a
    // KeyUsage, set by normalizeJsonWebKey().
    std::optional<Vector<String>> key_ops;
    CryptoKeyUsageBitmap usages;
    String alg;

    std::optional<bool> ext;

    String crv;
    String x;
    String y;
    String d;
    String n;
    String e;
    String p;
    String q;
    String dp;
    String dq;
    String qi;
    std::optional<Vector<RsaOtherPrimesInfo>> oth;
    String k;
    // JWK "AKP" key type (ML-DSA / ML-KEM), RFC draft-ietf-cose-dilithium.
    String pub;
    String priv;
};

// The key_ops of an exported key: its usages, in KeyUsage order.
Vector<String> toJwkKeyOps(CryptoKeyUsageBitmap);

bool hasRepeatedJwkKeyOp(const Vector<String>&);

// Node's validateKeyOps rejects a repeated key_ops entry for every algorithm
// before the operations/usages mismatch check.
inline bool hasDuplicateJwkKeyOps(const JsonWebKey& jwk)
{
    // `usages` has one bit for each distinct entry that names a KeyUsage, so equal
    // counts mean that no entry is repeated and none is foreign.
    if (!jwk.key_ops || jwk.key_ops->size() == static_cast<size_t>(std::popcount(static_cast<unsigned>(jwk.usages))))
        return false;
    return hasRepeatedJwkKeyOp(*jwk.key_ops);
}

// Whether `key_ops`, if the key has any, is well formed and covers `usages`.
inline bool jwkKeyOpsAllow(const JsonWebKey& jwk, CryptoKeyUsageBitmap usages)
{
    return !jwk.key_ops || (!hasDuplicateJwkKeyOps(jwk) && (jwk.usages & usages) == usages);
}

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)
