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

public:
    JSStringUTF8View() = default;
    JSStringUTF8View(JSStringUTF8View&&) = default;
    JSStringUTF8View& operator=(JSStringUTF8View&&) = default;
    explicit JSStringUTF8View(WTF::ASCIILiteral literal)
        : m_view(nullptr, literal)
        , m_isNull(false)
    {
    }

    // Resolving a rope and converting can throw.
    static JSStringUTF8View create(JSC::JSGlobalObject& globalObject, JSC::JSString* string)
    {
        auto& vm = JSC::getVM(&globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        JSStringUTF8View result;
        result.m_view = string->view(&globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        result.m_isNull = false;
        if (result.m_view->is8Bit() && WTF::charactersAreAllASCII(result.m_view->span8())) [[likely]]
            return result;
        if (!result.convert()) [[unlikely]] {
            JSC::throwOutOfMemoryError(&globalObject, scope);
            return {};
        }
        return result;
    }

    bool isNull() const { return m_isNull; }

    // Null data only when isNull().
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
