/*
 * Copyright (C) 2023 Apple Inc. All rights reserved.
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
#include "CryptoAlgorithmEd25519.h"

#if ENABLE(WEB_CRYPTO)

#include "CryptoKeyOKP.h"
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <wtf/CrossThreadCopier.h>

// -- BUN --
#include <openssl/curve25519.h>

namespace WebCore {

static ExceptionOr<Vector<uint8_t>> signEd25519(const Vector<uint8_t>& sk, size_t len, const Vector<uint8_t>& data)
{
    uint8_t newSignature[64];

    ED25519_sign(newSignature, data.data(), data.size(), sk.data());
    return Vector<uint8_t>(std::span { newSignature, 64 });
}

ExceptionOr<Vector<uint8_t>> CryptoAlgorithmEd25519::platformSign(const CryptoKeyOKP& key, const Vector<uint8_t>& data)
{
    return signEd25519(key.platformKey(), key.keySizeInBytes(), data);
}

static ExceptionOr<bool> verifyEd25519(const Vector<uint8_t>& key, size_t keyLengthInBytes, const Vector<uint8_t>& signature, const Vector<uint8_t> data)
{
    if (signature.size() != keyLengthInBytes * 2)
        return false;

    return ED25519_verify(data.data(), data.size(), signature.data(), key.data()) == 1;
}

ExceptionOr<bool> CryptoAlgorithmEd25519::platformVerify(const CryptoKeyOKP& key, const Vector<uint8_t>& signature, const Vector<uint8_t>& data)
{
    return verifyEd25519(key.platformKey(), key.keySizeInBytes(), signature, data);
}

Ref<CryptoAlgorithm> CryptoAlgorithmEd25519::create()
{
    return adoptRef(*new CryptoAlgorithmEd25519);
}

void CryptoAlgorithmEd25519::generateKey(const CryptoAlgorithmParameters&, bool extractable, CryptoKeyUsageBitmap usages, KeyOrKeyPairCallback&& callback, ExceptionCallback&& exceptionCallback, ScriptExecutionContext&)
{
    if (usages & (CryptoKeyUsageEncrypt | CryptoKeyUsageDecrypt | CryptoKeyUsageDeriveKey | CryptoKeyUsageDeriveBits | CryptoKeyUsageWrapKey | CryptoKeyUsageUnwrapKey)) {
        exceptionCallback(SyntaxError);
        return;
    }

    auto result = CryptoKeyOKP::generatePair(CryptoAlgorithmIdentifier::Ed25519, CryptoKeyOKP::NamedCurve::Ed25519, extractable, usages);
    if (result.hasException()) {
        exceptionCallback(result.releaseException().code());
        return;
    }

    auto pair = result.releaseReturnValue();
    pair.publicKey->setUsagesBitmap(pair.publicKey->usagesBitmap() & CryptoKeyUsageVerify);
    pair.privateKey->setUsagesBitmap(pair.privateKey->usagesBitmap() & CryptoKeyUsageSign);
    callback(WTFMove(pair));
}

void CryptoAlgorithmEd25519::sign(const CryptoAlgorithmParameters&, Ref<CryptoKey>&& key, Vector<uint8_t>&& data, VectorCallback&& callback, ExceptionCallback&& exceptionCallback, ScriptExecutionContext& context, WorkQueue& workQueue)
{
    if (key->type() != CryptoKeyType::Private) {
        exceptionCallback(InvalidAccessError);
        return;
    }
    dispatchOperationInWorkQueue(workQueue, context, WTFMove(callback), WTFMove(exceptionCallback),
        [key = WTFMove(key), data = WTFMove(data)] {
            return platformSign(downcast<CryptoKeyOKP>(key.get()), data);
        });
}

void CryptoAlgorithmEd25519::verify(const CryptoAlgorithmParameters&, Ref<CryptoKey>&& key, Vector<uint8_t>&& signature, Vector<uint8_t>&& data, BoolCallback&& callback, ExceptionCallback&& exceptionCallback, ScriptExecutionContext& context, WorkQueue& workQueue)
{
    if (key->type() != CryptoKeyType::Public) {
        exceptionCallback(InvalidAccessError);
        return;
    }
    dispatchOperationInWorkQueue(workQueue, context, WTFMove(callback), WTFMove(exceptionCallback),
        [key = WTFMove(key), signature = WTFMove(signature), data = WTFMove(data)] {
            return platformVerify(downcast<CryptoKeyOKP>(key.get()), signature, data);
        });
}

void CryptoAlgorithmEd25519::importKey(CryptoKeyFormat format, KeyData&& data, const CryptoAlgorithmParameters&, bool extractable, CryptoKeyUsageBitmap usages, KeyCallback&& callback, ExceptionCallback&& exceptionCallback)
{
    RefPtr<CryptoKeyOKP> result;
    switch (format) {
    case CryptoKeyFormat::Jwk: {
        JsonWebKey key = WTFMove(std::get<JsonWebKey>(data));
        if (usages && ((!key.d.isNull() && (usages ^ CryptoKeyUsageSign)) || (key.d.isNull() && (usages ^ CryptoKeyUsageVerify)))) {
            exceptionCallback(SyntaxError);
            return;
        }
        if (usages && !key.use.isNull() && key.use != "sig"_s) {
            exceptionCallback(DataError);
            return;
        }
        result = CryptoKeyOKP::importJwk(CryptoAlgorithmIdentifier::Ed25519, CryptoKeyOKP::NamedCurve::Ed25519, WTFMove(key), extractable, usages);
        break;
    }
    case CryptoKeyFormat::Raw:
        if (usages && (usages ^ CryptoKeyUsageVerify)) {
            exceptionCallback(SyntaxError);
            return;
        }
        result = CryptoKeyOKP::importRaw(CryptoAlgorithmIdentifier::Ed25519, CryptoKeyOKP::NamedCurve::Ed25519, WTFMove(std::get<Vector<uint8_t>>(data)), extractable, usages);
        break;
    case CryptoKeyFormat::Spki:
        if (usages && (usages ^ CryptoKeyUsageVerify)) {
            exceptionCallback(SyntaxError);
            return;
        }
        result = CryptoKeyOKP::importSpki(CryptoAlgorithmIdentifier::Ed25519, CryptoKeyOKP::NamedCurve::Ed25519, WTFMove(std::get<Vector<uint8_t>>(data)), extractable, usages);
        break;
    case CryptoKeyFormat::Pkcs8:
        if (usages && (usages ^ CryptoKeyUsageSign)) {
            exceptionCallback(SyntaxError);
            return;
        }
        result = CryptoKeyOKP::importPkcs8(CryptoAlgorithmIdentifier::Ed25519, CryptoKeyOKP::NamedCurve::Ed25519, WTFMove(std::get<Vector<uint8_t>>(data)), extractable, usages);
        break;
    }
    if (!result) {
        exceptionCallback(DataError);
        return;
    }
    callback(*result);
}

void CryptoAlgorithmEd25519::exportKey(CryptoKeyFormat format, Ref<CryptoKey>&& key, KeyDataCallback&& callback, ExceptionCallback&& exceptionCallback)
{
    const auto& okpKey = downcast<CryptoKeyOKP>(key.get());
    if (!okpKey.keySizeInBits()) {
        exceptionCallback(OperationError);
        return;
    }
    KeyData result;
    switch (format) {
    case CryptoKeyFormat::Jwk: {
        auto jwk = okpKey.exportJwk();
        if (jwk.hasException()) {
            exceptionCallback(jwk.releaseException().code());
            return;
        }
        result = jwk.releaseReturnValue();
        break;
    }
    case CryptoKeyFormat::Raw: {
        auto raw = okpKey.exportRaw();
        if (raw.hasException()) {
            exceptionCallback(raw.releaseException().code());
            return;
        }
        result = raw.releaseReturnValue();
        break;
    }
    case CryptoKeyFormat::Spki: {
        auto spki = okpKey.exportSpki();
        if (spki.hasException()) {
            exceptionCallback(spki.releaseException().code());
            return;
        }
        result = spki.releaseReturnValue();
        break;
    }
    case CryptoKeyFormat::Pkcs8: {
        auto pkcs8 = okpKey.exportPkcs8();
        if (pkcs8.hasException()) {
            exceptionCallback(pkcs8.releaseException().code());
            return;
        }
        result = pkcs8.releaseReturnValue();
        break;
    }
    }
    callback(format, WTFMove(result));
}

} // namespace WebCore
#endif // ENABLE(WEB_CRYPTO)
