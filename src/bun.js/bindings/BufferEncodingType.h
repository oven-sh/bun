#pragma once

#include "stdint.h"

namespace WebCore {

// must match src/bun.js/node/types.zig#Encoding
enum class BufferEncodingType : uint8_t {
    utf8 = 0,
    ucs2 = 1,
    utf16le = 2,
    latin1 = 3,
    ascii = 4,
    base64 = 5,
    base64url = 6,
    hex = 7,

    /// Refer to the buffer's encoding
    buffer = 8,

};

}
