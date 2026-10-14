#pragma once

#include "root.h"
#include "ncrypto.h"
#include "CryptoKeyType.h"

struct KeyObjectData : ThreadSafeRefCounted<KeyObjectData> {
    WTF_MAKE_TZONE_ALLOCATED(KeyObjectData);

    KeyObjectData(ncrypto::DataPointer&& symmetricKey)
        : symmetricKey(WTF::move(symmetricKey))
    {
    }

    KeyObjectData(ncrypto::EVPKeyPointer&& asymmetricKey)
        : asymmetricKey(WTF::move(asymmetricKey))
    {
    }

public:
    ~KeyObjectData() = default;

    static RefPtr<KeyObjectData> create(ncrypto::DataPointer&& symmetricKey)
    {
        return adoptRef(*new KeyObjectData(WTF::move(symmetricKey)));
    }

    static RefPtr<KeyObjectData> create(ncrypto::EVPKeyPointer&& asymmetricKey)
    {
        return adoptRef(*new KeyObjectData(WTF::move(asymmetricKey)));
    }

    const ncrypto::DataPointer symmetricKey;
    const ncrypto::EVPKeyPointer asymmetricKey;
};
