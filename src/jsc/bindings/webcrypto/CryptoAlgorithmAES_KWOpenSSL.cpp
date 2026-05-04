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
#include "CryptoAlgorithmAES_KW.h"

#if ENABLE(WEB_CRYPTO)

#include "CryptoKeyAES.h"
#include "OpenSSLUtilities.h"

namespace WebCore {

static std::optional<Vector<uint8_t>> cryptWrapKey(const Vector<uint8_t>& key, const Vector<uint8_t>& data)
{
    if (data.size() % 8)
        return std::nullopt;

    AESKey aesKey;
    if (!aesKey.setKey(key, AES_ENCRYPT))
        return std::nullopt;

    Vector<uint8_t> cipherText(data.size() + 8);
    if (AES_wrap_key(aesKey.key(), nullptr, cipherText.begin(), data.begin(), data.size()) < 0)
        return std::nullopt;

    return cipherText;
}

static std::optional<Vector<uint8_t>> cryptUnwrapKey(const Vector<uint8_t>& key, const Vector<uint8_t>& data)
{
    if (data.size() % 8 || !data.size())
        return std::nullopt;

    AESKey aesKey;
    if (!aesKey.setKey(key, AES_DECRYPT))
        return std::nullopt;

    Vector<uint8_t> plainText(data.size() - 8);
    if (AES_unwrap_key(aesKey.key(), nullptr, plainText.begin(), data.begin(), data.size()) < 0)
        return std::nullopt;

    return plainText;
}

ExceptionOr<Vector<uint8_t>> CryptoAlgorithmAES_KW::platformWrapKey(const CryptoKeyAES& key, const Vector<uint8_t>& data)
{
    auto output = cryptWrapKey(key.key(), data);
    if (!output)
        return Exception { OperationError };
    return WTF::move(*output);
}

ExceptionOr<Vector<uint8_t>> CryptoAlgorithmAES_KW::platformUnwrapKey(const CryptoKeyAES& key, const Vector<uint8_t>& data)
{
    auto output = cryptUnwrapKey(key.key(), data);
    if (!output)
        return Exception { OperationError };
    return WTF::move(*output);
}

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)
