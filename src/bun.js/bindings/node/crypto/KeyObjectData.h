#pragma once

#include "root.h"
#include "ncrypto.h"
#include "CryptoKeyType.h"

struct KeyObjectData : ThreadSafeRefCounted<KeyObjectData> {
    WTF_MAKE_TZONE_ALLOCATED(KeyObjectData);

    KeyObjectData(WTF::Vector<uint8_t>&& symmetricKey)
        : symmetricKey(WTFMove(symmetricKey))
    {
    }

    KeyObjectData(ncrypto::EVPKeyPointer&& asymmetricKey)
        : asymmetricKey(WTFMove(asymmetricKey))
    {
    }

public:
    ~KeyObjectData() = default;

    static RefPtr<KeyObjectData> create(WTF::Vector<uint8_t>&& symmetricKey)
    {
        return adoptRef(*new KeyObjectData(WTFMove(symmetricKey)));
    }

    static RefPtr<KeyObjectData> create(ncrypto::EVPKeyPointer&& asymmetricKey)
    {
        return adoptRef(*new KeyObjectData(WTFMove(asymmetricKey)));
    }

    WTF::Vector<uint8_t> symmetricKey;
    const ncrypto::EVPKeyPointer asymmetricKey;
};
