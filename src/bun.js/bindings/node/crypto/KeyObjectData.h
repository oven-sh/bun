#pragma once

#include "root.h"
#include "ncrypto.h"
#include "CryptoKeyType.h"

struct KeyObjectData : ThreadSafeRefCounted<KeyObjectData> {
    WTF_MAKE_TZONE_ALLOCATED(KeyObjectData);

    KeyObjectData(WTF::Vector<uint8_t>&& symmetricKey)
        : symmetricKey(std::move(symmetricKey))
    {
    }

    KeyObjectData(ncrypto::EVPKeyPointer&& asymmetricKey)
        : asymmetricKey(std::move(asymmetricKey))
    {
    }

public:
    ~KeyObjectData() = default;

    static RefPtr<KeyObjectData> create(WTF::Vector<uint8_t>&& symmetricKey)
    {
        return adoptRef(*new KeyObjectData(std::move(symmetricKey)));
    }

    static RefPtr<KeyObjectData> create(ncrypto::EVPKeyPointer&& asymmetricKey)
    {
        return adoptRef(*new KeyObjectData(std::move(asymmetricKey)));
    }

    WTF::Vector<uint8_t> symmetricKey;
    const ncrypto::EVPKeyPointer asymmetricKey;
};
