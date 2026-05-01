/*
 * Copyright (C) 2021 Sony Interactive Entertainment Inc.
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

#include "CryptoAlgorithmIdentifier.h"
#include "OpenSSLCryptoUniquePtr.h"
#include <openssl/aes.h>
#include <openssl/evp.h>
#include <stdint.h>
#include <wtf/Noncopyable.h>
#include <wtf/Vector.h>

#if ENABLE(WEB_CRYPTO)

namespace WebCore {

const EVP_MD* digestAlgorithm(CryptoAlgorithmIdentifier hashFunction);

std::optional<Vector<uint8_t>> calculateDigest(const EVP_MD* algorithm, const Vector<uint8_t>& message);

Vector<uint8_t> convertToBytes(const BIGNUM*);

Vector<uint8_t> convertToBytesExpand(const BIGNUM*, size_t bufferSize);

BIGNUMPtr convertToBigNumber(const Vector<uint8_t>& bytes);

class AESKey {
    WTF_MAKE_NONCOPYABLE(AESKey);

public:
    AESKey() = default;
    ~AESKey();

    bool setKey(const Vector<uint8_t>& key, int enc /* AES_ENCRYPT or AES_DECRYPT */);

    AES_KEY* key() { return &m_key; }

private:
    AES_KEY m_key;
};

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)
