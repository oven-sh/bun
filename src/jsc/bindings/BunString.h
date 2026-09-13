#pragma once

#include "root.h"

#include <wtf/text/WTFString.h>
#include <wtf/text/CString.h>

namespace Bun {
class UTF8View {
public:
    UTF8View()
    {
        m_isCString = false;
        m_underlying = {};
        m_view = {};
    }

    UTF8View(WTF::StringView view)
    {
        if (view.is8Bit() && view.containsOnlyASCII()) {
            m_view = view;
        } else {
            m_underlying = view.utf8();
            m_isCString = true;
        }
    }
    UTF8View(const WTF::String& str)
    {
        if (str.is8Bit() && str.containsOnlyASCII()) {
            m_view = str;
        } else {
            m_underlying = str.utf8();
            m_isCString = true;
        }
    }

    WTF::CString m_underlying {};
    WTF::StringView m_view {};
    bool m_isCString { false };

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
};

// Pre-hashed and never atomized in place, so any number of threads may hold
// the result and use it as a property key. `threadShareableCopy` always
// copies; `makeThreadShareable` copies only an atom/symbol/substring;
// `toCrossThreadShareable` also copies short strings so they stay atomizable.
Ref<WTF::StringImpl> threadShareableCopy(const WTF::StringImpl&);
Ref<WTF::StringImpl> makeThreadShareable(WTF::StringImpl&);
WTF::String toCrossThreadShareable(const WTF::String&);

}
