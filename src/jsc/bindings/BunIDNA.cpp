#include "root.h"
#include "BunIDNA.h"

#include <unicode/uidna.h>
#include <wtf/URL.h>
#include <wtf/URLParser.h>
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
    std::array<char16_t, WTF::URLParser::hostnameBufferLength> buffer;
    UErrorCode error = U_ZERO_ERROR;
    UIDNAInfo processingDetails = UIDNA_INFO_INITIALIZER;
    int32_t length = uidna_nameToASCII(&WTF::URLParser::internationalDomainNameTranscoder(), domain.upconvertedCharacters(), domain.length(), buffer.data(), WTF::URLParser::hostnameBufferLength, &processingDetails, &error);
    if (U_SUCCESS(error) && !(processingDetails.errors & ~WTF::URLParser::allowedNameToASCIIErrors) && length > 0)
        return WTF::String { std::span { buffer }.first(static_cast<size_t>(length)) };
    return {};
}

bool urlHostIsValidIDNA(const WTF::URL& url)
{
    // Only special-scheme URLs have a domain host; the host of every other
    // scheme is opaque and the URL Standard does not apply IDNA to it.
    if (!url.hasSpecialScheme())
        return true;
    // A parsed special host is already ASCII; UTS-46 "domain to ASCII" can
    // only still fail on it when a label uses the Punycode "xn--" prefix.
    auto host = url.host();
    if (!domainHasACELabel(host))
        return true;
    return !domainToASCII(host).isNull();
}

} // namespace Bun
