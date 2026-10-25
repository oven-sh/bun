#include "config.h"
#include "CryptoAlgorithmArgon2.h"

#if ENABLE(WEB_CRYPTO)

#include "CryptoAlgorithmArgon2Params.h"
#include "CryptoAlgorithmRegistry.h"
#include "CryptoKeyRaw.h"
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <wtf/CrossThreadCopier.h>
#include <wtf/text/MakeString.h>

// src/runtime/node/node_crypto_binding.rs
extern "C" bool Bun__Argon2__deriveBits(
    uint8_t variant,
    const uint8_t* message, size_t messageLength,
    const uint8_t* nonce, size_t nonceLength,
    const uint8_t* secret, size_t secretLength,
    const uint8_t* associatedData, size_t associatedDataLength,
    uint32_t parallelism,
    uint32_t memory,
    uint32_t passes,
    uint32_t tagLength,
    uint8_t* out);

namespace WebCore {

// kArgon2Types in src/js/node/crypto.ts.
static uint8_t argon2Variant(CryptoAlgorithmIdentifier identifier)
{
    switch (identifier) {
    case CryptoAlgorithmIdentifier::Argon2d:
        return 0;
    case CryptoAlgorithmIdentifier::Argon2i:
        return 1;
    case CryptoAlgorithmIdentifier::Argon2id:
        return 2;
    default:
        RELEASE_ASSERT_NOT_REACHED();
    }
}

static ASCIILiteral keyFormatName(CryptoKeyFormat format)
{
    switch (format) {
    case CryptoKeyFormat::Raw:
        return "raw"_s;
    case CryptoKeyFormat::Spki:
        return "spki"_s;
    case CryptoKeyFormat::Pkcs8:
        return "pkcs8"_s;
    case CryptoKeyFormat::Jwk:
        return "jwk"_s;
    case CryptoKeyFormat::RawSecret:
        return "raw-secret"_s;
    case CryptoKeyFormat::RawPublic:
        return "raw-public"_s;
    case CryptoKeyFormat::RawSeed:
        return "raw-seed"_s;
    }
    RELEASE_ASSERT_NOT_REACHED();
}

void CryptoAlgorithmArgon2::deriveBits(const CryptoAlgorithmParameters& parameters, Ref<CryptoKey>&& baseKey, std::optional<size_t> length, VectorCallback&& callback, ExceptionCallback&& exceptionCallback, ScriptExecutionContext& context, WorkQueue& workQueue)
{
    // validateArgon2DeriveBitsLength in node's lib/internal/crypto/argon2.js.
    if (!length) {
        exceptionCallback(OperationError, "length cannot be null"_s);
        return;
    }
    if (*length % 8) {
        exceptionCallback(OperationError, "length must be a multiple of 8"_s);
        return;
    }
    if (*length < 32) {
        exceptionCallback(OperationError, "length must be >= 32"_s);
        return;
    }

    dispatchOperationInWorkQueue(workQueue, context, WTF::move(callback), WTF::move(exceptionCallback),
        [identifier = m_identifier, parameters = crossThreadCopy(downcast<CryptoAlgorithmArgon2Params>(parameters)), baseKey = WTF::move(baseKey), length = *length] {
            return platformDeriveBits(identifier, parameters, downcast<CryptoKeyRaw>(baseKey.get()), length);
        });
}

ExceptionOr<Vector<uint8_t>> CryptoAlgorithmArgon2::platformDeriveBits(CryptoAlgorithmIdentifier identifier, const CryptoAlgorithmArgon2Params& parameters, const CryptoKeyRaw& key, size_t length)
{
    auto& nonce = parameters.nonceVector();
    auto& secret = parameters.secretValueVector();
    auto& associatedData = parameters.associatedDataVector();
    Vector<uint8_t> output(length / 8);
    if (!Bun__Argon2__deriveBits(argon2Variant(identifier),
            key.key().begin(), key.key().size(),
            nonce.begin(), nonce.size(),
            secret.begin(), secret.size(),
            associatedData.begin(), associatedData.size(),
            parameters.parallelism, parameters.memory, parameters.passes,
            static_cast<uint32_t>(output.size()), output.begin()))
        return Exception { OperationError };

    return output;
}

// importGenericSecretKey in node's lib/internal/crypto/keys.js, reached only
// for raw-secret (lib/internal/crypto/webcrypto.js importKeySync).
void CryptoAlgorithmArgon2::importKey(CryptoKeyFormat format, KeyData&& data, const CryptoAlgorithmParameters& parameters, bool extractable, CryptoKeyUsageBitmap usages, KeyCallback&& callback, ExceptionCallback&& exceptionCallback)
{
    auto name = CryptoAlgorithmRegistry::singleton().name(m_identifier);
    if (format != CryptoKeyFormat::RawSecret) {
        exceptionCallback(NotSupportedError, makeString("Unable to import "_s, name, " using "_s, keyFormatName(format), " format"_s));
        return;
    }
    if (extractable) {
        exceptionCallback(SyntaxError, makeString(name, " keys are not extractable"_s));
        return;
    }
    if (usages & ~(CryptoKeyUsageDeriveKey | CryptoKeyUsageDeriveBits)) {
        exceptionCallback(SyntaxError, makeString("Unsupported key usage for a "_s, name, " key"_s));
        return;
    }

    callback(CryptoKeyRaw::create(parameters.identifier, WTF::move(std::get<Vector<uint8_t>>(data)), usages));
}

ExceptionOr<std::optional<size_t>> CryptoAlgorithmArgon2::getKeyLength(const CryptoAlgorithmParameters&)
{
    return std::optional<size_t>();
}

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)
