#pragma once

#include "root.h"

#include <optional>
#include <wtf/text/WTFString.h>
#include <wtf/text/CString.h>

namespace JSC {
class JSGlobalObject;
class ThrowScope;
}

namespace Bun {
// UTF-8 bytes for a consumer that takes a pointer and a length. No NUL terminator: a `const char*` consumer needs `tryGetUTF8()`, which always copies.
class UTF8View {
public:
    // std::nullopt when the string does not convert: 2^30 Latin-1 characters or more, or a UTF-8 form of 2^31 bytes or more.
    static std::optional<UTF8View> tryCreate(WTF::StringView view)
    {
        UTF8View result;
        if (view.is8Bit() && view.containsOnlyASCII()) {
            result.m_borrowed = view;
            return result;
        }
        auto utf8 = view.tryGetUTF8();
        if (!utf8) [[unlikely]]
            return std::nullopt;
        result.m_converted = WTF::move(utf8.value());
        result.m_isConverted = true;
        return result;
    }

    // The same, and throws `RangeError: Out of memory` when the conversion fails.
    static std::optional<UTF8View> tryCreate(JSC::JSGlobalObject*, JSC::ThrowScope&, WTF::StringView);

    std::span<const uint8_t> bytes() const { return byteCast<uint8_t>(span()); }

    std::span<const char> span() const
    {
        if (m_isConverted)
            return m_converted.span();
        return byteCast<char>(m_borrowed.span8());
    }

private:
    UTF8View() = default;

    WTF::StringView m_borrowed {};
    WTF::CString m_converted {};
    bool m_isConverted { false };
};

// Pre-hashed and never atomized in place, so any number of threads may hold
// the result and use it as a property key. `threadShareableCopy` always
// copies; `makeThreadShareable` copies only an atom/symbol/substring;
// `toCrossThreadShareable` also copies short strings so they stay atomizable.
Ref<WTF::StringImpl> threadShareableCopy(const WTF::StringImpl&);
Ref<WTF::StringImpl> makeThreadShareable(WTF::StringImpl&);
WTF::String toCrossThreadShareable(const WTF::String&);

}
