/*
 * Copyright (C) 2016, 2017, 2026 Apple Inc. All rights reserved.
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
#include "CryptoKey.h"
#include <optional>
#include <variant>
#include <wtf/Ref.h>
#include <wtf/Vector.h>
#include <wtf/text/WTFString.h>

#if ENABLE(WEB_CRYPTO)

namespace WebCore {

struct CryptoAlgorithmAeadParams {
    Vector<uint8_t> iv;
    Vector<uint8_t> additionalData;
    uint8_t tagLength;
};

struct CryptoAlgorithmAesCbcCfbParams {
    Vector<uint8_t> iv;
};

struct CryptoAlgorithmAesCtrParams {
    Vector<uint8_t> counter;
    size_t length;
};

struct CryptoAlgorithmAesKeyParams {
    unsigned short length;
};

struct CryptoAlgorithmEcKeyParams {
    String namedCurve; // Shared with the JS string: only a copy can leave the thread.
};

struct CryptoAlgorithmEcdhKeyDeriveParams {
    Ref<CryptoKey> publicKey;
};

struct CryptoAlgorithmEcdsaParams {
    CryptoAlgorithmIdentifier hashIdentifier;
};

struct CryptoAlgorithmHkdfParams {
    CryptoAlgorithmIdentifier hashIdentifier;
    Vector<uint8_t> salt;
    Vector<uint8_t> info;
};

struct CryptoAlgorithmHmacKeyParams {
    CryptoAlgorithmIdentifier hashIdentifier;
    std::optional<size_t> length;
};

struct CryptoAlgorithmMlDsaParams {
    Vector<uint8_t> context;
};

struct CryptoAlgorithmPbkdf2Params {
    CryptoAlgorithmIdentifier hashIdentifier;
    Vector<uint8_t> salt;
    unsigned long iterations;
};

struct CryptoAlgorithmRsaHashedImportParams {
    CryptoAlgorithmIdentifier hashIdentifier;
};

struct CryptoAlgorithmRsaHashedKeyGenParams {
    CryptoAlgorithmIdentifier hashIdentifier;
    size_t modulusLength;
    Vector<uint8_t> publicExponent;
};

struct CryptoAlgorithmRsaOaepParams {
    Vector<uint8_t> label;
};

struct CryptoAlgorithmRsaPssParams {
    size_t saltLength;
};

// A normalized algorithm. It owns its buffers and holds no JS object.
struct CryptoAlgorithmParameters {
    using Dictionary = std::variant<std::monostate,
        CryptoAlgorithmAeadParams,
        CryptoAlgorithmAesCbcCfbParams,
        CryptoAlgorithmAesCtrParams,
        CryptoAlgorithmAesKeyParams,
        CryptoAlgorithmEcKeyParams,
        CryptoAlgorithmEcdhKeyDeriveParams,
        CryptoAlgorithmEcdsaParams,
        CryptoAlgorithmHkdfParams,
        CryptoAlgorithmHmacKeyParams,
        CryptoAlgorithmMlDsaParams,
        CryptoAlgorithmPbkdf2Params,
        CryptoAlgorithmRsaHashedImportParams,
        CryptoAlgorithmRsaHashedKeyGenParams,
        CryptoAlgorithmRsaOaepParams,
        CryptoAlgorithmRsaPssParams>;

    CryptoAlgorithmIdentifier identifier;
    Dictionary dictionary;
};

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)
