
#pragma once

#include "root.h"
#include "helpers.h"
#include "ExceptionOr.h"
#include "CryptoKey.h"

namespace WebCore {

ExceptionOr<std::span<const uint8_t>> KeyObject__GetBuffer(JSC::JSValue bufferArg);

std::optional<std::span<const unsigned char>> getSymmetricKey(const CryptoKey& key);

} // namespace WebCore
