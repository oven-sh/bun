#include "root.h"
#include "BunIDNA.h"

#include <unicode/uidna.h>
#include <wtf/URL.h>
#include <wtf/URLParser.h>
#include <wtf/Vector.h>
#include <wtf/text/StringView.h>
#include <wtf/text/WTFString.h>

namespace Bun {

bool domainHasACELabel(WTF::StringView domain)
{
    unsigned labelStart = 0;
    while (true) {
        if (domain.substring(labelStart).startsWithIgnoringASCIICase("xn--"_s))
            return true;
        size_t dot = domain.find('.', labelStart);
        if (dot == WTF::notFound)
            return false;
        labelStart = static_cast<unsigned>(dot) + 1;
    }
}

WTF::String domainToASCII(WTF::StringView domain)
{
    std::array<char16_t, WTF::URLParser::hostnameBufferLength> stackBuffer;
    WTF::Vector<char16_t> heapBuffer;
    std::span<char16_t> buffer { stackBuffer };
    while (true) {
        UErrorCode error = U_ZERO_ERROR;
        UIDNAInfo processingDetails = UIDNA_INFO_INITIALIZER;
        int32_t length = uidna_nameToASCII(&WTF::URLParser::internationalDomainNameTranscoder(), domain.upconvertedCharacters(), domain.length(), buffer.data(), static_cast<int32_t>(buffer.size()), &processingDetails, &error);
        if (U_SUCCESS(error) && !(processingDetails.errors & ~WTF::URLParser::allowedNameToASCIIErrors) && length > 0)
            return WTF::String { buffer.first(static_cast<size_t>(length)) };
        // ICU preflight: on overflow `length` is the required size; retry once with a heap buffer.
        if (error != U_BUFFER_OVERFLOW_ERROR || length <= 0 || !heapBuffer.isEmpty())
            return {};
        heapBuffer.grow(static_cast<size_t>(length));
        buffer = heapBuffer.mutableSpan();
    }
}

bool urlHostIsValidIDNA(const WTF::URL& url)
{
    if (!url.hasSpecialScheme())
        return true;
    auto host = url.host();
    if (!domainHasACELabel(host))
        return true;
    return !domainToASCII(host).isNull();
}

} // namespace Bun
