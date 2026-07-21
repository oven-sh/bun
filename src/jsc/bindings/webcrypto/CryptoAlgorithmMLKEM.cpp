/*
 * Copyright (C) 2026 Apple Inc. All rights reserved.
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
#include "CryptoAlgorithmMLKEM.h"

#if ENABLE(WEB_CRYPTO)

#include "CryptoAlgorithmRegistry.h"
#include "CryptoKeyAKP.h"
#include "OpenSSLCryptoUniquePtr.h"
#include <openssl/err.h>
#include <openssl/evp.h>
#include <wtf/text/Base64.h>
#include <wtf/text/MakeString.h>

namespace WebCore {

static constexpr CryptoKeyUsageBitmap allMlKemUsages = CryptoKeyUsageEncapsulateKey | CryptoKeyUsageEncapsulateBits | CryptoKeyUsageDecapsulateKey | CryptoKeyUsageDecapsulateBits;
static constexpr CryptoKeyUsageBitmap publicMlKemUsages = CryptoKeyUsageEncapsulateKey | CryptoKeyUsageEncapsulateBits;
static constexpr CryptoKeyUsageBitmap privateMlKemUsages = CryptoKeyUsageDecapsulateKey | CryptoKeyUsageDecapsulateBits;

static String mlKemName(CryptoAlgorithmIdentifier identifier)
{
    return CryptoAlgorithmRegistry::singleton().name(identifier);
}

// Node's PKCS#8 length table for the seedless "expandedKey only" form, which
// gets a dedicated NotSupportedError before hitting the parser.
static std::optional<size_t> mlKemPrivOnlyPkcs8Length(CryptoAlgorithmIdentifier identifier)
{
    switch (identifier) {
    case CryptoAlgorithmIdentifier::ML_KEM_768:
        return 2428;
    case CryptoAlgorithmIdentifier::ML_KEM_1024:
        return 3196;
    default:
        return std::nullopt;
    }
}

void CryptoAlgorithmMLKEM::generateKey(const CryptoAlgorithmParameters& parameters, bool extractable, CryptoKeyUsageBitmap usages, KeyOrKeyPairCallback&& callback, ExceptionCallback&& exceptionCallback, ScriptExecutionContext&)
{
    if (usages & ~allMlKemUsages) {
        exceptionCallback(SyntaxError, makeString("Unsupported key usage for an "_s, mlKemName(m_identifier), " key"_s));
        return;
    }

    CryptoKeyUsageBitmap privateUsages = usages & privateMlKemUsages;
    CryptoKeyUsageBitmap publicUsages = usages & publicMlKemUsages;
    if (!privateUsages) {
        exceptionCallback(SyntaxError, "Usages cannot be empty when creating a key."_s);
        return;
    }

    auto result = CryptoKeyAKP::generatePair(parameters.identifier, extractable, publicUsages, privateUsages);
    if (result.hasException()) {
        exceptionCallback(result.releaseException().code(), ""_s);
        return;
    }

    callback(result.releaseReturnValue());
}

void CryptoAlgorithmMLKEM::importKey(CryptoKeyFormat format, KeyData&& data, const CryptoAlgorithmParameters& parameters, bool extractable, CryptoKeyUsageBitmap usages, KeyCallback&& callback, ExceptionCallback&& exceptionCallback)
{
    String name = mlKemName(m_identifier);
    auto unsupportedUsage = [&](bool isPublic) {
        if (usages & ~(isPublic ? publicMlKemUsages : privateMlKemUsages)) {
            exceptionCallback(SyntaxError, makeString("Unsupported key usage for a "_s, name, " key"_s));
            return true;
        }
        return false;
    };

    // Parse failures below surface as DataError with the BoringSSL error left
    // in the queue; SubtleCrypto::importKey attaches it as the cause.
    ERR_clear_error();

    RefPtr<CryptoKeyAKP> result;
    bool wrongKeyType = false;
    switch (format) {
    case CryptoKeyFormat::Spki:
        if (unsupportedUsage(true))
            return;
        result = CryptoKeyAKP::importSpki(parameters.identifier, WTF::move(std::get<Vector<uint8_t>>(data)), extractable, usages, &wrongKeyType);
        break;
    case CryptoKeyFormat::Pkcs8: {
        if (unsupportedUsage(false))
            return;
        auto& keyData = std::get<Vector<uint8_t>>(data);
        if (auto privOnlyLength = mlKemPrivOnlyPkcs8Length(parameters.identifier); privOnlyLength && keyData.size() == *privOnlyLength) {
            exceptionCallback(NotSupportedError, "Importing an ML-KEM PKCS#8 key without a seed is not supported"_s);
            return;
        }
        result = CryptoKeyAKP::importPkcs8(parameters.identifier, WTF::move(keyData), extractable, usages, &wrongKeyType);
        break;
    }
    case CryptoKeyFormat::RawPublic:
        if (unsupportedUsage(true))
            return;
        result = CryptoKeyAKP::importRawPublic(parameters.identifier, WTF::move(std::get<Vector<uint8_t>>(data)), extractable, usages);
        break;
    case CryptoKeyFormat::RawSeed:
        if (unsupportedUsage(false))
            return;
        result = CryptoKeyAKP::importRawSeed(parameters.identifier, WTF::move(std::get<Vector<uint8_t>>(data)), extractable, usages);
        break;
    case CryptoKeyFormat::Jwk: {
        auto& jwk = std::get<JsonWebKey>(data);
        if (jwk.kty.isNull()) {
            exceptionCallback(DataError, "Invalid keyData"_s);
            return;
        }
        if (jwk.kty != "AKP"_s) {
            exceptionCallback(DataError, "Invalid JWK \"kty\" Parameter"_s);
            return;
        }
        if (jwk.alg.isNull() || jwk.pub.isNull()) {
            exceptionCallback(DataError, "Invalid keyData"_s);
            return;
        }
        if (usages && !jwk.use.isNull() && jwk.use != "enc"_s) {
            exceptionCallback(DataError, "Invalid JWK \"use\" Parameter"_s);
            return;
        }
        if (jwk.key_ops) {
            CryptoKeyUsageBitmap seenOps = 0;
            for (auto op : *jwk.key_ops) {
                // The binding enum order matches the bitmap bit order.
                CryptoKeyUsageBitmap bit = 1 << static_cast<int>(op);
                if (seenOps & bit) {
                    exceptionCallback(DataError, "Duplicate key operation"_s);
                    return;
                }
                seenOps |= bit;
            }
        }
        if (jwk.key_ops && ((jwk.usages & usages) != usages)) {
            exceptionCallback(DataError, "Key operations and usage mismatch"_s);
            return;
        }
        if (jwk.ext && !jwk.ext.value() && extractable) {
            exceptionCallback(DataError, "JWK \"ext\" Parameter and extractable mismatch"_s);
            return;
        }
        if (jwk.alg != name) {
            exceptionCallback(DataError, "JWK \"alg\" Parameter and algorithm name mismatch"_s);
            return;
        }
        if (unsupportedUsage(jwk.priv.isNull()))
            return;
        result = CryptoKeyAKP::importJwk(parameters.identifier, WTF::move(jwk), extractable, usages);
        break;
    }
    case CryptoKeyFormat::Raw:
    case CryptoKeyFormat::RawSecret:
        exceptionCallback(NotSupportedError, makeString("Unable to import "_s, name, " using "_s, format == CryptoKeyFormat::Raw ? "raw"_s : "raw-secret"_s, " format"_s));
        return;
    }

    if (!result) {
        exceptionCallback(DataError, wrongKeyType ? "Invalid key type"_s : "Invalid keyData"_s);
        return;
    }
    callback(*result);
}

void CryptoAlgorithmMLKEM::exportKey(CryptoKeyFormat format, Ref<CryptoKey>&& key, KeyDataCallback&& callback, ExceptionCallback&& exceptionCallback)
{
    const auto& akpKey = downcast<CryptoKeyAKP>(key.get());
    String name = mlKemName(m_identifier);
    auto type = akpKey.type() == CryptoKeyType::Private ? "private"_s : "public"_s;
    auto unableToExport = [&](ASCIILiteral formatName) {
        exceptionCallback(NotSupportedError, makeString("Unable to export "_s, name, ' ', type, " key using "_s, formatName, " format"_s));
    };

    KeyData result;
    switch (format) {
    case CryptoKeyFormat::Jwk: {
        auto jwk = akpKey.exportJwk();
        if (jwk.hasException()) {
            exceptionCallback(jwk.releaseException().code(), ""_s);
            return;
        }
        result = jwk.releaseReturnValue();
        break;
    }
    case CryptoKeyFormat::Spki: {
        if (akpKey.type() != CryptoKeyType::Public) {
            unableToExport("spki"_s);
            return;
        }
        auto spki = akpKey.exportSpki();
        if (spki.hasException()) {
            exceptionCallback(spki.releaseException().code(), ""_s);
            return;
        }
        result = spki.releaseReturnValue();
        break;
    }
    case CryptoKeyFormat::Pkcs8: {
        if (akpKey.type() != CryptoKeyType::Private) {
            unableToExport("pkcs8"_s);
            return;
        }
        auto pkcs8 = akpKey.exportPkcs8();
        if (pkcs8.hasException()) {
            exceptionCallback(pkcs8.releaseException().code(), ""_s);
            return;
        }
        result = pkcs8.releaseReturnValue();
        break;
    }
    case CryptoKeyFormat::RawPublic: {
        if (akpKey.type() != CryptoKeyType::Public) {
            unableToExport("raw-public"_s);
            return;
        }
        auto raw = akpKey.exportRawPublic();
        if (raw.hasException()) {
            exceptionCallback(raw.releaseException().code(), ""_s);
            return;
        }
        result = raw.releaseReturnValue();
        break;
    }
    case CryptoKeyFormat::RawSeed: {
        if (akpKey.type() != CryptoKeyType::Private) {
            unableToExport("raw-seed"_s);
            return;
        }
        auto seed = akpKey.exportRawSeed();
        if (seed.hasException()) {
            exceptionCallback(seed.releaseException().code(), ""_s);
            return;
        }
        result = seed.releaseReturnValue();
        break;
    }
    case CryptoKeyFormat::Raw:
        unableToExport("raw"_s);
        return;
    case CryptoKeyFormat::RawSecret:
        unableToExport("raw-secret"_s);
        return;
    }

    callback(format, WTF::move(result));
}

void CryptoAlgorithmMLKEM::encapsulate(Ref<CryptoKey>&& key, VectorPairCallback&& callback, ExceptionCallback&& exceptionCallback)
{
    if (key->type() != CryptoKeyType::Public) {
        exceptionCallback(InvalidAccessError, "Key must be a public key"_s);
        return;
    }

    const auto& akpKey = downcast<CryptoKeyAKP>(key.get());
    EvpPKeyCtxPtr ctx(EVP_PKEY_CTX_new(akpKey.platformKey(), nullptr));
    if (!ctx || !EVP_PKEY_encapsulate_init(ctx.get(), nullptr)) {
        exceptionCallback(OperationError, ""_s);
        return;
    }

    size_t ciphertextLength = 0;
    size_t sharedKeyLength = 0;
    if (!EVP_PKEY_encapsulate(ctx.get(), nullptr, &ciphertextLength, nullptr, &sharedKeyLength)) {
        exceptionCallback(OperationError, ""_s);
        return;
    }

    Vector<uint8_t> ciphertext(ciphertextLength);
    Vector<uint8_t> sharedKey(sharedKeyLength);
    if (!EVP_PKEY_encapsulate(ctx.get(), ciphertext.begin(), &ciphertextLength, sharedKey.begin(), &sharedKeyLength)) {
        exceptionCallback(OperationError, ""_s);
        return;
    }
    ciphertext.shrink(ciphertextLength);
    sharedKey.shrink(sharedKeyLength);

    callback(WTF::move(sharedKey), WTF::move(ciphertext));
}

void CryptoAlgorithmMLKEM::decapsulate(Ref<CryptoKey>&& key, Vector<uint8_t>&& ciphertext, VectorCallback&& callback, ExceptionCallback&& exceptionCallback)
{
    if (key->type() != CryptoKeyType::Private) {
        exceptionCallback(InvalidAccessError, "Key must be a private key"_s);
        return;
    }

    const auto& akpKey = downcast<CryptoKeyAKP>(key.get());
    EvpPKeyCtxPtr ctx(EVP_PKEY_CTX_new(akpKey.platformKey(), nullptr));
    if (!ctx || !EVP_PKEY_decapsulate_init(ctx.get(), nullptr)) {
        exceptionCallback(OperationError, ""_s);
        return;
    }

    size_t sharedKeyLength = 0;
    if (!EVP_PKEY_decapsulate(ctx.get(), nullptr, &sharedKeyLength, ciphertext.begin(), ciphertext.size())) {
        ERR_clear_error();
        exceptionCallback(OperationError, ""_s);
        return;
    }

    Vector<uint8_t> sharedKey(sharedKeyLength);
    if (!EVP_PKEY_decapsulate(ctx.get(), sharedKey.begin(), &sharedKeyLength, ciphertext.begin(), ciphertext.size())) {
        ERR_clear_error();
        exceptionCallback(OperationError, ""_s);
        return;
    }
    sharedKey.shrink(sharedKeyLength);

    callback(sharedKey);
}

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)
