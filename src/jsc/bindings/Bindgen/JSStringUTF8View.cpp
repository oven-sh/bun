#include "root.h"
#include "Bindgen/JSStringUTF8View.h"
#include <wtf/SIMDUTF.h>

namespace Bun::Bindgen {
using namespace JSC;

bool JSStringUTF8View::convert()
{
    StringView view = m_view;
    m_isConverted = true;
    if (view.is8Bit()) {
        auto span = view.span8();
        if (!m_converted.tryGrow(span.size() * 2))
            return false;
        m_converted.shrink(simdutf::convert_latin1_to_utf8(byteCast<char>(span.data()), span.size(), byteCast<char>(m_converted.mutableSpan().data())));
        return true;
    }
    auto span = view.span16();
    if (!m_converted.tryGrow(span.size() * 3))
        return false;
    size_t length = simdutf::convert_utf16le_to_utf8(span.data(), span.size(), byteCast<char>(m_converted.mutableSpan().data()));
    if (length) [[likely]] {
        m_converted.shrink(length);
        return true;
    }
    // simdutf refuses unpaired surrogates; each becomes U+FFFD.
    auto lenient = view.utf8(WTF::ConversionMode::StrictConversionReplacingUnpairedSurrogatesWithFFFD);
    m_converted.shrink(0);
    return m_converted.tryAppend(byteCast<uint8_t>(lenient.span()));
}

}
