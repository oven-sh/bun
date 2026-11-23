#pragma once

#include "HTTPHeaderNames.h"
#include <array>
#include <wtf/text/WTFString.h>

namespace Bun {

// The value the last node:http request carried for each header that describes a client or a connection rather
// than a request or its user. A client sends those values again on every request, so the string a request needs
// for one of them is usually the one remembered here. Per VM: a thread atomizes a StringImpl in place.
class NodeHTTPRequestHeaderValues {
    static constexpr WebCore::HTTPHeaderName rememberedNames[] = {
        WebCore::HTTPHeaderName::Accept,
        WebCore::HTTPHeaderName::AcceptEncoding,
        WebCore::HTTPHeaderName::AcceptLanguage,
        WebCore::HTTPHeaderName::CacheControl,
        WebCore::HTTPHeaderName::Connection,
        WebCore::HTTPHeaderName::ContentType,
        WebCore::HTTPHeaderName::Host,
        WebCore::HTTPHeaderName::Origin,
        WebCore::HTTPHeaderName::Pragma,
        WebCore::HTTPHeaderName::SecFetchDest,
        WebCore::HTTPHeaderName::SecFetchMode,
        WebCore::HTTPHeaderName::UserAgent,
    };
    static constexpr uint8_t notRemembered = 0xff;
    static constexpr std::array<uint8_t, WebCore::numHTTPHeaderNames> slotOfName = [] {
        std::array<uint8_t, WebCore::numHTTPHeaderNames> slots {};
        slots.fill(notRemembered);
        for (uint8_t slot = 0; slot < std::size(rememberedNames); slot++)
            slots[static_cast<size_t>(rememberedNames[slot])] = slot;
        return slots;
    }();

public:
    // Where the value of `name` is remembered, or nullptr for a header whose values are not.
    WTF::String* slotFor(WebCore::HTTPHeaderName name)
    {
        uint8_t slot = slotOfName[static_cast<size_t>(name)];
        return slot == notRemembered ? nullptr : &m_values[slot];
    }

private:
    WTF::String m_values[std::size(rememberedNames)];
};

} // namespace Bun
