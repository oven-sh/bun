#pragma once
#include "root.h"
#include <JavaScriptCore/GCOwnedDataScope.h>
#include <JavaScriptCore/JSString.h>
#include <JavaScriptCore/JSStringInlines.h>
#include <wtf/text/ASCIIFastPath.h>

namespace Bun::Bindgen {

// Bun::UTF8View for an argument of a host call. Lives in the host function's frame.
class JSStringUTF8View {
    WTF_MAKE_NONCOPYABLE(JSStringUTF8View);
    WTF_MAKE_NONMOVABLE(JSStringUTF8View);

public:
    // Not `= default`: value-initialization would zero the buffer first.
    JSStringUTF8View() {}

    // It is large, so it is filled in where it lives. Resolving a rope and converting can throw.
    void initialize(JSC::JSGlobalObject& globalObject, JSC::JSString* string)
    {
        ASSERT(m_isNull);
        auto& vm = JSC::getVM(&globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        m_view = string->view(&globalObject);
        RETURN_IF_EXCEPTION(scope, void());
        m_isNull = false;
        if (m_view->is8Bit() && WTF::charactersAreAllASCII(m_view->span8())) [[likely]]
            return;
        if (!convert()) [[unlikely]]
            JSC::throwOutOfMemoryError(&globalObject, scope);
    }

    void initialize(WTF::ASCIILiteral literal)
    {
        ASSERT(m_isNull);
        m_view = { nullptr, literal };
        m_isNull = false;
    }

    // Null data only for a view that was not initialized.
    std::span<const uint8_t> bytes() const
    {
        if (m_isNull)
            return {};
        auto span = m_isConverted ? m_converted.span() : byteCast<uint8_t>(m_view->span8());
        if (!span.data())
            return { reinterpret_cast<const uint8_t*>(""), 0 };
        return span;
    }

private:
    bool convert();

    // The owner is not always the string: the characters of a substring are its base's.
    JSC::GCOwnedDataScope<WTF::StringView> m_view;
    WTF::Vector<uint8_t, 128> m_converted;
    bool m_isConverted { false };
    bool m_isNull { true };
};

}
