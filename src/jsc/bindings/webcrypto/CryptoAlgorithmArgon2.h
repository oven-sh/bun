#pragma once

#include "CryptoAlgorithm.h"

#if ENABLE(WEB_CRYPTO)

namespace WebCore {

class CryptoAlgorithmArgon2Params;
class CryptoKeyRaw;

// One implementation backs Argon2d/Argon2i/Argon2id; the registered subclasses
// below only pin the name and identifier, mirroring Node's argon2.js. The
// derivation runs in the same rust-argon2 engine as node:crypto.argon2.
class CryptoAlgorithmArgon2 : public CryptoAlgorithm {
public:
    // Node's Argon2Params validators (lib/internal/crypto/webidl.js) and
    // validateArgon2DeriveBitsLength (lib/internal/crypto/argon2.js). Shared by
    // convertDictionary<CryptoAlgorithmArgon2Params> and SubtleCrypto::supports.
    static constexpr uint32_t s_maxParallelism = (1u << 24) - 1;
    static constexpr size_t s_minNonceLength = 8;
    static constexpr uint8_t s_version = 0x13;
    static bool nonceIsValid(size_t length) { return length >= s_minNonceLength; }
    static bool parallelismIsValid(uint32_t parallelism) { return parallelism && parallelism <= s_maxParallelism; }
    static bool memoryIsValid(uint32_t memory, double parallelism) { return !(memory < 8 * parallelism); }
    static bool passesIsValid(uint32_t passes) { return passes; }
    static bool versionIsValid(uint8_t version) { return version == s_version; }
    static bool lengthIsValid(std::optional<size_t> length) { return length && !(*length % 8) && *length >= 32; }

    void deriveBits(const CryptoAlgorithmParameters&, Ref<CryptoKey>&&, std::optional<size_t> length, VectorCallback&&, ExceptionCallback&&, ScriptExecutionContext&, WorkQueue&) final;
    void importKey(CryptoKeyFormat, KeyData&&, const CryptoAlgorithmParameters&, bool extractable, CryptoKeyUsageBitmap, KeyCallback&&, ExceptionCallback&&) final;
    ExceptionOr<std::optional<size_t>> getKeyLength(const CryptoAlgorithmParameters&) final;

protected:
    explicit CryptoAlgorithmArgon2(CryptoAlgorithmIdentifier identifier)
        : m_identifier(identifier)
    {
    }

    CryptoAlgorithmIdentifier identifier() const final { return m_identifier; }

private:
    static ExceptionOr<Vector<uint8_t>> platformDeriveBits(CryptoAlgorithmIdentifier, const CryptoAlgorithmArgon2Params&, const CryptoKeyRaw&, size_t length);

    CryptoAlgorithmIdentifier m_identifier;
};

class CryptoAlgorithmArgon2d final : public CryptoAlgorithmArgon2 {
public:
    static constexpr ASCIILiteral s_name = "Argon2d"_s;
    static constexpr CryptoAlgorithmIdentifier s_identifier = CryptoAlgorithmIdentifier::Argon2d;
    static Ref<CryptoAlgorithm> create() { return adoptRef(*new CryptoAlgorithmArgon2d); }

private:
    CryptoAlgorithmArgon2d()
        : CryptoAlgorithmArgon2(s_identifier)
    {
    }
};

class CryptoAlgorithmArgon2i final : public CryptoAlgorithmArgon2 {
public:
    static constexpr ASCIILiteral s_name = "Argon2i"_s;
    static constexpr CryptoAlgorithmIdentifier s_identifier = CryptoAlgorithmIdentifier::Argon2i;
    static Ref<CryptoAlgorithm> create() { return adoptRef(*new CryptoAlgorithmArgon2i); }

private:
    CryptoAlgorithmArgon2i()
        : CryptoAlgorithmArgon2(s_identifier)
    {
    }
};

class CryptoAlgorithmArgon2id final : public CryptoAlgorithmArgon2 {
public:
    static constexpr ASCIILiteral s_name = "Argon2id"_s;
    static constexpr CryptoAlgorithmIdentifier s_identifier = CryptoAlgorithmIdentifier::Argon2id;
    static Ref<CryptoAlgorithm> create() { return adoptRef(*new CryptoAlgorithmArgon2id); }

private:
    CryptoAlgorithmArgon2id()
        : CryptoAlgorithmArgon2(s_identifier)
    {
    }
};

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)
