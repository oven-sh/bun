#include "root.h"
#include "Bindgen/JSStringUTF8View.h"
#include <wtf/SIMDUTF.h>
#include <wtf/unicode/UTF8Conversion.h>

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
        m_converted.shrink(simdutf::convert_latin1_to_utf8(byteCast<char8_t>(span), m_converted.mutableSpan()));
        return true;
    }
    auto span = view.span16();
    if (!m_converted.tryGrow(span.size() * 3))
        return false;
    size_t length = StringImpl::tryConvertUTF16ToUTF8(span, m_converted.mutableSpan());
    if (length != notFound) [[likely]] {
        m_converted.shrink(length);
        return true;
    }
    // simdutf refuses unpaired surrogates; each becomes U+FFFD.
    m_converted.shrink(WTF::Unicode::convertReplacingInvalidSequences(span, m_converted.mutableSpan()).buffer.size());
    return true;
}

}
