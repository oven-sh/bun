#include "root.h"
#include "Bindgen/JSStringUTF8View.h"
#include <wtf/SIMDUTF.h>
#include <wtf/unicode/UTF8Conversion.h>

namespace Bun::Bindgen {
using namespace JSC;

std::span<char8_t> JSStringUTF8View::tryAllocate(size_t size)
{
    if (size <= m_inlineBuffer.size())
        return m_inlineBuffer;
    m_heapBuffer = MallocSpan<char8_t>::tryMalloc(size);
    return m_heapBuffer->mutableSpan();
}

bool JSStringUTF8View::convert()
{
    StringView view = m_view;
    m_isConverted = true;
    if (view.is8Bit()) {
        auto span = view.span8();
        auto buffer = tryAllocate(span.size() * 2);
        if (!buffer.data())
            return false;
        m_converted = buffer.first(simdutf::convert_latin1_to_utf8(byteCast<char8_t>(span), buffer));
        return true;
    }
    auto span = view.span16();
    auto buffer = tryAllocate(span.size() * 3);
    if (!buffer.data())
        return false;
    size_t length = StringImpl::tryConvertUTF16ToUTF8(span, buffer);
    // simdutf refuses unpaired surrogates; each becomes U+FFFD.
    if (length == notFound) [[unlikely]]
        length = WTF::Unicode::convertReplacingInvalidSequences(span, buffer).buffer.size();
    m_converted = buffer.first(length);
    return true;
}

}
