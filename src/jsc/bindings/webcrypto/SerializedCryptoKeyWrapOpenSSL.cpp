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

#include "CryptoAlgorithmAES_CTR.h"

#if ENABLE(WEB_CRYPTO)

// #include "NotImplemented.h"

namespace WebCore {

std::optional<Vector<uint8_t>> defaultWebCryptoMasterKey()
{
    // notImplemented();
    return std::nullopt;
}

// Initially these helper functions were intended to perform KEK wrapping and unwrapping,
// but this is not required anymore, despite the function names and the Mac implementation
// still indicating otherwise.
// See https://bugs.webkit.org/show_bug.cgi?id=173883 for more info.

bool wrapSerializedCryptoKey(const Vector<uint8_t>& masterKey, const Vector<uint8_t>& key, Vector<uint8_t>& result)
{
    UNUSED_PARAM(masterKey);

    // No wrapping performed -- the serialized key data is copied into the `result` variable.
    result = Vector<uint8_t>(key);
    return true;
}

bool unwrapSerializedCryptoKey(const Vector<uint8_t>& masterKey, const Vector<uint8_t>& wrappedKey, Vector<uint8_t>& key)
{
    UNUSED_PARAM(masterKey);

    // No unwrapping performed -- the serialized key data is copied into the `key` variable.
    key = Vector<uint8_t>(wrappedKey);
    return true;
}

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)
