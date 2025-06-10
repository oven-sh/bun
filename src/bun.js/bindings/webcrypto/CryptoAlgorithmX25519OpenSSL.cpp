/*
 * Copyright (C) 2021 Apple Inc. All rights reserved.
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
#include "CryptoAlgorithmX25519.h"

#if ENABLE(WEB_CRYPTO)

#include "CryptoKeyOKP.h"
#include <openssl/curve25519.h>
#include <openssl/evp.h>
#include <wtf/Vector.h>

namespace WebCore {

std::optional<Vector<uint8_t>> CryptoAlgorithmX25519::platformDeriveBits(const CryptoKeyOKP& baseKey, const CryptoKeyOKP& publicKey)
{
    if (baseKey.type() != CryptoKey::Type::Private || publicKey.type() != CryptoKey::Type::Public)
        return std::nullopt;

    auto baseKeyData = baseKey.platformKey();
    auto publicKeyData = publicKey.platformKey();

    if (baseKeyData.size() != X25519_PRIVATE_KEY_LEN || publicKeyData.size() != X25519_PUBLIC_VALUE_LEN)
        return std::nullopt;

    Vector<uint8_t> sharedSecret(X25519_SHARED_KEY_LEN);
    
    if (!X25519(sharedSecret.data(), baseKeyData.data(), publicKeyData.data()))
        return std::nullopt;

    return sharedSecret;
}

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)