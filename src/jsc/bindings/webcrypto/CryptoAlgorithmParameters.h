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

#include "CryptoAlgorithmIdentifier.h"
#include <wtf/TypeCasts.h>
#include <wtf/text/WTFString.h>

#if ENABLE(WEB_CRYPTO)

namespace WebCore {

class CryptoAlgorithmParameters {
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED(CryptoAlgorithmParameters);

public:
    enum class Class {
        None,
        AesCbcCfbParams,
        AesCtrParams,
        AesGcmParams,
        AesKeyParams,
        EcKeyParams,
        EcdhKeyDeriveParams,
        EcdsaParams,
        HkdfParams,
        HmacKeyParams,
        Pbkdf2Params,
        RsaHashedKeyGenParams,
        RsaHashedImportParams,
        RsaKeyGenParams,
        RsaOaepParams,
        RsaPssParams,
        X25519Params,
    };

    // FIXME: Consider merging name and identifier.
    String name;
    CryptoAlgorithmIdentifier identifier { CryptoAlgorithmIdentifier::None };

    virtual ~CryptoAlgorithmParameters() = default;

    virtual Class parametersClass() const { return Class::None; }
};

} // namespace WebCore

// clang-format off

#define SPECIALIZE_TYPE_TRAITS_CRYPTO_ALGORITHM_PARAMETERS(ToClassName) \
SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::CryptoAlgorithm##ToClassName) \
static bool isType(const WebCore::CryptoAlgorithmParameters& parameters) { return parameters.parametersClass() == WebCore::CryptoAlgorithmParameters::Class::ToClassName; } \
SPECIALIZE_TYPE_TRAITS_END()

// clang-format on

#endif // ENABLE(WEB_CRYPTO)
