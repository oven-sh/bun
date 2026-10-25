#pragma once

#include "BufferSource.h"
#include "CryptoAlgorithmParameters.h"
#include <wtf/Vector.h>

#if ENABLE(WEB_CRYPTO)

namespace WebCore {

// Node's Argon2Params dictionary (lib/internal/crypto/webidl.js). The
// validators run inside convertDictionary<CryptoAlgorithmArgon2Params>, so a
// constructed instance already satisfies every OperationError rule.
class CryptoAlgorithmArgon2Params final : public CryptoAlgorithmParameters {
public:
    BufferSource nonce;
    uint32_t parallelism { 0 };
    uint32_t memory { 0 };
    uint32_t passes { 0 };
    uint8_t version { 0x13 };
    // Use secretValueVector()/associatedDataVector() instead of these. The
    // BufferSource is gone once the vector accessor is called.
    mutable std::optional<BufferSource::VariantType> secretValue;
    mutable std::optional<BufferSource::VariantType> associatedData;

    Class parametersClass() const final { return Class::Argon2Params; }

    const Vector<uint8_t>& nonceVector() const
    {
        if (!m_nonceVector.isEmpty() || !nonce.length())
            return m_nonceVector;

        m_nonceVector.append(std::span { nonce.data(), nonce.length() });
        return m_nonceVector;
    }

    const Vector<uint8_t>& secretValueVector() const
    {
        return optionalVector(secretValue, m_secretValueVector);
    }

    const Vector<uint8_t>& associatedDataVector() const
    {
        return optionalVector(associatedData, m_associatedDataVector);
    }

    CryptoAlgorithmArgon2Params isolatedCopy() const
    {
        CryptoAlgorithmArgon2Params result;
        result.identifier = identifier;
        result.m_nonceVector = nonceVector();
        result.parallelism = parallelism;
        result.memory = memory;
        result.passes = passes;
        result.version = version;
        result.m_secretValueVector = secretValueVector();
        result.m_associatedDataVector = associatedDataVector();

        return result;
    }

private:
    static const Vector<uint8_t>& optionalVector(std::optional<BufferSource::VariantType>& source, Vector<uint8_t>& target)
    {
        if (!target.isEmpty() || !source)
            return target;

        BufferSource buffer = WTF::move(*source);
        source = std::nullopt;
        target.append(std::span { buffer.data(), buffer.length() });
        return target;
    }

    mutable Vector<uint8_t> m_nonceVector;
    mutable Vector<uint8_t> m_secretValueVector;
    mutable Vector<uint8_t> m_associatedDataVector;
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_CRYPTO_ALGORITHM_PARAMETERS(Argon2Params)

#endif // ENABLE(WEB_CRYPTO)
