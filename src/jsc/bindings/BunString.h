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
// The UTF-8 bytes of a string. An 8-bit all-ASCII string is borrowed, so it must outlive the view. Any other string is converted.
class UTF8View {
public:
    // std::nullopt when the conversion fails, where `utf8()` asserts: a Latin-1 string of 2^30 characters
    // or more, or a 16-bit string whose UTF-8 form is 2^31 bytes or more.
    static std::optional<UTF8View> tryCreate(WTF::StringView view)
    {
        UTF8View result;
        if (view.is8Bit() && view.containsOnlyASCII()) {
            result.m_view = view;
            return result;
        }
        auto utf8 = view.tryGetUTF8();
        if (!utf8) [[unlikely]]
            return std::nullopt;
        result.m_underlying = WTF::move(utf8.value());
        result.m_isCString = true;
        return result;
    }

    // The same, and throws `RangeError: Out of memory` when the conversion fails.
    static std::optional<UTF8View> tryCreate(JSC::JSGlobalObject*, JSC::ThrowScope&, WTF::StringView);

    std::span<const uint8_t> bytes() const
    {
        if (m_isCString) {
            return std::span(reinterpret_cast<const uint8_t*>(m_underlying.data()), m_underlying.length());
        }
        return std::span(reinterpret_cast<const uint8_t*>(m_view.span8().data()), m_view.length());
    }

    std::span<const char> span() const
    {
        if (m_isCString) {
            return std::span(reinterpret_cast<const char*>(m_underlying.data()), m_underlying.length());
        }

        return std::span(reinterpret_cast<const char*>(m_view.span8().data()), m_view.length());
    }

private:
    UTF8View() = default;

    WTF::CString m_underlying {};
    WTF::StringView m_view {};
    bool m_isCString { false };
};

// Pre-hashed and never atomized in place, so any number of threads may hold
// the result and use it as a property key. `threadShareableCopy` always
// copies; `makeThreadShareable` copies only an atom/symbol/substring;
// `toCrossThreadShareable` also copies short strings so they stay atomizable.
Ref<WTF::StringImpl> threadShareableCopy(const WTF::StringImpl&);
Ref<WTF::StringImpl> makeThreadShareable(WTF::StringImpl&);
WTF::String toCrossThreadShareable(const WTF::String&);

}
