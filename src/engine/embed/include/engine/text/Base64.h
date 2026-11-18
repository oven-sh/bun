#pragma once

#include "engine/support/Vector.h"
#include "engine/text/StringConcatenate.h"

#include <optional>

namespace WTF {

struct Base64Specification {
    std::span<const uint8_t> input;
};

// For makeString() and StringBuilder::append().
inline Base64Specification base64Encoded(std::span<const uint8_t> input LIFETIME_BOUND) { return { input }; }
String base64EncodeToString(std::span<const uint8_t>);

// These take any amount of padding and no white space.
std::optional<Vector<uint8_t>> base64Decode(std::span<const uint8_t>);
std::optional<Vector<uint8_t>> base64URLDecode(StringView);

template<> class StringTypeAdapter<Base64Specification> {
public:
    StringTypeAdapter(Base64Specification specification)
        : m_input(specification.input)
    {
        RELEASE_ASSERT(m_input.size() <= String::MaxLength);
    }

    unsigned length() const { return (m_input.size() + 2) / 3 * 4; }
    static constexpr bool is8Bit() { return true; }
    void writeTo(std::span<Latin1Character>) const;
    void writeTo(std::span<char16_t>) const;

private:
    std::span<const uint8_t> m_input;
};

}

using WTF::base64Decode;
using WTF::base64Encoded;
using WTF::base64EncodeToString;
using WTF::base64URLDecode;
