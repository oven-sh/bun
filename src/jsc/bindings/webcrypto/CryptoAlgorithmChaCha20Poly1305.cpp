/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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
#include "CryptoAlgorithmChaCha20Poly1305.h"

#if ENABLE(WEB_CRYPTO)

#include "../wtf-bindings.h"
#include "CryptoKey.h"
#include "CryptoAlgorithmAeadParams.h"
#include "CryptoKeyRaw.h"
#include "JsonWebKey.h"
#include <wtf/CrossThreadCopier.h>
#include <wtf/text/Base64.h>

namespace WebCore {

namespace CryptoAlgorithmChaCha20Poly1305Internal {
static constexpr auto ALG = "C20P"_s;
static constexpr uint8_t TagLength = 128;
}

static inline bool usagesAreInvalidForChaCha20Poly1305(CryptoKeyUsageBitmap usages)
{
    return usages & (CryptoKeyUsageSign | CryptoKeyUsageVerify | CryptoKeyUsageDeriveKey | CryptoKeyUsageDeriveBits);
}

// The only tag length ChaCha20-Poly1305 defines is 128 bits; anything else is an
// OperationError rather than a silently truncated tag.
static bool validateTagLength(std::optional<uint8_t>& tagLength, const CryptoAlgorithm::ExceptionCallback& exceptionCallback)
{
    using namespace CryptoAlgorithmChaCha20Poly1305Internal;
    tagLength = tagLength.value_or(TagLength);
    if (*tagLength != TagLength) {
        exceptionCallback(OperationError, makeString(tagLength.value(), " is not a valid ChaCha20-Poly1305 tag length"_s));
        return false;
    }
    return true;
}

Ref<CryptoAlgorithm> CryptoAlgorithmChaCha20Poly1305::create()
{
    return adoptRef(*new CryptoAlgorithmChaCha20Poly1305);
}

CryptoAlgorithmIdentifier CryptoAlgorithmChaCha20Poly1305::identifier() const
{
    return s_identifier;
}

void CryptoAlgorithmChaCha20Poly1305::encrypt(const CryptoAlgorithmParameters& parameters, Ref<CryptoKey>&& key, Vector<uint8_t>&& plainText, VectorCallback&& callback, ExceptionCallback&& exceptionCallback, ScriptExecutionContext& context, WorkQueue& workQueue)
{
    auto& aeadParameters = downcast<CryptoAlgorithmAeadParams>(parameters);
    if (!validateTagLength(aeadParameters.tagLength, exceptionCallback))
        return;

    dispatchOperationInWorkQueue(workQueue, context, WTF::move(callback), WTF::move(exceptionCallback),
        [parameters = crossThreadCopy(aeadParameters), key = WTF::move(key), plainText = WTF::move(plainText)] {
            return platformEncrypt(parameters, downcast<CryptoKeyRaw>(key.get()), plainText);
        });
}

void CryptoAlgorithmChaCha20Poly1305::decrypt(const CryptoAlgorithmParameters& parameters, Ref<CryptoKey>&& key, Vector<uint8_t>&& cipherText, VectorCallback&& callback, ExceptionCallback&& exceptionCallback, ScriptExecutionContext& context, WorkQueue& workQueue)
{
    using namespace CryptoAlgorithmChaCha20Poly1305Internal;

    auto& aeadParameters = downcast<CryptoAlgorithmAeadParams>(parameters);
    if (!validateTagLength(aeadParameters.tagLength, exceptionCallback))
        return;
    if (cipherText.size() < TagLength / 8) {
        exceptionCallback(OperationError, "The provided data is too small"_s);
        return;
    }

    dispatchOperationInWorkQueue(workQueue, context, WTF::move(callback), WTF::move(exceptionCallback),
        [parameters = crossThreadCopy(aeadParameters), key = WTF::move(key), cipherText = WTF::move(cipherText)] {
            return platformDecrypt(parameters, downcast<CryptoKeyRaw>(key.get()), cipherText);
        });
}

void CryptoAlgorithmChaCha20Poly1305::generateKey(const CryptoAlgorithmParameters& parameters, bool extractable, CryptoKeyUsageBitmap usages, KeyOrKeyPairCallback&& callback, ExceptionCallback&& exceptionCallback, ScriptExecutionContext&)
{
    if (usagesAreInvalidForChaCha20Poly1305(usages)) {
        exceptionCallback(SyntaxError, "Unsupported key usage for a ChaCha20-Poly1305 key"_s);
        return;
    }

    callback(CryptoKeyRaw::create(parameters.identifier, CryptoKey::randomData(s_keyLengthBits / 8), usages, extractable));
}

void CryptoAlgorithmChaCha20Poly1305::importKey(CryptoKeyFormat format, KeyData&& data, const CryptoAlgorithmParameters& parameters, bool extractable, CryptoKeyUsageBitmap usages, KeyCallback&& callback, ExceptionCallback&& exceptionCallback)
{
    using namespace CryptoAlgorithmChaCha20Poly1305Internal;

    if (usagesAreInvalidForChaCha20Poly1305(usages)) {
        exceptionCallback(SyntaxError, "Unsupported key usage for a ChaCha20-Poly1305 key"_s);
        return;
    }

    Vector<uint8_t> keyData;
    switch (format) {
    case CryptoKeyFormat::RawSecret:
        keyData = WTF::move(std::get<Vector<uint8_t>>(data));
        break;
    case CryptoKeyFormat::Jwk: {
        auto& jwk = std::get<JsonWebKey>(data);
        if (jwk.kty.isNull()) {
            exceptionCallback(DataError, "Invalid keyData"_s);
            return;
        }
        if (jwk.kty != "oct"_s) {
            exceptionCallback(DataError, "Invalid JWK \"kty\" Parameter"_s);
            return;
        }
        if (jwk.k.isNull()) {
            exceptionCallback(DataError, "Invalid keyData"_s);
            return;
        }
        if (usages && !jwk.use.isNull() && jwk.use != "enc"_s) {
            exceptionCallback(DataError, "Invalid JWK \"use\" Parameter"_s);
            return;
        }
        if (jwk.key_ops && ((jwk.usages & usages) != usages)) {
            exceptionCallback(DataError, "Key operations and usage mismatch"_s);
            return;
        }
        if (jwk.ext && !jwk.ext.value() && extractable) {
            exceptionCallback(DataError, "JWK \"ext\" Parameter and extractable mismatch"_s);
            return;
        }
        if (!jwk.alg.isNull() && jwk.alg != ALG) {
            exceptionCallback(DataError, "JWK \"alg\" does not match the requested algorithm"_s);
            return;
        }
        auto octetSequence = base64URLDecode(jwk.k);
        if (!octetSequence) {
            exceptionCallback(DataError, "Invalid keyData"_s);
            return;
        }
        keyData = WTF::move(*octetSequence);
        break;
    }
    default:
        exceptionCallback(NotSupportedError, ""_s);
        return;
    }

    if (keyData.size() * 8 != s_keyLengthBits) {
        exceptionCallback(DataError, "Invalid key length"_s);
        return;
    }

    callback(CryptoKeyRaw::create(parameters.identifier, WTF::move(keyData), usages, extractable));
}

void CryptoAlgorithmChaCha20Poly1305::exportKey(CryptoKeyFormat format, Ref<CryptoKey>&& key, KeyDataCallback&& callback, ExceptionCallback&& exceptionCallback)
{
    using namespace CryptoAlgorithmChaCha20Poly1305Internal;

    const auto& rawKey = downcast<CryptoKeyRaw>(key.get());
    if (rawKey.key().isEmpty()) {
        exceptionCallback(OperationError, ""_s);
        return;
    }

    KeyData result;
    switch (format) {
    case CryptoKeyFormat::RawSecret:
        result = Vector<uint8_t>(rawKey.key());
        break;
    case CryptoKeyFormat::Jwk: {
        JsonWebKey jwk {};
        jwk.kty = "oct"_s;
        jwk.k = Bun::base64URLEncodeToString(rawKey.key());
        jwk.alg = String(ALG);
        jwk.key_ops = rawKey.usages();
        jwk.ext = rawKey.extractable();
        result = WTF::move(jwk);
        break;
    }
    default:
        exceptionCallback(NotSupportedError, ""_s);
        return;
    }

    callback(format, WTF::move(result));
}

ExceptionOr<std::optional<size_t>> CryptoAlgorithmChaCha20Poly1305::getKeyLength(const CryptoAlgorithmParameters&)
{
    return std::optional<size_t>(s_keyLengthBits);
}

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)
