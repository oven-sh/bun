#pragma once

#include "root.h"
#include "SIMDKernels.h"
#include <span>
#include <string_view>
#include <wtf/Vector.h>
#include <wtf/text/StringView.h>

namespace Bun {

// The wire bytes of an HTTP header name or value: one byte per code unit (https://fetch.spec.whatwg.org/#concept-header-value).
class HTTPLatin1String {
    WTF_MAKE_NONCOPYABLE(HTTPLatin1String);

public:
    explicit HTTPLatin1String(const WTF::StringView& string)
    {
        if (string.is8Bit()) {
            const auto span = string.span8();
            m_view = { reinterpret_cast<const char*>(span.data()), span.size() };
            return;
        }

        const auto span = string.span16();
        m_buffer.grow(span.size());
        uint8_t* output = m_buffer.mutableSpan().data();

        const size_t asciiPrefix = Bun__simd__indexOfNonASCII16(span.data(), span.size());
        Bun__simd__narrowTo8Bit(span.data(), asciiPrefix, output, span.size());
        // Header validation rejects code units above 0xFF; '?' matches String::latin1() if one gets through.
        for (size_t i = asciiPrefix; i < span.size(); i++)
            output[i] = isLatin1(span[i]) ? static_cast<uint8_t>(span[i]) : '?';

        m_view = { reinterpret_cast<const char*>(output), span.size() };
    }

    std::string_view view() const { return m_view; }

private:
    WTF::Vector<uint8_t, 64> m_buffer;
    std::string_view m_view;
};

} // namespace Bun
