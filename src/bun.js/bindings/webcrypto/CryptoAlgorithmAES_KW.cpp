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

#include "config.h"
#include "CryptoAlgorithmAES_KW.h"

#if ENABLE(WEB_CRYPTO)

#include "CryptoAlgorithmAesKeyParams.h"
#include "CryptoKeyAES.h"
#include <variant>

namespace WebCore {

namespace CryptoAlgorithmAES_KWInternal {
static constexpr auto ALG128 = "A128KW"_s;
static constexpr auto ALG192 = "A192KW"_s;
static constexpr auto ALG256 = "A256KW"_s;
}

static inline bool usagesAreInvalidForCryptoAlgorithmAES_KW(CryptoKeyUsageBitmap usages)
{
    return usages & (CryptoKeyUsageSign | CryptoKeyUsageVerify | CryptoKeyUsageDeriveKey | CryptoKeyUsageDeriveBits | CryptoKeyUsageEncrypt | CryptoKeyUsageDecrypt);
}

Ref<CryptoAlgorithm> CryptoAlgorithmAES_KW::create()
{
    return adoptRef(*new CryptoAlgorithmAES_KW);
}

CryptoAlgorithmIdentifier CryptoAlgorithmAES_KW::identifier() const
{
    return s_identifier;
}

void CryptoAlgorithmAES_KW::generateKey(const CryptoAlgorithmParameters& parameters, bool extractable, CryptoKeyUsageBitmap usages, KeyOrKeyPairCallback&& callback, ExceptionCallback&& exceptionCallback, ScriptExecutionContext&)
{
    if (usagesAreInvalidForCryptoAlgorithmAES_KW(usages)) {
        exceptionCallback(SyntaxError, ""_s);
        return;
    }

    auto result = CryptoKeyAES::generate(CryptoAlgorithmIdentifier::AES_KW, downcast<CryptoAlgorithmAesKeyParams>(parameters).length, extractable, usages);
    if (!result) {
        exceptionCallback(OperationError, ""_s);
        return;
    }

    callback(WTF::move(result));
}

void CryptoAlgorithmAES_KW::importKey(CryptoKeyFormat format, KeyData&& data, const CryptoAlgorithmParameters& parameters, bool extractable, CryptoKeyUsageBitmap usages, KeyCallback&& callback, ExceptionCallback&& exceptionCallback)
{
    using namespace CryptoAlgorithmAES_KWInternal;

    if (usagesAreInvalidForCryptoAlgorithmAES_KW(usages)) {
        exceptionCallback(SyntaxError, ""_s);
        return;
    }

    RefPtr<CryptoKeyAES> result;
    switch (format) {
    case CryptoKeyFormat::Raw:
        result = CryptoKeyAES::importRaw(parameters.identifier, WTF::move(std::get<Vector<uint8_t>>(data)), extractable, usages);
        break;
    case CryptoKeyFormat::Jwk: {
        result = CryptoKeyAES::importJwk(parameters.identifier, WTF::move(std::get<JsonWebKey>(data)), extractable, usages, [](size_t length, const String& alg) -> bool {
            switch (length) {
            case CryptoKeyAES::s_length128:
                return alg.isNull() || alg == ALG128;
            case CryptoKeyAES::s_length192:
                return alg.isNull() || alg == ALG192;
            case CryptoKeyAES::s_length256:
                return alg.isNull() || alg == ALG256;
            }
            return false;
        });
        break;
    }
    default:
        exceptionCallback(NotSupportedError, ""_s);
        return;
    }
    if (!result) {
        exceptionCallback(DataError, ""_s);
        return;
    }

    callback(*result);
}

void CryptoAlgorithmAES_KW::exportKey(CryptoKeyFormat format, Ref<CryptoKey>&& key, KeyDataCallback&& callback, ExceptionCallback&& exceptionCallback)
{
    using namespace CryptoAlgorithmAES_KWInternal;
    const auto& aesKey = downcast<CryptoKeyAES>(key.get());

    if (aesKey.key().isEmpty()) {
        exceptionCallback(OperationError, ""_s);
        return;
    }

    KeyData result;
    switch (format) {
    case CryptoKeyFormat::Raw:
        result = Vector<uint8_t>(aesKey.key());
        break;
    case CryptoKeyFormat::Jwk: {
        JsonWebKey jwk = aesKey.exportJwk();
        switch (aesKey.key().size() * 8) {
        case CryptoKeyAES::s_length128:
            jwk.alg = String(ALG128);
            break;
        case CryptoKeyAES::s_length192:
            jwk.alg = String(ALG192);
            break;
        case CryptoKeyAES::s_length256:
            jwk.alg = String(ALG256);
            break;
        default:
            ASSERT_NOT_REACHED();
        }
        result = WTF::move(jwk);
        break;
    }
    default:
        exceptionCallback(NotSupportedError, ""_s);
        return;
    }

    callback(format, WTF::move(result));
}

void CryptoAlgorithmAES_KW::wrapKey(Ref<CryptoKey>&& key, Vector<uint8_t>&& data, VectorCallback&& callback, ExceptionCallback&& exceptionCallback)
{
    if (data.size() % 8) {
        exceptionCallback(OperationError, ""_s);
        return;
    }

    auto result = platformWrapKey(downcast<CryptoKeyAES>(key.get()), WTF::move(data));
    if (result.hasException()) {
        exceptionCallback(result.releaseException().code(), ""_s);
        return;
    }

    callback(result.releaseReturnValue());
}

void CryptoAlgorithmAES_KW::unwrapKey(Ref<CryptoKey>&& key, Vector<uint8_t>&& data, VectorCallback&& callback, ExceptionCallback&& exceptionCallback)
{
    auto result = platformUnwrapKey(downcast<CryptoKeyAES>(key.get()), WTF::move(data));
    if (result.hasException()) {
        exceptionCallback(result.releaseException().code(), ""_s);
        return;
    }

    callback(result.releaseReturnValue());
}

ExceptionOr<size_t> CryptoAlgorithmAES_KW::getKeyLength(const CryptoAlgorithmParameters& parameters)
{
    return CryptoKeyAES::getKeyLength(parameters);
}

}

#endif // ENABLE(WEB_CRYPTO)
