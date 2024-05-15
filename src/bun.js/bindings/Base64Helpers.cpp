
#include "root.h"
#include "simdutf.h"

#include "ExceptionOr.h"

namespace Bun {

namespace Base64 {

using namespace WebCore;

ExceptionOr<String> atob(const String& encodedString)
{
    if (encodedString.isEmpty())
        return String();

    if (!encodedString.is8Bit()) {
        const auto span = encodedString.span16();
        size_t expected_length = simdutf::latin1_length_from_utf16(span.size());
        LChar* ptr;
        WTF::String convertedString = WTF::String::createUninitialized(expected_length, ptr);
        if (UNLIKELY(convertedString.isNull())) {
            return WebCore::Exception { OutOfMemoryError };
        }

        auto result = simdutf::convert_utf16le_to_latin1_with_errors(span.data(), span.size(), reinterpret_cast<char*>(ptr));

        if (result.error) {
            return WebCore::Exception { InvalidCharacterError };
        }
        return atob(convertedString);
    }

    const auto span = encodedString.span8();
    size_t result_length = simdutf::maximal_binary_length_from_base64(reinterpret_cast<const char*>(span.data()), encodedString.length());
    size_t original_length = result_length;
    LChar* ptr;
    WTF::String outString = WTF::String::createUninitialized(result_length, ptr);
    if (UNLIKELY(outString.isNull())) {
        return WebCore::Exception { OutOfMemoryError };
    }
    auto result = simdutf::base64_to_binary_safe(reinterpret_cast<const char*>(span.data()), span.size(), reinterpret_cast<char*>(ptr), result_length, simdutf::base64_url);
    if (result.error) {
        return WebCore::Exception { InvalidCharacterError };
    }
    ASSERT(result_length <= original_length);
    if (original_length != result_length) {
        return outString.substringSharingImpl(0, result_length);
    }

    return outString;
}
}
}