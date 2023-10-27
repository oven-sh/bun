#include "root.h"
#include "headers-handwritten.h"
#include "helpers.h"

namespace Bun {
WTF::String toWTFString(const BunString& bunString);
}

extern "C" void Zig__Bun_base64URLEncodeToString(const uint8_t* input_ptr, uint64_t len, BunString* ret);

inline String Bun_base64URLEncodeToString(std::span<const uint8_t> input) {
    BunString result;
    Zig__Bun_base64URLEncodeToString(input.data(), input.size(), &result);
    return Bun::toWTFString(result);
}
