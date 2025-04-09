#include "KeyObject2.h"

namespace Bun {

// returns std::nullopt for "unsupported crypto operation"
std::optional<bool> KeyObject::equals(const KeyObject& other) const
{
    if (type() != other.type()) {
        return false;
    }

    switch (type()) {
    case Type::Secret: {
        auto thisKey = symmetricKey();
        auto otherKey = other.symmetricKey();

        if (thisKey.size() != otherKey.size()) {
            return false;
        }

        return CRYPTO_memcmp(thisKey.data(), otherKey.data(), thisKey.size()) == 0;
    }
    case Type::Public:
    case Type::Private: {
        EVP_PKEY* thisKey = asymmetricKey().get();
        EVP_PKEY* otherKey = other.asymmetricKey().get();

        int ok = EVP_PKEY_cmp(thisKey, otherKey);
        if (ok == -2) {
            return std::nullopt;
        }

        return ok == 1;
    }
    }
}

}
