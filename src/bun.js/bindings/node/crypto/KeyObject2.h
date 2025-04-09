#pragma once

#include "root.h"
#include "ncrypto.h"

namespace Bun {

class KeyObject {
public:
    enum class Type {
        Secret = 0,
        Public,
        Private,
    };

    Type m_type;
    WTF::FixedVector<uint8_t> m_symmetricKey;
    ncrypto::EVPKeyPointer m_asymmetricKey;

    Type type() const { return m_type; }
    const ncrypto::EVPKeyPointer& asymmetricKey() const { return m_asymmetricKey; }
    const std::span<const uint8_t> symmetricKey() const { return m_symmetricKey.span(); }

    std::optional<bool> equals(const KeyObject& other) const;
};

}
