/*
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

#include "config.h"
#include "CryptoAlgorithmECDH.h"

#if ENABLE(WEB_CRYPTO)

#include "CryptoKeyEC.h"
#include "OpenSSLUtilities.h"

namespace WebCore {

std::optional<Vector<uint8_t>> CryptoAlgorithmECDH::platformDeriveBits(const CryptoKeyEC& baseKey, const CryptoKeyEC& publicKey)
{
    auto ctx = EvpPKeyCtxPtr(EVP_PKEY_CTX_new(baseKey.platformKey(), nullptr));
    if (!ctx)
        return std::nullopt;

    if (EVP_PKEY_derive_init(ctx.get()) <= 0)
        return std::nullopt;

    if (EVP_PKEY_derive_set_peer(ctx.get(), publicKey.platformKey()) <= 0)
        return std::nullopt;

    // Call with a nullptr to get the required buffer size.
    size_t keyLen;
    if (EVP_PKEY_derive(ctx.get(), nullptr, &keyLen) <= 0)
        return std::nullopt;

    Vector<uint8_t> key(keyLen);
    if (EVP_PKEY_derive(ctx.get(), key.begin(), &keyLen) <= 0)
        return std::nullopt;

    // Shrink the buffer since the new keyLen may differ from the buffer size.
    key.shrink(keyLen);

    return key;
}

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)
