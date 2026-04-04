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
#include "SerializedCryptoKeyWrap.h"

#include "OpenSSLUtilities.h"
#include <openssl/rand.h>

#if ENABLE(WEB_CRYPTO)

namespace WebCore {

static constexpr size_t masterKeySize = 32; // 256-bit AES key

static Vector<uint8_t>& getPerProcessMasterKey()
{
    static Vector<uint8_t> masterKey;
    static std::once_flag flag;
    std::call_once(flag, [] {
        masterKey.resize(masterKeySize);
        RAND_bytes(masterKey.begin(), masterKeySize);
    });
    return masterKey;
}

std::optional<Vector<uint8_t>> defaultWebCryptoMasterKey()
{
    return getPerProcessMasterKey();
}

bool deleteDefaultWebCryptoMasterKey()
{
    return true;
}

bool wrapSerializedCryptoKey(const Vector<uint8_t>& masterKey, const Vector<uint8_t>& key, Vector<uint8_t>& result)
{
    if (masterKey.size() < masterKeySize || key.isEmpty())
        return false;

    AESKey aesKey;
    if (!aesKey.setKey(masterKey, AES_ENCRYPT))
        return false;

    // AES_wrap_key_padded (RFC 5649) handles arbitrary-length input.
    // Maximum output size is input size rounded up to 8-byte boundary plus 8 bytes for the IV.
    size_t maxOutputSize = ((key.size() + 7) & ~static_cast<size_t>(7)) + 8;
    result.resize(maxOutputSize);
    size_t outLen = 0;
    if (!AES_wrap_key_padded(aesKey.key(), result.begin(), &outLen, maxOutputSize, key.begin(), key.size()))
        return false;

    result.shrink(outLen);
    return true;
}

bool unwrapSerializedCryptoKey(const Vector<uint8_t>& masterKey, const Vector<uint8_t>& wrappedKey, Vector<uint8_t>& key)
{
    if (masterKey.size() < masterKeySize || wrappedKey.isEmpty())
        return false;

    AESKey aesKey;
    if (!aesKey.setKey(masterKey, AES_DECRYPT))
        return false;

    // Output size is at most the wrapped size (minus 8 bytes for the IV/padding header).
    size_t maxOutputSize = wrappedKey.size();
    key.resize(maxOutputSize);
    size_t outLen = 0;
    if (!AES_unwrap_key_padded(aesKey.key(), key.begin(), &outLen, maxOutputSize, wrappedKey.begin(), wrappedKey.size()))
        return false;

    key.shrink(outLen);
    return true;
}

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)
