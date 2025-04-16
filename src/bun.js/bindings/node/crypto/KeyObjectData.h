#pragma once

#include "root.h"
#include "ncrypto.h"
#include "CryptoKeyType.h"

struct KeyObjectData : ThreadSafeRefCounted<KeyObjectData> {
    WTF_MAKE_TZONE_ALLOCATED(KeyObjectData);

    KeyObjectData(WTF::Vector<uint8_t>&& symmetricKey)
        : symmetricKey(WTFMove(symmetricKey))
        , type(WebCore::CryptoKeyType::Secret)
    {
    }

    KeyObjectData(WebCore::CryptoKeyType type, ncrypto::EVPKeyPointer&& asymmetricKey)
        : asymmetricKey(WTFMove(asymmetricKey))
        , type(type)
    {
    }

public:
    ~KeyObjectData() = default;

    static RefPtr<KeyObjectData> create(WTF::Vector<uint8_t>&& symmetricKey)
    {
        return adoptRef(*new KeyObjectData(WTFMove(symmetricKey)));
    }

    static RefPtr<KeyObjectData> create(WebCore::CryptoKeyType type, ncrypto::EVPKeyPointer&& asymmetricKey)
    {
        return adoptRef(*new KeyObjectData(type, WTFMove(asymmetricKey)));
    }

    WTF::Vector<uint8_t> symmetricKey;
    ncrypto::EVPKeyPointer asymmetricKey;
    WebCore::CryptoKeyType type;
};
