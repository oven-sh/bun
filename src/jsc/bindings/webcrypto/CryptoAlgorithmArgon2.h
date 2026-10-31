#pragma once

#include "CryptoAlgorithm.h"

#if ENABLE(WEB_CRYPTO)

namespace WebCore {

class CryptoAlgorithmArgon2Params;
class CryptoKeyRaw;

// One implementation for Argon2d/Argon2i/Argon2id; the subclasses pin the name and identifier.
class CryptoAlgorithmArgon2 : public CryptoAlgorithm {
public:
    // The deriveBits checks that need no key; SubtleCrypto::supports asks it too.
    static ExceptionOr<void> validateDeriveBits(const CryptoAlgorithmArgon2Params&, std::optional<size_t> length);

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
