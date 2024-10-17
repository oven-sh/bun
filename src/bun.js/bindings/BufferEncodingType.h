#pragma once

namespace WebCore {

enum class BufferEncodingType {
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
