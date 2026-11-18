#include "engine/text/Base64.h"

#include "engine/text/MakeString.h"

#include <simdutf.h>

namespace WTF {

void StringTypeAdapter<Base64Specification>::writeTo(std::span<Latin1Character> destination) const
{
    RELEASE_ASSERT(destination.size() >= length());
    size_t written = simdutf::binary_to_base64(byteCast<char>(m_input.data()), m_input.size(), byteCast<char>(destination.data()));
    ASSERT_UNUSED(written, written == length());
}

void StringTypeAdapter<Base64Specification>::writeTo(std::span<char16_t> destination) const
{
    StringImpl::copyCharacters(destination, base64EncodeToString(m_input).span8());
}

String base64EncodeToString(std::span<const uint8_t> input)
{
    return makeString(base64Encoded(input));
}

template<typename T> static std::optional<Vector<uint8_t>> decode(std::span<const T> input, simdutf::base64_options alphabet)
{
    size_t length = input.size();
    while (length && input[length - 1] == '=')
        --length;
    if (length % 4 == 1 || (!length && !input.empty()))
        return std::nullopt;

    Vector<uint8_t> bytes(length / 4 * 3 + length % 4 * 3 / 4);
    size_t written = bytes.size();
    auto result = simdutf::base64_to_binary_safe(input.data(), length, byteCast<char>(bytes.mutableSpan().data()), written, alphabet);
    // White space, which the decoder skips, makes for fewer bytes.
    if (result.error != simdutf::error_code::SUCCESS || written != bytes.size())
        return std::nullopt;
    return bytes;
}

std::optional<Vector<uint8_t>> base64Decode(std::span<const uint8_t> input)
{
    return decode(byteCast<char>(input), simdutf::base64_default);
}

std::optional<Vector<uint8_t>> base64URLDecode(StringView input)
{
    if (input.is8Bit())
        return decode(byteCast<char>(input.span8()), simdutf::base64_url);
    return decode(input.span16(), simdutf::base64_url);
}

}
