#pragma once
#include "root.h"
#include "ncrypto.h"

struct KeyObjectData {
    WTF::Vector<uint8_t> symmetricKey;
    ncrypto::EVPKeyPointer asymmetricKey;
};
